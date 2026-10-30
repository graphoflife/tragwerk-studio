// Typed point input (CAD-style), shared by all tools that ask for a point.
//
//   3              distance along the active axis constraint, or along the mouse direction from the reference
//   2 0 1          relative to the reference point (default for 2nd points) or absolute (default for 1st points)
//   4 6            two values = coordinates in the work plane
//   @2 0 1         force relative          #5 0 3   force absolute
//   @5<30          polar in the work plane: length 5, angle 30° from the plane's first axis
//   … *4           (copy tools) number of copies
// Values are separated by spaces or ';'. A comma is a decimal separator. Each value may be an
// arithmetic expression such as 6/4 or 2*3.5.

const SEP = /[\s;]+/;

export function evalNumber(s) {
  const x = s.replace(/,/g, '.').replace(/×/g, '*');
  if (!/^[\d\s.+\-*/()eE^]+$/.test(x)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict"; return (${x.replace(/\^/g, '**')});`)();
    return Number.isFinite(v) ? v : null;
  } catch (e) { return null; }
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

/**
 * @param {string} text
 * @param {object} ctx
 *   ref        reference point [x,y,z] or null
 *   relative   default mode when no '@'/'#' prefix is given
 *   axis       unit vector of an active axis constraint or null
 *   dirHint    unit vector from ref towards the mouse (direct distance entry) or null
 *   plane      { U:[3], V:[3], origin:[3] } work plane axes (origin = point of the plane at u=v=0)
 *   len        (v) => internal length from a displayed value (unit conversion), default identity
 * @returns {{ ok:boolean, p?:number[], copies?:number, mode?:string, error?:string }}
 */
export function parsePointInput(text, ctx = {}) {
  let s = String(text || '').trim();
  if (!s) return { ok: false, empty: true, error: 'empty' };
  const len = ctx.len || ((v) => v);
  const ref = ctx.ref || null;
  // copy count: "*n" preceded by a space ("6*2" without space stays arithmetic)
  let copies = 1;
  const cm = s.match(/\s+[*×]\s*(\d+)\s*$/);
  if (cm) {
    copies = Math.max(1, parseInt(cm[1], 10));
    s = s.slice(0, cm.index).trim();
  }
  let rel = ctx.relative ?? !!ref;
  if (s.startsWith('@')) { rel = true; s = s.slice(1).trim(); }
  else if (s.startsWith('#')) { rel = false; s = s.slice(1).trim(); }
  const base = rel && ref ? ref : [0, 0, 0];

  if (s.includes('<')) {
    const [a, b] = s.split('<');
    const L = evalNumber(a.trim()), ang = evalNumber(b.trim());
    if (L == null || ang == null || !ctx.plane) return { ok: false, error: 'polar' };
    const r = ang * Math.PI / 180;
    const d = add(mul(ctx.plane.U, Math.cos(r)), mul(ctx.plane.V, Math.sin(r)));
    const start = rel && ref ? ref : (ctx.plane.origin || [0, 0, 0]);
    return { ok: true, p: add(start, mul(d, len(L))), copies, mode: 'polar' };
  }

  const nums = s.split(SEP).filter(Boolean).map(evalNumber);
  if (!nums.length || nums.some((x) => x == null)) return { ok: false, error: 'number' };
  if (nums.length === 1) {
    const dist = len(nums[0]);
    const from = ref || [0, 0, 0];
    if (ctx.axis) return { ok: true, p: add(from, mul(ctx.axis, dist)), copies, mode: 'axis' };
    if (ctx.dirHint && ref) return { ok: true, p: add(ref, mul(ctx.dirHint, dist)), copies, mode: 'direction' };
    return { ok: false, error: 'direction' };
  }
  if (nums.length === 2) {
    if (!ctx.plane) return { ok: false, error: 'plane' };
    const [u, v] = nums.map(len);
    const start = rel && ref ? ref : (ctx.plane.origin || [0, 0, 0]);
    return { ok: true, p: add(start, add(mul(ctx.plane.U, u), mul(ctx.plane.V, v))), copies, mode: rel ? 'relative' : 'absolute' };
  }
  if (nums.length === 3) {
    return { ok: true, p: add(base, nums.map(len)), copies, mode: rel ? 'relative' : 'absolute' };
  }
  return { ok: false, error: 'count' };
}
