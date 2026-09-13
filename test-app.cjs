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
  ok('full mode: model library loaded',
     w.PKPD_MODELS.MODELS.length === 6,
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
  ok('full mode: not-implemented models disclosed',
     /Nicasio/.test(d.getElementById('pendingList').textContent) &&
     /Klastrup/.test(d.getElementById('pendingList').textContent));
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
  // Both unavailable meropenem models must be disclosed, not silently absent.
  const { d } = boot('?n=200');
  const pend = d.getElementById('pendingList').textContent;
  ok('Li 2006 disclosed as requested-but-unavailable', /Li 2006/.test(pend));
  ok('Ehmann 2019 disclosed as requested-but-unavailable', /Ehmann 2019/.test(pend));
  ok('omission reasons name the access barrier',
     /closed access/i.test(pend), pend.slice(0, 100));
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

console.log(fails === 0 ? '\nALL APP TESTS PASSED' : `\n${fails} APP TEST(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
