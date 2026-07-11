import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_TEXT_LENGTH = 3;

function looksLikeText(s) {
  return /[A-Za-z0-9]/.test(s) && s.trim().length >= MIN_TEXT_LENGTH;
}

/**
 * Run local Tesseract OCR on an image buffer (piped via stdin — no temp
 * files). Resolves the extracted text, or null when the `tesseract` binary
 * isn't installed, times out, or finds nothing that looks like real text —
 * any of which mean the caller should fall back to a vision model instead.
 * @param {Buffer} buffer
 * @param {{signal?: AbortSignal, timeoutMs?: number}} [opts]
 * @returns {Promise<string|null>}
 */
export function extractTextTesseract(buffer, opts = {}) {
  const bin = process.env.TESSERACT_BIN || 'tesseract';
  const lang = process.env.TESSERACT_LANG || 'eng';
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(bin, ['-', 'stdout', '-l', lang], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }

    let out = '';
    let settled = false;
    const finish = (text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(text);
    };
    const onAbort = () => { proc.kill('SIGKILL'); finish(null); };
    const timer = setTimeout(() => { proc.kill('SIGKILL'); finish(null); }, timeoutMs);

    if (opts.signal) {
      if (opts.signal.aborted) return onAbort();
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    proc.stdout.on('data', (d) => { out += d.toString('utf8'); });
    proc.on('error', () => finish(null)); // binary missing, or failed to spawn
    proc.on('close', (code) => {
      if (code !== 0) return finish(null);
      const text = out.trim();
      finish(looksLikeText(text) ? text : null);
    });
    proc.stdin.on('error', () => {}); // e.g. EPIPE if the process exits early
    proc.stdin.write(buffer);
    proc.stdin.end();
  });
}
