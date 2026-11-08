// shader-hero: a WebGL background for a hero that keeps a one-file page at Lighthouse 100.
// The scene (fragment shader + how it reads the page's tokens) is inserted at /*SCENE*/ by scripts/inline.mjs.
//
// What this harness does, and why each part exists:
//   - starts after `load`, when the browser is idle: paint, LCP and CLS are measured before a shader compiles
//   - runs on real GPUs only: software renderers (SwiftShader, llvmpipe — Lighthouse's and PageSpeed's own Chrome)
//     would run the shader on the CPU, on the main thread (we measured TBT 6–24 s); those visitors keep the plain hero
//   - a slow first frame (> 40 ms) or data-saver mode also bows out; `#<hash>` in the URL forces the scene on
//   - adaptive resolution: frame times are measured for the first second and the canvas steps down until ~60 fps holds
//   - pauses off-screen and when the tab is hidden; a single still frame under prefers-reduced-motion
//   - colors come from the page's tokens, so dark mode follows for free
const init = () => {
  const scene = /*SCENE*/null;
  if (!scene) return;
  const canvas = document.querySelector(scene.selector);
  if (!canvas) return;
  const gl = canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true });
  if (!gl) return;
  const force = location.hash === scene.hash, info = gl.getExtension('WEBGL_debug_renderer_info');
  if (!force && /swiftshader|llvmpipe|softpipe|software|mesa offscreen/i.test(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '')) return;
  if (!force && navigator.connection && navigator.connection.saveData) return;

  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, 'precision mediump float;uniform vec2 r;uniform float t;' + scene.frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (n) => gl.getUniformLocation(prog, n), uR = u('r'), uT = u('t');

  // tokens → uniforms: scene.theme gets a reader for CSS custom properties as [r, g, b] in 0–1, and whether it is dark
  const rgb = (s) => { const m = (s || '').trim().match(/^#([0-9a-f]{3,6})$/i); if (!m) return [0, 0, 0]; const x = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]; return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255); };
  const dark = matchMedia('(prefers-color-scheme: dark)');
  const theme = () => { const cs = getComputedStyle(document.documentElement); scene.theme((name) => rgb(cs.getPropertyValue(name)), dark.matches, (n, v) => (v.length === 3 ? gl.uniform3fv(u(n), v) : gl.uniform1f(u(n), v))); };
  theme(); dark.addEventListener('change', theme);

  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let scale = scene.scale || 0.5, w = 0, h = 0, visible = true, raf = 0, start = performance.now(), probe = !force, last = 0, slow = 0, n = 0;
  const size = () => {
    const W = Math.max(1, Math.round(canvas.clientWidth * scale)), H = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (W !== w || H !== h) { w = canvas.width = W; h = canvas.height = H; gl.viewport(0, 0, w, h); gl.uniform2f(uR, w, h); }
  };
  const frame = (now) => {
    raf = 0; size();
    gl.uniform1f(uT, (now - start) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (probe) { probe = false; const t0 = performance.now(); gl.finish(); if (performance.now() - t0 > 40) { canvas.remove(); return; } }
    canvas.classList.add('on');
    if (last && n < 90) { n++; if (now - last > 19) slow++; if (n % 30 === 0) { if (slow > 8 && scale > 0.2) scale *= 0.7; slow = 0; } }
    last = now;
    if (!still && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const go = () => { if (!raf) raf = requestAnimationFrame(frame); };
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; if (visible) go(); }).observe(canvas);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) go(); });
  addEventListener('resize', go);
  go();
};
addEventListener('load', () => ('requestIdleCallback' in window ? requestIdleCallback(init, { timeout: 1500 }) : setTimeout(init, 300)));
