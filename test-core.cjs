/* Unit tests for pkpd-core.js.
   Run: node test-core.cjs
   The analytic infusion solutions are checked against RK4 integration of
   the underlying ODE system, and against exact steady-state PK
   identities (AUC_tau = Dose/CL; Css = R0/CL). */
const PKPD = require('./pkpd-core.js');
const { MODELS } = require('./models.js');

let fails = 0;
function ok(name, cond, detail) {
  if (!cond) { fails++; console.log('FAIL  ' + name + (detail ? '  ' + detail : '')); }
  else console.log('pass  ' + name + (detail ? '  ' + detail : ''));
}
function relerr(a, b) { return Math.abs(a - b) / Math.max(1e-12, Math.abs(b)); }

/* ---- RK4 reference for the 2-compartment ODE system.
   The zero-order input makes dA1/dt discontinuous at t=0 and t=Tinf, so
   the integration is split at Tinf and restarted exactly on the
   boundary; within each phase the forcing term is constant and RK4 is
   genuinely 4th-order. Integrating straight through a discontinuity
   instead would leave an O(h*R0/V1) local error that has nothing to do
   with the analytic solution under test. ---- */
function rk4Two(p, R0, Tinf, tEnd, h) {
  const k10 = p.CL / p.V1, k12 = p.Q / p.V1, k21 = p.Q / p.V2;
  const out = [];
  let y = [0, 0];

  function phase(t0, t1, R) {
    const f = (y) => [R - (k10 + k12) * y[0] + k21 * y[1],
                      k12 * y[0] - k21 * y[1]];
    const n = Math.max(1, Math.round((t1 - t0) / h)), hh = (t1 - t0) / n;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * hh;
      out.push({ t, c: y[0] / p.V1 });
      const a = f(y),
            b = f([y[0] + hh / 2 * a[0], y[1] + hh / 2 * a[1]]),
            c = f([y[0] + hh / 2 * b[0], y[1] + hh / 2 * b[1]]),
            d = f([y[0] + hh * c[0], y[1] + hh * c[1]]);
      y = [y[0] + hh / 6 * (a[0] + 2 * b[0] + 2 * c[0] + d[0]),
           y[1] + hh / 6 * (a[1] + 2 * b[1] + 2 * c[1] + d[1])];
    }
    out.push({ t: t1, c: y[0] / p.V1 });
  }
  phase(0, Tinf, R0);
  phase(Tinf, tEnd, 0);
  return out;
}

/* ---- 1. Two-compartment analytic vs RK4 ---- */
{
  const p = { CL: 5.0, V1: 20.0, Q: 8.0, V2: 30.0 };
  const R0 = 4000 / 0.5, Tinf = 0.5;
  const f = PKPD.infusionResponse(p, 2, R0, Tinf);
  const ref = rk4Two(p, R0, Tinf, 12, 0.0002);
  let worst = 0, worstAt = null;
  for (const r of ref) {
    if (r.t < 1e-9) continue;
    const e = Math.abs(f(r.t) - r.c) / Math.max(1e-9, r.c);
    if (e > worst) { worst = e; worstAt = r.t; }
  }
  ok('2-cmt analytic matches RK4 (max rel err < 1e-8)', worst < 1e-8,
     `max=${worst.toExponential(2)} at t=${worstAt}h`);
}

/* ---- 2. One-compartment analytic vs closed form ---- */
{
  const p = { CL: 4.0, V1: 40.0 };
  const k = p.CL / p.V1, R0 = 1000 / 1, Tinf = 1;
  const f = PKPD.infusionResponse(p, 1, R0, Tinf);
  const cEnd = (R0 / (p.V1 * k)) * (1 - Math.exp(-k * Tinf));
  ok('1-cmt end-of-infusion concentration', relerr(f(Tinf), cEnd) < 1e-12);
  ok('1-cmt post-infusion decay', relerr(f(Tinf + 3), cEnd * Math.exp(-k * 3)) < 1e-12);
}

/* ---- 3. Steady-state identity: AUC over tau = Dose / CL ---- */
{
  const p = { CL: 6.0, V1: 15.0, Q: 10.0, V2: 25.0 };
  const reg = { dose: 2000, tau: 8, tinf: 0.5, nDoses: 60 };
  const sched = PKPD.buildSchedule(reg);
  const cf = PKPD.concFn(p, 2, sched);
  const m = PKPD.metrics(cf, sched.tEnd - reg.tau, sched.tEnd, { nGrid: 20000 });
  ok('SS AUC_tau = Dose/CL (2-cmt)', relerr(m.auc, reg.dose / p.CL) < 2e-4,
     `auc=${m.auc.toFixed(4)} expected=${(reg.dose / p.CL).toFixed(4)}`);
}

/* ---- 4. Continuous infusion: Css = R0 / CL ---- */
{
  const p = { CL: 12.0, V1: 20.0, Q: 15.0, V2: 30.0 };
  const reg = { mode: 'ci', dose24: 16000, duration: 400 };
  const sched = PKPD.buildSchedule(reg);
  const cf = PKPD.concFn(p, 2, sched);
  ok('CI plateau = R0/CL', relerr(cf(399), (16000 / 24) / p.CL) < 1e-6,
     `C=${cf(399).toFixed(4)} expected=${((16000 / 24) / p.CL).toFixed(4)}`);
}

/* ---- 5. %fT>MIC edge cases ---- */
{
  const p = { CL: 6.0, V1: 15.0, Q: 10.0, V2: 25.0 };
  const sched = PKPD.buildSchedule({ dose: 2000, tau: 8, tinf: 0.5, nDoses: 40 });
  const cf = PKPD.concFn(p, 2, sched);
  const a = PKPD.metrics(cf, sched.tEnd - 8, sched.tEnd, { mic: 0, fu: 1, nGrid: 2000 });
  const b = PKPD.metrics(cf, sched.tEnd - 8, sched.tEnd, { mic: 1e9, fu: 1, nGrid: 2000 });
  ok('%fT>MIC = 100 when MIC = 0', a.tAbove > 99.9);
  ok('%fT>MIC = 0 when MIC huge', b.tAbove === 0);
  // Cmin above MIC implies 100% fT>MIC
  const mic = a.cmin * 0.9;
  const c = PKPD.metrics(cf, sched.tEnd - 8, sched.tEnd, { mic, fu: 1, nGrid: 4000 });
  ok('Cmin > MIC implies 100% fT>MIC', c.tAbove > 99.9, `got ${c.tAbove.toFixed(2)}%`);
}

/* ---- 6. Protein binding scales free metrics only ---- */
{
  const p = { CL: 6.0, V1: 15.0, Q: 10.0, V2: 25.0 };
  const sched = PKPD.buildSchedule({ dose: 2000, tau: 8, tinf: 0.5, nDoses: 40 });
  const cf = PKPD.concFn(p, 2, sched);
  const m = PKPD.metrics(cf, sched.tEnd - 8, sched.tEnd, { fu: 0.5, nGrid: 2000 });
  ok('fu scales fAUC but not AUC', relerr(m.fauc24, m.auc24 * 0.5) < 1e-12 &&
     relerr(m.fcmin, m.cmin * 0.5) < 1e-12);
}

/* ---- 7a. MAP estimator recovers the truth when the data are
   informative. Uses a synthetic model with a tight residual error and
   rich sampling, which isolates the optimiser from prior shrinkage. ---- */
{
  const synth = {
    id: 'synthetic', ncmt: 2, fu: 1,
    params: () => ({ CL: 5.0, V1: 20.0, Q: 8.0, V2: 30.0 }),
    iiv: { CL: 0.5, V1: 0.5 }, iivScale: 'omega',
    err: { add: 0.05, prop: 0.01 }
  };
  const typ = synth.params();
  const truth = { ...typ, CL: typ.CL * Math.exp(-0.55), V1: typ.V1 * Math.exp(0.35) };
  const sched = PKPD.buildSchedule({ dose: 2000, tau: 8, tinf: 0.5, nDoses: 8 });
  const cfTrue = PKPD.concFn(truth, 2, sched);
  const samples = [1, 2, 4, 6, 7.9, 49, 50, 52, 54, 56]
    .map(t => ({ time: t, conc: cfTrue(t) }));
  const fit = PKPD.mapEstimate(synth, {}, sched.events, samples);
  ok('MAP recovers CL from informative data (<3%)', relerr(fit.params.CL, truth.CL) < 0.03,
     `fit=${fit.params.CL.toFixed(4)} true=${truth.CL.toFixed(4)}`);
  ok('MAP recovers V1 from informative data (<5%)', relerr(fit.params.V1, truth.V1) < 0.05,
     `fit=${fit.params.V1.toFixed(4)} true=${truth.V1.toFixed(4)}`);
}

/* ---- 7b. With sparse TDM data, MAP must shrink toward the prior but
   still improve on the population prediction. Shrinkage is the correct
   behaviour here, not a defect: a -0.6 eta on CL is 2.2 omega from the
   prior mean and there are only two samples with a 1.6 mg/L additive
   error, so the posterior mode legitimately sits between the two. ---- */
{
  const model = MODELS.find(m => m.id === 'van_thomson2009');
  const cov = { wt: 75, age: 65, sex: 'M', crcl: 70 };
  const typ = model.params(cov);
  const truth = { ...typ, CL: typ.CL * Math.exp(-0.6), V1: typ.V1 * Math.exp(0.2) };
  const sched = PKPD.buildSchedule({ dose: 1000, tau: 12, tinf: 1, nDoses: 6 });
  const cfTrue = PKPD.concFn(truth, 2, sched);
  const samples = [{ time: 38, conc: cfTrue(38) }, { time: 47.5, conc: cfTrue(47.5) }];
  const fit = PKPD.mapEstimate(model, cov, sched.events, samples);

  const cfPop = PKPD.concFn(typ, 2, sched);
  const ssePop = samples.reduce((s, x) => s + Math.pow(cfPop(x.time) - x.conc, 2), 0);
  const sseMap = fit.fitted.reduce((s, x) => s + Math.pow(x.pred - x.obs, 2), 0);
  ok('MAP fits observations better than the population prediction', sseMap < ssePop,
     `SSE pop=${ssePop.toFixed(3)} map=${sseMap.toFixed(3)}`);
  ok('MAP moves CL toward the true individual value',
     fit.params.CL < typ.CL && fit.params.CL > truth.CL,
     `typ=${typ.CL.toFixed(3)} map=${fit.params.CL.toFixed(3)} true=${truth.CL.toFixed(3)}`);

  // The returned objective must be a genuine minimum relative to eta = 0.
  const keys = PKPD.iivKeys(model);
  const objAt = (etas) => {
    const p = PKPD.withEtas(model, typ, etas);
    const cf = PKPD.concFn(p, 2, sched);
    let ll = 0;
    samples.forEach(s => {
      const pr = cf(s.time), va = 1.6 * 1.6 + Math.pow(0.15 * pr, 2);
      ll += Math.pow(s.conc - pr, 2) / va + Math.log(va);
    });
    keys.forEach((k, i) => {
      const w = PKPD.omegaOf(model, k);
      if (w > 0) ll += Math.pow(etas[i], 2) / (w * w);
    });
    return ll;
  };
  ok('MAP objective improves on the population prior point',
     fit.objective < objAt(keys.map(() => 0)) - 1e-9,
     `map=${fit.objective.toFixed(4)} eta0=${objAt(keys.map(() => 0)).toFixed(4)}`);
}

/* ---- 8. Monte Carlo PTA is monotone decreasing in MIC, and seeded ---- */
{
  const model = MODELS.find(m => m.id === 'pip_kim2022');
  const cov = { wt: 80, age: 60, sex: 'M', egfr: 90, ecmo: false };
  const cfg = {
    model, cov,
    regimen: { dose: 4000, tau: 6, tinf: 0.5 },
    target: model.targets[0], mics: [1, 2, 4, 8, 16, 32, 64],
    n: 400, seed: 7, mic: 16
  };
  const r1 = PKPD.simulate(cfg);
  const r2 = PKPD.simulate(cfg);
  let mono = true;
  for (let i = 1; i < r1.pta.length; i++) {
    if (r1.pta[i].pta > r1.pta[i - 1].pta + 1e-9) mono = false;
  }
  ok('PTA non-increasing across the MIC ladder', mono,
     r1.pta.map(x => `${x.mic}:${x.pta.toFixed(1)}`).join(' '));
  ok('simulation is reproducible for a fixed seed',
     JSON.stringify(r1.pta) === JSON.stringify(r2.pta));
  ok('PTA at low MIC is high', r1.pta[0].pta > 90, `${r1.pta[0].pta.toFixed(1)}%`);
  const bp = PKPD.pkpdBreakpoint(r1.pta, 90);
  ok('PK/PD breakpoint resolves', bp !== null, `breakpoint=${bp} mg/L`);
}

/* ---- 9. Extended infusion increases %fT>MIC (the core teaching point) ---- */
{
  const model = MODELS.find(m => m.id === 'pip_kim2022');
  const cov = { wt: 80, age: 60, sex: 'M', egfr: 90, ecmo: false };
  const base = { model, cov, target: model.targets[1], mics: [16],
                 n: 400, seed: 11, mic: 16 };
  const short = PKPD.simulate({ ...base, regimen: { dose: 4000, tau: 6, tinf: 0.5 } });
  const long = PKPD.simulate({ ...base, regimen: { dose: 4000, tau: 6, tinf: 4 } });
  ok('4 h infusion beats 0.5 h infusion for 100% fT>MIC',
     long.pta[0].pta > short.pta[0].pta,
     `0.5h=${short.pta[0].pta.toFixed(1)}%  4h=${long.pta[0].pta.toFixed(1)}%`);
}

/* ---- 10. Renal function estimators ---- */
{
  // Cockcroft-Gault worked example: 70 kg, 60 y, male, SCr 1.0 mg/dL
  const cg = PKPD.cockcroftGault({ wt: 70, age: 60, sex: 'M', scr: 1.0, scrUnit: 'mg/dL' });
  ok('Cockcroft-Gault male worked example', relerr(cg, (140 - 60) * 70 / 72) < 1e-12,
     `${cg.toFixed(2)} mL/min`);
  const cgf = PKPD.cockcroftGault({ wt: 70, age: 60, sex: 'F', scr: 1.0, scrUnit: 'mg/dL' });
  ok('Cockcroft-Gault female factor 0.85', relerr(cgf, cg * 0.85) < 1e-12);
  const u = PKPD.cockcroftGault({ wt: 70, age: 60, sex: 'M', scr: 88.4, scrUnit: 'umol/L' });
  ok('umol/L and mg/dL agree', relerr(u, cg) < 1e-9);
}

/* ---- 11. Correlated IIV: the Cholesky sampler must reproduce the
   requested correlation and marginal omegas, and must reduce exactly to
   independent sampling when no correlation is declared. ---- */
{
  const spec = {
    ncmt: 2, fu: 1,
    params: () => ({ CL: 10, V1: 20, Q: 8, V2: 30 }),
    iiv: { CL: 0.4, V1: 0.6 }, iivScale: 'omega',
    iivCorr: [['CL', 'V1', 0.7]]
  };
  const n = 40000;
  const subs = PKPD.samplePopulation(spec, {}, n, 99);
  // Recover etas from the sampled parameters.
  const eCL = subs.map(p => Math.log(p.CL / 10)), eV = subs.map(p => Math.log(p.V1 / 20));
  const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
  const corr = (a, b) => {
    const ma = mean(a), mb = mean(b);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) {
      num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2;
    }
    return num / Math.sqrt(da * db);
  };
  ok('correlated IIV: omega on CL recovered', Math.abs(sd(eCL) - 0.4) < 0.01,
     `sd=${sd(eCL).toFixed(4)} target 0.40`);
  ok('correlated IIV: omega on V1 recovered', Math.abs(sd(eV) - 0.6) < 0.015,
     `sd=${sd(eV).toFixed(4)} target 0.60`);
  ok('correlated IIV: correlation recovered', Math.abs(corr(eCL, eV) - 0.7) < 0.02,
     `r=${corr(eCL, eV).toFixed(4)} target 0.70`);

  // Same spec without iivCorr must give an essentially zero correlation.
  const indep = { ...spec }; delete indep.iivCorr;
  const s2 = PKPD.samplePopulation(indep, {}, n, 99);
  const r0 = corr(s2.map(p => Math.log(p.CL / 10)), s2.map(p => Math.log(p.V1 / 20)));
  ok('no iivCorr declared -> independent sampling', Math.abs(r0) < 0.02,
     `r=${r0.toFixed(4)}`);
}

/* ---- 12. mahalanobis2 must equal x' S^-1 x computed directly ---- */
{
  const spec = { iiv: { CL: 0.4, V1: 0.6 }, iivScale: 'omega',
                 iivCorr: [['CL', 'V1', 0.7]] };
  const cv = PKPD.iivCov(spec), L = PKPD.cholesky(cv.S);
  const x = [0.23, -0.41];
  // Explicit 2x2 inverse.
  const [[a, b], [c, d]] = cv.S, det = a * d - b * c;
  const direct = (x[0] * (d * x[0] - b * x[1]) + x[1] * (-c * x[0] + a * x[1])) / det;
  ok('mahalanobis2 matches the explicit 2x2 quadratic form',
     relerr(PKPD.mahalanobis2(L, x), direct) < 1e-12,
     `chol=${PKPD.mahalanobis2(L, x).toFixed(8)} direct=${direct.toFixed(8)}`);
  // A correlated prior must penalise a same-sign pair LESS than an
  // opposite-sign pair of the same magnitude (positive correlation).
  const same = PKPD.mahalanobis2(L, [0.4, 0.4]), opp = PKPD.mahalanobis2(L, [0.4, -0.4]);
  ok('positive correlation penalises concordant deviations less', same < opp,
     `same=${same.toFixed(3)} opposite=${opp.toFixed(3)}`);
}

/* ---- 13. MDRD estimator ---- */
{
  const m = PKPD.mdrd({ scr: 1.0, scrUnit: 'mg/dL', age: 60, sex: 'M' });
  const expect = 175 * Math.pow(1.0, -1.154) * Math.pow(60, -0.203);
  ok('MDRD male worked example', relerr(m, expect) < 1e-12, `${m.toFixed(2)} mL/min/1.73m2`);
  const f = PKPD.mdrd({ scr: 1.0, scrUnit: 'mg/dL', age: 60, sex: 'F' });
  ok('MDRD female factor 0.742', relerr(f, m * 0.742) < 1e-12);
  ok('MDRD falls as creatinine rises',
     PKPD.mdrd({ scr: 2.0, scrUnit: 'mg/dL', age: 60, sex: 'M' }) < m);
}

/* ---- 14. One-compartment model spec runs end to end ---- */
{
  const oj = MODELS.find(m => m.id === 'mem_ojeanson2021');
  ok('O\'Jeanson model is 1-compartment', oj.ncmt === 1);
  // The paper's typical patient: median GFR_MDRD 49 mL/min, median
  // residual diuresis 845 mL/24h -> CL = 1.36 + 0.058*49 = 4.20 L/h.
  const p = oj.params({ egfr: 49, rd: 845, dialysis: 'none' });
  ok('O\'Jeanson typical CL reproduces the published 4.20 L/h',
     Math.abs(p.CL - 4.20) < 0.005, `CL=${p.CL.toFixed(4)} L/h, V=${p.V1} L`);
  // Modality is a step function, not a smooth function of GFR.
  const semi = oj.params({ egfr: 49, rd: 845, dialysis: 'semicont' });
  const semiHiGfr = oj.params({ egfr: 200, rd: 5000, dialysis: 'semicont' });
  ok('semi-continuous dialysis CL is independent of GFR and diuresis',
     semi.CL === 11.0 && semiHiGfr.CL === 11.0, `CL=${semi.CL} L/h`);
  ok('continuous dialysis CL exceeds the low-GFR non-dialysis value',
     oj.params({ egfr: 10, rd: 845, dialysis: 'cont' }).CL >
     oj.params({ egfr: 10, rd: 845, dialysis: 'none' }).CL);
  ok('GFR >= 120 switches to the renal-function-status clearance',
     Math.abs(oj.params({ egfr: 120, rd: 845, dialysis: 'none' }).CL - 13.9) < 1e-9);
}

/* ---- 15. Gijsen covariate equation matches the published form ---- */
{
  const g = MODELS.find(m => m.id === 'mem_gijsen2021');
  // CL_i = 14.7 x (BW/70)^0.75 x (eGFR/105)^1.29
  const p = g.params({ wt: 70, egfr: 105 });
  ok('Gijsen CL at the reference covariates equals 14.7 L/h',
     Math.abs(p.CL - 14.7) < 1e-9, `CL=${p.CL.toFixed(4)}`);
  ok('Gijsen Vc at 70 kg equals 25.6 L', Math.abs(p.V1 - 25.6) < 1e-9);
  const p2 = g.params({ wt: 70, egfr: 210 });
  ok('Gijsen CL scales as eGFR^1.29',
     relerr(p2.CL / p.CL, Math.pow(2, 1.29)) < 1e-9,
     `ratio=${(p2.CL / p.CL).toFixed(4)} expected=${Math.pow(2, 1.29).toFixed(4)}`);
}

/* ---- 16. Shekar RRT decoupling ---- */
{
  const s = MODELS.find(m => m.id === 'mem_shekar2014');
  const onRrt = s.params({ crcl: 20, rrt: true }),
        onRrtHi = s.params({ crcl: 180, rrt: true });
  ok('on RRT, Shekar CL is fixed at 5.1 L/h regardless of CLcr',
     onRrt.CL === 5.1 && onRrtHi.CL === 5.1);
  // Off RRT: CL = 1.89 x CLcr in L/h.
  const off = s.params({ crcl: 100, rrt: false });
  ok('off RRT, Shekar CL = 1.89 x CLcr(L/h)',
     relerr(off.CL, 1.89 * 100 * 0.06) < 1e-12, `CL=${off.CL.toFixed(3)} L/h at CLcr 100`);
}

console.log(fails === 0 ? '\nALL TESTS PASSED' : `\n${fails} TEST(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
