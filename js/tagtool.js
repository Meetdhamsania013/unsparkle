/*
 * Unsparkle – AI tag remover (the separate tool on the start page).
 * Removes only the hidden AI metadata (see meta.js). Pixels, quality, size
 * and the file name stay exactly the same.
 */
(function (root) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const tr = (key, vars) => root.WMI18n.t(key, vars);
  const box = $('tagTool');
  if (!box) return;
  const list = $('tagList'), input = $('tagInput'), actions = $('tagActions'), zipBtn = $('tagZip');
  const rows = [];

  function fmtBytes(n) {
    return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  // "C2PA Content Credentials, “AI generated” label · made with Google AI"
  function describe(r) {
    const found = [];
    if (r.c2pa) found.push(tr('tag.c2pa'));
    if (r.aiLabel) found.push(tr('tag.aiLabel'));
    if (r.exif) found.push('EXIF');
    if (r.xmp) found.push('XMP');
    if (r.iptc) found.push('IPTC');
    if (r.text && !found.length) found.push(tr('tag.text'));
    let s = tr('tag.removed', { what: found.join(', ') });
    if (r.generator) s += ' · ' + tr('tag.generator', { name: r.generator });
    return s;
  }

  function save(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function render() {
    list.hidden = !rows.length;
    const ready = rows.filter((r) => r.blob);
    actions.hidden = ready.length < 2;
    list.replaceChildren(...rows.map((r) => {
      const li = document.createElement('li');
      li.className = 'tag-row ' + r.status;
      const name = document.createElement('div');
      name.className = 'tag-name';
      name.textContent = r.file.name || 'file';
      const msg = document.createElement('div');
      msg.className = 'tag-msg';
      msg.textContent = r.msg;
      const text = document.createElement('div');
      text.className = 'tag-info';
      text.append(name, msg);
      li.append(text);
      if (r.blob) {
        const b = document.createElement('button');
        b.className = 'ghost-btn';
        b.textContent = tr('tag.download', { size: fmtBytes(r.blob.size) });
        b.addEventListener('click', () => save(r.blob, r.file.name || 'file'));
        li.append(b);
      }
      return li;
    }));
  }

  async function run(row) {
    try {
      const verdict = await root.WMGuard.check(row.file);
      if (!verdict.ok) {
        row.status = 'bad';
        row.msg = tr(verdict.where === 'name' ? 'blocked.byName' : 'blocked.byMeta', { agency: verdict.agency });
        return;
      }
      const res = await root.WMMeta.clean(row.file);
      row.blob = res.blob;
      row.status = 'ok';
      row.msg = root.WMMeta.anyFound(res.report) ? describe(res.report) : tr('tag.none');
    } catch (e) {
      row.status = 'bad';
      if (e && e.unsupported) row.msg = tr('tag.unsupported');
      else { console.error(e); row.msg = tr('tag.failed'); }
    }
  }

  async function add(files) {
    const fresh = [...files].filter(Boolean).map((file) => ({ file, status: 'busy', msg: tr('tag.working'), blob: null }));
    if (!fresh.length) return;
    rows.push(...fresh);
    render();
    for (const row of fresh) { await run(row); render(); }
    // one file: download it straight away
    if (fresh.length === 1 && fresh[0].blob && rows.length === 1) save(fresh[0].blob, fresh[0].file.name || 'file');
  }

  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    add(files);
  });

  // files dropped on this card go here, not to the watermark remover
  box.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); box.classList.add('drag'); });
  box.addEventListener('dragleave', () => box.classList.remove('drag'));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    box.classList.remove('drag');
    const dz = $('dropzone');
    if (dz) dz.classList.remove('drag');
    if (e.dataTransfer && e.dataTransfer.files.length) add(e.dataTransfer.files);
  });

  $('tagClear').addEventListener('click', () => { rows.length = 0; render(); });

  zipBtn.addEventListener('click', async () => {
    const ready = rows.filter((r) => r.blob);
    if (!ready.length) return;
    zipBtn.disabled = true;
    try {
      const blob = await root.WMZip.zip(ready.map((r) => ({ name: r.file.name || 'file', blob: r.blob })));
      save(blob, `unsparkle-${ready.length}-files.zip`);
    } finally {
      zipBtn.disabled = false;
    }
  });

  // The /remove-ai-label/ page is this tool only: the watermark remover is
  // hidden, and every drop or paste on the page comes here.
  if (document.body.dataset.focus === 'tag') {
    document.body.classList.add('tag-page');
    const dz = $('dropzone');
    dz.parentNode.insertBefore(box, dz);
    box.classList.add('tag-solo');
    $('tagDrop').hidden = false;
    const pick = (e) => {
      const files = e.dataTransfer ? e.dataTransfer.files : [...(e.clipboardData ? e.clipboardData.items : [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile());
      if (!files || !files.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      box.classList.remove('drag');
      add(files);
    };
    window.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('drag'); }, true);
    window.addEventListener('drop', pick, true);
    window.addEventListener('paste', pick, true);
  }
})(window);
