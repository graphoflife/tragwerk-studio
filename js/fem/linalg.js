// Linear algebra kernels for the FEM core.
// - node graph + reverse Cuthill–McKee ordering
// - skyline (profile, column storage of the upper triangle) LDLᵀ factorisation / solve / mat-vec
// - small dense helpers (symmetric eigen decomposition via Householder + QL, Gauss solve)
// Pure JS, no DOM, Float64Array throughout.

// ---------------------------------------------------------------------------
// Graph + RCM
// ---------------------------------------------------------------------------

/** Build a CSR node adjacency graph from element node lists. */
export function buildNodeGraph(nn, elems) {
  const cnt = new Int32Array(nn);
  for (const e of elems) {
    const m = e.length;
    for (let a = 0; a < m; a++) cnt[e[a]] += m - 1;
  }
  const p0 = new Int32Array(nn + 1);
  for (let i = 0; i < nn; i++) p0[i + 1] = p0[i] + cnt[i];
  const tmp = new Int32Array(p0[nn]);
  const fill = p0.slice(0, nn);
  for (const e of elems) {
    const m = e.length;
    for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) if (a !== b) tmp[fill[e[a]]++] = e[b];
  }
  // sort + unique + drop self loops
  const xadj = new Int32Array(nn + 1);
  const adjList = [];
  let total = 0;
  for (let i = 0; i < nn; i++) {
    const s = tmp.subarray(p0[i], p0[i + 1]).slice().sort();
    let last = -1;
    const start = total;
    for (let k = 0; k < s.length; k++) {
      const v = s[k];
      if (v !== last && v !== i) { adjList.push(v); total++; }
      last = v;
    }
    xadj[i] = start;
  }
  xadj[nn] = total;
  return { xadj, adj: Int32Array.from(adjList) };
}

/** Reverse Cuthill–McKee ordering. Returns Int32Array order[pos] = node. */
export function rcmOrder(nn, graph) {
  const { xadj, adj } = graph;
  const deg = new Int32Array(nn);
  for (let i = 0; i < nn; i++) deg[i] = xadj[i + 1] - xadj[i];
  const visited = new Uint8Array(nn);
  const order = new Int32Array(nn);
  let pos = 0;
  const level = new Int32Array(nn).fill(-1);
  const queue = new Int32Array(nn);
  // nodes sorted by degree to pick component seeds deterministically
  const seeds = Array.from({ length: nn }, (_, i) => i).sort((a, b) => deg[a] - deg[b] || a - b);

  // BFS restricted to unvisited nodes; returns number of nodes reached, fills queue & level
  const bfs = (root) => {
    let head = 0, tail = 0;
    queue[tail++] = root; level[root] = 0;
    while (head < tail) {
      const u = queue[head++];
      for (let k = xadj[u]; k < xadj[u + 1]; k++) {
        const v = adj[k];
        if (!visited[v] && level[v] < 0) { level[v] = level[u] + 1; queue[tail++] = v; }
      }
    }
    return tail;
  };
  const clearLevels = (cnt) => { for (let k = 0; k < cnt; k++) level[queue[k]] = -1; };

  for (const seed of seeds) {
    if (visited[seed]) continue;
    // pseudo-peripheral node (George–Liu)
    let root = seed, ecc = -1;
    for (let it = 0; it < 8; it++) {
      const cnt = bfs(root);
      const maxL = level[queue[cnt - 1]];
      let best = root;
      if (maxL > ecc) {
        ecc = maxL;
        let bd = Infinity;
        for (let k = cnt - 1; k >= 0 && level[queue[k]] === maxL; k--) {
          const v = queue[k];
          if (deg[v] < bd) { bd = deg[v]; best = v; }
        }
      }
      clearLevels(cnt);
      if (best === root) break;
      root = best;
    }
    // Cuthill–McKee from root
    let head = pos;
    order[pos++] = root; visited[root] = 1;
    const nb = [];
    while (head < pos) {
      const u = order[head++];
      nb.length = 0;
      for (let k = xadj[u]; k < xadj[u + 1]; k++) {
        const v = adj[k];
        if (!visited[v]) { visited[v] = 1; nb.push(v); }
      }
      nb.sort((a, b) => deg[a] - deg[b] || a - b);
      for (const v of nb) order[pos++] = v;
    }
  }
  order.reverse();
  return order;
}

// ---------------------------------------------------------------------------
// Skyline storage
// ---------------------------------------------------------------------------
// Column j stores rows first[j]..j contiguously; entry (i,j), i<=j, lives at
// a[colPtr[j] + i - first[j]]; the diagonal is the last entry of each column.

export class Skyline {
  constructor(n, first, colPtr) {
    this.n = n;
    this.first = first;
    this.colPtr = colPtr;
    this.a = new Float64Array(colPtr[n]);
  }
  static fromFirst(n, first) {
    const colPtr = new Int32Array(n + 1);
    for (let j = 0; j < n; j++) colPtr[j + 1] = colPtr[j] + (j - first[j] + 1);
    return new Skyline(n, first, colPtr);
  }
  /** empty matrix with the same profile */
  like() { return new Skyline(this.n, this.first, this.colPtr); }
  diag(j) { return this.a[this.colPtr[j + 1] - 1]; }
  get nnz() { return this.colPtr[this.n]; }
}

/** Add a dense symmetric element matrix ke (nd×nd, row-major) using eq map (−1 = eliminated). */
export function addElement(S, eqs, ke, nd, scale = 1) {
  const a = S.a, first = S.first, cp = S.colPtr;
  for (let p = 0; p < nd; p++) {
    const ep = eqs[p];
    if (ep < 0) continue;
    const row = p * nd;
    for (let q = 0; q < nd; q++) {
      const eqq = eqs[q];
      if (eqq < ep) continue;
      const v = ke[row + q];
      if (v !== 0) a[cp[eqq] + ep - first[eqq]] += scale * v;
    }
  }
}

/**
 * In-place LDLᵀ (Crout, column-wise, Bathe's COLSOL scheme).
 * After factorisation column j holds U_ij = L_ji (i<j) and D_j on the diagonal.
 * Mechanism check: pivot D_j must be > tol·K_jj(original); otherwise returns {ok:false, eq}.
 */
export function ldlFactor(S, tol = 1e-11, onProgress) {
  const n = S.n, first = S.first, cp = S.colPtr, a = S.a;
  const diag0 = new Float64Array(n);
  for (let j = 0; j < n; j++) diag0[j] = a[cp[j + 1] - 1];
  let minRatio = Infinity;
  const step = Math.max(1, (n / 20) | 0);
  for (let j = 0; j < n; j++) {
    const fj = first[j];
    const bj = cp[j] - fj; // a[bj + i] = (i,j)
    // g_ij = k_ij - sum_{m<i} U_mi g_mj
    for (let i = fj + 1; i < j; i++) {
      const fi = first[i];
      const m0 = fi > fj ? fi : fj;
      if (m0 >= i) continue;
      const bi = cp[i] - fi;
      let s = 0;
      for (let m = m0; m < i; m++) s += a[bi + m] * a[bj + m];
      a[bj + i] -= s;
    }
    // U_ij = g_ij / D_i ; D_j = k_jj - sum U_ij g_ij
    let d = a[bj + j];
    for (let i = fj; i < j; i++) {
      const g = a[bj + i];
      if (g === 0) continue;
      const u = g / a[cp[i + 1] - 1];
      d -= u * g;
      a[bj + i] = u;
    }
    a[bj + j] = d;
    const ref = diag0[j];
    const ratio = ref > 0 ? d / ref : -1;
    if (!(ratio > tol)) return { ok: false, eq: j, pivot: d, diag: ref, ratio };
    if (ratio < minRatio) minRatio = ratio;
    if (onProgress && j % step === 0) onProgress(j / n);
  }
  return { ok: true, minRatio };
}

/** Solve (U^T D U) x = b in place using a factorised skyline. */
export function ldlSolve(S, b) {
  const n = S.n, first = S.first, cp = S.colPtr, a = S.a;
  for (let j = 0; j < n; j++) {
    const fj = first[j], bj = cp[j] - fj;
    let s = 0;
    for (let i = fj; i < j; i++) s += a[bj + i] * b[i];
    b[j] -= s;
  }
  for (let j = 0; j < n; j++) b[j] /= a[cp[j + 1] - 1];
  for (let j = n - 1; j > 0; j--) {
    const xj = b[j];
    if (xj === 0) continue;
    const fj = first[j], bj = cp[j] - fj;
    for (let i = fj; i < j; i++) b[i] -= a[bj + i] * xj;
  }
  return b;
}

/** y = A x for an (unfactorised) symmetric skyline matrix. */
export function skyMatVec(S, x, y) {
  const n = S.n, first = S.first, cp = S.colPtr, a = S.a;
  y.fill(0);
  for (let j = 0; j < n; j++) {
    const fj = first[j], bj = cp[j] - fj, xj = x[j];
    let s = 0;
    for (let i = fj; i < j; i++) {
      const v = a[bj + i];
      s += v * x[i];
      y[i] += v * xj;
    }
    y[j] += s + a[bj + j] * xj;
  }
  return y;
}

// ---------------------------------------------------------------------------
// Small dense helpers
// ---------------------------------------------------------------------------

/** Solve A x = b (n×n row-major, copied) with partial pivoting. Returns null if singular. */
export function solveDense(A, n, b) {
  const M = Float64Array.from(A);
  const x = Float64Array.from(b);
  for (let k = 0; k < n; k++) {
    let p = k, mx = Math.abs(M[k * n + k]);
    for (let i = k + 1; i < n; i++) { const v = Math.abs(M[i * n + k]); if (v > mx) { mx = v; p = i; } }
    if (mx === 0) return null;
    if (p !== k) {
      for (let j = 0; j < n; j++) { const t = M[k * n + j]; M[k * n + j] = M[p * n + j]; M[p * n + j] = t; }
      const t = x[k]; x[k] = x[p]; x[p] = t;
    }
    const piv = M[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = M[i * n + k] / piv;
      if (f === 0) continue;
      for (let j = k; j < n; j++) M[i * n + j] -= f * M[k * n + j];
      x[i] -= f * x[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= M[i * n + j] * x[j];
    x[i] = s / M[i * n + i];
  }
  return x;
}

/** Inverse of a small n×n matrix (row-major). Returns null if singular. */
export function invDense(A, n) {
  const inv = new Float64Array(n * n);
  const e = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    e.fill(0); e[j] = 1;
    const col = solveDense(A, n, e);
    if (!col) return null;
    for (let i = 0; i < n; i++) inv[i * n + j] = col[i];
  }
  return inv;
}

/**
 * Symmetric eigen decomposition (Householder tridiagonalisation + implicit QL, after JAMA/EISPACK).
 * A: n×n row-major (only symmetric part used). Returns { values (ascending), vectors } where
 * vectors[i*n + k] = component i of eigenvector k.
 */
export function symEig(A, n) {
  const V = new Array(n);
  for (let i = 0; i < n; i++) {
    V[i] = new Float64Array(n);
    for (let j = 0; j < n; j++) V[i][j] = 0.5 * (A[i * n + j] + A[j * n + i]);
  }
  const d = new Float64Array(n), e = new Float64Array(n);
  if (n === 1) {
    return { values: Float64Array.of(V[0][0]), vectors: Float64Array.of(1) };
  }
  tred2(V, d, e, n);
  tql2(V, d, e, n);
  const vec = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) vec[i * n + k] = V[i][k];
  return { values: d, vectors: vec };
}

function tred2(V, d, e, n) {
  for (let j = 0; j < n; j++) d[j] = V[n - 1][j];
  for (let i = n - 1; i > 0; i--) {
    let scale = 0, h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
    if (scale === 0) {
      e[i] = d[i - 1];
      for (let j = 0; j < i; j++) { d[j] = V[i - 1][j]; V[i][j] = 0; V[j][i] = 0; }
    } else {
      for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
      let f = d[i - 1];
      let g = Math.sqrt(h);
      if (f > 0) g = -g;
      e[i] = scale * g;
      h -= f * g;
      d[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;
      for (let j = 0; j < i; j++) {
        f = d[j];
        V[j][i] = f;
        g = e[j] + V[j][j] * f;
        for (let k = j + 1; k <= i - 1; k++) { g += V[k][j] * d[k]; e[k] += V[k][j] * f; }
        e[j] = g;
      }
      f = 0;
      for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
      const hh = f / (h + h);
      for (let j = 0; j < i; j++) e[j] -= hh * d[j];
      for (let j = 0; j < i; j++) {
        f = d[j]; g = e[j];
        for (let k = j; k <= i - 1; k++) V[k][j] -= (f * e[k] + g * d[k]);
        d[j] = V[i - 1][j];
        V[i][j] = 0;
      }
    }
    d[i] = h;
  }
  for (let i = 0; i < n - 1; i++) {
    V[n - 1][i] = V[i][i];
    V[i][i] = 1;
    const h = d[i + 1];
    if (h !== 0) {
      for (let k = 0; k <= i; k++) d[k] = V[k][i + 1] / h;
      for (let j = 0; j <= i; j++) {
        let g = 0;
        for (let k = 0; k <= i; k++) g += V[k][i + 1] * V[k][j];
        for (let k = 0; k <= i; k++) V[k][j] -= g * d[k];
      }
    }
    for (let k = 0; k <= i; k++) V[k][i + 1] = 0;
  }
  for (let j = 0; j < n; j++) { d[j] = V[n - 1][j]; V[n - 1][j] = 0; }
  V[n - 1][n - 1] = 1;
  e[0] = 0;
}

function tql2(V, d, e, n) {
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  let f = 0, tst1 = 0;
  const eps = 2 ** -52;
  for (let l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
    let m = l;
    while (m < n) { if (Math.abs(e[m]) <= eps * tst1) break; m++; }
    if (m === n) m = n - 1;
    if (m > l) {
      let iter = 0;
      do {
        iter++;
        let g = d[l];
        let p = (d[l + 1] - g) / (2 * e[l]);
        let r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        d[l] = e[l] / (p + r);
        d[l + 1] = e[l] * (p + r);
        const dl1 = d[l + 1];
        let h = g - d[l];
        for (let i = l + 2; i < n; i++) d[i] -= h;
        f += h;
        p = d[m];
        let c = 1, c2 = 1, c3 = 1, s = 0, s2 = 0;
        const el1 = e[l + 1];
        for (let i = m - 1; i >= l; i--) {
          c3 = c2; c2 = c; s2 = s;
          g = c * e[i];
          h = c * p;
          r = Math.hypot(p, e[i]);
          e[i + 1] = s * r;
          s = e[i] / r;
          c = p / r;
          p = c * d[i] - s * g;
          d[i + 1] = h + s * (c * g + s * d[i]);
          for (let k = 0; k < n; k++) {
            const Vk = V[k];
            h = Vk[i + 1];
            Vk[i + 1] = s * Vk[i] + c * h;
            Vk[i] = c * Vk[i] - s * h;
          }
        }
        p = -s * s2 * c3 * el1 * e[l] / dl1;
        e[l] = s * p;
        d[l] = c * p;
        if (iter > 200) break;
      } while (Math.abs(e[l]) > eps * tst1);
    }
    d[l] += f;
    e[l] = 0;
  }
  // sort ascending
  for (let i = 0; i < n - 1; i++) {
    let k = i, p = d[i];
    for (let j = i + 1; j < n; j++) if (d[j] < p) { k = j; p = d[j]; }
    if (k !== i) {
      d[k] = d[i]; d[i] = p;
      for (let j = 0; j < n; j++) { const t = V[j][i]; V[j][i] = V[j][k]; V[j][k] = t; }
    }
  }
}

/** Deterministic PRNG (mulberry32) for reproducible start vectors. */
export function rng(seed = 12345) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
}

export function dot(a, b, n = a.length) {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** Transform a symmetric element matrix from local to global: K_G = Tᵀ K_L T with T = blockdiag(R),
 *  R (3×3 row-major, rows = local axes in global coords). nd must be a multiple of 3. */
export function toGlobalMatrix(KL, nd, R) {
  const KG = new Float64Array(nd * nd);
  const nb = nd / 3;
  const tmp = new Float64Array(9);
  for (let A = 0; A < nb; A++) {
    for (let B = 0; B < nb; B++) {
      // tmp = KL_AB * R
      for (let i = 0; i < 3; i++) {
        const row = (3 * A + i) * nd + 3 * B;
        const k0 = KL[row], k1 = KL[row + 1], k2 = KL[row + 2];
        for (let j = 0; j < 3; j++) tmp[i * 3 + j] = k0 * R[j] + k1 * R[3 + j] + k2 * R[6 + j];
      }
      if (tmp[0] === 0 && tmp[1] === 0 && tmp[2] === 0 && tmp[3] === 0 && tmp[4] === 0 &&
          tmp[5] === 0 && tmp[6] === 0 && tmp[7] === 0 && tmp[8] === 0) continue;
      // KG_AB = R^T * tmp
      for (let i = 0; i < 3; i++) {
        const row = (3 * A + i) * nd + 3 * B;
        for (let j = 0; j < 3; j++) {
          KG[row + j] = R[i] * tmp[j] + R[3 + i] * tmp[3 + j] + R[6 + i] * tmp[6 + j];
        }
      }
    }
  }
  return KG;
}

/** v_local = T v_global (blockwise R) */
export function toLocalVector(vG, R, out) {
  const n = vG.length;
  const o = out || new Float64Array(n);
  for (let k = 0; k < n; k += 3) {
    const x = vG[k], y = vG[k + 1], z = vG[k + 2];
    o[k] = R[0] * x + R[1] * y + R[2] * z;
    o[k + 1] = R[3] * x + R[4] * y + R[5] * z;
    o[k + 2] = R[6] * x + R[7] * y + R[8] * z;
  }
  return o;
}

/** v_global = Tᵀ v_local */
export function toGlobalVector(vL, R, out) {
  const n = vL.length;
  const o = out || new Float64Array(n);
  for (let k = 0; k < n; k += 3) {
    const x = vL[k], y = vL[k + 1], z = vL[k + 2];
    o[k] = R[0] * x + R[3] * y + R[6] * z;
    o[k + 1] = R[1] * x + R[4] * y + R[7] * z;
    o[k + 2] = R[2] * x + R[5] * y + R[8] * z;
  }
  return o;
}

/** y = K x for a dense nd×nd matrix */
export function matVec(K, x, nd, out) {
  const y = out || new Float64Array(nd);
  for (let i = 0; i < nd; i++) {
    let s = 0;
    const r = i * nd;
    for (let j = 0; j < nd; j++) s += K[r + j] * x[j];
    y[i] = s;
  }
  return y;
}
