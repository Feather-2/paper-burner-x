/**
 * ReAct Reviewer - Iterative report review via Reason-Act-Observe cycle
 *
 * Implements a ReAct-style agent that reviews reports through tool-assisted iterations:
 * - Level 1: Internal tools (word count, section view, evidence search)
 * - Level 2: Source expansion (deeper context from original documents)
 * - Level 3: External search (new evidence from web when internal insufficient)
 *
 * Core loop:
 * 1. Model generates thought + action/finish
 * 2. Execute action via toolExecutor
 * 3. Return observation with available tools
 * 4. Validate finish conditions (qualityScore >= 7, remainingIssues <= 3)
 * 5. Enforce hardLimit=15 steps
 */

import { extractJsonCandidate, checkCancelled } from "./state.js";
import { getModelCaller } from "./model.js";
import { countWordsApprox } from "./report-diff.js";
import { isPlainObject, toNonEmptyString, safeInt, safeNumber } from "../../shared/value-utils.js";

// Tool availability by level
const LEVEL_1_TOOLS = ["getWordCount", "getSectionFull", "searchEvidence", "getEvidence", "applyPatch"];
const LEVEL_2_TOOLS = [...LEVEL_1_TOOLS, "getSourceChunk"];
const LEVEL_3_TOOLS = [...LEVEL_2_TOOLS, "externalSearch"];

const TOOL_REGISTRY = {
  1: LEVEL_1_TOOLS,
  2: LEVEL_2_TOOLS,
  3: LEVEL_3_TOOLS,
};

/**
 * Determines available tools based on current level.
 * @param {1|2|3} level - Current tool access level
 * @returns {string[]} - Available tool names
 */
function getAvailableTools(level) {
  const normalizedLevel = [1, 2, 3].includes(level) ? level : 1;
  return TOOL_REGISTRY[normalizedLevel] || LEVEL_1_TOOLS;
}

/**
 * Validates step schema from model output.
 * @param {any} step - Parsed JSON step
 * @returns {{valid: boolean, error?: string}}
 */
function validateStepSchema(step) {
  if (!isPlainObject(step)) {
    return { valid: false, error: "Step must be a JSON object" };
  }

  // thought is optional
  // Must have either action OR finish (not both)
  const hasAction = isPlainObject(step.action);
  const hasFinish = isPlainObject(step.finish);

  if (hasAction && hasFinish) {
    return { valid: false, error: "Step cannot have both 'action' and 'finish'" };
  }

  if (!hasAction && !hasFinish) {
    return { valid: false, error: "Step must have either 'action' or 'finish'" };
  }

  // Validate action schema
  if (hasAction) {
    if (!toNonEmptyString(step.action.tool)) {
      return { valid: false, error: "Action must specify 'tool' name" };
    }
    if (!isPlainObject(step.action.params)) {
      return { valid: false, error: "Action must provide 'params' object" };
    }
  }

  // Validate finish schema
  if (hasFinish) {
    const score = safeNumber(step.finish.qualityScore);
    if (score === null || score < 1 || score > 10) {
      return { valid: false, error: "Finish qualityScore must be 1-10" };
    }

    const issues = safeInt(step.finish.remainingIssues);
    if (issues === null || issues < 0) {
      return { valid: false, error: "Finish remainingIssues must be >= 0" };
    }

    if (!Array.isArray(step.finish.patchPlan)) {
      return { valid: false, error: "Finish must include patchPlan array" };
    }
  }

  return { valid: true };
}

/**
 * Checks if finish conditions meet quality bar.
 * @param {{qualityScore: number, remainingIssues: number}} finish
 * @returns {{accepted: boolean, reason?: string}}
 */
function validateFinishConditions(finish) {
  const score = safeNumber(finish?.qualityScore);
  const issues = safeInt(finish?.remainingIssues);

  if (score === null || issues === null) {
    return { accepted: false, reason: "Invalid finish data" };
  }

  if (score < 7) {
    return { accepted: false, reason: `Quality score ${score} below minimum 7` };
  }

  if (issues > 3) {
    return { accepted: false, reason: `Remaining issues ${issues} exceeds maximum 3` };
  }

  return { accepted: true };
}

/**
 * Determines if tool access level should be upgraded.
 * @param {object} state - Level upgrade state
 * @param {string} toolName - Tool that was just called
 * @param {any} result - Tool call result
 * @param {number} currentWordCount - Current report word count
 * @param {number} targetWordCount - Target report word count
 * @param {number} stepIndex - Current iteration number
 * @returns {1|2|3} - New level (may be unchanged)
 */
function determineNextLevel(state, toolName, result, currentWordCount, targetWordCount, stepIndex) {
  const { currentLevel, searchEvidence_lowResultCount, getSourceChunk_callCount } = state;

  // Level 1 → Level 2: searchEvidence returns < 3 results
  if (currentLevel === 1) {
    if (toolName === "searchEvidence") {
      const resultCount = Array.isArray(result?.data) ? result.data.length : 0;
      if (resultCount < 3) {
        state.searchEvidence_lowResultCount = (state.searchEvidence_lowResultCount || 0) + 1;
        if (state.searchEvidence_lowResultCount >= 1) {
          return 2;
        }
      }
    }
  }

  // Level 2 → Level 3: getSourceChunk called multiple times, word delta > 500, iteration >= 3
  if (currentLevel === 2) {
    if (toolName === "getSourceChunk") {
      state.getSourceChunk_callCount = (state.getSourceChunk_callCount || 0) + 1;
    }

    const wordDelta = Math.abs(currentWordCount - targetWordCount);
    if (state.getSourceChunk_callCount >= 2 && wordDelta > 500 && stepIndex >= 3) {
      return 3;
    }
  }

  return currentLevel;
}

/**
 * Builds system + user messages for ReAct loop.
 * @param {object} report - Report structure {markdown, wordCount, sections}
 * @param {object} context - Context {evidenceLedger, claims, sources}
 * @param {string[]} availableTools - Tools accessible at current level
 * @param {object[]} previousSteps - History of thought/action/observation
 * @param {number} recommendedSteps - Soft guidance for iteration count
 * @param {number} stepIndex - Current step number
 * @returns {object[]} - Messages array for model
 */
function buildReactPrompt(report, context, availableTools, previousSteps, recommendedSteps, stepIndex) {
  const systemContent = `You are a research report reviewer using ReAct (Reason + Act) methodology.

STEP SCHEMA (return ONLY valid JSON):
{
  "thought": "Your reasoning about current state and next action",
  "action": {
    "tool": "toolName",
    "params": { /* tool-specific parameters */ }
  }
}
OR
{
  "thought": "Final quality assessment",
  "finish": {
    "qualityScore": 8.5,  // 1-10 scale
    "remainingIssues": 1,
    "patchPlan": [ /* patch operations */ ]
  }
}

AVAILABLE TOOLS: ${availableTools.join(", ")}

FINISH CONDITIONS:
- qualityScore >= 7 (else rejected, continue review)
- remainingIssues <= 3 (else rejected, continue review)

GUIDANCE: Recommended ${recommendedSteps} steps, you're at step ${stepIndex}. Complete sooner if quality met, or continue beyond if needed.

IMPORTANT: Return ONLY JSON matching schema above. No extra text.`;

  const reportSummary = {
    title: toNonEmptyString(report?.title) || "Untitled Report",
    wordCount: report?.wordCount || 0,
    sectionCount: Array.isArray(report?.sections) ? report.sections.length : 0,
    sections: Array.isArray(report?.sections)
      ? report.sections.map(s => ({
          sectionId: s.sectionId,
          title: s.title,
          wordCount: s.wordCount || 0,
        }))
      : [],
  };

  const contextSummary = {
    evidenceCount: Array.isArray(context?.evidenceLedger) ? context.evidenceLedger.length : 0,
    claimCount: Array.isArray(context?.claims) ? context.claims.length : 0,
    sourceCount: Array.isArray(context?.sources) ? context.sources.length : 0,
  };

  const history = previousSteps.map((step, i) => ({
    step: i + 1,
    thought: step.thought,
    action: step.action || null,
    observation: step.observation || null,
  }));

  const userContent = JSON.stringify({
    report: reportSummary,
    context: contextSummary,
    history,
    availableTools,
  }, null, 2);

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}

/**
 * Main ReAct reviewer loop.
 *
 * @param {object} report - Report to review: {markdown, wordCount, sections}
 * @param {object} context - Review context: {state, evidenceLedger, claims, sources, stageApi}
 * @param {object} options - Configuration
 * @param {number} [options.recommendedSteps=5] - Soft guidance for iteration count
 * @param {number} [options.hardLimit=15] - Hard stop at this many iterations
 * @param {Function} options.toolExecutor - async (toolName, params) => {success, data?, error?}
 * @param {Function} [options.onStep] - Callback after each step
 * @returns {Promise<{finalReport, steps, qualityScore, toolCalls}>}
 */
export async function runReactReviewer(report, context, options = {}) {
  // Validate inputs
  if (!isPlainObject(report)) {
    throw new TypeError("runReactReviewer: report must be an object");
  }
  if (!isPlainObject(context)) {
    throw new TypeError("runReactReviewer: context must be an object");
  }
  if (typeof options.toolExecutor !== "function") {
    throw new TypeError("runReactReviewer: options.toolExecutor must be a function");
  }

  const recommendedSteps = safeInt(options.recommendedSteps) ?? 5;
  const hardLimit = safeInt(options.hardLimit) ?? 15;
  const toolExecutor = options.toolExecutor;
  const onStep = typeof options.onStep === "function" ? options.onStep : null;

  const { state, stageApi } = context;
  const emit = typeof stageApi?.emit === "function"
    ? (name, payload) => stageApi.emit(name, { actor: "deepsearch", status: "completed", payload })
    : null;

  // Get model caller
  const callModel = getModelCaller(stageApi, { usage: "reviewer", state });
  if (!callModel) {
    throw new Error("runReactReviewer: Failed to get model caller");
  }

  // Initialize level upgrade state
  const levelState = {
    currentLevel: 1,
    searchEvidence_lowResultCount: 0,
    getSourceChunk_callCount: 0,
  };

  const steps = [];
  const toolCalls = [];
  let currentReport = report;
  // Ensure wordCount is present
  if (!currentReport.wordCount) {
    currentReport.wordCount = countWordsApprox(currentReport.markdown || currentReport.draftMarkdown || "");
  }
  let finalFinish = null;

  // Main ReAct loop
  for (let stepIndex = 1; stepIndex <= hardLimit; stepIndex++) {
    checkCancelled(stageApi);

    const availableTools = TOOL_REGISTRY[levelState.currentLevel] || LEVEL_1_TOOLS;
    const messages = buildReactPrompt(
      currentReport,
      context,
      availableTools,
      steps,
      recommendedSteps,
      stepIndex
    );

    // Call model
    const startTime = Date.now();
    let modelResult;
    try {
      modelResult = await callModel(messages, {
        model: "auto",
        temperature: 0.3,
        maxTokens: 2000,
      });
    } catch (err) {
      // Model call failed - emit error and break
      emit?.("deepsearch.write.react.error", {
        stepIndex,
        error: String(err.message || err),
        phase: "model_call",
      });
      throw err;
    }

    const rawContent = modelResult?.content || "";
    const candidate = extractJsonCandidate(rawContent);

    let parsedStep = null;
    let parseError = null;

    if (candidate) {
      try {
        parsedStep = JSON.parse(candidate);
      } catch (err) {
        parseError = `JSON parse failed: ${err.message}`;
      }
    } else {
      parseError = "No JSON candidate found in model output";
    }

    // Retry once on parse failure
    if (parseError && stepIndex === 1) {
      emit?.("deepsearch.write.react.parse_retry", {
        stepIndex,
        error: parseError,
        rawOutput: rawContent.slice(0, 200),
      });

      // Simple retry with more explicit prompt
      const retryMessages = [
        { role: "system", content: "Return ONLY valid JSON. No markdown, no extra text." },
        ...messages,
      ];

      try {
        const retryResult = await callModel(retryMessages, {
          model: "auto",
          temperature: 0.1,
          maxTokens: 2000,
        });
        const retryCandidate = extractJsonCandidate(retryResult?.content || "");
        if (retryCandidate) {
          parsedStep = JSON.parse(retryCandidate);
          parseError = null;
        }
      } catch {
        // Retry failed, continue with error
      }
    }

    if (parseError) {
      emit?.("deepsearch.write.react.parse_error", {
        stepIndex,
        error: parseError,
        rawOutput: rawContent.slice(0, 200),
      });
      throw new Error(`ReAct step ${stepIndex} parse failed: ${parseError}`);
    }

    // Validate step schema
    const validation = validateStepSchema(parsedStep);
    if (!validation.valid) {
      emit?.("deepsearch.write.react.validation_error", {
        stepIndex,
        error: validation.error,
        step: parsedStep,
      });
      throw new Error(`ReAct step ${stepIndex} validation failed: ${validation.error}`);
    }

    const thought = parsedStep.thought;
    const hasAction = isPlainObject(parsedStep.action);
    const hasFinish = isPlainObject(parsedStep.finish);

    // Handle action
    if (hasAction) {
      const toolName = parsedStep.action.tool;
      const params = parsedStep.action.params;

      // Check tool availability
      if (!availableTools.includes(toolName)) {
        const observation = {
          success: false,
          error: `Tool '${toolName}' not available at current level. Available: ${availableTools.join(", ")}`,
          availableTools,
        };

        steps.push({
          stepIndex,
          thought,
          action: { tool: toolName, params },
          observation,
          duration: Date.now() - startTime,
        });

        emit?.("deepsearch.write.react.step", {
          stepIndex,
          thought,
          tool: toolName,
          params,
          result: observation,
          duration: Date.now() - startTime,
        });

        onStep?.({ stepIndex, thought, action: parsedStep.action, observation });
        continue;
      }

      // Execute tool
      let toolResult;
      try {
        toolResult = await toolExecutor(toolName, params);
      } catch (err) {
        toolResult = {
          success: false,
          error: `Tool execution failed: ${err.message}`,
        };
      }

      toolCalls.push({
        stepIndex,
        tool: toolName,
        params,
        result: toolResult,
        timestamp: new Date().toISOString(),
      });

      // Determine next level
      const currentWordCount = currentReport?.wordCount || 0;
      const targetWordCount = context?.targetWordCount || currentWordCount;
      const nextLevel = determineNextLevel(
        levelState,
        toolName,
        toolResult,
        currentWordCount,
        targetWordCount,
        stepIndex
      );

      if (nextLevel > levelState.currentLevel) {
        levelState.currentLevel = nextLevel;
        emit?.("deepsearch.write.react.level_upgrade", {
          stepIndex,
          fromLevel: levelState.currentLevel,
          toLevel: nextLevel,
          reason: toolName,
        });
      }

      // Build observation
      const observation = {
        ...toolResult,
        availableTools: TOOL_REGISTRY[levelState.currentLevel] || LEVEL_1_TOOLS,
        currentLevel: levelState.currentLevel,
      };

      steps.push({
        stepIndex,
        thought,
        action: { tool: toolName, params },
        observation,
        duration: Date.now() - startTime,
      });

      emit?.("deepsearch.write.react.step", {
        stepIndex,
        thought,
        tool: toolName,
        params,
        result: toolResult,
        duration: Date.now() - startTime,
      });

      onStep?.({ stepIndex, thought, action: parsedStep.action, observation });

      // Update current report if applyPatch was successful
      if (toolName === "applyPatch" && toolResult.success && toolResult.data) {
        currentReport = toolResult.data;
        currentReport.wordCount = countWordsApprox(currentReport.markdown || "");
      }
    }

    // Handle finish
    if (hasFinish) {
      const finishValidation = validateFinishConditions(parsedStep.finish);

      if (!finishValidation.accepted) {
        const observation = {
          success: false,
          error: `Finish rejected: ${finishValidation.reason}. Continue review.`,
          availableTools: TOOL_REGISTRY[levelState.currentLevel] || LEVEL_1_TOOLS,
        };

        steps.push({
          stepIndex,
          thought,
          finish: parsedStep.finish,
          observation,
          duration: Date.now() - startTime,
        });

        emit?.("deepsearch.write.react.finish_rejected", {
          stepIndex,
          thought,
          finish: parsedStep.finish,
          reason: finishValidation.reason,
          duration: Date.now() - startTime,
        });

        onStep?.({ stepIndex, thought, finish: parsedStep.finish, observation });
        continue;
      }

      // Finish accepted
      finalFinish = parsedStep.finish;

      steps.push({
        stepIndex,
        thought,
        finish: finalFinish,
        accepted: true,
        duration: Date.now() - startTime,
      });

      emit?.("deepsearch.write.react.finish_accepted", {
        stepIndex,
        thought,
        qualityScore: finalFinish.qualityScore,
        remainingIssues: finalFinish.remainingIssues,
        patchPlanSize: finalFinish.patchPlan.length,
        duration: Date.now() - startTime,
      });

      onStep?.({ stepIndex, thought, finish: finalFinish, accepted: true });
      break;
    }
  }

  // Hard limit reached
  if (!finalFinish) {
    emit?.("deepsearch.write.react.hard_limit", {
      stepCount: steps.length,
      hardLimit,
    });

    // Force finish with conservative score
    finalFinish = {
      qualityScore: 6,
      remainingIssues: 99,
      patchPlan: [],
    };
  }

  return {
    finalReport: currentReport,
    steps,
    qualityScore: finalFinish.qualityScore,
    remainingIssues: finalFinish.remainingIssues,
    patchPlan: finalFinish.patchPlan,
    toolCalls,
    terminationReason: finalFinish.qualityScore >= 7 ? "quality_met" : "hard_limit",
  };
}

export const __test = {
  getAvailableTools,
  validateStepSchema,
  validateFinishConditions,
  determineNextLevel,
  TOOL_REGISTRY,
};
