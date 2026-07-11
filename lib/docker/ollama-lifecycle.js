import Docker from 'dockerode';
import { abortController } from '../llm/providers.js';

const DEFAULT_CONTAINER_NAME = 'pullmd-ollama';
const DEFAULT_IMAGE = 'ollama/ollama:latest';
const DEFAULT_VOLUME = 'ollama-model-cache';
const HEALTH_POLL_MS = 500;

let dockerClient = null;
// Ownership latch: set exactly once, on this process's first look at the
// container. If it was already running at that moment, we never stop it —
// for the rest of this process's life — even though later calls may have to
// restart it after an external stop. This is deliberately coarse (matches
// "if ollama is already running before the execution then keep it running"
// rather than tracking per-transition ownership).
let firstTouchDone = false;
let weOwnContainer = false;
let idleTimer = null;
// De-dupes concurrent ensureOllamaRunning() callers onto a single in-flight
// attempt, so two requests racing in during a cold start don't both try to
// create the same container (which would 409 on the second one).
let ensuringPromise = null;

export function isOllamaManaged() {
  return process.env.PULLMD_OLLAMA_MANAGED === 'true';
}

function getDocker() {
  if (!dockerClient) dockerClient = new Docker();
  return dockerClient;
}

async function resolveNetwork(docker) {
  if (process.env.OLLAMA_NETWORK) return process.env.OLLAMA_NETWORK;
  try {
    const self = docker.getContainer(process.env.HOSTNAME || '');
    const info = await self.inspect();
    const names = Object.keys(info.NetworkSettings?.Networks || {});
    if (names.length) return names[0];
  } catch { /* HOSTNAME unset, or we're not actually in a container — fall back */ }
  return 'bridge';
}

async function ensureImagePulled(docker, image) {
  try { await docker.getImage(image).inspect(); return; }
  catch (err) { if (err.statusCode !== 404) throw err; }
  await new Promise((resolve, reject) => {
    docker.pull(image, (err, stream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

async function ensureAttachedToNetwork(docker, name, info) {
  const netName = await resolveNetwork(docker);
  const attached = Object.keys(info.NetworkSettings?.Networks || {});
  if (!netName || attached.includes(netName)) return;
  try {
    await docker.getNetwork(netName).connect({ Container: name });
  } catch (err) {
    // Best-effort: an existing container (e.g. one the user already runs for
    // other purposes) may be reachable another way (a host-published port,
    // host networking). Don't fail the whole request just because we
    // couldn't also attach it to pullmd's own network.
    console.warn(`[ollama-lifecycle] could not attach "${name}" to network "${netName}":`, String(err?.message ?? err));
  }
}

async function ensureContainerExists(docker) {
  const name = process.env.OLLAMA_CONTAINER_NAME || DEFAULT_CONTAINER_NAME;
  const container = docker.getContainer(name);
  try {
    const info = await container.inspect();
    // Found — may be a container pullmd created earlier, or one the operator
    // already runs for their own purposes. Either way, make sure it's
    // reachable from pullmd's own Docker network before returning it.
    await ensureAttachedToNetwork(docker, name, info);
    return container;
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }

  const image = process.env.OLLAMA_IMAGE || DEFAULT_IMAGE;
  try {
    await ensureImagePulled(docker, image);
  } catch (err) {
    throw new Error(`failed to pull Ollama image "${image}": ${String(err?.message ?? err)}`);
  }

  const netName = await resolveNetwork(docker);
  const volume = process.env.OLLAMA_VOLUME || DEFAULT_VOLUME;
  try { await docker.createVolume({ Name: volume }); }
  catch (err) { if (err.statusCode !== 409) throw err; }

  const gpuEnabled = process.env.OLLAMA_GPU !== 'false';
  try {
    await docker.createContainer({
      name,
      Image: image,
      Env: [`OLLAMA_KEEP_ALIVE=${process.env.OLLAMA_KEEP_ALIVE || '5m'}`],
      HostConfig: {
        Binds: [`${volume}:/root/.ollama`],
        RestartPolicy: { Name: 'unless-stopped' },
        DeviceRequests: gpuEnabled ? [{ Driver: 'nvidia', Count: -1, Capabilities: [['gpu']] }] : [],
      },
      NetworkingConfig: { EndpointsConfig: { [netName]: {} } },
    });
  } catch (err) {
    const hint = gpuEnabled
      ? ' — GPU passthrough failed; is the NVIDIA Container Toolkit installed on the host? Set OLLAMA_GPU=false to run on CPU instead.'
      : '';
    throw new Error(`failed to create Ollama container "${name}": ${String(err?.message ?? err)}${hint}`);
  }
  return docker.getContainer(name);
}

async function waitHealthy(nativeBase, signal) {
  let lastErr;
  for (;;) {
    if (signal?.aborted) {
      throw new Error(`Ollama container did not become healthy in time${lastErr ? `: ${lastErr.message}` : ''}`);
    }
    try {
      const res = await fetch(`${nativeBase}/api/tags`, { signal });
      if (res.ok) return;
    } catch (err) { lastErr = err; }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
}

async function ensureModelPulled(nativeBase, model, signal) {
  if (!model) return;
  let names = [];
  try {
    const res = await fetch(`${nativeBase}/api/tags`, { signal });
    if (res.ok) { const data = await res.json(); names = (data.models || []).map((m) => m.name); }
  } catch { /* treat as "not present", pull will surface any real connectivity issue */ }
  const have = names.some((n) => n === model || n.startsWith(`${model}:`));
  if (have) return;

  const res = await fetch(`${nativeBase}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, stream: false }),
    signal,
  });
  if (!res.ok) throw new Error(`failed to pull Ollama model "${model}" (${res.status})`);
}

async function doEnsure(openAiCompatBaseUrl, opts) {
  const timeoutMs = (Number(process.env.OLLAMA_START_TIMEOUT_SECONDS) || 600) * 1000;
  const { signal, cleanup } = abortController(opts, timeoutMs);
  try {
    const docker = getDocker();
    const container = await ensureContainerExists(docker);
    const info = await container.inspect();
    const wasRunning = info.State.Running;
    if (!firstTouchDone) {
      firstTouchDone = true;
      weOwnContainer = !wasRunning;
    }
    if (!wasRunning) await container.start();

    const nativeBase = openAiCompatBaseUrl.replace(/\/v1\/?$/, '');
    await waitHealthy(nativeBase, signal);
    await ensureModelPulled(nativeBase, opts.model, signal);
  } finally {
    cleanup();
  }
}

/**
 * Make sure the Ollama container is up, healthy, and has the requested model
 * pulled. Idempotent and safe to call before every vision request; creates
 * the container on first use (attached to pullmd's own Docker network, with
 * a GPU device request unless OLLAMA_GPU=false) if it doesn't exist yet.
 * No-op unless PULLMD_OLLAMA_MANAGED=true.
 * @param {string} openAiCompatBaseUrl e.g. http://pullmd-ollama:11434/v1
 * @param {{signal?: AbortSignal, model?: string}} [opts]
 */
export async function ensureOllamaRunning(openAiCompatBaseUrl, opts = {}) {
  if (!isOllamaManaged()) return;
  if (!ensuringPromise) {
    ensuringPromise = doEnsure(openAiCompatBaseUrl, opts).finally(() => { ensuringPromise = null; });
  }
  await ensuringPromise;
}

/**
 * Call after each vision request (success or failure) to (re)schedule an
 * idle auto-stop. Only has any effect on a container this process itself
 * started — a container found already running is left alone for good.
 */
export function noteOllamaActivity() {
  if (!isOllamaManaged() || !weOwnContainer) return;
  if (idleTimer) clearTimeout(idleTimer);
  const idleMs = (Number(process.env.OLLAMA_IDLE_STOP_SECONDS) || 300) * 1000;
  idleTimer = setTimeout(async () => {
    try {
      const name = process.env.OLLAMA_CONTAINER_NAME || DEFAULT_CONTAINER_NAME;
      const container = getDocker().getContainer(name);
      const info = await container.inspect();
      if (info.State.Running) await container.stop({ t: 10 });
    } catch (err) {
      console.warn('[ollama-lifecycle] idle-stop failed:', String(err?.message ?? err));
    }
  }, idleMs);
  idleTimer.unref?.();
}

/** Test-only seam: inject a fake dockerode client. */
export function _setDockerClientForTesting(client) { dockerClient = client; }

/** Test-only seam: reset all module state between tests. */
export function _resetForTesting() {
  dockerClient = null;
  firstTouchDone = false;
  weOwnContainer = false;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  ensuringPromise = null;
}
