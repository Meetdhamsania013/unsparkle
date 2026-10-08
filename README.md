# ✦ Unsparkle

**Remove the sparkle. Keep the magic.**

🔗 **Live: https://meetdhamsania013.github.io/unsparkle/**
Remove the corner logo from your AI images and upscale them to HD or 4K. Free, open source, and 100% in your browser. Images never leave your device.

## Features
- **One click:** drop an image and the logo is found, removed, and the background restored.
- **Finds every logo:** scans the corner at every size and position, and also removes a second, older logo left over from an earlier edit.
- **Video:** removes the Gemini/Veo logo from every frame automatically (logo found on an average of many frames, so no flicker), plus a brush for fixed logos or text. Keeps resolution, frame rate and the original sound. MP4 out (WebM if the browser can't encode MP4).
- **Batch mode:** drop many images at once. They're cleaned in the background, then **Download all (ZIP)**; click any one to edit it.
- **AI upscaling:** HD 2× or 4K with Real-ESRGAN in the browser, with a **Photo** or **Art/Anime** model (GPU via WebGPU, multi-core CPU fallback). It asks first, shows the estimated time, and can be cancelled. Phones get a safe size limit.
- **Save as** PNG, JPG or WebP with the file size shown, or **copy to clipboard**.
- **Installable and offline:** a PWA. After the first visit it works without internet.
- Light/dark/auto theme, and "Report a problem" (opens a GitHub issue, never sends the image).
- **Magic eraser:** paint over anything (a second watermark, a person, an object) and AI (MI-GAN) rebuilds the background. It falls back to content-aware fill (PatchMatch) if the AI can't run.
- **Crop:** free or 1:1, 4:5, 16:9, 9:16. **Undo** for every edit (Ctrl+Z).
- **Compare:** before/after slider over the whole image with Fit, 2× and 4× zoom (after upscaling: normal enlargement vs AI), plus a close-up. Click anywhere to inspect a spot.

## Run
Open `index.html` in a browser. There's no build step.
To publish for free, push the folder to GitHub and enable **GitHub Pages**, or use Cloudflare Pages or Vercel.
Upscaling loads the onnxruntime-web engine from jsDelivr, so the first upscale needs an internet connection.

> **Before publishing:**
> 1. Set `REPO_URL` at the top of `js/prefs.js` to your GitHub repository. It turns on the "Open source" and "Report a problem" links.
> 2. Once you know your site URL, make `og:image` / `twitter:image` in `index.html` absolute (e.g. `https://unsparkle.app/assets/og-image.png`) so share previews work everywhere.
> 3. On every release, bump `VERSION` in `sw.js` so installed copies update.
>
> **Best host:** Cloudflare Pages or Netlify. They apply `_headers`, which enables the strict security policy and **multi-core AI (about 2.3× faster upscaling)**. GitHub Pages works too, just without those headers.

## How it works
| Step | File | What happens |
|---|---|---|
| Find | `js/core.js` `detect()` | Edge-direction matching of the real logo masks at every size/gap, then checks on equal gaps and realistic opacity |
| Remove | `js/core.js` `process()` | Median opacity from pixel pairs across the logo edge, exact inverse `(W − α·255)/(1 − α)`, then outline and leftover cleanup. Repeats for extra logos |
| Erase | `js/eraser.js`, `js/fill.js` | MI-GAN inpainting on a crop around each painted area; PatchMatch fill as fallback |
| Upscale | `js/upscale.js` | Real-ESRGAN `realesr-general-x4v3` (ONNX), tiled with overlap, resized to the target |
| Background work | `js/work.js` | Runs removal in a Web Worker so the page never freezes |
| Batch ZIP | `js/zip.js` | Small dependency-free ZIP writer |
| UI | `index.html`, `css/style.css`, `js/app.js` | Upload → compare → erase/crop → upscale → download |
| Settings | `js/prefs.js`, `js/i18n.js` | Theme, install, offline, report link; all UI text |
| Offline | `sw.js`, `manifest.webmanifest` | Caches the app; AI files are cached on first use |

All UI text lives in `js/i18n.js`, ready if you ever want to add languages.

Tests: `npm test`

## Credits & licenses
- Unsparkle: MIT (`LICENSE`)
- Logo alpha masks from [gemini-watermark-remover](https://github.com/GargantuaX/gemini-watermark-remover), MIT
- [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) models (general-x4v3, animevideov3), BSD-3-Clause
- [MI-GAN](https://github.com/Picsart-AI-Research/MI-GAN) inpainting model, MIT
- [Mediabunny](https://github.com/Vanilagy/mediabunny) video reading/writing, MPL-2.0 (unmodified)
- [onnxruntime-web](https://github.com/microsoft/onnxruntime) AI engine, MIT (loaded from jsDelivr)
- Fonts: Inter and Space Grotesk, SIL Open Font License (`assets/fonts`)
- See `LICENSE-THIRD-PARTY`

## Privacy & security
- **No upload, no storage, no server.** Images are decoded and processed in the browser's memory and never leave the device. Closing the tab or clicking "Start over" frees them.
- **No login, cookies, analytics or ads.** Fonts are self-hosted, so no third party sees visitors.
- **Content-Security-Policy** (in `index.html` and `_headers`) only allows the page's own files plus the onnxruntime-web code from jsDelivr, so the page can't send data anywhere.
- **Downloads contain pixels only.** Metadata such as GPS or camera info is dropped when the image is re-encoded.

## Fair use guard
`js/guard.js` refuses stock-photo files (Shutterstock, Getty, iStock, Adobe Stock, Depositphotos, Alamy, …), detected by download filename and embedded copyright/credit metadata, before any processing. This is a best-effort check, and the fair-use terms in the app still apply.

## Responsible use
Use this only on images you have rights to. It removes the visible logo only and doesn't touch invisible watermarks such as SynthID. Not affiliated with Google.
