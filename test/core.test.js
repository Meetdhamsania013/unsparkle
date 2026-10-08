// Run: node test/core.test.js
// Stamps the real Gemini logo masks onto synthetic images at Gemini's layouts
// and checks that one-click processing finds and removes them.
const C = require('../js/core.js');

let failed = 0;
function check(name, ok, info) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}

function makeImage(w, h, seed, textured) {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      const t = textured ? 25 * Math.sin(x / 5) * Math.cos(y / 7) : 0;
      data[j] = 60 + (x / w) * 120 + t + rnd() * 4;
      data[j + 1] = 90 + (y / h) * 80 + t + rnd() * 4;
      data[j + 2] = 140 - (x / w) * 60 + rnd() * 4;
      data[j + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

function stamp(img, place, alpha, gain) {
  const out = C.cloneImage(img);
  for (let ty = 0; ty < place.size; ty++) {
    for (let tx = 0; tx < place.size; tx++) {
      const a = alpha[ty * place.size + tx] * gain;
      const j = ((place.y + ty) * img.width + place.x + tx) * 4;
      for (let c = 0; c < 3; c++) out.data[j + c] = Math.round(a * 255 + (1 - a) * img.data[j + c]);
    }
  }
  return out;
}

function psnr(a, b, place, pad = 4) {
  let se = 0, n = 0;
  for (let y = place.y - pad; y < place.y + place.size + pad; y++) {
    for (let x = place.x - pad; x < place.x + place.size + pad; x++) {
      const j = (y * a.width + x) * 4;
      for (let c = 0; c < 3; c++) { const d = a.data[j + c] - b.data[j + c]; se += d * d; n++; }
    }
  }
  return se === 0 ? 99 : 10 * Math.log10((255 * 255) / (se / n));
}

const cases = [
  // [width, height, textured, variant, logo size, gap, gain]
  [1376, 768, false, 'classic', 48, 96, 0.6],
  [1024, 1024, true, 'classic', 48, 32, 1.0],
  [2752, 1536, true, 'classic', 96, 64, 1.0],
  [2816, 1536, false, '96-20260520', 96, 192, 1.0],
  [1024, 768, true, '96-20260520', 42, 82, 1.0],
];

for (const [w, h, textured, variant, size, gap, gain] of cases) {
  const label = `${w}x${h} ${variant} ${size}px gap ${gap}${textured ? ' textured' : ''}`;
  const orig = makeImage(w, h, 42, textured);
  const place = { size, x: w - gap - size, y: h - gap - size };
  const marked = stamp(orig, place, C.getMask(variant, size), gain);

  const res = C.process(marked);
  check(`${label}: found at right spot`, res.found && Math.abs(res.x - place.x) <= 1 && Math.abs(res.y - place.y) <= 1 && Math.abs(res.size - size) <= 1,
    `got ${res.x},${res.y} size ${res.size} (want ${place.x},${place.y} size ${size})`);
  const before = psnr(orig, marked, place), after = psnr(orig, res.image, place);
  check(`${label}: background restored`, after > 38, `PSNR ${before.toFixed(1)} → ${after.toFixed(1)} dB, gain ${res.gain && res.gain.toFixed(2)}`);

  const clean = C.process(orig);
  check(`${label}: clean image left alone`, !clean.found, `edge score ${clean.score.toFixed(2)}`);
}

console.log(failed ? `\n${failed} test(s) failed` : '\nAll tests passed');
process.exit(failed ? 1 : 0);
