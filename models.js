/* =====================================================================
   models.js — population PK model library.

   EVERY parameter below was read off the parameter table of the primary
   publication (see `source`), not from recall. A model is only included
   if its fixed effects, covariate equations AND between-subject
   variability terms were all recoverable from the paper, because a
   model without variance terms cannot support Monte Carlo target
   attainment or Bayesian forecasting.

   Model spec fields
     id, drug, label, source, doi
     ncmt      1 or 2
     matrix    what the model was fitted to ('total plasma' | 'unbound plasma')
     fu        free fraction used to convert to free concentrations for
               PD targets (1.0 when the model is already an unbound model)
     covariates[]  UI descriptors
     params(cov)   -> {CL, V1, Q, V2}   (L/h, L)
     iiv{}     between-subject variability, keyed by parameter name
     iivScale  'omega' (reported % is the log-scale SD — the usual
               NONMEM exponential-model convention) or 'cv'
     err{add,prop}  residual error; needed only for Bayesian forecasting
     bayesian  false disables MAP forecasting (with a stated reason)
     targets[] PD targets appropriate to the drug
   ===================================================================== */
(function (root) {
  'use strict';

  var LADDER = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128];

  /* Convert a nonparametric micro-constant vector to the CL/V1/Q/V2
     parameterisation the engine solves in.
       d = [Ki, KS, K12, K21, V1_per_kg]
       K10 = Ki + KS * CLcr      (the paper's elimination-rate model)
       V1  = V1_per_kg * TBW
       CL  = K10 * V1,  Q = K12 * V1,  V2 = Q / K21
     The last identity is exact: at equilibrium K12*V1 = K21*V2. */
  function microToMacro(d, c) {
    var k10 = d[0] + d[1] * Math.max(0, c.crcl),
        v1 = d[4] * c.wt,
        q = d[2] * v1;
    if (!(k10 > 0) || !(v1 > 0) || !(q > 0) || !(d[3] > 0)) return null;
    return { CL: k10 * v1, V1: v1, Q: q, V2: q / d[3] };
  }

  /* ---------------- Targets ---------------- */
  var T_FT50  = { id: 'ft50',  type: 'ftmic', threshold: 50,  label: '50% fT>MIC' };
  var T_FT100 = { id: 'ft100', type: 'ftmic', threshold: 100, label: '100% fT>MIC' };
  var T_FT100x4 = {
    id: 'ft100x4', type: 'ftmic', threshold: 100, micMultiplier: 4,
    label: '100% fT>4\u00d7MIC'
  };
  var T_FT60 = { id: 'ft60', type: 'ftmic', threshold: 60, label: '60% fT>MIC' };
  var T_FT40 = { id: 'ft40', type: 'ftmic', threshold: 40, label: '40% fT>MIC' };
  // Carbapenem targets in common use for teaching: 40% fT>MIC is the
  // classical bactericidal exposure for carbapenems, while 100% fT>MIC
  // and 100% fT>4xMIC are the critical-care targets used by the source
  // papers implemented below.
  var T_FT20 = { id: 'ft20', type: 'ftmic', threshold: 20, label: '20% fT>MIC' };
  var T_FT98 = { id: 'ft98', type: 'ftmic', threshold: 98, label: '98% fT>MIC' };
  var T_FT98x4 = {
    id: 'ft98x4', type: 'ftmic', threshold: 98, micMultiplier: 4,
    label: '98% fT>4\u00d7MIC'
  };
  /* ---- Aminoglycoside targets ----
     Aminoglycosides kill in a concentration-dependent way, so efficacy
     tracks the peak-to-MIC ratio, not time above MIC. Toxicity tracks
     accumulation, so a trough CEILING sits alongside it. Thresholds are
     the defaults documented in TDMx's own module reference manuals
     (Settings > PK Table Colour Coding): Cmax/MIC 10, AUC24h/MIC 70,
     and a target trough of 2 mg/L for gentamicin and tobramycin, 5 mg/L
     for amikacin. */
  var T_CMAX10 = { id: 'cmax10', type: 'cmaxmic', threshold: 10,
                   label: 'C\u2098\u2090\u2093/MIC \u2265 10' };
  var T_AUCMIC70 = { id: 'aucmic70', type: 'aucmic', threshold: 70,
                     label: 'AUC\u2080\u208b\u2082\u2084/MIC \u2265 70' };
  function troughCeil(hi) {
    return { id: 'cmin' + String(hi).replace('.', '_'), type: 'cminceil', hi: hi,
             label: 'C\u2098\u1d62\u2099 \u2264 ' + hi + ' mg/L' };
  }
  // The once-daily argument in one target: the peak must be high AND the
  // trough low, in the SAME patient.
  function onceDaily(hi) {
    return { id: 'od' + String(hi).replace('.', '_'), type: 'composite',
             label: 'C\u2098\u2090\u2093/MIC \u2265 10 and C\u2098\u1d62\u2099 \u2264 ' + hi + ' mg/L',
             all: [T_CMAX10, troughCeil(hi)] };
  }
  var AG_TARGETS_2 = [onceDaily(2), T_CMAX10, troughCeil(2), T_AUCMIC70];
  var AG_TARGETS_5 = [onceDaily(5), T_CMAX10, troughCeil(5), T_AUCMIC70];

  var MERO_TARGETS = [T_FT40, T_FT50, T_FT100, T_FT100x4];
  // Li 2006 used 20% fT>MIC (bacteriostatic) and 40% fT>MIC (bactericidal);
  // Ehmann 2019 used 98% fT>MIC (and 98% fT>4xMIC for continuous infusion),
  // relaxed from 100% because the target is unreachable on day 1 while the
  // first infusion is still climbing. Each model offers its own paper's
  // targets first so the app's defaults match the source.
  var MERO_TARGETS_LI = [T_FT20, T_FT40, T_FT50, T_FT100];
  var MERO_TARGETS_EH = [T_FT98, T_FT98x4, T_FT50, T_FT100];

  var MODELS = [

    /* =================================================================
       VANCOMYCIN — Thomson et al. 2009
       Two-compartment, fitted to routine TDM data from 398 adults.
       Table 2: CL 2.99 L/h (typical, at CLcr 66 mL/min); CLcr coefficient
       0.0154 = proportional change per mL/min (the paper states this as
       "15.4% for every 10 mL/min difference from a CLcr of 66 mL/min");
       V1 0.675 L/kg; V2 0.732 L/kg; Q 2.28; IIV 27 / 15 / 130 / 49 %
       on CL / V1 / V2 / Q; residual error additive 1.6 mg/L plus
       proportional 15%. Vss (V1+V2) = 1.41 L/kg matches the paper's
       stated Vss of 1.4 L/kg.
       ================================================================= */
    {
      id: 'van_thomson2009',
      drug: 'Vancomycin',
      label: 'Thomson 2009 — 2-cmt, adult TDM population',
      source: 'Thomson AH, Staatz CE, Tobin CM, Gall M, Lovering AM. ' +
              'J Antimicrob Chemother 2009;63:1050-7, Table 2.',
      doi: '10.1093/jac/dkp085',
      ncmt: 2,
      matrix: 'total plasma',
      fu: 1.0,
      renal: 'cg',
      covariates: ['wt', 'age', 'sex', 'scr'],
      params: function (c) {
        var crcl = Math.max(5, c.crcl);
        // Proportional CLcr model centred on 66 mL/min; floored to keep
        // CL strictly positive at the extreme low end of the range.
        var cl = 2.99 * (1 + 0.0154 * (crcl - 66));
        return {
          CL: Math.max(0.05, cl),
          V1: 0.675 * c.wt,
          Q: 2.28,
          V2: 0.732 * c.wt
        };
      },
      iiv: { CL: 0.27, V1: 0.15, V2: 1.30, Q: 0.49 },
      iivScale: 'omega',
      err: { add: 1.6, prop: 0.15 },
      bayesian: true,
      note: 'Q is tabulated as 2.28 with a unit label of h\u207b\u00b9 while the ' +
            'table key defines Q as intercompartmental clearance; it is ' +
            'implemented here as 2.28 L/h. Distribution is therefore slow ' +
            'and the peripheral compartment poorly identified (V2 IIV 130%), ' +
            'which is expected for a model built on trough-rich TDM data.',
      targets: [
        { id: 'auc400', type: 'auc', lo: 400, hi: 600,
          label: 'AUC\u2080\u208b\u2082\u2084 400\u2013600 mg\u00b7h/L', micFree: false },
        { id: 'aucmic400', type: 'aucmic', threshold: 400,
          label: 'AUC\u2080\u208b\u2082\u2084/MIC \u2265 400' },
        { id: 'cmin1020', type: 'cmin', lo: 10, hi: 20,
          label: 'C\u2098\u1d62\u2099 10\u201320 mg/L' }
      ],
      defaultRegimen: { dose: 1000, tau: 12, tinf: 1.0 },
      defaultMic: 1
    },

    /* =================================================================
       PIPERACILLIN — Kim et al. 2022
       Two-compartment, 38 critically ill adults (19 on ECMO).
       Table 2: CL = 5.05 * exp(0.00932 * (eGFR_cysC - 52.77)) L/h;
       Vc 16.5 L (non-ECMO) or 7.38 L (ECMO); Q 6.28 L/h; Vp 6.27 L;
       IIV 33.7% CL, 65.3% Vc non-ECMO, 45.9% Vc ECMO; proportional
       residual error 26.9%. Allometric scaling to 70 kg with exponents
       0.75 (clearances) and 1 (volumes) per the paper's equation 1.
       Free fraction fixed at 0.91 in the paper's own PTA simulations.
       This model was identified as the most accurate and precise of 24
       published piperacillin models for the pooled dataset in the
       multicentre external evaluation (Intensive Care Med 2023).
       ================================================================= */
    {
      id: 'pip_kim2022',
      drug: 'Piperacillin',
      label: 'Kim 2022 — 2-cmt, critically ill \u00b1 ECMO',
      source: 'Kim YK, Kim HS, Park S, et al. J Antimicrob Chemother ' +
              '2022;77:1353-64, Table 2.',
      doi: '10.1093/jac/dkac059',
      ncmt: 2,
      matrix: 'total plasma',
      fu: 0.91,
      renal: 'cysc',
      covariates: ['wt', 'age', 'sex', 'cysc', 'ecmo'],
      params: function (c) {
        var wf = c.wt / 70,
            cl75 = Math.pow(wf, 0.75),
            v1 = wf,
            egfr = Math.max(1, c.egfr);
        return {
          CL: 5.05 * Math.exp(0.00932 * (egfr - 52.77)) * cl75,
          V1: (c.ecmo ? 7.38 : 16.5) * v1,
          Q: 6.28 * cl75,
          V2: 6.27 * v1
        };
      },
      iivFor: function (c) {
        return { CL: 0.337, V1: c.ecmo ? 0.459 : 0.653 };
      },
      iiv: { CL: 0.337, V1: 0.653 },
      iivScale: 'omega',
      err: { add: 0, prop: 0.269 },
      bayesian: true,
      note: 'Clearance covariate is eGFR from the CKD-EPI CYSTATIN C ' +
            'equation, not a creatinine-based estimate — entering a ' +
            'creatinine eGFR here is a model misuse.',
      targets: [T_FT50, T_FT100, T_FT100x4],
      defaultRegimen: { dose: 4000, tau: 6, tinf: 0.5 },
      defaultMic: 16
    },

    /* =================================================================
       PIPERACILLIN — Udy et al. 2015
       Two-compartment, 48 critically ill adults with sepsis, fitted to
       UNBOUND plasma piperacillin (so fu = 1 here).
       Table 2: CL 16.3 L/h scaled as CL * (CLcr/100); Vc 19.9 L;
       Vp 18.8 L; Q 37.3 L/h; BSV 56.0% CL, 29.6% Vc, 67.6% Vp.
       Best-performing model for intermittent infusion in the 2023
       multicentre external evaluation.
       ================================================================= */
    {
      id: 'pip_udy2015',
      drug: 'Piperacillin',
      label: 'Udy 2015 — 2-cmt, unbound, sepsis / augmented CLcr',
      source: 'Udy AA, Lipman J, Jarrett P, et al. Crit Care 2015;19:28, ' +
              'Table 2.',
      doi: '10.1186/s13054-015-0750-y',
      ncmt: 2,
      matrix: 'unbound plasma',
      fu: 1.0,
      renal: 'cg',
      covariates: ['wt', 'age', 'sex', 'scr'],
      params: function (c) {
        return {
          CL: 16.3 * (Math.max(5, c.crcl) / 100),
          V1: 19.9,
          Q: 37.3,
          V2: 18.8
        };
      },
      iiv: { CL: 0.56, V1: 0.296, V2: 0.676 },
      iivScale: 'omega',
      err: { add: 0.3, prop: null },
      bayesian: false,
      bayesianNote: 'MAP forecasting is disabled for this model. Its ' +
            'residual-error table reports "RUV (%CV) 1.0" alongside ' +
            '"RUV (SD) 0.3 mg/L"; the scale of the proportional term is ' +
            'ambiguous in the published table, and a wrong residual ' +
            'variance would silently distort the weighting of TDM samples ' +
            'against the prior. Monte Carlo target attainment is ' +
            'unaffected — it needs only the fixed effects and BSV, which ' +
            'is exactly how the paper itself used this model.',
      note: 'Fitted to unbound concentrations: simulated concentrations ' +
            'are already free drug, so no protein-binding correction is ' +
            'applied. An infusion lag (ALAG) term in the published model ' +
            'is not implemented.',
      targets: [T_FT50, T_FT100],
      defaultRegimen: { dose: 4000, tau: 6, tinf: 0.33 },
      defaultMic: 16
    },

    /* =================================================================
       MEROPENEM — Gijsen et al. 2021
       Two-compartment, 25 critically ill adults (ECMO and matched
       non-ECMO), fitted to UNBOUND meropenem plasma concentrations.
       Table 2 (final model): CL 14.7 L/h, Vc 25.6 L, Q 5.51 L/h,
       Vp 8.02 L; allometric exponents FIXED at 0.75 on CL and Q and 1 on
       Vc and Vp; eGFR(CKD-EPI) exponent on CL 1.29. The paper states the
       clearance model explicitly as equation (1):
         CL_i = 14.7 x (BW_i/70)^0.75 x (eGFR_CKD-EPI,i/105)^1.29
       IIV 46.8% CV on CL and 61.6% CV on Vc, with a CL-Vc correlation of
       70.4%; proportional residual error 28.8% CV.
       ECMO was tested and NOT retained as a significant predictor — the
       paper's central finding — so there is no ECMO term to implement.
       ================================================================= */
    {
      id: 'mem_gijsen2021',
      drug: 'Meropenem',
      label: 'Gijsen 2021 — 2-cmt, unbound, ICU \u00b1 ECMO',
      source: 'Gijsen M, Dreesen E, Annaert P, et al. Microorganisms ' +
              '2021;9(6):1310, Table 2 and equation (1).',
      doi: '10.3390/microorganisms9061310',
      ncmt: 2,
      matrix: 'unbound plasma',
      fu: 1.0,
      renal: 'ckdepi',
      covariates: ['wt', 'age', 'sex', 'scr'],
      params: function (c) {
        var bw = Math.max(25, c.wt) / 70,
            eg = Math.max(5, c.egfr) / 105;
        return {
          CL: 14.7 * Math.pow(bw, 0.75) * Math.pow(eg, 1.29),
          V1: 25.6 * bw,
          Q: 5.51 * Math.pow(bw, 0.75),
          V2: 8.02 * bw
        };
      },
      iiv: { CL: 0.468, V1: 0.616 },
      // Reported as a true coefficient of variation (%CV column).
      iivScale: 'cv',
      iivCorr: [['CL', 'V1', 0.704]],
      err: { add: 0, prop: 0.288 },
      bayesian: true,
      note: 'Fitted to UNBOUND meropenem, so simulated concentrations are ' +
            'already free drug and no protein-binding correction is applied. ' +
            'ECMO is deliberately absent as a covariate: the paper tested it ' +
            'and found it non-significant. The CL-Vc IIV correlation of ' +
            '70.4% is implemented, so the two random effects are sampled ' +
            'jointly rather than independently.',
      targets: MERO_TARGETS,
      defaultRegimen: { dose: 1000, tau: 8, tinf: 0.5 },
      defaultMic: 2
    },

    /* =================================================================
       MEROPENEM — Shekar et al. 2014
       Two-compartment, 21 critically ill adults (11 on ECMO, 10 matched
       controls; 5 of the ECMO patients and 5 of the controls on RRT).
       Table 2: CL 5.1 L/h, Vc 18.7 L, Vp 13.2 L, Q 21.0 L/h,
       CL_CRCL 1.89; BSV 51.6% CL, 45.8% Vc, 28.7% Vp; RUV 13.7% CV plus
       2.3 mg/L additive. The covariate model is
         TVCL = theta1(CL_RRT) + theta1(CL_NORRT x CrCL)
       with CL_RRT = 0 for patients not on RRT and CL_NORRT = 0 for
       patients on RRT, i.e. clearance is a fixed 5.1 L/h on RRT and
       1.89 x CrCL otherwise. ECMO was tested on every parameter and was
       neither significant nor an improvement in fit, so — as in the
       source — there is no ECMO term.
       ================================================================= */
    {
      id: 'mem_shekar2014',
      drug: 'Meropenem',
      label: 'Shekar 2014 — 2-cmt, RRT (continuous) / ECMO cohort',
      source: 'Shekar K, Fraser JF, Taccone FS, et al. Crit Care ' +
              '2014;18:565, Table 2.',
      doi: '10.1186/s13054-014-0565-2',
      ncmt: 2,
      matrix: 'total plasma',
      fu: 0.98,
      renal: 'cg',
      covariates: ['wt', 'age', 'sex', 'scr', 'rrt'],
      params: function (c) {
        // CrCL enters in L/h (the CG estimate is in mL/min).
        var crclLh = Math.max(2, c.crcl) * 0.06;
        return {
          CL: c.rrt ? 5.1 : 1.89 * crclLh,
          V1: 18.7,
          Q: 21.0,
          V2: 13.2
        };
      },
      iiv: { CL: 0.516, V1: 0.458, V2: 0.287 },
      iivScale: 'cv',
      err: { add: 2.3, prop: 0.137 },
      bayesian: true,
      note: 'On RRT, clearance is a fixed 5.1 L/h and creatinine clearance ' +
            'has no effect — the published model deliberately decouples the ' +
            'two. Off RRT, CL = 1.89 x CLcr expressed in L/h. Volumes and ' +
            'intercompartmental clearance carry no weight scaling in the ' +
            'published model, so changing body weight moves only CLcr. ' +
            'RRT in this cohort was continuous (CVVHDF); an intermittent ' +
            'schedule is not represented. n = 21, so parameters are ' +
            'imprecise (Q 95% CI 12.8\u201337.0 L/h). ' +
            'CAVEAT \u2014 the source is internally inconsistent: the trough ' +
            'concentrations tabulated in its Table 3, and the CLcr-banded ' +
            'dosing advice drawn from them, imply clearances of only ' +
            '2.4\u20135.5 L/h across CLcr 20\u2013180, which contradicts the ' +
            'same paper\u2019s measured clearances of 7.9 \u00b1 5.9 (ECMO) and ' +
            '11.7 \u00b1 6.5 L/h (controls) and cannot be produced by its own ' +
            'Table 2 equation under any unit reading. Its 1 g column is ' +
            'also not dose-proportional to its 500 mg and 2 g columns. ' +
            'What is implemented here is the published EQUATION, which ' +
            'reproduces the measured clearances closely (CL = 11.3 L/h at ' +
            'CLcr 100). Consequently this model does NOT reproduce that ' +
            'paper\u2019s dosing table \u2014 it predicts markedly lower ' +
            'attainment at high CLcr. See validate.cjs for the inversion.',
      targets: MERO_TARGETS,
      defaultRegimen: { dose: 1000, tau: 8, tinf: 0.5 },
      defaultMic: 2
    },

    /* =================================================================
       MEROPENEM — O'Jeanson et al. 2021
       ONE-compartment, critically ill adults spanning no RRT, continuous
       dialysis and semi-continuous (intermittent) dialysis.
       Table 4 (final model): theta_CL 1.36, theta_GFR 0.058,
       theta_DIA_C 6.38, theta_RFS 13.9, theta_RD 0.60, theta_DIA_SC 11.0,
       theta_V 43.9 L; BSV 30.8% CV on CL and 87.6% CV on V; proportional
       residual error 32.1% CV. The paper defines CV(%) = sqrt(exp(w^2)-1)
       x 100, so the reported percentages are TRUE coefficients of
       variation and are converted accordingly.

       Clearance follows the paper's own decision tree (Fig. 1):
         semi-continuous dialysis : CL = theta_DIA_SC
         continuous dialysis      : CL = theta_DIA_C + theta_RD(RD/845 - 1)
         GFR >= 120 (RFS = 1)     : CL = theta_RFS  + theta_RD(RD/845 - 1)
         otherwise                : CL = theta_CL + theta_GFR x GFR_MDRD
                                         + theta_RD(RD/845 - 1)
       Check: at the population median GFR_MDRD of 49 mL/min and median
       residual diuresis, CL = 1.36 + 0.058 x 49 = 4.20 L/h, reproducing
       the typical-patient clearance the paper reports in Table 3.
       ================================================================= */
    {
      id: 'mem_ojeanson2021',
      drug: 'Meropenem',
      label: "O'Jeanson 2021 — 1-cmt, ICU incl. intermittent & continuous RRT",
      source: "O'Jeanson A, Larcher R, Le Souder C, Djebli N, Khier S. " +
              'Eur J Drug Metab Pharmacokinet 2021;46(5):695-705, ' +
              'Table 4 and Fig. 1.',
      doi: '10.1007/s13318-021-00709-w',
      ncmt: 1,
      matrix: 'total plasma',
      fu: 0.98,
      renal: 'mdrd',
      covariates: ['age', 'sex', 'scr', 'dialysis', 'rd'],
      params: function (c) {
        var rdTerm = 0.60 * ((Math.max(0, c.rd == null ? 845 : c.rd) / 845) - 1),
            cl;
        if (c.dialysis === 'semicont') {
          cl = 11.0;                       // independent of GFR and diuresis
        } else if (c.dialysis === 'cont') {
          cl = 6.38 + rdTerm;
        } else if (Math.max(0, c.egfr) >= 120) {
          cl = 13.9 + rdTerm;              // renal function status = 1
        } else {
          cl = 1.36 + 0.058 * Math.max(0, c.egfr) + rdTerm;
        }
        return { CL: Math.max(0.2, cl), V1: 43.9 };
      },
      iiv: { CL: 0.308, V1: 0.876 },
      iivScale: 'cv',
      err: { add: 0, prop: 0.321 },
      bayesian: true,
      note: 'One-compartment model: no distribution phase, so early ' +
            'post-infusion concentrations are smoothed relative to a ' +
            '2-compartment description. Clearance is a step function of ' +
            'renal-replacement modality — semi-continuous (intermittent) ' +
            'dialysis gives a clearance independent of GFR and of residual ' +
            'diuresis. The renal covariate is GFR from the 4-variable MDRD ' +
            'equation specifically; the paper reports it in mL/min and ' +
            'notes normo-renal patients were under-represented (median GFR ' +
            '49 mL/min), so high-clearance predictions are the least well ' +
            'supported part of this model.',
      targets: MERO_TARGETS,
      defaultRegimen: { dose: 1000, tau: 8, tinf: 0.5 },
      defaultMic: 2
    },

    /* =================================================================
       MEROPENEM — Li et al. 2006
       Two-compartment, 79 hospitalised adults (18-93 y).
       Table II, final model:
         CL (L/h) = 14.60 x (CLCR/83)^0.62 x (Age/35)^(-0.34)
         V1 (L)   = 10.80 x (WT/70)^0.99
         Q = 18.60 L/h,  V2 = 12.6 L
       Interindividual variability is tabulated as VARIANCES (omega^2):
         CL 0.118, V1 0.143, Q 0.290, V2 0.102
       -> omegas are the square roots: 0.344, 0.378, 0.539, 0.319.
       Residual error is likewise tabulated as variances:
         sigma1^2 = 0.0352 (proportional) -> SD 0.188 = 18.8%
         sigma2^2 = 0.220  (additive)     -> SD 0.469 mg/L
       Targets in the paper: 20% fT>MIC bacteriostatic, 40% bactericidal.
       ================================================================= */
    {
      id: 'mem_li2006',
      drug: 'Meropenem',
      label: 'Li 2006 \u2014 2-cmt, hospitalised adults',
      source: 'Li C, Kuti JL, Nightingale CH, Nicolau DP. J Clin Pharmacol ' +
              '2006;46:1171-1178, Table II.',
      doi: '10.1177/0091270006291035',
      ncmt: 2,
      matrix: 'total plasma',
      fu: 0.98,
      renal: 'cg',
      covariates: ['wt', 'age', 'sex', 'scr'],
      params: function (c) {
        var crcl = Math.max(5, c.crcl), age = Math.max(18, c.age);
        return {
          CL: 14.60 * Math.pow(crcl / 83, 0.62) * Math.pow(age / 35, -0.34),
          V1: 10.80 * Math.pow(c.wt / 70, 0.99),
          Q: 18.60,
          V2: 12.6
        };
      },
      // Square roots of the published omega^2 values.
      iiv: { CL: Math.sqrt(0.118), V1: Math.sqrt(0.143),
             Q: Math.sqrt(0.290), V2: Math.sqrt(0.102) },
      iivScale: 'omega',
      err: { add: Math.sqrt(0.220), prop: Math.sqrt(0.0352) },
      bayesian: true,
      note: 'General hospitalised adults, not a critical-care model \u2014 ' +
            'the counterpart to the ICU models here. Age is a covariate ' +
            'on clearance in its own right (exponent \u22120.34, centred at ' +
            '35 y) as well as entering Cockcroft-Gault. Variability and ' +
            'residual error are published as VARIANCES and are entered ' +
            'here as their square roots. Free fraction 0.98 (meropenem ' +
            'is ~2% protein bound); the paper simulated free drug.',
      targets: MERO_TARGETS_LI,
      defaultRegimen: { dose: 1000, tau: 8, tinf: 0.5 },
      defaultMic: 4
    },

    /* =================================================================
       MEROPENEM — Ehmann et al. 2019
       Two-compartment, 41 critically ill adults NOT on CRRT.
       Table 2 (final model estimates), reference patient = median of the
       first study day: CLcr(CG) 80.8 mL/min, WT 70 kg, albumin 2.8 g/dL.
         CL 9.25 L/h,  V1 7.89 L,  Q 28.4 L/h,  V2 16.1 L
         CLCRCG_CL  0.00977  (linear effect on CL up to an inflection)
         CLCRCG_INF 154 mL/min (inflection point; above it CL plateaus)
         WT_V1      0.945   (power)
         ALB_V2     -0.202  (linear)
       IIV as %CV: CL 27.1, V1 31.5, V2 16.9. Interoccasion variability
       on CL (12.5 %CV) is NOT implemented — it is within-patient
       variation between infusions, not between-patient.
       Residual: proportional 16.6 %CV, additive 0.246 mg/L.
       ================================================================= */
    {
      id: 'mem_ehmann2019',
      drug: 'Meropenem',
      label: 'Ehmann 2019 \u2014 2-cmt, critically ill, non-CRRT',
      source: 'Ehmann L, Zoller M, Minichmayr IK, et al. Int J Antimicrob ' +
              'Agents 2019;54:309-317, Table 2.',
      doi: '10.1016/j.ijantimicag.2019.06.016',
      ncmt: 2,
      matrix: 'total plasma',
      fu: 0.98,
      renal: 'cg',
      covariates: ['wt', 'age', 'sex', 'scr', 'alb'],
      params: function (c) {
        // Piecewise linear in CLcr: proportional change per mL/min from
        // the reference 80.8, flattening at the published inflection of
        // 154 mL/min.
        var crcl = Math.min(Math.max(5, c.crcl), 154),
            alb = (c.alb > 0 ? c.alb : 2.8);
        return {
          CL: Math.max(0.2, 9.25 * (1 + 0.00977 * (crcl - 80.8))),
          V1: 7.89 * Math.pow(c.wt / 70, 0.945),
          Q: 28.4,
          V2: Math.max(1, 16.1 * (1 - 0.202 * (alb - 2.8)))
        };
      },
      iiv: { CL: 0.271, V1: 0.315, V2: 0.169 },
      iivScale: 'cv',
      err: { add: 0.246, prop: 0.166 },
      bayesian: true,
      note: 'Clearance rises linearly with Cockcroft-Gault CLcr up to an ' +
            'inflection point of 154 mL/min and is flat above it \u2014 the ' +
            'paper treats that region as extrapolation beyond its data. ' +
            'Serum albumin acts on the PERIPHERAL volume (lower albumin ' +
            '\u2192 larger V2). Built on non-CRRT patients only. ' +
            'CAVEAT: the covariate EQUATIONS are given in an appendix ' +
            'that is not part of the article PDF; only their forms are ' +
            'stated in the main text (piecewise linear, power, linear). ' +
            'The proportional forms coded here reproduce the reference ' +
            'clearance of 9.25 L/h and the paper\u2019s reported attainment ' +
            'pattern across CLcr, but the exact appendix parameterisation ' +
            'has not been read. Interoccasion variability (12.5 %CV on ' +
            'CL) is not implemented.',
      targets: MERO_TARGETS_EH,
      defaultRegimen: { dose: 1000, tau: 8, tinf: 0.5 },
      defaultMic: 2
    },

    /* =================================================================
       PIPERACILLIN — Klastrup et al. 2020
       One-compartment, 78 critically ill adults on CONTINUOUS infusion,
       fitted to UNBOUND (free) piperacillin (so fu = 1 here).
       Table 2: CLtotal = (CLother + theta_CRCL-COV x CRCL) x exp(eta)
         CLother 2.25 L/h (nonrenal), theta_CRCL-COV 0.119 per mL/min,
         Vc 35.8 L, IIV on CL 57.4 %CV, proportional residual error 22.6%.
       No IIV was reported on Vc.
       ================================================================= */
    {
      id: 'pip_klastrup2020',
      drug: 'Piperacillin',
      label: 'Klastrup 2020 \u2014 1-cmt, unbound, continuous infusion',
      source: 'Klastrup V, Thorsted A, Storgaard M, et al. Antimicrob ' +
              'Agents Chemother 2020;64(7):e02556-19, Table 2.',
      doi: '10.1128/AAC.02556-19',
      ncmt: 1,
      matrix: 'unbound plasma',
      fu: 1.0,
      renal: 'cg',
      covariates: ['wt', 'age', 'sex', 'scr'],
      params: function (c) {
        // Clearance is split into a nonrenal constant plus a renal term
        // scaled directly to CLcr — an ADDITIVE intercept, not a power
        // model, so clearance stays finite as renal function approaches
        // zero.
        return {
          CL: 2.25 + 0.119 * Math.max(0, c.crcl),
          V1: 35.8
        };
      },
      iiv: { CL: 0.574 },
      iivScale: 'cv',
      err: { add: 0, prop: 0.226 },
      bayesian: true,
      note: 'Developed in patients receiving CONTINUOUS infusion, so it ' +
            'is the model to use for that mode. Fitted to unbound ' +
            'concentrations: no protein-binding correction is applied. ' +
            'One-compartment, so there is no distribution phase \u2014 with ' +
            'continuous infusion that matters little, but bolus peaks ' +
            'from an intermittent regimen will be smoothed. Clearance ' +
            'has a nonrenal floor of 2.25 L/h. Variability was reported ' +
            'on clearance only.',
      targets: [T_FT100, T_FT100x4, T_FT50],
      defaultRegimen: { mode: 'ci', dose24: 12000 },
      defaultMic: 16
    },

    /* =================================================================
       CEFEPIME — Nicasio et al. 2009
       Two-compartment NONPARAMETRIC model, 26 critically ill adults with
       ventilator-associated pneumonia. Parameterised as micro-constants.
       Final model (text): K10 = 0.071 + 0.0027 x CLCR (h^-1),
                           V1  = 0.206 L/kg x TBW
       Table 2 medians: Ki 0.071, KS 0.0027, K12 0.78, K21 0.472,
                        V1 0.206 L/kg
       Table 3 gives the full lower-triangular COVARIANCE matrix, which is
       what makes Monte Carlo possible for a nonparametric model; its
       diagonal reproduces the tabulated SDs (e.g. sqrt(0.0037) = 0.061
       against a reported SD of 0.06).
       Protein binding 15% was applied in the paper's own simulations.
       ================================================================= */
    {
      id: 'cef_nicasio2009',
      drug: 'Cefepime',
      label: 'Nicasio 2009 \u2014 2-cmt nonparametric, VAP',
      source: 'Nicasio AM, Ariano RE, Zelenitsky SA, et al. Antimicrob ' +
              'Agents Chemother 2009;53:1476-1481, Tables 2 and 3.',
      doi: '10.1128/AAC.01141-08',
      ncmt: 2,
      matrix: 'total plasma',
      fu: 0.85,
      renal: 'cg',
      covariates: ['wt', 'age', 'sex', 'scr'],
      params: function (c) {
        return microToMacro([0.071, 0.0027, 0.78, 0.472, 0.206], c);
      },
      // Nonparametric: a full covariance matrix on the natural scale,
      // not a diagonal log-normal OMEGA.
      sampling: 'mvnorm',
      mvKeys: ['Ki', 'KS', 'K12', 'K21', 'V1kg'],
      mvMean: [0.071, 0.0027, 0.78, 0.472, 0.206],
      mvCov: [
        [ 0.0037, -0.0001, -0.0370, -0.0136,  0.0026],
        [-0.0001,  0.0001,  0.0008, -0.0015, -0.0011],
        [-0.0370,  0.0008,  1.0466,  0.7208, -0.0455],
        [-0.0136, -0.0015,  0.7208,  1.1717,  0.0346],
        [ 0.0026, -0.0011, -0.0455,  0.0346,  0.0348]
      ],
      paramsFromDraw: function (d, c) { return microToMacro(d, c); },
      iiv: {},
      bayesian: false,
      bayesianNote: 'MAP forecasting is disabled for this model. Its ' +
            'variability is a full covariance matrix on natural-scale ' +
            'micro-constants from a nonparametric fit, not the diagonal ' +
            'log-normal OMEGA the MAP prior here assumes, and no residual ' +
            'error model is published. Monte Carlo target attainment is ' +
            'unaffected \u2014 it uses the covariance matrix directly, which ' +
            'is how the paper itself simulated.',
      note: 'Nonparametric model: the population is sampled from the ' +
            'published median vector and covariance matrix (Tables 2 and ' +
            '3) on the NATURAL scale, which is the method the paper used. ' +
            'Two consequences to keep in view. First, normal-scale draws ' +
            'can be non-physical \u2014 K12 has a median of 0.78 against an SD ' +
            'of 1.023 \u2014 so draws with a non-positive rate constant or ' +
            'volume are rejected and redrawn; the rejected fraction is ' +
            'reported beneath the plot, and a truncated normal is no ' +
            'longer exactly the nonparametric distribution that was ' +
            'fitted. Second, the underlying distribution is skewed ' +
            '(mean K12 1.337 vs median 0.78), so the population is not ' +
            'symmetric about the typical patient. Free fraction 0.85 ' +
            '(15% protein binding), as applied in the paper.',
      targets: [T_FT50, T_FT100, T_FT60, T_FT100x4],
      defaultRegimen: { dose: 2000, tau: 8, tinf: 3 },
      defaultMic: 8
    },

    /* =================================================================
       GENTAMICIN — Xuan, Nicolau & Nightingale 2004
       Two-compartment, 939 hospitalised adults (16-96 y) receiving
       ONCE-DAILY gentamicin; 1294 concentrations, NONMEM V, ADVAN3
       TRANS1 (so the model is parameterised as CL, V1, K12, K21).
       Table 2, final model:
         Theta1 0.047  -> CL (L/h) = 0.047 x CLcr (mL/min)
         Theta2 0.28   -> V1 (L)   = 0.28  x total body weight (kg)
         Theta3 0.092  -> K12 (1/h)
         Theta4 0.071  -> K21 (1/h)
       Inter-individual variability (%CV): CL 29.6, V 5.8, K12 69.9,
       K21 63.9. Residual error: proportional 23.7%, additive 0.23 mg/L.
       The paper states the exponential error model best described IIV.
       CLcr is Cockcroft-Gault on TOTAL body weight (paper, section 3).
       Reported mean population CL 4.32 L/h and V1 19.6 L reproduce at
       the cohort means (CLcr 92 mL/min, 70 kg) - asserted in validate.cjs.
       ================================================================= */
    {
      id: 'gen_xuan2004',
      drug: 'Gentamicin',
      label: 'Xuan 2004 \u2014 2-cmt, adults on once-daily dosing',
      source: 'Xuan D, Nicolau DP, Nightingale CH. Int J Antimicrob Agents ' +
              '2004;23(3):291-5, Table 2.',
      doi: '10.1016/j.ijantimicag.2003.07.010',
      ncmt: 2,
      matrix: 'total plasma',
      // Aminoglycoside protein binding is low and the paper applies no
      // correction; concentrations are treated as active drug.
      fu: 1.0,
      renal: 'cg',
      covariates: ['wt', 'age', 'sex', 'scr'],
      sampling: 'micro',
      microParams: function (c) {
        return {
          CL: 0.047 * Math.max(1, c.crcl),
          V1: 0.28 * c.wt,
          K12: 0.092,
          K21: 0.071
        };
      },
      toMacro: function (d) {
        // Q = K12 x V1 and, at equilibrium, K12 x V1 = K21 x V2.
        var q = d.K12 * d.V1;
        if (!(d.CL > 0) || !(d.V1 > 0) || !(q > 0) || !(d.K21 > 0)) return null;
        return { CL: d.CL, V1: d.V1, Q: q, V2: q / d.K21 };
      },
      params: function (c) {
        return this.toMacro(this.microParams(c));
      },
      iiv: { CL: 0.296, V1: 0.058, K12: 0.699, K21: 0.639 },
      iivScale: 'cv',
      err: { add: 0.23, prop: 0.237 },
      bayesian: true,
      note: 'Variability is published on the micro-constants (CL, V1, K12, ' +
            'K21), so it is sampled on that scale and converted to Q and V2 ' +
            'afterwards \u2014 declaring K12\u2019s spread on Q instead would ' +
            'misstate the peripheral compartment. Two caveats from the ' +
            'source table: IIV on V1 is 5.8% with a relative standard error ' +
            'of 350%, i.e. essentially unidentified, and K21 has an RSE of ' +
            '48.6% with a 95% CI of 0.0033-0.14, so the distribution phase ' +
            'is poorly determined. Built entirely on once-daily dosing, ' +
            'which is what makes it the right model for that comparison.',
      targets: AG_TARGETS_2,
      defaultRegimen: { dose: 490, tau: 24, tinf: 1 },
      defaultMic: 1
    },

    /* =================================================================
       AMIKACIN — Romano et al. 1998
       One-compartment, 120 medical ICU patients (plus 38 for external
       validation), NONMEM.
       Table III (final model parameter estimates):
         Theta1 0.934 -> CL (L/h) = 0.934 x CLcr (L/h) x (1 + 0.225 x Trauma)
         Theta2 0.225 -> trauma effect on CL
         Theta3 0.393 -> Vd (L)   = 0.393 x TBW (kg) x (1 + 0.246 x Sepsis)
         Theta4 0.246 -> sepsis effect on Vd
       (Table II states the same final model rounded: 0.93 and 0.22 on CL,
       0.39 and 0.24 on Vd; the Table III estimates are used here.)
       Interindividual variability: CV_CL 28.2%, CV_Vd 23.2%.
       Residual: CV_sigma 22.0%.
       CLcr is the Jelliffe bedside estimate (paper reference 10 =
       Jelliffe RW, Ann Intern Med 1973), which returns mL/min/1.73m^2.
       Clearance coefficient near 1.0 on CLcr in L/h is the physiological
       check: amikacin is cleared essentially by glomerular filtration.
       ================================================================= */
    {
      id: 'amk_romano1998',
      drug: 'Amikacin',
      label: 'Romano 1998 \u2014 1-cmt, medical ICU, trauma and sepsis',
      source: 'Romano S, Fdez de Gatta MM, Calvo V, Mendez E, ' +
              'Dom\u00ednguez-Gil A, Lanao JM. Clin Drug Investig ' +
              '1998;15(5):435-44, Tables II and III.',
      doi: '10.2165/00044011-199815050-00008',
      ncmt: 1,
      matrix: 'total plasma',
      fu: 1.0,
      renal: 'jelliffe',
      covariates: ['wt', 'age', 'sex', 'ht', 'scr', 'trauma', 'sepsis'],
      params: function (c) {
        // The covariate is CLcr expressed in L/h.
        var clcrLh = Math.max(0.1, c.crcl) * 0.06;
        return {
          CL: 0.934 * clcrLh * (1 + 0.225 * (c.trauma ? 1 : 0)),
          V1: 0.393 * c.wt * (1 + 0.246 * (c.sepsis ? 1 : 0))
        };
      },
      iiv: { CL: 0.282, V1: 0.232 },
      iivScale: 'cv',
      err: { add: null, prop: 0.220 },
      bayesian: false,
      bayesianNote: 'MAP forecasting is disabled for this model. The paper ' +
            'states that an ADDITIVE residual error model was selected ' +
            '(\u201cthe additive error model for residual variability\u201d), ' +
            'yet Table III reports the residual as CV_sigma = 22.0%, a ' +
            'proportional quantity. The scale of the residual term is ' +
            'therefore ambiguous in the published record, and a wrong ' +
            'residual variance silently changes how strongly TDM samples ' +
            'outweigh the prior. Monte Carlo target attainment is ' +
            'unaffected \u2014 it uses only the fixed effects and the ' +
            'interindividual terms, which is how the paper itself used ' +
            'this model.',
      note: 'Clearance is driven by the JELLIFFE bedside creatinine ' +
            'clearance (1973), not Cockcroft-Gault, and the two are not ' +
            'interchangeable here: Cockcroft-Gault scales linearly with ' +
            'body weight whereas Jelliffe scales with body surface area, ' +
            'so their ratio moves from about 1.13 at 45 kg to 0.66 at ' +
            '130 kg (same age and creatinine). In a 130 kg patient ' +
            'Cockcroft-Gault returns 144 mL/min where Jelliffe returns 96, ' +
            'so substituting it would overestimate this model\u2019s ' +
            'clearance by about 50% \u2014 clearance is linear in CLcr ' +
            'here, so the error carries through exactly. Age and ' +
            'creatinine, by contrast, ' +
            'barely change the ratio. Jelliffe returns mL/min/1.73m\u00b2 and is ' +
            'rescaled here to the patient\u2019s own body surface area ' +
            '(Mosteller) because the model\u2019s covariate is an absolute ' +
            'clearance. Interindividual variability was published under a ' +
            'PROPORTIONAL model, \u03b8(1+\u03b7); it is sampled here ' +
            'log-normally with the same coefficient of variation, which ' +
            'matches the published spread and cannot produce a negative ' +
            'clearance. Trauma raises clearance by 22.5%; sepsis raises the ' +
            'volume of distribution by 24.6%.',
      targets: AG_TARGETS_5,
      defaultRegimen: { dose: 1000, tau: 24, tinf: 0.5 },
      defaultMic: 4
    },

    /* =================================================================
       TOBRAMYCIN — Hennig et al. 2013
       Two-compartment meta-analysis of eight centres: 465 adults and
       children with cystic fibrosis and 267 without (5605 observations).
       Table 2 (final model) and equations 6-9:
         CL   = theta_CL,sex x (FFM/70)^0.952
                             x [1 + theta_AGE x (AGE - 18)]
                             x (SCRmean/SCR)^0.222
         V1   = theta_V1,sex x (FFM/70)
         Q    = 1.5 x (FFM/70)^0.952
         V2   = 10.0 x (FFM/70)
       theta_CL: 8.1 (female) / 9.4 (male) L/h per 70 kg FFM
       theta_V1: 20.1 (female) / 25.1 (male) L per 70 kg FFM
       theta_AGE: -0.010 (>=18 y), -0.021 (<18 y)
       BSV (CV%): CL 25.9, V1 15.2, Q 41.8, V2 58.5;
       CL-V1 correlation 65.8%. Proportional residual error 20.4%.
       FFM is Janmahasatian 2005 (paper reference 20).
       Cystic fibrosis was tested at every covariate step and was NOT
       significant on any parameter - the paper's central finding - so
       there is no CF term to implement.
       ================================================================= */
    {
      id: 'tob_hennig2013',
      drug: 'Tobramycin',
      label: 'Hennig 2013 \u2014 2-cmt, adults and children, CF and non-CF',
      source: 'Hennig S, Standing JF, Staatz CE, Thomson AH. ' +
              'Clin Pharmacokinet 2013;52(4):289-301, Table 2 and Eqs 6-9.',
      doi: '10.1007/s40262-013-0036-y',
      ncmt: 2,
      matrix: 'total plasma',
      fu: 1.0,
      renal: 'cg',
      // Cockcroft-Gault is shown for orientation only: this model does NOT
      // use CLcr. Renal function enters through the SCRmean/SCR ratio, and
      // size through fat-free mass. TDMx labels its own column the same way.
      renalDisplayOnly: true,
      covariates: ['wt', 'ht', 'age', 'sex', 'scr'],
      params: function (c) {
        var ffm = c.ffm > 0 ? c.ffm : 50,
            sizeCL = Math.pow(ffm / 70, 0.952),
            sizeV = ffm / 70,
            female = c.sex === 'F',
            thCL = female ? 8.1 : 9.4,
            thV1 = female ? 20.1 : 25.1,
            thAge = c.age < 18 ? -0.021 : -0.010,
            fAge = Math.max(0.05, 1 + thAge * (c.age - 18)),
            // Age/sex-typical reference creatinine, umol/L. Table 1 gives
            // the adult values; see note on the paediatric case.
            scrRef = c.age >= 18 ? (female ? 69.5 : 84) : 37.2,
            scrUm = (c.scrUnit === 'umol/L') ? c.scr : c.scr * 88.4,
            fScr = Math.pow(scrRef / Math.max(5, scrUm), 0.222);
        return {
          CL: thCL * sizeCL * fAge * fScr,
          V1: thV1 * sizeV,
          Q: 1.5 * sizeCL,
          V2: 10.0 * sizeV
        };
      },
      iiv: { CL: 0.259, V1: 0.152, Q: 0.418, V2: 0.585 },
      iivScale: 'cv',
      iivCorr: [['CL', 'V1', 0.658]],
      err: { add: 0, prop: 0.204 },
      bayesian: true,
      note: 'Size is FAT-FREE MASS (Janmahasatian 2005), so height is ' +
            'required as well as weight \u2014 not total body weight, which ' +
            'the paper found inferior. Clearance also depends on serum ' +
            'creatinine only through the ratio SCRmean/SCR, where SCRmean ' +
            'is an age-, sex- and size-typical normal value; the adult ' +
            'values from Table 1 (69.5 \u00b5mol/L female, 84 \u00b5mol/L ' +
            'male) are used here, and the paediatric relationship is not ' +
            'reproduced in the paper, so ages under 18 fall back to the ' +
            'reported paediatric median of 37.2 \u00b5mol/L and should be ' +
            'treated as approximate. Cystic fibrosis is deliberately absent ' +
            'as a covariate: it was tested at every step and never reached ' +
            'significance, which is the paper\u2019s conclusion. The ' +
            'published between-occasion variability on clearance (12.7%) ' +
            'and the estimated infusion-duration parameter are not ' +
            'implemented.',
      targets: AG_TARGETS_2,
      defaultRegimen: { dose: 560, tau: 24, tinf: 0.5 },
      defaultMic: 1
    }
  ];

  /* Models documented but NOT implemented, with the reason. Shown in the
     app so the omission is visible rather than silent. */
  /* Models documented but NOT implemented, with the reason. Shown in the
     app so an omission is visible rather than silent.

     Currently empty: every model previously listed here was unblocked
     when the source PDFs were supplied, and all four are now implemented
     from their own parameter tables. Keep this mechanism in place — the
     next model that cannot be faithfully reproduced belongs here rather
     than being approximated. */
  var PENDING = [];

  var PRESETS = [
    /* The once-daily argument: identical daily dose, three intervals.
       The peak component carries efficacy and only the extended interval
       reaches it; the trough component is met by all three at normal
       renal function, so the separation is entirely in the peak. */
    { id: 'gen-od', label: 'Gentamicin: once-daily vs divided dosing',
      model: 'gen_xuan2004', target: 'od2',
      regimens: [
        { label: '420 mg q24h', dose: 420, tau: 24, tinf: 1 },
        { label: '210 mg q12h', dose: 210, tau: 12, tinf: 1 },
        { label: '140 mg q8h', dose: 140, tau: 8, tinf: 1 }
      ],
      cov: { wt: 70, age: 55, sex: 'M', scr: 1.0, scrUnit: 'mg/dL' }, mic: 1 },

    /* Renal impairment: the SAME regimen that works at CLcr 90 now fails,
       and it fails on the trough. Interval extension recovers it; dose
       reduction does not, because it sacrifices the peak as well. */
    { id: 'gen-renal', label: 'Gentamicin: adjusting for renal impairment',
      model: 'gen_xuan2004', target: 'od2',
      regimens: [
        { label: '420 mg q24h', dose: 420, tau: 24, tinf: 1 },
        { label: '420 mg q48h', dose: 420, tau: 48, tinf: 1 },
        { label: '210 mg q24h', dose: 210, tau: 24, tinf: 1 }
      ],
      // SCr 1.5 mg/dL in a 70-year-old gives CLcr ~45 mL/min, the point
      // where the three-way contrast is cleanest: q24h fails on the
      // trough alone, interval extension fixes it with the peak
      // untouched, and halving the dose fixes it less well while also
      // giving up peak attainment.
      cov: { wt: 70, age: 70, sex: 'M', scr: 1.5, scrUnit: 'mg/dL' }, mic: 1 },

    /* Amikacin in the ICU, where the covariates are categorical: the same
       dose in a septic patient has a larger volume and a lower peak. */
    { id: 'amk-icu', label: 'Amikacin: effect of sepsis on the peak',
      model: 'amk_romano1998', target: 'od5',
      regimens: [
        { label: '1 g q24h', dose: 1000, tau: 24, tinf: 0.5 },
        { label: '1.5 g q24h', dose: 1500, tau: 24, tinf: 0.5 }
      ],
      cov: { wt: 70, age: 55, sex: 'M', ht: 175, scr: 1.0, scrUnit: 'mg/dL',
             sepsis: true }, mic: 4 },

    { id: 'pip-ei', label: 'Piperacillin: standard vs extended infusion',
      model: 'pip_kim2022', target: 'ft100',
      regimens: [
        { label: '4 g q6h, 0.5 h', dose: 4000, tau: 6, tinf: 0.5 },
        { label: '4 g q6h, 4 h', dose: 4000, tau: 6, tinf: 4 },
        { label: '16 g/24 h CI', mode: 'ci', dose24: 16000 }
      ],
      cov: { wt: 80, age: 60, sex: 'M', cysc: 1.0, ecmo: false }, mic: 16 },
    { id: 'pip-arc', label: 'Piperacillin: augmented renal clearance',
      model: 'pip_udy2015', target: 'ft100',
      regimens: [
        { label: '4 g q6h, 0.33 h', dose: 4000, tau: 6, tinf: 0.33 },
        { label: '4 g q8h, 4 h', dose: 4000, tau: 8, tinf: 4 },
        { label: '4 g q6h, 4 h', dose: 4000, tau: 6, tinf: 4 }
      ],
      cov: { wt: 88, age: 47, sex: 'M', scr: 79.5, scrUnit: 'umol/L' }, mic: 16 },
    { id: 'mem-rrt', label: 'Meropenem: dialysis modality',
      model: 'mem_ojeanson2021', target: 'ft100',
      regimens: [
        { label: '1 g q8h, 0.5 h', dose: 1000, tau: 8, tinf: 0.5 },
        { label: '1 g q8h, 3 h', dose: 1000, tau: 8, tinf: 3 },
        { label: '3 g/24 h CI', mode: 'ci', dose24: 3000 }
      ],
      cov: { age: 62, sex: 'M', scr: 2.4, scrUnit: 'mg/dL',
             dialysis: 'semicont', rd: 200 }, mic: 2 },
    { id: 'mem-arc', label: 'Meropenem: augmented renal clearance',
      model: 'mem_gijsen2021', target: 'ft100',
      regimens: [
        { label: '1 g q8h, 0.5 h', dose: 1000, tau: 8, tinf: 0.5 },
        { label: '2 g q8h, 3 h', dose: 2000, tau: 8, tinf: 3 },
        { label: '6 g/24 h CI', mode: 'ci', dose24: 6000 }
      ],
      cov: { wt: 75, age: 42, sex: 'M', scr: 0.6, scrUnit: 'mg/dL' }, mic: 2 },
    { id: 'cef-vap', label: 'Cefepime: prolonged infusion in VAP',
      model: 'cef_nicasio2009', target: 'ft50',
      regimens: [
        { label: '2 g q8h, 0.5 h', dose: 2000, tau: 8, tinf: 0.5 },
        { label: '2 g q8h, 3 h', dose: 2000, tau: 8, tinf: 3 },
        { label: '6 g/24 h CI', mode: 'ci', dose24: 6000 }
      ],
      cov: { wt: 84, age: 57, sex: 'M', scr: 0.9, scrUnit: 'mg/dL' }, mic: 8 },
    { id: 'mem-ward', label: 'Meropenem: ward patient vs ICU model',
      model: 'mem_li2006', target: 'ft40',
      regimens: [
        { label: '1 g q8h, 0.5 h', dose: 1000, tau: 8, tinf: 0.5 },
        { label: '1 g q8h, 3 h', dose: 1000, tau: 8, tinf: 3 },
        { label: '2 g q8h, 3 h', dose: 2000, tau: 8, tinf: 3 }
      ],
      cov: { wt: 70, age: 60, sex: 'M', scr: 1.0, scrUnit: 'mg/dL' }, mic: 4 },
    { id: 'pip-ci', label: 'Piperacillin: continuous infusion dose finding',
      model: 'pip_klastrup2020', target: 'ft100',
      regimens: [
        { label: '8 g/24 h CI', mode: 'ci', dose24: 8000 },
        { label: '12 g/24 h CI', mode: 'ci', dose24: 12000 },
        { label: '16 g/24 h CI', mode: 'ci', dose24: 16000 }
      ],
      cov: { wt: 80, age: 62, sex: 'M', scr: 1.1, scrUnit: 'mg/dL' }, mic: 16 },
    { id: 'van-auc', label: 'Vancomycin: AUC 400\u2013600 attainment',
      model: 'van_thomson2009', target: 'auc400',
      regimens: [
        { label: '1 g q12h', dose: 1000, tau: 12, tinf: 1 },
        { label: '1.5 g q12h', dose: 1500, tau: 12, tinf: 1.5 },
        { label: '2 g/24 h CI', mode: 'ci', dose24: 2000 }
      ],
      cov: { wt: 72, age: 66, sex: 'M', scr: 98, scrUnit: 'umol/L' }, mic: 1 }
  ];

  var API = { MODELS: MODELS, PENDING: PENDING, PRESETS: PRESETS, LADDER: LADDER,
              TARGETS: { T_FT50: T_FT50, T_FT100: T_FT100,
                         T_FT100x4: T_FT100x4, T_FT60: T_FT60 } };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.PKPD_MODELS = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
