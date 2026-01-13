/**
 * LLM-as-Judge graders.
 *
 * IMPORTANT: These graders are inherently stochastic unless the LLM client is
 * configured deterministically. Prefer deterministic graders when possible.
 *
 * @module eval/graders/llm-judge
 */

import { robustParseJson } from "../../shared/index.js";

/**
 * @typedef {import('../types.js').GraderConfig} GraderConfig
 * @typedef {import('../types.js').GraderResult} GraderResult
 * @typedef {import('../types.js').EvalIssue} EvalIssue
 */

function normalizeIssue(type, severity, message, location) {
  /** @type {EvalIssue} */
  const issue = { type, severity, message };
  if (location) issue.location = location;
  return issue;
}

function toText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function resolveChatClient(llmClient) {
  if (!llmClient) return null;
  if (typeof llmClient.chat === "function") return (opts) => llmClient.chat(opts);
  if (typeof llmClient.call === "function") {
    return (opts) => llmClient.call(opts.messages, opts);
  }
  if (llmClient.modelRouter && typeof llmClient.modelRouter.call === "function") {
    return (opts) => llmClient.modelRouter.call(opts.messages, opts);
  }
  if (llmClient.aiApiService && typeof llmClient.aiApiService.chat === "function") {
    return (opts) => llmClient.aiApiService.chat(opts);
  }
  return null;
}

async function callJudge(llmClient, messages, configOptions) {
  const chat = resolveChatClient(llmClient);
  if (!chat) throw new Error("No compatible llmClient provided (expected .chat(), .call(), or stageApi-like client)");

  const opts = configOptions && typeof configOptions === "object" ? configOptions : {};
  const temperature = Number.isFinite(opts.temperature) ? Number(opts.temperature) : 0;
  const model = typeof opts.model === "string" ? opts.model : undefined;

  // Keep contract compatible with MockModelClient: { messages, usage? }
  const resp = await chat({
    ...(model ? { model } : {}),
    temperature,
    messages,
    usage: opts.usage || "worker",
  });

  return resp;
}

function parseJudgeJson(raw) {
  const data = robustParseJson(typeof raw === "string" ? raw : raw?.content ?? "");
  if (!data || typeof data !== "object") return null;

  const passed = typeof data.passed === "boolean" ? data.passed : null;
  const score = Number.isFinite(data.score) ? Math.max(0, Math.min(1, Number(data.score))) : null;
  const reason = typeof data.reason === "string" ? data.reason : "";
  const issues = Array.isArray(data.issues) ? data.issues : null;

  if (passed === null || score === null) return null;
  return { passed, score, reason, issues };
}

function judgeSystemPrompt(extra) {
  const base = [
    "You are a strict evaluation judge for an AI agent.",
    "Return VALID JSON ONLY (no markdown, no code fences).",
    "Schema:",
    "{",
    '  "passed": boolean,',
    '  "score": number, // 0..1',
    '  "reason": string,',
    '  "issues": [{ "type": string, "severity": "error"|"warning"|"info", "message": string, "location"?: string }]',
    "}",
  ].join("\n");

  if (extra && typeof extra === "string" && extra.trim()) return `${base}\n\n${extra.trim()}`;
  return base;
}

/**
 * rubric grader - 基于 rubric 评分
 *
 * Options:
 * - rubric: string (required)
 * - system: string (optional)
 * - model/temperature: forwarded to llmClient
 * - context: extra context passed into the prompt (optional)
 *
 * @type {{ type: 'llm_rubric', grade: (output: unknown, config: GraderConfig, llmClient: any) => Promise<GraderResult> }}
 */
export const rubricGrader = {
  type: "llm_rubric",
  async grade(output, config, llmClient) {
    const options = (config && typeof config === "object" && config.options && typeof config.options === "object")
      ? config.options
      : {};

    const rubric = typeof options.rubric === "string" ? options.rubric : "";
    if (!rubric.trim()) {
      return {
        graderType: "llm_rubric",
        passed: false,
        score: 0,
        reason: "Missing rubric",
        issues: [normalizeIssue("missing_rubric", "error", "llm_rubric grader requires options.rubric")],
      };
    }

    const context = options.context ?? null;
    const payload = [
      "## Rubric",
      rubric,
      "",
      "## Output",
      toText(output),
      context ? "\n## Context\n" + toText(context) : "",
    ].join("\n");

    const messages = [
      { role: "system", content: judgeSystemPrompt(typeof options.system === "string" ? options.system : "") },
      { role: "user", content: payload },
    ];

    try {
      const resp = await callJudge(llmClient, messages, options);
      const parsed = parseJudgeJson(resp);
      if (!parsed) {
        return {
          graderType: "llm_rubric",
          passed: false,
          score: 0,
          reason: "Judge returned invalid JSON",
          issues: [normalizeIssue("invalid_judge_response", "error", `Invalid judge response: ${String(resp?.content || resp).slice(0, 200)}`)],
        };
      }

      return {
        graderType: "llm_rubric",
        passed: parsed.passed,
        score: parsed.score,
        reason: parsed.reason,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      };
    } catch (err) {
      return {
        graderType: "llm_rubric",
        passed: false,
        score: 0,
        reason: `Judge call failed: ${err?.message || err}`,
        issues: [normalizeIssue("judge_error", "error", `Judge call failed: ${err?.message || err}`)],
      };
    }
  },
};

/**
 * assertion grader - 自然语言断言
 *
 * Options:
 * - assertions: string[] (required)
 * - system: string (optional)
 * - context: any (optional)
 *
 * @type {{ type: 'llm_assertion', grade: (output: unknown, config: GraderConfig, llmClient: any) => Promise<GraderResult> }}
 */
export const assertionGrader = {
  type: "llm_assertion",
  async grade(output, config, llmClient) {
    const options = (config && typeof config === "object" && config.options && typeof config.options === "object")
      ? config.options
      : {};

    const assertions = Array.isArray(options.assertions) ? options.assertions.filter((a) => typeof a === "string" && a.trim()) : [];
    if (assertions.length === 0) {
      return {
        graderType: "llm_assertion",
        passed: false,
        score: 0,
        reason: "Missing assertions",
        issues: [normalizeIssue("missing_assertions", "error", "llm_assertion grader requires options.assertions (string[])")],
      };
    }

    const context = options.context ?? null;
    const payload = [
      "## Assertions",
      ...assertions.map((a, i) => `${i + 1}. ${a}`),
      "",
      "## Output",
      toText(output),
      context ? "\n## Context\n" + toText(context) : "",
    ].join("\n");

    const systemExtra = typeof options.system === "string" ? options.system : "";
    const messages = [
      { role: "system", content: judgeSystemPrompt(systemExtra) },
      { role: "user", content: payload },
    ];

    try {
      const resp = await callJudge(llmClient, messages, options);
      const parsed = parseJudgeJson(resp);
      if (!parsed) {
        return {
          graderType: "llm_assertion",
          passed: false,
          score: 0,
          reason: "Judge returned invalid JSON",
          issues: [normalizeIssue("invalid_judge_response", "error", `Invalid judge response: ${String(resp?.content || resp).slice(0, 200)}`)],
        };
      }

      return {
        graderType: "llm_assertion",
        passed: parsed.passed,
        score: parsed.score,
        reason: parsed.reason,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      };
    } catch (err) {
      return {
        graderType: "llm_assertion",
        passed: false,
        score: 0,
        reason: `Judge call failed: ${err?.message || err}`,
        issues: [normalizeIssue("judge_error", "error", `Judge call failed: ${err?.message || err}`)],
      };
    }
  },
};

/**
 * pairwise grader - 成对比较
 *
 * Options:
 * - rubric: string (optional)
 * - system: string (optional)
 * - prefer: "A" | "B" (default: "A") (used to determine `passed`)
 *
 * @type {{ type: 'llm_pairwise', grade: (outputA: unknown, outputB: unknown, config: GraderConfig, llmClient: any) => Promise<GraderResult> }}
 */
export const pairwiseGrader = {
  type: "llm_pairwise",
  async grade(outputA, outputB, config, llmClient) {
    const options = (config && typeof config === "object" && config.options && typeof config.options === "object")
      ? config.options
      : {};

    const rubric = typeof options.rubric === "string" ? options.rubric : "";
    const prefer = options.prefer === "B" ? "B" : "A";

    const payload = [
      rubric ? "## Rubric\n" + rubric + "\n" : "",
      "## Output A",
      toText(outputA),
      "",
      "## Output B",
      toText(outputB),
      "",
      "Choose winner: A, B, or tie.",
      "Return JSON only with: { passed, score, reason, issues } where:",
      `- passed: true if ${prefer} wins (tie=false).`,
      "- score: 1 for preferred winner, 0 for loser, 0.5 for tie.",
    ].join("\n");

    const systemExtra = typeof options.system === "string" ? options.system : "";
    const messages = [
      { role: "system", content: judgeSystemPrompt(systemExtra) },
      { role: "user", content: payload },
    ];

    try {
      const resp = await callJudge(llmClient, messages, options);
      const parsed = parseJudgeJson(resp);
      if (parsed) return { graderType: "llm_pairwise", ...parsed, issues: Array.isArray(parsed.issues) ? parsed.issues : [] };

      // Fallback: accept plain text "A"/"B"/"tie"
      const raw = String(resp?.content || resp || "").trim().toLowerCase();
      const winner = raw.includes("tie") ? "tie" : raw.startsWith("b") ? "B" : "A";
      const score = winner === "tie" ? 0.5 : winner === prefer ? 1 : 0;
      const passed = winner === prefer;
      return {
        graderType: "llm_pairwise",
        passed,
        score,
        reason: `Winner: ${winner}`,
        issues: [],
      };
    } catch (err) {
      return {
        graderType: "llm_pairwise",
        passed: false,
        score: 0,
        reason: `Judge call failed: ${err?.message || err}`,
        issues: [normalizeIssue("judge_error", "error", `Judge call failed: ${err?.message || err}`)],
      };
    }
  },
};

