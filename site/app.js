// The page's own script: asks this server about itself and writes the answers into `app`; Minim renders them.
// Inlined by scripts/build.mjs after Minim at the end of the body. Every fetch carries `x-probe` so the service
// worker lets it through to the network and the headers shown are the server's, not the cache's.
(() => {
  const $ = (id) => document.getElementById(id);
  const probe = { 'x-probe': '1' };

  // --- request inspector ---------------------------------------------------------------------------------------
  const status = (c) => ({ 200: 'OK', 301: 'Moved Permanently', 304: 'Not Modified', 400: 'Bad Request', 404: 'Not Found', 405: 'Method Not Allowed', 500: 'Internal Server Error' })[c] || '';
  const shown = ['content-type', 'cache-control', 'content-encoding', 'vary', 'etag', 'content-length', 'x-content-type-options', 'x-frame-options', 'allow', 'location'];
  async function send() {
    app.busy = true;
    const t0 = performance.now();
    try {
      const r = await fetch(app.path, { headers: { ...probe, Accept: 'text/html,*/*' }, cache: 'no-store', redirect: 'manual' });
      await r.arrayBuffer();
      app.status = String(r.status || 0);
      app.statusText = r.status ? r.statusText || status(r.status) : r.type === 'opaqueredirect' ? 'redirect' : '';
      for (const h of shown) app.h[h] = r.headers.get(h) || '';
    } catch {
      app.status = '0'; app.statusText = 'network error';
      for (const h of shown) app.h[h] = '';
    }
    app.ms = String(Math.round(performance.now() - t0));
    app.busy = false;
  }
  $('send').addEventListener('click', send);
  $('path').addEventListener('change', send);

  // --- live status -----------------------------------------------------------------------------------------------
  const span = (s) => s < 60 ? `${s}s` : s < 3600 ? `${s / 60 | 0}m ${s % 60}s` : s < 86400 ? `${s / 3600 | 0}h ${(s % 3600) / 60 | 0}m` : `${s / 86400 | 0}d ${(s % 86400) / 3600 | 0}h`;
  async function health() {
    try {
      const r = await fetch('/api/health', { headers: probe, cache: 'no-store' });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error(String(r.status));
      const h = await r.json();
      app.requests = h.requests.toLocaleString();
      app.uptime = span(h.uptime);
      app.node = h.node;
      app.started = new Date(h.started).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
      app.live = 'up'; app.static = false;
    } catch {
      app.live = 'none (static host)'; app.static = true;
    }
  }
  const tick = () => { if (!document.hidden) health(); };
  setInterval(tick, 10_000);

  // --- PWA -------------------------------------------------------------------------------------------------------
  const online = () => { app.network = navigator.onLine ? 'online' : 'offline'; };
  addEventListener('online', online); addEventListener('offline', online); online();
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) app.installed = 'yes';
  addEventListener('appinstalled', () => { app.installed = 'yes'; app.canInstall = false; });
  let install = null;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); install = e; app.canInstall = true; });
  $('install').addEventListener('click', async () => { if (!install) return; install.prompt(); await install.userChoice; install = null; app.canInstall = false; });

  let reg = null;
  const version = async () => { const keys = await caches.keys(); app.cache = (keys.find((k) => k.startsWith('simple-server-')) || '').slice(14) || '–'; };
  const watch = (w) => w && w.addEventListener('statechange', () => {
    const waiting = w.state === 'installed' && navigator.serviceWorker.controller;   // a new version waits behind this page
    app.sw = waiting ? 'update waiting' : w.state === 'activated' ? 'active' : w.state;
    if (waiting) app.updateReady = true;
    if (w.state === 'activated') version();
  });
  async function worker() {
    if (!('serviceWorker' in navigator)) { app.sw = 'unsupported'; return; }
    try {
      reg = await navigator.serviceWorker.register('/sw.js');
      app.sw = reg.active ? 'active' : reg.installing ? 'installing' : 'registered';
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      if (reg.waiting && navigator.serviceWorker.controller) { app.updateReady = true; app.sw = 'update waiting'; }
      if (reg.active) version();
    } catch { app.sw = 'failed'; }
  }
  // reload only when the visitor asked for the new version: the first install also changes the controller (claim)
  let swapping = false;
  navigator.serviceWorker?.addEventListener('controllerchange', () => { if (swapping) location.reload(); });
  $('reload').addEventListener('click', () => { swapping = true; reg?.waiting?.postMessage('skip'); });
  $('update').addEventListener('click', async () => { app.sw = 'checking'; await reg?.update(); app.sw = reg?.active ? 'active' : app.sw; });

  // after load, when the browser is idle: the first paint owes nothing to this script
  addEventListener('load', () => (self.requestIdleCallback || setTimeout)(() => { send(); health(); worker(); }));
})();
