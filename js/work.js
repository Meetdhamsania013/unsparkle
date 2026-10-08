/*
 * Unsparkle – runs watermark removal in a background thread (Web Worker) so the
 * page never freezes. The worker is built from the already-loaded core code
 * (as a Blob), which also works when the page is opened straight from disk.
 * Falls back to the main thread if workers aren't available.
 */
(function (root) {
  'use strict';

  let worker = null, nextId = 1;
  const pending = new Map();

  function startWorker() {
    if (worker !== null) return worker;
    try {
      const src = `
        'use strict';
        let WMCore = null;
        self.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'init') { WMCore = (${root.WMCoreFactory.toString()})(m.masks); return; }
          try {
            const img = { data: new Uint8ClampedArray(m.buffer), width: m.width, height: m.height };
            const r = WMCore.process(img);
            const out = r.image.data;
            self.postMessage({ id: m.id, ok: true, found: r.found, logos: r.logos || [], score: r.score,
              buffer: out.buffer, width: r.image.width, height: r.image.height }, [out.buffer]);
          } catch (err) {
            self.postMessage({ id: m.id, ok: false, error: String(err && err.message || err) });
          }
        };`;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.postMessage({ type: 'init', masks: root.WMMasks });
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data);
        else p.reject(new Error(e.data.error));
      };
      worker.onerror = (e) => {
        console.warn('Worker failed, using the main thread instead', e);
        for (const p of pending.values()) p.fallback();
        pending.clear();
        worker = false;
      };
    } catch (e) {
      console.warn('No worker, using the main thread', e);
      worker = false;
    }
    return worker;
  }

  function onMainThread(imageData) {
    const r = root.WMCore.process(imageData);
    return { found: r.found, logos: r.logos || [], score: r.score, image: new ImageData(new Uint8ClampedArray(r.image.data.buffer), r.image.width, r.image.height) };
  }

  /**
   * Remove the watermark(s) from an image.
   * @param {ImageData} imageData  (its pixel buffer is copied, the original stays usable)
   * @returns {Promise<{found: boolean, logos: object[], score: number, image: ImageData}>}
   */
  function process(imageData) {
    const w = startWorker();
    if (!w) return Promise.resolve(onMainThread(imageData));
    const id = nextId++;
    const copy = new Uint8ClampedArray(imageData.data);
    return new Promise((resolve, reject) => {
      pending.set(id, {
        resolve: (d) => resolve({ found: d.found, logos: d.logos, score: d.score, image: new ImageData(new Uint8ClampedArray(d.buffer), d.width, d.height) }),
        reject,
        fallback: () => { try { resolve(onMainThread(imageData)); } catch (e) { reject(e); } },
      });
      w.postMessage({ id, buffer: copy.buffer, width: imageData.width, height: imageData.height }, [copy.buffer]);
    });
  }

  root.WMWork = { process };
})(window);
