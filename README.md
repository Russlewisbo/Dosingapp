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
| Gentamicin | **Xuan 2004** ([10.1016/j.ijantimicag.2003.07.010](https://doi.org/10.1016/j.ijantimicag.2003.07.010)) | 2-cmt as **CL, V<sub>1</sub>, K<sub>12</sub>, K<sub>21</sub>** | CLcr (Cockcroft-Gault, TBW) on CL; 0.28 L/kg on V<sub>1</sub> | 939 adults, built entirely on **once-daily** dosing. Variability is published on the micro-constants and sampled there — see below |
| Amikacin | **Romano 1998** ([10.2165/00044011-199815050-00008](https://doi.org/10.2165/00044011-199815050-00008)) | **1-cmt** | CLcr (**Jelliffe 1973**); **trauma** +22.5% on CL, **sepsis** +24.6% on V | Medical ICU. Bayesian forecasting disabled — see below |
| Tobramycin | **Hennig 2013** ([10.1007/s40262-013-0036-y](https://doi.org/10.1007/s40262-013-0036-y)) | 2-cmt | **fat-free mass** (Janmahasatian), age, SCR<sub>mean</sub>/SCR ratio, sex | 732 patients with and without CF. Carries a published CL–V<sub>1</sub> IIV **correlation** (0.658). **CF is deliberately absent** — see below |

Meropenem targets are 40% / 50% / 100% fT>MIC and 100% fT>4×MIC. Neither
ECMO model carries an ECMO term: both Gijsen and Shekar tested ECMO as a
covariate and found it non-significant, which is each paper's central
finding — so adding one would contradict the source.

### Deliberate omissions, stated in the app

**No model is omitted.** The Li 2006 and Ehmann 2019 meropenem models, the
Klastrup 2020 piperacillin model and the Nicasio 2009 cefepime model were
each listed here as unavailable until their PDFs were supplied; all four
are now implemented from their own parameter tables, and `PENDING` is
empty. The mechanism stays in place — a model that cannot be faithfully
reproduced belongs in `PENDING` rather than being approximated, and the
app renders that list (stating that none remain when it is empty).

Two narrower gaps remain, both surfaced in the app rather than silent:

- **Udy 2015 — Bayesian forecasting only.** The paper's residual-error row
  reports `RUV (%CV) 1.0` next to `RUV (SD) 0.3 mg/L`. The scale of the
  proportional term is ambiguous, and a wrong residual variance silently
  distorts how strongly TDM samples outweigh the prior. Monte Carlo PTA is
  unaffected — it needs only the fixed effects and BSV, which is how the
  paper itself used the model — so PTA is enabled and MAP is not.
- **Nicasio 2009 — Bayesian forecasting only.** Its prior is a full
  covariance matrix on natural-scale micro-constants, not the diagonal
  log-normal Ω the MAP implementation assumes, and no residual error model
  is published. PTA uses the covariance matrix directly, which is how the
  paper simulated.
- **Romano 1998 — Bayesian forecasting only.** The text selects an 
  *additive* residual error model while Table III reports the residual as 
  CV<sub>σ</sub> = 22.0%, a proportional quantity, so the scale of the 
  residual term is ambiguous in the published record. Monte Carlo target 
  attainment is unaffected — it uses only the fixed effects and the 
  interindividual terms.

One model is implemented with a stated gap: **Ehmann 2019's covariate
equations live in an appendix that is not part of the article PDF.** The
main text states their forms (piecewise linear in CLcr with an inflection
at 154 mL/min, a power function of weight, linear in albumin) and Table 2
gives the coefficients, but the exact appendix parameterisation was not
read. The proportional forms coded here reproduce the reference clearance
of 9.25 L/h and track the paper's own Table 3A attainment across CLcr to
within 10 percentage points.

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
| `model` | `van_thomson2009`, `pip_kim2022`, `pip_udy2015`, `pip_klastrup2020`, `mem_gijsen2021`, `mem_shekar2014`, `mem_ojeanson2021`, `mem_li2006`, `mem_ehmann2019`, `cef_nicasio2009` |
| `target` | `ft20`, `ft40`, `ft50`, `ft98`, `ft98x4`, `ft100`, `ft100x4`, `auc400`, `aucmic400`, `cmin1020` |
| `mic` | reference MIC in mg/L |
| `dose`, `tau`, `tinf` | regimen A: mg, hours, infusion hours |
| `dose2`,`tau2`,`tinf2` / `dose3`,`tau3`,`tinf3` | regimens B and C for comparison |
| `ci`, `dose24` | continuous infusion and its daily dose in mg |
| `wt`, `age`, `sex`, `ht` | covariates (`sex` = `M`/`F`) |
| `scr`, `scrUnit` | serum creatinine; `mg/dL` or `umol/L` |
| `cysc` | cystatin C in mg/L (Kim model) |
| `crcl` / `egfr` | set renal function directly; the underlying creatinine or cystatin C is back-solved |
| `ndoses` | doses given (default: auto, dosed out to steady state) |
| `evaldose` | which dose interval the target is evaluated over (default: last) |
| `whole` | `1` to plot the whole course instead of one interval |
| `bayes` | `0` to switch Bayesian forecasting off (default on) |
| `preset` | load a named teaching scenario (model, target, regimens, covariates, MIC) in one parameter; explicit parameters still override it |
| `trauma` | `1` for trauma (Romano model — raises clearance) |
| `sepsis` | `1` for sepsis (Romano model — raises volume) |
| `ecmo` | `1` for ECMO (Kim model) |
| `rrt` | `1` for continuous RRT (Shekar model) |
| `dialysis` | `none`, `cont`, `semicont` (O'Jeanson model) |
| `rd` | residual diuresis in mL/24 h (O'Jeanson model; 845 = cohort median) |
| `alb` | serum albumin in g/dL (Ehmann model; 2.8 = cohort median) |
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
- **Not done here:** the app is not rendered in a real browser from the
  build environment — the headless Chromium download resolves to a
  network-denylisted host. Behaviour and geometry are verified through a
  DOM implementation with an instrumented canvas, which is not the same as
  looking at it, and opening it in a real browser has twice found defects
  these suites could not see (a stale page header, a clipped concentration
  axis). The published copy at
  <https://russlewisbo.github.io/Dosingapp/> has been fetched and booted
  from its live URL with the served bytes checked identical to the
  committed build, but that is still a DOM check. A one-minute visual look
  on your own machine is worth it before you teach from it.

---
| Meropenem | **Li 2006** ([10.1177/0091270006291035](https://doi.org/10.1177/0091270006291035)) | 2-cmt, total plasma (f<sub>u</sub> 0.98) | CLcr **and age** on CL; weight on V<sub>1</sub> | 20% / 40% *f*T>MIC (the paper's bacteriostatic and bactericidal targets) |
| Meropenem | **Ehmann 2019** ([10.1016/j.ijantimicag.2019.06.016](https://doi.org/10.1016/j.ijantimicag.2019.06.016)) | 2-cmt, total plasma (f<sub>u</sub> 0.98) | CLcr piecewise-linear on CL to an inflection at 154 mL/min; weight on V<sub>1</sub>; **albumin on V<sub>2</sub>** | 98% *f*T>MIC, 98% *f*T>4×MIC |
| Piperacillin | **Klastrup 2020** ([10.1128/AAC.02556-19](https://doi.org/10.1128/AAC.02556-19)) | 1-cmt, **unbound** | CL = 2.25 + 0.119 × CRCL (nonrenal floor + renal term) | 100% *f*T>MIC, 100% *f*T>4×MIC |
| Cefepime | **Nicasio 2009** ([10.1128/AAC.01141-08](https://doi.org/10.1128/AAC.01141-08)) | 2-cmt **nonparametric**, total plasma (f<sub>u</sub> 0.85) | K10 = 0.071 + 0.0027 × CLcr; V<sub>1</sub> = 0.206 L/kg | 50% *f*T>MIC |

### Nonparametric models

Nicasio 2009 is not a NONMEM-style model: it publishes micro-constants
(K10, K12, K21, V<sub>1</sub>) with a **full covariance matrix** on the
natural scale rather than a diagonal log-normal Ω. The engine supports
this through `sampling: 'mvnorm'` — draws are taken from the published
median vector and covariance via Cholesky factorisation, then mapped to
CL/V<sub>1</sub>/Q/V<sub>2</sub> (CL = K10·V<sub>1</sub>,
Q = K12·V<sub>1</sub>, V<sub>2</sub> = Q/K21, exact identities).

Two honest caveats, both surfaced in the app rather than buried:

- Normal-scale draws can be **non-physical** (K12 has a median of 0.78
  against an SD of 1.023), so draws with a non-positive rate constant or
  volume are rejected and redrawn. At typical settings **about 70% of
  draws are rejected**, and the resulting truncated normal is no longer
  exactly the nonparametric distribution that was fitted. The rejected
  fraction is printed beneath the plot.
- MAP forecasting is disabled for this model: its prior is not the
  diagonal log-normal Ω the MAP implementation assumes, and no residual
  error model is published.

### What PTA here is conditional on

This tool computes attainment for **the patient whose covariates you
enter**, varying only the between-subject random effects. Several source
papers instead resample the covariate distribution of their whole cohort.
The difference is visible with Li 2006: its equations are reproduced
exactly (CL = 14.600 L/h at the reference covariates, V<sub>1</sub> =
10.80 L at 70 kg), and its conclusion is reproduced (a 3 h infusion beats
0.5 h), but the published 64% → 90% pair cannot be matched at *any single
covariate point* — `validate.cjs` asserts that it cannot. A mixture over
a heterogeneous cohort flattens the PTA curve in a way no individual
patient reproduces. That is a property of the two questions being
different, not an error in either.

## Which covariates does the selected model use?

Each model declares the inputs it needs, so the form changes when you
change model: albumin appears only for Ehmann, the dialysis-modality
select and residual diuresis only for O'Jeanson, the RRT checkbox only
for Shekar, cystatin C only for Kim.

But knowing which fields to *show* is not the same as knowing what each
one *does*, so the app works that out by **perturbing each covariate and
re-evaluating the model's own `params()` function**. Every input is
labelled with the parameters it actually moves, and the sidebar prints a
one-line summary:

| Model | Detected effects |
|---|---|
| Li 2006 | Weight → CL/V₁ · Age → CL · Sex → CL · Creatinine → CL |
| Ehmann 2019 | Weight → CL/V₁ · Age → CL · Sex → CL · Creatinine → CL · **Albumin → V₂** |
| Shekar 2014 | Weight → **CL only** · Age → CL · Sex → CL · Creatinine → CL · RRT → CL |
| O'Jeanson 2021 | Age → CL · Sex → CL · Creatinine → CL · Residual diuresis → CL · Dialysis modality → CL |
| Nicasio 2009 | Weight → **CL/V₁/Q/V₂** · Age → CL · Sex → CL · Creatinine → CL |

Detection rather than a hand-written list, for two reasons. It
distinguishes cases the form cannot: weight scales a volume for Li and
Nicasio but for Shekar and Klastrup only enters through Cockcroft-Gault,
and O'Jeanson ignores weight entirely because MDRD does not use it. And
it is **conditional on the current settings**, so an input that stops
mattering is marked *no effect* — select semi-continuous (intermittent)
dialysis under O'Jeanson and both creatinine and residual diuresis grey
out, because that branch fixes clearance at 11.0 L/h independently of
GFR and diuresis. Continuous dialysis keeps the diuresis term.

The failure mode this guards against is a model that *uses* a covariate
its list forgot to *declare*: the input would stay hidden while silently
affecting results. `test-app.cjs` asserts, for every model, that nothing
with a detected effect is hidden from the form.

### Hypoalbuminaemia and renal replacement

These are model choices, not just field entries. Albumin only acts where
a model estimated it (Ehmann, on V₂ — lower albumin, larger peripheral
volume). For renal replacement, pick the model built in that population:
Shekar for continuous RRT, O'Jeanson for intermittent or continuous
dialysis. Ehmann was built on **non-CRRT patients only**, so entering a
dialysis scenario there is outside its data — the model note says so.

## Turning Bayesian forecasting off

The TDM panel has an **Enable Bayesian forecasting** switch. Off, the
individual forecast is removed from the plot and legend and the panel
body is disabled, leaving the population prediction alone; the fit is
kept, so switching back on restores it without re-running MAP. The state
is carried in the embed URL as `bayes=0`, which is the useful part for
teaching: put the population-only and forecast-added versions of the same
patient on consecutive slides.

For models where forecasting is unavailable — Udy 2015, Nicasio 2009 and
Romano 1998,
each for a documented reason — the switch is disabled and labelled
*unavailable for this model* rather than silently doing nothing.

## The dosing course: first dose vs steady state

Target attainment is conventionally reported at steady state, and that is
the default here — the schedule is dosed out until the profile has
stabilised (`dosesToSteadyState()`, 5 half-lives, per simulated patient's
own parameters). But "does the first dose attain the target" is a
different and clinically real question, and the two answers diverge for
any drug that accumulates.

Three controls in the **Dosing course** card:

- **Doses given** — blank means auto (out to steady state). Set it to
  simulate a short course.
- **Evaluate dose #** — blank means the last interval. Set `1` to ask what
  the first dose achieves.
- **Plot whole course** — display only. The concentration–time plot spans
  from the first dose instead of one interval, with the evaluated interval
  marked by dashed lines so the reported numbers are traceable to the
  picture. **The metrics do not change when this is toggled** — it alters
  the plot window, never the evaluation window.

Worked example (Gijsen meropenem, 1 g q8h 0.5 h, eGFR 105, MIC 2, 100%
fT>MIC): this patient needs 4 doses to reach steady state, and PTA goes
from **5.3% on dose 1 to 30.9% at steady state**, with the median trough
rising 0.00 → 1.28 mg/L. That gap is the argument for a loading dose, and
it is invisible if you only ever look at steady state.

The header and the course note state which interval was evaluated and
whether it is genuinely at steady state — a course too short to have
reached it is labelled *pre–steady state* rather than silently reported as
steady state.

## Aminoglycosides: a different kind of target

Every other drug in the library is scored on time above MIC or on AUC.
Aminoglycosides are not, so the engine gained three target types. The
thresholds are the defaults documented in TDMx's own module reference
manuals: **C<sub>max</sub>/MIC ≥ 10**, **AUC<sub>0-24</sub>/MIC ≥ 70**,
and a trough ceiling of **2 mg/L** for gentamicin and tobramycin,
**5 mg/L** for amikacin.

- `cmaxmic` — peak-to-MIC ratio, for concentration-dependent killing.
- `cminceil` — the first target in the library met by a **low** exposure.
  It therefore moves opposite to every efficacy target, and a regimen can
  fail it by giving too much or by dosing too often.
- `composite` — every component met by the **same** simulated patient.
  A joint probability, not the product of the marginals: the patient who
  reaches the peak may be the one who breaches the trough.

A composite target reports each component separately, because the joint
number hides *which* constraint a regimen fails — and that is the teaching
content. Three worked scenarios ship as presets:

| Preset | What it shows |
|---|---|
| `gen-od` | 420 mg/day as q24h, q12h and q8h. Peak attainment 100% → 77% → 10%, trough 82% → 60% → 39%, **AUC unchanged**. The once-daily argument is a profile-shape effect, not a dose-intensity one. |
| `gen-renal` | The same 420 mg q24h at CLcr ≈ 45. It fails at 19%, and fails on the *trough* with the peak still at 100%. Extending to q48h recovers it to 83% with the peak intact; halving the dose reaches only 54% and gives up peak attainment as well. |
| `amk-icu` | Amikacin at MIC 4 in a septic patient. 1 g q24h reaches the peak target in 7% of patients, 1.5 g in 75% — the dose-escalation argument, bounded by the 5 mg/L trough ceiling. |

### The clinical peak is not the C<sub>max</sub>

Aminoglycoside "peaks", both in practice and in these papers, are sampled
about an hour after the infusion ends rather than at the end of it. The
distribution phase makes those materially different: at Hennig's own
optimal tobramycin dose of 11 mg/kg, the 1-h peak is **21 mg/L** while the
end-of-infusion C<sub>max</sub> is **32 mg/L**. Reporting only
C<sub>max</sub> would look like a 50% disagreement with any paper or TDM
report. The summary table carries both, and `validate.cjs` checks the 1-h
peak against Hennig's published target of 20 mg/L.

The `cmaxmic` target itself uses true C<sub>max</sub>, matching how TDMx
labels its own column. If you are teaching against a sampled peak, read
the 1-h peak column.

### Jelliffe is not interchangeable with Cockcroft-Gault

Romano's model is driven by the **Jelliffe 1973** bedside estimate (its
reference 10), and the app labels the renal readout accordingly.
Substituting Cockcroft-Gault is a model misuse — but not for the reason
usually given. The two differ by **body size**, not age: Cockcroft-Gault
is linear in weight while Jelliffe scales with body surface area, so their
ratio moves from about **1.13 at 45 kg to 0.66 at 130 kg**. In a 130 kg
patient Cockcroft-Gault returns 144 mL/min where Jelliffe returns 96, so
substituting it would overestimate this model's clearance by about **50%**
(5.4 → 8.1 L/h; clearance is linear in CLcr here, so the error carries
through exactly). Across age and creatinine the ratio is almost flat
(0.90 to 0.92). Both halves are asserted in `validate.cjs`.

### Variability on the scale it was published on

Xuan reports between-subject variability on the micro-constants — CL,
V<sub>1</sub>, K<sub>12</sub>, K<sub>21</sub> — not on Q and V<sub>2</sub>.
Those are not interchangeable, since Q = K<sub>12</sub>·V<sub>1</sub> and
V<sub>2</sub> = Q/K<sub>21</sub>, so variability on K<sub>12</sub>
propagates into *both* macro parameters and correlates them. Declaring
K<sub>12</sub>'s spread on Q instead would misstate the peripheral
compartment. The engine samples on the published scale and converts
afterwards (`sampling: 'micro'`), and MAP estimation does the same; the
sampled CL spread is checked against the published 29.6% CV.

### What these three models deliberately do not include

- **Cystic fibrosis, in Hennig 2013.** Tested at every covariate step and
  never significant on any parameter — that is the paper's central
  finding, so adding a CF term would contradict the source.
- **Romano's residual error.** The text selects an *additive* residual
  model while Table III reports the residual as CV<sub>σ</sub> = 22.0%, a
  proportional quantity. The scale is ambiguous in the published record
  and a wrong residual variance silently changes how strongly TDM samples
  outweigh the prior, so MAP forecasting is disabled with that reason
  shown in the app. Monte Carlo attainment is unaffected: it uses only the
  fixed effects and the interindividual terms, which is how the paper
  itself used the model.
- **Hennig's paediatric SCR<sub>mean</sub>.** The adult reference values
  are tabulated (69.5 µmol/L female, 84 µmol/L male) but the age
  relationship for children is not reproduced in the paper, so ages under
  18 fall back to the reported paediatric median of 37.2 µmol/L and should
  be treated as approximate.
- **Hennig's between-occasion variability** (12.7% on clearance) and its
  estimated infusion-duration parameter.
- **Xuan's poorly-identified terms**, kept as published but flagged in the
  model note: IIV on V<sub>1</sub> is 5.8% with a relative standard error
  of 350%, and K<sub>21</sub> has a 95% CI of 0.0033–0.14.

## Scope

This is a simulation and teaching tool, not a medical device. It has no
validated link to clinical outcome, carries no institutional dosing policy,
and individual dosing decisions need a qualified clinician with the full
patient context. The population models describe the populations they were
built in — an ICU model does not transfer silently to a ward patient, and
the Kim model's clearance covariate is specifically **cystatin C** eGFR,
not a creatinine-based estimate.
