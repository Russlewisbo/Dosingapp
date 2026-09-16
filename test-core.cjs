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

/* ---- 17. Evaluation window vs plot window.
   The PD target is evaluated over ONE dosing interval; which interval is
   selectable, and the plot window is independent of it. ---- */
{
  const model = MODELS.find(m => m.id === 'mem_gijsen2021');
  const cov = { wt: 70, age: 60, sex: 'M', egfr: 105 };
  const base = { model, cov, regimen: { dose: 1000, tau: 8, tinf: 0.5 },
                 target: model.targets.find(t => t.id === 'ft100'),
                 mics: [2], mic: 2, n: 300, seed: 5 };

  const last = PKPD.simulate(base);
  ok('default evaluates the LAST dosing interval',
     relerr(last.tB, last.nDoses * 8) < 1e-12 && relerr(last.tA, (last.nDoses - 1) * 8) < 1e-12,
     `dose ${last.evalDose} of ${last.nDoses}: ${last.tA}-${last.tB} h`);
  ok('default schedule is dosed out to steady state', last.atSteadyState === true,
     `${last.nDoses} doses given, ${last.dosesToSteadyState} needed`);

  const first = PKPD.simulate({ ...base, evalDose: 1 });
  ok('evalDose=1 evaluates the first interval',
     first.tA === 0 && relerr(first.tB, 8) < 1e-12, `${first.tA}-${first.tB} h`);
  ok('first interval is flagged as NOT steady state', first.atSteadyState === false);

  // An accumulating drug must not attain MORE on dose 1 than at steady state.
  ok('first-dose attainment does not exceed steady-state attainment',
     first.pta[0].pta <= last.pta[0].pta + 1e-9,
     `dose 1 ${first.pta[0].pta.toFixed(1)}% vs steady state ${last.pta[0].pta.toFixed(1)}%`);

  // Plot window is independent of the evaluation window.
  const whole = PKPD.simulate({ ...base, plotWhole: true });
  ok('plotWhole spans the whole course',
     whole.tPlotA === 0 && relerr(whole.tPlotB, whole.nDoses * 8) < 1e-12,
     `plot ${whole.tPlotA}-${whole.tPlotB} h over ${whole.nDoses} doses`);
  ok('plotWhole leaves the evaluation window unchanged',
     whole.tA === last.tA && whole.tB === last.tB);
  ok('plotWhole does not change the reported metrics',
     Math.abs(whole.pta[0].pta - last.pta[0].pta) < 1e-9,
     `${whole.pta[0].pta.toFixed(2)}% vs ${last.pta[0].pta.toFixed(2)}%`);
  ok('plot grid actually covers the course',
     whole.times[0] === 0 && relerr(whole.times[whole.times.length - 1], whole.nDoses * 8) < 1e-12);

  // A short course must be reported as pre-steady-state, not mislabelled.
  const short = PKPD.simulate({ ...base, regimen: { dose: 1000, tau: 8, tinf: 0.5, nDoses: 2 } });
  ok('a 2-dose course is flagged pre-steady-state when more doses are needed',
     short.nDoses === 2 && short.atSteadyState === (2 >= short.dosesToSteadyState),
     `2 doses given, ${short.dosesToSteadyState} needed -> atSteadyState=${short.atSteadyState}`);
  ok('evalDose is clamped to the number of doses given',
     PKPD.simulate({ ...base, regimen: { dose: 1000, tau: 8, tinf: 0.5, nDoses: 3 },
                     evalDose: 99 }).evalDose === 3);

  // Accumulation must be visible: trough on dose 1 < trough at steady state.
  const t1 = PKPD.simulate({ ...base, evalDose: 1 }).exposure.cmin.median;
  const tss = last.exposure.cmin.median;
  ok('trough accumulates from the first dose to steady state', tss > t1,
     `dose 1 ${t1.toFixed(2)} -> steady state ${tss.toFixed(2)} mg/L`);
}

/* ---- 19. Multivariate-normal sampling on the natural scale.
   Used for nonparametric models that publish a covariance matrix. With
   a mean far from any boundary, no draw is rejected and the sampler must
   recover the requested means, SDs and correlation. ---- */
{
  // Direct 2-parameter check: CL and V1 sampled with a known covariance.
  const spec = {
    ncmt: 1, fu: 1, sampling: 'mvnorm',
    mvMean: [10, 40],
    mvCov: [[4, 2.4], [2.4, 9]],           // SD 2 and 3, correlation 0.4
    params: () => ({ CL: 10, V1: 40 }),
    paramsFromDraw: (d) => ({ CL: d[0], V1: d[1] })
  };
  const s = PKPD.samplePopulation(spec, {}, 40000, 5);
  const cl = s.map(p => p.CL), v1 = s.map(p => p.V1);
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
  const corr = (a, b) => {
    const ma = mean(a), mb = mean(b);
    return mean(a.map((x, i) => (x - ma) * (b[i] - mb))) / (sd(a) * sd(b));
  };
  ok('MVN sampler recovers the mean vector', Math.abs(mean(cl) - 10) < 0.05 &&
     Math.abs(mean(v1) - 40) < 0.08, `${mean(cl).toFixed(3)}, ${mean(v1).toFixed(3)}`);
  ok('MVN sampler recovers the marginal SDs', Math.abs(sd(cl) - 2) < 0.04 &&
     Math.abs(sd(v1) - 3) < 0.06, `${sd(cl).toFixed(3)}, ${sd(v1).toFixed(3)}`);
  ok('MVN sampler recovers the correlation', Math.abs(corr(cl, v1) - 0.4) < 0.02,
     corr(cl, v1).toFixed(4));
  ok('no rejection when the distribution is far from the positivity boundary',
     s.rejectedFraction < 1e-6, `${(s.rejectedFraction * 100).toFixed(3)}%`);
  ok('the sampler is reproducible for a fixed seed',
     PKPD.samplePopulation(spec, {}, 200, 5)[7].CL === PKPD.samplePopulation(spec, {}, 200, 5)[7].CL);
}

/* ---- 20. Rejection of non-physical draws.
   A mean close to zero relative to its SD forces rejections; every
   returned subject must still be physically valid, and the requested
   count must be honoured. ---- */
{
  const spec = {
    ncmt: 1, fu: 1, sampling: 'mvnorm',
    mvMean: [1, 40], mvCov: [[4, 0], [0, 9]],   // CL mean 1, SD 2
    params: () => ({ CL: 1, V1: 40 }),
    paramsFromDraw: (d) => ({ CL: d[0], V1: d[1] })
  };
  const s = PKPD.samplePopulation(spec, {}, 3000, 9);
  ok('rejection sampling returns exactly the requested number of subjects',
     s.length === 3000, `${s.length}`);
  ok('every returned subject is physically valid',
     s.every(p => p.CL > 0 && p.V1 > 0));
  ok('the rejection fraction is reported and substantial here',
     s.rejectedFraction > 0.2 && s.rejectedFraction < 0.45,
     `${(s.rejectedFraction * 100).toFixed(1)}% (theoretical ~31% for mean 1, SD 2)`);
}

/* ---- 21. Micro-constant conversion for the nonparametric cefepime model.
   CL/V1/Q/V2 must be recoverable from K10/K12/K21/V1, and the model's
   typical parameters must satisfy the published rate constants. ---- */
{
  const m = MODELS.find(x => x.id === 'cef_nicasio2009');
  const cov = { wt: 80, age: 60, sex: 'M', crcl: 100 };
  const p = m.params(cov);
  const k10 = p.CL / p.V1, k12 = p.Q / p.V1, k21 = p.Q / p.V2;
  ok('K10 = 0.071 + 0.0027 x CLcr as published',
     relerr(k10, 0.071 + 0.0027 * 100) < 1e-12, `K10 ${k10.toFixed(5)} /h`);
  ok('V1 = 0.206 L/kg x total body weight', relerr(p.V1, 0.206 * 80) < 1e-12,
     `V1 ${p.V1.toFixed(2)} L`);
  ok('K12 and K21 recover the published medians',
     relerr(k12, 0.78) < 1e-12 && relerr(k21, 0.472) < 1e-12,
     `K12 ${k12.toFixed(4)}, K21 ${k21.toFixed(4)}`);
}

/* ---- 21. Concentration-dependent targets: peak-to-MIC, trough ceiling,
   and their composite.

   These have a property no other target in the library has: the trough
   ceiling is met by a LOW exposure, so it moves in the opposite direction
   to every efficacy target. A synthetic 2-compartment model with
   aminoglycoside-like disposition is used — this tests the target
   machinery, not any published drug model. ---- */
{
  const agSynth = {
    id: 'synthetic_aminoglycoside_like', ncmt: 2, fu: 1,
    params: (c) => ({ CL: 5.0 * (Math.max(5, c.crcl) / 100), V1: 18, Q: 4, V2: 10 }),
    iiv: { CL: 0.30, V1: 0.20 }, iivScale: 'omega',
    err: { add: 0.2, prop: 0.10 }
  };
  const PEAK = { id: 'cmax10', type: 'cmaxmic', threshold: 10, label: 'Cmax/MIC \u2265 10' };
  const CEIL = { id: 'cmin1', type: 'cminceil', hi: 1, label: 'Cmin \u2264 1 mg/L' };
  const BOTH = { id: 'od', type: 'composite', label: 'peak and trough', all: [PEAK, CEIL] };

  const sim = (regimen, target, crcl, mic) => PKPD.simulate({
    model: agSynth, cov: { crcl }, regimen, target,
    mics: [mic], mic, n: 1500, seed: 42, nGrid: 600
  });

  // (a) Peak target behaves like an efficacy target: falls as MIC rises.
  const ladder = PKPD.simulate({
    model: agSynth, cov: { crcl: 100 },
    regimen: { dose: 420, tau: 24, tinf: 0.5 }, target: PEAK,
    mics: [0.5, 1, 2, 4, 8], mic: 1, n: 1000, seed: 3, nGrid: 400
  }).pta;
  let mono = true;
  for (let i = 1; i < ladder.length; i++) if (ladder[i].pta > ladder[i - 1].pta + 1e-9) mono = false;
  ok('Cmax/MIC attainment is non-increasing across the MIC ladder', mono,
     ladder.map(x => `${x.mic}:${x.pta.toFixed(0)}`).join(' '));

  // (b) Trough ceiling runs the OTHER way: a bigger dose makes it harder.
  const ceilLow = sim({ dose: 300, tau: 24, tinf: 0.5 }, CEIL, 100, 1).ptaAtRefMic;
  const ceilHigh = sim({ dose: 1200, tau: 24, tinf: 0.5 }, CEIL, 100, 1).ptaAtRefMic;
  ok('trough-ceiling attainment falls as the dose rises (opposite sense)',
     ceilHigh <= ceilLow, `300 mg ${ceilLow.toFixed(1)}% vs 1200 mg ${ceilHigh.toFixed(1)}%`);

  // (c) THE once-daily argument, as a property of the engine: at a fixed
  // total daily dose, extending the interval raises the peak and lowers
  // the trough. Both halves must hold.
  const od = sim({ dose: 420, tau: 24, tinf: 0.5 }, BOTH, 100, 1);
  const tid = sim({ dose: 140, tau: 8, tinf: 0.5 }, BOTH, 100, 1);
  ok('same daily dose: once-daily gives the higher peak',
     od.exposure.cmax.median > tid.exposure.cmax.median,
     `q24h ${od.exposure.cmax.median.toFixed(1)} vs q8h ${tid.exposure.cmax.median.toFixed(1)} mg/L`);
  ok('same daily dose: once-daily gives the lower trough',
     od.exposure.cmin.median < tid.exposure.cmin.median,
     `q24h ${od.exposure.cmin.median.toFixed(2)} vs q8h ${tid.exposure.cmin.median.toFixed(2)} mg/L`);
  ok('same daily dose: AUC is essentially unchanged by the interval',
     relerr(od.exposure.auc24.median, tid.exposure.auc24.median) < 0.02,
     `q24h ${od.exposure.auc24.median.toFixed(1)} vs q8h ${tid.exposure.auc24.median.toFixed(1)} mg·h/L`);
  ok('once-daily attains the joint peak-and-trough target more often',
     od.ptaAtRefMic > tid.ptaAtRefMic,
     `q24h ${od.ptaAtRefMic.toFixed(1)}% vs q8h ${tid.ptaAtRefMic.toFixed(1)}%`);

  // (d) The composite is a JOINT probability over subjects, so it can
  // never exceed either margin, and is reported component-wise.
  ok('composite reports one entry per component',
     od.components && od.components.length === 2,
     od.components ? od.components.map(c => `${c.type}:${c.pta.toFixed(1)}%`).join(' ') : 'none');
  ok('joint attainment never exceeds either component',
     od.ptaAtRefMic <= Math.min(...od.components.map(c => c.pta)) + 1e-9,
     `joint ${od.ptaAtRefMic.toFixed(1)}% vs components ` +
     od.components.map(c => c.pta.toFixed(1)).join('/'));

  // (e) Renal impairment breaks once-daily via the TROUGH, not the peak —
  // the second thing the user wants to teach.
  const good = sim({ dose: 420, tau: 24, tinf: 0.5 }, BOTH, 100, 1);
  const bad = sim({ dose: 420, tau: 24, tinf: 0.5 }, BOTH, 20, 1);
  const cGood = Object.fromEntries(good.components.map(c => [c.type, c.pta]));
  const cBad = Object.fromEntries(bad.components.map(c => [c.type, c.pta]));
  ok('renal impairment degrades the trough ceiling',
     cBad.cminceil < cGood.cminceil,
     `CLcr 100 ${cGood.cminceil.toFixed(1)}% -> CLcr 20 ${cBad.cminceil.toFixed(1)}%`);
  ok('renal impairment does NOT degrade the peak',
     cBad.cmaxmic >= cGood.cmaxmic - 1e-9,
     `CLcr 100 ${cGood.cmaxmic.toFixed(1)}% -> CLcr 20 ${cBad.cmaxmic.toFixed(1)}%`);
  ok('and extending the interval restores the trough at reduced renal function',
     sim({ dose: 420, tau: 48, tinf: 0.5 }, CEIL, 20, 1).ptaAtRefMic >
     sim({ dose: 420, tau: 24, tinf: 0.5 }, CEIL, 20, 1).ptaAtRefMic,
     `q24h ${sim({ dose: 420, tau: 24, tinf: 0.5 }, CEIL, 20, 1).ptaAtRefMic.toFixed(1)}%` +
     ` -> q48h ${sim({ dose: 420, tau: 48, tinf: 0.5 }, CEIL, 20, 1).ptaAtRefMic.toFixed(1)}%`);
}

/* ---- 22. REGRESSION: comparing regimens with DIFFERENT dosing
   intervals. Each is dosed to its own steady state, so their evaluation
   windows sit at different absolute times and have different lengths.
   A plot window taken from the first regimen alone threw the others off
   the canvas (282 of 458 vertices, at x as low as -448). The engine-side
   property that makes correct plotting possible is asserted here; the
   layout audit covers the drawing itself. ---- */
{
  const model = MODELS.find(m => m.id === 'gen_xuan2004');
  const mk = (dose, tau) => PKPD.simulate({
    model, cov: { crcl: 90, wt: 70, age: 55, sex: 'M' },
    regimen: { dose, tau, tinf: 1 }, target: model.targets[0],
    mics: [1], mic: 1, n: 200, seed: 4, nGrid: 200
  });
  const a = mk(420, 24), b = mk(140, 8);
  ok('regimens with different tau report different interval lengths',
     Math.abs((a.tB - a.tA) - 24) < 1e-6 && Math.abs((b.tB - b.tA) - 8) < 1e-6,
     `${(a.tB - a.tA).toFixed(1)} h vs ${(b.tB - b.tA).toFixed(1)} h`);
  ok('each regimen carries its own window start, so it can be aligned',
     a.tA !== b.tA, `tA ${a.tA} vs ${b.tA}`);
  ok('every sample time lies inside that regimen\'s own window',
     b.times.every(x => x >= b.tA - 1e-9 && x <= b.tB + 1e-9),
     `${b.times[0]}..${b.times[b.times.length - 1]} within ${b.tA}..${b.tB}`);
}

console.log(fails === 0 ? '\nALL TESTS PASSED' : `\n${fails} TEST(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
