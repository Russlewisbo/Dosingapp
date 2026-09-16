# MIPD Lab — project status

**Last updated:** 2026-09-14
**State:** working, tested, not yet opened in a real browser (see *Known gaps*)

A browser-based model-informed precision dosing tool in the shape of
[TDMx](https://www.tdmx.eu/) — a patient record plus a library of published
population PK models, offering Monte Carlo probability-of-target-attainment
and MAP Bayesian dose individualisation — plus a widget build of the same
file that embeds live in Quarto/reveal.js teaching slides.

---

## Where we are

| | |
|---|---|
| Deliverable | `mipd-lab.html` — one self-contained file, 133 KB, no CDN, no server, no network requests (the only external URLs are the clickable DOI citation links) |
| Models implemented | 6 (3 drugs) |
| Models documented but not implemented | 4, each with the reason shown in-app |
| Test checks passing | **463** across 6 suites |
| Slide deck | `slides-demo.qmd`, renders under Quarto 1.6.43 |

### Architecture

The slide-embedding requirement determined everything: a deck has no
backend, so the PK solutions, Monte Carlo sampler and Bayesian optimiser
are all client-side JavaScript inlined into a single HTML file. The same
file is both the full app and the widget, switched by `?mode=widget`; view
state travels entirely in URL parameters, and simulations are seeded so a
URL reproduces its figure exactly.

```
pkpd-core.js    engine: analytic 1-/2-cmt IV infusion solutions, seeded
                Monte Carlo, correlated IIV (Cholesky), exposure metrics,
                Nelder-Mead MAP estimation, renal-function estimators
models.js       model library as DATA + PD targets + presets
app.js          UI, hand-rolled canvas plotting, URL-parameter wiring
shell.html      HTML/CSS shell with inlining markers
build.py        inlines the three JS files -> mipd-lab.html
```

Rebuild after editing any JS: `python build.py`.

### Model library complete

All four previously-disclosed omissions were implemented once the PDFs
were supplied — Li 2006 and Ehmann 2019 (meropenem), Klastrup 2020
(piperacillin continuous infusion) and Nicasio 2009 (cefepime). The
library is now **13 models across 7 drugs**, and `PENDING` is empty for
the first time. The app states that explicitly rather than rendering a
blank panel.

Each was validated against numbers its own paper published:

| Model | Independent check | Result |
|---|---|---|
| Klastrup 2020 | half-lives and renal clearance fractions at CRCL 30/80/130 | **exact** — 4.26/2.11/1.40 h vs published 4.3/2.1/1.4; 61.3/80.9/87.3% vs 61.3/80.9/87.3% |
| Nicasio 2009 | PTA at CLcr 40, 2 g q12h 3 h, MIC 8/16/32 | 93.0/76.0/51.6% vs published 93.8/79.8/50.7% |
| Ehmann 2019 | Table 3A PTA across CLcr 30–150 | within 10 points, monotone; day 1 ≈ steady state, as the paper reports |
| Li 2006 | fixed effects at the centring covariates | **exact** — CL 14.600 L/h, V1 10.80 L |

Engine work this required: **multivariate-normal sampling on the natural
parameter scale** (`sampling: 'mvnorm'`), because Nicasio is a
nonparametric model publishing a full covariance matrix on
micro-constants rather than a diagonal log-normal Ω. Draws that are
non-physical are rejected and redrawn, and the rejected fraction
(~70% at typical settings) is reported beneath the plot, because a
heavily truncated normal is no longer the distribution the authors fitted.

A general limitation this surfaced, now documented: **PTA here is
conditional on the covariates entered**, while several papers resample
their whole cohort's covariate distribution. Li's published 64% → 90%
pair cannot be reproduced at any single covariate point — `validate.cjs`
asserts that it cannot, rather than tuning toward it.

### Covariate exposure and the forecasting switch

Which covariates a model uses is determined by **perturbing each one and
re-evaluating that model's `params()`**, not by trusting the declared
list. Every input is labelled with the parameters it moves, and inputs
that currently do nothing are greyed and marked *no effect* — which is
conditional: under O'Jeanson, semi-continuous (intermittent) dialysis
fixes clearance at 11.0 L/h independently of GFR and residual diuresis,
so both grey out, while continuous dialysis keeps the diuresis term.
`test-app.cjs` asserts for every model that nothing with a detected
effect is hidden from the form — that would be a covariate silently
affecting results with no way to set it.

Bayesian forecasting now has an on/off switch (`bayes=0` in the embed
URL). Off, the overlay and panel body are disabled but the fit is
retained, so toggling back on does not re-run MAP. The switch is disabled
with an explanatory label for the two models that cannot support
forecasting.

### Dosing course

Attainment defaults to the **last** dosing interval, with the schedule
dosed out to steady state per simulated patient. Three controls change
that: *Doses given*, *Evaluate dose #*, and *Plot whole course* (display
only — it moves the plot window, never the evaluation window, and the
evaluated interval is marked on the plot). The header and course note say
which interval was evaluated and whether it is genuinely steady state; a
course too short to have reached it is labelled *pre–steady state*.

Teaching payoff: Gijsen meropenem 1 g q8h at eGFR 105, MIC 2, 100%
fT>MIC — **5.3% PTA on dose 1 vs 30.9% at steady state** (4 doses needed),
median trough 0.00 → 1.28 mg/L. That is the loading-dose argument, and it
is invisible at steady state alone.

---

## Model library

The governing rule, adopted early and enforced in code: **a model ships
only if its fixed effects, covariate equations *and* between-subject
variability were all read off the primary publication's parameter table.**
A model without variance terms cannot support Monte Carlo PTA or Bayesian
forecasting at all, so a partial model is not a cheap version of a real one.

| Drug | Model | Structure | Clearance covariate | MAP |
|---|---|---|---|---|
| Piperacillin | Kim 2022 | 2-cmt, total, *f*u 0.91 | eGFR (CKD-EPI **cystatin C**), ECMO on V<sub>c</sub> | yes |
| Piperacillin | Udy 2015 | 2-cmt, **unbound** | CLcr (Cockcroft-Gault) | **no** — see below |
| Vancomycin | Thomson 2009 | 2-cmt, total | CLcr (Cockcroft-Gault, TBW) | yes |
| Meropenem | Gijsen 2021 | 2-cmt, **unbound** | eGFR (CKD-EPI creatinine)<sup>1.29</sup> | yes |
| Meropenem | Shekar 2014 | 2-cmt, total | CLcr **or** fixed 5.1 L/h on RRT | yes |
| Meropenem | O'Jeanson 2021 | **1-cmt**, total | dialysis modality / GFR (MDRD) / residual diuresis | yes |
| Gentamicin | Xuan 2004 | 2-cmt as CL/V<sub>1</sub>/K<sub>12</sub>/K<sub>21</sub> | CLcr (Cockcroft-Gault) on CL; 0.28 L/kg on V<sub>1</sub> | yes |
| Amikacin | Romano 1998 | **1-cmt** | CLcr (**Jelliffe 1973**); trauma on CL, sepsis on V | no |
| Tobramycin | Hennig 2013 | 2-cmt | **fat-free mass**, age, SCR ratio, sex; CL-V<sub>1</sub> corr 0.658 | yes |
| Meropenem | Li 2006 | 2-cmt, total (f<sub>u</sub> 0.98) | CLcr **and age** on CL; weight on V<sub>1</sub> | yes |
| Meropenem | Ehmann 2019 | 2-cmt, total (f<sub>u</sub> 0.98) | CLcr piecewise-linear to 154 mL/min; weight on V<sub>1</sub>; **albumin on V<sub>2</sub>** | yes |
| Piperacillin | Klastrup 2020 | **1-cmt**, unbound | CL = 2.25 + 0.119 × CRCL | yes |
| Cefepime | Nicasio 2009 | 2-cmt **nonparametric** (f<sub>u</sub> 0.85) | K10 = 0.071 + 0.0027 × CLcr | no |

Presets: `pip-ei`, `pip-arc`, `pip-ci`, `mem-rrt`, `mem-arc`, `mem-ward`, `cef-vap`, `van-auc`.

### Not implemented, and why (shown in the app, not hidden)

**Nothing.** All four models once listed here — Nicasio 2009 (cefepime),
Klastrup 2020 (piperacillin), Li 2006 and Ehmann 2019 (meropenem) — were
implemented from their own parameter tables once the PDFs were supplied.
`PENDING` is empty and the app says so explicitly rather than rendering a
blank panel. The mechanism is retained: a model that cannot be faithfully
reproduced belongs there rather than being approximated.

### Deliberate limitations

- **Nicasio 2009 MAP is disabled.** Its prior is a full covariance matrix
  on natural-scale micro-constants, not the diagonal log-normal Ω the MAP
  implementation assumes, and no residual error model is published. PTA
  uses the covariance matrix directly, which is how the paper simulated.
- **Nicasio 2009 sampling is a truncated normal.** ~70% of draws from the
  published covariance are non-physical (K12 median 0.78, SD 1.023) and
  are rejected; the rejected fraction is printed beneath the plot.
- **Ehmann 2019 covariate equations are inferred from their stated
  forms.** The appendix holding them is not in the article PDF; Table 2's
  coefficients and the main text's descriptions are. The coded forms
  reproduce the reference CL of 9.25 L/h and Table 3A within 10 points.

- **Udy 2015 MAP is disabled.** Its error table reports `RUV (%CV) 1.0`
  beside `RUV (SD) 0.3 mg/L`; the proportional term's scale is ambiguous,
  and a wrong residual variance silently distorts how strongly TDM samples
  outweigh the prior. PTA needs only fixed effects and BSV — which is how
  the paper itself used the model — so PTA is on and MAP is off.
- **No MIC distribution is bundled.** Cumulative fraction of response
  requires pasting your own isolate frequencies. A CFR computed against a
  surveillance distribution nobody chose would be a fabricated result.
- **Thomson `Q` unit ambiguity.** Tabulated as `2.28` with a unit label of
  h⁻¹ while the table key defines Q as intercompartmental *clearance*.
  Implemented as 2.28 L/h, consistent with the key and the CL/V
  parameterisation. Change in `models.js` if you read it the other way.
- **No ECMO term in either ECMO model.** Gijsen and Shekar both tested
  ECMO and found it non-significant — that is each paper's central
  finding — so adding one would contradict the source.

---

## Open finding: Shekar 2014 is internally inconsistent

Not a bug in this tool; a problem in the source, and worth knowing before
teaching from it.

Its Table 3 tabulates simulated troughs by CLcr, and its CLcr-banded dosing
advice derives from that table. Inverting Table 3 — solving for the
clearance that reproduces each published trough, holding the published
V<sub>c</sub>/V<sub>p</sub>/Q fixed — yields clearances of only **2.4–5.5 L/h**
across CLcr 20–180. That contradicts the same paper's *measured* clearances
of 7.9 ± 5.9 (ECMO) and 11.7 ± 6.5 L/h (controls) and cannot be produced by
its own Table 2 equation under any unit reading. Its 1 g column is
additionally not dose-proportional to its 500 mg and 2 g columns, which are
proportional to each other.

**Resolution taken:** implement the published *equation*, because that is
what reproduces the measurements (CL = 1.89 × CLcr in L/h → 11.34 L/h at
CLcr 100, 7.94 at CLcr 70, both within 0.4 L/h of the reported means). The
consequence is that **this model does not reproduce that paper's dosing
table**; it predicts markedly lower attainment at high CLcr. `validate.cjs`
asserts the inconsistency, so it is regression-tested rather than tuned away.

---

## Verification

`node test-core.cjs && node test-app.cjs && node test-layout.cjs && node validate.cjs && node test-slides.cjs`
(requires `npm install jsdom`; `test-slides.cjs` additionally requires
`quarto render slides-demo.qmd` first).

| Suite | Checks | What it establishes |
|---|---|---|
| `test-core.cjs` | 64 | Engine against known answers: analytic 2-cmt vs RK4 integration (max rel. err 4×10⁻¹³), steady-state AUC over τ = Dose/CL, CI plateau = R₀/CL, MAP recovery, correlated-IIV sampler, renal estimators, per-model covariate equations |
| `test-app.cjs` | 123 | Headless DOM boot of the built file: rendering, interactions, per-model covariate controls, disclosure of omissions |
| `test-layout.cjs` | 104 | Canvas geometry: clipped text, overlapping tick labels, out-of-canvas vertices, NaN coordinates, at full / widget / 380 px widths |
| `validate.cjs` | 42 | Published quantities reproduced from independently coded parameters |
| `test-slides.cjs` | 9 | Every widget URL in the *rendered* deck boots with the right model and target |

### Published quantities reproduced

- **Kim 2022** — at eGFR 150 / MIC 16, 16 g/day as 0.5 h infusion reaches
  27.9% PTA for 100% fT>MIC while continuous infusion reaches 100%; 50%
  fT>MIC at MIC 8 attained at normal renal function (99.9%); PTA falls
  monotonically 98.5% → 15.3% across eGFR 30 → 170. Matches the paper's
  stated conclusions.
- **O'Jeanson 2021** — typical-patient clearance reconstructs to
  **4.20 L/h** (1.36 + 0.058 × 49), exactly the published value.
- **Gijsen 2021** — reference clearance 14.7 L/h, between the reported
  cohort means (13.7 non-ECMO, 17.4 ECMO); scales as eGFR<sup>1.29</sup> to
  machine precision.
- **Shekar 2014** — clearance within 0.4 L/h of both reported cohort means.

### Things found by testing, not by inspection

- The MAP individual forecast was excluded from the y-axis scaling and
  was drawn on a fixed 0–τ axis, so a high-exposure individual was
  clipped at the top of the plot and, in whole-course view, compressed
  into the first dosing interval. Reported from a real browser. It is now
  regenerated on the plot's own schedule and window, included in the
  y-scale, and labelled in the legend (it previously had no legend entry).
- Klastrup 2020 is the first model whose *default* regimen is a
  continuous infusion, which exposed three places in the UI that assumed
  an intermittent default and produced NaN plot coordinates. Caught by
  the layout audit within minutes of adding the model.

- The page header was written once at start-up, so selecting a meropenem
  model left the title reading "Piperacillin — target attainment" while
  the plots below it were correct. Reported from a real browser, which is
  exactly the class of defect the headless suites could not see: the DOM
  was present and every number was right. Now derived state, rewritten on
  every run, with a regression test that switches drug twice.
- Extending the plot to the whole course put two new defects in front of
  the layout audit, and it caught both: the upper prediction band hit
  log10(0) at t = 0 (concentration is exactly zero before the first dose)
  and flew off-canvas, and the "evaluated" marker label overflowed the
  right edge at widget width on a long course.

- Log-scale gridlines were calling `log10` on a tick *object* and silently
  vanishing — caught by the layout audit.
- Gijsen's published CL–V<sub>c</sub> correlation (0.704) is not cosmetic:
  honouring it moves PTA for 100% fT>MIC at MIC 2 from 38.1% (independent
  sampling) to **31.3%**. This drove adding covariance-matrix construction,
  Cholesky sampling, and the matching full quadratic-form η′Ω⁻¹η MAP prior.

---

## Known gaps

1. **Still not openable in a real browser from the build environment** —
   the headless Chromium download redirects to a network-denylisted host,
   so geometry is verified by auditing canvas draw-call coordinates. The
   app HAS now been opened in a real browser by the user, which
   immediately found the stale-header bug (since fixed); treat further
   visual checks as worthwhile for the same reason.
2. Li 2006 and Ehmann 2019 await PDFs.
3. No cefepime model — the originally-planned drug — because the candidate
   model is nonparametric.
4. Assumption/residual diagnostics on the implemented models were not
   assessed; the models are taken as published.

---

## Scope

A simulation and teaching tool, not a medical device. No validated link to
clinical outcome, no institutional dosing policy embedded. Population
models describe the populations they were built in: an ICU model does not
transfer silently to a ward patient, and the Kim model's clearance
covariate is specifically cystatin-C eGFR, not a creatinine estimate.
Individual dosing decisions require a qualified clinician with the full
patient context.
