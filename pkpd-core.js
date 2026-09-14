/* =====================================================================
   pkpd-core.js — population PK/PD engine for model-informed precision
   dosing (MIPD) teaching and target-attainment simulation.

   Pure ES5-compatible JavaScript, zero dependencies, no network access.
   Runs identically in a browser (full app or slide-embedded widget) and
   under node (unit tests).

   Contents
     1. RNG + normal deviates (seeded, reproducible)
     2. Renal function estimators (Cockcroft-Gault, CKD-EPI)
     3. Analytic 1- and 2-compartment IV infusion solutions
     4. Dosing-schedule builder + superposition
     5. Exposure metrics (%fT>MIC, AUC, Cmin, Cmax)
     6. Monte Carlo population simulation -> PTA / CFR
     7. Nelder-Mead + MAP Bayesian individualisation from TDM samples

   Concentration units: mg/L. Time units: hours. Dose units: mg.
   ===================================================================== */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------
     1. Seeded RNG.  mulberry32 + Box-Muller.  Seeding matters here:
     a teaching figure must be identical every time it is rendered.
     --------------------------------------------------------------- */
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normals(n, seed) {
    var u = rng(seed), out = new Float64Array(n), i = 0;
    while (i < n) {
      var a = u(), b = u();
      if (a < 1e-12) a = 1e-12;
      var r = Math.sqrt(-2 * Math.log(a)), th = 2 * Math.PI * b;
      out[i++] = r * Math.cos(th);
      if (i < n) out[i++] = r * Math.sin(th);
    }
    return out;
  }

  /* ---------------------------------------------------------------
     2. Renal function.  Serum creatinine accepted in mg/dL or umol/L.
     --------------------------------------------------------------- */
  var SCR_UMOL_PER_MGDL = 88.4;

  function scrToMgdl(scr, unit) {
    return unit === 'umol/L' ? scr / SCR_UMOL_PER_MGDL : scr;
  }

  // Cockcroft-Gault on total body weight (the form Thomson 2009 and
  // Udy 2015 used when those models were estimated).
  function cockcroftGault(o) {
    var scr = scrToMgdl(o.scr, o.scrUnit);
    if (!(scr > 0)) return NaN;
    var cl = ((140 - o.age) * o.wt) / (72 * scr);
    return o.sex === 'F' ? cl * 0.85 : cl;
  }

  // CKD-EPI 2021 creatinine equation (race-free), mL/min/1.73m^2.
  function ckdEpiCr(o) {
    var scr = scrToMgdl(o.scr, o.scrUnit);
    if (!(scr > 0)) return NaN;
    var f = o.sex === 'F',
        k = f ? 0.7 : 0.9,
        a = f ? -0.241 : -0.302,
        r = scr / k;
    return 142 * Math.pow(Math.min(r, 1), a) * Math.pow(Math.max(r, 1), -1.200) *
           Math.pow(0.9938, o.age) * (f ? 1.012 : 1);
  }

  // CKD-EPI 2012 cystatin C equation, mL/min/1.73m^2.  Required by the
  // Kim 2022 piperacillin model, whose CL covariate is cystatin-C eGFR.
  function ckdEpiCysC(o) {
    var cc = o.cysc;
    if (!(cc > 0)) return NaN;
    var r = cc / 0.8,
        e = r <= 1 ? -0.499 : -1.328;
    return 133 * Math.pow(r, e) * Math.pow(0.996, o.age) *
           (o.sex === 'F' ? 0.932 : 1);
  }

  // 4-variable MDRD study equation, mL/min/1.73m^2. Implemented WITHOUT
  // the historical race coefficient, matching current practice; the
  // original publication carried a 1.212 multiplier for Black patients,
  // so a value computed here is the non-Black form of the equation.
  // Required by the O'Jeanson 2021 meropenem model, whose clearance
  // covariate is specifically GFR_MDRD.
  function mdrd(o) {
    var scr = scrToMgdl(o.scr, o.scrUnit);
    if (!(scr > 0)) return NaN;
    return 175 * Math.pow(scr, -1.154) * Math.pow(o.age, -0.203) *
           (o.sex === 'F' ? 0.742 : 1);
  }

  function ibwDevine(o) {
    var inch = o.ht / 2.54 - 60;
    return (o.sex === 'F' ? 45.5 : 50) + 2.3 * Math.max(0, inch);
  }

  /* ---------------------------------------------------------------
     3. Analytic IV infusion solutions.

     Zero-order input of rate R0 (mg/h) for duration Tinf, linear
     elimination.  Returned function gives central-compartment
     concentration at time t measured from the START of that infusion.

     2-compartment: with k10=CL/V1, k12=Q/V1, k21=Q/V2 the unit-impulse
     response is (A*exp(-alpha t) + B*exp(-beta t))/V1 with
     A=(alpha-k21)/(alpha-beta), B=(k21-beta)/(alpha-beta), A+B=1.
     Convolving with a constant rate over [0,Tinf] gives the closed
     forms below.  Verified against RK4 integration of the ODE system
     in test-core.mjs.
     --------------------------------------------------------------- */
  function micro2(p) {
    var k10 = p.CL / p.V1, k12 = p.Q / p.V1, k21 = p.Q / p.V2,
        a1 = k10 + k12 + k21, a0 = k10 * k21,
        disc = Math.sqrt(Math.max(0, a1 * a1 - 4 * a0));
    return {
      k10: k10, k12: k12, k21: k21,
      alpha: (a1 + disc) / 2,
      beta: (a1 - disc) / 2
    };
  }

  // Response to ONE infusion, as a function of time since its start.
  function infusionResponse(p, ncmt, R0, Tinf) {
    if (ncmt === 1) {
      var k = p.CL / p.V1, base = R0 / (p.V1 * k);
      return function (t) {
        if (t <= 0) return 0;
        if (t <= Tinf) return base * (1 - Math.exp(-k * t));
        return base * (1 - Math.exp(-k * Tinf)) * Math.exp(-k * (t - Tinf));
      };
    }
    var m = micro2(p),
        al = m.alpha, be = m.beta, k21 = m.k21, d = al - be;
    // Guard the (numerically rare) near-degenerate root case.
    if (!(Math.abs(d) > 1e-12)) {
      return infusionResponse({ CL: p.CL, V1: p.V1 }, 1, R0, Tinf);
    }
    var cA = (al - k21) / (al * d) * (R0 / p.V1),
        cB = (k21 - be) / (be * d) * (R0 / p.V1);
    return function (t) {
      if (t <= 0) return 0;
      if (t <= Tinf) {
        return cA * (1 - Math.exp(-al * t)) + cB * (1 - Math.exp(-be * t));
      }
      var u = t - Tinf;
      return cA * (1 - Math.exp(-al * Tinf)) * Math.exp(-al * u) +
             cB * (1 - Math.exp(-be * Tinf)) * Math.exp(-be * u);
    };
  }

  /* ---------------------------------------------------------------
     4. Dosing schedules.

     A regimen is {dose (mg), tau (h), tinf (h), nDoses} for intermittent
     or extended infusion, or {mode:'ci', dose24 (mg/24h), ...} for
     continuous infusion.  Everything downstream consumes the resulting
     event list, so irregular real-world dosing records work too.
     --------------------------------------------------------------- */
  function buildSchedule(reg) {
    var ev = [], i;
    if (reg.mode === 'ci') {
      var hours = reg.duration || 24 * (reg.days || 3);
      // Optional loading dose in front of the continuous infusion.
      if (reg.loadingDose > 0) {
        var lt = reg.loadingTinf > 0 ? reg.loadingTinf : 0.5;
        ev.push({ t0: 0, tinf: lt, rate: reg.loadingDose / lt });
      }
      ev.push({ t0: 0, tinf: hours, rate: reg.dose24 / 24 });
      return { events: ev, tau: hours, tEnd: hours, ci: true };
    }
    var n = reg.nDoses || 1,
        tinf = Math.max(reg.tinf, 1e-6);
    for (i = 0; i < n; i++) {
      ev.push({ t0: i * reg.tau, tinf: tinf, rate: reg.dose / tinf });
    }
    return { events: ev, tau: reg.tau, tEnd: (n - 1) * reg.tau + reg.tau, ci: false };
  }

  // Number of doses needed to be at (practical) steady state, then a few
  // extra so the evaluation interval is genuinely the SS interval.
  function dosesToSteadyState(p, ncmt, tau) {
    var thalf;
    if (ncmt === 1) {
      thalf = Math.LN2 / (p.CL / p.V1);
    } else {
      thalf = Math.LN2 / micro2(p).beta;
    }
    if (!isFinite(thalf) || thalf <= 0) thalf = tau;
    return Math.max(3, Math.min(200, Math.ceil((5 * thalf) / tau) + 2));
  }

  function concFn(p, ncmt, sched) {
    var fns = sched.events.map(function (e) {
      return { t0: e.t0, f: infusionResponse(p, ncmt, e.rate, e.tinf) };
    });
    return function (t) {
      var c = 0;
      for (var i = 0; i < fns.length; i++) {
        if (t > fns[i].t0) c += fns[i].f(t - fns[i].t0);
      }
      return c;
    };
  }

  /* ---------------------------------------------------------------
     5. Exposure metrics over an evaluation window [tA, tB].
     --------------------------------------------------------------- */
  function metrics(cf, tA, tB, opts) {
    var nGrid = (opts && opts.nGrid) || 400,
        fu = (opts && opts.fu != null) ? opts.fu : 1,
        mic = (opts && opts.mic) || 0,
        h = (tB - tA) / nGrid,
        above = 0, auc = 0, cmin = Infinity, cmax = -Infinity,
        prev = null, i, t, c;
    for (i = 0; i <= nGrid; i++) {
      t = tA + i * h;
      c = cf(t);
      if (c < cmin) cmin = c;
      if (c > cmax) cmax = c;
      if (prev !== null) auc += 0.5 * (prev + c) * h;
      // Fraction of interval with free concentration above MIC: count
      // sub-interval midpoints rather than nodes (unbiased at the ends).
      if (prev !== null) {
        var mid = fu * 0.5 * (prev + c);
        if (mid > mic) above += 1;
      }
      prev = c;
    }
    var span = tB - tA;
    return {
      tAbove: (above / nGrid) * 100,          // % of interval, free drug
      auc: auc,                                // total-drug AUC over window
      auc24: auc * (24 / span),
      fauc24: auc * (24 / span) * fu,
      cmin: cmin, cmax: cmax,
      fcmin: cmin * fu, fcmax: cmax * fu,
      cavg: auc / span
    };
  }

  /* ---------------------------------------------------------------
     6. Model spec handling + Monte Carlo population simulation.

     A model spec is DATA (see models.js).  Required fields:
       ncmt, fu, params(cov) -> {CL,V1[,Q,V2]}, iiv {name: omega},
       err {add, prop}
     iivScale: 'omega' (reported % is the log-scale SD, the usual
     NONMEM exponential-model convention) or 'cv' (reported % is a true
     coefficient of variation, converted by sqrt(ln(1+CV^2))).
     --------------------------------------------------------------- */
  function omegaOf(model, key) {
    var w = (model.iiv && model.iiv[key]) || 0;
    if (!w) return 0;
    if (model.iivScale === 'cv') return Math.sqrt(Math.log(1 + w * w));
    return w;
  }

  function iivKeys(model) {
    return Object.keys(model.iiv || {});
  }

  /* ---- Correlated between-subject variability ----------------------
     Some published models report off-diagonal OMEGA terms (e.g. Gijsen
     2021 reports a CL-Vc IIV correlation). Sampling those parameters
     independently would understate the joint spread of exposure, so the
     covariance matrix is built explicitly and factorised.

     model.iivCorr is a list of [paramA, paramB, rho] triples. With none
     supplied the covariance is diagonal and this reduces exactly to
     independent sampling.
     ------------------------------------------------------------------ */
  function iivCov(model) {
    var keys = iivKeys(model), n = keys.length, i, j,
        om = keys.map(function (k) { return omegaOf(model, k); }),
        S = [];
    for (i = 0; i < n; i++) {
      S.push(new Array(n));
      for (j = 0; j < n; j++) S[i][j] = (i === j) ? om[i] * om[i] : 0;
    }
    var corr = model.iivCorr || [];
    for (i = 0; i < corr.length; i++) {
      var a = keys.indexOf(corr[i][0]), b = keys.indexOf(corr[i][1]),
          r = corr[i][2];
      if (a < 0 || b < 0 || a === b) continue;
      // Clamp to a valid correlation; a published point estimate plus a
      // separately published omega can imply |rho| slightly above 1.
      if (r > 0.999) r = 0.999;
      if (r < -0.999) r = -0.999;
      S[a][b] = S[b][a] = r * om[a] * om[b];
    }
    return { keys: keys, om: om, S: S };
  }

  // Lower-triangular Cholesky factor, with escalating jitter if the
  // supplied matrix is not quite positive definite.
  function cholesky(S) {
    var n = S.length, jit = 0, attempt, i, j, k;
    for (attempt = 0; attempt < 8; attempt++) {
      var L = [], okFlag = true;
      for (i = 0; i < n; i++) L.push(new Array(n).fill(0));
      for (i = 0; i < n && okFlag; i++) {
        for (j = 0; j <= i; j++) {
          var sum = S[i][j] + (i === j ? jit : 0);
          for (k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
          if (i === j) {
            if (sum <= 0) { okFlag = false; break; }
            L[i][j] = Math.sqrt(sum);
          } else {
            L[i][j] = sum / L[j][j];
          }
        }
      }
      if (okFlag) return L;
      jit = jit === 0 ? 1e-10 : jit * 100;
    }
    // Fall back to the diagonal, which is always factorisable.
    var D = [];
    for (i = 0; i < n; i++) {
      D.push(new Array(n).fill(0));
      D[i][i] = Math.sqrt(Math.max(1e-12, S[i][i]));
    }
    return D;
  }

  // Quadratic form x' S^-1 x via forward substitution on L y = x.
  function mahalanobis2(L, x) {
    var n = L.length, y = new Array(n), i, k;
    for (i = 0; i < n; i++) {
      var s = x[i];
      for (k = 0; k < i; k++) s -= L[i][k] * y[k];
      y[i] = s / L[i][i];
    }
    var q = 0;
    for (i = 0; i < n; i++) q += y[i] * y[i];
    return q;
  }

  // Apply a vector of etas (indexed like iivKeys) to typical parameters.
  function withEtas(model, typ, etas) {
    var keys = iivKeys(model), p = {}, k;
    for (k in typ) if (Object.prototype.hasOwnProperty.call(typ, k)) p[k] = typ[k];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (p[key] != null) p[key] = p[key] * Math.exp(etas[i] || 0);
    }
    return p;
  }

  /* ---- Multivariate-normal sampling on the natural parameter scale ----
     Nonparametric population models (Pmetrics/NPAG lineage) report a
     parameter vector plus a full covariance matrix rather than a diagonal
     log-normal OMEGA, and the parameters are micro-constants, not CL/V.
     Sampling those requires drawing on the natural scale from the
     published covariance.

     Normal-scale draws can be non-physical (a negative rate constant), so
     invalid draws are rejected and redrawn. The rejection fraction is
     returned, because it is a real departure from the published
     nonparametric distribution and should be visible rather than hidden:
     a heavily truncated normal is no longer the distribution the authors
     fitted. */
  function sampleMvn(model, cov, n, seed) {
    var mean = model.mvMean, k = mean.length,
        L = cholesky(model.mvCov),
        pool = normals(Math.max(1024, n * k * 4), seed || 12345),
        pi = 0, batch = 1,
        out = [], tries = 0, maxTries = n * 200, i, j;

    function z() {
      if (pi >= pool.length) {
        pool = normals(Math.max(1024, n * k * 4), (seed || 12345) + 7919 * batch++);
        pi = 0;
      }
      return pool[pi++];
    }

    while (out.length < n && tries < maxTries) {
      tries++;
      var zz = new Array(k), draw = new Array(k);
      for (i = 0; i < k; i++) zz[i] = z();
      for (i = 0; i < k; i++) {
        var e = 0;
        for (j = 0; j <= i; j++) e += L[i][j] * zz[j];
        draw[i] = mean[i] + e;
      }
      var p = model.paramsFromDraw(draw, cov);
      if (p && p.CL > 0 && p.V1 > 0 &&
          (model.ncmt === 1 || (p.Q > 0 && p.V2 > 0))) out.push(p);
    }
    // Top up with the typical subject if rejection was pathological, so a
    // caller always receives n subjects rather than a short array.
    while (out.length < n) out.push(model.params(cov));
    out.rejectedFraction = tries > 0 ? 1 - out.length / tries : 0;
    return out;
  }

  function samplePopulation(model, cov, n, seed) {
    if (model.sampling === 'mvnorm') return sampleMvn(model, cov, n, seed);
    var cv = iivCov(model), keys = cv.keys, nk = keys.length,
        L = cholesky(cv.S),
        typ = model.params(cov),
        z = normals(n * Math.max(1, nk), seed || 12345),
        out = new Array(n), s, i, j;
    for (s = 0; s < n; s++) {
      var etas = new Array(nk);
      for (i = 0; i < nk; i++) {
        // eta = L z  gives the target covariance structure.
        var e = 0;
        for (j = 0; j <= i; j++) e += L[i][j] * z[s * nk + j];
        etas[i] = e;
      }
      out[s] = withEtas(model, typ, etas);
    }
    return out;
  }

  function percentile(sorted, q) {
    if (!sorted.length) return NaN;
    var idx = (sorted.length - 1) * q, lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? sorted[lo] : sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
  }

  /* Does one simulated subject meet the target?
     Target types:
       ftmic   %fT>MIC   >= threshold
       aucmic  fAUC24/MIC >= threshold
       auc     AUC24 within [lo, hi]   (vancomycin 400-600 mg*h/L)
       cmin    Cmin within [lo, hi]
       cminmic fCmin/MIC >= threshold
  */
  function meetsTarget(m, target, mic) {
    switch (target.type) {
      case 'ftmic':   return m.tAbove >= target.threshold - 1e-9;
      case 'aucmic':  return mic > 0 && (m.fauc24 / mic) >= target.threshold;
      case 'auc':     return m.auc24 >= target.lo && m.auc24 <= target.hi;
      case 'cmin':    return m.cmin >= target.lo && m.cmin <= target.hi;
      case 'cminmic': return mic > 0 && (m.fcmin / mic) >= target.threshold;
      default: return false;
    }
  }

  /* Full population simulation.
     Returns the concentration-time summary (median + prediction interval)
     and, for each MIC on the ladder, the probability of target attainment.
  */
  function simulate(cfg) {
    var model = cfg.model,
        cov = cfg.cov,
        reg = cfg.regimen,
        n = cfg.n || 1000,
        target = cfg.target,
        mics = cfg.mics || [],
        micEff = (target.type === 'ftmic' && target.micMultiplier)
                   ? target.micMultiplier : 1,
        subjects = samplePopulation(model, cov, n, cfg.seed),
        typ = model.params(cov);

    // Dose the schedule out to steady state unless the caller pinned
    // nDoses (first-dose teaching cases legitimately want nDoses=1).
    var regEff = {};
    for (var k in reg) if (Object.prototype.hasOwnProperty.call(reg, k)) regEff[k] = reg[k];
    if (regEff.mode !== 'ci' && !regEff.nDoses) {
      regEff.nDoses = dosesToSteadyState(typ, model.ncmt, regEff.tau);
    }
    var sched = buildSchedule(regEff),
        tau = sched.tau,
        nd = sched.ci ? 0 : (regEff.nDoses || 1),
        ssDoses = sched.ci ? 0 : dosesToSteadyState(typ, model.ncmt, tau),
        // Which dosing interval the PD target is evaluated over. Default
        // is the last one, which is steady state when the schedule was
        // dosed out to it. An explicit index evaluates an earlier
        // interval — "does the FIRST dose attain the target" is a
        // different and clinically real question from the steady-state
        // one, and the answer differs for any drug that accumulates.
        evalK = sched.ci ? 0
          : Math.min(Math.max(1, (!cfg.evalDose || cfg.evalDose === 'last') ? nd : cfg.evalDose), nd),
        tA = sched.ci ? Math.max(0, sched.tEnd - 24) : (evalK - 1) * tau,
        tB = sched.ci ? sched.tEnd : evalK * tau,
        // The PLOT window is independent of the evaluation window:
        // showing the whole course makes accumulation visible while the
        // reported metrics still come from the single evaluated interval.
        whole = !!cfg.plotWhole && !sched.ci,
        tPlotA = whole ? 0 : tA,
        tPlotB = whole ? sched.tEnd : tB;

    // Concentration-time profile grid over the PLOT window. A whole
    // course spans many intervals, so it needs a finer grid to keep the
    // infusion peaks from being sampled away.
    var nT = cfg.nT || (whole ? 480 : 120), times = new Array(nT + 1), i, j;
    for (i = 0; i <= nT; i++) times[i] = tPlotA + (i * (tPlotB - tPlotA)) / nT;

    var curves = new Array(n), perSubj = new Array(n);
    for (j = 0; j < n; j++) {
      var cf = concFn(subjects[j], model.ncmt, sched),
          row = new Float64Array(nT + 1);
      for (i = 0; i <= nT; i++) row[i] = cf(times[i]);
      curves[j] = row;
      perSubj[j] = { cf: cf, p: subjects[j] };
    }

    // Pointwise percentiles across the population.
    var med = new Array(nT + 1), lo = new Array(nT + 1), hi = new Array(nT + 1);
    for (i = 0; i <= nT; i++) {
      var col = new Array(n);
      for (j = 0; j < n; j++) col[j] = curves[j][i];
      col.sort(function (a, b) { return a - b; });
      med[i] = percentile(col, 0.5);
      lo[i] = percentile(col, 0.05);
      hi[i] = percentile(col, 0.95);
    }

    // PTA across the MIC ladder.
    var pta = mics.map(function (mic) {
      var ok = 0;
      for (var s = 0; s < n; s++) {
        var m = metrics(perSubj[s].cf, tA, tB, {
          fu: model.fu, mic: mic * micEff, nGrid: cfg.nGrid || 300
        });
        if (meetsTarget(m, target, mic)) ok++;
      }
      return { mic: mic, pta: (100 * ok) / n };
    });

    // MIC-independent exposure summary (AUC, Cmin, Cmax) at the reference MIC.
    var refMic = cfg.mic || 0, exposures = [];
    for (j = 0; j < n; j++) {
      exposures.push(metrics(perSubj[j].cf, tA, tB, {
        fu: model.fu, mic: refMic * micEff, nGrid: cfg.nGrid || 300
      }));
    }
    function summ(field) {
      var v = exposures.map(function (e) { return e[field]; })
                       .sort(function (a, b) { return a - b; });
      return { median: percentile(v, 0.5), p5: percentile(v, 0.05), p95: percentile(v, 0.95) };
    }
    var ptaRef = 0;
    for (j = 0; j < n; j++) if (meetsTarget(exposures[j], target, refMic)) ptaRef++;

    // Typical-subject (population median parameter) profile.
    var cfTyp = concFn(typ, model.ncmt, sched), typCurve = new Array(nT + 1);
    for (i = 0; i <= nT; i++) typCurve[i] = cfTyp(times[i]);

    return {
      times: times, tA: tA, tB: tB, tau: tau, schedule: sched,
      tPlotA: tPlotA, tPlotB: tPlotB, plotWhole: whole,
      evalDose: evalK, nDoses: nd, dosesToSteadyState: ssDoses,
      // False when the course is too short for the evaluated interval to
      // represent steady state — the label must not claim otherwise.
      atSteadyState: sched.ci ? true : evalK >= ssDoses,
      median: med, lo: lo, hi: hi, typical: typCurve,
      typicalParams: typ,
      pta: pta,
      ptaAtRefMic: (100 * ptaRef) / n,
      exposure: {
        auc24: summ('auc24'), fauc24: summ('fauc24'),
        cmin: summ('cmin'), cmax: summ('cmax'), tAbove: summ('tAbove')
      },
      n: n, micMultiplier: micEff,
      rejectedFraction: subjects.rejectedFraction || 0
    };
  }

  // Cumulative fraction of response against a MIC frequency distribution.
  // dist: [{mic, freq}] — freq need not be normalised.
  function cfr(ptaCurve, dist) {
    var tot = 0, acc = 0;
    dist.forEach(function (d) {
      var hit = null;
      for (var i = 0; i < ptaCurve.length; i++) {
        if (Math.abs(ptaCurve[i].mic - d.mic) < 1e-9) { hit = ptaCurve[i]; break; }
      }
      if (hit) { acc += hit.pta * d.freq; tot += d.freq; }
    });
    return tot > 0 ? acc / tot : NaN;
  }

  // Highest MIC on the ladder at which PTA still meets the threshold
  // (the PK/PD breakpoint for this regimen).
  function pkpdBreakpoint(ptaCurve, thresh) {
    var bp = null;
    for (var i = 0; i < ptaCurve.length; i++) {
      if (ptaCurve[i].pta >= thresh) bp = ptaCurve[i].mic; else break;
    }
    return bp;
  }

  /* ---------------------------------------------------------------
     7. Nelder-Mead and MAP Bayesian individualisation.

     Objective (to minimise) is the negative log posterior, dropping
     constants:
        sum_j [ (obs_j - pred_j)^2 / var_j + ln(var_j) ]
      + sum_i eta_i^2 / omega_i^2
     with var_j = (add)^2 + (prop * pred_j)^2.
     This is the standard MAP/POSTHOC objective used for Bayesian
     forecasting in TDM.
     --------------------------------------------------------------- */
  function nelderMead(f, x0, opts) {
    opts = opts || {};
    var n = x0.length,
        maxIter = opts.maxIter || 600,
        tol = opts.tol || 1e-8,
        step = opts.step || 0.4,
        simplex = [], i, j;

    function evalPt(x) { return { x: x.slice(), fx: f(x) }; }
    simplex.push(evalPt(x0));
    for (i = 0; i < n; i++) {
      var x = x0.slice();
      x[i] += step;
      simplex.push(evalPt(x));
    }
    function sortSimplex() {
      simplex.sort(function (a, b) { return a.fx - b.fx; });
    }
    sortSimplex();

    for (var it = 0; it < maxIter; it++) {
      sortSimplex();
      var best = simplex[0], worst = simplex[n];
      if (Math.abs(worst.fx - best.fx) < tol) break;
      var cen = new Array(n);
      for (i = 0; i < n; i++) {
        var s = 0;
        for (j = 0; j < n; j++) s += simplex[j].x[i];
        cen[i] = s / n;
      }
      function along(coef) {
        var p = new Array(n);
        for (var q = 0; q < n; q++) p[q] = cen[q] + coef * (cen[q] - worst.x[q]);
        return evalPt(p);
      }
      var refl = along(1);
      if (refl.fx < simplex[n - 1].fx && refl.fx >= best.fx) {
        simplex[n] = refl; continue;
      }
      if (refl.fx < best.fx) {
        var exp2 = along(2);
        simplex[n] = exp2.fx < refl.fx ? exp2 : refl;
        continue;
      }
      var con = along(-0.5);
      if (con.fx < worst.fx) { simplex[n] = con; continue; }
      for (i = 1; i <= n; i++) {
        var y = new Array(n);
        for (j = 0; j < n; j++) y[j] = best.x[j] + 0.5 * (simplex[i].x[j] - best.x[j]);
        simplex[i] = evalPt(y);
      }
    }
    sortSimplex();
    return { x: simplex[0].x, fx: simplex[0].fx };
  }

  /* samples: [{time (h, on the same clock as the dosing record), conc (mg/L)}]
     doseEvents: explicit event list (see buildSchedule) so a real, possibly
     irregular, dosing record can be used.                                  */
  function mapEstimate(model, cov, doseEvents, samples) {
    var keys = iivKeys(model),
        typ = model.params(cov),
        omegas = keys.map(function (k) { return omegaOf(model, k); }),
        // The prior penalty is eta' OMEGA^-1 eta. With a diagonal OMEGA
        // that is the familiar sum of (eta/omega)^2; with an off-diagonal
        // term present the full form is required, or a correlated pair is
        // penalised as though it were two independent deviations.
        cv = iivCov(model),
        Lchol = cholesky(cv.S),
        hasCorr = !!(model.iivCorr && model.iivCorr.length),
        add = (model.err && model.err.add) || 0,
        prop = (model.err && model.err.prop) || 0,
        sched = { events: doseEvents };

    function obj(etas) {
      var p = withEtas(model, typ, etas);
      if (!(p.CL > 0) || !(p.V1 > 0)) return 1e12;
      if (model.ncmt === 2 && (!(p.Q > 0) || !(p.V2 > 0))) return 1e12;
      var cf = concFn(p, model.ncmt, sched), ll = 0, i;
      for (i = 0; i < samples.length; i++) {
        var pred = cf(samples[i].time),
            va = add * add + (prop * pred) * (prop * pred);
        if (!(va > 0)) va = 1e-8;
        var r = samples[i].conc - pred;
        ll += (r * r) / va + Math.log(va);
      }
      if (hasCorr) {
        ll += mahalanobis2(Lchol, etas);
      } else {
        for (i = 0; i < keys.length; i++) {
          if (omegas[i] > 0) ll += (etas[i] * etas[i]) / (omegas[i] * omegas[i]);
        }
      }
      return ll;
    }

    var start = keys.map(function () { return 0; }),
        fit = nelderMead(obj, start, { step: 0.3, maxIter: 1200 });
    // One restart from the solution guards against an early simplex collapse.
    fit = nelderMead(obj, fit.x, { step: 0.08, maxIter: 800 });

    var ind = withEtas(model, typ, fit.x),
        cf = concFn(ind, model.ncmt, sched);
    return {
      etas: fit.x, objective: fit.fx,
      params: ind, typicalParams: typ,
      keys: keys,
      predict: cf,
      fitted: samples.map(function (s) {
        return { time: s.time, obs: s.conc, pred: cf(s.time) };
      })
    };
  }

  /* ------------------------------------------------------------------
     Convenience: deterministic profile for a given parameter set.
     ------------------------------------------------------------------ */
  function profile(model, params, regimen, nT, tSpan) {
    var reg = {};
    for (var k in regimen) if (Object.prototype.hasOwnProperty.call(regimen, k)) reg[k] = regimen[k];
    if (reg.mode !== 'ci' && !reg.nDoses) {
      reg.nDoses = Math.max(1, Math.ceil((tSpan || 48) / reg.tau));
    }
    var sched = buildSchedule(reg),
        cf = concFn(params, model.ncmt, sched),
        tEnd = tSpan || sched.tEnd,
        n = nT || 400,
        ts = [], cs = [];
    for (var i = 0; i <= n; i++) {
      var t = (i * tEnd) / n;
      ts.push(t); cs.push(cf(t));
    }
    return { times: ts, conc: cs, schedule: sched, cf: cf };
  }

  var API = {
    rng: rng, normals: normals,
    cockcroftGault: cockcroftGault, ckdEpiCr: ckdEpiCr, ckdEpiCysC: ckdEpiCysC,
    mdrd: mdrd, ibwDevine: ibwDevine, scrToMgdl: scrToMgdl,
    iivCov: iivCov, cholesky: cholesky, mahalanobis2: mahalanobis2,
    sampleMvn: sampleMvn,
    micro2: micro2, infusionResponse: infusionResponse,
    buildSchedule: buildSchedule, concFn: concFn,
    dosesToSteadyState: dosesToSteadyState,
    metrics: metrics, samplePopulation: samplePopulation,
    percentile: percentile, meetsTarget: meetsTarget,
    simulate: simulate, cfr: cfr, pkpdBreakpoint: pkpdBreakpoint,
    nelderMead: nelderMead, mapEstimate: mapEstimate, profile: profile,
    omegaOf: omegaOf, iivKeys: iivKeys, withEtas: withEtas
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.PKPD = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
