"""Generate index.html, the GitHub Pages landing page.

The model list, the preset list and the citation table are all read out of
models.js rather than typed here, so the landing page cannot drift from
the library the way a hand-maintained list would. Run after build.py.
"""
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).parent

# Pull the library out of models.js through node, so there is exactly one
# source of truth for what the site advertises.
DUMP = r"""
const M = require('./models.js');
const pick = o => ({ id: o.id, drug: o.drug, label: o.label, doi: o.doi,
                     source: o.source, bayesian: !!o.bayesian,
                     targets: o.targets.map(t => t.label) });
console.log(JSON.stringify({
  models: M.MODELS.map(pick),
  presets: M.PRESETS.map(p => ({ id: p.id, label: p.label, model: p.model })),
  pending: M.PENDING.length
}));
"""
lib = json.loads(subprocess.run(
    ["node", "-e", DUMP], cwd=ROOT, capture_output=True, text=True, check=True
).stdout)

models, presets = lib["models"], lib["presets"]
drugs = []
for m in models:
    if m["drug"] not in drugs:
        drugs.append(m["drug"])


def esc(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


# --- teaching scenarios -----------------------------------------------------
preset_rows = "\n".join(
    f'      <li><a href="mipd-lab.html?preset={p["id"]}">{esc(p["label"])}</a>'
    f' <span class="mono">?preset={p["id"]}</span></li>'
    for p in presets
)

# --- model table, grouped by drug in library order --------------------------
model_rows = ""
for d in drugs:
    for i, m in enumerate(x for x in models if x["drug"] == d):
        cite = esc(m["label"].split("\u2014")[0].strip())
        doi = m.get("doi") or ""
        link = (f'<a href="https://doi.org/{doi}">{cite}</a>' if doi else cite)
        model_rows += (
            "      <tr>"
            f'<td>{esc(d) if i == 0 else ""}</td>'
            f"<td>{link}</td>"
            f'<td>{esc(", ".join(m["targets"][:3]))}'
            f'{"&hellip;" if len(m["targets"]) > 3 else ""}</td>'
            f'<td class="c">{"yes" if m["bayesian"] else "&mdash;"}</td>'
            "</tr>\n"
        )

HTML = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MIPD Lab &mdash; antimicrobial PK/PD target attainment</title>
<style>
  :root {{ --ink:#15181c; --mut:#4a5158; --line:#dde2e7; --acc:#0072b2; }}
  * {{ box-sizing:border-box }}
  body {{ margin:0; padding:34px 20px 60px;
         font:16px/1.62 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         color:var(--ink); background:#fff; }}
  .wrap {{ max-width:860px; margin:0 auto }}
  h1 {{ font-size:28px; margin:0 0 4px; letter-spacing:-.2px }}
  .sub {{ color:var(--mut); margin:0 0 26px; font-size:15px }}
  h2 {{ font-size:19px; margin:34px 0 10px; padding-bottom:5px;
        border-bottom:1px solid var(--line) }}
  a {{ color:var(--acc) }}
  .cta {{ display:inline-block; background:var(--acc); color:#fff;
          text-decoration:none; padding:11px 20px; border-radius:6px;
          font-weight:600; margin:2px 6px 2px 0 }}
  .cta.alt {{ background:#fff; color:var(--acc); border:1.5px solid var(--acc) }}
  table {{ border-collapse:collapse; width:100%; font-size:14.5px; margin-top:6px }}
  th,td {{ text-align:left; padding:6px 9px; border-bottom:1px solid var(--line);
           vertical-align:top }}
  th {{ font-size:12.5px; text-transform:uppercase; letter-spacing:.4px;
        color:var(--mut) }}
  td.c,th.c {{ text-align:center }}
  ul {{ padding-left:22px }} li {{ margin:5px 0 }}
  .mono {{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
           font-size:12.5px; color:var(--mut) }}
  iframe {{ width:100%; height:560px; border:1px solid var(--line);
            border-radius:8px; margin-top:8px }}
  .note {{ background:#f6f8fa; border:1px solid var(--line); border-radius:7px;
           padding:12px 15px; font-size:14.5px; margin:14px 0 }}
  footer {{ margin-top:44px; padding-top:14px; border-top:1px solid var(--line);
            font-size:13px; color:var(--mut) }}
</style>
</head>
<body>
<div class="wrap">

  <h1>MIPD Lab</h1>
  <p class="sub">
    Monte Carlo target attainment and Bayesian dose individualisation for
    antimicrobials &mdash; {len(models)} published population PK models across
    {len(drugs)} drugs, running entirely in your browser.
  </p>

  <a class="cta" href="mipd-lab.html">Launch the app</a>
  <a class="cta alt" href="https://github.com/Russlewisbo/Dosingapp">Source on GitHub</a>

  <div class="note">
    <b>Nothing is sent anywhere.</b> The simulation engine, the Monte Carlo
    sampler and the MAP estimator are all client-side JavaScript in a single
    self-contained file. There is no backend and no analytics; the only
    outbound links on the page are the DOIs of the source papers. It works
    offline once loaded, which is what makes it usable from a lecture
    theatre with no network.
  </div>

  <h2>Teaching scenarios</h2>
  <p>Each of these loads a model, a PK/PD target, the regimens being
     compared and a patient in one URL &mdash; so a slide, a handout or an
     email can point straight at the comparison.</p>
  <ul>
{preset_rows}
  </ul>

  <h2>Try it here</h2>
  <p>The same file embedded as a plain <span class="mono">&lt;iframe&gt;</span>,
     which is how it goes into a Quarto/reveal.js or remark deck:</p>
  <iframe src="mipd-lab.html?mode=widget&amp;preset=gen-od&amp;n=600&amp;title=Gentamicin%20420%20mg%2Fday%2C%20three%20intervals"
          title="Gentamicin once-daily versus divided dosing"></iframe>

  <h2>Model library</h2>
  <table>
    <thead><tr><th>Drug</th><th>Model</th><th>Targets</th>
      <th class="c">Forecasting</th></tr></thead>
    <tbody>
{model_rows}    </tbody>
  </table>
  <p class="sub" style="margin-top:10px">
    Every model was implemented from its own primary publication's parameter
    table &mdash; fixed effects, covariate equations and between-subject
    variability. A model whose variability terms are not in the published
    record cannot support Monte Carlo attainment or Bayesian forecasting at
    all, so it is listed as unavailable with the reason rather than
    approximated. Models with forecasting marked &mdash; have a documented
    reason, shown in the app.
  </p>

  <h2>Documentation</h2>
  <ul>
    <li><a href="https://github.com/Russlewisbo/Dosingapp/blob/main/README.md">README</a>
        &mdash; the models, what each one omits and why, the URL parameters,
        and the validation approach</li>
    <li><a href="https://github.com/Russlewisbo/Dosingapp/blob/main/SETUP.md">SETUP</a>
        &mdash; running it locally, from a single file up to a full Quarto deck</li>
    <li><a href="https://github.com/Russlewisbo/Dosingapp/blob/main/SLIDES.md">SLIDES</a>
        &mdash; embedding the widget in slides, with the reveal.js and remark
        syntax given separately</li>
    <li><a href="https://github.com/Russlewisbo/Dosingapp/blob/main/STATUS.md">STATUS</a>
        &mdash; current state, the validation table and known caveats</li>
  </ul>

  <footer>
    For teaching and exploratory PK/PD analysis. Not a medical device and not
    a substitute for clinical judgement or local dosing policy &mdash;
    individual dosing decisions require a qualified clinician with the full
    patient context.
  </footer>

</div>
</body>
</html>
"""

out = ROOT / "index.html"
out.write_text(HTML)
assert "{" not in re.sub(r"\{\{|\}\}", "", HTML.split("<style>")[0]), "unsubstituted field"
print(f"{out.name}  {out.stat().st_size:,} bytes  "
      f"({len(models)} models, {len(presets)} presets, {len(drugs)} drugs)")
