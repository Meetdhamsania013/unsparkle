/*
 * Unsparkle – all user-facing text in one place (English). To add a language
 * later, copy the `en` block, translate the values (keep the {placeholders}),
 * add it to LANGS and add a language picker.
 * Elements use data-i18n="key" (text) or data-i18n-html="key" (simple markup).
 */
(function (root) {
  'use strict';

  const en = {
    'nav.private': '🔒 Private',
    'nav.os': '★ Open source',
    'nav.install': '⬇ Install app',
    'nav.theme.auto': '◐ Auto',
    'nav.theme.light': '☀ Light',
    'nav.theme.dark': '☾ Dark',
    'hero.eyebrow': 'Free · No sign-up · Runs on your device',
    'hero.title': 'Remove the sparkle.<br /><span class="grad">Keep the magic.</span>',
    'hero.lead': 'Drop an AI image. The corner logo is found and erased, the real background is restored, and you can upscale to HD or 4K with one click.',
    'drop.title': 'Drop your images here',
    'drop.sub': 'one or many · or <u>browse</u> · paste with <kbd>Ctrl</kbd>+<kbd>V</kbd> · PNG, JPG, WebP',
    'blocked.title': "We can't process this image",
    'blocked.hint': "Unsparkle only removes the AI sparkle logo from images you created yourself. Removing watermarks from stock photos or other people's work breaks copyright law, so we don't support it.",
    'blocked.byName': 'This looks like a {agency} image (from its file name).',
    'blocked.byMeta': 'This file contains {agency} copyright information.',
    'notice': 'For <b>your own AI images</b> only. Stock-photo watermarks (Shutterstock, Getty, iStock, Adobe Stock…) are not supported.',
    'link.fair': 'Fair use',
    'link.privacy': 'Privacy',
    'link.report': 'Report a problem',
    'feat1.t': 'Finds every logo',
    'feat1.p': 'Scans the corner at every size and position, and catches a second logo left over from an earlier edit.',
    'feat2.t': 'Restores the real pixels',
    'feat2.p': 'Reverses the overlay mathematically, then blends any leftovers into the background around them.',
    'feat3.t': 'AI upscale to 4K',
    'feat3.p': 'Real-ESRGAN running in your browser adds real sharpness instead of blur.',
    'busy.find': 'Finding the watermark…',
    'busy.open': 'Opening…',
    'batch.images': '{n} images',
    'batch.image': '1 image',
    'batch.add': '＋ Add more',
    'batch.clear': 'Clear all',
    'batch.zip': '⬇ Download all (ZIP)',
    'batch.preparing': 'Preparing {k} / {n}…',
    'batch.zipping': 'Zipping…',
    'batch.hint': 'Click an image to compare, erase, crop or upscale it. Your edits are kept in the ZIP.',
    'batch.cleaned': '{n} cleaned',
    'batch.none': '{n} without a logo',
    'batch.refused': '{n} refused (stock photos)',
    'batch.left': '{n} in progress…',
    'badge.queued': 'Waiting…',
    'badge.working': 'Removing…',
    'badge.done': '✓ Watermark removed',
    'badge.doneMany': '✓ {n} logos removed',
    'badge.none': 'No logo found',
    'badge.editedTag': 'Edited',
    'save.backTitle': 'Save changes',
    'save.backSub': 'and go back to all images',
    'leave.title': 'Save your changes?',
    'leave.text': 'You edited this image. Save the changes before going back to all images?',
    'leave.stay': 'Keep editing',
    'leave.discard': 'Discard',
    'leave.save': 'Save changes',
    'toast.saved': '✓ Changes saved for {name}',
    'badge.remove': 'Remove from the list',
    'back': 'All images ({n})',
    'step.clean': 'Clean',
    'step.upscale': 'Upscale <em>(optional)</em>',
    'step.download': 'Download',
    'status.removed': '✓ Watermark removed',
    'status.removedMany': '✓ {n} watermarks removed',
    'status.edited': '✓ Edited',
    'status.upscaled': '✓ Upscaled to {w} × {h}',
    'status.none': 'No AI sparkle logo found, so nothing was changed. You can still edit or upscale it. (Other watermarks, like stock-photo ones, are not removed.)',
    'panel.full': 'Full image',
    'tool.erase': '🖌 Erase',
    'tool.crop': '✂ Crop',
    'tool.undo': '↶ Undo',
    'zoom.fit': 'Fit',
    'brush.hint': 'Paint over what you want gone',
    'brush.size': 'Size',
    'brush.clear': 'Clear',
    'brush.apply': '✨ Erase',
    'brush.done': 'Done',
    'crop.free': 'Free',
    'crop.cancel': 'Cancel',
    'crop.apply': '✓ Apply crop',
    'hint.compare': 'Drag to compare · drag the square (or click anywhere) to move the close-up · Fit/2×/4× to zoom',
    'hint.brush': 'Paint over anything you want gone, then press ✨ Erase. Zoom in for small details.',
    'hint.crop': 'Drag the box or its corners, pick a ratio, then press ✓ Apply crop.',
    'tag.before': 'Before',
    'tag.after': 'After',
    'tag.normal': 'Normal enlarge',
    'tag.ai': 'AI upscaled',
    'panel.closeup': 'Close-up',
    'zoom.inspect': 'Drag here or the square to move · scroll to zoom',
    'zoom.quality': 'Quality check · drag to move · scroll to zoom',
    'panel.upscale': 'Upscale with AI',
    'model.photo': '📷 Photo',
    'model.art': '🎨 Art / Anime',
    'model.hint': 'Photo: real photos, people, products · Art: drawings, anime, cartoons, logos',
    'model.photoName': 'Photo',
    'model.artName': 'Art / Anime',
    'confirm.model': '{icon} Model: {name}',
    'up.tooLarge': 'too large for this device',
    'up.already4k': 'already 4K',
    'panel.save': 'Save as',
    'save.name': 'File name',
    'save.download': '⬇ Download',
    'save.copy': '📋 Copy',
    'save.copied': '✓ Copied',
    'save.copyFail': '✕ Not allowed',
    'again': '↺ Start over with another image',
    'confirm.title2': 'Upscale to HD (2×)?',
    'confirm.title4': 'Upscale to 4K?',
    'confirm.from': 'from {w} × {h}',
    'confirm.timeMeasured': '⏱ Takes {t} on this device',
    'confirm.timeGpu': '⏱ Usually {t} if your browser can use the graphics card, up to {slow} without it',
    'confirm.timeCpu': '⏱ Takes {t} on this device',
    'confirm.ai': '🧠 The AI redraws fine details on your own device. Nothing is uploaded.',
    'confirm.tab': '💡 Keep this tab open while it works. You can cancel any time.',
    'confirm.limit': "📱 Limited to this size so it fits in this device's memory.",
    'confirm.no': 'Not now',
    'confirm.start': 'Start upscaling',
    'time.few': 'a few seconds',
    'time.underMin': 'under a minute',
    'time.oneMin': 'about 1 minute',
    'time.mins': 'about {n} minutes',
    'time.left': '{t} left',
    'work.loading': 'Loading AI…',
    'work.firstTime': 'Loading the model (first time only)',
    'work.starting': 'Starting the AI…',
    'work.adding': 'AI is adding detail… {w} × {h}',
    'work.working': 'Working…',
    'work.cancel': 'Cancel',
    'work.erasing': 'Erasing…',
    'work.rebuilding': 'AI is rebuilding the background',
    'up.done': '✓ Done: {w} × {h}',
    'up.cancelled': 'Upscaling cancelled.',
    'up.failed': 'Upscaling failed: {e}',
    'erase.failed': 'Erasing failed: {e}',
    'read.failed': 'Could not read this image.',
    'footer': 'Free &amp; open source (MIT) · Not affiliated with Google',
    'privacy.title': '🔒 Your images stay on your device',
    'privacy.1': '<b>No upload.</b> Your image is processed by your own browser. It is never sent to us or anyone else. There is no server.',
    'privacy.2': "<b>No storage.</b> Nothing is saved, not on a server and not on your computer. Close or refresh the tab and it's gone. \"Start over\" clears it immediately.",
    'privacy.3': '<b>No account, no cookies, no tracking.</b> No login, no analytics, no ads.',
    'privacy.4': "<b>Locked down.</b> A strict security policy blocks the page from sending data anywhere. You can check the source code yourself because it's open source.",
    'privacy.5': '<b>Clean downloads.</b> Saved images contain only pixels. Hidden metadata such as location or camera details is removed.',
    'privacy.note': 'The only things downloaded from the internet are program code: the AI engine (onnxruntime-web, from jsDelivr) the first time you upscale or erase. Your images are never part of that.',
    'fair.title': '⚖️ Fair use',
    'fair.intro': 'Unsparkle removes the small sparkle logo that AI image tools put on images <b>you</b> generated.',
    'fair.ok': '✓ Your own AI-generated images',
    'fair.no1': '✕ Stock photos (Shutterstock, Getty Images, iStock, Adobe Stock, Depositphotos, Alamy and similar). These are refused automatically.',
    'fair.no2': "✕ Other people's photos, artwork or watermarked work",
    'fair.no3': '✕ Passing off AI images as real photos, or as made without AI',
    'fair.note': "Only the visible logo is removed. Invisible AI markers such as Google's SynthID stay in the image. Please be open about using AI where it matters.",
  };

  const LANGS = { en: { name: 'English', dict: en } };
  const KEY = 'unsparkle.lang';

  function initial() {
    try { const s = localStorage.getItem(KEY); if (s && LANGS[s]) return s; } catch (e) { /* storage blocked */ }
    const nav = (navigator.language || 'en').slice(0, 2);
    return LANGS[nav] ? nav : 'en';
  }

  let lang = initial();

  function t(key, vars) {
    let s = (LANGS[lang].dict[key] != null ? LANGS[lang].dict[key] : en[key]);
    if (s == null) return key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return s;
  }

  function apply(rootEl) {
    const scope = rootEl || document;
    scope.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
    scope.querySelectorAll('[data-i18n-html]').forEach((n) => { n.innerHTML = t(n.dataset.i18nHtml); }); // our own strings only
    scope.querySelectorAll('[data-i18n-title]').forEach((n) => { n.title = t(n.dataset.i18nTitle); });
    document.documentElement.lang = lang;
  }

  function set(code) {
    if (!LANGS[code]) return;
    lang = code;
    try { localStorage.setItem(KEY, code); } catch (e) { /* storage blocked */ }
    apply();
    document.dispatchEvent(new CustomEvent('langchange'));
  }

  root.WMI18n = { t, set, apply, get lang() { return lang; }, langs: Object.keys(LANGS).map((k) => [k, LANGS[k].name]) };
})(window);
