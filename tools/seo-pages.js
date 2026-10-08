/*
 * Builds the SEO landing pages from index.html.
 *   node tools/seo-pages.js
 * Every page is the full working tool with its own title, description, heading,
 * how-to steps and FAQ (also as structured data), plus sitemap.xml.
 * Edit the text here, then run the script again.
 */
const fs = require('fs');
const path = require('path');

const SITE = 'https://meetdhamsania013.github.io/unsparkle/';
const ROOT = path.join(__dirname, '..');
const OG_IMAGE = SITE + 'assets/og-image.png';

const PAGES = [
  {
    slug: '',
    focus: '',
    nav: 'Gemini watermark remover',
    title: 'Remove Gemini Watermark Free (Images & Videos) – Unsparkle',
    description: 'Remove the Gemini sparkle watermark from your AI images and videos in one click. Free, private and no sign-up: everything runs in your browser. Also erase objects, remove backgrounds and upscale to 4K.',
    h1: 'Remove the Gemini sparkle.<br /><span class="grad">Keep the magic.</span>',
    lead: 'Drop an AI image or video. The Gemini logo is found and erased, the real background is restored, anything else can be wiped away with the brush, and images can be upscaled to HD or 4K.',
    howTitle: 'How to remove the Gemini watermark from an image',
    steps: [
      ['Drop your image', 'Download the image from Gemini (also known as Nano Banana) and drop it on the box above, or paste it with Ctrl+V. You can drop many images at once.'],
      ['The logo is removed automatically', 'Unsparkle finds the ✦ sparkle in the corner, removes it and restores the real pixels underneath. Drag the slider to compare before and after.'],
      ['Download', 'Save it with the same file name as PNG, JPG or WebP. Before that you can erase other things with the brush, remove the background, upscale to 4K or resize for social media.'],
    ],
    faq: [
      ['Is Unsparkle free?', 'Yes. It is completely free, needs no account and adds no watermark of its own. There are no daily limits.'],
      ['Are my images uploaded to a server?', 'No. Everything runs inside your browser, so your images never leave your device. After your first visit it even works offline.'],
      ['Does it work with Nano Banana (Gemini 2.5 Flash Image)?', 'Yes. It removes the visible sparkle logo that Gemini adds to generated and edited images, including images edited twice that carry two logos, and screenshots of Gemini images.'],
      ['Will the image quality drop?', 'No. The logo is removed with reverse alpha blending, which recovers the original pixels under the semi-transparent logo. Nothing else in the image is changed.'],
      ['Does it remove SynthID?', 'No. Only the visible logo is removed. Google’s invisible SynthID marker stays in the image. Please use Unsparkle only on images you created.'],
      ['Can I clean many images at once?', 'Yes. Drop as many images as you like; they are cleaned in the background and you can download them all as one ZIP file.'],
    ],
  },
  {
    slug: 'gemini-video-watermark-remover',
    focus: 'video',
    nav: 'Video watermark remover',
    title: 'Gemini & Veo Video Watermark Remover – Free, No Upload | Unsparkle',
    description: 'Remove the Gemini sparkle watermark from Veo videos in seconds. Keeps resolution, frame rate and the original sound. Free and private: your video never leaves your browser.',
    h1: 'Remove the watermark from<br /><span class="grad">Gemini &amp; Veo videos.</span>',
    lead: 'Drop your Veo video. The sparkle logo is found and removed from every frame, with the original sound and quality kept. Fixed text or logos can be brushed away too.',
    howTitle: 'How to remove the watermark from a Gemini (Veo) video',
    steps: [
      ['Drop your video', 'Drop an MP4, WebM or MOV video made with Gemini or Veo on the box above.'],
      ['Check what will be removed', 'Unsparkle finds the logo across the whole video and marks it. To remove the “Veo” text or another logo that stays in place, paint over it with the brush.'],
      ['Create and download', 'Press ✨ Remove & create video, compare before and after with the slider and play button, then download your MP4 with the same file name.'],
    ],
    faq: [
      ['Does the video keep its quality and sound?', 'Yes. Resolution, frame rate and length stay the same, the original audio is copied unchanged and the video is encoded at the same or a slightly higher bitrate.'],
      ['How long does it take?', 'Usually seconds. An 8-second 720p Veo clip takes about 3 seconds on a normal computer.'],
      ['Is my video uploaded?', 'No. The video is processed by your own browser and never leaves your device.'],
      ['Which browsers work?', 'The latest Chrome, Edge and Safari. Firefox works too but may save the result as WebM.'],
      ['Can it remove moving objects from a video?', 'The brush is made for things that stay in place, such as logos, text and stamps. Moving objects are not supported.'],
    ],
  },
  {
    slug: 'background-remover',
    focus: 'bg',
    nav: 'Background remover',
    title: 'Free AI Background Remover – Transparent PNG in Seconds | Unsparkle',
    description: 'Remove the background from any photo with AI, free and private. Get a transparent PNG or put your subject on white, a colour or a blurred background. No sign-up, no upload.',
    h1: 'Remove the background<br /><span class="grad">in one click.</span>',
    lead: 'Drop a photo, then press ✂ Remove background in the editor. Keep it transparent, or choose white, any colour or a soft blur: perfect for products, profile pictures and stickers.',
    howTitle: 'How to remove the background from a photo',
    steps: [
      ['Drop your photo', 'Drop a photo on the box above. People, products, animals and objects all work best when the subject is clear.'],
      ['Press ✂ Remove background', 'In the editor, press ✂ Remove background. The first time, the AI model (about 88 MB) is downloaded once and then remembered by your browser.'],
      ['Choose a background and save', 'Keep it transparent or pick white, any colour or a blurred version of the original, then download as PNG or WebP.'],
    ],
    faq: [
      ['Is the background remover free?', 'Yes, completely free with no account and no limits.'],
      ['Are my photos uploaded?', 'No. The AI runs in your browser, so your photos stay on your device.'],
      ['Which format keeps the transparent background?', 'PNG and WebP keep transparency. JPG cannot be transparent, so it gets a white background.'],
      ['Can I make it the right size for Instagram or a shop?', 'Yes. In “Save as” choose a size such as Instagram post or story and a maximum file size, and it is applied when you download.'],
      ['How fast is it?', 'A few seconds on most computers with a graphics card, up to about half a minute on slower devices.'],
    ],
  },
  {
    slug: 'ai-image-upscaler',
    focus: 'upscale',
    nav: 'AI image upscaler',
    title: 'Free AI Image Upscaler – Enlarge Photos to HD & 4K | Unsparkle',
    description: 'Upscale images to HD or 4K with Real-ESRGAN AI, free and in your browser. Photo and Art/Anime modes, before/after compare, no sign-up and no upload.',
    h1: 'Upscale images to<br /><span class="grad">HD &amp; 4K with AI.</span>',
    lead: 'Drop an image and choose HD 2× or 4K in the editor. The AI adds real detail instead of blur, and you can compare normal enlargement with the AI result anywhere in the picture.',
    howTitle: 'How to upscale an image to 4K',
    steps: [
      ['Drop your image', 'Drop a photo, AI image or illustration on the box above.'],
      ['Pick Photo or Art and the size', 'Choose 📷 Photo for real photos or 🎨 Art / Anime for drawings, then HD 2× or 4K. You will see how long it will take before it starts.'],
      ['Compare and download', 'Watch it sharpen tile by tile, compare with the slider and zoom, then download.'],
    ],
    faq: [
      ['Is the AI upscaler free?', 'Yes, free with no account, no watermark and no limits.'],
      ['Which AI is used?', 'Real-ESRGAN, a well-known open-source upscaler, with a model for photos and one for art and anime.'],
      ['Are my images uploaded?', 'No. Upscaling happens in your browser and your images stay on your device.'],
      ['How long does 4K take?', 'From a few seconds with a graphics card to a few minutes on a slow computer. The time is shown before you start and you can cancel at any moment.'],
      ['Does it work on phones?', 'Yes, with a size limit that fits the phone’s memory so the page does not crash.'],
    ],
  },
  {
    slug: 'remove-objects-from-photo',
    focus: 'erase',
    nav: 'Remove objects from photos',
    title: 'Remove Objects from Photos Free – AI Magic Eraser | Unsparkle',
    description: 'Erase people, objects, text or a second watermark from any photo with an AI magic eraser. Paint over it and the background is rebuilt. Free, private, no upload.',
    h1: 'Erase anything<br /><span class="grad">from your photos.</span>',
    lead: 'Drop a photo, press 🖌 Erase in the editor and paint over what you want gone. The AI rebuilds the background so no one can tell it was there.',
    howTitle: 'How to remove an object from a photo',
    steps: [
      ['Drop your photo', 'Drop the photo on the box above.'],
      ['Paint over the object', 'Press 🖌 Erase and paint over the object, text or logo with a little margin. Zoom in for small details.'],
      ['Press ✨ Erase and download', 'The AI fills the area with matching background. Undo if you want to try again, then download.'],
    ],
    faq: [
      ['Is the magic eraser free?', 'Yes, completely free with no account.'],
      ['What can I remove?', 'People, objects, text, stamps, logos and leftover watermarks. Large objects on complex backgrounds may need two passes.'],
      ['Are my photos uploaded?', 'No. The AI eraser runs in your browser and your photos never leave your device.'],
      ['Can I undo?', 'Yes, every edit can be undone with the Undo button or Ctrl+Z.'],
    ],
  },
  {
    slug: 'resize-image-for-social-media',
    focus: 'save',
    nav: 'Resize for social media',
    title: 'Resize Images for Instagram, YouTube & WhatsApp – Free | Unsparkle',
    description: 'Resize and compress images for Instagram posts and stories, YouTube thumbnails, WhatsApp status, Facebook, LinkedIn, X and Pinterest. Fit or fill, size limits, PNG/JPG/WebP. Free and private.',
    h1: 'Perfect sizes for<br /><span class="grad">every social network.</span>',
    lead: 'Drop an image and choose a size in “Save as”: Instagram post or story, YouTube thumbnail, WhatsApp status and more. Set a maximum file size and download.',
    howTitle: 'How to resize an image for Instagram, YouTube or WhatsApp',
    steps: [
      ['Drop your image', 'Drop one image, or many at once for a batch.'],
      ['Choose the size', 'In “Save as” pick a preset such as Instagram portrait 1080×1350 or YouTube thumbnail 1280×720, then Fill (crop) or Fit (whole image with a soft background).'],
      ['Set a file size and download', 'Optionally choose a maximum file size like 1 MB or 500 KB and a format, then download. A batch downloads as one ZIP.'],
    ],
    faq: [
      ['Which sizes are included?', 'Instagram post 1080×1080 and portrait 1080×1350, Story / Reel / WhatsApp status 1080×1920, YouTube thumbnail 1280×720, Facebook 1200×630, LinkedIn 1200×627, X 1600×900, Pinterest 1000×1500 and Full HD.'],
      ['What is the difference between Fill and Fit?', 'Fill crops the image to fill the whole frame. Fit keeps the whole image and fills the empty space with a soft blurred copy.'],
      ['How does the file size limit work?', 'Quality is lowered only as much as needed to stay under the limit, and the picture is made smaller only if that is not enough.'],
      ['Is it free and private?', 'Yes. It is free, needs no account, and your images never leave your device.'],
    ],
  },
];

const esc = (t) => String(t).replace(/&(?!amp;|lt;|gt;|quot;|#)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = (h) => h.replace(/<br \/>/g, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');

function head(p) {
  const url = SITE + (p.slug ? p.slug + '/' : '');
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication', name: 'Unsparkle', url, applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Any (web browser)', isAccessibleForFree: true, description: p.description,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
      {
        '@type': 'HowTo', name: p.howTitle,
        step: p.steps.map(([name, text], i) => ({ '@type': 'HowToStep', position: i + 1, name, text })),
      },
      {
        '@type': 'FAQPage',
        mainEntity: p.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
      },
    ],
  };
  return `  <title>${esc(p.title)}</title>
  <meta name="description" content="${esc(p.description)}" />
  <meta name="theme-color" content="#0b0d17" />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <link rel="icon" href="assets/logo.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="assets/apple-touch-icon.png" />

  <!-- search engines and share previews (WhatsApp, X, LinkedIn, Facebook) -->
  <link rel="canonical" href="${url}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Unsparkle" />
  <meta property="og:title" content="${esc(p.title)}" />
  <meta property="og:description" content="${esc(p.description)}" />
  <meta property="og:image" content="${OG_IMAGE}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(p.title)}" />
  <meta name="twitter:description" content="${esc(p.description)}" />
  <meta name="twitter:image" content="${OG_IMAGE}" />
  <script type="application/ld+json">${JSON.stringify(ld)}</script>
`;
}

function hero(p) {
  return `        <h1>${p.h1}</h1>
        <p class="lead">${esc(p.lead)}</p>
`;
}

function content(p) {
  const steps = p.steps.map(([n, t]) => `          <li><b>${esc(n)}</b><span>${esc(t)}</span></li>`).join('\n');
  const faq = p.faq.map(([q, a]) => `          <details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n');
  return `<section class="seo" aria-labelledby="howto-title">
        <h2 id="howto-title">${esc(p.howTitle)}</h2>
        <ol class="howto">
${steps}
        </ol>
        <h2>Frequently asked questions</h2>
        <div class="faq">
${faq}
        </div>
      </section>`;
}

function tools(current) {
  const links = PAGES.map((p) => (p === current
    ? `<span aria-current="page">${esc(p.nav)}</span>`
    : `<a href="${p.slug ? p.slug + '/' : './'}">${esc(p.nav)}</a>`)).join(' · ');
  return `<nav class="tools-nav" aria-label="Tools">${links}</nav>`;
}

function swap(html, name, value) {
  const re = new RegExp(`(<!--seo:${name}-->)[\\s\\S]*?(<!--/seo:${name}-->)`);
  if (!re.test(html)) throw new Error('marker missing: ' + name);
  return html.replace(re, `$1${value.startsWith('\n') || !value.includes('\n') ? value : '\n' + value}$2`);
}

const template = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const today = new Date().toISOString().slice(0, 10);
for (const p of PAGES) {
  let html = template;
  html = swap(html, 'head', '\n' + head(p) + '  ');
  html = swap(html, 'hero', '\n' + hero(p) + '        ');
  html = swap(html, 'content', content(p));
  html = swap(html, 'tools', tools(p));
  // sub-pages load everything from the site root
  html = swap(html, 'base', p.slug ? '<base href="../" />' : '');
  html = html.replace(/<body data-focus="[^"]*">/, `<body data-focus="${p.focus}">`);
  const out = p.slug ? path.join(ROOT, p.slug, 'index.html') : path.join(ROOT, 'index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log('wrote', path.relative(ROOT, out), '-', plain(p.h1));
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.map((p) => `  <url><loc>${SITE}${p.slug ? p.slug + '/' : ''}</loc><lastmod>${today}</lastmod><priority>${p.slug ? '0.8' : '1.0'}</priority></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap);
fs.writeFileSync(path.join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);
console.log('wrote sitemap.xml and robots.txt');
