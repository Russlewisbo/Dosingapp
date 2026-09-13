# MIPD Lab — population PK/PD target attainment, with a slide-embeddable widget

A browser-based tool for Monte Carlo probability-of-target-attainment (PTA)
simulation and MAP Bayesian dose individualisation, built in the shape of
[TDMx](https://www.tdmx.eu/): a patient record plus a library of published
population PK models, with both *a priori* population predictions and
*a posteriori* individual predictions from TDM samples.

It is built as **one self-contained HTML file with no dependencies and no
network access**, because the requirement that drove the architecture was
embedding a live widget in Quarto / reveal.js slides. Slides have no
backend, so the whole engine — PK solutions, Monte Carlo, and the Bayesian
optimiser — runs client-side in JavaScript.

---

## Files

| File | What it is |
|---|---|
| `mipd-lab.html` | **The deliverable.** Self-contained app + widget. Open in any browser, or `iframe` into slides. |
| `pkpd-core.js` | PK/PD engine: analytic 1- and 2-compartment solutions, Monte Carlo, exposure metrics, Nelder-Mead MAP estimation. |
| `models.js` | Population PK model library (data, not code) + PD targets. |
| `app.js` | UI, canvas plotting, URL-parameter wiring. |
| `shell.html` | HTML/CSS shell with inlining markers. |
| `build.py` | Inlines the three JS files into `shell.html` → `mipd-lab.html`. |
| `slides-demo.qmd` | Quarto reveal.js deck demonstrating both embedding styles. |
| `test-core.cjs` | Engine unit tests (22 checks). |
| `test-app.cjs` | Headless DOM tests of the built file (36 checks). |
| `test-layout.cjs` | Canvas geometry audit — clipping, overlap, NaN coordinates. |
| `validate.cjs` | Reproduces a published paper's dosing conclusion from the coded model. |

Rebuild after editing any JS: `python build.py`.
Run everything: `node test-core.cjs && node test-app.cjs && node validate.cjs && node test-layout.cjs`
(requires `npm install jsdom`).

---

## Implemented models

Every parameter was read off the parameter table of the primary publication.
A model is included **only** if its fixed effects, covariate equations *and*
between-subject variability were all recoverable, because a model without
variance terms cannot support Monte Carlo PTA or Bayesian forecasting.

| Drug | Model | Structure | Covariates | Notes |
|---|---|---|---|---|
| Piperacillin | **Kim 2022** ([10.1093/jac/dkac059](https://doi.org/10.1093/jac/dkac059)) | 2-cmt, total plasma, *f*u 0.91 | eGFR (CKD-EPI **cystatin C**), ECMO on V<sub>c</sub>, allometric to 70 kg | Best-performing of 24 models for the pooled dataset in the 2023 multicentre external evaluation |
| Piperacillin | **Udy 2015** ([10.1186/s13054-015-0750-y](https://doi.org/10.1186/s13054-015-0750-y)) | 2-cmt, **unbound** plasma | CLcr (Cockcroft-Gault) | Best for intermittent infusion in the same evaluation. Bayesian forecasting disabled — see below |
| Vancomycin | **Thomson 2009** ([10.1093/jac/dkp085](https://doi.org/10.1093/jac/dkp085)) | 2-cmt, total plasma | CLcr (Cockcroft-Gault, TBW), weight on V<sub>1</sub>/V<sub>2</sub> | AUC<sub>0-24</sub> 400–600 mg·h/L and trough targets |
| Meropenem | **Gijsen 2021** ([10.3390/microorganisms9061310](https://doi.org/10.3390/microorganisms9061310)) | 2-cmt, **unbound** plasma | eGFR (CKD-EPI creatinine)<sup>1.29</sup>, allometric weight | ICU ± ECMO. Carries a published CL–V<sub>c</sub> IIV **correlation** (0.704), sampled jointly |
| Meropenem | **Shekar 2014** ([10.1186/s13054-014-0565-2](https://doi.org/10.1186/s13054-014-0565-2)) | 2-cmt, total plasma | CLcr (Cockcroft-Gault) **or** RRT status | RRT decouples clearance from CLcr. **Source has an internal inconsistency — see below** |
| Meropenem | **O'Jeanson 2021** ([10.1007/s13318-021-00709-w](https://doi.org/10.1007/s13318-021-00709-w)) | 1-cmt, total plasma | GFR (**MDRD**), dialysis modality, residual diuresis | Spans no RRT, continuous and semi-continuous (intermittent) dialysis |

Meropenem targets are 40% / 50% / 100% fT>MIC and 100% fT>4×MIC. Neither
ECMO model carries an ECMO term: both Gijsen and Shekar tested ECMO as a
covariate and found it non-significant, which is each paper's central
finding — so adding one would contradict the source.

### Deliberate omissions, stated in the app

- **Cefepime — Nicasio 2009.** The structural model is recoverable
  (K<sub>10</sub> = 0.0027·CLcr + 0.071 h⁻¹, V<sub>1</sub> = 0.21 L/kg·TBW,
  K<sub>12</sub> 0.780, K<sub>21</sub> 0.472 h⁻¹) but it is a nonparametric
  model and the support points / parameter dispersion needed to simulate a
  population were not in the retrievable record.
- **Piperacillin — Klastrup 2020**, best for continuous infusion in the 2023
  evaluation: only the abstract was retrievable, so no parameter table.
- **Udy 2015 Bayesian forecasting.** The paper's residual-error row reports
  `RUV (%CV) 1.0` next to `RUV (SD) 0.3 mg/L`. The scale of the proportional
  term is ambiguous, and a wrong residual variance silently distorts how
  strongly TDM samples outweigh the prior. Monte Carlo PTA is unaffected —
  it needs only the fixed effects and BSV, which is how the paper itself
  used the model — so PTA is enabled and MAP is not.

- **Meropenem — Li 2006** ([10.1177/0091270006291035](https://doi.org/10.1177/0091270006291035)):
  closed access, no repository copy retrievable. The abstract establishes a
  2-compartment model in 79 patients with creatinine clearance, age and
  weight as covariates, but no estimates.
- **Meropenem — Ehmann 2019** ([10.1016/j.ijantimicag.2019.06.016](https://doi.org/10.1016/j.ijantimicag.2019.06.016)):
  closed access, no repository copy. The abstract gives the covariate
  structure (Cockcroft-Gault CLcr on clearance, weight on central and
  albumin on peripheral volume) but no estimates. The open-access companion
  paper from the same cohort ([10.1186/s13054-017-1829-4](https://doi.org/10.1186/s13054-017-1829-4))
  is a target non-attainment risk analysis and contains no popPK parameter
  table; the dosing-nomogram paper from the same group
  ([10.1093/jac/dkx526](https://doi.org/10.1093/jac/dkx526)) is also
  paywalled.

**Both are one PDF away.** Drop either paper in and the model can be added
— the schema below is all that is needed.

### A caveat that is not mine: Shekar 2014 is internally inconsistent

Worth knowing before you teach from it. The paper's Table 3 tabulates
simulated trough concentrations by CLcr, and its CLcr-banded dosing advice
(500 mg q8h at CLcr 20–50, 1 g at 80–180, 2 g above 180) is drawn from
that table. Inverting Table 3 — solving for the clearance that reproduces
each published trough, holding the published V<sub>c</sub>/V<sub>p</sub>/Q
fixed — gives clearances of only **2.4 to 5.5 L/h** across CLcr 20–180.
That contradicts the same paper's *measured* clearances of 7.9 ± 5.9 (ECMO)
and 11.7 ± 6.5 L/h (controls), and it cannot be produced by the paper's own
Table 2 equation under any unit reading. Its 1 g column is additionally not
dose-proportional to its 500 mg and 2 g columns, which are proportional to
each other.

What is implemented here is the published **equation**, because that is what
reproduces the measured clearances: CL = 1.89 × CLcr in L/h gives 11.3 L/h
at CLcr 100 and 7.9 L/h at CLcr 70, matching the two reported cohort means
almost exactly. The consequence is that **this model does not reproduce that
paper's dosing table** — it predicts markedly lower attainment at high CLcr.
`validate.cjs` asserts the inconsistency rather than the agreement, so the
discrepancy is regression-tested instead of being quietly tuned away.

**`Q` in the Thomson model** is tabulated as `2.28` with a unit label of
h⁻¹ while the table key defines Q as intercompartmental *clearance*. It is
implemented as 2.28 L/h, consistent with the key and with the CL/V
parameterisation. Change it in `models.js` if you read the table the other
way.

---

## Adding a model

Models are data. Append to `MODELS` in `models.js` and rebuild:

```js
{
  id: 'mem_someone2021',
  drug: 'Meropenem',
  label: 'Someone 2021 — 2-cmt, ICU',
  source: 'Someone A, et al. Journal 2021;1:1-10, Table 2.',
  doi: '10.xxxx/yyyy',
  ncmt: 2,                    // 1 or 2
  matrix: 'total plasma',     // or 'unbound plasma'
  fu: 0.98,                   // free fraction for PD targets; 1.0 if already unbound
  renal: 'cg',                // which renal equation the model was estimated against:
                              // 'cg'     -> Cockcroft-Gault (CLcr, mL/min)
                              // 'ckdepi' -> CKD-EPI creatinine (2021, race-free)
                              // 'cysc'   -> CKD-EPI cystatin C
                              // 'mdrd'   -> MDRD 4-variable (race-free form)
  covariates: ['wt', 'age', 'sex', 'scr'],
  params: function (c) {      // c has wt, age, sex, crcl or egfr, ecmo...
    return { CL: 10 * Math.pow(c.wt / 70, 0.75) * (c.crcl / 100),
             V1: 15, Q: 20, V2: 12 };          // L/h and L
  },
  iiv: { CL: 0.35, V1: 0.25 },  // omega per parameter
  iivScale: 'omega',            // 'omega' = reported % is the log-scale SD
                                // 'cv'    = reported % is a true CV
  iivCorr: [['CL', 'V1', 0.7]], // OPTIONAL off-diagonal OMEGA terms
  err: { add: 0.5, prop: 0.15 },// residual error; needed only for MAP
  bayesian: true,
  targets: [ /* reuse T_FT50 / T_FT100 / T_FT100x4 or define your own */ ],
  defaultRegimen: { dose: 1000, tau: 8, tinf: 0.5 },
  defaultMic: 2
}
```

`iivScale` matters and papers are inconsistent about it. `'omega'` treats a
reported "IIV 35%" as ω = 0.35 (the usual NONMEM exponential-model
convention); `'cv'` converts a true coefficient of variation via
ω = √(ln(1 + CV²)). Check what the paper means before choosing.

Covariate-dependent variability is supported via an optional
`iivFor(cov)` function — the Kim model uses it because V<sub>c</sub> IIV
differs on and off ECMO.

`iivCorr` declares off-diagonal OMEGA terms. Supply them when the paper
reports them: the covariance matrix is built explicitly and factorised by
Cholesky, so the random effects are drawn jointly. This is not cosmetic —
for the Gijsen model, honouring the published CL–V<sub>c</sub> correlation
of 0.704 moves PTA for 100% fT>MIC at MIC 2 from 38.1% (independent
sampling) to **31.3%**. The MAP prior penalty uses the matching full
quadratic form η′Ω⁻¹η, so a correlated pair is not penalised as though it
were two independent deviations.

---

## Embedding in slides

### Quarto / reveal.js

Declare the file as a resource so Quarto copies it next to the rendered
deck:

```yaml
---
format: revealjs
resources:
  - mipd-lab.html
---
```

Inline on part of a slide:

```html
<iframe src="mipd-lab.html?mode=widget&model=pip_kim2022&dose=4000&tau=6&tinf=4&mic=16&target=ft100"
        width="100%" height="440" style="border:0"></iframe>
```

Or as a full-slide interactive background — use this when the class should
drive it:

```markdown
## Extended infusion {background-iframe="mipd-lab.html?mode=widget&..." background-interactive="true"}
```

`background-interactive="true"` is required; without it reveal.js swallows
clicks and keystrokes for slide navigation.

### remark.js / xaringan

The same `<iframe>` HTML works — remark passes raw HTML through. In
xaringan, put the file in the directory served alongside the deck and
reference it relatively. For a full-bleed widget, give the slide
`class: full` and style the iframe to `100%` width and height. There is no
reveal.js-style `background-iframe` in remark, so use a plain iframe sized
to the slide.

*(You wrote "Quarto (remark JS)" — Quarto's HTML slide format is reveal.js,
while remark is what xaringan uses. The widget is a plain iframe, so it
embeds in either; the reveal-specific syntax above is the only part that
differs.)*

### The easy way

Set the view up in the full app, then press **Build widget URL** in the
sidebar. It emits a ready-to-paste `<iframe>` with the current model,
patient, regimens, target, MIC and seed.

---

## URL parameters

| Parameter | Meaning |
|---|---|
| `mode` | `widget` for the compact slide layout; omit for the full app |
| `model` | `pip_kim2022`, `pip_udy2015`, `van_thomson2009`, `mem_gijsen2021`, `mem_shekar2014`, `mem_ojeanson2021` |
| `target` | `ft40`, `ft50`, `ft100`, `ft100x4`, `auc400`, `aucmic400`, `cmin1020` |
| `mic` | reference MIC in mg/L |
| `dose`, `tau`, `tinf` | regimen A: mg, hours, infusion hours |
| `dose2`,`tau2`,`tinf2` / `dose3`,`tau3`,`tinf3` | regimens B and C for comparison |
| `ci`, `dose24` | continuous infusion and its daily dose in mg |
| `wt`, `age`, `sex`, `ht` | covariates (`sex` = `M`/`F`) |
| `scr`, `scrUnit` | serum creatinine; `mg/dL` or `umol/L` |
| `cysc` | cystatin C in mg/L (Kim model) |
| `crcl` / `egfr` | set renal function directly; the underlying creatinine or cystatin C is back-solved |
| `ecmo` | `1` for ECMO (Kim model) |
| `rrt` | `1` for continuous RRT (Shekar model) |
| `dialysis` | `none`, `cont`, `semicont` (O'Jeanson model) |
| `rd` | residual diuresis in mL/24 h (O'Jeanson model; 845 = cohort median) |
| `n`, `seed` | Monte Carlo subjects and RNG seed |
| `pta` | PTA threshold %, default 90 |
| `logy` | `1` for a log concentration axis |
| `panel` | `pta`, `conc`, or both (default) |
| `summary`, `controls` | `0` hides the summary card / control strip |
| `title` | overrides the heading |

Simulations are seeded, so a URL reproduces its figure exactly.

---

## What the app computes

- **Concentration–time profile** over the steady-state dosing interval:
  population median with a 90% prediction interval, the MIC (or 4×MIC)
  reference line, and the MAP individual curve once TDM samples are entered.
- **PTA across a doubling-dilution MIC ladder** (0.25–128 mg/L) with the
  **PK/PD breakpoint** — the highest MIC still meeting the PTA threshold.
- **Exposure summary**: %fT>MIC, AUC<sub>0-24</sub>, C<sub>max</sub>,
  C<sub>min</sub>, each as median with a 90% prediction interval.
- **Cumulative fraction of response**, if you paste your own isolate MIC
  frequencies. No MIC distribution is bundled or assumed — CFR against a
  surveillance distribution you did not choose would be a fabricated result.
- **MAP Bayesian individualisation** from measured concentrations, plus the
  smallest dose (250 mg steps, same interval and infusion duration) that
  meets the selected target *for that individual*.

Exposure conventions: AUC and C<sub>max</sub>/C<sub>min</sub> are total
drug; %fT>MIC uses free drug via the model's *f*u. Vancomycin AUC targets
are total-drug AUC, as the guidelines define them.

---

## Verification

- **Engine** — the analytic two-compartment infusion solution matches RK4
  integration of the ODE system to a maximum relative error of 4×10⁻¹³.
  Steady-state AUC over τ equals Dose/CL, and the continuous-infusion
  plateau equals R₀/CL, both to numerical precision. MAP recovers known
  parameters to <0.03% from informative data, and shrinks toward the prior
  with sparse data.
- **Correlated variability** — the Cholesky sampler recovers a requested
  correlation of 0.70 as 0.697 and the marginal omegas to within 0.002
  over 40 000 draws, and reduces to independent sampling (r = 0.001) when
  no correlation is declared. `mahalanobis2` matches an explicit 2×2
  inverse to 10⁻¹².
- **Model coding** — `validate.cjs` reproduces published quantities from
  independently coded parameters:
  - *Kim 2022*: at eGFR 150 and MIC 16 mg/L, 16 g/day as a 0.5 h infusion
    reaches only 27.9% PTA for 100% fT>MIC while continuous infusion
    reaches 100%; 50% fT>MIC at MIC 8 is attained at normal renal function
    (99.9%); PTA falls monotonically 98.5% → 15.3% across eGFR 30 → 170.
  - *O'Jeanson 2021*: the typical-patient clearance reconstructs to
    **4.20 L/h** (1.36 + 0.058 × 49 at the cohort median GFR), exactly the
    value the paper reports, and PTA orders inversely to clearance across
    modalities (no RRT 97.5% > continuous 91.3% > intermittent 65.4%).
  - *Gijsen 2021*: the reference-patient clearance is 14.7 L/h, between the
    two reported cohort means (13.7 non-ECMO, 17.4 ECMO), and clearance
    scales as eGFR<sup>1.29</sup> to machine precision.
  - *Shekar 2014*: clearance matches both reported cohort means to within
    0.4 L/h — and the Table 3 inconsistency described above is asserted as
    a finding.
- **Layout** — `test-layout.cjs` records the coordinates of every canvas
  operation and checks for clipped text, overlapping tick labels,
  out-of-canvas vertices and NaN geometry, at full, widget and narrow
  (380 px) widths. It found a real bug during development: log-scale
  gridlines were computing `log10` of a tick *object* and silently
  vanishing.
- **Not done:** the app has not been opened in a real browser from this
  environment — the headless Chromium download resolves to a
  network-denylisted host. Behaviour and geometry are verified through a
  DOM implementation with an instrumented canvas, which is not the same as
  looking at it. Worth a one-minute visual check on your machine before
  you teach from it.

---

## Scope

This is a simulation and teaching tool, not a medical device. It has no
validated link to clinical outcome, carries no institutional dosing policy,
and individual dosing decisions need a qualified clinician with the full
patient context. The population models describe the populations they were
built in — an ICU model does not transfer silently to a ward patient, and
the Kim model's clearance covariate is specifically **cystatin C** eGFR,
not a creatinine-based estimate.
