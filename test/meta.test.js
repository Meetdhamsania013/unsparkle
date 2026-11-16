// Run: node test/meta.test.js
// Builds small JPEG / PNG / WebP / MP4 files carrying AI metadata and checks
// that only the metadata is removed and everything else is byte-identical.
const M = require('../js/meta.js');

let failed = 0;
function check(name, ok, info) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failed++;
}
const bytes = (s) => [...Buffer.from(s, 'latin1')];
const has = (u8, s) => Buffer.from(u8).includes(Buffer.from(s, 'latin1'));
const XMP = '<x:xmpmeta><Iptc4xmpExt:DigitalSourceType>http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia</Iptc4xmpExt:DigitalSourceType><tiff:Software>Made with Google AI</tiff:Software></x:xmpmeta>';

function seg(marker, body) {
  const len = body.length + 2;
  return [0xff, marker, len >> 8, len & 255, ...body];
}

// ---------- JPEG ----------
{
  const exif = [...bytes('Exif\0\0'), 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0];
  const scan = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78];
  const jpeg = new Uint8Array([
    0xff, 0xd8,
    ...seg(0xe0, bytes('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    ...seg(0xe1, exif),
    ...seg(0xe1, bytes('http://ns.adobe.com/xap/1.0/\0' + XMP)),
    ...seg(0xe2, bytes('ICC_PROFILE\0\x01\x01fakeprofile')),
    ...seg(0xeb, bytes('JP\0\x01\0\0\0\x01jumbc2pa.claim_generator')),
    ...seg(0xed, bytes('Photoshop 3.0\08BIM')),
    ...seg(0xfe, bytes('a comment')),
    ...seg(0xdb, [0, ...new Array(64).fill(1)]),
    ...seg(0xda, [1, 1, 0, 0, 63, 0]), ...scan,
    0xff, 0xd9,
    ...bytes('trailing c2pa junk'),
  ]);
  const { bytes: out, report } = M.stripBytes(jpeg);
  check('jpeg: C2PA found', report.c2pa);
  check('jpeg: AI label found', report.aiLabel);
  check('jpeg: generator', report.generator === 'Google AI', report.generator);
  check('jpeg: XMP gone', !has(out, 'xmpmeta') && !has(out, 'trainedAlgorithmicMedia'));
  check('jpeg: C2PA gone', !has(out, 'c2pa') && !has(out, 'jumb'));
  check('jpeg: IPTC + comment gone', !has(out, 'Photoshop') && !has(out, 'a comment'));
  check('jpeg: JFIF + ICC kept', has(out, 'JFIF') && has(out, 'ICC_PROFILE'));
  const o = Buffer.from(out).indexOf(Buffer.from('Exif\0\0', 'latin1'));
  check('jpeg: rotation kept', o > 0 && out[o + 6 + 8 + 2 + 8 + 1] === 6);
  check('jpeg: scan data identical', Buffer.from(out).includes(Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, ...scan, 0xff, 0xd9])));
  check('jpeg: ends at EOI', out[out.length - 2] === 0xff && out[out.length - 1] === 0xd9);
}

// ---------- PNG ----------
{
  const chunk = (type, data) => {
    const d = bytes(type).concat(data);
    const len = data.length;
    return [len >>> 24, (len >> 16) & 255, (len >> 8) & 255, len & 255, ...d, 0, 0, 0, 0];
  };
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', new Array(13).fill(1)),
    ...chunk('iTXt', bytes('XML:com.adobe.xmp\0\0\0\0\0' + XMP)),
    ...chunk('tEXt', bytes('parameters\0stable diffusion prompt')),
    ...chunk('caBX', bytes('jumbc2pa')),
    ...chunk('iCCP', bytes('icc\0\0data')),
    ...chunk('IDAT', [1, 2, 3, 4]),
    ...chunk('IEND', []),
  ]);
  const { bytes: out, report } = M.stripBytes(png);
  check('png: C2PA + AI label found', report.c2pa && report.aiLabel && report.xmp);
  check('png: text chunks gone', !has(out, 'iTXt') && !has(out, 'tEXt') && !has(out, 'caBX'));
  check('png: image chunks kept', has(out, 'IHDR') && has(out, 'iCCP') && has(out, 'IDAT') && has(out, 'IEND'));
}

// ---------- WebP ----------
{
  const chunk = (type, data) => {
    const pad = data.length & 1 ? [0] : [];
    const n = data.length;
    return [...bytes(type), n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24, ...data, ...pad];
  };
  const vp8x = [0x0c | 0x20, 0, 0, 0, 9, 0, 0, 9, 0, 0];
  const body = [...bytes('WEBP'), ...chunk('VP8X', vp8x), ...chunk('VP8 ', [1, 2, 3]), ...chunk('EXIF', bytes('MM\0*google')), ...chunk('XMP ', bytes(XMP))];
  const n = body.length;
  const webp = new Uint8Array([...bytes('RIFF'), n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24, ...body]);
  const { bytes: out, report } = M.stripBytes(webp);
  check('webp: tags found', report.exif && report.xmp && report.aiLabel);
  check('webp: EXIF/XMP gone', !has(out, 'EXIF') && !has(out, 'XMP '));
  check('webp: flags cleared', out[20] === 0x20);
  const riff = out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24);
  check('webp: RIFF size right', riff === out.length - 8, `${riff} vs ${out.length - 8}`);
}

// ---------- MP4 ----------
(async () => {
  const box = (type, data) => { const n = data.length + 8; return [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255, ...bytes(type), ...data]; };
  const c2paId = 'd8fec3d61b0e483c92975828877ec481'.match(/../g).map((h) => parseInt(h, 16));
  const mp4 = new Uint8Array([
    ...box('ftyp', bytes('isom\0\0\0\0isom')),
    ...box('uuid', [...c2paId, ...bytes('c2pa manifest')]),
    ...box('moov', [
      ...box('mvhd', new Array(20).fill(7)),
      ...box('trak', [...box('tkhd', new Array(12).fill(5)), ...box('udta', bytes('\xa9tooGoogle'))]),
      ...box('udta', box('meta', bytes(XMP))),
    ]),
    ...box('mdat', [9, 9, 9, 9, 9, 9]),
  ]);
  const blob = new Blob([mp4]);
  const res = await M.clean(blob);
  const out = new Uint8Array(await res.blob.arrayBuffer());
  check('mp4: same size (nothing moved)', out.length === mp4.length);
  check('mp4: C2PA + AI label found', res.report.c2pa && res.report.aiLabel);
  check('mp4: metadata gone', !has(out, 'c2pa') && !has(out, 'Google') && !has(out, 'udta') && !has(out, 'uuid'));
  check('mp4: media boxes kept', has(out, 'mvhd') && has(out, 'tkhd') && Buffer.from(out).includes(Buffer.from([9, 9, 9, 9, 9, 9])));

  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
