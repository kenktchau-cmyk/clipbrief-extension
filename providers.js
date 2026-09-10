export const GEMMA_MODEL = 'gemma-4-26b-a4b-it';
export const DEFAULT_CONFIG = Object.freeze({ provider: 'backend', endpoint: 'http://127.0.0.1:4173', model: GEMMA_MODEL, token: '' });

export function getApiTarget(config) {
  let url;
  try { url = new URL(config.endpoint); } catch { throw new Error('請填入有效嘅本機後端網址。'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('請使用 http://127.0.0.1:連接埠 或 http://localhost:連接埠。');
  return { base: url.origin, url: `${url.origin}/api/summarize`, origin: `http://${url.hostname}/*` };
}

export function restoreConfig(saved) {
  // Provider keys from earlier versions are deliberately discarded.
  if (saved?.provider !== 'backend') return { ...DEFAULT_CONFIG };
  const next = { ...DEFAULT_CONFIG, endpoint: saved.endpoint, token: typeof saved.token === 'string' ? saved.token : '' };
  getApiTarget(next);
  return next;
}
