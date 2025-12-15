import { validateSlide } from "../stages/design/qa-validator.js";
import { runExport } from "../export/export-integration.js";
import { checkHardGates } from "./hard-gates.js";
import { computeScenarioScore } from "./scenario-scorer.js";
import { generateEvaluationReport } from "./evaluation-report.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function getEmitFn(stageApi) {
  const emit = stageApi?.emit || stageApi?.eventBus?.emit;
  return typeof emit === "function" ? emit : null;
}

function extractSlideSections(deckHtmlDsl) {
  const html = String(deckHtmlDsl || "");
  if (!html.trim()) return [];

  // Simple, robust-enough extractor for <section ...>...</section> blocks.
  const out = [];
  const re = /<section\b[\s\S]*?<\/section>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[0]);
  return out;
}

function buildLintReport(runId, deckPackage) {
  const slidesMeta = safeArray(deckPackage?.slidesMeta);
  const violations = [];
  const counts = { min_font: 0, overflow_x: 0, overflow_y: 0, contrast: 0, total: 0 };

  const pushIssue = (slideNo, issue) => {
    const code = String(issue?.code || issue?.type || "unknown");
    const severity = String(issue?.severity || "warn");
    const message = String(issue?.message || "");
    violations.push({ slideNo, code, severity, message, ...(issue?.elementId ? { elementId: String(issue.elementId) } : {}) });
    counts.total++;
    if (code in counts) counts[code]++;
  };

  if (slidesMeta.length && slidesMeta.every((m) => isPlainObject(m?.qa))) {
    for (const m of slidesMeta) {
      const slideNo = Number(m?.slideNo) || undefined;
      const issues = safeArray(m?.qa?.issues);
      for (const it of issues) pushIssue(slideNo, it);
    }
  } else {
    const sections = extractSlideSections(deckPackage?.deckHtmlDsl);
    for (let i = 0; i < sections.length; i++) {
      const qa = validateSlide(sections[i]);
      const slideNo = i + 1;
      for (const it of safeArray(qa?.issues)) pushIssue(slideNo, it);
    }
  }

  const overflow = counts.overflow_x + counts.overflow_y;
  return {
    schemaVersion: "0.1",
    runId,
    createdAt: new Date().toISOString(),
    counts: {
      min_font: counts.min_font,
      overflow_x: counts.overflow_x,
      overflow_y: counts.overflow_y,
      overflow,
      contrast: counts.contrast,
      total: counts.total,
    },
    violations,
  };
}

function computeMetrics(contentPackage, deckPackage, exportResult, lintReport, hardGates) {
  const claims = safeArray(contentPackage?.claims);
  const evidences = safeArray(contentPackage?.evidenceLedger);
  const claimsWithEvidence = claims.filter((c) => Array.isArray(c?.evidenceIds) && c.evidenceIds.length >= 1).length;

  const keySlides = safeArray(hardGates?.details?.G10?.keySlides);
  const keyRatios = keySlides.map((k) => Number(k?.ratio)).filter((n) => Number.isFinite(n));
  const keyAvg = keyRatios.length ? keyRatios.reduce((a, b) => a + b, 0) / keyRatios.length : undefined;
  const keyMin = keyRatios.length ? Math.min(...keyRatios) : undefined;

  return {
    slidesCount: safeArray(deckPackage?.slidesMeta).length || undefined,
    claimsCount: claims.length,
    evidenceCount: evidences.length,
    claimsWithEvidenceRate: claims.length ? claimsWithEvidence / claims.length : 1,
    export: isPlainObject(exportResult?.formats) ? exportResult.formats : exportResult,
    lint: isPlainObject(lintReport?.counts) ? lintReport.counts : undefined,
    editability: {
      ...(typeof keyAvg === "number" ? { keySlidesAvg: keyAvg } : {}),
      ...(typeof keyMin === "number" ? { keySlidesMin: keyMin } : {}),
    },
    // Scenario scorer consumes dimension scores; keep it explicit.
    dimensions: {
      Faithfulness: 80,
      Provenance: hardGates?.details?.G9?.hasSourceTextForAny ? 90 : 75,
      Narrative: 75,
      Visual: lintReport?.counts?.total === 0 ? 90 : 60,
      Editability: typeof keyAvg === "number" ? Math.round(keyAvg * 100) : 70,
      Efficiency: 50,
    },
  };
}

export class EvaluateStage {
  constructor({ editabilityThreshold = 0.6 } = {}) {
    this.editabilityThreshold = editabilityThreshold;
  }

  /**
   * Stage interface: execute(runContext, contentPackage, deckPackage) -> EvaluationReport.
   * Also supports orchestrator shape: execute(runContext, {contentPackage,deckPackage}, stageApi)
   */
  async execute(runContext, contentPackageOrInput, deckPackageMaybe, stageApi = {}) {
    const emit = getEmitFn(stageApi);
    const runId = String(runContext?.runId || contentPackageOrInput?.runId || deckPackageMaybe?.runId || "run_unknown");

    const { contentPackage, deckPackage } =
      deckPackageMaybe === undefined && isPlainObject(contentPackageOrInput) && isPlainObject(contentPackageOrInput?.contentPackage)
        ? { contentPackage: contentPackageOrInput.contentPackage, deckPackage: contentPackageOrInput.deckPackage }
        : { contentPackage: contentPackageOrInput, deckPackage: deckPackageMaybe };

    // Parse once so export + hard-gates can share.
    let slides = null;
    if (globalThis?.SlideParser?.parse) {
      try {
        slides = globalThis.SlideParser.parse(deckPackage?.deckHtmlDsl);
      } catch {
        slides = null;
      }
    }

    const exportResult = await runExport(deckPackage, {
      runId,
      slides,
      ...(isPlainObject(stageApi?.exportOptions) ? stageApi.exportOptions : {}),
    });

    const lintReport = buildLintReport(runId, deckPackage);

    const hardGates = checkHardGates(contentPackage, deckPackage, exportResult, lintReport, {
      parsedSlides: slides,
      editabilityThreshold: this.editabilityThreshold,
    });

    emit?.("evaluate.hardgates.completed", {
      actor: "evaluate",
      status: "ended",
      payload: { pass: hardGates.pass, failed: hardGates.failed },
    });

    const metrics = computeMetrics(contentPackage, deckPackage, exportResult, lintReport, hardGates);

    const scenario = runContext?.scenario || contentPackage?.constraints?.tone || null;
    const scenarioScore = scenario ? computeScenarioScore(scenario, metrics) : undefined;
    if (scenarioScore) {
      emit?.("evaluate.scenarioscore.completed", {
        actor: "evaluate",
        status: "ended",
        payload: { scenario, score: scenarioScore.score },
      });
    }

    const report = generateEvaluationReport(runId, hardGates, scenarioScore, metrics);

    // Optional: persist artifacts if a RunStore-like object is provided.
    if (stageApi?.runStore && typeof stageApi.runStore.saveArtifact === "function") {
      await stageApi.runStore.saveArtifact(runId, "export_report.json", exportResult);
      await stageApi.runStore.saveArtifact(runId, "lint_report.json", lintReport);
      await stageApi.runStore.saveArtifact(runId, "evaluation_report.json", report);
    }

    return report;
  }
}

export async function runEvaluateStage(runContext, input, stageApi = {}) {
  const stage = new EvaluateStage();
  return stage.execute(runContext, input, undefined, stageApi);
}
