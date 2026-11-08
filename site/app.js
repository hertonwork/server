// The page's own script: asks this server about itself and writes the answers into `app`; Minim renders them.
// Inlined by scripts/build.mjs after Minim at the end of the body. Every fetch carries `x-probe` so the service
// worker lets it through to the network and the headers shown are the server's, not the cache's.
(() => {
  const $ = (id) => document.getElementById(id);
  const probe = { 'x-probe': '1' };

  // --- request inspector ---------------------------------------------------------------------------------------
  const status = (c) => ({ 200: 'OK', 301: 'Moved Permanently', 304: 'Not Modified', 400: 'Bad Request', 404: 'Not Found', 405: 'Method Not Allowed', 500: 'Internal Server Error' })[c] || '';
  const shown = ['server', 'content-type', 'cache-control', 'content-encoding', 'vary', 'etag', 'content-length', 'x-content-type-options', 'x-frame-options', 'allow', 'location'];
  async function send() {
    app.busy = true;
    app.expect = $('path').selectedOptions[0]?.dataset.expect || '';   // what `npm start` answers, shown on static hosts
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

  // --- measured in the visitor's browser: this page load, on any host --------------------------------------------
  const kb = (b) => (b / 1024).toFixed(1);
  const protocols = { h3: 'HTTP/3', h2: 'HTTP/2', 'http/1.1': 'HTTP/1.1', 'http/1.0': 'HTTP/1.0' };
  function measure() {
    // the document's own entry, unless a service worker answered the navigation (then its sizes are the decoded
    // body): use the inspector's probe of / instead, which bypasses the worker and went over the network
    const nav = performance.getEntriesByType('navigation')[0];
    let e = nav && nav.workerStart === 0 && nav.encodedBodySize ? nav : null;
    app.viaSw = !e;
    e ||= performance.getEntriesByType('resource').filter((r) => r.initiatorType === 'fetch' && new URL(r.name).pathname === '/' && r.encodedBodySize).pop();
    if (!e) return;
    const raw = e.decodedBodySize, wire = e.encodedBodySize;
    app.kb = kb(wire);
    app.raw = kb(raw);
    app.saved = wire < raw ? `${Math.round((1 - wire / raw) * 100)}%` : 'not';
    // files the page itself pulled in to render: scripts, stylesheets, fonts. The inspector's own fetch() calls don't count
    app.assets = String(performance.getEntriesByType('resource')
      .filter((r) => r.initiatorType !== 'fetch' && r.initiatorType !== 'xmlhttprequest' && /\.(m?js|css|woff2?|ttf|otf)(\?|$)/.test(new URL(r.name).pathname)).length);
    app.proto = protocols[(nav || e).nextHopProtocol] || (nav || e).nextHopProtocol || '–';
  }
  // first paint can land after `load` on a page this small: observe it (buffered) instead of reading it once
  try {
    new PerformanceObserver((list, obs) => {
      const fcp = list.getEntriesByName('first-contentful-paint')[0];
      if (fcp) { app.fcp = `${Math.round(fcp.startTime)} ms`; obs.disconnect(); }
    }).observe({ type: 'paint', buffered: true });
  } catch { /* no paint timing: stays – */ }

  // --- the process serving the page, when there is one (simple-server: /api/health; a static host: none) ----------
  const span = (s) => s < 60 ? `${s}s` : s < 3600 ? `${s / 60 | 0}m ${s % 60}s` : s < 86400 ? `${s / 3600 | 0}h ${(s % 3600) / 60 | 0}m` : `${s / 86400 | 0}d ${(s % 86400) / 3600 | 0}h`;
  let polling = null;
  async function health() {
    try {
      const r = await fetch('/api/health', { headers: probe, cache: 'no-store' });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error(String(r.status));
      const h = await r.json();
      app.requests = h.requests.toLocaleString();
      app.uptime = span(h.uptime);
      app.node = h.node;
      app.proc = true; app.static = false;
      polling ??= setInterval(() => { if (!document.hidden) health(); }, 10_000);
    } catch {
      app.proc = false; app.static = true;   // nothing to poll: a static host has no process
    }
  }

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
  addEventListener('load', () => (self.requestIdleCallback || setTimeout)(() => { send().then(measure); health(); worker(); }));
})();
