# Running the dosing model inside your slides

## The one rule

**`mipd-lab.html` must sit in the same folder as `slides-demo.qmd` when you
render, and stay beside `slides-demo.html` afterwards.**

Every widget slide is an `<iframe src="mipd-lab.html?...">`. Quarto does
*not* copy that file for you, and — this is the trap — **it does not warn
you either**: the render says `Output created: slides-demo.html` and exits
0, then each widget slide shows the browser's own 404 page, which looks
like a blank slide with a small "Not Found" in the corner.

The deck now detects this itself and shows a red banner naming the fix, so
it can't fail silently again.

## Present immediately (nothing to install)

This folder is already rendered. Open **`slides-demo.html`** in any
browser. Arrow keys move; `S` opens speaker notes; `Esc` gives the slide
overview.

## Re-render after editing the deck

You need Quarto (<https://quarto.org/docs/get-started/>), then:

```bash
quarto render slides-demo.qmd --to revealjs
```

Run it *in this folder* so `mipd-lab.html` is alongside. Keep the whole
folder together when you copy or email it — `slides-demo_files/` holds
reveal.js.

## Checking it worked

```bash
npm install jsdom
node test-deck.cjs
```

Run it **in this folder**. It serves the rendered deck over a local HTTP
server, loads it, and confirms the widget actually boots inside the slide
iframe — it looks for the app's own global, not merely that the iframe
loaded, because a 404 page loads fine. It then repeats the check with the
app deliberately removed, to prove the warning banner fires rather than
passing vacuously.

If the app is not beside the deck it says so and names the fix, and it
exits non-zero, so it is safe to use in a script.

## Adding your own widget slide

Set the app up as you want it, press **Build widget URL** in the sidebar,
and paste the snippet it gives you. The URL carries model, regimen,
target, MIC and the random seed — the seed is why the curve on your slide
is the curve that appears in the lecture theatre.

Inline on a slide with other content:

```markdown
## Extended infusion

<iframe src="mipd-lab.html?mode=widget&model=pip_kim2022&dose=4000&tau=6&tinf=4&mic=16&target=ft100"
        width="100%" height="440" style="border:0"></iframe>
```

Full-slide and driveable by the class:

```markdown
## Title {background-iframe="mipd-lab.html?mode=widget&..." background-interactive="true"}
```

`background-interactive="true"` is what lets clicks and typing reach the
widget instead of being swallowed by reveal.js navigation.

### remark.js / xaringan

The same `<iframe>` works — remark passes raw HTML through. There is no
equivalent of `background-iframe`, so size a plain iframe to fill the
slide.

## Useful URL parameters

| Parameter | Effect |
|---|---|
| `mode=widget` | widget layout: no sidebar, larger fonts |
| `panel=pta` / `panel=conc` | show only one of the two plots |
| `controls=0` | hide the compact control strip |
| `summary=0` | hide the attainment summary |
| `whole=1` | plot the whole course instead of one interval |
| `evaldose=1` | score the first dose instead of steady state |
| `bayes=0` | switch Bayesian forecasting off |
| `seed=` | fix the Monte Carlo draw so the figure is reproducible |

The full parameter list is in `README.md`.
