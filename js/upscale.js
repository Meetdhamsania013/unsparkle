/*
 * Unsparkle – AI upscaling with Real-ESRGAN running in the browser through
 * onnxruntime-web. Two models: 'photo' (realesr-general-x4v3) and 'art'
 * (realesr-animevideov3, for illustrations, cartoons and anime). Uses the GPU (WebGPU) when the browser
 * has it and falls back to the CPU (WebAssembly).
 */
(function (root) {
  'use strict';
  const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
  const MODEL_SCALE = 4;
  const MAX_INPUT_PIXELS = 1.6e6; // bigger inputs are shrunk first to keep time and memory sane
  const PAD = 12; // tile overlap in input pixels, hides seams between tiles

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src + '. Check your internet connection.'));
      document.head.appendChild(s);
    });
  }

  const MODELS = {
    photo: { script: 'js/models/realesr-general-x4v3.js', global: 'REALESR_MODEL_B64' },
    art: { script: 'js/models/realesr-animevideov3.js', global: 'REALESR_ANIME_MODEL_B64' },
  };
  const sessions = {};
  function getSession(model, onStatus) {
    if (!sessions[model]) {
      sessions[model] = (async () => {
        onStatus('Loading AI model (first time only)…');
        if (!root.ort) await loadScript(ORT_BASE + 'ort.webgpu.min.js');
        root.ort.env.wasm.wasmPaths = ORT_BASE;
        // multi-core CPU speed-up: only possible when the site is cross-origin isolated (see _headers)
        if (root.crossOriginIsolated) root.ort.env.wasm.numThreads = Math.min(8, navigator.hardwareConcurrency || 4);
        const m = MODELS[model];
        await loadScript(m.script);
        const bin = atob(root[m.global]);
        root[m.global] = null; // free the text copy
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

        const backends = navigator.gpu ? ['webgpu', 'wasm'] : ['wasm'];
        for (const backend of backends) {
          try {
            const session = await root.ort.InferenceSession.create(bytes, { executionProviders: [backend] });
            // smoke test: some GPUs report WebGPU but fail on first run
            const probe = new root.ort.Tensor('float32', new Float32Array(3 * 16 * 16), [1, 3, 16, 16]);
            await session.run({ [session.inputNames[0]]: probe });
            return { session, backend };
          } catch (e) {
            console.warn('Upscaler backend failed:', backend, e);
          }
        }
        throw new Error('Could not start the AI model in this browser.');
      })().catch((e) => {
        sessions[model] = null;
        throw e;
      });
    }
    return sessions[model];
  }

  function canvasOf(w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
  }

  function resized(src, w, h) {
    const cv = canvasOf(w, h);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return cv;
  }

  // Seconds per input pixel. Starts from a CPU measurement (~2.2 s per 128×128
  // tile) and is replaced by the real speed of this device after the first run.
  let measuredRate = null, measuredBackend = null;
  const CPU_RATE = 2.2 / (128 * 128), GPU_RATE = CPU_RATE / 10;

  /** Rough time estimate for upscaling a w×h image on this device. */
  function estimate(w, h) {
    const px = Math.min(w * h, MAX_INPUT_PIXELS);
    if (measuredRate) return { seconds: px * measuredRate, measured: true, backend: measuredBackend };
    return { seconds: px * (navigator.gpu ? GPU_RATE : CPU_RATE), slowest: px * CPU_RATE, measured: false };
  }

  /**
   * Upscale an image.
   * @param {HTMLCanvasElement} srcCanvas  image to upscale
   * @param {number} scale                 final scale factor (e.g. 2, or 3840 / longSide for 4K)
   * @param {(p: {message: string, progress?: number, left?: number, backend?: string}) => void} onProgress
   * @param {{model?: 'photo' | 'art', signal?: AbortSignal, maxInputPixels?: number, onStart?: (size: {width: number, height: number}) => void,
   *          onTile?: (tile: ImageData, x: number, y: number) => void}} [opts]
   *        onStart/onTile let the page show the result appearing tile by tile (in model-output pixels)
   * @returns {Promise<HTMLCanvasElement>} canvas at the final size
   */
  async function upscale(srcCanvas, scale, onProgress, opts) {
    const report = onProgress || function () {};
    opts = opts || {};
    const checkCancel = () => {
      if (opts.signal && opts.signal.aborted) throw new DOMException('Upscaling cancelled', 'AbortError');
    };
    const { session, backend } = await getSession(MODELS[opts.model] ? opts.model : 'photo', (message) => report({ message }));
    const inputName = session.inputNames[0], outputName = session.outputNames[0];

    const outW = Math.round(srcCanvas.width * scale), outH = Math.round(srcCanvas.height * scale);
    // model input: the original, shrunk only when very large
    const k = Math.min(1, Math.sqrt((opts.maxInputPixels || MAX_INPUT_PIXELS) / (srcCanvas.width * srcCanvas.height)));
    const iw = Math.max(1, Math.round(srcCanvas.width * k)), ih = Math.max(1, Math.round(srcCanvas.height * k));
    const input = k < 1 ? resized(srcCanvas, iw, ih) : srcCanvas;
    const src = input.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, iw, ih).data;
    // Transparent images (e.g. after background removal): the AI only sees colour,
    // so see-through pixels are shown to it on neutral grey, and the transparency
    // itself is enlarged separately and put back at the end.
    let hasAlpha = false;
    for (let i = 3; i < src.length; i += 4) if (src[i] < 255) { hasAlpha = true; break; }
    if (hasAlpha) {
      for (let i = 0; i < src.length; i += 4) {
        const a = src[i + 3] / 255;
        if (a < 1) { src[i] = src[i] * a + 128 * (1 - a); src[i + 1] = src[i + 1] * a + 128 * (1 - a); src[i + 2] = src[i + 2] * a + 128 * (1 - a); }
      }
    }

    const S = MODEL_SCALE, ow = iw * S, oh = ih * S;
    const out = new ImageData(ow, oh);
    const T = backend === 'webgpu' ? 256 : 128;
    const tilesX = Math.ceil(iw / T), tilesY = Math.ceil(ih / T), total = tilesX * tilesY;
    let done = 0;
    const t0 = performance.now();
    checkCancel();
    if (opts.onStart) opts.onStart({ width: ow, height: oh });

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        // tile core [x0,x1) x [y0,y1), read with PAD context around it
        const x0 = tx * T, y0 = ty * T, x1 = Math.min(iw, x0 + T), y1 = Math.min(ih, y0 + T);
        const px0 = Math.max(0, x0 - PAD), py0 = Math.max(0, y0 - PAD);
        const px1 = Math.min(iw, x1 + PAD), py1 = Math.min(ih, y1 + PAD);
        const pw = px1 - px0, ph = py1 - py0, plane = pw * ph;

        const data = new Float32Array(3 * plane);
        for (let y = 0; y < ph; y++) {
          for (let x = 0; x < pw; x++) {
            const j = ((py0 + y) * iw + px0 + x) * 4, i = y * pw + x;
            data[i] = src[j] / 255;
            data[plane + i] = src[j + 1] / 255;
            data[2 * plane + i] = src[j + 2] / 255;
          }
        }
        const result = await session.run({ [inputName]: new root.ort.Tensor('float32', data, [1, 3, ph, pw]) });
        const o = result[outputName].data, opw = pw * S, oplane = opw * ph * S;

        // copy the tile core (without the padding) into the output
        for (let y = (y0 - py0) * S; y < (y1 - py0) * S; y++) {
          for (let x = (x0 - px0) * S; x < (x1 - px0) * S; x++) {
            const i = y * opw + x;
            const j = ((py0 * S + y) * ow + px0 * S + x) * 4;
            out.data[j] = o[i] * 255;
            out.data[j + 1] = o[oplane + i] * 255;
            out.data[j + 2] = o[2 * oplane + i] * 255;
            out.data[j + 3] = 255;
          }
        }
        result[outputName].dispose && result[outputName].dispose();

        if (opts.onTile) {
          const tw = (x1 - x0) * S, th = (y1 - y0) * S, tile = new ImageData(tw, th);
          for (let y = 0; y < th; y++) {
            const from = ((y0 * S + y) * ow + x0 * S) * 4;
            tile.data.set(out.data.subarray(from, from + tw * 4), y * tw * 4);
          }
          opts.onTile(tile, x0 * S, y0 * S);
        }

        done++;
        const elapsed = (performance.now() - t0) / 1000;
        const left = Math.round((elapsed / done) * (total - done));
        report({
          message: `Upscaling… ${Math.round((done / total) * 100)}%` + (done > 1 && left > 2 ? ` (about ${left}s left)` : ''),
          progress: done / total,
          left: done > 1 ? left : null,
          backend,
        });
        await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
        checkCancel();
      }
    }

    measuredRate = (performance.now() - t0) / 1000 / (iw * ih);
    measuredBackend = backend;
    if (hasAlpha) {
      const ac = canvasOf(ow, oh), actx = ac.getContext('2d', { willReadFrequently: true });
      actx.imageSmoothingQuality = 'high';
      actx.drawImage(input, 0, 0, ow, oh);
      const ad = actx.getImageData(0, 0, ow, oh).data;
      for (let i = 3; i < ad.length; i += 4) out.data[i] = ad[i];
    }
    const full = canvasOf(ow, oh);
    full.getContext('2d').putImageData(out, 0, 0);
    if (ow === outW && oh === outH) return full;
    return resized(full, outW, outH);
  }

  root.WMUpscale = { upscale, estimate };
})(window);
