// Section lines (Schnittlinien): result diagrams along a straight line across surface elements.
// Pure module (no DOM).
//
// model.sectionLines = [{ id, name, a:[x,y,z], b:[x,y,z], on:true }]
//
// sampleSection(mesh, a, b, opts) samples the line at n points and locates every sample in a shell
// element (point within tol of the element plane and inside one of its two triangles 0-1-2 / 0-2-3);
// the result is interpolated linearly from the corner values of that triangle. Samples outside all
// elements have hit = null (gaps in the diagram, e.g. over openings).
// sectionValues(sample, cornerValue) → values per sample (cornerValue(e, k) = value at corner k of
// shell e, null → no value). integrate(s, v) = trapezoidal rule over the defined parts.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// barycentric weights of p (projected) in triangle (A, B, C), or null if outside
function bary(p, A, B, C, eps = 1e-6) {
  const v0 = sub(B, A), v1 = sub(C, A), v2 = sub(p, A);
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1);
  const den = d00 * d11 - d01 * d01;
  if (Math.abs(den) < 1e-18) return null;
  const v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den, u = 1 - v - w;
  return u >= -eps && v >= -eps && w >= -eps ? [u, v, w] : null;
}

/**
 * @returns { L, n, pts:[{ s, p, hit:{ e, k:[3 corner indices], w:[3], ez } | null }] }
 */
export function sampleSection(mesh, a, b, { n, step = 0.05, tol } = {}) {
  const d = sub(b, a), L = Math.hypot(d[0], d[1], d[2]);
  const shells = mesh?.shells || [];
  const X = mesh?.nodes || [];
  const N = n || Math.max(40, Math.min(400, Math.ceil(L / step)));
  const P = (i) => [X[3 * i], X[3 * i + 1], X[3 * i + 2]];
  // element boxes for a quick rejection
  const boxes = shells.map((s) => {
    const ps = s.nodes.map(P);
    const lo = [0, 1, 2].map((j) => Math.min(...ps.map((q) => q[j])));
    const hi = [0, 1, 2].map((j) => Math.max(...ps.map((q) => q[j])));
    const tl = tol ?? Math.max(0.02, 0.6 * (s.thickness || 0.2));
    return { ps, lo: lo.map((x) => x - tl), hi: hi.map((x) => x + tl), tl, ez: s.ez || cross(sub(ps[1], ps[0]), sub(ps[3] ?? ps[2], ps[0])) };
  });
  const pts = [];
  let last = -1;
  for (let i = 0; i <= N; i++) {
    const f = N ? i / N : 0;
    const p = [a[0] + d[0] * f, a[1] + d[1] * f, a[2] + d[2] * f];
    let hit = null;
    const tryElem = (e) => {
      const bx = boxes[e];
      if (p[0] < bx.lo[0] || p[0] > bx.hi[0] || p[1] < bx.lo[1] || p[1] > bx.hi[1] || p[2] < bx.lo[2] || p[2] > bx.hi[2]) return null;
      const ez = bx.ez, nz = Math.hypot(ez[0], ez[1], ez[2]) || 1;
      const dist = dot(sub(p, bx.ps[0]), ez) / nz;
      if (Math.abs(dist) > bx.tl) return null;
      const q = [p[0] - ez[0] / nz * dist, p[1] - ez[1] / nz * dist, p[2] - ez[2] / nz * dist];
      for (const tri of [[0, 1, 2], [0, 2, 3]]) {
        const w = bary(q, bx.ps[tri[0]], bx.ps[tri[1]], bx.ps[tri[2]]);
        if (w) return { e, k: tri, w, ez: [ez[0] / nz, ez[1] / nz, ez[2] / nz] };
      }
      return null;
    };
    if (last >= 0) hit = tryElem(last); // neighbouring samples usually lie in the same element
    for (let e = 0; !hit && e < shells.length; e++) if (e !== last) hit = tryElem(e);
    if (hit) last = hit.e;
    pts.push({ s: L * f, p, hit });
  }
  return { L, n: N, pts };
}

/** Values along the section for a corner value function (null where there is no element/value). */
export function sectionValues(sample, cornerValue) {
  return sample.pts.map(({ hit }) => {
    if (!hit) return null;
    let v = 0;
    for (let j = 0; j < 3; j++) {
      const c = cornerValue(hit.e, hit.k[j]);
      if (c == null || !Number.isFinite(c)) return null;
      v += hit.w[j] * c;
    }
    return v;
  });
}

/** Trapezoidal integral ∫ v ds over the defined parts, plus extremes and covered length. */
export function sectionStats(sample, vals) {
  let I = 0, len = 0, max = -Infinity, min = Infinity, iMax = -1, iMin = -1;
  vals.forEach((v, i) => {
    if (v == null) return;
    if (v > max) { max = v; iMax = i; }
    if (v < min) { min = v; iMin = i; }
    const u = vals[i + 1];
    if (u != null && i + 1 < vals.length) {
      const ds = sample.pts[i + 1].s - sample.pts[i].s;
      I += 0.5 * (v + u) * ds; len += ds;
    }
  });
  return { integral: I, length: len, max, min, iMax, iMin, mean: len > 0 ? I / len : null };
}
