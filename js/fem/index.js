// Tragwerk Studio – FEM solver core (public API, SPEC.md §4).
//
// import { runStatic, runModal, runBuckling, runSpectrum, combineCases, envelope, lineForces } from './js/fem/index.js';
//
// Interpretations of points the SPEC leaves open (most standard engineering reading chosen):
//  * Elements: beams are Timoshenko when Avy/Avz > 0 (else Euler–Bernoulli), torsion GIt, releases
//    by static condensation (released local DOFs). Truss = axial only (transverse span loads lumped
//    as simply supported reactions). Rigid: EA = 1e4·max(EA/L)·L, EI = 1e4·max(EI/L³·L³, EI/L·L)
//    relative to the model's beams (or shells / 1e10 if none) – i.e. "1e4 × max beam stiffness"
//    expressed per element, so short rigid links are not ill-conditioned. Spring = 2-node global
//    spring k[6]; its station values are the constant spring forces in the beam's local axes.
//  * Shells: MITC4 bending/shear + QM6 membrane + Hughes–Brezzi drilling penalty (γ = 1e-3·G·t).
//    vx, vy = transverse shear forces with vx = ∂mx/∂x + ∂mxy/∂y (consistent with beam Vz = dMy/dx);
//    mxy = −∫τxy·z dz (same sign rule as mx). Shell results are in the domain local axes.
//  * DOFs without stiffness: rotational null directions are always suppressed; translational null
//    directions only at nodes attached to plate/membrane elements (otherwise a mechanism is
//    reported). Nodes without elements are ignored. A warning is issued. Loads on suppressed DOFs
//    are ignored with a warning.
//  * Mechanism: pivot D_j ≤ 1e-11·K_jj → error { code:'MECHANISM', node (mesh index), nodeId
//    (model node id or 0), dof (0..5), dofName ('ux'..'rz'), message }.
//  * Reactions: support-fixed DOFs R = K·u − F; spring DOFs (nodal, line, surface) R = k·(u_ground − u).
//    Line springs are lumped with tributary lengths, Winkler bedding with ∫N dA (lumped).
//  * nodeDisp on a fixed DOF = prescribed displacement; on a spring DOF = ground displacement of the
//    spring; otherwise ignored with a warning.
//  * Temperature on beams: dT uniform, dTz = T(+z) − T(−z) over h (dims.h | dims.d | 2·zmax |
//    √(12Iy/A)), dTy = T(+y) − T(−y) over b (dims.b | dims.d | 2·ymax | √(12Iz/A)).
//  * Nonlinear static (nonlinear:true or pDelta:true): every combination is solved directly; load
//    cases are solved only when there are no combinations. Tension/compression-only and uplift are
//    active only with nonlinear:true; pDelta:true alone gives a P-Δ (geometric stiffness) iteration.
//    P-Δ uses beam axial forces and shell membrane forces (u, v, w terms).
//  * Beam station deflections uy, uz are total local displacements (chord + exact span
//    deflection from integrating the moment diagram, incl. shear deformation and thermal curvature).
//    Shear-type releases (uy/uz released at an end) are not reflected in the station deflection.
//  * Modal: lumped translational masses only (no rotary inertia). totalMass = mass on free DOFs
//    (effective mass ratios refer to it and sum to 1 over all modes); totalMassAll = all mass.
//    Mode shapes: mass-normalised, sign such that the largest component is positive.
//  * Buckling: shapes normalised to max |translation| = 1.
//  * Spectrum: ag/agd in m/s²; type 'design' when q > 1 (else elastic with η); default rule CQC;
//    code defaults to model.settings.code ?? 'EC'. See spectrum.js for clauses (EN 1998-1, SIA 261).
//    Result has extra fields `spectrum` (parameters, per-mode T, Sd, Γ) and `warnings`.
//  * Extra result fields: CaseResult.iterations (nonlinear), stats.dofs/ms on all analyses.

export { runStatic } from './static.js';
export { runModal } from './modal.js';
export { runBuckling } from './buckling.js';
export { runSpectrum, spectrumOrdinate, spectrumParams } from './spectrum.js';
export { combineCases, envelope, lineForces } from './post.js';
