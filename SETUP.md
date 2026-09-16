# Setting up MIPD Lab

Three levels, depending on what you want to do. Only the third needs
anything installed.

---

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
node validate.cjs        #  42 checks — reproduces each paper's own numbers
```

333 checks. `test-slides.cjs` (9 more) skips unless the deck has been
rendered; `test-deck.cjs` checks a rendered deck's widget actually boots
and is described in `SLIDES.md`.

Verified on Node 24 with jsdom 30. `validate.cjs` is the one to re-run
after touching a model — it checks the implementation against values its
source publication printed.

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
