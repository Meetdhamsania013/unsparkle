/*
 * Unsparkle – content-aware fill ("magic eraser").
 * Rebuilds a painted area by copying matching texture from the rest of the
 * image, like Photoshop's Content-Aware Fill. Multi-scale PatchMatch inpainting
 * (Barnes et al. 2009 / Wexler et al. 2007):
 *   1. work on a crop around each painted blob, build a pyramid of it;
 *   2. at the coarsest level start from a smooth fill;
 *   3. at every level alternate: find, for each patch touching the hole, the most
 *      similar patch outside the hole (PatchMatch), then rebuild hole pixels as
 *      a weighted vote of those patches;
 *   4. upsample and refine down to full resolution.
 * Pure functions on ImageData-like objects; runs in the browser and in Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMFill = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const R = 3;                  // patch radius → 7×7 patches
  const COARSEST_SIDE = 48;     // stop the pyramid around this size
  const LOCALITY = 3 * 6 * 6;   // see Level: cost of borrowing texture from far away
  const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function dilate(mask, w, h, r) {
    if (r <= 0) return Uint8Array.from(mask);
    // separable square dilation
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      let last = -1e9;
      for (let x = 0; x < w; x++) { if (mask[y * w + x]) last = x; if (x - last <= r) tmp[y * w + x] = 1; }
      last = 1e9;
      for (let x = w - 1; x >= 0; x--) { if (mask[y * w + x]) last = x; if (last - x <= r) tmp[y * w + x] = 1; }
    }
    for (let x = 0; x < w; x++) {
      let last = -1e9;
      for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; if (y - last <= r) out[y * w + x] = 1; }
      last = 1e9;
      for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) last = y; if (last - y <= r) out[y * w + x] = 1; }
    }
    return out;
  }

  // Connected blobs of the mask (8-neighbour), each with its bounding box.
  function blobs(mask, w, h) {
    const seen = new Uint8Array(w * h), out = [];
    const stack = [];
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || seen[i]) continue;
      let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
      seen[i] = 1; stack.push(i);
      while (stack.length) {
        const p = stack.pop(), x = p % w, y = (p / w) | 0;
        n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
          }
        }
      }
      out.push({ x0, y0, x1, y1, n });
    }
    return out;
  }

  // Merge blobs whose work areas overlap, so nearby strokes are filled together.
  function mergeBoxes(boxes) {
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          if (a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1) {
            boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
            boxes.splice(j, 1);
            merged = true;
            break outer;
          }
        }
      }
    }
    return boxes;
  }

  // ---------- one pyramid level ----------

  function Level(img, hole, w, h) {
    this.img = img; this.hole = hole; this.w = w; this.h = h;
    // a source patch must lie fully inside the image and fully outside the hole
    const near = dilate(hole, w, h, R);
    this.srcOK = new Uint8Array(w * h);
    this.srcList = [];
    for (let y = R; y < h - R; y++) {
      for (let x = R; x < w - R; x++) {
        const i = y * w + x;
        if (!near[i]) { this.srcOK[i] = 1; this.srcList.push(i); }
      }
    }
    // targets: every pixel whose patch touches the hole
    this.targets = [];
    for (let i = 0; i < w * h; i++) if (near[i]) this.targets.push(i);
    // locality cost: a source one hole-radius away costs like a ~6-level colour
    // difference on every pixel of the patch
    let holeN = 0;
    for (let i = 0; i < w * h; i++) holeN += hole[i];
    const holeR = Math.max(2, Math.sqrt(holeN / Math.PI));
    this.locality = (LOCALITY * (2 * R + 1) * (2 * R + 1)) / (holeR * holeR);
    this.nn = new Int32Array(w * h).fill(-1);
    this.nd = new Float64Array(w * h);
  }

  // Patch distance (sum of squared RGB differences), with early exit.
  Level.prototype.dist = function (p, q, best) {
    const { img, w, h } = this;
    const px = p % w, py = (p / w) | 0, qx = q % w, qy = (q / w) | 0;
    // prefer texture from near the hole: far-away look-alikes (e.g. a blurry
    // background) cost extra, which keeps the fill true to its surroundings
    const sx = px - qx, sy = py - qy;
    const near = this.locality * (sx * sx + sy * sy);
    if (near >= best) return Infinity;
    let d = 0, n = 0;
    for (let dy = -R; dy <= R; dy++) {
      const ya = py + dy;
      if (ya < 0 || ya >= h) continue;
      const rowA = ya * w, rowB = (qy + dy) * w;
      for (let dx = -R; dx <= R; dx++) {
        const xa = px + dx;
        if (xa < 0 || xa >= w) continue;
        const ia = rowA + xa, a = ia * 3, b = (rowB + qx + dx) * 3;
        const d0 = img[a] - img[b], d1 = img[a + 1] - img[b + 1], d2 = img[a + 2] - img[b + 2];
        // real pixels are trusted more than the current guess inside the hole
        const wt = this.hole[ia] ? 0.4 : 1;
        d += (d0 * d0 + d1 * d1 + d2 * d2) * wt;
        n += wt;
      }
      if (d >= best) return Infinity;
    }
    // patches cut by the border have fewer pixels; normalise to a full patch
    return (d * ((2 * R + 1) * (2 * R + 1))) / n + near;
  };

  Level.prototype.tryMatch = function (p, q) {
    if (q < 0 || !this.srcOK[q]) return;
    const d = this.dist(p, q, this.nd[p]);
    if (d < this.nd[p]) { this.nd[p] = d; this.nn[p] = q; }
  };

  Level.prototype.initNN = function (rand, coarser) {
    const { w, h, srcList, targets } = this;
    for (const p of targets) {
      let q = -1;
      if (coarser) {
        // upsample the coarser match: same relative position, scaled ×2
        const cx = Math.min(coarser.w - 1, (p % w) >> 1), cy = Math.min(coarser.h - 1, ((p / w) | 0) >> 1);
        const cq = coarser.nn[cy * coarser.w + cx];
        if (cq >= 0) {
          const qx = (cq % coarser.w) * 2 + ((p % w) & 1), qy = ((cq / coarser.w) | 0) * 2 + (((p / w) | 0) & 1);
          if (qx < w && qy < h && this.srcOK[qy * w + qx]) q = qy * w + qx;
        }
      }
      if (q < 0) q = srcList[(rand() * srcList.length) | 0];
      this.nn[p] = q;
      this.nd[p] = this.dist(p, q, Infinity);
    }
  };

  Level.prototype.patchMatch = function (rand, passes) {
    const { w, h, targets } = this;
    const maxR = Math.max(w, h);
    for (let pass = 0; pass < passes; pass++) {
      const fwd = pass % 2 === 0, step = fwd ? 1 : -1;
      for (let k = fwd ? 0 : targets.length - 1; k >= 0 && k < targets.length; k += step) {
        const p = targets[k], x = p % w, y = (p / w) | 0;
        // propagation: neighbour's match, shifted by one
        const nx = x - step, ny = y - step;
        if (nx >= 0 && nx < w) {
          const n = this.nn[y * w + nx];
          if (n >= 0) this.tryMatch(p, n + step);
        }
        if (ny >= 0 && ny < h) {
          const n = this.nn[ny * w + x];
          if (n >= 0) this.tryMatch(p, n + step * w);
        }
        // random search around the current best, shrinking window
        const b = this.nn[p], bx = b % w, by = (b / w) | 0;
        for (let r = maxR; r >= 1; r >>= 1) {
          const qx = Math.round(bx + (rand() * 2 - 1) * r), qy = Math.round(by + (rand() * 2 - 1) * r);
          if (qx >= 0 && qy >= 0 && qx < w && qy < h) this.tryMatch(p, qy * w + qx);
        }
      }
    }
  };

  // Rebuild hole pixels from the matched patches. Coarse levels average the
  // votes (gets the big shapes right); the finest level takes each pixel from the
  // single best-matching patch covering it, which keeps texture crisp.
  Level.prototype.vote = function (best) {
    const { img, hole, w, h, targets, nn, nd } = this;
    if (best) {
      const bestD = new Float64Array(w * h).fill(Infinity), pick = new Int32Array(w * h).fill(-1);
      for (const p of targets) {
        const q = nn[p];
        if (q < 0) continue;
        const d = nd[p], px = p % w, py = (p / w) | 0, qx = q % w, qy = (q / w) | 0;
        for (let dy = -R; dy <= R; dy++) {
          const ty = py + dy;
          if (ty < 0 || ty >= h) continue;
          for (let dx = -R; dx <= R; dx++) {
            const tx = px + dx;
            if (tx < 0 || tx >= w) continue;
            const t = ty * w + tx;
            if (hole[t] && d < bestD[t]) { bestD[t] = d; pick[t] = (qy + dy) * w + qx + dx; }
          }
        }
      }
      const src = Float32Array.from(img);
      for (let t = 0; t < w * h; t++) {
        const s = pick[t];
        if (s < 0) continue;
        img[t * 3] = src[s * 3]; img[t * 3 + 1] = src[s * 3 + 1]; img[t * 3 + 2] = src[s * 3 + 2];
      }
      for (const p of targets) this.nd[p] = this.dist(p, nn[p], Infinity);
      return;
    }
    const sample = [];
    for (let k = 0; k < targets.length; k += Math.max(1, (targets.length / 2000) | 0)) sample.push(nd[targets[k]]);
    sample.sort((a, b) => a - b);
    const sigma = (sample[(sample.length * 0.5) | 0] || 1) + 1e-6;

    const acc = new Float64Array(w * h * 3), wsum = new Float64Array(w * h);
    for (const p of targets) {
      const q = nn[p];
      if (q < 0) continue;
      const wt = Math.exp(-nd[p] / (2 * sigma));
      const px = p % w, py = (p / w) | 0, qx = q % w, qy = (q / w) | 0;
      for (let dy = -R; dy <= R; dy++) {
        const ty = py + dy;
        if (ty < 0 || ty >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const tx = px + dx;
          if (tx < 0 || tx >= w) continue;
          const t = ty * w + tx;
          if (!hole[t]) continue;
          const s = ((qy + dy) * w + qx + dx) * 3;
          acc[t * 3] += img[s] * wt; acc[t * 3 + 1] += img[s + 1] * wt; acc[t * 3 + 2] += img[s + 2] * wt;
          wsum[t] += wt;
        }
      }
    }
    for (let t = 0; t < w * h; t++) {
      if (!hole[t] || wsum[t] <= 0) continue;
      img[t * 3] = acc[t * 3] / wsum[t];
      img[t * 3 + 1] = acc[t * 3 + 1] / wsum[t];
      img[t * 3 + 2] = acc[t * 3 + 2] / wsum[t];
    }
    // match distances changed with the image; refresh them
    for (const p of targets) this.nd[p] = this.dist(p, nn[p], Infinity);
  };

  // ---------- pyramid helpers ----------

  function downsample(img, hole, w, h) {
    const W = Math.max(1, w >> 1), H = Math.max(1, h >> 1);
    const out = new Float32Array(W * H * 3), m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let r = 0, g = 0, b = 0, n = 0, anyHole = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(w - 1, x * 2 + dx), sy = Math.min(h - 1, y * 2 + dy), s = sy * w + sx;
            if (hole[s]) { anyHole = 1; continue; }
            r += img[s * 3]; g += img[s * 3 + 1]; b += img[s * 3 + 2]; n++;
          }
        }
        const t = y * W + x;
        m[t] = anyHole;
        if (n) { out[t * 3] = r / n; out[t * 3 + 1] = g / n; out[t * 3 + 2] = b / n; }
      }
    }
    return { img: out, hole: m, w: W, h: H };
  }

  // Smooth starting guess for the coarsest level: fill from the edge inwards.
  function diffuseFill(img, hole, w, h) {
    const known = new Uint8Array(w * h);
    let left = 0;
    for (let i = 0; i < w * h; i++) { if (hole[i]) left++; else known[i] = 1; }
    while (left > 0) {
      const layer = [];
      for (let i = 0; i < w * h; i++) {
        if (known[i]) continue;
        const x = i % w, y = (i / w) | 0;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const q = yy * w + xx;
            if (!known[q]) continue;
            r += img[q * 3]; g += img[q * 3 + 1]; b += img[q * 3 + 2]; n++;
          }
        }
        if (n) layer.push([i, r / n, g / n, b / n]);
      }
      if (!layer.length) break;
      for (const [i, r, g, b] of layer) { img[i * 3] = r; img[i * 3 + 1] = g; img[i * 3 + 2] = b; known[i] = 1; }
      left -= layer.length;
    }
  }

  // ---------- one blob ----------

  async function fillRegion(imgData, mask, box, rand, onStep) {
    const { width: W, height: H, data } = imgData;
    const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
    // search area: the blob plus a generous margin of surrounding image
    const margin = Math.round(Math.min(200, Math.max(40, Math.max(bw, bh) * 0.9)));
    const cx0 = Math.max(0, box.x0 - margin), cy0 = Math.max(0, box.y0 - margin);
    const cx1 = Math.min(W - 1, box.x1 + margin), cy1 = Math.min(H - 1, box.y1 + margin);
    const w = cx1 - cx0 + 1, h = cy1 - cy0 + 1;

    const img = new Float32Array(w * h * 3), hole = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const g = (y + cy0) * W + x + cx0, i = y * w + x;
        img[i * 3] = data[g * 4]; img[i * 3 + 1] = data[g * 4 + 1]; img[i * 3 + 2] = data[g * 4 + 2];
        hole[i] = mask[g];
      }
    }

    // pyramid
    const pyr = [{ img, hole, w, h }];
    while (Math.max(pyr[pyr.length - 1].w, pyr[pyr.length - 1].h) > COARSEST_SIDE && Math.min(pyr[pyr.length - 1].w, pyr[pyr.length - 1].h) > 4 * (2 * R + 1)) {
      const t = pyr[pyr.length - 1];
      pyr.push(downsample(t.img, t.hole, t.w, t.h));
    }

    let coarser = null;
    for (let li = pyr.length - 1; li >= 0; li--) {
      const P = pyr[li];
      if (!coarser) diffuseFill(P.img, P.hole, P.w, P.h);
      else {
        // start from the coarser result, upsampled
        for (let y = 0; y < P.h; y++) {
          for (let x = 0; x < P.w; x++) {
            const i = y * P.w + x;
            if (!P.hole[i]) continue;
            const c = Math.min(coarser.h - 1, y >> 1) * coarser.w + Math.min(coarser.w - 1, x >> 1);
            P.img[i * 3] = coarser.img[c * 3]; P.img[i * 3 + 1] = coarser.img[c * 3 + 1]; P.img[i * 3 + 2] = coarser.img[c * 3 + 2];
          }
        }
      }
      const L = new Level(P.img, P.hole, P.w, P.h);
      if (!L.srcList.length) { diffuseFill(P.img, P.hole, P.w, P.h); coarser = L; continue; }
      L.initNN(rand, coarser);
      // rebuild from the upsampled coarse matches before searching again, so the
      // finer level starts with real texture instead of a blurry guess
      const finest = li === 0;
      if (coarser) L.vote(finest);
      const iters = li === pyr.length - 1 ? 10 : finest ? 4 : 6;
      for (let it = 0; it < iters; it++) {
        L.patchMatch(rand, 2);
        L.vote(finest);
        await onStep();
      }
      coarser = L;
    }

    // write the filled crop back
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!hole[i]) continue;
        const g = ((y + cy0) * W + x + cx0) * 4;
        data[g] = img[i * 3]; data[g + 1] = img[i * 3 + 1]; data[g + 2] = img[i * 3 + 2];
      }
    }
  }

  /**
   * Fill the painted pixels of an image with matching surrounding texture.
   * @param {{data: Uint8ClampedArray, width: number, height: number}} imgData
   * @param {Uint8Array} mask  1 = erase this pixel (same size as the image)
   * @param {{grow?: number, onProgress?: (fraction: number) => void}} [opts]
   * @returns {Promise<{data: Uint8ClampedArray, width: number, height: number}>} new image
   */
  async function fill(imgData, mask, opts) {
    opts = opts || {};
    const { width: w, height: h } = imgData;
    const out = { data: new Uint8ClampedArray(imgData.data), width: w, height: h };
    // grow a little so soft brush edges and halos are covered too
    const m = dilate(mask, w, h, opts.grow == null ? 2 : opts.grow);
    const boxes = mergeBoxes(blobs(m, w, h).map((b) => {
      const pad = Math.round(Math.min(200, Math.max(40, Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.9)));
      return { x0: Math.max(0, b.x0 - pad), y0: Math.max(0, b.y0 - pad), x1: Math.min(w - 1, b.x1 + pad), y1: Math.min(h - 1, b.y1 + pad) };
    }));

    // process each region using only the hole pixels inside it
    const rand = rng(12345);
    const steps = boxes.length * 30;
    let done = 0;
    const onStep = async () => {
      done++;
      if (opts.onProgress) opts.onProgress(Math.min(0.99, done / steps));
      await yieldFrame();
    };
    for (const b of boxes) {
      const sub = new Uint8Array(w * h);
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = b.y0; y <= b.y1; y++) {
        for (let x = b.x0; x <= b.x1; x++) {
          const i = y * w + x;
          if (!m[i]) continue;
          sub[i] = 1;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) continue;
      await fillRegion(out, sub, { x0, y0, x1, y1 }, rand, onStep);
    }
    if (opts.onProgress) opts.onProgress(1);
    return out;
  }

  return { fill, dilate, blobs, mergeBoxes };
});
