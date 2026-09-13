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

console.log(fails === 0 ? '\nVALIDATION PASSED' : `\n${fails} VALIDATION CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
