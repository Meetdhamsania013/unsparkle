/*
 * Unsparkle – site settings: theme, install button, offline support
 * and the "Report a problem" link.
 */
(function (root) {
  'use strict';
  // ↓↓ set this to your GitHub repository after publishing ↓↓
  const REPO_URL = 'https://github.com/Meetdhamsania013/unsparkle';
  const repoSet = !/YOUR-GITHUB-NAME/.test(REPO_URL);
  const $ = (id) => document.getElementById(id);
  const t = (k, v) => root.WMI18n.t(k, v);

  function store(key, value) {
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) { /* storage blocked */ }
  }
  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  // ---------- theme: auto (follow the system) → light → dark ----------
  const THEMES = ['auto', 'light', 'dark'];
  let theme = THEMES.includes(load('unsparkle.theme')) ? load('unsparkle.theme') : 'auto';
  function applyTheme() {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    $('themeBtn').textContent = t('nav.theme.' + theme);
  }
  $('themeBtn').addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    store('unsparkle.theme', theme === 'auto' ? null : theme);
    applyTheme();
  });

  // ---------- install as an app ----------
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    $('installBtn').hidden = false;
  });
  $('installBtn').addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
    $('installBtn').hidden = true;
  });
  window.addEventListener('appinstalled', () => ($('installBtn').hidden = true));

  // ---------- offline support (needs http/https, not a file opened from disk) ----------
  if (/^https?:$/.test(location.protocol)) {
    // added here (not in the HTML) so opening the file from disk doesn't log an error
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = 'manifest.webmanifest';
    document.head.appendChild(link);
  }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Offline mode unavailable', e));
  }

  // ---------- repository links ----------
  $('repoLink').href = repoSet ? REPO_URL : '#';
  // Opens a pre-filled GitHub issue. Only browser details are included, never the image.
  function reportUrl() {
    const ctx = typeof root.WMReportContext === 'function' ? root.WMReportContext() : '';
    const body = [
      '**What happened?**', '(Describe the problem. If a logo was not removed, you can attach a screenshot yourself.)', '',
      '**Details** (filled in automatically, no image is included)',
      '- Browser: ' + navigator.userAgent,
      ctx ? '- ' + ctx : '',
    ].filter((l) => l !== null).join('\n');
    return `${REPO_URL}/issues/new?title=${encodeURIComponent('Problem: ')}&body=${encodeURIComponent(body)}`;
  }
  document.querySelectorAll('[data-report]').forEach((a) => {
    a.hidden = !repoSet;
    const wrap = a.closest('[data-report-wrap]');
    if (wrap) wrap.hidden = !repoSet;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.open(reportUrl(), '_blank', 'noopener');
    });
  });

  // ---------- FAQ pop-up (footer link) ----------
  const faq = $('faqDialog');
  if (faq) {
    document.querySelectorAll('[data-faq]').forEach((b) => b.addEventListener('click', () => faq.showModal()));
    faq.addEventListener('click', (e) => {
      const r = faq.getBoundingClientRect(); // a click on the backdrop closes it
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) faq.close();
    });
  }

  root.WMI18n.apply();
  applyTheme();
})(window);
