/*
 * Unsparkle – fair-use guard.
 * Unsparkle only removes the AI sparkle logo from images people made themselves.
 * Stock-photo sites mark their files in two ways we can check without any upload:
 * the download filename (e.g. "shutterstock_123.jpg") and the credit/copyright
 * text embedded in the file's metadata (EXIF / IPTC / XMP).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMGuard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AGENCIES = [
    ['Shutterstock', /shutter\s?stock/i],
    ['Getty Images', /getty\s?images|gettyimages/i],
    ['iStock', /\bistock(photo)?\b|istockphoto|(^|[^a-z])istock[-_]/i],
    ['Adobe Stock', /adobe\s?stock|adobestock/i],
    ['Depositphotos', /deposit\s?photos/i],
    ['Dreamstime', /dreamstime/i],
    ['123RF', /(^|[^a-z0-9])123rf([^a-z]|$)/i],
    ['Alamy', /(^|[^a-z])alamy([^a-z]|$)/i],
    ['Stocksy', /stocksy/i],
    ['Pond5', /pond5/i],
    ['Bigstock', /bigstock/i],
    ['Freepik', /freepik/i],
    ['Envato', /envato/i],
    ['Vecteezy', /vecteezy/i],
    ['Can Stock Photo', /can\s?stock\s?photo|canstockphoto/i],
    ['Westend61', /westend61/i],
    ['Masterfile', /masterfile/i],
  ];

  function match(text) {
    for (const [name, re] of AGENCIES) if (re.test(text)) return name;
    return null;
  }

  // Metadata lives near the start of JPEG/PNG/WebP files; reading the first
  // 512 KB is enough and keeps it instant.
  async function readHead(file, bytes) {
    const buf = await file.slice(0, bytes).arrayBuffer();
    const u8 = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return s;
  }

  /**
   * @returns {Promise<{ok: true} | {ok: false, agency: string, where: 'name' | 'metadata'}>}
   */
  async function check(file) {
    const byName = match(file.name || '');
    if (byName) return { ok: false, agency: byName, where: 'name' };
    try {
      const byMeta = match(await readHead(file, 512 * 1024));
      if (byMeta) return { ok: false, agency: byMeta, where: 'metadata' };
    } catch (e) { /* unreadable: fall through */ }
    return { ok: true };
  }

  return { check, match };
});
