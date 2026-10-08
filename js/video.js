/*
 * Unsparkle – video: removes the Gemini/Veo sparkle logo from every frame and
 * erases anything painted with the brush, then writes a new video with the
 * original audio. Everything runs in the browser (WebCodecs via Mediabunny).
 *
 * How the logo is found: the logo stays still while the scene moves, so the
 * average of many frames turns the background into a smooth blur while the
 * logo stays sharp. Detection and opacity are measured once on that average,
 * then the same exact removal is applied to every frame (no flicker).
 */
(function (root) {
  'use strict';
  const M = () => root.Mediabunny;
  const SAMPLE_FRAMES = 24;

  // The video library (~700 KB) is only downloaded when someone opens a video.
  let libPromise = null;
  function loadLibrary() {
    if (root.Mediabunny) return Promise.resolve();
    if (!libPromise) {
      libPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/vendor/mediabunny.min.js';
        s.onload = resolve;
        s.onerror = () => { libPromise = null; reject(new Error('Could not load the video tools.')); };
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }

  function supported() {
    return !!(root.VideoEncoder && root.VideoDecoder && root.VideoFrame);
  }

  function canvasOf(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // ---------- read + analyse ----------

  /**
   * @param {File} file
   * @returns {Promise<object>} info, detected logo (or null), a preview frame and the average frame
   */
  async function analyze(file, onProgress) {
    await loadLibrary();
    const mb = M();
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error('No video track found in this file.');
    const at = await input.getPrimaryAudioTrack();
    const duration = await input.computeDuration();
    const stats = await vt.computePacketStats(120);
    const W = vt.displayWidth, H = vt.displayHeight;
    const info = {
      width: W, height: H, duration, fps: stats.averagePacketRate, bitrate: stats.averageBitrate,
      codec: vt.codec, audio: at ? at.codec : null,
    };

    // average of evenly spaced frames
    const sink = new mb.CanvasSink(vt, { poolSize: 1 });
    const sum = new Float32Array(W * H * 3);
    let n = 0, preview = null;
    for (let i = 0; i < SAMPLE_FRAMES; i++) {
      const t = (duration * (i + 0.5)) / SAMPLE_FRAMES;
      const wc = await sink.getCanvas(t);
      if (!wc) continue;
      const d = wc.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
      for (let p = 0, q = 0; p < d.length; p += 4, q += 3) { sum[q] += d[p]; sum[q + 1] += d[p + 1]; sum[q + 2] += d[p + 2]; }
      n++;
      if (i === Math.floor(SAMPLE_FRAMES / 2)) { preview = canvasOf(W, H); preview.getContext('2d').drawImage(wc.canvas, 0, 0); }
      if (onProgress) onProgress((i + 1) / SAMPLE_FRAMES);
    }
    if (!n) throw new Error('Could not read frames from this video.');
    const avg = new ImageData(W, H);
    for (let p = 0, q = 0; q < sum.length; p += 4, q += 3) {
      avg.data[p] = sum[q] / n; avg.data[p + 1] = sum[q + 1] / n; avg.data[p + 2] = sum[q + 2] / n; avg.data[p + 3] = 255;
    }

    // Video logos come with a wider range of opacity than image logos (encoding
    // shifts it), so on the averaged frame a near-perfect shape match at a known
    // Gemini position is accepted with the opacity measured from the video itself.
    const det = root.WMCore.detect(avg);
    let logo = null;
    if (det.found || (det.known && det.score >= 0.8)) {
      const place = { x: det.x, y: det.y, size: det.size };
      const rg = root.WMCore.robustGain(avg, place, root.WMCore.getMask(det.variant, det.size));
      const gain = rg != null && rg > 0.2 && rg < 2.5 ? rg : det.gain;
      if (gain > 0.2 && gain < 2.5) logo = { x: det.x, y: det.y, size: det.size, variant: det.variant, gain, score: det.score };
    }
    return { info, logo, preview, average: avg };
  }

  // ---------- per-frame work ----------

  // Rectangles of the frame we touch: around the logo and around painted areas.
  function workRegions(W, H, logo, paint) {
    const regions = [];
    if (logo) {
      const pad = 24;
      regions.push({ kind: 'logo', x: Math.max(0, logo.x - pad), y: Math.max(0, logo.y - pad), w: 0, h: 0, x1: Math.min(W, logo.x + logo.size + pad), y1: Math.min(H, logo.y + logo.size + pad) });
    }
    if (paint) {
      for (const b of root.WMFill.blobs(paint, W, H)) {
        const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
        const pad = Math.max(32, Math.round(Math.max(bw, bh) * 0.75));
        regions.push({ kind: 'paint', x: Math.max(0, b.x0 - pad), y: Math.max(0, b.y0 - pad), x1: Math.min(W, b.x1 + pad + 1), y1: Math.min(H, b.y1 + pad + 1) });
      }
    }
    for (const r of regions) { r.w = r.x1 - r.x; r.h = r.y1 - r.y; }
    return regions;
  }

  function cropMask(mask, W, r) {
    const m = new Uint8Array(r.w * r.h);
    let any = false;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        if (mask[(r.y + y) * W + r.x + x]) { m[y * r.w + x] = 1; any = true; }
      }
    }
    return any ? m : null;
  }

  // For a painted area: measure the fixed overlay on the averaged frame. The
  // moving background averages out to a smooth surface, so filling the painted
  // area of the average from its surroundings gives the background, and the
  // difference is the overlay. A semi-transparent white overlay (text, logos)
  // gets an exact per-pixel opacity and is un-blended in every frame; anything
  // else (solid or dark objects) is filled from the surroundings per frame.
  function overlayModel(avg, mask, r) {
    const W = avg.width, n = r.w * r.h;
    const crop = { data: new Uint8ClampedArray(n * 4), width: r.w, height: r.h };
    for (let y = 0; y < r.h; y++) crop.data.set(avg.data.subarray(((r.y + y) * W + r.x) * 4, ((r.y + y) * W + r.x + r.w) * 4), y * r.w * 4);
    const grown = root.WMCore.dilate(mask, r.w, r.h, 2);
    const bg = root.WMCore.inpaint(crop, grown, { grow: 0, grain: false, smooth: 24 });
    const alpha = new Float32Array(n), fill = new Uint8Array(n);
    const lum = (d, i) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    for (let i = 0; i < n; i++) {
      if (!grown[i]) continue;
      const a = lum(crop.data, i), b = lum(bg.data, i);
      const diff = a - b;
      if (diff < -10) { fill[i] = 1; continue; }            // darker than the background: not a white overlay
      const al = b < 250 ? diff / (255 - b) : 0;
      if (al >= 0.6) fill[i] = 1;                           // nearly solid: recovering would only show noise
      else if (al > 0.015) alpha[i] = al;
    }
    let anyFill = false;
    for (let i = 0; i < n; i++) if (fill[i]) { anyFill = true; break; }
    return { alpha, fill: anyFill ? root.WMCore.dilate(fill, r.w, r.h, 1) : null };
  }

  function applyOverlay(img, model) {
    const d = img.data, a = model.alpha;
    for (let i = 0; i < a.length; i++) {
      const al = a[i];
      if (!al || (model.fill && model.fill[i])) continue;
      const j = i * 4, k = 1 / (1 - al);
      d[j] = (d[j] - al * 255) * k; d[j + 1] = (d[j + 1] - al * 255) * k; d[j + 2] = (d[j + 2] - al * 255) * k;
    }
    if (!model.fill) return img;
    const out = root.WMCore.inpaint(img, model.fill, { grow: 0, grain: false, smooth: 6 });
    return new ImageData(new Uint8ClampedArray(out.data.buffer), img.width, img.height);
  }

  /**
   * Process the whole video.
   * @param {File} file
   * @param {{logo: object|null, paint: Uint8Array|null, average: ImageData, bitrate: number}} plan
   * @param {(p: {progress: number, message?: string}) => void} onProgress
   * @param {AbortSignal} [signal]
   * @returns {Promise<{blob: Blob, mime: string, ext: string}>}
   */
  async function process(file, plan, onProgress, signal) {
    await loadLibrary();
    const mb = M();
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const vt = await input.getPrimaryVideoTrack();
    const W = vt.displayWidth, H = vt.displayHeight;
    const regions = workRegions(W, H, plan.logo, plan.paint);
    const models = regions.map((r) => {
      if (r.kind !== 'paint') return null;
      const m = cropMask(plan.paint, W, r);
      return m ? overlayModel(plan.average, m, r) : null;
    });

    // MP4/H.264 when the browser can encode it, otherwise WebM/VP9
    const bitrate = Math.max(2e6, Math.round((plan.bitrate || 4e6) * 1.25));
    let format = new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), codec = 'avc', mime = 'video/mp4', ext = 'mp4';
    if (!(await mb.canEncodeVideo('avc', { width: W, height: H, bitrate }))) {
      format = new mb.WebMOutputFormat(); codec = 'vp9'; mime = 'video/webm'; ext = 'webm';
    }
    const output = new mb.Output({ format, target: new mb.BufferTarget() });

    // a few canvases in rotation so the encoder can still read the previous frame
    const pool = [canvasOf(W, H), canvasOf(W, H), canvasOf(W, H)];
    let poolIdx = 0;

    const conversion = await mb.Conversion.init({
      input,
      output,
      video: {
        codec,
        bitrate,
        forceTranscode: true,
        keyFrameInterval: 2,
        process: async (sample) => {
          const cv = pool[poolIdx++ % pool.length];
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          sample.draw(ctx, 0, 0, W, H);
          for (let i = 0; i < regions.length; i++) {
            const r = regions[i];
            let img = ctx.getImageData(r.x, r.y, r.w, r.h);
            if (r.kind === 'logo') {
              const place = { x: plan.logo.x - r.x, y: plan.logo.y - r.y, size: plan.logo.size };
              const out = root.WMCore.removeAt(img, place, plan.logo.variant, plan.logo.gain, { maxAlpha: 0.6 });
              img = new ImageData(new Uint8ClampedArray(out.data.buffer), r.w, r.h);
            } else if (models[i]) {
              img = applyOverlay(img, models[i]);
            }
            ctx.putImageData(img, r.x, r.y);
          }
          return cv;
        },
      },
      // audio is copied as-is when the container allows it (no quality loss)
    });
    if (!conversion.isValid) throw new Error('This video format is not supported by your browser.');
    conversion.onProgress = (p) => onProgress && onProgress({ progress: p });
    if (signal) signal.addEventListener('abort', () => conversion.cancel(), { once: true });
    await conversion.execute();
    const buf = output.target.buffer;
    return { blob: new Blob([buf], { type: mime }), mime, ext };
  }

  root.WMVideo = { supported, analyze, process };
})(window);
