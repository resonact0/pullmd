const PAGE_STYLE = `
<style>
  :root {
    --bg: #0e1016; --bg-elev: #14171f; --bg-input: #11141b;
    --fg: #e7e9ee; --fg-muted: #8b91a1; --border: #1f2330; --border-strong: #2a3040;
    --accent: #ff5722; --accent-hover: #ff7043; --accent-fg: #fff;
    --bad: #ff7a7a; --bad-bg: rgba(255,122,122,0.08);
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f6f3ee; --bg-elev: #fff; --bg-input: #fff;
      --fg: #1c1a17; --fg-muted: #6b6557; --border: #e6e0d4; --border-strong: #cdc5b3;
      --accent: #d84315; --accent-hover: #bf360c;
      --bad: #c62828; --bad-bg: rgba(198,40,40,0.06);
    }
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--fg);
    min-height: 100dvh; display: grid; place-items: center; padding: 2rem;
  }
  .card {
    background: var(--bg-elev); border: 1px solid var(--border);
    border-radius: 12px; padding: 2rem; width: 100%; max-width: 24rem;
    box-shadow: 0 8px 24px rgba(0,0,0,0.18);
  }
  h1 { font-size: 1.25rem; margin-bottom: 1rem; }
  label { display: block; margin-top: 0.75rem; color: var(--fg-muted); font-size: 0.875rem; }
  input[type="email"], input[type="password"], input[type="text"] {
    width: 100%; padding: 0.625rem 0.75rem; margin-top: 0.25rem;
    background: var(--bg-input); color: var(--fg);
    border: 1px solid var(--border); border-radius: 6px; font-size: 1rem;
  }
  button {
    margin-top: 1.25rem; width: 100%; padding: 0.625rem;
    background: var(--accent); color: var(--accent-fg);
    border: 0; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer;
  }
  button:hover { background: var(--accent-hover); }
  .error { background: var(--bad-bg); color: var(--bad);
           border: 1px solid var(--bad); border-radius: 6px;
           padding: 0.625rem; margin-bottom: 0.75rem; font-size: 0.875rem; }
  .muted { color: var(--fg-muted); font-size: 0.875rem; margin-top: 1rem; text-align: center; }
  .muted a { color: var(--accent); text-decoration: none; }
  .key-row { padding: 0.75rem; border-top: 1px solid var(--border);
             display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  .key-row:first-of-type { border-top: 0; }
  .key-prefix { font-family: ui-monospace, SFMono-Regular, monospace; }
  .key-label { color: var(--fg-muted); font-size: 0.875rem; }
  .key-actions form { display: inline; }
  .key-actions button { width: auto; padding: 0.375rem 0.625rem; font-size: 0.875rem;
                        background: transparent; color: var(--bad); border: 1px solid var(--bad); }
  .key-actions button:hover { background: var(--bad-bg); }
  .new-key-banner {
    background: rgba(107,255,156,0.08); border: 1px solid #6bff9c; color: var(--fg);
    border-radius: 6px; padding: 0.75rem; margin-bottom: 1rem; font-family: ui-monospace, monospace;
    font-size: 0.875rem; word-break: break-all;
  }
</style>`;

function escape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function loginPage({ error = '', email = '', next = '' } = {}) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Login — PullMD</title>${PAGE_STYLE}</head>
<body><form class="card" method="POST" action="/login">
  <h1>Sign in to PullMD</h1>
  ${error ? `<div class="error">${escape(error)}</div>` : ''}
  <input type="hidden" name="next" value="${escape(next)}">
  <label>Email <input type="email" name="email" required autofocus value="${escape(email)}"></label>
  <label>Password <input type="password" name="password" required></label>
  <button type="submit">Sign in</button>
  <div class="muted"><a href="/signup">Create an account</a></div>
</form></body></html>`;
}

export function signupPage({ error = '', email = '' } = {}) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sign up — PullMD</title>${PAGE_STYLE}</head>
<body><form class="card" method="POST" action="/signup">
  <h1>Create your PullMD account</h1>
  ${error ? `<div class="error">${escape(error)}</div>` : ''}
  <label>Email <input type="email" name="email" required autofocus value="${escape(email)}"></label>
  <label>Password (min 8 chars)
    <input type="password" name="password" required minlength="8"></label>
  <label>Confirm password
    <input type="password" name="password_confirm" required minlength="8"></label>
  <button type="submit">Sign up</button>
  <div class="muted"><a href="/login">I already have an account</a></div>
</form></body></html>`;
}

export function settingsPage({ user, keys, newKey = null, error = '' } = {}) {
  const newKeyBlock = newKey
    ? `<div class="new-key-banner"><strong>Save this key now — it won't be shown again:</strong><br>${escape(newKey)}</div>`
    : '';
  const errorBlock = error ? `<div class="error">${escape(error)}</div>` : '';
  const rows = keys.length === 0
    ? `<div class="key-row"><span class="key-label">No API keys yet.</span></div>`
    : keys.map(k => `
      <div class="key-row">
        <div>
          <div class="key-prefix">${escape(k.key_prefix)}…</div>
          <div class="key-label">${escape(k.label || 'unnamed')} · created ${escape(k.created_at)}${k.last_used_at ? ` · last used ${escape(k.last_used_at)}` : ' · never used'}</div>
        </div>
        <div class="key-actions">
          <form method="POST" action="/api/keys/${k.id}/revoke" onsubmit="return confirm('Revoke this key? Programmatic clients using it will start failing.')">
            <button type="submit">Revoke</button>
          </form>
        </div>
      </div>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Settings — PullMD</title>${PAGE_STYLE}
  <style> body { display: block; padding: 2rem; max-width: 40rem; margin: 0 auto; }
  .card { max-width: none; margin-top: 1rem; padding: 1.5rem; }
  </style></head>
<body>
  <h1 style="margin-bottom: 0.5rem;">Settings</h1>
  <div class="muted" style="text-align: left; margin: 0 0 1rem;">Signed in as ${escape(user.email)}${user.is_admin ? ' (admin)' : ''} · <a href="/">Back to PullMD</a> · <form style="display:inline" method="POST" action="/logout"><button type="submit" style="display:inline; padding: 0; background: transparent; color: var(--accent); width:auto;">Log out</button></form></div>

  <div class="card">
    <h2 style="font-size:1rem; margin-bottom:0.75rem;">API keys</h2>
    ${errorBlock}
    ${newKeyBlock}
    <form method="POST" action="/api/keys" style="display:flex; gap:0.5rem; margin-bottom:0.75rem;">
      <input type="text" name="label" placeholder="Label (e.g. Claude Code on cortex)" style="flex:1;">
      <button type="submit" style="width:auto; padding:0.5rem 0.75rem;">Generate</button>
    </form>
    ${rows}
  </div>
</body></html>`;
}
