/* Unsparkle – UI. Algorithms live in core.js (WMCore), upscale.js (WMUpscale) and eraser.js (WMEraser). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const tr = (key, vars) => WMI18n.t(key, vars);
  const el = {
    landing: $('landing'), dropzone: $('dropzone'), fileInput: $('fileInput'), busy: $('busy'), busyMsg: $('busyMsg'),
    result: $('result'), status: $('status'), step2: $('step2'), step3: $('step3'),
    compare: $('compare'), before: $('beforeCanvas'), after: $('afterCanvas'), spot: $('spot'), tagAfter: $('tagAfter'),
    zoomCompare: $('zoomCompare'), zoomBefore: $('zoomBefore'), zoomAfter: $('zoomAfter'),
    capBefore: $('capBefore'), capAfter: $('capAfter'), zoomMode: $('zoomMode'),
    up2Btn: $('up2Btn'), up4kBtn: $('up4kBtn'), up2Size: $('up2Size'), up4kSize: $('up4kSize'), engine: $('engine'),
    upProgress: $('upProgress'), upBar: $('upBar'), upMsg: $('upMsg'),
    downloadBtn: $('downloadBtn'), dlInfo: $('dlInfo'), againBtn: $('againBtn'),
    tagBefore: $('tagBefore'), viewport: $('viewport'), viewHint: $('viewHint'),
    brushBtn: $('brushBtn'), cropBtn: $('cropBtn'), undoBtn: $('undoBtn'),
    brushBar: $('brushBar'), brushSize: $('brushSize'), brushClear: $('brushClear'), brushApply: $('brushApply'), brushDone: $('brushDone'),
    paint: $('paintCanvas'), brushCursor: $('brushCursor'),
    cropBar: $('cropBar'), cropBox: $('cropBox'), cropSize: $('cropSize'), cropApply: $('cropApply'), cropCancel: $('cropCancel'),
    batch: $('batch'), batchTitle: $('batchTitle'), batchSummary: $('batchSummary'), batchBar: $('batchBar'), batchBarFill: $('batchBarFill'),
    batchGrid: $('batchGrid'), zipBtn: $('zipBtn'), batchClear: $('batchClear'), backBtn: $('backBtn'),
    copyBtn: $('copyBtn'), dlSize: $('dlSize'), fileNameInput: $('fileName'), fileExt: $('fileExt'),
    saveBackBtn: $('saveBackBtn'), toast: $('toast'),
    bgRemoveBtn: $('bgRemoveBtn'), bgOptions: $('bgOptions'), bgColor: $('bgColor'), bgEngine: $('bgEngine'),
    sizePreset: $('sizePreset'), sizeLimit: $('sizeLimit'), fitRow: $('fitRow'),
    maskBar: $('maskBar'), maskHint: $('maskHint'), maskSize: $('maskSize'), maskDone: $('maskDone'),
  };
  const FOUR_K = 3840;
  // Phones and low-memory devices get smaller limits so the tab doesn't crash.
  const LOW_MEMORY = (navigator.deviceMemory && navigator.deviceMemory <= 4) || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const MAX_OUTPUT_PIXELS = LOW_MEMORY ? 12e6 : 48e6;
  const ZOOM_PX = 480; // close-up canvas resolution

  const state = {
    fileName: 'image', type: 'image/png', busy: false,
    original: null,   // canvas: as uploaded
    clean: null,      // canvas: watermark removed, original size
    big: null,        // canvas: upscaled result
    removed: false, logos: [],
    spot: null,       // close-up square in original pixels { x, y, s }
    choice: null,     // 'two' | 'fourK'
    mode: 'compare',  // 'compare' | 'brush' | 'crop'
    zoom: 1,
    history: [],      // undo stack of { original, clean, big, choice, edited }
    edited: false,    // erased or cropped something
    painted: false,
    format: 'image/png', formatChosen: false,
    upModel: 'photo', // 'photo' | 'art'
    bg: null,         // { source, mask, kind, color } after "Remove background"
    fit: 'fill',      // social size: 'fill' (crop) | 'fit' (whole image)
  };

  // ---------- helpers ----------

  function show(view) {
    el.landing.hidden = view !== 'landing';
    el.batch.hidden = view !== 'batch';
    el.busy.hidden = view !== 'busy';
    el.result.hidden = view !== 'result';
    $('videoView').hidden = view !== 'video';
  }
  window.WMApp = { show: (v) => show(v), resetAll: () => resetAll(), toast: (t) => showToast(t) };

  function canvasFrom(imgData) {
    const cv = document.createElement('canvas');
    cv.width = imgData.width; cv.height = imgData.height;
    cv.getContext('2d').putImageData(imgData, 0, 0);
    return cv;
  }

  function copyInto(dst, src) {
    dst.width = src.width; dst.height = src.height;
    dst.getContext('2d').drawImage(src, 0, 0);
  }

  async function fileToImageData(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, cv.width, cv.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function toImageData(o) {
    return o instanceof ImageData ? o : new ImageData(new Uint8ClampedArray(o.data.buffer), o.width, o.height);
  }

  function setStatus(text, kind) {
    el.status.textContent = text;
    el.status.className = 'status ' + (kind || 'ok');
  }

  // ---------- compare sliders ----------

  // Before/after slider.
  //   opts.onPick(fx, fy)  a click (no drag) at that position (fractions of the image)
  //   opts.onPan(dx, dy)   if set, dragging away from the round handle pans instead of
  //                        moving the divider (dx, dy as fractions of the box)
  //   opts.enabled()       return false to ignore the pointer (e.g. while painting)
  function makeCompare(box, opts) {
    opts = opts || {};
    const after = box.querySelector('.after'), divider = box.querySelector('.divider');
    const before = box.querySelector('canvas:not(.after)');
    const HANDLE = 28; // px around the divider that grab the slider
    let down = null, pct = 50;
    const set = (v) => {
      pct = v;
      after.style.clipPath = `inset(0 0 0 ${v}%)`;
      // cut the "before" image at the divider too, so it never shows through
      // transparent parts of the result (e.g. after removing the background)
      if (before) before.style.clipPath = `inset(0 ${100 - v}% 0 0)`;
      divider.style.left = v + '%';
    };
    const slideTo = (e) => {
      const r = box.getBoundingClientRect();
      set(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
    };
    const nearHandle = (e) => {
      const r = box.getBoundingClientRect();
      return Math.abs(e.clientX - (r.left + (pct / 100) * r.width)) <= HANDLE;
    };
    box.addEventListener('pointerdown', (e) => {
      if (opts.enabled && !opts.enabled()) return;
      const mode = opts.onPan && !nearHandle(e) ? 'pan' : 'slide';
      down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, mode };
      box.setPointerCapture(e.pointerId);
      if (mode === 'pan') box.classList.add('panning');
    });
    box.addEventListener('pointermove', (e) => {
      if (!down) {
        if (opts.onPan) box.style.cursor = nearHandle(e) ? 'ew-resize' : '';
        return;
      }
      if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
      if (!down.moved) return;
      if (down.mode === 'slide') slideTo(e);
      else {
        const r = box.getBoundingClientRect();
        opts.onPan((e.clientX - down.lx) / r.width, (e.clientY - down.ly) / r.height);
      }
      down.lx = e.clientX; down.ly = e.clientY;
    });
    const end = (e) => {
      if (down && !down.moved && e.type === 'pointerup') {
        if (opts.onPick) {
          const r = box.getBoundingClientRect();
          opts.onPick((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        } else if (down.mode === 'slide') slideTo(e);
      }
      down = null;
      box.classList.remove('panning');
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    return { set };
  }

  const mainCompare = makeCompare(el.compare, {
    // a click jumps the close-up square there
    onPick: (fx, fy) => {
      if (!state.clean) return;
      state.userSpot = true;
      const s = state.spot ? state.spot.s : 128;
      setSpot(fx * state.clean.width - s / 2, fy * state.clean.height - s / 2, s);
    },
    enabled: () => state.mode === 'compare' && !state.busy,
  });
  // in the close-up, dragging pans around; the round handle still compares
  const zoomCompare = makeCompare(el.zoomCompare, {
    onPan: (dx, dy) => {
      if (!state.spot) return;
      state.userSpot = true;
      const { x, y, s } = state.spot;
      setSpot(x - dx * s, y - dy * s, s);
    },
    enabled: () => !!state.spot,
  });

  // drag the square on the big image to move the close-up
  let spotDrag = null;
  el.spot.addEventListener('pointerdown', (e) => {
    if (state.mode !== 'compare' || state.busy || !state.spot) return;
    e.stopPropagation(); // don't move the big slider
    el.spot.setPointerCapture(e.pointerId);
    spotDrag = { x: e.clientX, y: e.clientY, start: Object.assign({}, state.spot) };
  });
  el.spot.addEventListener('pointermove', (e) => {
    if (!spotDrag) return;
    const k = state.clean.width / el.compare.getBoundingClientRect().width;
    const st = spotDrag.start;
    state.userSpot = true;
    setSpot(st.x + (e.clientX - spotDrag.x) * k, st.y + (e.clientY - spotDrag.y) * k, st.s);
  });
  ['pointerup', 'pointercancel'].forEach((t) => el.spot.addEventListener(t, () => (spotDrag = null)));

  // zoom the close-up: mouse wheel or the −/+ buttons (keeps the centre)
  function zoomSpot(factor) {
    if (!state.spot) return;
    const { x, y, s } = state.spot;
    const ns = Math.max(24, Math.min(s * factor, state.clean.width, state.clean.height));
    state.userSpot = true;
    setSpot(x + s / 2 - ns / 2, y + s / 2 - ns / 2, ns);
  }
  el.zoomCompare.addEventListener('wheel', (e) => {
    if (!state.spot) return;
    e.preventDefault();
    zoomSpot(e.deltaY > 0 ? 1.2 : 1 / 1.2);
  }, { passive: false });
  $('zoomOut').addEventListener('click', () => zoomSpot(1.5));
  $('zoomIn').addEventListener('click', () => zoomSpot(1 / 1.5));

  // ---------- close-up ----------

  function setSpot(x, y, s) {
    const W = state.clean.width, H = state.clean.height;
    s = Math.round(Math.max(24, Math.min(s, W, H)));
    state.spot = {
      s,
      x: Math.round(Math.max(0, Math.min(W - s, x))),
      y: Math.round(Math.max(0, Math.min(H - s, y))),
    };
    renderZoom();
  }

  function drawCrop(cv, src, x, y, s, smooth) {
    cv.width = ZOOM_PX; cv.height = ZOOM_PX;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = smooth;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, x, y, s, s, 0, 0, ZOOM_PX, ZOOM_PX);
  }

  function renderZoom() {
    const { x, y, s } = state.spot;
    const W = state.clean.width, H = state.clean.height;
    Object.assign(el.spot.style, {
      left: (x / W) * 100 + '%', top: (y / H) * 100 + '%', width: (s / W) * 100 + '%', height: (s / H) * 100 + '%',
    });
    el.spot.hidden = false;

    if (state.big) {
      // plain enlargement of the clean image vs the AI result
      const k = state.big.width / W;
      drawCrop(el.zoomBefore, state.clean, x, y, s, true);
      drawCrop(el.zoomAfter, state.big, x * k, y * k, s * k, true);
      el.zoomCompare.classList.add('smooth');
      el.capBefore.textContent = tr('tag.normal');
      el.capAfter.textContent = tr('tag.ai');
      el.zoomMode.textContent = tr('zoom.quality');
    } else {
      drawCrop(el.zoomBefore, state.original, x, y, s, false);
      drawCrop(el.zoomAfter, state.clean, x, y, s, false);
      el.zoomCompare.classList.remove('smooth');
      el.capBefore.textContent = tr('tag.before');
      el.capAfter.textContent = tr('tag.after');
      el.zoomMode.textContent = tr('zoom.inspect');
    }
  }

  // The s×s square with the most fine detail (sum of gradients), searched on a
  // small copy of the image so it's instant.
  function detailedSpot(src, s) {
    s = Math.min(s, src.width, src.height);
    const k = Math.min(1, 256 / Math.max(src.width, src.height));
    const w = Math.max(2, Math.round(src.width * k)), h = Math.max(2, Math.round(src.height * k));
    const small = document.createElement('canvas');
    small.width = w; small.height = h;
    const ctx = small.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const L = (x, y) => { const j = (y * w + x) * 4; return d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114; };
    const ss = Math.max(2, Math.round(s * k));
    let best = { v: -1, x: 0, y: 0 };
    const step = Math.max(1, ss >> 2);
    for (let y = 0; y + ss < h; y += step) {
      for (let x = 0; x + ss < w; x += step) {
        let v = 0;
        for (let yy = y; yy < y + ss; yy++) for (let xx = x; xx < x + ss; xx++) v += Math.abs(L(xx + 1, yy) - L(xx, yy)) + Math.abs(L(xx, yy + 1) - L(xx, yy));
        if (v > best.v) best = { v, x, y };
      }
    }
    return { x: best.x / k, y: best.y / k, s };
  }

  // ---------- status & buttons ----------

  function refresh() {
    const W = state.clean.width, H = state.clean.height, long = Math.max(W, H);
    const k4 = FOUR_K / long;
    const t2 = targetSize('two'), t4 = targetSize('fourK');
    el.up2Size.textContent = t2.scale > 1.05 ? `${t2.width} × ${t2.height}` : tr('up.tooLarge');
    el.up4kSize.textContent = k4 <= 1.05 ? tr('up.already4k') : t4.scale > 1.05 ? `${t4.width} × ${t4.height}` : tr('up.tooLarge');
    el.up2Btn.disabled = state.busy || t2.scale <= 1.05;
    el.up4kBtn.disabled = state.busy || k4 <= 1.05 || t4.scale <= 1.05;
    el.up2Btn.classList.toggle('active', !!state.big && state.choice === 'two');
    el.up4kBtn.classList.toggle('active', !!state.big && state.choice === 'fourK');
    el.againBtn.disabled = state.busy;

    const out = state.big || state.clean;
    el.dlInfo.textContent = `${out.width} × ${out.height} · ${extOf(state.format).toUpperCase()}`;
    el.backBtn.disabled = state.busy;
    el.saveBackBtn.hidden = !(items.length > 1 && isDirty());
    el.bgRemoveBtn.disabled = state.busy;
    el.bgOptions.hidden = !state.bg;
    document.querySelectorAll('[data-bg]').forEach((b) => b.classList.toggle('active', !!state.bg && state.bg.kind === b.dataset.bg));
    el.bgColor.parentElement.classList.toggle('active', !!state.bg && state.bg.kind === 'color');
    el.saveBackBtn.disabled = state.busy;
    el.step2.classList.toggle('done', !!state.big);
    el.step3.classList.toggle('done', false);
    el.undoBtn.disabled = state.busy || !state.history.length;
    el.brushBtn.disabled = el.cropBtn.disabled = state.busy;
    el.brushApply.disabled = state.busy || !state.painted;

    const parts = [];
    if (state.removed) parts.push(state.logos.length > 1 ? tr('status.removedMany', { n: state.logos.length }) : tr('status.removed'));
    if (state.bg) parts.push(tr('status.bg'));
    else if (state.edited) parts.push(tr('status.edited'));
    if (state.big) parts.push(tr('status.upscaled', { w: state.big.width, h: state.big.height }));
    if (parts.length) setStatus(parts.join('   ·   '), 'ok');
    else setStatus(tr('status.none'), 'warn');
  }

  // ---------- images: one or many ----------

  // Every uploaded file becomes an item. One item opens straight in the editor;
  // several show the batch grid. Results are kept as PNG blobs (lossless) so many
  // images don't eat all the memory.
  const items = [];
  let current = null; // item open in the editor
  let nextItemId = 1;
  let queueRunning = false;

  function canvasToBlob(cv, type, quality) {
    return new Promise((resolve) => cv.toBlob(resolve, type || 'image/png', quality == null ? 0.92 : quality));
  }

  async function blobToCanvas(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      cv.getContext('2d').drawImage(img, 0, 0);
      return cv;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function makeThumb(src) {
    const k = Math.min(1, 360 / Math.max(src.width, src.height));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(src.width * k)); cv.height = Math.max(1, Math.round(src.height * k));
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, cv.width, cv.height);
    cv.className = 'thumb';
    return cv;
  }

  async function handleFiles(list) {
    const all = [...list].filter(Boolean);
    const videos = all.filter((f) => f.type && f.type.startsWith('video/'));
    // a single video opens the video screen
    if (videos.length && !state.busy && items.length === 0 && all.length === 1) {
      const verdict = await WMGuard.check(videos[0]);
      if (!verdict.ok) {
        $('blockedMsg').textContent = tr(verdict.where === 'name' ? 'blocked.byName' : 'blocked.byMeta', { agency: verdict.agency });
        $('blocked').hidden = false;
        return;
      }
      $('blocked').hidden = true;
      return WMVideoUI.open(videos[0]);
    }
    if (videos.length) setTimeout(() => showToast(tr('video.onlyOne')), 300);
    const files = all.filter((f) => f.type && f.type.startsWith('image/'));
    if (!files.length || state.busy) return;
    const startedEmpty = items.length === 0;
    const added = [];
    for (const file of files) {
      const verdict = await WMGuard.check(file);
      const item = {
        id: nextItemId++, file, name: (file.name || 'image').replace(/\.[^.]+$/, ''),
        type: file.type === 'image/jpeg' ? 'image/jpeg' : file.type === 'image/webp' ? 'image/webp' : 'image/png',
        status: verdict.ok ? 'queued' : 'blocked', logos: [], clean: null, saved: null, thumb: null,
        agency: verdict.agency, where: verdict.where,
      };
      items.push(item);
      added.push(item);
    }

    // a single stock image on its own: show the explanation on the start page
    if (startedEmpty && added.length === 1 && added[0].status === 'blocked') {
      $('blockedMsg').textContent = tr(added[0].where === 'name' ? 'blocked.byName' : 'blocked.byMeta', { agency: added[0].agency });
      $('blocked').hidden = false;
      items.length = 0;
      return;
    }
    $('blocked').hidden = true;

    if (startedEmpty && added.length === 1) {
      el.busyMsg.textContent = tr('busy.find');
      show('busy');
      await processItem(added[0]);
      if (added[0].status === 'error') { items.length = 0; show('landing'); return alert(tr('read.failed')); }
      return openEditor(added[0]);
    }
    showBatch();
    runQueue();
  }

  async function processItem(item) {
    item.status = 'working';
    renderBatch();
    try {
      const original = await fileToImageData(item.file);
      const res = await WMWork.process(original);
      item.logos = res.logos;
      item.status = res.found ? 'done' : 'none';
      item.cleanData = res.image; // kept only until the editor or thumbnail uses it
      const cleanCv = canvasFrom(res.image);
      item.thumb = makeThumb(cleanCv);
      item.clean = await canvasToBlob(cleanCv, 'image/png');
      item.size = { width: res.image.width, height: res.image.height };
      cleanCv.width = cleanCv.height = 0;
    } catch (e) {
      console.error(e);
      item.status = 'error';
      item.failed = true;
    }
    renderBatch();
  }

  async function runQueue() {
    if (queueRunning) return;
    queueRunning = true;
    let item;
    while ((item = items.find((i) => i.status === 'queued'))) {
      await processItem(item);
      item.cleanData = null;
    }
    queueRunning = false;
    renderBatch();
  }

  // ---------- batch view ----------

  function showBatch() {
    show('batch');
    renderBatch();
  }

  function statusBadge(item) {
    switch (item.status) {
      case 'queued': return [tr('badge.queued'), ''];
      case 'working': return [tr('badge.working'), 'work'];
      case 'done': return [item.logos.length > 1 ? tr('badge.doneMany', { n: item.logos.length }) : tr('badge.done'), 'ok'];
      case 'none': return [tr('badge.none'), 'warn'];
      case 'blocked': return ['⛔ ' + tr(item.where === 'name' ? 'blocked.byName' : 'blocked.byMeta', { agency: item.agency }), 'bad'];
      default: return ['⚠ ' + tr('read.failed'), 'bad'];
    }
  }

  function renderBatch() {
    if (el.batch.hidden) return;
    const total = items.length, ready = items.filter((i) => i.clean).length;
    const counts = {
      done: items.filter((i) => i.status === 'done').length, none: items.filter((i) => i.status === 'none').length,
      blocked: items.filter((i) => i.status === 'blocked').length, left: items.filter((i) => i.status === 'queued' || i.status === 'working').length,
    };
    el.batchTitle.textContent = total === 1 ? tr('batch.image') : tr('batch.images', { n: total });
    el.batchSummary.textContent = [
      counts.done && tr('batch.cleaned', { n: counts.done }), counts.none && tr('batch.none', { n: counts.none }),
      counts.blocked && tr('batch.refused', { n: counts.blocked }), counts.left && tr('batch.left', { n: counts.left }),
    ].filter(Boolean).join(' · ');
    el.batchBar.hidden = !counts.left;
    el.batchBarFill.style.width = total ? ((total - counts.left) / total) * 100 + '%' : '0%';
    el.zipBtn.disabled = !ready || !!counts.left;

    el.batchGrid.textContent = '';
    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'card';
      card.tabIndex = 0;
      if (item.thumb) card.appendChild(item.thumb);
      else {
        const ph = document.createElement('div');
        ph.className = 'thumb';
        card.appendChild(ph);
      }
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = item.file.name || item.name;
      const [text, kind] = statusBadge(item);
      const badge = document.createElement('span');
      badge.className = 'badge ' + kind;
      badge.textContent = text;
      if (item.saved) {
        card.classList.add('edited');
        const tag = document.createElement('span');
        tag.className = 'edited-tag';
        const star = document.createElement('i');
        star.textContent = '✦';
        tag.append(star, tr('badge.editedTag'));
        card.appendChild(tag);
      }
      if (item.id === flashId) card.classList.add('flash');
      const x = document.createElement('button');
      x.className = 'x';
      x.title = tr('badge.remove');
      x.textContent = '✕';
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        items.splice(items.indexOf(item), 1);
        if (!items.length) return resetAll();
        renderBatch();
      });
      card.append(name, badge, x);
      if (item.clean) {
        const open = () => openEditor(item);
        card.addEventListener('click', open);
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
      }
      el.batchGrid.appendChild(card);
      if (item.id === flashId) requestAnimationFrame(() => card.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    }
    flashId = null;
  }

  let flashId = null, toastTimer = null;
  function showToast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.toast.hidden = true), 3500);
  }

  el.zipBtn.addEventListener('click', async () => {
    const ready = items.filter((i) => i.clean);
    if (!ready.length) return;
    el.zipBtn.disabled = true;
    const label = el.zipBtn.textContent;
    try {
      const files = [];
      for (let k = 0; k < ready.length; k++) {
        el.zipBtn.textContent = tr('batch.preparing', { k: k + 1, n: ready.length });
        const item = ready[k];
        const src = item.saved ? item.saved.big || item.saved.clean : item.clean;
        // same size preset, format and size limit as the editor
        const cv = await blobToCanvas(src);
        const { blob } = await exportBlob(cv);
        cv.width = cv.height = 0;
        files.push({ name: `${item.outName || item.name}.${extOf(blob.type)}`, blob });
      }
      el.zipBtn.textContent = tr('batch.zipping');
      saveBlob(await WMZip.zip(files), `unsparkle-${files.length}-images.zip`);
    } finally {
      el.zipBtn.textContent = label;
      el.zipBtn.disabled = false;
    }
  });
  el.batchClear.addEventListener('click', resetAll);

  // ---------- editor ----------

  async function openEditor(item) {
    if (state.busy) return;
    current = item;
    el.busyMsg.textContent = tr('busy.open');
    show('busy');
    clearImages();
    const sv = item.saved;
    const original = sv && sv.original ? await blobToCanvas(sv.original) : canvasFrom(await fileToImageData(item.file));
    state.original = original;
    state.clean = item.cleanData ? canvasFrom(item.cleanData) : await blobToCanvas(sv ? sv.clean : item.clean);
    state.big = sv && sv.big ? await blobToCanvas(sv.big) : null;
    item.cleanData = null;
    state.fileName = item.outName || item.name;
    el.fileNameInput.value = state.fileName;
    state.type = item.type;
    if (!state.formatChosen) state.format = item.type;
    state.choice = sv ? sv.choice : null;
    state.bigModel = sv ? sv.bigModel : null;
    state.removed = item.status === 'done';
    state.logos = item.logos;
    state.userSpot = false;
    state.edited = !!(sv && sv.edited);
    setMode('compare');
    renderMain();
    el.upProgress.hidden = true;

    if (state.logos.length && !state.edited) {
      const ls = state.logos;
      const x0 = Math.min(...ls.map((l) => l.x)), y0 = Math.min(...ls.map((l) => l.y));
      const x1 = Math.max(...ls.map((l) => l.x + l.size)), y1 = Math.max(...ls.map((l) => l.y + l.size));
      const s = Math.max(x1 - x0, y1 - y0) * 1.8 + 24;
      setSpot((x0 + x1) / 2 - s / 2, (y0 + y1) / 2 - s / 2, s);
    } else {
      const d = detailedSpot(state.clean, 96);
      setSpot(d.x, d.y, d.s);
    }
    el.backBtn.hidden = items.length < 2;
    $('backLabel').textContent = tr('back', { n: items.length });
    markSaved();
    refresh();
    show('result');
    highlightFocus();
  }

  // Visitors from a tool page (e.g. /background-remover/) see that tool highlighted once.
  let focusShown = false;
  function highlightFocus() {
    const f = document.body.dataset.focus;
    if (!f || focusShown) return;
    const target = { bg: el.bgRemoveBtn, upscale: el.up2Btn, erase: el.brushBtn, save: el.sizePreset }[f];
    const panel = target && (f === 'erase' ? target : target.closest('.panel'));
    if (!panel) return;
    focusShown = true;
    setTimeout(() => {
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      panel.classList.add('focus-glow');
      setTimeout(() => panel.classList.remove('focus-glow'), 4500);
    }, 400);
  }

  // Unsaved changes = the editor's images differ from what was opened or last saved.
  let savedRefs = null;
  function markSaved() {
    savedRefs = { original: state.original, clean: state.clean, big: state.big };
  }
  function isDirty() {
    return !!(current && savedRefs && state.clean &&
      (state.original !== savedRefs.original || state.clean !== savedRefs.clean || state.big !== savedRefs.big));
  }

  // Keep the editor's work on the item (for the ZIP and when reopening it).
  async function saveCurrent() {
    if (!current || !state.clean) return;
    markSaved();
    if (!(state.edited || state.big)) { // undone back to the plain clean result
      current.saved = null;
      current.thumb = makeThumb(state.clean);
      return;
    }
    const cropped = state.original.width !== current.size.width || state.original.height !== current.size.height;
    current.saved = {
      edited: state.edited,
      choice: state.choice,
      bigModel: state.bigModel,
      original: cropped ? await canvasToBlob(state.original, 'image/png') : null,
      clean: await canvasToBlob(state.clean, 'image/png'),
      big: state.big ? await canvasToBlob(state.big, 'image/png') : null,
    };
    current.thumb = makeThumb(state.big || state.clean);
  }

  function backToBatch() {
    clearImages();
    current = null;
    savedRefs = null;
    showBatch();
  }

  async function saveAndBack() {
    if (state.busy || !current) return;
    const item = current;
    await saveCurrent();
    flashId = item.id;
    backToBatch();
    showToast(tr('toast.saved', { name: item.file.name || item.name }));
  }
  el.saveBackBtn.addEventListener('click', saveAndBack);

  // leaving with unsaved changes asks first
  const leaveDialog = $('leaveDialog');
  el.backBtn.addEventListener('click', () => {
    if (state.busy) return;
    if (isDirty()) return leaveDialog.showModal();
    backToBatch();
  });
  $('leaveStay').addEventListener('click', () => leaveDialog.close());
  $('leaveDiscard').addEventListener('click', () => { leaveDialog.close(); backToBatch(); });
  $('leaveSave').addEventListener('click', () => { leaveDialog.close(); saveAndBack(); });

  function resetAll() {
    clearImages();
    items.length = 0;
    current = null;
    $('blocked').hidden = true;
    show('landing');
  }

  // ---------- saving ----------

  function extOf(type) {
    return type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
  }

  function saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function formatBytes(n) {
    return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  // file size for the chosen format, computed in the background
  let sizeJob = 0;
  // ---------- export: social size, fit/fill, file-size limit ----------

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // Resize to the chosen social-media size (or keep the original).
  function exportCanvas(src) {
    const preset = el.sizePreset.value;
    if (preset === 'original') return src;
    const [tw, th] = preset.split('x').map(Number);
    const c = makeCanvas(tw, th), ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    const sr = src.width / src.height, tr2 = tw / th;
    if (state.fit === 'fill') {
      // crop the middle to the target shape
      let sw = src.width, sh = src.height, sx = 0, sy = 0;
      if (sr > tr2) { sw = Math.round(src.height * tr2); sx = Math.round((src.width - sw) / 2); }
      else { sh = Math.round(src.width / tr2); sy = Math.round((src.height - sh) / 2); }
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, tw, th);
    } else {
      // whole image; a soft blurred copy fills the empty bars (kept clear for transparent cut-outs)
      if (!(state.bg && state.bg.kind === 'transparent')) {
        const k = Math.max(tw / src.width, th / src.height) * 1.1;
        ctx.filter = `blur(${Math.round(Math.max(tw, th) / 40)}px) brightness(0.9)`;
        ctx.drawImage(src, (tw - src.width * k) / 2, (th - src.height * k) / 2, src.width * k, src.height * k);
        ctx.filter = 'none';
      }
      const k = Math.min(tw / src.width, th / src.height), w = src.width * k, h = src.height * k;
      ctx.drawImage(src, (tw - w) / 2, (th - h) / 2, w, h);
    }
    return c;
  }

  // JPEG has no transparency: put a white background behind it.
  function flatten(src) {
    const c = makeCanvas(src.width, src.height), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(src, 0, 0);
    return c;
  }

  function scaled(src, k) {
    const c = makeCanvas(Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  // Encode, lowering quality (then size) only as much as needed to fit the limit.
  async function encodeLimited(cv, type, limit) {
    const src = type === 'image/jpeg' ? flatten(cv) : cv;
    const first = await canvasToBlob(src, type, 0.92);
    if (!limit || !first || first.size <= limit) return { blob: first, canvas: src };
    let cur = src, k = 1;
    for (let round = 0; round < 10; round++) {
      if (first.type !== 'image/png') {
        let lo = 0.35, hi = 0.92, best = null;
        for (let i = 0; i < 6; i++) {
          const q = (lo + hi) / 2, b = await canvasToBlob(cur, type, q);
          if (b.size <= limit) { best = b; lo = q; } else hi = q;
        }
        if (best) return { blob: best, canvas: cur };
      } else {
        const b = await canvasToBlob(cur, type);
        if (b.size <= limit) return { blob: b, canvas: cur, shrunk: true };
      }
      k *= 0.85;
      cur = scaled(src, k);
    }
    return { blob: await canvasToBlob(cur, type, 0.4), canvas: cur };
  }

  async function exportBlob(src) {
    return encodeLimited(exportCanvas(src), state.format, +el.sizeLimit.value);
  }

  async function updateSaveInfo() {
    const out = state.big || state.clean;
    if (!out) return;
    document.querySelectorAll('[data-format]').forEach((b) => b.classList.toggle('active', b.dataset.format === state.format));
    document.querySelectorAll('[data-fit]').forEach((b) => b.classList.toggle('active', b.dataset.fit === state.fit));
    el.fitRow.hidden = el.sizePreset.value === 'original';
    el.fileExt.textContent = '.' + extOf(state.format);
    const job = ++sizeJob;
    el.dlSize.textContent = tr('save.preparing');
    await new Promise((r) => setTimeout(r, 200));
    if (job !== sizeJob) return;
    const res = await exportBlob(out);
    if (job !== sizeJob || !res.blob) return;
    el.dlInfo.textContent = `${res.canvas.width} × ${res.canvas.height} · ${extOf(res.blob.type).toUpperCase()}`;
    el.dlSize.textContent = '≈ ' + formatBytes(res.blob.size);
    // PNG can only get smaller by shrinking; WebP keeps transparency and more detail
    if (res.shrunk) showToast(tr('save.webpTip'));
  }

  [el.sizePreset, el.sizeLimit].forEach((c) => c.addEventListener('change', updateSaveInfo));
  document.querySelectorAll('[data-fit]').forEach((b) => b.addEventListener('click', () => { state.fit = b.dataset.fit; updateSaveInfo(); }));

  // ---------- background removal ----------

  function applyBg() {
    state.clean = WMBackground.compose(state.bg.source, state.bg.mask, state.bg.kind, state.bg.color);
    state.big = null;
    state.choice = null;
    state.edited = true;
    renderMain();
    refresh();
  }

  el.bgRemoveBtn.addEventListener('click', async () => {
    if (state.busy || !state.clean) return;
    if (!WMBackground.available()) return setStatus(tr('bg.needWeb'), 'warn');
    setMode('compare');
    state.busy = true;
    refresh();
    showWorking(tr('bg.title'), tr('bg.finding'));
    try {
      const source = state.bg ? state.bg.source : state.clean; // "again" starts from the image with its background
      const mask = await WMBackground.mask(source, (st) => {
        if (st.download != null) {
          const pct = Math.round(st.download * 100);
          ov.ring.classList.remove('loading');
          ov.pct.textContent = pct + '%';
          ov.arc.style.strokeDashoffset = String(119.4 * (1 - st.download));
          ov.sub.textContent = tr('bg.downloading', { p: pct });
        } else if (st.message) {
          ov.ring.classList.add('loading');
          ov.pct.textContent = '';
          ov.sub.textContent = tr('bg.finding');
          el.bgEngine.textContent = st.message === 'gpu' ? '⚡ GPU' : 'CPU';
        }
      });
      pushHistory();
      state.bg = { source, mask, kind: 'transparent', color: el.bgColor.value };
      if (state.format === 'image/jpeg') { state.format = 'image/png'; showToast(tr('bg.pngNote')); }
      applyBg();
    } catch (e) {
      console.error(e);
      setStatus(tr('bg.failed', { e: e.message }), 'warn');
      showToast(tr('bg.failed', { e: e.message }));
    } finally {
      hideWorking();
      state.busy = false;
      refresh();
    }
  });
  document.querySelectorAll('[data-bg]').forEach((b) => b.addEventListener('click', () => {
    if (!state.bg || state.busy) return;
    state.bg.kind = b.dataset.bg;
    applyBg();
  }));
  el.bgColor.addEventListener('input', () => {
    if (!state.bg || state.busy) return;
    state.bg.kind = 'color';
    state.bg.color = el.bgColor.value;
    applyBg();
  });

  function cleanFileName(name) {
    // drop characters Windows/macOS don't allow and a typed extension
    const n = String(name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\.(png|jpe?g|webp)$/i, '').trim().replace(/^\.+/, '');
    return n.slice(0, 120);
  }
  el.fileNameInput.addEventListener('input', () => {
    const n = cleanFileName(el.fileNameInput.value);
    state.fileName = n || (current ? current.name : 'image');
    if (current) current.outName = n && n !== current.name ? n : null;
  });
  el.fileNameInput.addEventListener('blur', () => { el.fileNameInput.value = state.fileName; });
  el.fileNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.fileNameInput.blur(); });

  document.querySelectorAll('[data-format]').forEach((b) => b.addEventListener('click', () => {
    state.format = b.dataset.format;
    state.formatChosen = true;
    updateSaveInfo();
  }));

  el.downloadBtn.addEventListener('click', async () => {
    const out = state.big || state.clean;
    if (!out) return;
    const { blob } = await exportBlob(out);
    saveBlob(blob, `${state.fileName}.${extOf(blob.type)}`);
    el.step3.classList.add('done');
  });

  // copy needs a secure page (https); hidden when opened from disk
  if (window.isSecureContext && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
    el.copyBtn.hidden = false;
    el.copyBtn.addEventListener('click', async () => {
      const out = state.big || state.clean;
      if (!out) return;
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasToBlob(out, 'image/png') })]);
        el.copyBtn.textContent = tr('save.copied');
      } catch (e) {
        el.copyBtn.textContent = tr('save.copyFail');
      }
      setTimeout(() => (el.copyBtn.textContent = tr('save.copy')), 1800);
    });
  }

  // ---------- upscaling ----------

  function targetSize(choice) {
    const W = state.clean.width, H = state.clean.height;
    const wanted = choice === 'two' ? 2 : FOUR_K / Math.max(W, H);
    const scale = Math.min(wanted, Math.sqrt(MAX_OUTPUT_PIXELS / (W * H)));
    return { scale, width: Math.round(W * scale), height: Math.round(H * scale), limited: scale < wanted - 1e-6 };
  }

  function friendlyTime(sec) {
    if (sec < 20) return tr('time.few');
    if (sec < 50) return tr('time.underMin');
    if (sec < 90) return tr('time.oneMin');
    return tr('time.mins', { n: Math.round(sec / 60) });
  }

  // Step 1: explain what will happen and how long it may take, then ask.
  const upConfirm = $('upConfirm');
  function askUpscale(choice) {
    if (state.busy || !state.clean) return;
    const t = targetSize(choice);
    const est = WMUpscale.estimate(state.clean.width, state.clean.height);
    $('ucTitle').textContent = choice === 'two' ? tr('confirm.title2') : tr('confirm.title4');
    $('ucModel').textContent = tr('confirm.model', {
      icon: state.upModel === 'art' ? '🎨' : '📷',
      name: tr(state.upModel === 'art' ? 'model.artName' : 'model.photoName'),
    });
    $('ucSize').textContent = `${t.width} × ${t.height}`;
    const from = document.createElement('small');
    from.textContent = tr('confirm.from', { w: state.clean.width, h: state.clean.height });
    $('ucSize').appendChild(from);
    $('ucTime').textContent = est.measured
      ? tr('confirm.timeMeasured', { t: friendlyTime(est.seconds) })
      : navigator.gpu
        ? tr('confirm.timeGpu', { t: friendlyTime(est.seconds), slow: friendlyTime(est.slowest) })
        : tr('confirm.timeCpu', { t: friendlyTime(est.slowest) });
    $('ucLimit').hidden = !t.limited;
    upConfirm.dataset.choice = choice;
    upConfirm.showModal();
  }
  $('ucCancel').addEventListener('click', () => upConfirm.close());
  $('ucStart').addEventListener('click', () => {
    upConfirm.close();
    runUpscale(upConfirm.dataset.choice);
  });

  // Step 2: run it, showing the image sharpen tile by tile.
  const ov = {
    box: $('upOverlay'), cursor: $('tileCursor'), arc: $('ringArc'), ring: document.querySelector('.ring'),
    pct: $('upPct'), title: $('upTitle'), sub: $('upSub'),
  };
  let aborter = null;
  $('upCancel').addEventListener('click', () => aborter && aborter.abort());

  async function runUpscale(choice) {
    if (state.busy || !state.clean) return;
    setMode('compare');
    const t = targetSize(choice);
    const prev = { big: state.big, choice: state.choice };
    state.busy = true;
    state.choice = choice;
    aborter = new AbortController();
    refresh();
    el.upProgress.hidden = true;

    ov.box.hidden = false;
    ov.ring.classList.add('loading');
    ov.pct.textContent = '';
    ov.arc.style.strokeDashoffset = '';
    ov.cursor.style.opacity = 0;
    ov.title.textContent = tr('work.starting');
    ov.sub.textContent = tr('work.firstTime');
    el.compare.classList.add('working');
    mainCompare.set(0); // show the "after" side fully so the result can be watched appearing

    let outSize = null;
    try {
      const big = await WMUpscale.upscale(state.clean, t.scale, (p) => {
        if (p.backend) el.engine.textContent = p.backend === 'webgpu' ? '⚡ GPU' : 'CPU';
        if (p.progress == null) { ov.sub.textContent = tr('work.firstTime'); return; }
        const pct = Math.round(p.progress * 100);
        ov.ring.classList.remove('loading');
        ov.pct.textContent = pct + '%';
        ov.arc.style.strokeDashoffset = String(119.4 * (1 - p.progress));
        ov.title.textContent = tr('work.adding', { w: t.width, h: t.height });
        ov.sub.textContent = p.left != null && p.left > 2 ? tr('time.left', { t: friendlyTime(p.left) }) : tr('work.working');
      }, {
        signal: aborter.signal,
        model: state.upModel,
        maxInputPixels: LOW_MEMORY ? 0.5e6 : undefined,
        onStart: (size) => {
          // start from a plain enlargement; AI tiles replace it as they finish
          outSize = size;
          el.after.width = size.width; el.after.height = size.height;
          const ctx = el.after.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(state.clean, 0, 0, size.width, size.height);
          ov.title.textContent = tr('work.adding', { w: t.width, h: t.height });
          ov.sub.textContent = tr('work.working');
        },
        onTile: (tile, x, y) => {
          el.after.getContext('2d').putImageData(tile, x, y);
          Object.assign(ov.cursor.style, {
            opacity: 1,
            left: (x / outSize.width) * 100 + '%', top: (y / outSize.height) * 100 + '%',
            width: (tile.width / outSize.width) * 100 + '%', height: (tile.height / outSize.height) * 100 + '%',
          });
        },
      });
      state.big = big;
      state.bigModel = state.upModel;
      renderMain();
      el.upProgress.hidden = false;
      el.upBar.style.width = '100%';
      el.upMsg.textContent = tr('up.done', { w: big.width, h: big.height });
      // show the AI difference where the image has the most detail
      if (state.userSpot) renderZoom();
      else { const d = detailedSpot(state.clean, 96); setSpot(d.x, d.y, d.s); }
    } catch (e) {
      // cancelled or failed: put back what was there before
      state.big = prev.big;
      state.choice = prev.choice;
      renderMain();
      el.upProgress.hidden = false;
      el.upBar.style.width = '0%';
      if (e.name === 'AbortError') el.upMsg.textContent = tr('up.cancelled');
      else {
        console.error(e);
        el.upMsg.textContent = tr('up.failed', { e: e.message });
      }
    } finally {
      ov.box.hidden = true;
      el.compare.classList.remove('working');
      mainCompare.set(50);
      aborter = null;
      state.busy = false;
      refresh();
    }
  }

  document.querySelectorAll('[data-model]').forEach((b) => b.addEventListener('click', () => {
    if (state.busy) return;
    state.upModel = b.dataset.model;
    document.querySelectorAll('[data-model]').forEach((x) => x.classList.toggle('active', x === b));
    if (state.big && state.bigModel !== state.upModel) askUpscale(state.choice === 'fourK' ? 'fourK' : 'two');
  }));
  el.up2Btn.addEventListener('click', () => askUpscale('two'));
  el.up4kBtn.addEventListener('click', () => askUpscale('fourK'));

  // ---------- main view ----------

  // What the big slider compares:
  //   before upscaling → original upload vs cleaned image
  //   after upscaling  → normal enlargement vs AI result, across the whole image
  function renderMain() {
    if (state.big) {
      copyInto(el.before, state.clean); // the browser enlarges it normally to the same size
      copyInto(el.after, state.big);
      el.tagBefore.textContent = tr('tag.normal');
      el.tagAfter.textContent = tr('tag.ai') + ' · ' + tr(state.bigModel === 'art' ? 'model.artName' : 'model.photoName');
    } else {
      copyInto(el.before, state.original);
      copyInto(el.after, state.clean);
      el.tagBefore.textContent = tr('tag.before');
      el.tagAfter.textContent = tr('tag.after');
    }
    el.compare.style.setProperty('--ar', state.clean.width / state.clean.height);
    mainCompare.set(state.mode === 'compare' ? 50 : 0);
    applyZoom();
    if (state.spot) renderZoom();
    updateSaveInfo();
  }

  function applyZoom() {
    document.querySelectorAll('[data-zoom]').forEach((b) => b.classList.toggle('active', +b.dataset.zoom === state.zoom));
    if (state.zoom === 1) {
      el.viewport.classList.remove('zoomed');
      el.compare.style.width = '';
      return;
    }
    el.viewport.classList.add('zoomed');
    el.compare.style.width = el.viewport.clientWidth * state.zoom + 'px';
  }

  document.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
    const vp = el.viewport;
    // keep the centre of the view in place while zooming
    const cx = (vp.scrollLeft + vp.clientWidth / 2) / Math.max(1, el.compare.offsetWidth);
    const cy = (vp.scrollTop + vp.clientHeight / 2) / Math.max(1, el.compare.offsetHeight);
    state.zoom = +b.dataset.zoom;
    applyZoom();
    vp.scrollLeft = cx * el.compare.offsetWidth - vp.clientWidth / 2;
    vp.scrollTop = cy * el.compare.offsetHeight - vp.clientHeight / 2;
  }));
  window.addEventListener('resize', () => state.clean && applyZoom());

  // ---------- modes ----------

  function setMode(mode) {
    state.mode = mode;
    el.compare.classList.toggle('brush', mode === 'brush');
    el.compare.classList.toggle('crop', mode === 'crop');
    el.compare.classList.toggle('mask', mode === 'mask');
    el.maskBar.hidden = mode !== 'mask';
    document.querySelectorAll('[data-touch]').forEach((b) => b.classList.toggle('on', mode === 'mask' && b.dataset.touch === touchTool));
    if (mode === 'mask') el.maskHint.textContent = tr(touchTool === 'keep' ? 'bg.keepHint' : 'bg.cutHint');
    el.brushBar.hidden = mode !== 'brush';
    el.cropBar.hidden = mode !== 'crop';
    el.cropBox.hidden = mode !== 'crop';
    el.brushBtn.classList.toggle('on', mode === 'brush');
    el.cropBtn.classList.toggle('on', mode === 'crop');
    el.brushCursor.hidden = true;
    el.viewHint.textContent = tr(mode === 'brush' ? 'hint.brush' : mode === 'crop' ? 'hint.crop' : 'hint.compare');
    if (state.clean) mainCompare.set(mode === 'compare' ? 50 : 0);
  }

  // ---------- undo ----------

  function pushHistory() {
    state.history.push({ original: state.original, clean: state.clean, big: state.big, bigModel: state.bigModel, choice: state.choice, edited: state.edited, bg: state.bg });
    if (state.history.length > 15) state.history.shift();
  }

  el.undoBtn.addEventListener('click', () => {
    if (state.busy || !state.history.length) return;
    const h = state.history.pop();
    const sizeChanged = h.clean.width !== state.clean.width || h.clean.height !== state.clean.height;
    Object.assign(state, { original: h.original, clean: h.clean, big: h.big, bigModel: h.bigModel, choice: h.choice, edited: h.edited, bg: h.bg || null });
    clearPaint();
    if (sizeChanged) setSpot(state.clean.width / 2 - 64, state.clean.height / 2 - 64, 128);
    renderMain();
    refresh();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !el.result.hidden) {
      e.preventDefault();
      el.undoBtn.click();
    }
  });

  // ---------- brush: erase anything ----------

  function clearPaint() {
    if (!state.clean) return;
    el.paint.width = state.clean.width; el.paint.height = state.clean.height;
    state.painted = false;
    refresh();
  }

  el.brushBtn.addEventListener('click', () => {
    if (state.busy) return;
    if (state.mode === 'brush') { clearPaint(); return setMode('compare'); }
    setMode('brush');
    clearPaint();
  });
  el.brushDone.addEventListener('click', () => { clearPaint(); setMode('compare'); });
  el.brushClear.addEventListener('click', clearPaint);

  function brushPoint(e) {
    const r = el.compare.getBoundingClientRect();
    const k = state.clean.width / r.width; // image px per screen px
    return {
      x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, rad: (+(state.mode === 'mask' ? el.maskSize : el.brushSize).value / 2) * k,
      sx: e.clientX - r.left, sy: e.clientY - r.top,
    };
  }
  function moveCursor(p) {
    const size = +(state.mode === 'mask' ? el.maskSize : el.brushSize).value;
    Object.assign(el.brushCursor.style, { left: p.sx + 'px', top: p.sy + 'px', width: size + 'px', height: size + 'px' });
    el.brushCursor.hidden = false;
  }
  let lastPaint = null;
  function paintTo(p) {
    const ctx = el.paint.getContext('2d');
    ctx.strokeStyle = ctx.fillStyle = state.mode === 'mask' && touchTool === 'keep' ? '#22c55e' : '#ff2d55';
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.lineWidth = p.rad * 2;
    ctx.beginPath();
    if (lastPaint) { ctx.moveTo(lastPaint.x, lastPaint.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
    else { ctx.arc(p.x, p.y, p.rad, 0, Math.PI * 2); ctx.fill(); }
    lastPaint = p;
    if (!state.painted) { state.painted = true; refresh(); }
  }
  el.compare.addEventListener('pointerdown', (e) => {
    if ((state.mode !== 'brush' && state.mode !== 'mask') || state.busy) return;
    el.compare.setPointerCapture(e.pointerId);
    lastPaint = null;
    const p = brushPoint(e);
    moveCursor(p);
    paintTo(p);
  });
  el.compare.addEventListener('pointermove', (e) => {
    if (state.mode !== 'brush' && state.mode !== 'mask') return;
    const p = brushPoint(e);
    moveCursor(p);
    if (lastPaint) paintTo(p);
  });
  ['pointerup', 'pointercancel'].forEach((t) => el.compare.addEventListener(t, () => {
    const wasPainting = !!lastPaint;
    lastPaint = null;
    if (wasPainting && state.mode === 'mask') applyTouch();
  }));
  el.compare.addEventListener('pointerleave', () => { if ((state.mode === 'brush' || state.mode === 'mask') && !lastPaint) el.brushCursor.hidden = true; });

  // ---------- background touch-up: paint to keep or remove parts of the cut-out ----------

  var touchTool = 'keep'; // var: setMode() reads it and may run first
  document.querySelectorAll('[data-touch]').forEach((b) => b.addEventListener('click', () => {
    if (!state.bg || state.busy) return;
    touchTool = b.dataset.touch;
    clearPaint();
    setMode('mask');
  }));
  el.maskDone.addEventListener('click', () => { clearPaint(); setMode('compare'); });

  // Burn the painted stroke into a copy of the mask (so Undo can go back), then recompose.
  function applyTouch() {
    if (!state.bg || !state.painted) return;
    const W = state.bg.mask.width, H = state.bg.mask.height;
    const mask = document.createElement('canvas');
    mask.width = W; mask.height = H;
    const m = mask.getContext('2d', { willReadFrequently: true });
    m.drawImage(state.bg.mask, 0, 0);
    const md = m.getImageData(0, 0, W, H);
    const pd = el.paint.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const keep = touchTool === 'keep';
    for (let i = 3; i < pd.length; i += 4) {
      const a = pd[i];
      if (a < 8) continue;
      // soft brush edge: blend towards fully kept / fully removed
      md.data[i - 3] = md.data[i - 2] = md.data[i - 1] = 255;
      md.data[i] = keep ? Math.max(md.data[i], a) : Math.min(md.data[i], 255 - a);
    }
    m.putImageData(md, 0, 0);
    pushHistory();
    state.bg = Object.assign({}, state.bg, { mask });
    clearPaint();
    applyBg();
  }

  function showWorking(title, sub) {
    ov.box.hidden = false;
    ov.ring.classList.add('loading');
    ov.pct.textContent = '';
    ov.arc.style.strokeDashoffset = '';
    ov.cursor.style.opacity = 0;
    ov.title.textContent = title;
    ov.sub.textContent = sub;
    $('upCancel').hidden = true;
    el.compare.classList.add('working');
  }
  function hideWorking() {
    ov.box.hidden = true;
    $('upCancel').hidden = false;
    el.compare.classList.remove('working');
  }

  el.brushApply.addEventListener('click', async () => {
    if (state.busy || !state.painted) return;
    const W = state.clean.width, H = state.clean.height;
    const alpha = el.paint.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let i = 0; i < W * H; i++) {
      if (alpha[i * 4 + 3] < 20) continue;
      mask[i] = 1;
      const x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return clearPaint();

    state.busy = true;
    refresh();
    showWorking(tr('work.erasing'), tr('work.rebuilding'));
    try {
      const src = state.clean.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H);
      const res = await WMEraser.erase(src, mask, (p) => {
        ov.sub.textContent = p.progress == null ? tr('work.firstTime') : tr('work.rebuilding');
        if (p.progress != null && p.progress > 0) {
          ov.ring.classList.remove('loading');
          ov.pct.textContent = Math.round(p.progress * 100) + '%';
          ov.arc.style.strokeDashoffset = String(119.4 * (1 - p.progress));
        }
      });
      pushHistory();
      state.clean = canvasFrom(res.image);
      state.bg = null;
      state.big = null; // edits happen at the original size; upscale again afterwards
      state.choice = null;
      state.edited = true;
      state.painted = false;
      el.paint.width = W; el.paint.height = H;
      // show the erased area in the close-up
      const s = Math.max(x1 - x0, y1 - y0) * 1.6 + 32;
      state.userSpot = true;
      setSpot((x0 + x1) / 2 - s / 2, (y0 + y1) / 2 - s / 2, s);
      renderMain();
    } catch (e) {
      console.error(e);
      alert(tr('erase.failed', { e: e.message }));
    } finally {
      hideWorking();
      state.busy = false;
      refresh();
    }
  });

  // ---------- crop ----------

  let crop = null, cropRatio = null; // crop rect in image px; ratio = width / height

  function drawCropBox() {
    const W = state.clean.width, H = state.clean.height;
    Object.assign(el.cropBox.style, {
      left: (crop.x / W) * 100 + '%', top: (crop.y / H) * 100 + '%',
      width: (crop.w / W) * 100 + '%', height: (crop.h / H) * 100 + '%',
    });
    el.cropSize.textContent = `${Math.round(crop.w)} × ${Math.round(crop.h)}`;
  }

  // Biggest rect with the chosen ratio that fits, centred on the current box.
  function fitRatio() {
    if (!cropRatio) return;
    const W = state.clean.width, H = state.clean.height;
    const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
    let w = Math.min(W, H * cropRatio) * 0.9, h = w / cropRatio;
    crop = { w, h, x: Math.max(0, Math.min(W - w, cx - w / 2)), y: Math.max(0, Math.min(H - h, cy - h / 2)) };
  }

  el.cropBtn.addEventListener('click', () => {
    if (state.busy) return;
    if (state.mode === 'crop') return setMode('compare');
    clearPaint();
    setMode('crop');
    const W = state.clean.width, H = state.clean.height;
    crop = { x: W * 0.05, y: H * 0.05, w: W * 0.9, h: H * 0.9 };
    cropRatio = null;
    document.querySelectorAll('[data-ratio]').forEach((b) => b.classList.toggle('active', b.dataset.ratio === 'free'));
    drawCropBox();
  });
  document.querySelectorAll('[data-ratio]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-ratio]').forEach((x) => x.classList.toggle('active', x === b));
    cropRatio = b.dataset.ratio === 'free' ? null : +b.dataset.ratio;
    fitRatio();
    drawCropBox();
  }));
  el.cropCancel.addEventListener('click', () => setMode('compare'));

  let cropDrag = null;
  el.cropBox.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    el.cropBox.setPointerCapture(e.pointerId);
    cropDrag = { handle: e.target.dataset.h || 'move', x: e.clientX, y: e.clientY, start: Object.assign({}, crop) };
  });
  el.cropBox.addEventListener('pointermove', (e) => {
    if (!cropDrag) return;
    const W = state.clean.width, H = state.clean.height;
    const k = W / el.compare.getBoundingClientRect().width;
    const dx = (e.clientX - cropDrag.x) * k, dy = (e.clientY - cropDrag.y) * k;
    const s = cropDrag.start, MIN = 16;
    if (cropDrag.handle === 'move') {
      crop = { w: s.w, h: s.h, x: Math.max(0, Math.min(W - s.w, s.x + dx)), y: Math.max(0, Math.min(H - s.h, s.y + dy)) };
    } else {
      const hd = cropDrag.handle;
      // the opposite corner stays put
      const ax = hd.includes('w') ? s.x + s.w : s.x, ay = hd.includes('n') ? s.y + s.h : s.y;
      const bx = Math.max(0, Math.min(W, (hd.includes('w') ? s.x : s.x + s.w) + dx));
      const by = Math.max(0, Math.min(H, (hd.includes('n') ? s.y : s.y + s.h) + dy));
      let w = Math.max(MIN, Math.abs(bx - ax)), h = Math.max(MIN, Math.abs(by - ay));
      if (cropRatio) {
        if (w / h > cropRatio) w = h * cropRatio; else h = w / cropRatio;
        const maxW = hd.includes('w') ? ax : W - ax, maxH = hd.includes('n') ? ay : H - ay;
        if (w > maxW) { w = maxW; h = w / cropRatio; }
        if (h > maxH) { h = maxH; w = h * cropRatio; }
      }
      crop = { w, h, x: hd.includes('w') ? ax - w : ax, y: hd.includes('n') ? ay - h : ay };
    }
    drawCropBox();
  });
  ['pointerup', 'pointercancel'].forEach((t) => el.cropBox.addEventListener(t, () => (cropDrag = null)));

  function cropCanvas(src, r) {
    const cv = document.createElement('canvas');
    cv.width = r.w; cv.height = r.h;
    cv.getContext('2d').drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    return cv;
  }

  el.cropApply.addEventListener('click', () => {
    if (!crop) return;
    const r = { x: Math.round(crop.x), y: Math.round(crop.y), w: Math.round(crop.w), h: Math.round(crop.h) };
    if (r.w === state.clean.width && r.h === state.clean.height) return setMode('compare');
    pushHistory();
    state.original = cropCanvas(state.original, r);
    state.clean = cropCanvas(state.clean, r);
    state.bg = null;
    state.big = null;
    state.choice = null;
    state.edited = true;
    setMode('compare');
    clearPaint();
    const d = detailedSpot(state.clean, 96);
    setSpot(d.x, d.y, d.s);
    renderMain();
    refresh();
  });

  document.addEventListener('langchange', () => {
    if (!el.batch.hidden) renderBatch();
    if (state.clean) {
      setMode(state.mode);
      renderMain();
      refresh();
      if (current) $('backLabel').textContent = tr('back', { n: items.length });
    }
  });

  // Extra (non-image) details for "Report a problem"
  window.WMReportContext = () => state.clean
    ? `Image: ${state.clean.width}×${state.clean.height}, logos found: ${state.logos.length}, edited: ${state.edited}, upscaled: ${!!state.big}`
    : `Images in list: ${items.length}`;

  // ---------- input ----------

  el.fileInput.addEventListener('change', () => {
    const files = [...el.fileInput.files];
    el.fileInput.value = '';
    handleFiles(files);
  });
  ['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => {
    e.preventDefault();
    el.dropzone.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => {
    e.preventDefault();
    el.dropzone.classList.remove('drag');
  }));
  document.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData ? e.clipboardData.items : [])].filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile());
    if (files.length) handleFiles(files);
  });

  // ---------- output ----------

  // Free the image from memory right away (nothing is ever stored anywhere else).
  function clearImages() {
    const all = [state.original, state.clean, state.big, el.before, el.after, el.zoomBefore, el.zoomAfter, el.paint];
    for (const h of state.history) all.push(h.original, h.clean, h.big);
    for (const cv of all) {
      if (cv) { cv.width = 0; cv.height = 0; }
    }
    state.history = [];
    state.bg = null;
    state.original = state.clean = state.big = null;
    state.logos = [];
    state.spot = null;
  }

  el.againBtn.addEventListener('click', () => {
    if (state.busy) return;
    resetAll();
  });

  // ---------- privacy / fair use ----------

  const info = $('info');
  document.querySelectorAll('[data-info]').forEach((b) => b.addEventListener('click', () => {
    info.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== b.dataset.info));
    info.showModal();
  }));
  info.addEventListener('click', (e) => {
    const r = info.getBoundingClientRect(); // a click on the backdrop closes it
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) info.close();
  });
})();
