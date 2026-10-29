// Module Web Worker entry: new Worker('js/fem/worker.js', { type: 'module' })
// Protocol (SPEC §4):
//   in:  { id, cmd: 'static'|'modal'|'buckling'|'spectrum', model, mesh, options }
//   out: { id, type: 'progress', pct, msg }  …  { id, type: 'result', data } | { id, type: 'error', message }
// For 'spectrum', options.modal may carry a previous runModal result; otherwise modal analysis is
// run first with options.modalOptions.

import { runStatic, runModal, runBuckling, runSpectrum } from './index.js';

/** Collect transferable ArrayBuffers of typed arrays in a result (deduplicated) */
function transferables(obj, out = new Set(), depth = 0) {
  if (!obj || depth > 6) return out;
  if (ArrayBuffer.isView(obj)) { out.add(obj.buffer); return out; }
  if (Array.isArray(obj)) { for (const v of obj) transferables(v, out, depth + 1); return out; }
  if (typeof obj === 'object') for (const k in obj) transferables(obj[k], out, depth + 1);
  return out;
}

export function handleMessage(msg, post) {
  const { id, cmd, model, mesh } = msg || {};
  const options = { ...(msg && msg.options) };
  let lastPct = -1;
  options.onProgress = (pct, text) => {
    const p = Math.round(pct);
    if (p === lastPct) return;
    lastPct = p;
    post({ id, type: 'progress', pct: p, msg: text || '' });
  };
  try {
    let data;
    switch (cmd) {
      case 'static': data = runStatic(model, mesh, options); break;
      case 'modal': data = runModal(model, mesh, options); break;
      case 'buckling': data = runBuckling(model, mesh, options); break;
      case 'spectrum': {
        let modal = options.modal;
        if (!modal) modal = runModal(model, mesh, { ...(options.modalOptions || {}), onProgress: (p, t) => options.onProgress(p * 0.5, t) });
        data = runSpectrum(model, mesh, modal, options);
        break;
      }
      default: throw new Error(`Unknown command '${cmd}'`);
    }
    post({ id, type: 'result', data }, [...transferables(data)]);
  } catch (e) {
    post({ id, type: 'error', message: String(e && e.message || e) });
  }
}

const scope = typeof self !== 'undefined' ? self : null;
if (scope && typeof scope.postMessage === 'function' && typeof scope.addEventListener === 'function'
    && typeof window === 'undefined') {
  scope.addEventListener('message', (ev) => handleMessage(ev.data, (m, tr) => scope.postMessage(m, tr || [])));
}
