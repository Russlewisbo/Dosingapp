# Setting up MIPD Lab

Four levels, depending on what you want to do. Only the last needs
anything installed, and level 0 needs nothing at all — not even the
file.

---

## 0. Use the hosted copy — nothing to install

The app is published with GitHub Pages at

**<https://russlewisbo.github.io/Dosingapp/>**

That is a static site served straight from the `main` branch, so it is the
same `mipd-lab.html` this repository builds — no backend, no account, and
nothing is sent anywhere. It works from any browser on any machine, and the
teaching scenarios are addressable directly:

```
https://russlewisbo.github.io/Dosingapp/mipd-lab.html?preset=gen-od
https://russlewisbo.github.io/Dosingapp/mipd-lab.html?preset=gen-renal
```

Two things to know about relying on the hosted copy in a lecture:

- **The page must load once.** After that it runs offline, because the
  whole engine is in the file — but the first load needs the network. If
  the lecture theatre is unreliable, save the page to disk beforehand
  (right-click → Save Page As) or use a local copy as below.
- **It tracks `main`.** Pushing a change republishes within a minute or
  two, so a URL in last term's slides will pick up this term's fixes. If
  you need a frozen version for a specific course, tag it and serve that
  tag from a separate branch.

The landing page is generated from `models.js` by `build-index.py`, which
`build.py` runs for you — so the model table and preset links on the site
cannot drift from the library. `test-app.cjs` asserts that.

## 1. Use the app — no setup

Download **`mipd-lab.html`** and double-click it.

That is the whole procedure. It opens in Chrome, Safari, Firefox or Edge
and runs from `file://`. No server, no `npm`, no Python, no internet.

It makes **no network requests**: the built file contains no remote
scripts, stylesheets, fonts or images, and no `fetch`/`XHR`/`WebSocket`
calls. The only external URLs in it are the `https://doi.org/...`
citation links beside each model, which open the source paper in a new tab
when *you* click them. So it works on a plane, on hospital wifi, or from a
USB stick in a lecture theatre.

For projection, append `?mode=widget` in the address bar: larger fonts, no
sidebar.

### First 30 seconds

1. **Model** — pick one of the 10. The covariate fields below change to
   match, and each is labelled with the parameters it moves in *that*
   model (weight scales a volume for Li and Nicasio; for Shekar it only
   enters Cockcroft-Gault).
2. **Covariates** — enter your patient. The renal estimate and the
   resulting typical clearance appear underneath, labelled with which
   equation was used.
3. **Regimens** — up to three, compared side by side. Intermittent or
   continuous infusion.
4. **Dosing course** — blank means "dose out to steady state and score the
   last interval". Set *Evaluate dose #* to `1` to ask what the first dose
   achieves.
5. **PK/PD target** — the targets offered are the ones the selected
   model's own paper used.
6. **MIC distribution** — optional. Paste your own isolate frequencies to
   get a cumulative fraction of response. Nothing is assumed.

---

## 2. Put the widget in slides

See **`SLIDES.md`**. The short version: `mipd-lab.html` must sit in the
same folder as `slides-demo.qmd` when you render, and stay beside
`slides-demo.html` afterwards. Quarto does not copy it and does not warn.

To present the demo deck with nothing installed, open the already-rendered
`slides-demo.html` from the slides package.

---

## 3. Rebuild or extend it

### Rebuild the single file

```bash
python build.py
```

Needs **Python 3 only** — `build.py` imports nothing outside the standard
library. It inlines `pkpd-core.js`, `models.js` and `app.js` into
`shell.html` and writes `mipd-lab.html`. Run it after editing any of those
four files; editing them without rebuilding changes nothing you can see.

### Run the tests

```bash
npm install jsdom        # the only dependency, for the DOM-based suites
node test-core.cjs       #  64 checks — PK engine against known answers
node test-app.cjs        # 123 checks — UI, per-model covariates, controls
node test-layout.cjs     # 104 checks — canvas geometry, clipping, overlaps
node validate.cjs        #  42 checks — checks each model against its paper
```

333 checks. `test-slides.cjs` (9 more) skips unless the deck has been
rendered; `test-deck.cjs` checks a rendered deck's widget actually boots
and is described in `SLIDES.md`.

Verified on Node 24 with jsdom 30. `validate.cjs` is the one to re-run
after touching a model. It compares each implementation against values its
source publication printed — and where the two deliberately do *not*
agree, it asserts the documented discrepancy rather than the agreement, so
the disagreement stays regression-tested instead of being quietly tuned
away. Two such cases:

- **Shekar 2014** is internally inconsistent: inverting its Table 3 trough
  percentiles implies clearances that contradict the same paper's measured
  cohort means, and its own Table 2 equation cannot produce them under any
  unit reading. The published equation is implemented, because it
  reproduces the measured clearances; the test asserts that attainment
  therefore diverges from that paper's dosing table at high CLcr.
- **Li 2006** resampled its whole cohort's covariates, whereas this tool
  conditions on the one patient you enter. Its equations reproduce exactly,
  but its published 64% → 90% pair cannot be matched at *any* single
  covariate point — the test asserts that it cannot.

### Render the demo deck

```bash
quarto render slides-demo.qmd --to revealjs
```

Needs [Quarto](https://quarto.org/docs/get-started/) (verified on 1.6.43).
Run it in the folder that contains `mipd-lab.html`.

---

## Adding a model

The schema and a worked example are in `README.md`. The house rule: a
model ships only if its fixed effects, covariate equations **and**
between-subject variability were all read off the primary publication's
parameter table. A model that cannot be reproduced faithfully goes in
`PENDING` with the reason, which the app displays, rather than being
approximated.

---

This is a simulation and teaching tool, not a medical device. It carries
no validated link to clinical outcome and no institutional dosing policy.
Individual dosing decisions need a qualified clinician with the full
patient context.
