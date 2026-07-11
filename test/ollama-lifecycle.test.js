import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureOllamaRunning,
  noteOllamaActivity,
  isOllamaManaged,
  _setDockerClientForTesting,
  _resetForTesting,
} from '../lib/docker/ollama-lifecycle.js';

const ENV_KEYS = ['PULLMD_OLLAMA_MANAGED', 'OLLAMA_CONTAINER_NAME', 'OLLAMA_IDLE_STOP_SECONDS', 'OLLAMA_START_TIMEOUT_SECONDS', 'OLLAMA_GPU'];
const saveEnv = () => Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const restoreEnv = (s) => { for (const k of ENV_KEYS) { if (s[k] === undefined) delete process.env[k]; else process.env[k] = s[k]; } };

// Minimal dockerode-shaped fake: a single tracked container ("state"), plus
// enough of getImage/createVolume/createContainer/pull to satisfy the
// create-from-scratch path.
function fakeDocker(state) {
  return {
    getContainer: () => ({
      inspect: async () => {
        if (!state.exists) { const e = new Error('no such container'); e.statusCode = 404; throw e; }
        return { State: { Running: state.running } };
      },
      start: async () => { state.running = true; },
      stop: async () => { state.running = false; },
    }),
    getImage: () => ({ inspect: async () => ({}) }),
    createVolume: async () => ({}),
    createContainer: async () => { state.exists = true; state.running = false; },
    pull: (_image, cb) => cb(null, {}),
    modem: { followProgress: (_stream, cb) => cb(null) },
  };
}

const tagsFetch = (models = ['moondream']) => async (url) => {
  if (String(url).endsWith('/api/tags')) return { ok: true, json: async () => ({ models: models.map((name) => ({ name })) }) };
  if (String(url).endsWith('/api/pull')) return { ok: true, json: async () => ({}) };
  return { ok: true, json: async () => ({}) };
};

describe('ollama-lifecycle', () => {
  let savedEnv, savedFetch;

  beforeEach(() => {
    savedEnv = saveEnv();
    savedFetch = globalThis.fetch;
    process.env.PULLMD_OLLAMA_MANAGED = 'true';
    _resetForTesting();
  });

  afterEach(() => {
    restoreEnv(savedEnv);
    globalThis.fetch = savedFetch;
    _resetForTesting();
  });

  it('isOllamaManaged reflects PULLMD_OLLAMA_MANAGED exactly', () => {
    process.env.PULLMD_OLLAMA_MANAGED = 'true';
    assert.equal(isOllamaManaged(), true);
    process.env.PULLMD_OLLAMA_MANAGED = 'false';
    assert.equal(isOllamaManaged(), false);
    delete process.env.PULLMD_OLLAMA_MANAGED;
    assert.equal(isOllamaManaged(), false);
  });

  it('never touches Docker when not managed', async () => {
    process.env.PULLMD_OLLAMA_MANAGED = 'false';
    _setDockerClientForTesting({ getContainer() { throw new Error('should not be called'); } });
    await ensureOllamaRunning('http://x/v1', {});
  });

  it('creates the container from scratch when missing, then starts it', async () => {
    const state = { exists: false, running: false };
    _setDockerClientForTesting(fakeDocker(state));
    globalThis.fetch = tagsFetch([]);
    await ensureOllamaRunning('http://pullmd-ollama:11434/v1', { model: 'moondream' });
    assert.equal(state.exists, true);
    assert.equal(state.running, true);
  });

  it('leaves an already-running container alone forever (never auto-stops it)', async () => {
    const state = { exists: true, running: true };
    _setDockerClientForTesting(fakeDocker(state));
    globalThis.fetch = tagsFetch();
    process.env.OLLAMA_IDLE_STOP_SECONDS = '0.01';

    await ensureOllamaRunning('http://pullmd-ollama:11434/v1', { model: 'moondream' });
    assert.equal(state.running, true);

    noteOllamaActivity();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(state.running, true, 'a container we did not start must never be auto-stopped');
  });

  it('auto-stops a container it started itself, after the idle window', async () => {
    const state = { exists: true, running: false };
    _setDockerClientForTesting(fakeDocker(state));
    globalThis.fetch = tagsFetch();
    process.env.OLLAMA_IDLE_STOP_SECONDS = '0.01';

    await ensureOllamaRunning('http://pullmd-ollama:11434/v1', { model: 'moondream' });
    assert.equal(state.running, true, 'we started it, so it should be running now');

    noteOllamaActivity();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(state.running, false, 'idle timer should have stopped a container we own');
  });

  it('matches a tagged model name loosely and skips re-pulling', async () => {
    const state = { exists: true, running: true };
    _setDockerClientForTesting(fakeDocker(state));
    let pullCalled = false;
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'moondream:latest' }] }) };
      if (String(url).endsWith('/api/pull')) { pullCalled = true; return { ok: true, json: async () => ({}) }; }
      return { ok: true, json: async () => ({}) };
    };
    await ensureOllamaRunning('http://pullmd-ollama:11434/v1', { model: 'moondream' });
    assert.equal(pullCalled, false);
  });

  it('rejects immediately on an already-aborted signal, without waiting on health checks', async () => {
    const state = { exists: true, running: true };
    _setDockerClientForTesting(fakeDocker(state));
    let fetchCalled = false;
    globalThis.fetch = async (...args) => { fetchCalled = true; return tagsFetch()(...args); };
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(() => ensureOllamaRunning('http://pullmd-ollama:11434/v1', { signal: ctrl.signal, model: 'moondream' }));
    assert.equal(fetchCalled, false);
  });
});
