/*
 * Unsparkle – video screen: preview, before/after player, brush for fixed
 * objects, processing with progress, and download. The video work itself is in
 * video.js (WMVideo).
 */
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const tr = (k, v) => root.WMI18n.t(k, v);
  const el = {
    view: $('videoView'), name: $('vName'), info: $('vInfo'), status: $('vStatus'),
    stage: $('vStage'), before: $('vBefore'), after: $('vAfter'), still: $('vStill'), paint: $('vPaint'),
    spot: $('vSpot'), divider: $('vDivider'), tagBefore: $('vTagBefore'), tagAfter: $('vTagAfter'), cursor: $('vCursor'),
    play: $('vPlay'), seek: $('vSeek'), time: $('vTime'),
    brushBtn: $('vBrushBtn'), brushBar: $('vBrushBar'), brushSize: $('vBrushSize'), brushClear: $('vBrushClear'),
    runBtn: $('vRun'), runHint: $('vRunHint'),
    overlay: $('vOverlay'), arc: $('vArc'), pct: $('vPct'), wTitle: $('vWorkTitle'), wSub: $('vWorkSub'), cancel: $('vCancel'),
    save: $('vSave'), dlBtn: $('vDownload'), dlInfo: $('vDlInfo'), fileName: $('vFileName'), fileExt: $('vFileExt'),
    again: $('vAgain'), hint: $('vHint'),
  };
  const state = { file: null, analysis: null, result: null, brushing: false, painted: false, busy: false, aborter: null, urls: [] };

  function fmtTime(s) {
    s = Math.max(0, s || 0);
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }
  function fmtBytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; }
  function url(blob) { const u = URL.createObjectURL(blob); state.urls.push(u); return u; }
  function freeUrls() { state.urls.forEach((u) => URL.revokeObjectURL(u)); state.urls = []; }

  function setStatus(text, kind) { el.status.textContent = text; el.status.className = 'status ' + (kind || 'ok'); }

  // ---------- compare slider over the two videos ----------
  let split = 50, dragging = false;
  function setSplit(v) {
    split = v;
    el.after.style.clipPath = `inset(0 0 0 ${v}%)`;
    el.divider.style.left = v + '%';
  }
  el.stage.addEventListener('pointerdown', (e) => {
    if (state.brushing || !state.result || state.busy) return;
    dragging = true;
    el.stage.setPointerCapture(e.pointerId);
    move(e);
  });
  el.stage.addEventListener('pointermove', (e) => { if (dragging) move(e); });
  ['pointerup', 'pointercancel'].forEach((t) => el.stage.addEventListener(t, () => (dragging = false)));
  function move(e) {
    const r = el.stage.getBoundingClientRect();
    setSplit(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
  }

  // ---------- playback (the result plays with sound; the original follows it) ----------
  function master() { return state.result ? el.after : el.before; }
  el.play.addEventListener('click', () => {
    const m = master();
    if (m.paused) m.play(); else m.pause();
  });
  function syncFollower() {
    if (!state.result) return;
    if (Math.abs(el.before.currentTime - el.after.currentTime) > 0.08) el.before.currentTime = el.after.currentTime;
    if (el.after.paused !== el.before.paused) { if (el.after.paused) el.before.pause(); else el.before.play().catch(() => {}); }
  }
  for (const v of [el.before, el.after]) {
    v.addEventListener('timeupdate', () => {
      if (v !== master()) return;
      el.seek.value = v.duration ? (v.currentTime / v.duration) * 1000 : 0;
      el.time.textContent = `${fmtTime(v.currentTime)} / ${fmtTime(v.duration)}`;
      syncFollower();
    });
    v.addEventListener('play', () => { if (v === master()) { el.play.textContent = '❚❚'; syncFollower(); el.still.hidden = true; } });
    v.addEventListener('pause', () => { if (v === master()) { el.play.textContent = '▶'; syncFollower(); } });
  }
  el.seek.addEventListener('input', () => {
    const m = master();
    if (m.duration) m.currentTime = (el.seek.value / 1000) * m.duration;
    if (state.result) el.before.currentTime = m.currentTime;
    el.still.hidden = true;
  });

  // ---------- open a video ----------
  async function open(file) {
    reset();
    state.file = file;
    root.WMApp.show('video');
    el.name.textContent = file.name || 'video';
    el.fileName.value = (file.name || 'video').replace(/\.[^.]+$/, '');
    el.before.src = url(file);
    el.before.muted = false;
    setStatus(tr('video.analyzing'), 'muted');
    showWork(tr('video.analyzing'), tr('video.analyzingSub'), true);
    try {
      if (!root.WMVideo.supported()) throw new Error(tr('video.unsupported'));
      const a = await root.WMVideo.analyze(file, (p) => setProgress(p));
      state.analysis = a;
      const i = a.info;
      if (i.duration > 600) throw new Error(tr('video.tooLong'));
      el.info.textContent = [
        `${i.width} × ${i.height}`, fmtTime(i.duration), `${Math.round(i.fps)} fps`, i.audio ? tr('video.sound') : tr('video.noSound'),
      ].join(' · ');
      // still frame for painting / seeing the logo
      el.still.width = i.width; el.still.height = i.height;
      el.still.getContext('2d').drawImage(a.preview, 0, 0);
      el.still.hidden = false;
      el.paint.width = i.width; el.paint.height = i.height;
      el.stage.style.setProperty('--ar', i.width / i.height);
      if (a.logo) {
        Object.assign(el.spot.style, {
          left: ((a.logo.x - 6) / i.width) * 100 + '%', top: ((a.logo.y - 6) / i.height) * 100 + '%',
          width: ((a.logo.size + 12) / i.width) * 100 + '%', height: ((a.logo.size + 12) / i.height) * 100 + '%',
        });
        el.spot.hidden = false;
        setStatus(tr('video.found'), 'ok');
      } else {
        setStatus(tr('video.notFound'), 'warn');
      }
    } catch (e) {
      console.error(e);
      setStatus(e.message || tr('video.readFail'), 'warn');
    } finally {
      hideWork();
      refresh();
    }
  }

  function refresh() {
    const ready = !!state.analysis && !state.busy;
    const something = !!(state.analysis && (state.analysis.logo || state.painted));
    el.runBtn.disabled = !ready || !something;
    el.runHint.textContent = !state.analysis ? '' : something ? '' : tr('video.nothing');
    el.brushBtn.disabled = !ready;
    el.brushBtn.classList.toggle('on', state.brushing);
    el.brushBar.hidden = !state.brushing;
    el.stage.classList.toggle('brush', state.brushing);
    el.stage.classList.toggle('compared', !!state.result && !state.brushing);
    el.after.hidden = !state.result;
    el.divider.hidden = el.tagBefore.hidden = el.tagAfter.hidden = !state.result || state.brushing;
    el.save.hidden = !state.result;
    el.again.disabled = state.busy;
    el.hint.textContent = state.brushing ? tr('video.hintBrush') : state.result ? tr('video.hintCompare') : tr('video.hintStart');
  }

  // ---------- brush (fixed objects: logos, text, stamps) ----------
  el.brushBtn.addEventListener('click', () => {
    state.brushing = !state.brushing;
    if (state.brushing) {
      if (!master().paused) master().pause();
      el.still.hidden = false;
    }
    refresh();
  });
  el.brushClear.addEventListener('click', () => {
    el.paint.getContext('2d').clearRect(0, 0, el.paint.width, el.paint.height);
    state.painted = false;
    refresh();
  });
  let last = null;
  function brushPt(e) {
    const r = el.stage.getBoundingClientRect(), k = el.paint.width / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, rad: (+el.brushSize.value / 2) * k, sx: e.clientX - r.left, sy: e.clientY - r.top };
  }
  function paintTo(p) {
    const ctx = el.paint.getContext('2d');
    ctx.strokeStyle = ctx.fillStyle = '#ff2d55';
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.lineWidth = p.rad * 2;
    ctx.beginPath();
    if (last) { ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); } else { ctx.arc(p.x, p.y, p.rad, 0, Math.PI * 2); ctx.fill(); }
    last = p;
    if (!state.painted) { state.painted = true; refresh(); }
  }
  function cursor(p) {
    const s = +el.brushSize.value;
    Object.assign(el.cursor.style, { left: p.sx + 'px', top: p.sy + 'px', width: s + 'px', height: s + 'px' });
    el.cursor.hidden = false;
  }
  el.stage.addEventListener('pointerdown', (e) => {
    if (!state.brushing || state.busy) return;
    el.stage.setPointerCapture(e.pointerId);
    last = null;
    const p = brushPt(e); cursor(p); paintTo(p);
  });
  el.stage.addEventListener('pointermove', (e) => {
    if (!state.brushing) return;
    const p = brushPt(e); cursor(p);
    if (last) paintTo(p);
  });
  ['pointerup', 'pointercancel'].forEach((t) => el.stage.addEventListener(t, () => (last = null)));
  el.stage.addEventListener('pointerleave', () => (el.cursor.hidden = true));

  function paintMask() {
    if (!state.painted) return null;
    const W = el.paint.width, H = el.paint.height;
    const d = el.paint.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const m = new Uint8Array(W * H);
    let any = false;
    for (let i = 0; i < W * H; i++) if (d[i * 4 + 3] > 20) { m[i] = 1; any = true; }
    return any ? m : null;
  }

  // ---------- processing ----------
  function showWork(title, sub, spin) {
    el.overlay.hidden = false;
    el.wTitle.textContent = title; el.wSub.textContent = sub || '';
    el.pct.textContent = '';
    el.arc.style.strokeDashoffset = '';
    el.overlay.querySelector('.ring').classList.toggle('loading', !!spin);
    el.cancel.hidden = !state.aborter;
  }
  function setProgress(p) {
    el.overlay.querySelector('.ring').classList.remove('loading');
    el.pct.textContent = Math.round(p * 100) + '%';
    el.arc.style.strokeDashoffset = String(119.4 * (1 - p));
  }
  function hideWork() { el.overlay.hidden = true; }
  el.cancel.addEventListener('click', () => state.aborter && state.aborter.abort());

  el.runBtn.addEventListener('click', async () => {
    if (state.busy || !state.analysis) return;
    const paint = paintMask();
    state.busy = true;
    state.brushing = false;
    state.aborter = new AbortController();
    master().pause();
    refresh();
    showWork(tr('video.working'), paint ? tr('video.workingBrush') : tr('video.workingSub'), true);
    const t0 = performance.now();
    try {
      const res = await root.WMVideo.process(state.file, { logo: state.analysis.logo, paint, average: state.analysis.average, bitrate: state.analysis.info.bitrate }, (p) => {
        setProgress(p.progress);
        const el2 = (performance.now() - t0) / 1000, left = p.progress > 0.03 ? (el2 / p.progress) * (1 - p.progress) : null;
        el.wSub.textContent = left != null && left > 2 ? tr('time.left', { t: left < 60 ? Math.round(left) + 's' : Math.round(left / 60) + ' min' }) : tr('work.working');
      }, state.aborter.signal);
      state.result = res;
      el.after.src = url(res.blob);
      el.after.muted = false;
      el.before.muted = true;
      el.still.hidden = true;
      setSplit(50);
      el.fileExt.textContent = '.' + res.ext;
      el.dlInfo.textContent = `${res.ext.toUpperCase()} · ${fmtBytes(res.blob.size)}`;
      setStatus(tr(paint && state.analysis.logo ? 'video.doneBoth' : paint ? 'video.doneBrush' : 'video.done'), 'ok');
    } catch (e) {
      if (e && (e.name === 'ConversionCanceledError' || e.name === 'AbortError' || /cancel/i.test(e.message || ''))) setStatus(tr('video.cancelled'), 'warn');
      else { console.error(e); setStatus(tr('video.failed', { e: e.message || e }), 'warn'); }
    } finally {
      state.busy = false;
      state.aborter = null;
      hideWork();
      refresh();
    }
  });

  // ---------- save ----------
  el.dlBtn.addEventListener('click', () => {
    if (!state.result) return;
    const n = el.fileName.value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\.(mp4|webm|mov)$/i, '').trim() || 'video';
    const a = document.createElement('a');
    a.href = url(state.result.blob);
    a.download = `${n}.${state.result.ext}`;
    document.body.appendChild(a); a.click(); a.remove();
  });

  function reset() {
    if (state.aborter) state.aborter.abort();
    for (const v of [el.before, el.after]) { v.pause(); v.removeAttribute('src'); v.load(); }
    freeUrls();
    Object.assign(state, { file: null, analysis: null, result: null, brushing: false, painted: false, busy: false, aborter: null });
    el.spot.hidden = true;
    el.paint.getContext('2d').clearRect(0, 0, el.paint.width, el.paint.height);
    el.still.getContext('2d').clearRect(0, 0, el.still.width, el.still.height);
    el.seek.value = 0; el.time.textContent = '0:00'; el.play.textContent = '▶';
    el.info.textContent = '';
    setSplit(50);
    refresh();
  }
  el.again.addEventListener('click', () => { if (state.busy) return; reset(); root.WMApp.resetAll(); });

  root.WMVideoUI = { open, reset };
})(window);
