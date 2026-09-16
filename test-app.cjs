/* Headless smoke test for the built single-file app.
   jsdom has no canvas implementation, so getContext('2d') is stubbed with
   a recording mock. That lets the entire render path -- simulate, axes,
   bands, lines, legends, summary tables -- actually execute, which is what
   catches the runtime errors that would otherwise show up as a blank
   widget in a slide deck.
   Run: node test-app.cjs                                               */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = fs.readFileSync('mipd-lab.html', 'utf8');
let fails = 0;
function ok(name, cond, detail) {
  if (!cond) { fails++; console.log('FAIL  ' + name + (detail ? '  ' + detail : '')); }
  else console.log('pass  ' + name + (detail ? '  ' + detail : ''));
}

function ctxMock() {
  const rec = { ops: 0, fills: 0, strokes: 0, texts: [] };
  const noop = () => { rec.ops++; };
  return {
    _rec: rec,
    canvas: null,
    setTransform: noop, clearRect: noop, beginPath: noop, moveTo: noop,
    lineTo: noop, closePath: noop, arc: noop, save: noop, restore: noop,
    translate: noop, rotate: noop, setLineDash: noop, measureText: () => ({ width: 10 }),
    fill: () => { rec.fills++; }, stroke: () => { rec.strokes++; },
    fillText: (s) => { rec.texts.push(String(s)); },
    set font(v) {}, get font() { return ''; },
    set fillStyle(v) {}, get fillStyle() { return ''; },
    set strokeStyle(v) {}, get strokeStyle() { return ''; },
    set lineWidth(v) {}, get lineWidth() { return 1; },
    set textAlign(v) {}, get textAlign() { return ''; },
    set textBaseline(v) {}, get textBaseline() { return ''; },
    set lineJoin(v) {}, get lineJoin() { return ''; },
    set lineCap(v) {}, get lineCap() { return ''; }
  };
}

function boot(search) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'http://localhost/mipd-lab.html' + (search || ''),
    virtualConsole: vc,
    pretendToBeVisual: true
  });
  const w = dom.window;
  // Stub canvas + non-zero layout width (jsdom reports clientWidth 0).
  w.HTMLCanvasElement.prototype.getContext = function () {
    if (!this.__ctx) { this.__ctx = ctxMock(); this.__ctx.canvas = this; }
    return this.__ctx;
  };
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', {
    get() { return 560; }, configurable: true
  });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  return { w, d: w.document, errors };
}

/* ---- 1. Full app boots without error and renders ---- */
{
  const { w, d, errors } = boot('');
  ok('full mode: no script errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  ok('full mode: PKPD engine exposed', typeof w.PKPD === 'object');
  // Derived from the library rather than hardcoded, so adding a model
  // cannot make this assertion stale (it has twice).
  ok('full mode: model library loaded',
     w.PKPD_MODELS.MODELS.length === require('./models.js').MODELS.length &&
     w.PKPD_MODELS.MODELS.length > 0,
     `${w.PKPD_MODELS.MODELS.length} models`);
  const summary = d.getElementById('summary').textContent;
  ok('full mode: summary rendered with a PTA value', /%/.test(summary) && summary.length > 40);
  ok('full mode: PTA canvas was drawn',
     d.getElementById('cvPta').__ctx._rec.strokes > 5,
     `${d.getElementById('cvPta').__ctx._rec.strokes} strokes`);
  ok('full mode: concentration canvas was drawn',
     d.getElementById('cvConc').__ctx._rec.strokes > 5);
  ok('full mode: model citation shown',
     /doi/.test(d.getElementById('modelCite').innerHTML));
  // The omission list is now empty — every previously-blocked model was
  // implemented once its PDF was supplied. The mechanism must still be
  // present and must say so explicitly rather than rendering blank.
  ok('full mode: omissions panel states that none remain',
     /none/i.test(d.getElementById('pendingList').textContent),
     d.getElementById('pendingList').textContent.slice(0, 70));
  ok('full mode: sidebar visible', !d.body.classList.contains('widget'));
}

/* ---- 2. Widget mode ---- */
{
  const { d, errors } = boot('?mode=widget&model=pip_kim2022&dose=4000&tau=6&tinf=4&mic=16&target=ft100&n=200');
  ok('widget mode: no script errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  ok('widget mode: body flagged as widget', d.body.classList.contains('widget'));
  ok('widget mode: compact control strip present',
     d.getElementById('wDose').value === '4000' && d.getElementById('wTinf').value === '4');
  ok('widget mode: canvases drawn', d.getElementById('cvPta').__ctx._rec.strokes > 5);
  // In widget mode the TDM panel is suppressed by CSS: `.full-only` is
  // display:none under `body.widget`. jsdom does not apply the stylesheet
  // cascade here, so assert the two conditions that drive the rule rather
  // than asserting mere presence of the element.
  const tdm = d.getElementById('panelTdm');
  ok('widget mode: TDM panel carries the full-only class that hides it',
     tdm !== null && tdm.classList.contains('full-only') &&
     d.body.classList.contains('widget'),
     tdm ? 'classes: ' + tdm.className : 'element missing');
  ok('widget mode: stylesheet hides .full-only under body.widget',
     /body\.widget\s+\.full-only\s*\{\s*display:\s*none/.test(HTML));
}

/* ---- 3. URL preset selects the right model and target ---- */
{
  const { d, errors } = boot('?model=van_thomson2009&target=auc400&mic=1&n=200');
  ok('preset: vancomycin model selected',
     d.getElementById('model').value === 'van_thomson2009', errors.join('|'));
  ok('preset: AUC target selected', d.getElementById('target').value === 'auc400');
  ok('preset: vancomycin shows creatinine input, not cystatin C',
     !d.getElementById('scrBlock').classList.contains('hidden') &&
     d.getElementById('cyscBlock').classList.contains('hidden'));
  const s = d.getElementById('summary').textContent;
  ok('preset: AUC summary rendered', /AUC/.test(s));
}

/* ---- 4. Cystatin-C model swaps the covariate inputs ---- */
{
  const { d } = boot('?model=pip_kim2022&n=200');
  ok('Kim model shows cystatin C input, hides creatinine',
     d.getElementById('scrBlock').classList.contains('hidden') &&
     !d.getElementById('cyscBlock').classList.contains('hidden'));
  ok('Kim model exposes the ECMO covariate',
     !d.getElementById('ecmoBlock').classList.contains('hidden'));
  ok('Kim model warns about the cystatin-C requirement',
     /CYSTATIN C/i.test(d.getElementById('modelNote').textContent));
}

/* ---- 5. Model with Bayesian disabled hides the TDM panel ---- */
{
  const { d } = boot('?model=pip_udy2015&n=200');
  ok('Udy model: TDM panel hidden',
     d.getElementById('panelTdm').classList.contains('hidden'));
  ok('Udy model: reason for disabling stated',
     /residual-error/i.test(d.getElementById('modelNote').textContent));
}

/* ---- 6. Interaction: changing MIC re-renders and changes PTA ---- */
{
  const { w, d } = boot('?model=pip_kim2022&dose=4000&tau=6&tinf=0.5&target=ft100&mic=1&n=300');
  const before = d.getElementById('summary').textContent.match(/([\d.]+)%/)[1];
  const el = d.getElementById('mic');
  el.value = '64';
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  const after = d.getElementById('summary').textContent.match(/([\d.]+)%/)[1];
  ok('raising MIC lowers PTA', parseFloat(after) < parseFloat(before),
     `MIC 1 -> ${before}% ; MIC 64 -> ${after}%`);
}

/* ---- 7. Adding a second regimen renders a comparison ---- */
{
  const { w, d } = boot('?model=pip_kim2022&n=250');
  d.getElementById('addReg').dispatchEvent(new w.Event('click', { bubbles: true }));
  const rows = d.querySelectorAll('#summary tbody tr').length;
  ok('two regimens compared in the summary table', rows === 2, `${rows} rows`);
  ok('legend lists both regimens with breakpoints',
     (d.getElementById('legPta').textContent.match(/breakpoint/g) || []).length === 2);
}

/* ---- 8. Bayesian forecasting through the UI ---- */
{
  const { w, d, errors } = boot('?model=van_thomson2009&target=auc400&mic=1&n=200');
  d.getElementById('tdmDose').value = '1000';
  d.getElementById('tdmTau').value = '12';
  d.getElementById('tdmTinf').value = '1';
  d.getElementById('tdmN').value = '5';
  const setRow = (i, t, c) => {
    const ti = d.querySelector(`input[data-t="${i}"]`), ci = d.querySelector(`input[data-c="${i}"]`);
    ti.value = String(t); ti.dispatchEvent(new w.Event('input', { bubbles: true }));
    ci.value = String(c); ci.dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  setRow(0, 50, 22.0);
  d.getElementById('addTdm').dispatchEvent(new w.Event('click', { bubbles: true }));
  setRow(1, 59.5, 14.0);
  d.getElementById('runMap').dispatchEvent(new w.Event('click', { bubbles: true }));
  const out = d.getElementById('mapOut').textContent;
  ok('MAP run produced output', out.length > 80, errors.slice(0, 1).join(''));
  ok('MAP output reports individual parameters', /CL/.test(out) && /MAP/.test(out));
  ok('MAP output reports a dose recommendation or a stated failure',
     /Smallest dose meeting|No dose up to/.test(out));
  ok('MAP overlay drawn on concentration plot',
     d.getElementById('cvConc').__ctx._rec.strokes > 10);
}

/* ---- 9. Embed URL builder ---- */
{
  const { w, d } = boot('?model=pip_kim2022&dose=4000&tau=6&tinf=4&mic=16&n=200');
  d.getElementById('mkEmbed').dispatchEvent(new w.Event('click', { bubbles: true }));
  const v = d.getElementById('embedOut').value;
  ok('embed builder emits an iframe snippet', /^<iframe src="mipd-lab\.html\?mode=widget/.test(v), v.slice(0, 70));
  ok('embed URL carries model, regimen, target and MIC',
     /model=pip_kim2022/.test(v) && /dose=4000/.test(v) &&
     /tinf=4/.test(v) && /mic=16/.test(v));
  ok('embed URL carries the seed so the figure is reproducible', /seed=/.test(v));
}

/* ---- 10. Widget panel selection ---- */
{
  const { d } = boot('?mode=widget&panel=pta&summary=0&controls=0&n=200');
  const kids = d.getElementById('panelPta').querySelectorAll('.grid2 > div');
  ok('panel=pta hides the concentration panel', kids[1].style.display === 'none');
  ok('summary=0 hides the summary card',
     d.getElementById('panelSummary').classList.contains('hidden'));
  ok('controls=0 hides the control strip',
     d.getElementById('wstripCard').classList.contains('hidden'));
}

/* ---- 11. Meropenem models expose the right covariate controls ---- */
{
  // Shekar: RRT checkbox, creatinine (Cockcroft-Gault), no dialysis select.
  const { d, errors } = boot('?model=mem_shekar2014&mic=2&target=ft100&n=200');
  ok('Shekar: boots clean', errors.length === 0, errors.slice(0, 1).join());
  ok('Shekar: RRT checkbox shown',
     !d.getElementById('rrtBlock').classList.contains('hidden'));
  ok('Shekar: dialysis-modality select hidden',
     d.getElementById('dialysisBlock').classList.contains('hidden'));
  ok('Shekar: creatinine input shown (Cockcroft-Gault model)',
     !d.getElementById('scrBlock').classList.contains('hidden'));
  ok('Shekar: renal readout labelled Cockcroft-Gault',
     /Cockcroft-Gault/.test(d.getElementById('renalOut').textContent),
     d.getElementById('renalOut').textContent.slice(0, 80));
  ok('Shekar: Table 3 discrepancy disclosed in the model note',
     /internally inconsistent/i.test(d.getElementById('modelNote').textContent));
}
{
  // O'Jeanson: dialysis modality + residual diuresis, MDRD label, 1-cmt.
  const { w, d, errors } = boot('?model=mem_ojeanson2021&mic=2&target=ft100&n=200');
  ok("O'Jeanson: boots clean", errors.length === 0, errors.slice(0, 1).join());
  ok("O'Jeanson: dialysis select and residual diuresis shown",
     !d.getElementById('dialysisBlock').classList.contains('hidden') &&
     !d.getElementById('rdBlock').classList.contains('hidden'));
  ok("O'Jeanson: RRT checkbox hidden (modality is a select here)",
     d.getElementById('rrtBlock').classList.contains('hidden'));
  ok("O'Jeanson: renal readout labelled MDRD",
     /MDRD/.test(d.getElementById('renalOut').textContent),
     d.getElementById('renalOut').textContent.slice(0, 90));
  // Switching modality must change the reported typical clearance.
  const clOf = () => {
    const m2 = /Typical CL<\/span><span>([\d.]+)/.exec(d.getElementById('renalOut').innerHTML);
    return m2 ? parseFloat(m2[1]) : NaN;
  };
  const before = clOf();
  const sel = d.getElementById('dialysis');
  sel.value = 'semicont';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  const after = clOf();
  ok("O'Jeanson: selecting intermittent dialysis changes typical CL to 11.0 L/h",
     Math.abs(after - 11.0) < 0.05 && after !== before,
     `CL ${before} -> ${after} L/h`);
}
{
  // Gijsen: CKD-EPI creatinine label, no dialysis/RRT/ECMO controls.
  const { d } = boot('?model=mem_gijsen2021&mic=2&target=ft100&n=200');
  ok('Gijsen: renal readout labelled CKD-EPI creatinine',
     /CKD-EPI creatinine/.test(d.getElementById('renalOut').textContent),
     d.getElementById('renalOut').textContent.slice(0, 90));
  ok('Gijsen: no ECMO control (ECMO was not a significant covariate)',
     d.getElementById('ecmoBlock').classList.contains('hidden'));
  ok('Gijsen: correlated variability disclosed in the note',
     /correlation/i.test(d.getElementById('modelNote').textContent));
}
{
  // Every model once listed as unavailable is now implemented from its
  // own parameter table, so each must be selectable and must carry a
  // source citation — the previous disclosure is replaced by the model.
  const { d } = boot('?n=200');
  // The model dropdown is filtered by the selected drug, so each model is
  // checked by booting directly into it and confirming it is the one that
  // loaded (an unknown id would silently fall back to the default).
  ['mem_li2006', 'mem_ehmann2019', 'pip_klastrup2020', 'cef_nicasio2009']
    .forEach(id => {
      const b = boot('?model=' + id + '&n=150');
      const sel = b.d.getElementById('model').value;
      ok('previously-unavailable model now implemented: ' + id,
         sel === id && b.errors.length === 0,
         `selected ${sel}${b.errors.length ? ' | ' + b.errors[0] : ''}`);
    });
  const drugs = Array.from(d.getElementById('drug').options).map(o => o.value);
  ok('cefepime is now offered as a drug', drugs.indexOf('Cefepime') >= 0, drugs.join(','));
  const M = require('./models.js').MODELS;
  ok('every model cites a specific table or figure in its source',
     M.every(m => /Table|Fig|equation/i.test(m.source)),
     M.filter(m => !/Table|Fig|equation/i.test(m.source)).map(m => m.id).join(',') || 'all cite');
  // Every drug must be reachable from the drug selector, and every model
  // from its drug — the property that matters, rather than a fixed count.
  const drugList = Array.from(new Set(M.map(m => m.drug)));
  ok('more than one drug class is represented', drugList.length >= 4, drugList.join(', '));
  ok('every aminoglycoside model offers a peak and a trough-ceiling target',
     M.filter(m => ['Gentamicin', 'Amikacin', 'Tobramycin'].indexOf(m.drug) >= 0)
      .every(m => m.targets.some(t => t.type === 'cmaxmic' || (t.all || []).some(x => x.type === 'cmaxmic')) &&
                  m.targets.some(t => t.type === 'cminceil' || (t.all || []).some(x => x.type === 'cminceil'))),
     M.filter(m => ['Gentamicin', 'Amikacin', 'Tobramycin'].indexOf(m.drug) >= 0)
      .map(m => m.id + ':' + m.targets.length).join(' '));
}
{
  // A meropenem target ladder is available and RRT lowers attainment.
  const { w, d } = boot('?model=mem_shekar2014&mic=2&target=ft100&dose=1000&tau=8&tinf=0.5&n=600');
  const pta0 = parseFloat(d.getElementById('summary').textContent.match(/([\d.]+)%/)[1]);
  const rr = d.getElementById('rrt');
  rr.checked = true;
  rr.dispatchEvent(new w.Event('change', { bubbles: true }));
  const pta1 = parseFloat(d.getElementById('summary').textContent.match(/([\d.]+)%/)[1]);
  ok('Shekar: switching RRT on raises attainment (clearance falls to 5.1 L/h)',
     pta1 > pta0, `off RRT ${pta0}% -> on RRT ${pta1}%`);
  // Match option VALUES, not labels: the ">" in "fT>MIC" is emitted as
  // the &gt; entity, so a literal label regex would never match.
  const tvals = Array.from(d.getElementById('target').options).map(o => o.value);
  ok('meropenem target ladder offers 40/50/100% fT>MIC and 100% fT>4xMIC',
     ['ft40', 'ft50', 'ft100', 'ft100x4'].every(t => tvals.indexOf(t) >= 0),
     tvals.join(','));
}

/* ---- 12. REGRESSION: the header must follow the selected model.
   Previously the title and subtitle were written once at start-up, so
   selecting a meropenem model left the page headed "Piperacillin —
   target attainment" while the plots below it were correct. ---- */
{
  const { w, d } = boot('?model=pip_kim2022&n=200');
  ok('header starts on the selected drug',
     /Piperacillin/.test(d.getElementById('title').textContent),
     d.getElementById('title').textContent);

  // Switch the drug select to Meropenem, as a user would.
  const dsel = d.getElementById('drug');
  dsel.value = 'Meropenem';
  dsel.dispatchEvent(new w.Event('change', { bubbles: true }));

  const title = d.getElementById('title').textContent;
  const sub = d.getElementById('subtitle').textContent;
  ok('header follows a drug change', /Meropenem/.test(title) && !/Piperacillin/.test(title), title);
  ok('subtitle no longer names the previous model',
     !/Kim 2022/.test(sub), sub.slice(0, 90));
  ok('subtitle names the model actually selected',
     new RegExp(d.getElementById('model').selectedOptions[0].textContent.split(' \u2014 ')[0]).test(sub),
     sub.slice(0, 90));

  // And back again, to prove it is not a one-way latch.
  dsel.value = 'Vancomycin';
  dsel.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok('header follows a second drug change',
     /Vancomycin/.test(d.getElementById('title').textContent),
     d.getElementById('title').textContent);
}

/* ---- 13. Dosing-course controls ---- */
{
  const { w, d } = boot('?model=mem_gijsen2021&mic=2&target=ft100&dose=1000&tau=8&tinf=0.5&n=300');
  ok('subtitle states which dose of how many was evaluated',
     /dose \d+ of \d+/.test(d.getElementById('subtitle').textContent),
     d.getElementById('subtitle').textContent.slice(-45));
  ok('course note reports the evaluated window and steady-state status',
     /Target evaluated over dose/.test(d.getElementById('courseNote').textContent) &&
     /steady state/.test(d.getElementById('courseNote').textContent),
     d.getElementById('courseNote').textContent.slice(0, 110));

  const pta0 = parseFloat(d.getElementById('summary').textContent.match(/([\d.]+)%/)[1]);

  // Evaluate the first dose instead: attainment must not increase.
  const ev = d.getElementById('evalDoseIn');
  ev.value = '1';
  ev.dispatchEvent(new w.Event('input', { bubbles: true }));
  const pta1 = parseFloat(d.getElementById('summary').textContent.match(/([\d.]+)%/)[1]);
  ok('evaluating dose 1 lowers (or equals) attainment vs steady state', pta1 <= pta0,
     `steady state ${pta0}% -> dose 1 ${pta1}%`);
  ok('course note flags the pre-steady-state evaluation',
     /NOT yet steady state/.test(d.getElementById('courseNote').textContent),
     d.getElementById('courseNote').textContent.slice(0, 100));

  // Limiting the doses given must be reflected in the subtitle.
  ev.value = '';
  ev.dispatchEvent(new w.Event('input', { bubbles: true }));
  const nd = d.getElementById('nDosesIn');
  nd.value = '2';
  nd.dispatchEvent(new w.Event('input', { bubbles: true }));
  ok('setting doses given to 2 is reflected in the header',
     /dose 2 of 2/.test(d.getElementById('subtitle').textContent),
     d.getElementById('subtitle').textContent.slice(-40));
}

/* ---- 14. Whole-course view ---- */
{
  const { w, d } = boot('?model=mem_gijsen2021&mic=2&target=ft100&dose=1000&tau=8&tinf=0.5&n=250');
  // This mock records fillText as plain strings and never clears between
  // renders, so the recorder is reset before each toggle to read only the
  // labels the NEXT render emits.
  const rec = d.getElementById('cvConc').__ctx._rec;
  const freshText = (act) => { rec.texts.length = 0; act(); return rec.texts.join('|'); };

  ok('single-interval view labels the axis as one interval',
     /dosing interval/.test(freshText(() => {
       const m = d.getElementById('mic'); m.value = '2';
       m.dispatchEvent(new w.Event('input', { bubbles: true }));
     })), rec.texts.filter(s => /Time/.test(s)).join());

  const pw = d.getElementById('plotWhole');
  const after = freshText(() => {
    pw.checked = true;
    pw.dispatchEvent(new w.Event('change', { bubbles: true }));
  });
  ok('whole-course view relabels the time axis',
     /Time since first dose/.test(after), '');
  ok('whole-course view marks the evaluated interval',
     /evaluated/.test(after), '');
  ok('the widget view selector stays in sync with the checkbox',
     d.getElementById('wWhole').value === '1');

  // Metrics must be unchanged by a display-only toggle.
  const ptaWhole = parseFloat(d.getElementById('summary').textContent.match(/([\d.]+)%/)[1]);
  pw.checked = false;
  pw.dispatchEvent(new w.Event('change', { bubbles: true }));
  const ptaOne = parseFloat(d.getElementById('summary').textContent.match(/([\d.]+)%/)[1]);
  ok('switching the plot window does not change the reported PTA',
     ptaWhole === ptaOne, `${ptaWhole}% vs ${ptaOne}%`);
}

/* ---- 15. Course settings survive into an embed URL ---- */
{
  const { w, d } = boot('?model=mem_gijsen2021&ndoses=4&evaldose=2&whole=1&n=200');
  ok('URL params ndoses/evaldose are applied',
     /dose 2 of 4/.test(d.getElementById('subtitle').textContent),
     d.getElementById('subtitle').textContent.slice(-40));
  ok('whole=1 is applied from the URL', d.getElementById('plotWhole').checked);
  d.getElementById('mkEmbed').dispatchEvent(new w.Event('click', { bubbles: true }));
  const v = d.getElementById('embedOut').value;
  ok('embed URL round-trips the course settings',
     /ndoses=4/.test(v) && /evaldose=2/.test(v) && /whole=1/.test(v),
     v.slice(0, 120));
}

/* ---- 16. REGRESSION: the MAP individual forecast must be inside the
   y-axis and on the plot's time base.
   Previously the overlay was excluded from the y-scale (an individual
   whose peaks exceeded the population band was clipped at the top of the
   axis) and was precomputed on a fixed 0-to-tau axis, so in whole-course
   view it was compressed into the first dosing interval. ---- */
{
  const { w, d } = boot('?model=van_thomson2009&target=auc400&mic=1' +
                        '&dose=1000&tau=12&tinf=1&n=200');

  // Fit an individual with deliberately high concentrations, which is
  // what pushes the overlay above the population band.
  d.getElementById('tdmDose').value = '1000';
  d.getElementById('tdmTau').value = '12';
  d.getElementById('tdmTinf').value = '1';
  d.getElementById('tdmN').value = '4';
  // The TDM table starts with a single blank row; a second is needed to
  // make the two-sample fit identifiable.
  d.getElementById('addTdm').dispatchEvent(new w.Event('click', { bubbles: true }));
  const setRow = (i, t, c) => {
    const inp = d.querySelectorAll('#tdmRows tr')[i].querySelectorAll('input');
    inp[0].value = String(t); inp[0].dispatchEvent(new w.Event('input', { bubbles: true }));
    inp[1].value = String(c); inp[1].dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  setRow(0, 25, 55);   // very high peak -> low-clearance individual
  setRow(1, 35, 34);
  d.getElementById('runMap').dispatchEvent(new w.Event('click', { bubbles: true }));

  const mapOut = d.getElementById('mapOut').textContent;
  ok('MAP estimation produced a result', mapOut.length > 0 && /CL/.test(mapOut),
     mapOut.slice(0, 60).replace(/\s+/g, ' '));

  ok('individual forecast is labelled in the legend',
     /MAP individual forecast/.test(d.getElementById('legConc').textContent),
     d.getElementById('legConc').textContent.slice(0, 90));

  // Switching to the whole-course view must not drop the overlay; its
  // geometry (staying inside the axes) is checked in test-layout.cjs,
  // whose canvas mock records coordinates.
  const pw = d.getElementById('plotWhole');
  pw.checked = true;
  pw.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok('individual forecast survives a switch to the whole-course view',
     /MAP individual forecast/.test(d.getElementById('legConc').textContent));
}

/* ---- 17. Every covariate a model actually uses must be reachable.
   The real failure mode is a model that uses a covariate its `covariates`
   list forgot to declare: the input stays hidden, and the user cannot
   change a value that is silently affecting their results. This boots
   each model and checks that anything with a visible effect has a
   visible input. ---- */
{
  const MODELS = require('./models.js').MODELS;
  // Inputs that live in a block the model can hide.
  const GATED = { cysc: 'cyscBlock', alb: 'albBlock', rd: 'rdBlock',
                  ecmo: 'ecmoBlock', rrt: 'rrtBlock', dialysis: 'dialysisBlock',
                  scr: 'scrBlock' };
  MODELS.forEach(m => {
    const { d, errors } = boot('?model=' + m.id + '&n=120');
    const summary = d.getElementById('covEffects').textContent;
    ok(m.id + ': covariate effects are stated', /Covariates in this model/.test(summary) &&
       errors.length === 0, summary.slice(0, 60));

    // Parse the rendered effects back out and confirm each is settable.
    const unreachable = Object.keys(GATED).filter(k => {
      const el = d.getElementById(k);
      if (!el) return false;
      const usesIt = !el.classList.contains('inert');
      if (!usesIt) return false;
      const blk = d.getElementById(GATED[k]);
      return blk && blk.classList.contains('hidden');
    });
    ok(m.id + ': no covariate it uses is hidden from the form',
       unreachable.length === 0, unreachable.join(','));
  });
}

/* ---- 18. Covariate annotations distinguish real effects from inert
   inputs, and follow the model rather than being fixed. ---- */
{
  const a = boot('?model=mem_ehmann2019&n=120').d;
  ok('Ehmann: albumin is shown and marked as acting on V2',
     !a.getElementById('albBlock').classList.contains('hidden') &&
     !a.getElementById('alb').classList.contains('inert') &&
     /Albumin/.test(a.getElementById('covEffects').textContent),
     a.getElementById('covEffects').textContent.slice(0, 110));

  const b = boot('?model=mem_li2006&n=120').d;
  ok('Li: albumin input is hidden (the model does not use it)',
     b.getElementById('albBlock').classList.contains('hidden'));

  // Weight acts on volumes for Li but only through CLcr for Shekar —
  // the annotation must tell those apart.
  const liEff = b.getElementById('covEffects').textContent;
  const shEff = boot('?model=mem_shekar2014&n=120').d
                  .getElementById('covEffects').textContent;
  ok('weight is reported as moving a volume for Li but not for Shekar',
     /Weight → CL\/V/.test(liEff) && /Weight → CL ·/.test(shEff),
     `Li: ${(liEff.match(/Weight[^·]*/) || [''])[0].trim()} | ` +
     `Shekar: ${(shEff.match(/Weight[^·]*/) || [''])[0].trim()}`);

  const o = boot('?model=mem_ojeanson2021&n=120').d;
  ok('O\u2019Jeanson: RRT modality and residual diuresis are both offered',
     !o.getElementById('dialysisBlock').classList.contains('hidden') &&
     !o.getElementById('rdBlock').classList.contains('hidden'));

  /* Modality decides whether the other renal inputs do anything:
     semi-continuous (intermittent) dialysis fixes clearance at 11.0 L/h
     independently of GFR and residual diuresis, whereas continuous
     dialysis keeps the diuresis term. The annotation must track that,
     and this asserts the direction so a swapped branch would fail. */
  const semi = boot('?model=mem_ojeanson2021&dialysis=semicont&n=120').d;
  ok('semi-continuous dialysis: residual diuresis correctly reports no effect',
     semi.getElementById('rd').classList.contains('inert'),
     semi.getElementById('covEffects').textContent.slice(0, 90));
  ok('semi-continuous dialysis: creatinine also reports no effect',
     semi.getElementById('scr').classList.contains('inert'));

  const cont = boot('?model=mem_ojeanson2021&dialysis=cont&n=120').d;
  ok('continuous dialysis: residual diuresis DOES act on clearance',
     !cont.getElementById('rd').classList.contains('inert') &&
     /Residual diuresis/.test(cont.getElementById('covEffects').textContent),
     cont.getElementById('covEffects').textContent.slice(0, 90));

  // And the underlying model must agree with what the UI reports.
  const oj = require('./models.js').MODELS.find(x => x.id === 'mem_ojeanson2021');
  const base = { egfr: 49, dialysis: 'semicont', rd: 845 };
  ok('model: semi-continuous clearance is flat at 11.0 L/h',
     oj.params(base).CL === 11.0 &&
     oj.params({ ...base, rd: 2000 }).CL === 11.0 &&
     oj.params({ ...base, egfr: 120 }).CL === 11.0);
  ok('model: continuous clearance moves with residual diuresis',
     oj.params({ egfr: 49, dialysis: 'cont', rd: 2000 }).CL >
     oj.params({ egfr: 49, dialysis: 'cont', rd: 845 }).CL);
}

/* ---- 19. Bayesian forecasting can be switched off and on. ---- */
{
  const { w, d } = boot('?model=van_thomson2009&target=auc400&mic=1&n=150');
  ok('forecasting is enabled by default', d.getElementById('bayesOn').checked);
  ok('the TDM body is active when enabled',
     !d.getElementById('tdmBody').classList.contains('off'));

  // Fit an individual, then switch forecasting off.
  d.getElementById('addTdm').dispatchEvent(new w.Event('click', { bubbles: true }));
  const setRow = (i, t, c) => {
    const inp = d.querySelectorAll('#tdmRows tr')[i].querySelectorAll('input');
    inp[0].value = String(t); inp[0].dispatchEvent(new w.Event('input', { bubbles: true }));
    inp[1].value = String(c); inp[1].dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  setRow(0, 25, 42); setRow(1, 35, 26);
  d.getElementById('runMap').dispatchEvent(new w.Event('click', { bubbles: true }));
  ok('overlay is present after a fit',
     /MAP individual forecast/.test(d.getElementById('legConc').textContent));

  const bt = d.getElementById('bayesOn');
  bt.checked = false;
  bt.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok('switching off removes the overlay from the plot',
     !/MAP individual forecast/.test(d.getElementById('legConc').textContent));
  ok('switching off disables the TDM body',
     d.getElementById('tdmBody').classList.contains('off'));
  ok('switching off is stated in the panel',
     /population prediction only/.test(d.getElementById('bayesState').textContent),
     d.getElementById('bayesState').textContent);

  // Switching back on restores the SAME fit rather than discarding it.
  bt.checked = true;
  bt.dispatchEvent(new w.Event('change', { bubbles: true }));
  ok('switching back on restores the overlay without refitting',
     /MAP individual forecast/.test(d.getElementById('legConc').textContent));

  // URL round-trip.
  const off = boot('?model=van_thomson2009&target=auc400&bayes=0&n=120').d;
  ok('bayes=0 is honoured from the URL', !off.getElementById('bayesOn').checked);
  const mk = off.getElementById('mkEmbed');
  mk.dispatchEvent(new w.Event('click', { bubbles: true }));
  ok('embed URL carries bayes=0', /bayes=0/.test(off.getElementById('embedOut').value));
}

/* ---- 20. The toggle is disabled where the MODEL cannot support
   forecasting, so it cannot promise something unavailable. ---- */
{
  ['pip_udy2015', 'cef_nicasio2009'].forEach(id => {
    const d = boot('?model=' + id + '&n=120').d;
    ok(id + ': forecasting toggle is disabled', d.getElementById('bayesOn').disabled);
    ok(id + ': the panel says it is unavailable',
       /unavailable for this model/.test(d.getElementById('bayesState').textContent));
  });
}

/* ---- Aminoglycoside modules: covariate forms, presets, peak column ---- */
{
  const M = require('./models.js').MODELS;

  // Romano's categorical ICU covariates must be OFFERED, and only by it.
  {
    const { d } = boot('?model=amk_romano1998&n=200');
    ok('Romano exposes the trauma and sepsis inputs',
       !d.getElementById('traumaBlock').classList.contains('hidden') &&
       !d.getElementById('sepsisBlock').classList.contains('hidden'));
    ok('Romano shows the Jelliffe renal label, not Cockcroft-Gault',
       /Jelliffe/.test(d.getElementById('renalOut').textContent),
       d.getElementById('renalOut').textContent.trim().slice(0, 48));
    const eff = d.getElementById('covEffects').textContent;
    ok('trauma is annotated as acting on clearance and sepsis on volume',
       /Trauma\s*→\s*CL/.test(eff) && /Sepsis\s*→\s*V/.test(eff), eff.slice(0, 190));
  }
  {
    const { d } = boot('?model=gen_xuan2004&n=200');
    ok('the gentamicin model hides trauma and sepsis',
       d.getElementById('traumaBlock').classList.contains('hidden') &&
       d.getElementById('sepsisBlock').classList.contains('hidden'));
  }

  // Hennig: height is load-bearing (fat-free mass), and the displayed
  // creatinine clearance must be marked as not driving the model.
  {
    const { d } = boot('?model=tob_hennig2013&n=200');
    const ro = d.getElementById('renalOut').textContent;
    ok('Hennig reports the derived fat-free mass', /Fat-free mass/.test(ro), ro.slice(0, 120));
    ok('Hennig marks its creatinine clearance as orientation only',
       /orientation only/.test(ro));
    const eff = d.getElementById('covEffects').textContent;
    ok('height is detected as acting on every parameter via fat-free mass',
       /Height\s*→\s*CL/.test(eff), eff.slice(0, 190));
    // REGRESSION: the annotation used to claim renal function was
    // "computed with Cockcroft-Gault", contradicting the display-only
    // note immediately below it.
    ok('the annotation does not claim Cockcroft-Gault drives this model',
       /does not take a creatinine clearance as input/.test(eff) &&
       !/Renal function is computed with/.test(eff), eff.slice(-170));
  }

  // The clinical 1-h peak column.
  {
    const { d } = boot('?model=gen_xuan2004&dose=420&tau=24&tinf=1&mic=1&n=400');
    const tbl = d.getElementById('summary').textContent;
    ok('the summary carries a 1-h peak column', /1-h peak/.test(tbl));
    ok('and explains that it differs from the end-of-infusion Cmax',
       /one hour after the end of the infusion/.test(tbl));
  }

  // Composite targets must report their components.
  {
    const { d } = boot('?model=gen_xuan2004&target=od2&dose=420&tau=24&tinf=1&mic=1&n=600');
    const tbl = d.getElementById('summary').textContent;
    ok('a joint target reports each component separately',
       /Joint target, by component/.test(tbl) && /both together/.test(tbl));
  }

  // ?preset= must actually load every preset in the library.
  M.length && require('./models.js').PRESETS.forEach(p => {
    const { d, errors } = boot('?preset=' + p.id + '&n=200');
    ok(`preset ${p.id} loads its model without error`,
       d.getElementById('model').value === p.model && errors.length === 0,
       `${d.getElementById('model').value}${errors.length ? ' | ' + errors[0] : ''}`);
  });

  // A preset is a starting point: explicit parameters still win.
  {
    const { d } = boot('?preset=gen-od&mic=4&n=200');
    ok('an explicit URL parameter overrides the preset value',
       /at MIC 4/.test(d.getElementById('summary').textContent));
  }

  // The teaching claim, asserted through the UI rather than the engine:
  // divided dosing must fail on the PEAK component.
  {
    const { d } = boot('?preset=gen-od&n=2000');
    const txt = d.getElementById('summary').textContent.replace(/\s+/g, ' ');
    const blocks = txt.match(/(\d+) mg q(\d+)h[^—]*— [^%]*?([\d.]+)%, [^%]*?([\d.]+)%/g) || [];
    ok('the once-daily preset compares three regimens', blocks.length === 3,
       `${blocks.length} regimen blocks`);
    const peaks = [...txt.matchAll(/MIC ≥ 10: ([\d.]+)%/g)].map(m => parseFloat(m[1]));
    ok('peak attainment falls as the dosing interval shortens',
       peaks.length === 3 && peaks[0] > peaks[1] && peaks[1] > peaks[2],
       peaks.join(' > '));
  }
}

/* ---- Documentation consistency.
   Added because a previous edit left README.md claiming four models were
   unimplemented in a section directly above a paragraph saying they had
   been added. Document-wide claims go stale silently; these assert them
   against the code rather than against a reader's memory. ---- */
{
  const fs = require('fs');
  const MM = require('./models.js');
  const docs = fs.readFileSync('README.md', 'utf8') + fs.readFileSync('STATUS.md', 'utf8');
  // "Udy 2015", "Romano 1998" — first two words of the label.
  const cite = m => m.label.split(' ').slice(0, 2).join(' ');

  ok('every model in the library appears in the documentation',
     MM.MODELS.every(m => docs.includes(cite(m))),
     MM.MODELS.filter(m => !docs.includes(cite(m))).map(m => m.id).join(',') || 'all present');
  ok('every preset appears in the documentation',
     MM.PRESETS.every(p => docs.includes(p.id)),
     MM.PRESETS.filter(p => !docs.includes(p.id)).map(p => p.id).join(',') || 'all present');
  ok('every model with forecasting disabled is documented as such',
     MM.MODELS.filter(m => !m.bayesian)
       .every(m => new RegExp(cite(m) + '\\s*\u2014 Bayesian forecasting only').test(docs)),
     MM.MODELS.filter(m => !m.bayesian)
       .filter(m => !new RegExp(cite(m) + '\\s*\u2014 Bayesian forecasting only').test(docs))
       .map(m => m.id).join(',') || 'all documented');
  ok('every model with forecasting disabled states a reason in the app',
     MM.MODELS.filter(m => !m.bayesian).every(m => (m.bayesianNote || '').length > 80),
     MM.MODELS.filter(m => !m.bayesian).map(m => m.id + ':' + (m.bayesianNote || '').length).join(' '));
  ok('no stale model or drug count survives in the documentation',
     !/\b10 models\b/.test(docs) && !/\bfour drugs\b/.test(docs),
     (docs.match(/\b\d+ models across \d+ drugs\b/) || ['none'])[0]);
  ok('the documented model and drug counts match the library',
     docs.includes(`${MM.MODELS.length} models across ` +
                   `${new Set(MM.MODELS.map(m => m.drug)).size} drugs`),
     `${MM.MODELS.length} models / ${new Set(MM.MODELS.map(m => m.drug)).size} drugs`);
}

/* ---- The GitHub Pages landing page is GENERATED from models.js, so it
   cannot be hand-edited into staleness — but it can be left unbuilt after
   a library change. These assert the shipped index.html matches the
   library it advertises. ---- */
{
  const fs = require('fs');
  const MM = require('./models.js');
  const idx = fs.readFileSync('index.html', 'utf8');

  ok('index.html links every preset in the library',
     MM.PRESETS.every(p => idx.includes(`?preset=${p.id}"`)),
     MM.PRESETS.filter(p => !idx.includes(`?preset=${p.id}"`)).map(p => p.id).join(',') || 'all linked');
  ok('index.html lists every model in the library',
     MM.MODELS.every(m => idx.includes(m.label.split('\u2014')[0].trim())),
     MM.MODELS.filter(m => !idx.includes(m.label.split('\u2014')[0].trim()))
              .map(m => m.id).join(',') || 'all listed');
  ok('index.html states the current model and drug counts',
     idx.includes(`${MM.MODELS.length} published population PK models`) &&
     idx.includes(`${new Set(MM.MODELS.map(m => m.drug)).size} drugs`),
     `${MM.MODELS.length} models / ${new Set(MM.MODELS.map(m => m.drug)).size} drugs`);
  ok('index.html has no host-rooted links, so it works under a project subpath',
     !/(?:href|src)="\/[^/]/.test(idx),
     (idx.match(/(?:href|src)="\/[^/"]*/g) || ['none']).join(' '));
  ok('the only local file index.html depends on is the app itself',
     Array.from(new Set([...idx.matchAll(/(?:href|src)="((?!https?:|#)[^"?]+)/g)]
       .map(m => m[1]))).join(',') === 'mipd-lab.html',
     Array.from(new Set([...idx.matchAll(/(?:href|src)="((?!https?:|#)[^"?]+)/g)].map(m => m[1]))).join(','));
  ok('index.html carries the not-a-medical-device statement',
     /[Nn]ot a medical device/.test(idx));

  // SETUP.md announces how many levels it has; that sentence has already
  // gone stale once, so it is checked against the headings themselves.
  const setup = fs.readFileSync('SETUP.md', 'utf8');
  const levels = (setup.match(/^## \d+\. /gm) || []).length;
  const words = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six' };
  ok('SETUP.md states the number of levels it actually documents',
     setup.includes(`${words[levels]} levels`),
     `${levels} numbered sections; header says ` +
     ((setup.match(/^(\w+) levels/m) || ['?'])[0]));
}

console.log(fails === 0 ? '\nALL APP TESTS PASSED' : `\n${fails} APP TEST(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
