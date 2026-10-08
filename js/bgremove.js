/*
 * Unsparkle – background removal with ormbg (Apache-2.0) running in the
 * browser through onnxruntime-web. The model file (~88 MB) is downloaded the
 * first time it's used and then cached by the browser / offline worker.
 */
(function (root) {
  'use strict';
  const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
  // On the website the model comes from the same site. When the page is opened
  // from a file on your computer, browsers block reading big local files, so it
  // is downloaded from the published website instead (GitHub Pages allows that).
  const LIVE_SITE = 'https://meetdhamsania013.github.io/unsparkle/';
  const MODEL_URL = (/^https?:$/.test(location.protocol) ? '' : LIVE_SITE) + 'js/models/ormbg-fp16.onnx';
  const SIZE = 1024; // the model's fixed working size

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src + '. Check your internet connection.'));
      document.head.appendChild(s);
    });
  }

  function available() {
    return typeof fetch === 'function';
  }

  async function download(onStatus) {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error('Could not download the background AI model (' + res.status + '). Check your internet connection.');
    const total = +res.headers.get('content-length') || 88117930;
    if (!res.body || !res.body.getReader) return new Uint8Array(await res.arrayBuffer());
    const reader = res.body.getReader();
    const bytes = new Uint8Array(total);
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (got + value.length > bytes.length) { // size header was missing or wrong
        const bigger = new Uint8Array(Math.max(bytes.length * 2, got + value.length));
        bigger.set(bytes.subarray(0, got));
        return finish(bigger, got, value, reader, onStatus, total);
      }
      bytes.set(value, got);
      got += value.length;
      onStatus({ download: Math.min(1, got / total) });
    }
    return bytes.subarray(0, got);
  }
  async function finish(buf, got, value, reader, onStatus, total) {
    buf.set(value, got); got += value.length;
    for (;;) {
      const { done, value: v } = await reader.read();
      if (done) break;
      if (got + v.length > buf.length) { const b = new Uint8Array(buf.length * 2); b.set(buf.subarray(0, got)); buf = b; }
      buf.set(v, got); got += v.length;
      onStatus({ download: Math.min(1, got / total) });
    }
    return buf.subarray(0, got);
  }

  let bytesPromise = null, session = null, backend = null;
  // Some graphics cards return a noisy, half-transparent mask with this model.
  // A good mask is almost all clearly in or out (0.5–8% "in between" on tests),
  // so a GPU result above this is redone on the CPU, which is then used from now on.
  const MAX_UNSURE = 0.15;
  const CPU_KEY = 'unsparkle.bgCpu';
  let cpuOnly = false;
  try { cpuOnly = localStorage.getItem(CPU_KEY) === '1'; } catch (e) { /* storage blocked */ }

  function unsure(t) {
    const d = t.data;
    let n = 0;
    for (let i = 0; i < d.length; i += 7) if (d[i] > 0.15 && d[i] < 0.85) n++;
    return n / Math.ceil(d.length / 7);
  }

  async function prepare(onStatus) {
    if (!root.ort) await loadScript(ORT_BASE + 'ort.webgpu.min.js');
    root.ort.env.wasm.wasmPaths = ORT_BASE;
    if (root.crossOriginIsolated) root.ort.env.wasm.numThreads = Math.min(8, navigator.hardwareConcurrency || 4);
    if (!bytesPromise) bytesPromise = download(onStatus).catch((e) => { bytesPromise = null; throw e; });
    return bytesPromise;
  }

  function toInput(src) {
    const c = document.createElement('canvas');
    c.width = SIZE; c.height = SIZE;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, SIZE, SIZE);
    const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
    const plane = SIZE * SIZE, x = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      x[i] = px[i * 4] / 255; x[plane + i] = px[i * 4 + 1] / 255; x[2 * plane + i] = px[i * 4 + 2] / 255;
    }
    return new root.ort.Tensor('float32', x, [1, 3, SIZE, SIZE]);
  }

  // Tidy the cut-out: fill small holes fully enclosed by the subject (white
  // letters or shiny parts the AI was unsure about) and drop tiny floating specks.
  // Large enclosed openings, like the inside of a bag handle, stay transparent.
  function cleanMask(px, W, H) {
    const n = W * H, solid = new Uint8Array(n);
    for (let i = 0; i < n; i++) solid[i] = px[i * 4 + 3] >= 128 ? 1 : 0;
    const label = new Int32Array(n).fill(-1), stack = new Int32Array(n);
    const comps = []; // { solid, area, border }
    for (let start = 0; start < n; start++) {
      if (label[start] !== -1) continue;
      const kind = solid[start], id = comps.length;
      let top = 0, area = 0, border = false;
      stack[top++] = start; label[start] = id;
      while (top) {
        const p = stack[--top], x = p % W, y = (p / W) | 0;
        area++;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
        if (x > 0 && label[p - 1] === -1 && solid[p - 1] === kind) { label[p - 1] = id; stack[top++] = p - 1; }
        if (x < W - 1 && label[p + 1] === -1 && solid[p + 1] === kind) { label[p + 1] = id; stack[top++] = p + 1; }
        if (y > 0 && label[p - W] === -1 && solid[p - W] === kind) { label[p - W] = id; stack[top++] = p - W; }
        if (y < H - 1 && label[p + W] === -1 && solid[p + W] === kind) { label[p + W] = id; stack[top++] = p + W; }
      }
      comps.push({ solid: kind, area, border });
    }
    let largest = 0;
    for (const c of comps) if (c.solid && c.area > largest) largest = c.area;
    // holes are judged against the subject's size: gaps inside an object get
    // filled, big real openings (like the inside of a bag handle) stay clear
    const holeMax = Math.max(n * 0.002, largest * 0.025), speckMax = largest * 0.01;
    for (let i = 0; i < n; i++) {
      const c = comps[label[i]];
      if (!c.solid && !c.border && c.area < holeMax) px[i * 4 + 3] = 255;   // small enclosed hole → fill
      else if (c.solid && c.area < speckMax) px[i * 4 + 3] = 0;             // tiny floating speck → clear
    }
  }

  /**
   * Find the foreground of an image.
   * @param {HTMLCanvasElement} src
   * @param {(s: {download?: number, message?: string}) => void} onStatus
   * @returns {Promise<HTMLCanvasElement>} a mask canvas the size of src: alpha = foreground
   */
  async function mask(src, onStatus) {
    const report = onStatus || function () {};
    const bytes = await prepare(report);
    const input = toInput(src);
    let out = null;
    if (session) out = await session.run({ [session.inputNames[0]]: input });
    else {
      // GPU first (fast); the CPU if the graphics card can't run it or gives a noisy mask
      for (const b of navigator.gpu && !cpuOnly ? ['webgpu', 'wasm'] : ['wasm']) {
        try {
          report({ message: b === 'webgpu' ? 'gpu' : 'cpu' });
          const s = await root.ort.InferenceSession.create(bytes, { executionProviders: [b] });
          const r = await s.run({ [s.inputNames[0]]: input });
          if (b === 'webgpu' && unsure(r[s.outputNames[0]]) > MAX_UNSURE) {
            console.warn('GPU mask looks noisy; using the CPU instead');
            cpuOnly = true;
            try { localStorage.setItem(CPU_KEY, '1'); } catch (e) { /* storage blocked */ }
            if (s.release) s.release();
            continue;
          }
          out = r; session = s; backend = b;
          break;
        } catch (e) {
          console.warn('Background model backend failed:', b, e);
        }
      }
      if (!out) throw new Error('The background model could not run in this browser.');
    }
    const t = out[session.outputNames[0]];
    const d = t.data, n = t.dims, mh = n[n.length - 2], mw = n[n.length - 1];
    const small = document.createElement('canvas');
    small.width = mw; small.height = mh;
    const id = small.getContext('2d').createImageData(mw, mh);
    for (let i = 0; i < mw * mh; i++) {
      const v = Math.max(0, Math.min(1, d[i]));
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255;
      id.data[i * 4 + 3] = v * 255;
    }
    small.getContext('2d').putImageData(id, 0, 0);
    const full = document.createElement('canvas');
    full.width = src.width; full.height = src.height;
    const fctx = full.getContext('2d', { willReadFrequently: true });
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(small, 0, 0, full.width, full.height);
    // True transparency: background fully clear, subject fully solid. Only a
    // narrow band at the outline stays soft so edges aren't jagged.
    const fd = fctx.getImageData(0, 0, full.width, full.height);
    const LO = 0.42 * 255, HI = 0.58 * 255;
    for (let i = 3; i < fd.data.length; i += 4) {
      const a = fd.data[i];
      fd.data[i] = a <= LO ? 0 : a >= HI ? 255 : ((a - LO) / (HI - LO)) * 255;
    }
    cleanMask(fd.data, full.width, full.height);
    fctx.putImageData(fd, 0, 0);
    return full;
  }

  /**
   * Put the foreground of `src` (using `maskCanvas`) on a new background.
   * @param {'transparent'|'white'|'color'|'blur'} kind
   */
  function compose(src, maskCanvas, kind, color) {
    const W = src.width, H = src.height;
    const fg = document.createElement('canvas');
    fg.width = W; fg.height = H;
    const g = fg.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(maskCanvas, 0, 0);
    if (kind === 'transparent') return fg;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const o = out.getContext('2d');
    if (kind === 'blur') {
      const r = Math.max(6, Math.round(Math.max(W, H) / 70));
      o.filter = `blur(${r}px)`;
      o.drawImage(src, -r * 2, -r * 2, W + r * 4, H + r * 4); // overscan hides blurred edges
      o.filter = 'none';
    } else {
      o.fillStyle = kind === 'white' ? '#ffffff' : color || '#ffffff';
      o.fillRect(0, 0, W, H);
    }
    o.drawImage(fg, 0, 0);
    return out;
  }

  root.WMBackground = { available, mask, compose, get backend() { return backend; } };
})(window);
