export async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // session expired/invalid: drop it and reload to the login screen
    if (r.status === 401 && localStorage.getItem('token')) {
      localStorage.clear();
      location.reload();
    }
    throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status, data });
  }
  return data;
}
