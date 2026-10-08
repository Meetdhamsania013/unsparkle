/*
 * Unsparkle – gentle "magic" background for the home page: tiny sparkles drift
 * upwards and twinkle, a soft glow follows the cursor, and now and then a
 * shooting star crosses the sky. Runs only while the home page is visible,
 * pauses in background tabs and is off when the system asks for reduced motion.
 */
(function () {
  'use strict';
  const cv = document.getElementById('magic');
  const landing = document.getElementById('landing');
  if (!cv || !cv.getContext) return;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) { cv.remove(); return; }

  const ctx = cv.getContext('2d');
  const TAU = Math.PI * 2;
  let W = 0, H = 0, dpr = 1, parts = [], palette = [], lightBg = false;
  let mouse = null, glow = { x: 0, y: 0, a: 0 };
  let shooting = null, nextShot = 0, last = 0, running = false;

  function readTheme() {
    const c = getComputedStyle(document.body).backgroundColor.match(/\d+/g) || [11, 13, 23];
    lightBg = (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 140;
    palette = lightBg
      ? ['139,92,246', '6,182,212', '217,70,239', '99,102,241']
      : ['196,181,253', '103,232,249', '240,171,252', '255,255,255'];
  }

  function spawn(anywhere) {
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : H + 10 + Math.random() * 40,
      r: 0.8 + Math.random() * 2,                // sparkle size
      vy: -(0.006 + Math.random() * 0.018),      // px per ms, slow drift up
      vx: (Math.random() - 0.5) * 0.008,
      ph: Math.random() * TAU,                   // twinkle phase
      sp: 0.0007 + Math.random() * 0.0016,       // twinkle speed
      rot: Math.random() * TAU,
      vr: (Math.random() - 0.5) * 0.0004,
      c: palette[(Math.random() * palette.length) | 0],
    };
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    readTheme();
    const n = Math.round(Math.min(38, Math.max(12, (W * H) / 28000)));
    parts = parts.slice(0, n);
    while (parts.length < n) parts.push(spawn(true));
    parts.forEach((p) => { p.c = palette[(Math.random() * palette.length) | 0]; });
  }

  // four-point sparkle with a soft halo
  function sparkle(x, y, r, rot, color, a) {
    const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 7);
    halo.addColorStop(0, `rgba(${color},${a * (lightBg ? 0.24 : 0.22)})`);
    halo.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(x, y, r * 7, 0, TAU); ctx.fill();

    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    const L = r * 3.2, k = r * 0.55;
    ctx.beginPath();
    ctx.moveTo(0, -L);
    ctx.quadraticCurveTo(k, -k, L, 0);
    ctx.quadraticCurveTo(k, k, 0, L);
    ctx.quadraticCurveTo(-k, k, -L, 0);
    ctx.quadraticCurveTo(-k, -k, 0, -L);
    ctx.fillStyle = `rgba(${color},${a * (lightBg ? 0.85 : 0.72)})`;
    ctx.fill();
    ctx.restore();
  }

  function frame(t) {
    if (!running) return;
    const dt = Math.min(50, t - (last || t));
    last = t;
    ctx.clearRect(0, 0, W, H);

    // soft glow that lazily follows the cursor
    if (mouse) {
      glow.x += (mouse.x - glow.x) * 0.06;
      glow.y += (mouse.y - glow.y) * 0.06;
      glow.a += (1 - glow.a) * 0.03;
    } else glow.a *= 0.96;
    if (glow.a > 0.01) {
      const g = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, 220);
      g.addColorStop(0, `rgba(${lightBg ? '139,92,246' : '167,139,250'},${0.10 * glow.a})`);
      g.addColorStop(1, 'rgba(139,92,246,0)');
      ctx.fillStyle = g;
      ctx.fillRect(glow.x - 220, glow.y - 220, 440, 440);
    }

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      // sparkles near the cursor drift gently away, like stirred dust
      if (mouse) {
        const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
        if (d2 < 14000) { const f = (1 - d2 / 14000) * 0.02 * dt; const d = Math.sqrt(d2) || 1; p.x += (dx / d) * f; p.y += (dy / d) * f; }
      }
      if (p.y < -20 || p.x < -20 || p.x > W + 20) parts[i] = spawn(false);
      const tw = 0.5 + 0.5 * Math.sin(t * p.sp + p.ph);
      sparkle(p.x, p.y, p.r, p.rot, p.c, 0.15 + 0.85 * tw * tw);
    }

    // an occasional shooting star
    if (!shooting && t > nextShot) {
      const fromLeft = Math.random() < 0.5;
      shooting = { x: fromLeft ? -50 : W + 50, y: H * (0.05 + Math.random() * 0.3), vx: (fromLeft ? 1 : -1) * (0.55 + Math.random() * 0.3), vy: 0.12 + Math.random() * 0.1, life: 0 };
      nextShot = t + 9000 + Math.random() * 9000;
    }
    if (shooting) {
      const s = shooting;
      s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt;
      const fade = Math.min(1, s.life / 300) * Math.max(0, 1 - s.life / 1800);
      const tx = s.x - s.vx * 220, ty = s.y - s.vy * 220;
      const g = ctx.createLinearGradient(s.x, s.y, tx, ty);
      g.addColorStop(0, `rgba(${lightBg ? '139,92,246' : '255,255,255'},${0.55 * fade})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(tx, ty); ctx.stroke();
      sparkle(s.x, s.y, 1.6, 0, lightBg ? '139,92,246' : '255,255,255', fade);
      if (s.life > 1800) shooting = null;
    }
    requestAnimationFrame(frame);
  }

  function shouldRun() { return !landing.hidden && !document.hidden; }
  function update() {
    const on = shouldRun();
    cv.classList.toggle('on', on);
    if (on && !running) { running = true; last = 0; requestAnimationFrame(frame); }
    if (!on) running = false;
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') mouse = { x: e.clientX, y: e.clientY }; });
  document.documentElement.addEventListener('pointerleave', () => (mouse = null));
  document.addEventListener('visibilitychange', update);
  new MutationObserver(update).observe(landing, { attributes: true, attributeFilter: ['hidden'] });
  // re-colour when the theme changes
  new MutationObserver(() => { readTheme(); parts.forEach((p) => { p.c = palette[(Math.random() * palette.length) | 0]; }); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', readTheme);

  resize();
  nextShot = performance.now() + 2500;
  update();
})();
