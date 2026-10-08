/*
 * Gemini Cleaner – core image algorithms.
 * Pure functions on ImageData-like objects ({ data, width, height }),
 * so they run in the browser and in Node (for tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./masks.js'));
  else { root.WMCore = factory(root.WMMasks); root.WMCoreFactory = factory; } // factory is reused by the background worker
})(typeof self !== 'undefined' ? self : this, function (MASKS) {
  'use strict';

  // ---------- real logo masks ----------

  function decodeBase64(b64) {
    if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(b64, 'base64'));
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const baseMasks = {};
  function baseMask(key) {
    if (!baseMasks[key]) {
      const bytes = decodeBase64(MASKS[key]);
      const f = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
      baseMasks[key] = { alpha: Float32Array.from(f), size: Math.round(Math.sqrt(f.length)) };
    }
    return baseMasks[key];
  }

  // Area-correct resize (supersampled bilinear) of a square mask.
  function resizeMask(src, sSize, dSize) {
    if (sSize === dSize) return Float32Array.from(src);
    const out = new Float32Array(dSize * dSize);
    const scale = sSize / dSize, ss = 4;
    const sample = (fx, fy) => {
      fx = Math.min(sSize - 1, Math.max(0, fx)); fy = Math.min(sSize - 1, Math.max(0, fy));
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(sSize - 1, x0 + 1), y1 = Math.min(sSize - 1, y0 + 1);
      const wx = fx - x0, wy = fy - y0;
      return (src[y0 * sSize + x0] * (1 - wx) + src[y0 * sSize + x1] * wx) * (1 - wy) +
             (src[y1 * sSize + x0] * (1 - wx) + src[y1 * sSize + x1] * wx) * wy;
    };
    for (let y = 0; y < dSize; y++) {
      for (let x = 0; x < dSize; x++) {
        let s = 0;
        for (let sy = 0; sy < ss; sy++) {
          for (let sx = 0; sx < ss; sx++) {
            s += sample((x + (sx + 0.5) / ss) * scale - 0.5, (y + (sy + 0.5) / ss) * scale - 0.5);
          }
        }
        out[y * dSize + x] = s / (ss * ss);
      }
    }
    return out;
  }

  // Logo variants Gemini has shipped. 'classic' picks the 48 or 96 capture
  // depending on which is closer to the target size.
  const VARIANTS = ['classic', '96-20260520', '36-v2'];
  const maskCache = new Map();
  function getMask(variant, size) {
    const key = variant + ':' + size;
    if (!maskCache.has(key)) {
      const src = variant === 'classic' ? baseMask(size <= 64 ? '48' : '96') : baseMask(variant);
      maskCache.set(key, resizeMask(src.alpha, src.size, size));
    }
    return maskCache.get(key);
  }

  // ---------- helpers ----------

  function cloneImage(img) {
    return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  }

  // Luminance of the bottom-right corner only (that's where the logo lives).
  function cornerLuminance(img, extent) {
    const { data, width: w, height: h } = img;
    const ex = Math.min(w, extent), ey = Math.min(h, extent);
    const ox = w - ex, oy = h - ey;
    const L = new Float32Array(ex * ey);
    for (let y = 0; y < ey; y++) {
      for (let x = 0; x < ex; x++) {
        const j = ((y + oy) * w + x + ox) * 4;
        L[y * ex + x] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      }
    }
    return { L, ox, oy, ew: ex, eh: ey };
  }

  function dilate(mask, w, h, r) {
    if (r <= 0) return mask;
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx >= 0 && xx < w) out[yy * w + xx] = 1;
          }
        }
      }
    }
    return out;
  }

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- detection ----------

  // Gradients (central differences) of a w×h luminance array.
  function gradients(L, w, h) {
    const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        gx[i] = (L[i + 1] - L[i - 1]) * 0.5;
        gy[i] = (L[i + w] - L[i - w]) * 0.5;
      }
    }
    return { gx, gy };
  }

  const gradCache = new Map();
  function maskGradients(variant, size) {
    const key = variant + ':' + size;
    if (!gradCache.has(key)) {
      const g = gradients(getMask(variant, size), size, size);
      let e = 0;
      for (let i = 0; i < g.gx.length; i++) e += g.gx[i] * g.gx[i] + g.gy[i] * g.gy[i];
      g.energy = e;
      gradCache.set(key, g);
    }
    return gradCache.get(key);
  }

  // Edge-direction correlation: a white logo makes the image gradients point
  // the same way as the mask gradients along its curved star edges. Smooth
  // gradients and random texture don't, so this is far more selective than
  // plain brightness correlation. Range -1..1.
  function edgeScore(C, M, size, x, y, step) {
    const { gx, gy, ew } = C;
    let dot = 0, eI = 0, eM = 0;
    for (let ty = 1; ty < size - 1; ty += step) {
      const row = (y + ty) * ew + x, trow = ty * size;
      for (let tx = 1; tx < size - 1; tx += step) {
        const i = row + tx, t = trow + tx;
        const mx = M.gx[t], my = M.gy[t];
        dot += gx[i] * mx + gy[i] * my;
        eI += gx[i] * gx[i] + gy[i] * gy[i];
        eM += mx * mx + my * my;
      }
    }
    if (eI <= 1e-6 || eM <= 1e-9) return 0;
    return dot / Math.sqrt(eI * eM);
  }

  // Layouts Gemini is known to use: [logo size, gap from right/bottom edge].
  const KNOWN_LAYOUTS = [
    [48, 32], [96, 64], [48, 96], [96, 192], [36, 96], [42, 82], [46, 32], [48, 89],
  ];
  // Real logos need about the same opacity gain on each mask; look-alikes don't.
  const GAIN_RANGE = { classic: [0.5, 1.12], '96-20260520': [0.85, 1.3], '36-v2': [0.9, 1.35] };

  // Find the logo. Candidates come from Gemini's known layouts plus a scan of
  // every size/gap in the corner (layouts keep changing). Each candidate is
  // refined pixel by pixel, then verified: the opacity needed to erase it must
  // be realistic, and its edge match must be strong (weaker is fine at a known
  // layout).
  function detect(img) {
    const { width: w, height: h } = img;
    const maxSize = Math.min(120, Math.floor(Math.min(w, h) / 2));
    const maxGap = 260;
    if (maxSize < 32) return { found: false, score: 0 };
    const C = cornerLuminance(img, maxSize + maxGap + 8);
    const { ew, eh } = C;
    Object.assign(C, gradients(C.L, ew, eh));
    const atGap = (size, gap) => ({ size, x: ew - gap - size, y: eh - gap - size });

    const seeds = [];
    for (const [size, gap] of KNOWN_LAYOUTS) {
      const p = atGap(size, gap);
      if (size <= maxSize && p.x >= 0 && p.y >= 0) seeds.push(Object.assign(p, { known: true, score: 1 }));
    }
    const hits = [];
    for (const variant of VARIANTS) {
      for (let size = 32; size <= maxSize; size += 2) {
        const M = maskGradients(variant, size);
        for (let gap = 2; gap <= maxGap; gap += 2) {
          const p = atGap(size, gap);
          if (p.x < 0 || p.y < 0) break;
          const score = edgeScore(C, M, size, p.x, p.y, 2);
          if (score > 0.2) hits.push(Object.assign(p, { score }));
        }
      }
    }
    hits.sort((a, b) => b.score - a.score);
    for (const hit of hits) {
      if (seeds.length >= KNOWN_LAYOUTS.length + 8) break;
      if (!seeds.some((t) => Math.abs(t.size - hit.size) <= 4 && Math.abs(t.x - hit.x) <= 4 && Math.abs(t.y - hit.y) <= 4)) seeds.push(hit);
    }

    const isKnown = (size, x, y) => KNOWN_LAYOUTS.some(([ks, kg]) =>
      Math.abs(ks - size) <= 3 && Math.abs(ew - kg - ks - x) <= 3 && Math.abs(eh - kg - ks - y) <= 3);

    let best = null;
    for (const seed of seeds) {
      // refine position/size/variant by edge match
      let top = null;
      for (const variant of VARIANTS) {
        for (let size = seed.size - 2; size <= seed.size + 2; size++) {
          if (size < 32 || size > maxSize) continue;
          const M = maskGradients(variant, size);
          const cx = seed.x + (seed.size - size) / 2, cy = seed.y + (seed.size - size) / 2;
          for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
              const x = Math.round(cx + dx), y = Math.round(cy + dy);
              if (x < 0 || y < 0 || x + size > ew || y + size > eh) continue;
              const score = edgeScore(C, M, size, x, y, 1);
              if (!top || score > top.score) top = { variant, size, x, y, score };
            }
          }
        }
      }
      if (!top) continue;
      const place = { size: top.size, x: top.x + C.ox, y: top.y + C.oy };
      const ev = evaluate(img, place, getMask(top.variant, top.size));
      const [gLo, gHi] = GAIN_RANGE[top.variant];
      const known = isKnown(top.size, top.x, top.y);
      // Gemini places the logo with equal right and bottom gaps
      const square = Math.abs((ew - top.x - top.size) - (eh - top.y - top.size)) <= 1;
      const ok = square && ev.gain >= gLo && ev.gain <= gHi && top.score >= (known ? 0.12 : 0.35);
      const rank = top.score + (known ? 0.2 : 0) + (ok ? 1 : 0);
      if (!best || rank > best.rank) {
        best = Object.assign({}, place, { variant: top.variant, score: top.score, gain: ev.gain, known, found: ok, rank });
      }
    }
    if (!best) return { found: false, score: 0 };
    delete best.rank;
    return best;
  }

  // Fallback for screenshots, resized or cropped images: the logo is no longer
  // at a standard Gemini spot (often smaller, with uneven gaps), so search the
  // lower-right part of the picture at any size and position. Only used when
  // detect() finds nothing; it demands a stronger match to avoid false alarms.
  const ANYWHERE_GAIN = { classic: [0.45, 1.15], '96-20260520': [0.8, 1.35] };
  const ANYWHERE_MIN = 26;
  function detectAnywhere(img) {
    const { width: w, height: h } = img;
    const extent = Math.round(Math.max(w, h) * 0.55);
    const C = cornerLuminance(img, extent);
    const { ew, eh } = C;
    Object.assign(C, gradients(C.L, ew, eh));
    const maxSize = Math.min(110, Math.floor(Math.min(ew, eh) / 2));
    if (maxSize < ANYWHERE_MIN) return { found: false, score: 0 };

    // coarse scan with the standard mask
    const hits = [];
    for (let size = ANYWHERE_MIN; size <= maxSize; size += 5) {
      const M = maskGradients('classic', size);
      const step = Math.max(3, Math.round(size / 10));
      for (let y = 0; y + size <= eh; y += step) {
        for (let x = 0; x + size <= ew; x += step) {
          const score = edgeScore(C, M, size, x, y, 2);
          if (score > 0.3) hits.push({ size, x, y, score });
        }
      }
    }
    hits.sort((a, b) => b.score - a.score);
    const seeds = [];
    for (const hit of hits) {
      if (seeds.length >= 8) break;
      if (!seeds.some((t) => Math.abs(t.x - hit.x) < hit.size / 2 && Math.abs(t.y - hit.y) < hit.size / 2)) seeds.push(hit);
    }

    let best = null;
    for (const seed of seeds) {
      let top = null;
      for (const variant of Object.keys(ANYWHERE_GAIN)) {
        for (let size = seed.size - 3; size <= seed.size + 3; size++) {
          if (size < ANYWHERE_MIN || size > maxSize) continue;
          const M = maskGradients(variant, size);
          const cx = seed.x + (seed.size - size) / 2, cy = seed.y + (seed.size - size) / 2;
          for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
              const x = Math.round(cx + dx), y = Math.round(cy + dy);
              if (x < 0 || y < 0 || x + size > ew || y + size > eh) continue;
              const score = edgeScore(C, M, size, x, y, 1);
              if (!top || score > top.score) top = { variant, size, x, y, score };
            }
          }
        }
      }
      if (!top) continue;
      const place = { size: top.size, x: top.x + C.ox, y: top.y + C.oy };
      const alpha = getMask(top.variant, top.size);
      const ev = evaluate(img, place, alpha);
      const rg = robustGain(img, place, alpha);
      const [gLo, gHi] = ANYWHERE_GAIN[top.variant];
      // both opacity estimates must look like a real logo
      const ok = top.score >= 0.65 && ev.gain >= gLo && ev.gain <= gHi && rg != null && rg >= gLo && rg <= gHi;
      if (ok && (!best || top.score > best.score)) {
        best = Object.assign({}, place, { variant: top.variant, score: top.score, gain: ev.gain, known: false, found: true, anywhere: true });
      }
    }
    return best || { found: false, score: 0 };
  }

  // Same correlation for an arbitrary box (used to measure leftovers).
  function boxEdgeScore(img, place, alpha) {
    const { width: w, data } = img;
    const s = place.size;
    const L = new Float32Array(s * s);
    for (let ty = 0; ty < s; ty++) {
      for (let tx = 0; tx < s; tx++) {
        const j = ((place.y + ty) * w + place.x + tx) * 4;
        L[ty * s + tx] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      }
    }
    const C = Object.assign({ ew: s }, gradients(L, s, s));
    const M = gradients(alpha, s, s);
    return edgeScore(C, M, s, 0, 0, 1);
  }

  // ---------- reverse alpha blending ----------

  function boxLum(img, place) {
    const { width: w, data } = img;
    const s = place.size;
    const L = new Float32Array(s * s);
    for (let ty = 0; ty < s; ty++) {
      for (let tx = 0; tx < s; tx++) {
        const j = ((place.y + ty) * w + place.x + tx) * 4;
        L[ty * s + tx] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      }
    }
    return L;
  }

  function totalVariation(R, s) {
    let tv = 0;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = y * s + x;
        if (x + 1 < s) tv += Math.abs(R[i + 1] - R[i]);
        if (y + 1 < s) tv += Math.abs(R[i + s] - R[i]);
      }
    }
    return tv;
  }

  // Test a candidate logo position. The opacity gain is chosen so that the
  // logo's edges vanish exactly (edge correlation crosses zero): too weak
  // leaves a bright logo, too strong a dark one. Then we check how much
  // cleaner the box got, which separates real logos from look-alikes.
  function evaluate(img, place, alpha) {
    const s = place.size;
    const L = boxLum(img, place);
    const M = gradients(alpha, s, s);
    const R = new Float32Array(s * s);
    const restore = (g) => {
      for (let i = 0; i < R.length; i++) {
        const a = Math.min(0.95, alpha[i] * g);
        const v = (L[i] - a * 255) / (1 - a);
        R[i] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    };
    const score = (g) => {
      restore(g);
      return edgeScore(Object.assign({ ew: s }, gradients(R, s, s)), M, s, 0, 0, 1);
    };
    const before = score(0);
    let gain;
    if (before <= 0) gain = 0;
    else if (score(2) > 0) gain = 2;
    else {
      let lo = 0, hi = 2;
      for (let it = 0; it < 18; it++) {
        const mid = (lo + hi) / 2;
        if (score(mid) > 0) lo = mid; else hi = mid;
      }
      gain = (lo + hi) / 2;
    }
    restore(gain);
    const tv0 = totalVariation(L, s), tv1 = totalVariation(R, s);
    return { gain: Math.round(gain * 1000) / 1000, before, reduction: tv0 > 0 ? 1 - tv1 / tv0 : 0 };
  }

  // original = (watermarked - a*255) / (1 - a). Also returns a mask of pixels
  // that can't be trusted (inverse overshoots far below 0 or a is very high).
  function reverseAlpha(img, place, alpha, gain) {
    const { width: w, height: h, data } = img;
    const out = cloneImage(img);
    const bad = new Uint8Array(w * h);
    let unreliable = 0;
    for (let ty = 0; ty < place.size; ty++) {
      const py = place.y + ty;
      if (py < 0 || py >= h) continue;
      for (let tx = 0; tx < place.size; tx++) {
        const px = place.x + tx;
        if (px < 0 || px >= w) continue;
        const a = alpha[ty * place.size + tx] * gain;
        if (a < 0.002) continue;
        const idx = py * w + px, j = idx * 4;
        if (a >= 0.9) { bad[idx] = 1; unreliable++; continue; }
        let over = false;
        for (let c = 0; c < 3; c++) {
          const v = (data[j + c] - a * 255) / (1 - a);
          if (v < -14) over = true;
          out.data[j + c] = v;
        }
        if (over) { bad[idx] = 1; unreliable++; }
      }
    }
    return { image: out, bad, unreliable };
  }

  // How much of the logo shape is still visible after removal (~0 = clean).
  function residualScore(img, place, alpha) {
    return boxEdgeScore(img, place, alpha);
  }

  // ---------- inpainting ----------

  // Fills masked pixels from their surroundings: onion-peel fill (outside in,
  // inverse-distance weighted), a few smoothing passes, then grain that matches
  // the surrounding noise so the patch doesn't look plastic.
  function inpaint(img, maskIn, opts) {
    opts = Object.assign({ grow: 1, radius: 4, smooth: 6, grain: true, seed: 7 }, opts);
    const { width: w, height: h } = img;
    const mask = dilate(maskIn, w, h, opts.grow);

    let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
        if (y < by0) by0 = y; if (y > by1) by1 = y;
      }
    }
    const out = cloneImage(img);
    if (bx1 < 0) return out;

    const pad = opts.radius + 3;
    const x0 = Math.max(0, bx0 - pad), y0 = Math.max(0, by0 - pad);
    const x1 = Math.min(w - 1, bx1 + pad), y1 = Math.min(h - 1, by1 + pad);
    const rw = x1 - x0 + 1, rh = y1 - y0 + 1, n = rw * rh;

    const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    const known = new Uint8Array(n), hole = new Uint8Array(n);
    let remaining = 0;
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x, gi = (y + y0) * w + (x + x0), j = gi * 4;
        for (let c = 0; c < 3; c++) ch[c][i] = img.data[j + c];
        if (mask[gi]) { hole[i] = 1; remaining++; } else known[i] = 1;
      }
    }
    if (remaining === n) return out;

    const r = opts.radius;
    const layer = [];
    while (remaining > 0) {
      layer.length = 0;
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          const i = y * rw + x;
          if (known[i]) continue;
          let edge = false;
          for (let dy = -1; dy <= 1 && !edge; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= rh) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx >= 0 && xx < rw && known[yy * rw + xx]) { edge = true; break; }
            }
          }
          if (edge) layer.push(i);
        }
      }
      if (!layer.length) break;
      const vals = new Float32Array(layer.length * 3);
      for (let k = 0; k < layer.length; k++) {
        const i = layer[k], x = i % rw, y = (i / rw) | 0;
        let sw = 0, s0 = 0, s1 = 0, s2 = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= rh) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= rw) continue;
            const q = yy * rw + xx;
            if (!known[q]) continue;
            const d2 = dx * dx + dy * dy;
            if (d2 > r * r) continue;
            // original pixels are trusted more than already-filled ones
            const wgt = (hole[q] ? 0.5 : 1) / (d2 + 0.5);
            sw += wgt; s0 += ch[0][q] * wgt; s1 += ch[1][q] * wgt; s2 += ch[2][q] * wgt;
          }
        }
        vals[k * 3] = s0 / sw; vals[k * 3 + 1] = s1 / sw; vals[k * 3 + 2] = s2 / sw;
      }
      for (let k = 0; k < layer.length; k++) {
        const i = layer[k];
        ch[0][i] = vals[k * 3]; ch[1][i] = vals[k * 3 + 1]; ch[2][i] = vals[k * 3 + 2];
        known[i] = 1;
      }
      remaining -= layer.length;
    }

    // smoothing passes to remove onion-peel streaks (boundary stays fixed)
    for (let it = 0; it < opts.smooth; it++) {
      for (let c = 0; c < 3; c++) {
        const src = ch[c], next = Float32Array.from(src);
        for (let y = 1; y < rh - 1; y++) {
          for (let x = 1; x < rw - 1; x++) {
            const i = y * rw + x;
            if (hole[i]) next[i] = (src[i - 1] + src[i + 1] + src[i - rw] + src[i + rw]) * 0.25;
          }
        }
        ch[c] = next;
      }
    }

    if (opts.grain) {
      let s = 0, s2 = 0, cnt = 0;
      for (let y = 1; y < rh - 1; y++) {
        for (let x = 1; x < rw - 1; x++) {
          const i = y * rw + x;
          if (hole[i] || hole[i - 1] || hole[i + 1] || hole[i - rw] || hole[i + rw]) continue;
          for (let c = 0; c < 3; c++) {
            const p = ch[c];
            const d = p[i] - (p[i - 1] + p[i + 1] + p[i - rw] + p[i + rw]) * 0.25;
            s += d; s2 += d * d; cnt++;
          }
        }
      }
      if (cnt > 20) {
        // a 4-neighbour residual has ~1.12x the std of the underlying noise
        const sigma = Math.sqrt(Math.max(0, s2 / cnt - (s / cnt) ** 2)) / 1.12;
        const rnd = mulberry32(opts.seed);
        for (let i = 0; i < n; i++) {
          if (!hole[i]) continue;
          const u = Math.max(1e-9, rnd()), v = rnd();
          const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * sigma;
          for (let c = 0; c < 3; c++) ch[c][i] += g;
        }
      }
    }

    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x;
        if (!hole[i]) continue;
        const j = ((y + y0) * w + (x + x0)) * 4;
        out.data[j] = ch[0][i]; out.data[j + 1] = ch[1][i]; out.data[j + 2] = ch[2][i];
      }
    }
    return out;
  }

  function logoMask(img, place, alpha, gain, threshold) {
    const m = new Uint8Array(img.width * img.height);
    for (let ty = 0; ty < place.size; ty++) {
      for (let tx = 0; tx < place.size; tx++) {
        if (alpha[ty * place.size + tx] * gain > threshold) m[(place.y + ty) * img.width + place.x + tx] = 1;
      }
    }
    return m;
  }

  // Robust opacity estimate. Across the star's edge the background is nearly
  // the same on both sides, so each inside/outside pixel pair gives its own
  // estimate: g = (W_in - W_out) / ((a_in - a_out) * (255 - W_out)).
  // The median over all pairs and channels ignores text, texture and edges
  // that happen to cross the logo.
  function robustGain(img, place, alpha) {
    const { width: w, height: h, data } = img;
    const s = place.size;
    const g = gradients(alpha, s, s);
    let gmax = 0;
    for (let i = 0; i < s * s; i++) gmax = Math.max(gmax, Math.hypot(g.gx[i], g.gy[i]));
    const aAt = (x, y) => {
      const tx = Math.round(x) - place.x, ty = Math.round(y) - place.y;
      return tx >= 0 && ty >= 0 && tx < s && ty < s ? alpha[ty * s + tx] : 0;
    };
    const est = [];
    const step = Math.max(2, Math.round(s / 24));
    for (let ty = 0; ty < s; ty++) {
      for (let tx = 0; tx < s; tx++) {
        const i = ty * s + tx;
        const mag = Math.hypot(g.gx[i], g.gy[i]);
        if (mag < gmax * 0.3) continue;
        const ux = g.gx[i] / mag, uy = g.gy[i] / mag; // points into the logo
        const cx = place.x + tx, cy = place.y + ty;
        const ix = Math.round(cx + ux * step), iy = Math.round(cy + uy * step);
        const ox = Math.round(cx - ux * step), oy = Math.round(cy - uy * step);
        if (ix < 0 || iy < 0 || ox < 0 || oy < 0 || ix >= w || ox >= w || iy >= h || oy >= h) continue;
        const da = aAt(ix, iy) - aAt(ox, oy);
        if (da < 0.12) continue;
        const ji = (iy * w + ix) * 4, jo = (oy * w + ox) * 4;
        for (let c = 0; c < 3; c++) {
          const room = 255 - data[jo + c];
          if (room < 25) continue;
          est.push((data[ji + c] - data[jo + c]) / (da * room));
        }
      }
    }
    if (est.length < 12) return null;
    est.sort((p, q) => p - q);
    return est[est.length >> 1];
  }

  // Sub-pixel differences between the mask and the real logo can leave a faint
  // outline along the star's edge. Re-fill that thin band from both sides and
  // keep the fill only where the pixel clearly stands out from it.
  function cleanupOutline(img, place, alpha) {
    const { width: w, height: h } = img;
    const s = place.size;
    const g = gradients(alpha, s, s);
    let gmax = 0;
    for (let i = 0; i < s * s; i++) gmax = Math.max(gmax, Math.hypot(g.gx[i], g.gy[i]));
    const band = new Uint8Array(w * h);
    let count = 0;
    for (let ty = 0; ty < s; ty++) {
      for (let tx = 0; tx < s; tx++) {
        const i = ty * s + tx;
        if (Math.hypot(g.gx[i], g.gy[i]) > gmax * 0.12) { band[(place.y + ty) * w + place.x + tx] = 1; count++; }
      }
    }
    if (!count) return { image: img, fixed: 0 };
    const filled = inpaint(img, band, { grow: 1, radius: 3, smooth: 2, grain: false });

    // local noise level from the area around the logo
    const lum = (d, j) => 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    let s2 = 0, n = 0;
    const x0 = Math.max(1, place.x - 6), x1 = Math.min(w - 2, place.x + s + 6);
    const y0 = Math.max(1, place.y - 6), y1 = Math.min(h - 2, place.y + s + 6);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x >= place.x && x < place.x + s && y >= place.y && y < place.y + s) continue;
        const j = (y * w + x) * 4;
        const d = lum(img.data, j) - (lum(img.data, j - 4) + lum(img.data, j + 4)) / 2;
        s2 += d * d; n++;
      }
    }
    const tau = Math.max(3, 2 * Math.sqrt(s2 / Math.max(1, n)));

    const out = cloneImage(img);
    const wide = dilate(band, w, h, 1);
    let fixed = 0;
    for (let y = place.y - 1; y <= place.y + s; y++) {
      for (let x = place.x - 1; x <= place.x + s; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        if (!wide[i]) continue;
        const j = i * 4;
        const diff = Math.abs(lum(img.data, j) - lum(filled.data, j));
        // leftover outlines are faint; big differences are real content (text, edges)
        if (diff <= tau || diff > Math.max(28, 5 * tau)) continue;
        // soft switch: barely-off pixels are blended, clearly-off ones replaced
        const t = Math.min(1, (diff - tau) / tau);
        for (let c = 0; c < 3; c++) out.data[j + c] = img.data[j + c] * (1 - t) + filled.data[j + c] * t;
        fixed++;
      }
    }
    return { image: out, fixed };
  }

  // ---------- one-click pipeline ----------

  // detect → reverse alpha with fitted opacity → fill pixels that can't be
  // recovered → if the logo is still visible, fill the whole logo shape from
  // the surrounding background.
  function removeOnce(img, allowAnywhere) {
    let det = detect(img);
    if (!det.found && allowAnywhere !== false) {
      const any = detectAnywhere(img); // screenshots / resized images
      if (any.found) det = any;
    }
    if (!det.found) return { found: false, score: det.score, image: cloneImage(img) };

    const place = { x: det.x, y: det.y, size: det.size };
    const alpha = getMask(det.variant, det.size);
    const rg = robustGain(img, place, alpha);
    const gain = rg != null && rg > 0.3 && rg < 1.6 ? rg : det.gain;
    const res = reverseAlpha(img, place, alpha, gain);
    let image = res.image;
    let method = 'reverse';
    if (res.unreliable) image = inpaint(image, res.bad, { grow: 1 });
    image = cleanupOutline(image, place, alpha).image;

    const residual = residualScore(image, place, alpha);
    if (Math.abs(residual) > 0.25) {
      image = inpaint(image, logoMask(img, place, alpha, gain, 0.03), { grow: 2 });
      method = 'fill';
    }
    return {
      found: true, image, method, gain, residual,
      score: det.score, variant: det.variant, x: place.x, y: place.y, size: place.size,
    };
  }

  // Images edited again in Gemini can carry more than one logo (the old one
  // gets resized, a new one is stamped). Keep removing until none is left.
  function process(img, maxLogos) {
    maxLogos = maxLogos || 3;
    const logos = [];
    let image = img, first = null, lastScore = 0;
    while (logos.length < maxLogos) {
      const res = removeOnce(image, logos.length === 0); // screenshot search only for the first logo
      lastScore = res.score;
      if (!res.found) break;
      // same spot found again means it's already as clean as we can get it
      if (logos.some((l) => Math.abs(l.x - res.x) < l.size / 2 && Math.abs(l.y - res.y) < l.size / 2)) break;
      logos.push({ x: res.x, y: res.y, size: res.size, variant: res.variant, gain: res.gain, score: res.score, method: res.method });
      if (!first) first = res;
      image = res.image;
    }
    if (!first) return { found: false, score: lastScore, image: cloneImage(img), logos };
    return Object.assign({}, first, { image, logos });
  }

  // Same removal steps as removeOnce, at a position that is already known.
  // Used for video: the logo is found once and sits at the same spot in every
  // frame. The final "fill the whole logo" step is optional because switching it
  // on for some frames and not others would flicker.
  function removeAt(img, place, variant, gain, opts) {
    // maxAlpha: where the logo is more opaque than this, recovering the pixel
    // amplifies noise (video compression) too much, so it is filled instead
    opts = Object.assign({ allowFill: false, maxAlpha: 0.9 }, opts);
    const alpha = getMask(variant, place.size);
    const res = reverseAlpha(img, place, alpha, gain);
    let image = res.image;
    let unreliable = res.unreliable;
    if (opts.maxAlpha < 0.9) {
      for (let ty = 0; ty < place.size; ty++) {
        for (let tx = 0; tx < place.size; tx++) {
          if (alpha[ty * place.size + tx] * gain < opts.maxAlpha) continue;
          const px = place.x + tx, py = place.y + ty;
          if (px >= 0 && py >= 0 && px < img.width && py < img.height && !res.bad[py * img.width + px]) {
            res.bad[py * img.width + px] = 1;
            unreliable++;
          }
        }
      }
    }
    if (unreliable) image = inpaint(image, res.bad, { grow: 1, grain: false });
    image = cleanupOutline(image, place, alpha).image;
    if (opts.allowFill && Math.abs(residualScore(image, place, alpha)) > 0.25) {
      image = inpaint(image, logoMask(img, place, alpha, gain, 0.03), { grow: 2 });
    }
    return image;
  }

  return {
    process, removeOnce, removeAt, detect, detectAnywhere, evaluate, boxEdgeScore, robustGain, reverseAlpha, residualScore, inpaint, getMask, resizeMask, cloneImage, dilate, logoMask,
    cleanupOutline,
  };
});
