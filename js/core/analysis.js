// Runs FEM analyses in a module Web Worker (falls back to the main thread if workers are unavailable).
let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker === false) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../fem/worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, type } = e.data || {};
      const p = pending.get(id);
      if (!p) return;
      if (type === 'progress') p.onProgress?.(e.data.pct, e.data.msg);
      else if (type === 'result') { pending.delete(id); p.resolve(e.data.data); }
      else if (type === 'error') { pending.delete(id); p.reject(new Error(e.data.message)); }
    };
    worker.onerror = (e) => {
      console.warn('FEM worker failed, falling back to main thread', e.message);
      worker?.terminate?.();
      worker = false;
      for (const [id, p] of pending) { pending.delete(id); p.fallback(); }
    };
  } catch (e) {
    worker = false;
    return null;
  }
  return worker;
}

async function runInline(cmd, model, mesh, options, onProgress) {
  const fem = await import('../fem/index.js');
  const opts = { ...options, onProgress };
  await new Promise((r) => setTimeout(r, 30));
  switch (cmd) {
    case 'static': return fem.runStatic(model, mesh, opts);
    case 'modal': return fem.runModal(model, mesh, opts);
    case 'buckling': return fem.runBuckling(model, mesh, opts);
    case 'spectrum': return fem.runSpectrum(model, mesh, options.modal, opts);
    default: throw new Error('unknown command ' + cmd);
  }
}

export function runFem(cmd, model, mesh, options = {}, onProgress) {
  const w = getWorker();
  if (!w) return runInline(cmd, model, mesh, options, onProgress);
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, {
      resolve, reject, onProgress,
      fallback: () => runInline(cmd, model, mesh, options, onProgress).then(resolve, reject),
    });
    w.postMessage({ id, cmd, model, mesh, options });
  });
}

export function cancelFem() {
  if (worker) { worker.terminate(); worker = null; }
  for (const [id, p] of pending) { pending.delete(id); p.reject(new Error('cancelled')); }
}
