/*
 * Unsparkle – magic eraser. Paint over anything and it's rebuilt from the
 * background with MI-GAN (AI inpainting, runs in the browser via onnxruntime-web).
 * Falls back to content-aware fill (fill.js) if the AI can't run here.
 */
(function (root) {
  'use strict';
  const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
  const MAX_SIDE = 1024; // larger work areas are shrunk for the AI, then scaled back
  const GROW = 3;        // cover soft brush edges

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  let sessionPromise = null;
  function getSession(onStatus) {
    if (!sessionPromise) {
      sessionPromise = (async () => {
        onStatus('Loading the AI eraser (first time only)…');
        if (!root.ort) await loadScript(ORT_BASE + 'ort.webgpu.min.js');
        root.ort.env.wasm.wasmPaths = ORT_BASE;
        // multi-core CPU speed-up: only possible when the site is cross-origin isolated (see _headers)
        if (root.crossOriginIsolated) root.ort.env.wasm.numThreads = Math.min(8, navigator.hardwareConcurrency || 4);
        await loadScript('js/models/migan.js');
        const bin = atob(root.MIGAN_MODEL_B64);
        root.MIGAN_MODEL_B64 = null; // free the text copy
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

        for (const backend of navigator.gpu ? ['webgpu', 'wasm'] : ['wasm']) {
          try {
            const session = await root.ort.InferenceSession.create(bytes, { executionProviders: [backend] });
            const n = 64, m = new Uint8Array(n * n).fill(255);
            m[32 * n + 32] = 0;
            await session.run({
              image: new root.ort.Tensor('uint8', new Uint8Array(3 * n * n).fill(128), [1, 3, n, n]),
              mask: new root.ort.Tensor('uint8', m, [1, 1, n, n]),
            });
            return session;
          } catch (e) {
            console.warn('Eraser backend failed:', backend, e);
          }
        }
        throw new Error('AI eraser is not available in this browser.');
      })().catch((e) => {
        sessionPromise = null;
        throw e;
      });
    }
    return sessionPromise;
  }

  function canvasOf(w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
  }

  // Run MI-GAN on one rectangle of the image (in place).
  async function eraseBox(session, out, mask, box) {
    const { width: W } = out;
    const cw = box.x1 - box.x0 + 1, ch = box.y1 - box.y0 + 1;
    const k = Math.min(1, MAX_SIDE / Math.max(cw, ch));
    const w = Math.max(8, Math.round(cw * k)), h = Math.max(8, Math.round(ch * k));

    // crop (and shrink if very large)
    const crop = canvasOf(cw, ch);
    crop.getContext('2d').putImageData(new ImageData(
      (() => {
        const d = new Uint8ClampedArray(cw * ch * 4);
        for (let y = 0; y < ch; y++) d.set(out.data.subarray(((box.y0 + y) * W + box.x0) * 4, ((box.y0 + y) * W + box.x0 + cw) * 4), y * cw * 4);
        return d;
      })(), cw, ch), 0, 0);
    let work = crop;
    if (k < 1) {
      work = canvasOf(w, h);
      const ctx = work.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(crop, 0, 0, w, h);
    }
    const px = work.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const chw = new Uint8Array(3 * w * h), m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(ch - 1, Math.floor(y / k));
      for (let x = 0; x < w; x++) {
        const i = y * w + x, sx = Math.min(cw - 1, Math.floor(x / k));
        chw[i] = px[i * 4]; chw[w * h + i] = px[i * 4 + 1]; chw[2 * w * h + i] = px[i * 4 + 2];
        m[i] = mask[(box.y0 + sy) * W + box.x0 + sx] ? 0 : 255; // 0 = rebuild, 255 = keep
      }
    }
    const res = await session.run({
      image: new root.ort.Tensor('uint8', chw, [1, 3, h, w]),
      mask: new root.ort.Tensor('uint8', m, [1, 1, h, w]),
    });
    const r = res.result.data;

    // back to the crop size
    const resImg = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      resImg.data[i * 4] = r[i]; resImg.data[i * 4 + 1] = r[w * h + i]; resImg.data[i * 4 + 2] = r[2 * w * h + i]; resImg.data[i * 4 + 3] = 255;
    }
    let full = resImg;
    if (k < 1) {
      const small = canvasOf(w, h);
      small.getContext('2d').putImageData(resImg, 0, 0);
      const big = canvasOf(cw, ch);
      const ctx = big.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(small, 0, 0, cw, ch);
      full = ctx.getImageData(0, 0, cw, ch);
    }
    // paste back only the painted pixels
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const g = (box.y0 + y) * W + box.x0 + x;
        if (!mask[g]) continue;
        const s = (y * cw + x) * 4, d = g * 4;
        out.data[d] = full.data[s]; out.data[d + 1] = full.data[s + 1]; out.data[d + 2] = full.data[s + 2];
      }
    }
  }

  /**
   * Erase the painted pixels and rebuild them from the background.
   * @param {ImageData} img
   * @param {Uint8Array} paint  1 = erase (same size as img)
   * @param {(p: {message: string, progress?: number}) => void} [onProgress]
   * @returns {Promise<{image: ImageData, method: 'ai' | 'fill'}>}
   */
  async function erase(img, paint, onProgress) {
    const report = onProgress || function () {};
    const { width: W, height: H } = img;
    const mask = root.WMFill.dilate(paint, W, H, GROW);

    let session = null;
    try {
      session = await getSession((message) => report({ message }));
    } catch (e) {
      console.warn(e);
    }
    if (!session) {
      report({ message: 'Rebuilding the background…' });
      const out = await root.WMFill.fill(img, mask, { grow: 0, onProgress: (f) => report({ message: 'Rebuilding the background…', progress: f }) });
      return { image: new ImageData(out.data, W, H), method: 'fill' };
    }

    // one work area per painted blob: the blob plus plenty of context around it
    const boxes = root.WMFill.mergeBoxes(root.WMFill.blobs(mask, W, H).map((b) => {
      const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
      const pad = Math.max(48, Math.round(Math.max(bw, bh) * 0.75));
      return { x0: Math.max(0, b.x0 - pad), y0: Math.max(0, b.y0 - pad), x1: Math.min(W - 1, b.x1 + pad), y1: Math.min(H - 1, b.y1 + pad) };
    }));
    const out = new ImageData(new Uint8ClampedArray(img.data), W, H);
    for (let i = 0; i < boxes.length; i++) {
      report({ message: 'AI is rebuilding the background…', progress: i / boxes.length });
      await new Promise((r) => setTimeout(r, 30));
      await eraseBox(session, out, mask, boxes[i]);
    }
    report({ message: 'Done', progress: 1 });
    return { image: out, method: 'ai' };
  }

  root.WMEraser = { erase };
})(window);
