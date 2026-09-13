# MIPD Lab — project status

**Last updated:** 2026-09-13
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
| Deliverable | `mipd-lab.html` — one self-contained file, 104 KB, no CDN, no server, no network |
| Models implemented | 6 (3 drugs) |
| Models documented but not implemented | 4, each with the reason shown in-app |
| Test checks passing | **162** across 5 suites |
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

Presets: `pip-ei`, `pip-arc`, `mem-rrt`, `mem-arc`, `van-auc`.

### Not implemented, and why (all shown in the app, not hidden)

| Model | Reason |
|---|---|
| Cefepime — Nicasio 2009 | Nonparametric; support points / parameter dispersion not in the retrievable record |
| Piperacillin — Klastrup 2020 | Abstract only; no parameter table |
| **Meropenem — Li 2006** | **Closed access, no repository copy. One PDF away.** |
| **Meropenem — Ehmann 2019** | **Closed access, no repository copy. One PDF away.** |

### Deliberate limitations

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
| `test-core.cjs` | 41 | Engine against known answers: analytic 2-cmt vs RK4 integration (max rel. err 4×10⁻¹³), steady-state AUC over τ = Dose/CL, CI plateau = R₀/CL, MAP recovery, correlated-IIV sampler, renal estimators, per-model covariate equations |
| `test-app.cjs` | 56 | Headless DOM boot of the built file: rendering, interactions, per-model covariate controls, disclosure of omissions |
| `test-layout.cjs` | 38 | Canvas geometry: clipped text, overlapping tick labels, out-of-canvas vertices, NaN coordinates, at full / widget / 380 px widths |
| `validate.cjs` | 19 | Published quantities reproduced from independently coded parameters |
| `test-slides.cjs` | 8 | Every widget URL in the *rendered* deck boots with the right model and target |

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

- Log-scale gridlines were calling `log10` on a tick *object* and silently
  vanishing — caught by the layout audit.
- Gijsen's published CL–V<sub>c</sub> correlation (0.704) is not cosmetic:
  honouring it moves PTA for 100% fT>MIC at MIC 2 from 38.1% (independent
  sampling) to **31.3%**. This drove adding covariance-matrix construction,
  Cholesky sampling, and the matching full quadratic-form η′Ω⁻¹η MAP prior.

---

## Known gaps

1. **Never opened in a real browser from the build environment.** The
   headless Chromium download redirects to a network-denylisted host.
   Behaviour and geometry are verified through a DOM implementation with an
   instrumented canvas, which is not the same as looking at it. **Worth a
   one-minute visual check before teaching from it.**
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
