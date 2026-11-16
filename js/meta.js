/*
 * Unsparkle – AI tag remover. Removes the hidden metadata that marks a file as
 * AI-made (C2PA "Content Credentials", the IPTC "trainedAlgorithmicMedia"
 * label in XMP/IPTC, EXIF/XMP generator text) without touching the pixels or
 * re-encoding anything.
 *
 *   JPEG  drops APP1 (EXIF, XMP), APP11 (C2PA/JUMBF), APP13 (IPTC), comments and
 *         other APPn blocks; keeps JFIF, the ICC colour profile and Adobe colour
 *         info. The EXIF rotation is kept so photos don't turn sideways.
 *   PNG   drops tEXt/iTXt/zTXt/eXIf/caBX (C2PA) chunks.
 *   WebP  drops EXIF, XMP and C2PA chunks and clears their flags.
 *   MP4/MOV  turns uuid (C2PA, XMP), meta and udta boxes into "free" padding of
 *         the same size, so nothing moves and the video/audio are untouched.
 *
 * What it can't remove: invisible watermarks inside the pixels themselves
 * (such as Google's SynthID). Those are part of the image, not metadata.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMMeta = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- what did we find ----------

  const GENERATORS = [
    ['Google AI', /made with google ai|google\s*(llc|ai)|gemini|imagen|nano\s*banana|\bveo\b|synthid/i],
    ['OpenAI', /openai|dall[\s·-]?e|chatgpt|sora/i],
    ['Adobe Firefly', /firefly/i],
    ['Midjourney', /midjourney/i],
    ['Stable Diffusion', /stable\s*diffusion|stability\s*ai|comfyui|automatic1111|sd-?xl/i],
    ['Microsoft Designer', /microsoft designer|bing image creator/i],
    ['Meta AI', /meta ai|imagine with meta/i],
    ['Runway', /runwayml|runway gen/i],
    ['Kling', /kling/i],
    ['Flux', /\bflux(\.1)?\b|black forest labs/i],
  ];

  function newReport() {
    return { c2pa: false, aiLabel: false, exif: false, xmp: false, iptc: false, text: false, generator: null, removed: 0 };
  }

  function latin1(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(u8.length, i + 8192)));
    return s;
  }

  // Look inside a removed block for the AI label and the tool that made it.
  function inspect(report, bytes) {
    report.removed += bytes.length;
    const s = latin1(bytes.length > 4e6 ? bytes.subarray(0, 4e6) : bytes);
    if (/c2pa|jumbf|contentauth|c2pa\.actions|claim_generator/i.test(s)) report.c2pa = true;
    if (/trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|algorithmicMedia|AI[\s-]generated|ai_generated|DigitalSourceType/i.test(s)) report.aiLabel = true;
    if (!report.generator) {
      for (const [name, re] of GENERATORS) if (re.test(s)) { report.generator = name; break; }
    }
  }

  // ---------- JPEG ----------

  const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"

  function startsWith(u8, at, sig) {
    if (at + sig.length > u8.length) return false;
    for (let i = 0; i < sig.length; i++) if (u8[at + i] !== (typeof sig === 'string' ? sig.charCodeAt(i) : sig[i])) return false;
    return true;
  }

  // EXIF orientation (1–8), or 0 if not present.
  function exifOrientation(u8, at, end) {
    const t = at + 6; // TIFF header
    if (t + 8 > end) return 0;
    const le = u8[t] === 0x49;
    const r16 = (o) => (le ? u8[o] | (u8[o + 1] << 8) : (u8[o] << 8) | u8[o + 1]);
    const r32 = (o) => (le ? (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0 : ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0);
    const ifd = t + r32(t + 4);
    if (ifd + 2 > end) return 0;
    const n = r16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > end) break;
      if (r16(e) === 0x0112) { const v = r16(e + 8); return v >= 1 && v <= 8 ? v : 0; }
    }
    return 0;
  }

  // A tiny EXIF block holding only the orientation.
  function orientationSegment(o) {
    const tiff = [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0, 0, 0];
    const body = EXIF_ID.concat(tiff);
    const len = body.length + 2;
    return new Uint8Array([0xff, 0xe1, len >> 8, len & 255].concat(body));
  }

  function keepJpegSegment(marker, u8, at) {
    if (marker === 0xe0) return startsWith(u8, at, 'JFIF\0') || startsWith(u8, at, 'JFXX\0');
    if (marker === 0xe2) return startsWith(u8, at, 'ICC_PROFILE\0');
    if (marker === 0xee) return startsWith(u8, at, 'Adobe');
    return false;
  }

  function stripJpeg(u8, report) {
    if (u8[0] !== 0xff || u8[1] !== 0xd8) throw new Error('Not a JPEG file.');
    const parts = [u8.subarray(0, 2)];
    let p = 2, orientation = 0, wroteOrientation = false, inScan = false;
    while (p < u8.length) {
      if (inScan) {
        // entropy-coded data: copy up to the next real marker
        const s = p;
        while (p < u8.length - 1 && !(u8[p] === 0xff && u8[p + 1] !== 0 && !(u8[p + 1] >= 0xd0 && u8[p + 1] <= 0xd7) && u8[p + 1] !== 0xff)) p++;
        if (p >= u8.length - 1) { parts.push(u8.subarray(s)); p = u8.length; break; }
        parts.push(u8.subarray(s, p));
        inScan = false;
        continue;
      }
      if (u8[p] !== 0xff) throw new Error('Damaged JPEG file.');
      while (u8[p + 1] === 0xff) p++; // fill bytes
      const m = u8[p + 1];
      if (m === 0xd9) { parts.push(u8.subarray(p, p + 2)); p += 2; break; } // end of the main image
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { parts.push(u8.subarray(p, p + 2)); p += 2; continue; }
      const len = (u8[p + 2] << 8) | u8[p + 3];
      const end = p + 2 + len;
      if (end > u8.length) throw new Error('Damaged JPEG file.');
      const body = p + 4;
      const isMeta = (m >= 0xe0 && m <= 0xef) || m === 0xfe;
      if (isMeta && !keepJpegSegment(m, u8, body)) {
        const seg = u8.subarray(body, end);
        if (m === 0xe1 && startsWith(u8, body, EXIF_ID)) { report.exif = true; orientation = orientation || exifOrientation(u8, body, end); }
        else if (m === 0xe1) report.xmp = true;
        else if (m === 0xeb) report.c2pa = true;
        else if (m === 0xed) report.iptc = true;
        else report.text = true;
        inspect(report, seg);
      } else {
        if (!wroteOrientation && orientation > 1 && !(m >= 0xe0 && m <= 0xef)) {
          parts.push(orientationSegment(orientation));
          wroteOrientation = true;
        }
        parts.push(u8.subarray(p, end));
      }
      p = end;
      if (m === 0xda) inScan = true;
    }
    // Anything after the main image (a second "gain map" picture, C2PA data
    // appended by some tools) is dropped too.
    if (p < u8.length) inspect(report, u8.subarray(p));
    return parts;
  }

  // ---------- PNG ----------

  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'caBX', 'tIME', 'dSIG']);

  function stripPng(u8, report) {
    if (!startsWith(u8, 0, PNG_SIG)) throw new Error('Not a PNG file.');
    const parts = [u8.subarray(0, 8)];
    let p = 8;
    while (p + 12 <= u8.length) {
      const len = ((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0;
      const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      const end = p + 12 + len;
      if (end > u8.length) throw new Error('Damaged PNG file.');
      if (PNG_DROP.has(type)) {
        const data = u8.subarray(p + 8, p + 8 + len);
        if (type === 'caBX') report.c2pa = true;
        else if (type === 'eXIf') report.exif = true;
        else if (/XML:com\.adobe\.xmp/.test(latin1(data.subarray(0, 40)))) report.xmp = true;
        else if (type !== 'tIME') report.text = true;
        inspect(report, data);
      } else {
        parts.push(u8.subarray(p, end));
      }
      p = end;
      if (type === 'IEND') break;
    }
    return parts;
  }

  // ---------- WebP ----------

  const WEBP_KEEP = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);

  function stripWebp(u8, report) {
    if (!startsWith(u8, 0, 'RIFF') || !startsWith(u8, 8, 'WEBP')) throw new Error('Not a WebP file.');
    const kept = [];
    let p = 12, size = 4;
    const riffEnd = Math.min(u8.length, 8 + (((u8[4] | (u8[5] << 8) | (u8[6] << 16) | (u8[7] << 24)) >>> 0)));
    while (p + 8 <= riffEnd) {
      const type = String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
      const len = (u8[p + 4] | (u8[p + 5] << 8) | (u8[p + 6] << 16) | (u8[p + 7] << 24)) >>> 0;
      const end = Math.min(riffEnd, p + 8 + len + (len & 1));
      if (WEBP_KEEP.has(type)) {
        let chunk = u8.subarray(p, end);
        if (type === 'VP8X') { chunk = chunk.slice(); chunk[8] &= ~0x0c; } // clear the EXIF + XMP flags
        kept.push(chunk);
        size += chunk.length;
      } else {
        if (type === 'EXIF') report.exif = true;
        else if (type === 'XMP ') report.xmp = true;
        else if (/C2PA/i.test(type)) report.c2pa = true;
        else report.text = true;
        inspect(report, u8.subarray(p + 8, Math.min(end, p + 8 + len)));
      }
      p = end;
    }
    const head = new Uint8Array(12);
    head.set(u8.subarray(0, 12));
    head[4] = size & 255; head[5] = (size >> 8) & 255; head[6] = (size >> 16) & 255; head[7] = (size >>> 24) & 255;
    return [head].concat(kept);
  }

  // ---------- MP4 / MOV (ISO base media) ----------

  const C2PA_UUID = 'd8fec3d61b0e483c92975828877ec481';
  const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac';

  function hex(u8, at, n) {
    let s = '';
    for (let i = 0; i < n; i++) s += (u8[at + i] | 0x100).toString(16).slice(1);
    return s;
  }

  // Boxes inside `u8[from, to)`: [{ at, head, size, type }]
  function boxes(u8, from, to) {
    const out = [];
    let p = from;
    while (p + 8 <= to) {
      let size = ((u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]) >>> 0;
      const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      let head = 8;
      if (size === 1) { size = Number(new DataView(u8.buffer, u8.byteOffset + p + 8, 8).getBigUint64(0)); head = 16; }
      else if (size === 0) size = to - p;
      if (size < head || p + size > to) break;
      out.push({ at: p, head, size, type });
      p += size;
    }
    return out;
  }

  // Overwrite a box with a "free" box of the same size (players skip it).
  function blank(u8, b, report) {
    inspect(report, u8.subarray(b.at + b.head, b.at + b.size));
    if (b.type === 'uuid') {
      const id = hex(u8, b.at + b.head, 16);
      if (id === C2PA_UUID) report.c2pa = true;
      else if (id === XMP_UUID) report.xmp = true;
      else report.text = true;
    } else report.text = true;
    u8.set([0x66, 0x72, 0x65, 0x65], b.at + 4); // "free"
    u8.fill(0, b.at + b.head, b.at + b.size);
  }

  // Clean a moov box in place (udta/meta/uuid at movie and track level).
  function cleanMoov(u8, from, to, report) {
    for (const b of boxes(u8, from, to)) {
      if (b.type === 'udta' || b.type === 'meta' || b.type === 'uuid') blank(u8, b, report);
      else if (b.type === 'trak') cleanMoov(u8, b.at + b.head, b.at + b.size, report);
    }
  }

  // Works on a File/Blob without loading the (possibly huge) media data:
  // only the small boxes are read and patched.
  async function stripMp4(file, report) {
    const read = async (a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer());
    const parts = [];
    let p = 0, last = 0, found = false;
    while (p + 8 <= file.size) {
      const h = await read(p, Math.min(file.size, p + 16));
      let size = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
      const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
      let head = 8;
      if (size === 1 && h.length >= 16) { size = Number(new DataView(h.buffer).getBigUint64(8)); head = 16; }
      else if (size === 0) size = file.size - p;
      if (size < head || p + size > file.size) break;
      if (p === 0 && type !== 'ftyp') throw new Error('Not an MP4/MOV file.');
      found = true;
      const touch = type === 'moov' || type === 'uuid' || type === 'meta' || type === 'udta';
      if (touch && size < 256e6) {
        const box = await read(p, p + size);
        const b = { at: 0, head, size, type };
        if (type === 'moov') cleanMoov(box, head, size, report);
        else blank(box, b, report);
        parts.push(file.slice(last, p), box);
        last = p + size;
      }
      p += size;
    }
    if (!found) throw new Error('Not an MP4/MOV file.');
    parts.push(file.slice(last));
    return parts;
  }

  // ---------- public ----------

  function kindOf(u8, name, type) {
    if (u8[0] === 0xff && u8[1] === 0xd8) return 'jpeg';
    if (startsWith(u8, 0, PNG_SIG)) return 'png';
    if (startsWith(u8, 0, 'RIFF') && startsWith(u8, 8, 'WEBP')) return 'webp';
    if (startsWith(u8, 4, 'ftyp')) {
      const brand = latin1(u8.subarray(8, 12));
      if (/^(avif|avis|heic|heix|mif1|msf1|hevc)/.test(brand)) return 'heif';
      return 'mp4';
    }
    return null;
  }

  const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

  /** Strip from bytes already in memory (images). Returns { bytes, report }. */
  function stripBytes(u8) {
    const report = newReport();
    const kind = kindOf(u8);
    const parts = kind === 'jpeg' ? stripJpeg(u8, report) : kind === 'png' ? stripPng(u8, report) : kind === 'webp' ? stripWebp(u8, report) : null;
    if (!parts) throw new Error('Unsupported file type.');
    let n = 0;
    for (const x of parts) n += x.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const x of parts) { out.set(x, o); o += x.length; }
    return { bytes: out, report, kind };
  }

  /**
   * Remove AI metadata from a File/Blob. Never re-encodes.
   * @returns {Promise<{blob: Blob, report: object, kind: string}>}
   */
  async function clean(file) {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const kind = kindOf(head);
    if (kind === 'mp4') {
      const report = newReport();
      const parts = await stripMp4(file, report);
      const mime = /quicktime/.test(file.type) ? 'video/quicktime' : file.type && file.type.startsWith('video/') ? file.type : 'video/mp4';
      return { blob: new Blob(parts, { type: mime }), report, kind };
    }
    if (!MIME[kind]) {
      const e = new Error('unsupported');
      e.unsupported = true;
      throw e;
    }
    const res = stripBytes(new Uint8Array(await file.arrayBuffer()));
    return { blob: new Blob([res.bytes], { type: MIME[kind] }), report: res.report, kind };
  }

  function anyFound(r) {
    return r.c2pa || r.aiLabel || r.exif || r.xmp || r.iptc || r.text;
  }

  return { clean, stripBytes, anyFound, _test: { stripMp4, kindOf } };
});
