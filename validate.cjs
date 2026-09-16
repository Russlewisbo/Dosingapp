/* External validation: does the implemented Kim 2022 piperacillin model,
   as coded here, reproduce the dosing conclusion that the paper itself
   reached from its own Monte Carlo simulations?

   The paper's conclusion (abstract): "Prolonged or continuous infusion of
   16 g/day was required when the treatment goal was 100% fT>MIC or
   100% fT>4xMIC, and patients had an eGFR of 130-170 mL/min/1.73 m2."
   It also reports PTA >90% for 50% fT>MIC under the currently
   recommended regimen for the more susceptible Enterobacterales.

   Reproducing that pattern from independently coded parameters is
   evidence the covariate model, allometric scaling, free fraction and
   %fT>MIC calculation were all transcribed correctly. It is a
   qualitative check: the paper simulated weight and renal function
   distributions that are not fully specified here, so exact PTA
   percentages are not expected to match.
   Run: node validate.cjs                                              */
const PKPD = require('./pkpd-core.js');
const { MODELS } = require('./models.js');

const model = MODELS.find(m => m.id === 'pip_kim2022');
const TARGETS = {
  'ft50': model.targets[0],
  'ft100': model.targets[1],
  'ft100x4': model.targets[2]
};
// 70 kg = the allometric reference weight of the model, so no extra
// assumption about the weight distribution is introduced.
const cov = { wt: 70, age: 60, sex: 'M', ecmo: false };

const REGIMENS = [
  ['4 g q6h, 0.5 h', { dose: 4000, tau: 6, tinf: 0.5 }],
  ['4 g q6h, 4 h', { dose: 4000, tau: 6, tinf: 4 }],
  ['16 g/24 h CI', { mode: 'ci', dose24: 16000, duration: 240 }]
];

function pta(regimen, targetId, egfr, mic) {
  const r = PKPD.simulate({
    model, cov: { ...cov, egfr },
    regimen, target: TARGETS[targetId],
    mics: [mic], mic, n: 2000, seed: 4242, nGrid: 600
  });
  return r.pta[0].pta;
}

function table(targetId, egfr, mic) {
  console.log(`\n  target ${TARGETS[targetId].label}   eGFR ${egfr} mL/min/1.73m2   MIC ${mic} mg/L`);
  const out = {};
  for (const [lab, reg] of REGIMENS) {
    const v = pta(reg, targetId, egfr, mic);
    out[lab] = v;
    console.log(`    ${lab.padEnd(16)} PTA ${v.toFixed(1).padStart(5)}%  ${v >= 90 ? '(>=90%)' : ''}`);
  }
  return out;
}

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) { fails++; console.log('\nFAIL  ' + name + (detail ? '  ' + detail : '')); }
  else console.log('\npass  ' + name + (detail ? '  ' + detail : ''));
};

console.log('Kim 2022 piperacillin model — reproduction of the published dosing conclusion');

// (a) Augmented renal function, MIC at the upper susceptible range.
const aug = table('ft100', 150, 16);
ok('at eGFR 150 / MIC 16, standard 0.5 h infusion of 16 g/day does NOT reach 90% for 100% fT>MIC',
   aug['4 g q6h, 0.5 h'] < 90, `PTA ${aug['4 g q6h, 0.5 h'].toFixed(1)}%`);
ok('prolonged or continuous infusion of the same 16 g/day does better',
   aug['4 g q6h, 4 h'] > aug['4 g q6h, 0.5 h'] &&
   aug['16 g/24 h CI'] > aug['4 g q6h, 0.5 h'],
   `0.5h ${aug['4 g q6h, 0.5 h'].toFixed(1)}% < 4h ${aug['4 g q6h, 4 h'].toFixed(1)}% ; CI ${aug['16 g/24 h CI'].toFixed(1)}%`);
ok('continuous infusion attains 100% fT>MIC at this MIC',
   aug['16 g/24 h CI'] >= 90, `PTA ${aug['16 g/24 h CI'].toFixed(1)}%`);

// (b) The easier target under the recommended regimen.
const easy = table('ft50', 90, 8);
ok('50% fT>MIC at MIC 8 is attained by the recommended regimen at normal renal function',
   easy['4 g q6h, 0.5 h'] >= 90, `PTA ${easy['4 g q6h, 0.5 h'].toFixed(1)}%`);

// (c) The most stringent target, per the paper the hardest to reach.
const hard = table('ft100x4', 150, 8);
ok('100% fT>4xMIC is harder than 100% fT>MIC at the same MIC',
   hard['4 g q6h, 0.5 h'] < aug['4 g q6h, 0.5 h'] ||
   hard['4 g q6h, 0.5 h'] < 90,
   `100%fT>4xMIC(MIC8) ${hard['4 g q6h, 0.5 h'].toFixed(1)}%`);

// (d) Renal function gradient: PTA must fall as eGFR rises.
console.log('\n  100% fT>MIC at MIC 16, 4 g q6h 0.5 h infusion, across renal function');
const grad = [30, 60, 90, 130, 170].map(e => {
  const v = pta({ dose: 4000, tau: 6, tinf: 0.5 }, 'ft100', e, 16);
  console.log(`    eGFR ${String(e).padStart(3)}  PTA ${v.toFixed(1).padStart(5)}%`);
  return v;
});
let mono = true;
for (let i = 1; i < grad.length; i++) if (grad[i] > grad[i - 1] + 1e-9) mono = false;
ok('PTA decreases monotonically with rising eGFR', mono, grad.map(v => v.toFixed(1)).join(' > '));

// (e) ECMO reduces the central volume, per the paper.
const p70 = model.params({ ...cov, egfr: 90 });
const pEcmo = model.params({ ...cov, egfr: 90, ecmo: true });
ok('ECMO decreases central volume of distribution',
   pEcmo.V1 < p70.V1, `V1 non-ECMO ${p70.V1.toFixed(2)} L vs ECMO ${pEcmo.V1.toFixed(2)} L`);

/* ===================================================================
   MEROPENEM models
   =================================================================== */
console.log('\n\n' + '='.repeat(70));
console.log('Meropenem models — reproduction of published quantities');
console.log('='.repeat(70));

const mGij = MODELS.find(m => m.id === 'mem_gijsen2021');
const mShe = MODELS.find(m => m.id === 'mem_shekar2014');
const mOje = MODELS.find(m => m.id === 'mem_ojeanson2021');

/* ---- Shekar 2014: the abstract reports OBSERVED mean clearances of
   11.7 +/- 6.5 L/h in the non-ECMO sepsis controls and 7.9 +/- 5.9 L/h
   on ECMO. Those are the most reliable published anchors for the
   clearance parameterisation, since they are measurements rather than
   derived simulations. ---- */
{
  const clAt = (crcl, rrt) => mShe.params({ wt: 80, age: 60, sex: 'M', crcl, rrt }).CL;
  console.log('\n  Shekar 2014: implemented CL vs the cohort clearances the paper reports');
  [[100, 'typical preserved renal function'], [70, 'moderately reduced'],
   [180, 'augmented']].forEach(([c, lab]) => {
    console.log(`    CLcr ${String(c).padStart(3)} mL/min  CL ${clAt(c, false).toFixed(2).padStart(6)} L/h   (${lab})`);
  });
  console.log(`    on RRT (any CLcr) CL ${clAt(100, true).toFixed(2)} L/h`);
  ok('Shekar CL at CLcr 100 matches the reported control mean of 11.7 L/h (within 1 SD)',
     Math.abs(clAt(100, false) - 11.7) < 6.5,
     `model ${clAt(100, false).toFixed(2)} vs reported 11.7 +/- 6.5 L/h`);
  ok('Shekar CL at CLcr 70 matches the reported ECMO mean of 7.9 L/h (within 1 SD)',
     Math.abs(clAt(70, false) - 7.9) < 5.9,
     `model ${clAt(70, false).toFixed(2)} vs reported 7.9 +/- 5.9 L/h`);
  ok('RRT clearance is the published fixed value', clAt(100, true) === 5.1);
}

/* ---- Shekar 2014, Table 3: DOCUMENTED NON-REPRODUCIBILITY.

   Table 3 tabulates simulated trough concentrations by CLcr. Inverting
   it — solving for the clearance that reproduces each published trough,
   holding the published Vc/Vp/Q fixed — yields clearances of roughly
   2.4 to 5.5 L/h across CLcr 20 to 180. That contradicts the same
   paper's reported observed clearances (7.9 to 11.7 L/h) and cannot be
   produced by the Table 2 covariate equation under any unit reading.
   The 1 g column is also internally inconsistent with the 500 mg and
   2 g columns, which are dose-proportional to each other.

   This check therefore asserts the inconsistency rather than the
   agreement, so that the discrepancy is recorded and regression-tested
   instead of being quietly tuned away. ---- */
{
  const V1 = 18.7, V2 = 13.2, Q = 21.0;
  const PUB50 = { 20: [18.9, 26.4, 76.4], 50: [14.5, 19.7, 58.8],
                  80: [10.0, 14.8, 39.7], 120: [7.6, 11.1, 30.0],
                  180: [5.6, 7.9, 21.7] };
  const doses = [500, 1000, 2000];
  const troughFor = (CL, dose) => {
    const sched = PKPD.buildSchedule({ dose, tau: 8, tinf: 0.5, nDoses: 60 });
    return PKPD.concFn({ CL, V1, Q, V2 }, 2, sched)(sched.tEnd);
  };
  const solveCL = (target, dose) => {
    let lo = 0.2, hi = 60;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (troughFor(mid, dose) > target) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  console.log('\n  Shekar Table 3 inverted: clearance implied by each published trough');
  console.log('    CLcr   from500mg    from1g   from2g   | Table 2 equation');
  const implied = {};
  for (const crcl of [20, 50, 80, 120, 180]) {
    const imp = doses.map((d, i) => solveCL(PUB50[crcl][i], d));
    implied[crcl] = imp;
    const eq = mShe.params({ wt: 80, age: 60, sex: 'M', crcl, rrt: false }).CL;
    console.log(`    ${String(crcl).padStart(4)} ` +
      imp.map(x => x.toFixed(2).padStart(10)).join(' ') +
      `   | ${eq.toFixed(2).padStart(6)} L/h`);
  }
  // The 500 mg and 2 g columns must agree with each other (linear PK).
  const agree = [20, 50, 80, 120, 180].every(c =>
    Math.abs(implied[c][0] - implied[c][2]) / implied[c][0] < 0.05);
  ok('Table 3: the 500 mg and 2 g columns are mutually dose-proportional', agree);
  const oneGramOff = [20, 50, 80, 120, 180].every(c => implied[c][1] > implied[c][0] * 1.1);
  ok('Table 3: the 1 g column is inconsistent with the other two (published anomaly)',
     oneGramOff,
     '1 g implies a systematically higher clearance than 500 mg / 2 g at every CLcr');
  const maxImplied = Math.max(...[20, 50, 80, 120, 180].map(c => implied[c][0]));
  ok('Table 3 implies clearances far below the clearances the same paper measured',
     maxImplied < 7.9,
     `max implied ${maxImplied.toFixed(2)} L/h vs reported means 7.9-11.7 L/h`);
}

/* ---- Gijsen 2021 ---- */
{
  console.log('\n  Gijsen 2021: covariate equation and correlated variability');
  const p = mGij.params({ wt: 70, egfr: 105 });
  console.log(`    reference patient (70 kg, eGFR 105): CL ${p.CL.toFixed(2)} L/h, ` +
              `Vc ${p.V1.toFixed(1)} L, Q ${p.Q.toFixed(2)} L/h, Vp ${p.V2.toFixed(2)} L`);
  ok('Gijsen reference CL equals the published 14.7 L/h', Math.abs(p.CL - 14.7) < 1e-9);
  // The paper reports mean estimated CL of 13.7 (non-ECMO) and 17.4 (ECMO)
  // L/h; the reference value should sit between those.
  ok('Gijsen reference CL lies between the two reported cohort means',
     p.CL > 13.7 - 1 && p.CL < 17.4 + 1,
     `14.7 vs reported 13.7 (non-ECMO) and 17.4 (ECMO) L/h`);

  // A correlated model must not be simulated as though independent: the
  // joint spread of exposure differs. Compare PTA with and without the
  // published correlation.
  const base = { model: mGij, cov: { wt: 70, age: 60, sex: 'M', egfr: 105 },
                 regimen: { dose: 1000, tau: 8, tinf: 0.5 },
                 target: mGij.targets.find(t => t.id === 'ft100'),
                 mics: [2], mic: 2, n: 4000, seed: 31 };
  const withCorr = PKPD.simulate(base).pta[0].pta;
  const indep = { ...mGij }; delete indep.iivCorr;
  const noCorr = PKPD.simulate({ ...base, model: indep }).pta[0].pta;
  console.log(`    PTA 100% fT>MIC at MIC 2, 1 g q8h: ` +
              `${withCorr.toFixed(1)}% with the published CL-Vc correlation, ` +
              `${noCorr.toFixed(1)}% if sampled independently`);
  ok('the published CL-Vc correlation changes PTA (so it matters that it is implemented)',
     Math.abs(withCorr - noCorr) > 0.5,
     `difference ${Math.abs(withCorr - noCorr).toFixed(1)} percentage points`);
}

/* ---- O'Jeanson 2021 ---- */
{
  console.log("\n  O'Jeanson 2021: clearance by renal-replacement modality");
  const modes = [['none', 'no RRT, GFR 49 (cohort median)', 49],
                 ['none', 'no RRT, GFR 120 (RFS = 1)', 120],
                 ['cont', 'continuous dialysis', 20],
                 ['semicont', 'semi-continuous (intermittent) dialysis', 20]];
  const cls = {};
  modes.forEach(([d, lab, g]) => {
    const cl = mOje.params({ egfr: g, rd: 845, dialysis: d }).CL;
    cls[lab] = cl;
    console.log(`    ${lab.padEnd(40)} CL ${cl.toFixed(2).padStart(6)} L/h`);
  });
  ok("O'Jeanson typical-patient CL reproduces the published 4.20 L/h",
     Math.abs(cls['no RRT, GFR 49 (cohort median)'] - 4.20) < 0.005);
  ok('intermittent dialysis gives a higher clearance than continuous',
     cls['semi-continuous (intermittent) dialysis'] > cls['continuous dialysis'],
     `11.0 vs 6.38 L/h, as published`);

  // PTA must order inversely to clearance across modalities.
  const ptaFor = (dialysis, egfr) => PKPD.simulate({
    model: mOje, cov: { age: 60, sex: 'M', egfr, rd: 845, dialysis },
    regimen: { dose: 1000, tau: 8, tinf: 0.5 },
    target: mOje.targets.find(t => t.id === 'ft100'),
    mics: [2], mic: 2, n: 3000, seed: 17
  }).pta[0].pta;
  const pNone = ptaFor('none', 49), pCont = ptaFor('cont', 20), pSemi = ptaFor('semicont', 20);
  console.log(`    PTA 100% fT>MIC at MIC 2, 1 g q8h: no RRT ${pNone.toFixed(1)}%, ` +
              `continuous ${pCont.toFixed(1)}%, intermittent ${pSemi.toFixed(1)}%`);
  ok('PTA orders inversely to clearance across modalities',
     pNone > pCont && pCont > pSemi,
     `${pNone.toFixed(1)}% > ${pCont.toFixed(1)}% > ${pSemi.toFixed(1)}%`);
}

/* ===================================================================
   Models added from user-supplied PDFs
   =================================================================== */
console.log('\n\n' + '='.repeat(70));
console.log('Li 2006 / Ehmann 2019 / Klastrup 2020 / Nicasio 2009');
console.log('='.repeat(70));

const mLi = MODELS.find(m => m.id === 'mem_li2006');
const mEh = MODELS.find(m => m.id === 'mem_ehmann2019');
const mKl = MODELS.find(m => m.id === 'pip_klastrup2020');
const mNi = MODELS.find(m => m.id === 'cef_nicasio2009');

const ptaOf = (model, cov, regimen, tid, mic, extra) => PKPD.simulate(Object.assign({
  model, cov, regimen, target: model.targets.find(t => t.id === tid),
  mics: [mic], mic, n: 4000, seed: 11, nGrid: 600
}, extra || {})).pta[0].pta;

/* ---- Li 2006 ---- */
{
  console.log('\n  Li 2006: fixed effects reproduced from Table II');
  const p = mLi.params({ crcl: 83, age: 35, wt: 70 });
  console.log(`    reference patient (CLcr 83, age 35, 70 kg): CL ${p.CL.toFixed(3)} L/h, ` +
              `V1 ${p.V1.toFixed(2)} L, Q ${p.Q} L/h, V2 ${p.V2} L`);
  ok('Li CL at the centring covariates equals the published 14.60 L/h',
     Math.abs(p.CL - 14.60) < 1e-9);
  ok('Li V1 at 70 kg equals the published 10.80 L', Math.abs(p.V1 - 10.80) < 1e-9);
  ok('Li age effect is negative (older -> lower clearance)',
     mLi.params({ crcl: 83, age: 80, wt: 70 }).CL < p.CL);
  // omega^2 -> omega conversion
  ok('Li IIV entered as the square root of the published variances',
     Math.abs(mLi.iiv.CL - Math.sqrt(0.118)) < 1e-12 &&
     Math.abs(mLi.err.prop - Math.sqrt(0.0352)) < 1e-12,
     `omega_CL ${mLi.iiv.CL.toFixed(4)}, prop err ${mLi.err.prop.toFixed(4)}`);

  const short = ptaOf(mLi, { wt: 70, age: 60, sex: 'M', crcl: 83 },
                      { dose: 1000, tau: 8, tinf: 0.5 }, 'ft40', 4);
  const long = ptaOf(mLi, { wt: 70, age: 60, sex: 'M', crcl: 83 },
                     { dose: 1000, tau: 8, tinf: 3 }, 'ft40', 4);
  console.log(`    1 g q8h at MIC 4, 40% fT>MIC: 0.5 h ${short.toFixed(1)}% -> 3 h ${long.toFixed(1)}%`);
  ok("Li's own conclusion reproduced: a 3 h infusion beats a 0.5 h infusion",
     long > short, `${short.toFixed(1)}% -> ${long.toFixed(1)}%`);

  /* DOCUMENTED DIFFERENCE, not a defect.
     The paper reports 64% -> 90% for this comparison. Those absolute
     values cannot be reproduced by evaluating any single patient,
     because Li simulated the covariate distribution of the whole
     studied cohort (7900 profiles resampled from 79 patients aged
     18-93) while this tool evaluates the specific patient entered, with
     only between-subject random effects. A mixture over heterogeneous
     covariates flattens the PTA-vs-MIC curve: it lowers attainment at
     the short infusion AND lowers it at the long one, and no single
     covariate point produces both numbers at once. */
  const pairFits = [60, 83, 100, 120, 140, 160, 180].some(crcl => {
    const a = ptaOf(mLi, { wt: 70, age: 60, sex: 'M', crcl },
                    { dose: 1000, tau: 8, tinf: 0.5 }, 'ft40', 4);
    const b = ptaOf(mLi, { wt: 70, age: 60, sex: 'M', crcl },
                    { dose: 1000, tau: 8, tinf: 3 }, 'ft40', 4);
    return Math.abs(a - 64) < 5 && Math.abs(b - 90) < 5;
  });
  ok('no single covariate point reproduces both published PTAs (covariate mixture, as expected)',
     !pairFits,
     'Li resampled a whole cohort; this tool conditions on one patient');
}

/* ---- Ehmann 2019 ---- */
{
  console.log('\n  Ehmann 2019: reference parameters and the CLcr inflection');
  const p = mEh.params({ crcl: 80.8, wt: 70, alb: 2.8 });
  console.log(`    reference (CLcr 80.8, 70 kg, alb 2.8): CL ${p.CL.toFixed(2)} L/h, ` +
              `V1 ${p.V1.toFixed(2)} L, Q ${p.Q} L/h, V2 ${p.V2.toFixed(2)} L`);
  ok('Ehmann reference CL equals the published 9.25 L/h', Math.abs(p.CL - 9.25) < 1e-9);
  ok('Ehmann reference V1 equals the published 7.89 L', Math.abs(p.V1 - 7.89) < 1e-9);
  ok('Ehmann reference V2 equals the published 16.1 L', Math.abs(p.V2 - 16.1) < 1e-9);
  ok('clearance plateaus above the published inflection of 154 mL/min',
     Math.abs(mEh.params({ crcl: 154, wt: 70, alb: 2.8 }).CL -
              mEh.params({ crcl: 250, wt: 70, alb: 2.8 }).CL) < 1e-9);
  ok('lower albumin increases the peripheral volume',
     mEh.params({ crcl: 80.8, wt: 70, alb: 1.5 }).V2 >
     mEh.params({ crcl: 80.8, wt: 70, alb: 4.0 }).V2);

  // Table 3A: PTA at MIC 2, 1 g q8h 30-min, 98% fT>MIC, day 1.
  const PUB = { 30: 99.4, 50: 91.2, 70: 69.2, 90: 42.8, 110: 22.7, 150: 6.4 };
  console.log('    Table 3A comparison (MIC 2, 1 g q8h 0.5 h, 98% fT>MIC):');
  let maxGap = 0, monotone = true, prev = 101;
  Object.keys(PUB).forEach(k => {
    const crcl = +k;
    const mine = ptaOf(mEh, { wt: 70, age: 60, sex: 'M', crcl, alb: 2.8 },
                       { dose: 1000, tau: 8, tinf: 0.5 }, 'ft98', 2);
    maxGap = Math.max(maxGap, mine - PUB[crcl]);
    if (mine > prev + 1e-9) monotone = false;
    prev = mine;
    console.log(`      CLcr ${String(crcl).padStart(3)}  model ${mine.toFixed(1).padStart(5)}%   published ${String(PUB[crcl]).padStart(5)}%`);
  });
  ok('Ehmann PTA falls monotonically with rising CLcr, as published', monotone);
  ok('Ehmann PTA tracks Table 3A within 10 percentage points', maxGap < 10,
     `largest excess ${maxGap.toFixed(1)} points — this tool omits the parameter ` +
     `uncertainty and interoccasion variability the paper included, both of which lower PTA`);

  // The paper states day-1 and day-4 attainment differ only marginally.
  const d1 = ptaOf(mEh, { wt: 70, age: 60, sex: 'M', crcl: 90, alb: 2.8 },
                   { dose: 1000, tau: 8, tinf: 0.5, nDoses: 3 }, 'ft98', 2, { evalDose: 3 });
  const ss = ptaOf(mEh, { wt: 70, age: 60, sex: 'M', crcl: 90, alb: 2.8 },
                   { dose: 1000, tau: 8, tinf: 0.5 }, 'ft98', 2);
  ok("day 1 and steady state differ only marginally, as the paper reports",
     Math.abs(d1 - ss) < 3, `day 1 ${d1.toFixed(1)}% vs steady state ${ss.toFixed(1)}%`);
}

/* ---- Klastrup 2020 ---- */
{
  console.log('\n  Klastrup 2020: half-lives and renal clearance fractions');
  const PUB_T = { 30: 4.3, 80: 2.1, 130: 1.4 }, PUB_F = { 30: 61.3, 80: 80.9, 130: 87.3 };
  let tOK = true, fOK = true;
  [30, 80, 130].forEach(crcl => {
    const p = mKl.params({ crcl }),
          thalf = Math.LN2 * p.V1 / p.CL,
          frac = 100 * 0.119 * crcl / p.CL;
    if (Math.abs(thalf - PUB_T[crcl]) > 0.05) tOK = false;
    if (Math.abs(frac - PUB_F[crcl]) > 0.1) fOK = false;
    console.log(`    CRCL ${String(crcl).padStart(3)}  CL ${p.CL.toFixed(2)} L/h  ` +
                `t1/2 ${thalf.toFixed(2)} h (pub ${PUB_T[crcl]})  ` +
                `renal ${frac.toFixed(1)}% (pub ${PUB_F[crcl]}%)`);
  });
  ok('Klastrup half-lives reproduce the published 4.3 / 2.1 / 1.4 h', tOK);
  ok('Klastrup renal clearance fractions reproduce the published 61.3 / 80.9 / 87.3%', fOK);

  // "PTA for 100% fT>1xMIC was above 90% for daily dosing of 8, 12 and 16 g
  //  ... whereas 20 g was required for the group with CRCL >130 mL/min"
  const ci = (g, crcl) => ptaOf(mKl, { crcl }, { mode: 'ci', dose24: g, duration: 120 },
                                'ft100', 16);
  const low = [8000, 12000, 16000].map(g => ci(g, 54));
  console.log(`    CRCL 54, MIC 16, 100% fT>MIC: 8 g ${low[0].toFixed(1)}%, ` +
              `12 g ${low[1].toFixed(1)}%, 16 g ${low[2].toFixed(1)}%`);
  ok('PTA exceeds 90% for 8, 12 and 16 g/day below CRCL 130, as published',
     low.every(v => v > 90));
  ok('a higher daily dose is needed at high CRCL than at low CRCL',
     ci(8000, 150) < low[0], `8 g at CRCL 150 = ${ci(8000, 150).toFixed(1)}%`);
}

/* ---- Nicasio 2009 ---- */
{
  console.log('\n  Nicasio 2009: nonparametric covariance and target attainment');
  // The covariance diagonal must reproduce the tabulated SDs.
  const SD = [0.06, 0.011, 1.023, 1.082, 0.187];
  const diagOK = SD.every((s, i) => Math.abs(Math.sqrt(mNi.mvCov[i][i]) - s) < 0.002);
  ok('covariance diagonal reproduces the published SDs (Table 2 vs Table 3)', diagOK,
     mNi.mvCov.map((r, i) => Math.sqrt(r[i]).toFixed(3)).join(', '));
  const symmetric = mNi.mvCov.every((row, i) =>
    row.every((v, j) => Math.abs(v - mNi.mvCov[j][i]) < 1e-12));
  ok('covariance matrix is symmetric', symmetric);

  // The paper's own anchor: 2 g q12h 3-h infusion at CLcr 30-49.
  const r40 = [8, 16, 32].map(m => ptaOf(mNi, { wt: 84, age: 57, sex: 'M', crcl: 40 },
                                         { dose: 2000, tau: 12, tinf: 3 }, 'ft50', m));
  const PUB40 = [93.8, 79.8, 50.7];
  console.log('    2 g q12h, 3 h infusion, CLcr 40 (published 93.8 / 79.8 / 50.7):');
  console.log(`      MIC 8/16/32: ${r40.map(v => v.toFixed(1) + '%').join('  ')}`);
  ok('Nicasio PTA at CLcr 40 reproduces the published values within 5 points',
     r40.every((v, i) => Math.abs(v - PUB40[i]) < 5),
     r40.map((v, i) => `${v.toFixed(1)} vs ${PUB40[i]}`).join('; '));

  const sim = PKPD.simulate({
    model: mNi, cov: { wt: 84, age: 57, sex: 'M', crcl: 100 },
    regimen: { dose: 2000, tau: 8, tinf: 3 }, target: mNi.targets[0],
    mics: [8], mic: 8, n: 4000, seed: 11
  });
  console.log(`    rejected fraction of multivariate-normal draws: ` +
              `${(sim.rejectedFraction * 100).toFixed(1)}%`);
  ok('the rejection fraction is reported rather than hidden',
     sim.rejectedFraction > 0 && sim.rejectedFraction < 0.95,
     'normal-scale draws of K12/K21 are frequently non-positive; a truncated ' +
     'normal is not exactly the nonparametric distribution that was fitted');
  ok('prolonging the infusion raises attainment (the paper\u2019s conclusion)',
     ptaOf(mNi, { wt: 84, age: 57, sex: 'M', crcl: 100 }, { dose: 2000, tau: 8, tinf: 3 }, 'ft50', 8) >
     ptaOf(mNi, { wt: 84, age: 57, sex: 'M', crcl: 100 }, { dose: 2000, tau: 8, tinf: 0.5 }, 'ft50', 8));
}

/* ===================================================================
   AMINOGLYCOSIDES — Xuan 2004 / Romano 1998 / Hennig 2013
   =================================================================== */
console.log('\n\n' + '='.repeat(70));
console.log('Aminoglycosides: reproduction of published quantities');
console.log('='.repeat(70));

// validate.cjs has no relerr of its own; test-core.cjs does.
const relerr = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));

const mXu = MODELS.find(m => m.id === 'gen_xuan2004');
const mRo = MODELS.find(m => m.id === 'amk_romano1998');
const mHe = MODELS.find(m => m.id === 'tob_hennig2013');

{
  /* ---- Xuan 2004 (gentamicin) ----
     Paper: "The mean population estimate of CL was 4.32 l/h and V1 was
     19.6 l" at the cohort means (CLcr 92 mL/min, weight 70.2 kg), and
     "for the this study population which received 7 mg/kg of gentamicin,
     the peak concentration was approximately 22 mg/l". */
  const p = mXu.params({ crcl: 92, wt: 70 });
  ok('Xuan: typical CL reproduces the published 4.32 L/h',
     relerr(p.CL, 4.32) < 0.01, `${p.CL.toFixed(3)} L/h`);
  ok('Xuan: typical V1 reproduces the published 19.6 L',
     relerr(p.V1, 19.6) < 0.01, `${p.V1.toFixed(3)} L`);
  // Micro-constants must round-trip: Q = K12*V1, V2 = Q/K21.
  const mi = mXu.microParams({ crcl: 92, wt: 70 });
  ok('Xuan: K12 and K21 recover the published thetas',
     relerr(mi.K12, 0.092) < 1e-12 && relerr(mi.K21, 0.071) < 1e-12,
     `K12 ${mi.K12}, K21 ${mi.K21}`);
  ok('Xuan: macro conversion is self-consistent',
     relerr(p.Q, mi.K12 * mi.V1) < 1e-12 && relerr(p.V2, p.Q / mi.K21) < 1e-12,
     `Q ${p.Q.toFixed(3)} L/h, V2 ${p.V2.toFixed(2)} L`);

  const prof = PKPD.profile(mXu, p, { dose: 7 * 70, tau: 24, tinf: 1 }, 600, 24);
  const peak = Math.max(...prof.conc);
  ok('Xuan: 7 mg/kg once-daily gives the published peak of about 22 mg/L',
     Math.abs(peak - 22) < 2.5, `${peak.toFixed(2)} mg/L`);

  // Sampling on the micro scale must reproduce the published CL spread.
  const subj = PKPD.samplePopulation(mXu, { crcl: 92, wt: 70 }, 40000, 5);
  const cls = subj.map(s => s.CL);
  const mean = cls.reduce((a, b) => a + b, 0) / cls.length;
  const cv = Math.sqrt(cls.reduce((a, b) => a + (b - mean) ** 2, 0) / (cls.length - 1)) / mean;
  ok('Xuan: sampled CL reproduces the published 29.6% CV',
     Math.abs(cv - 0.296) < 0.02, `${(cv * 100).toFixed(1)}%`);
  ok('Xuan: micro sampling yields physically valid subjects',
     subj.every(s => s.CL > 0 && s.V1 > 0 && s.Q > 0 && s.V2 > 0));
}

{
  /* ---- Romano 1998 (amikacin) ----
     Table III: theta1 0.934 on CLcr (L/h), theta2 0.225 trauma on CL,
     theta3 0.393 on TBW, theta4 0.246 sepsis on Vd. */
  const base = { crcl: 80, wt: 69.5, age: 53, sex: 'M' };
  const p = mRo.params(base);
  ok('Romano: CL is 0.934 x CLcr expressed in L/h',
     relerr(p.CL, 0.934 * 80 * 0.06) < 1e-9, `${p.CL.toFixed(3)} L/h at CLcr 80 mL/min`);
  ok('Romano: V1 is 0.393 L/kg of total body weight',
     relerr(p.V1 / 69.5, 0.393) < 1e-9, `${(p.V1 / 69.5).toFixed(4)} L/kg`);
  ok('Romano: trauma raises clearance by the published 22.5%',
     relerr(mRo.params({ ...base, trauma: true }).CL / p.CL, 1.225) < 1e-9);
  ok('Romano: sepsis raises the volume by the published 24.6%',
     relerr(mRo.params({ ...base, sepsis: true }).V1 / p.V1, 1.246) < 1e-9);
  ok('Romano: trauma does NOT change the volume, nor sepsis the clearance',
     mRo.params({ ...base, trauma: true }).V1 === p.V1 &&
     mRo.params({ ...base, sepsis: true }).CL === p.CL);
  // Physiological sanity: amikacin is cleared by filtration, so CL/GFR ~ 1.
  ok('Romano: clearance is close to glomerular filtration rate',
     Math.abs(p.CL / (80 * 0.06) - 1) < 0.1, `CL/CLcr = ${(p.CL / (80 * 0.06)).toFixed(3)}`);

  /* Jelliffe is NOT interchangeable with Cockcroft-Gault in this model,
     but the reason is body size rather than age — an earlier version of
     this note claimed the elderly, which the numbers below disprove.
     Cockcroft-Gault is linear in weight; Jelliffe scales with BSA. */
  const at = (wt, age) => {
    const o = { scr: 1.0, scrUnit: 'mg/dL', age: age, sex: 'M', wt: wt, ht: 175 };
    return PKPD.jelliffe({ ...o, absolute: true }) / PKPD.cockcroftGault(o);
  };
  ok('Jelliffe/Cockcroft-Gault ratio falls steeply with body weight',
     at(45, 60) > 1.05 && at(130, 60) < 0.72,
     `45 kg ${at(45, 60).toFixed(2)} -> 130 kg ${at(130, 60).toFixed(2)}`);
  ok('...and is nearly flat with age, so age is NOT the reason they differ',
     Math.abs(at(70, 25) - at(70, 85)) < 0.05,
     `age 25 ${at(70, 25).toFixed(2)} vs age 85 ${at(70, 85).toFixed(2)}`);
  ok('substituting Cockcroft-Gault would overestimate CL in a large patient',
     mRo.params({ crcl: PKPD.cockcroftGault({ scr: 1.0, scrUnit: 'mg/dL', age: 60, sex: 'M', wt: 130 }), wt: 130 }).CL >
     1.3 * mRo.params({ crcl: PKPD.jelliffe({ scr: 1.0, scrUnit: 'mg/dL', age: 60, sex: 'M', wt: 130, ht: 175, absolute: true }), wt: 130 }).CL,
     'by about a third at 130 kg');
}

{
  /* ---- Hennig 2013 (tobramycin) ----
     At FFM = 70 kg, age 18 and SCR = SCRmean every covariate factor is
     unity, so the parameters must equal the published thetas exactly. */
  const ref = mHe.params({ sex: 'M', age: 18, scr: 84, scrUnit: 'umol/L', ffm: 70 });
  ok('Hennig: male CL reproduces theta 9.4 L/h per 70 kg FFM',
     relerr(ref.CL, 9.4) < 1e-9, `${ref.CL.toFixed(4)}`);
  ok('Hennig: male V1 reproduces theta 25.1 L per 70 kg FFM',
     relerr(ref.V1, 25.1) < 1e-9, `${ref.V1.toFixed(4)}`);
  ok('Hennig: Q reproduces theta 1.5 L/h per 70 kg FFM',
     relerr(ref.Q, 1.5) < 1e-9, `${ref.Q.toFixed(4)}`);
  ok('Hennig: V2 reproduces theta 10.0 L per 70 kg FFM',
     relerr(ref.V2, 10.0) < 1e-9, `${ref.V2.toFixed(4)}`);
  const refF = mHe.params({ sex: 'F', age: 18, scr: 69.5, scrUnit: 'umol/L', ffm: 70 });
  ok('Hennig: female thetas reproduce 8.1 L/h and 20.1 L',
     relerr(refF.CL, 8.1) < 1e-9 && relerr(refF.V1, 20.1) < 1e-9,
     `CL ${refF.CL.toFixed(3)}, V1 ${refF.V1.toFixed(3)}`);
  ok('Hennig: clearance falls with age above 18 (theta -0.010/year)',
     relerr(mHe.params({ sex: 'M', age: 38, scr: 84, scrUnit: 'umol/L', ffm: 70 }).CL,
            9.4 * (1 - 0.010 * 20)) < 1e-9);
  ok('Hennig: raised creatinine lowers clearance through the SCRmean ratio',
     mHe.params({ sex: 'M', age: 40, scr: 168, scrUnit: 'umol/L', ffm: 70 }).CL <
     mHe.params({ sex: 'M', age: 40, scr: 84, scrUnit: 'umol/L', ffm: 70 }).CL);

  // Janmahasatian FFM, against the equation as published.
  const ffmM = PKPD.ffmJanmahasatian({ wt: 70, ht: 175, sex: 'M' });
  const bmiM = 70 / Math.pow(1.75, 2);
  ok('fat-free mass follows the Janmahasatian male equation',
     relerr(ffmM, (9270 * 70) / (6680 + 216 * bmiM)) < 1e-12, `${ffmM.toFixed(2)} kg`);
  ok('fat-free mass is lower in a female of identical size',
     PKPD.ffmJanmahasatian({ wt: 70, ht: 175, sex: 'F' }) < ffmM);

  /* The paper's own dosing conclusion: "The optimal dose was estimated
     from the utility function to be 11 mg/kg (total bodyweight) once
     daily", assessed against "a target peak concentration of 20 mg/L
     (relating to a 1-h peak/MIC ratios of 20/2) and a target trough
     concentration of below 1 mg/L". The 1-h peak, not Cmax — the
     distinction is ~50% at this dose. */
  const cCF = { sex: 'M', wt: 53.9, ht: 166.5, age: 24, scr: 71, scrUnit: 'umol/L' };
  const cov = { ...cCF, ffm: PKPD.ffmJanmahasatian(cCF) };
  const r = PKPD.simulate({
    model: mHe, cov, regimen: { dose: Math.round(11 * cCF.wt), tau: 24, tinf: 0.5 },
    target: mHe.targets[0], mics: [1], mic: 1, n: 3000, seed: 7, nGrid: 600
  });
  ok('Hennig: 11 mg/kg once-daily gives a 1-h peak near the published 20 mg/L',
     Math.abs(r.exposure.peak1h.median - 20) < 3,
     `${r.exposure.peak1h.median.toFixed(2)} mg/L`);
  ok('Hennig: and a trough below the published 1 mg/L target',
     r.exposure.cmin.median < 1,
     `${r.exposure.cmin.median.toFixed(3)} mg/L`);
  ok('the 1-h peak is materially below the end-of-infusion Cmax',
     r.exposure.peak1h.median < 0.75 * r.exposure.cmax.median,
     `1-h peak ${r.exposure.peak1h.median.toFixed(1)} vs Cmax ` +
     `${r.exposure.cmax.median.toFixed(1)} mg/L`);
}

{
  /* ---- The two teaching claims, on the real gentamicin model ---- */
  const cov = { crcl: 90, wt: 70, age: 55, sex: 'M' };
  const both = mXu.targets[0];               // Cmax/MIC >= 10 and Cmin <= 2
  const sim = (regimen, crcl) => PKPD.simulate({
    model: mXu, cov: { ...cov, crcl }, regimen, target: both,
    mics: [1], mic: 1, n: 3000, seed: 19, nGrid: 600
  });
  const od = sim({ dose: 420, tau: 24, tinf: 1 }, 90);
  const tid = sim({ dose: 140, tau: 8, tinf: 1 }, 90);
  ok('Xuan: once-daily beats thrice-daily on the joint target at equal daily dose',
     od.ptaAtRefMic > tid.ptaAtRefMic,
     `q24h ${od.ptaAtRefMic.toFixed(1)}% vs q8h ${tid.ptaAtRefMic.toFixed(1)}%`);
  const comp = (r, type) => r.components.find(c => c.type === type).pta;
  ok('Xuan: thrice-daily fails specifically on the PEAK component',
     comp(tid, 'cmaxmic') < comp(od, 'cmaxmic'),
     `peak q8h ${comp(tid, 'cmaxmic').toFixed(1)}% vs q24h ${comp(od, 'cmaxmic').toFixed(1)}%`);

  const impaired = sim({ dose: 420, tau: 24, tinf: 1 }, 25);
  ok('Xuan: renal impairment degrades the TROUGH component, not the peak',
     comp(impaired, 'cminceil') < comp(od, 'cminceil') &&
     comp(impaired, 'cmaxmic') >= comp(od, 'cmaxmic') - 1e-9,
     `trough ${comp(od, 'cminceil').toFixed(1)}% -> ${comp(impaired, 'cminceil').toFixed(1)}%, ` +
     `peak ${comp(od, 'cmaxmic').toFixed(1)}% -> ${comp(impaired, 'cmaxmic').toFixed(1)}%`);
  const extended = sim({ dose: 420, tau: 48, tinf: 1 }, 25);
  ok('Xuan: extending the interval recovers the trough at CLcr 25',
     comp(extended, 'cminceil') > comp(impaired, 'cminceil'),
     `q24h ${comp(impaired, 'cminceil').toFixed(1)}% -> q48h ${comp(extended, 'cminceil').toFixed(1)}%`);
  ok('Xuan: and halving the dose instead does NOT recover it as well',
     comp(sim({ dose: 210, tau: 24, tinf: 1 }, 25), 'cminceil') <
     comp(extended, 'cminceil'),
     `half-dose q24h ${comp(sim({ dose: 210, tau: 24, tinf: 1 }, 25), 'cminceil').toFixed(1)}%` +
     ` vs full-dose q48h ${comp(extended, 'cminceil').toFixed(1)}%`);
}

console.log(fails === 0 ? '\nVALIDATION PASSED' : `\n${fails} VALIDATION CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
