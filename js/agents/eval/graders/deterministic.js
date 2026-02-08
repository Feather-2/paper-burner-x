/**
 * Deterministic graders: fast, repeatable checks.
 *
 * These graders should avoid model calls and rely on strict rules (regex,
 * transcript inspection, state assertions).
 *
 * @module eval/graders/deterministic
 */

import { createSafeRegex } from "../../shared/utils/safe-regex.js";

/**
 * @typedef {import('../types.js').GraderConfig} GraderConfig
 * @typedef {import('../types.js').GraderResult} GraderResult
 * @typedef {import('../types.js').EvalIssue} EvalIssue
 * @typedef {import('../types.js').Transcript} Transcript
 */

function toText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeIssue(type, severity, message, location) {
  /** @type {EvalIssue} */
  const issue = { type, severity, message };
  if (location) issue.location = location;
  return issue;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function compileRegex(pattern, flags = "") {
  if (pattern instanceof RegExp) {
    // Preserve user-provided flags; allow override when flags are explicitly provided.
    if (typeof flags === "string" && flags.length > 0) return new RegExp(pattern.source, flags);
    return pattern;
  }
  return createSafeRegex(String(pattern), String(flags || ""));
}

function getByPath(obj, path) {
  if (!path || typeof path !== "string") return obj;
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function deepMatchSubset(actual, expected) {
  // RegExp
  if (expected instanceof RegExp) {
    const ok = expected.test(String(actual ?? ""));
    return ok ? { passed: true } : { passed: false, reason: `Expected value to match ${expected}` };
  }

  // Predicate
  if (typeof expected === "function") {
    try {
      const ok = !!expected(actual);
      return ok ? { passed: true } : { passed: false, reason: "Expected value to satisfy predicate" };
    } catch (err) {
      return { passed: false, reason: `Predicate threw: ${err?.message || err}` };
    }
  }

  // Objects / arrays (subset match for objects)
  if (expected && typeof expected === "object") {
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual)) return { passed: false, reason: "Expected an array" };
      for (let i = 0; i < expected.length; i++) {
        const r = deepMatchSubset(actual[i], expected[i]);
        if (!r.passed) return { passed: false, reason: `Index ${i}: ${r.reason || "mismatch"}` };
      }
      return { passed: true };
    }

    if (!actual || typeof actual !== "object") return { passed: false, reason: "Expected an object" };
    for (const [k, v] of Object.entries(expected)) {
      const r = deepMatchSubset(actual[k], v);
      if (!r.passed) return { passed: false, reason: `${k}: ${r.reason || "mismatch"}` };
    }
    return { passed: true };
  }

  // Primitive equality (including null/undefined)
  const ok = Object.is(actual, expected);
  return ok ? { passed: true } : { passed: false, reason: `Expected ${String(expected)}, got ${String(actual)}` };
}

/**
 * regex grader - 正则匹配
 *
 * Options:
 * - pattern / patterns: string|RegExp or array
 * - match: "all" | "any" (default: "all")
 * - flags: string (optional)
 * - caseInsensitive: boolean (optional)
 * - invert: boolean (optional)
 * - minMatches: number (optional, counts total matches across patterns)
 *
 * @type {{ type: 'regex', grade: (output: unknown, config: GraderConfig) => GraderResult }}
 */
export const regexGrader = {
  type: "regex",
  grade(output, config) {
    const options = (config && typeof config === "object" && config.options && typeof config.options === "object")
      ? config.options
      : {};

    const text = toText(output);
    const patterns = options.patterns ?? (options.pattern !== undefined ? [options.pattern] : []);
    const matchMode = options.match === "any" ? "any" : "all";
    const invert = options.invert === true;

    const flags = typeof options.flags === "string"
      ? options.flags
      : options.caseInsensitive
        ? "i"
        : "";

    if (!Array.isArray(patterns) || patterns.length === 0) {
      return {
        graderType: "regex",
        passed: false,
        score: 0,
        reason: "No regex pattern provided",
        issues: [normalizeIssue("missing_pattern", "error", "regex grader requires options.pattern or options.patterns")],
      };
    }

    const compiled = patterns.map((p) => compileRegex(p, flags));

    const minMatches = Number.isFinite(options.minMatches) ? Math.max(0, Number(options.minMatches)) : null;
    if (minMatches !== null) {
      let totalMatches = 0;
      for (const re of compiled) {
        const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
        for (const _m of text.matchAll(r)) totalMatches++;
      }
      const ok = totalMatches >= minMatches;
      const passed = invert ? !ok : ok;
      return {
        graderType: "regex",
        passed,
        score: passed ? 1 : 0,
        reason: passed ? `Matched >= ${minMatches} time(s)` : `Matched ${totalMatches} time(s), expected >= ${minMatches}`,
        issues: passed ? [] : [normalizeIssue("regex_mismatch", "error", `Regex match count ${totalMatches} < ${minMatches}`)],
      };
    }

    const matched = [];
    const missing = [];
    for (const re of compiled) {
      if (re.test(text)) matched.push(re);
      else missing.push(re);
    }

    const ok = matchMode === "any" ? matched.length > 0 : missing.length === 0;
    const passed = invert ? !ok : ok;

    let reason = "";
    if (passed) {
      reason = invert ? "No forbidden pattern matched" : "All required patterns matched";
      if (matchMode === "any") reason = invert ? "No forbidden pattern matched" : "At least one pattern matched";
    } else {
      if (invert) {
        reason = `Forbidden pattern matched (${matched.length}/${compiled.length})`;
      } else if (matchMode === "any") {
        reason = "No pattern matched";
      } else {
        reason = `Missing ${missing.length} pattern(s)`;
      }
    }

    /** @type {EvalIssue[]} */
    const issues = [];
    if (!passed) {
      issues.push(
        normalizeIssue(
          "regex_mismatch",
          "error",
          invert
            ? `Output matched forbidden pattern(s): ${matched.map((r) => r.toString()).join(", ")}`
            : `Output did not match required pattern(s): ${missing.map((r) => r.toString()).join(", ")}`
        )
      );
    }

    return {
      graderType: "regex",
      passed,
      score: passed ? 1 : 0,
      reason,
      issues,
    };
  },
};

/**
 * state-check grader - 状态检查
 *
 * Options:
 * - path: string (dot/bracket path)
 * - expected / equals / match: any (subset match for objects)
 * - predicate: (value:any) => boolean (optional)
 * - not: boolean (invert)
 *
 * @type {{ type: 'state_check', grade: (outcome: unknown, config: GraderConfig) => GraderResult }}
 */
export const stateCheckGrader = {
  type: "state_check",
  grade(outcome, config) {
    const options = (config && typeof config === "object" && config.options && typeof config.options === "object")
      ? config.options
      : {};

    const not = options.not === true;
    const path = typeof options.path === "string" ? options.path : "";
    const actual = path ? getByPath(outcome, path) : outcome;

    if (typeof options.predicate === "function") {
      let ok = false;
      try {
        ok = !!options.predicate(actual);
      } catch (err) {
        const passed = false;
        return {
          graderType: "state_check",
          passed,
          score: 0,
          reason: `Predicate threw: ${err?.message || err}`,
          issues: [normalizeIssue("predicate_error", "error", `Predicate threw: ${err?.message || err}`, path || undefined)],
        };
      }

      const passed = not ? !ok : ok;
      return {
        graderType: "state_check",
        passed,
        score: passed ? 1 : 0,
        reason: passed ? "Predicate satisfied" : "Predicate not satisfied",
        issues: passed ? [] : [normalizeIssue("state_mismatch", "error", "Outcome did not satisfy predicate", path || undefined)],
      };
    }

    const expected = options.equals ?? options.expected ?? options.match;
    if (expected === undefined) {
      const ok = !!actual;
      const passed = not ? !ok : ok;
      return {
        graderType: "state_check",
        passed,
        score: passed ? 1 : 0,
        reason: passed ? "Outcome is truthy" : "Outcome is falsy",
        issues: passed ? [] : [normalizeIssue("state_mismatch", "error", "Outcome did not satisfy truthiness check", path || undefined)],
      };
    }

    const match = deepMatchSubset(actual, expected);
    const ok = match.passed;
    const passed = not ? !ok : ok;

    return {
      graderType: "state_check",
      passed,
      score: passed ? 1 : 0,
      reason: passed ? "State matched" : match.reason || "State mismatch",
      issues: passed ? [] : [normalizeIssue("state_mismatch", "error", match.reason || "State mismatch", path || undefined)],
    };
  },
};

function extractToolName(entry) {
  if (!entry || typeof entry !== "object") return "";
  const content = entry.content;
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return "";
  return String(
    content.name
      ?? content.tool
      ?? content.toolName
      ?? content.function?.name
      ?? content.call?.name
      ?? ""
  );
}

function extractToolArgs(entry) {
  if (!entry || typeof entry !== "object") return null;
  const content = entry.content;
  if (!content || typeof content !== "object") return null;
  return content.args ?? content.arguments ?? content.params ?? content.input ?? content;
}

function isSubsequence(names, sequence) {
  if (!Array.isArray(sequence) || sequence.length === 0) return true;
  let j = 0;
  for (let i = 0; i < names.length && j < sequence.length; i++) {
    if (names[i] === sequence[j]) j++;
  }
  return j === sequence.length;
}

/**
 * tool-calls grader - 工具调用验证
 *
 * Options:
 * - minCalls / maxCalls: number
 * - required: string[] (tools that must appear)
 * - forbidden: string[] (tools that must not appear)
 * - sequence: string[] (must appear in order; subsequence)
 * - match: Array<{ name: string, args?: any }> (subset match for args)
 *
 * @type {{ type: 'tool_calls', grade: (transcript: Transcript | unknown, config: GraderConfig) => GraderResult }}
 */
export const toolCallsGrader = {
  type: "tool_calls",
  grade(transcript, config) {
    const options = (config && typeof config === "object" && config.options && typeof config.options === "object")
      ? config.options
      : {};

    const entries = Array.isArray(transcript?.entries) ? transcript.entries : Array.isArray(transcript) ? transcript : [];
    const toolEntries = entries.filter((e) => e && e.type === "tool_call");
    const names = toolEntries.map(extractToolName).filter(Boolean);

    /** @type {EvalIssue[]} */
    const issues = [];

    const minCalls = Number.isFinite(options.minCalls) ? Math.max(0, Number(options.minCalls)) : null;
    const maxCalls = Number.isFinite(options.maxCalls) ? Math.max(0, Number(options.maxCalls)) : null;

    if (minCalls !== null && names.length < minCalls) {
      issues.push(normalizeIssue("tool_calls_too_few", "error", `Tool calls ${names.length} < ${minCalls}`));
    }
    if (maxCalls !== null && names.length > maxCalls) {
      issues.push(normalizeIssue("tool_calls_too_many", "error", `Tool calls ${names.length} > ${maxCalls}`));
    }

    for (const r of asArray(options.required)) {
      if (!names.includes(String(r))) {
        issues.push(normalizeIssue("missing_tool_call", "error", `Required tool not called: ${String(r)}`));
      }
    }

    for (const f of asArray(options.forbidden)) {
      if (names.includes(String(f))) {
        issues.push(normalizeIssue("forbidden_tool_call", "error", `Forbidden tool called: ${String(f)}`));
      }
    }

    if (Array.isArray(options.sequence) && options.sequence.length > 0) {
      const seq = options.sequence.map(String);
      if (!isSubsequence(names, seq)) {
        issues.push(normalizeIssue("tool_call_sequence", "error", `Tool calls did not match required order: ${seq.join(" -> ")}`));
      }
    }

    if (Array.isArray(options.match) && options.match.length > 0) {
      for (const expectation of options.match) {
        const expectedName = String(expectation?.name || "");
        if (!expectedName) continue;
        const idx = toolEntries.findIndex((e) => extractToolName(e) === expectedName);
        if (idx === -1) {
          issues.push(normalizeIssue("missing_tool_call", "error", `Expected tool call not found: ${expectedName}`));
          continue;
        }

        if (expectation && "args" in expectation) {
          const actualArgs = extractToolArgs(toolEntries[idx]);
          const match = deepMatchSubset(actualArgs, expectation.args);
          if (!match.passed) {
            issues.push(normalizeIssue("tool_args_mismatch", "error", `Tool args mismatch for ${expectedName}: ${match.reason || "mismatch"}`));
          }
        }
      }
    }

    const passed = issues.length === 0;
    return {
      graderType: "tool_calls",
      passed,
      score: passed ? 1 : 0,
      reason: passed ? "Tool call constraints satisfied" : "Tool call constraints failed",
      issues,
    };
  },
};

function countTokensFromMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return 0;
  const direct = metadata.totalTokens ?? metadata.tokens ?? metadata.tokenCount;
  if (Number.isFinite(direct)) return Number(direct);
  const usage = metadata.usage;
  if (usage && typeof usage === "object" && Number.isFinite(usage.total_tokens)) return Number(usage.total_tokens);
  return 0;
}

/**
 * transcript grader - transcript 分析 (turns, tokens)
 *
 * Options:
 * - maxTurns / minTurns
 * - maxToolCalls / minToolCalls
 * - maxTokens / minTokens
 * - maxLatencyMs / minLatencyMs
 * - allowErrors: boolean (default: false)
 *
 * @type {{ type: 'transcript', grade: (transcript: Transcript, config: GraderConfig) => GraderResult }}
 */
export const transcriptGrader = {
  type: "transcript",
  grade(transcript, config) {
    const options = (config && typeof config === "object" && config.options && typeof config.options === "object")
      ? config.options
      : {};

    const entries = Array.isArray(transcript?.entries) ? transcript.entries : [];
    const turns = entries.filter((e) => e?.type === "output").length;
    const toolCalls = entries.filter((e) => e?.type === "tool_call").length;
    const totalTokens = entries.reduce((acc, e) => acc + countTokensFromMetadata(e?.metadata), 0);
    const latencyMs = Number.isFinite(transcript?.endTime) && Number.isFinite(transcript?.startTime)
      ? Math.max(0, transcript.endTime - transcript.startTime)
      : 0;

    /** @type {EvalIssue[]} */
    const issues = [];

    const allowErrors = options.allowErrors === true;
    if (!allowErrors && entries.some((e) => e?.type === "error")) {
      issues.push(normalizeIssue("transcript_error", "error", "Transcript contains error entries"));
    }

    const constraints = [
      ["minTurns", "turns", turns],
      ["maxTurns", "turns", turns],
      ["minToolCalls", "toolCalls", toolCalls],
      ["maxToolCalls", "toolCalls", toolCalls],
      ["minTokens", "totalTokens", totalTokens],
      ["maxTokens", "totalTokens", totalTokens],
      ["minLatencyMs", "latencyMs", latencyMs],
      ["maxLatencyMs", "latencyMs", latencyMs],
    ];

    for (const [optKey, label, actual] of constraints) {
      const limit = options[optKey];
      if (!Number.isFinite(limit)) continue;
      const n = Number(limit);
      if (optKey.startsWith("min") && actual < n) {
        issues.push(normalizeIssue("constraint_violation", "error", `${label} ${actual} < ${n}`));
      }
      if (optKey.startsWith("max") && actual > n) {
        issues.push(normalizeIssue("constraint_violation", "error", `${label} ${actual} > ${n}`));
      }
    }

    const passed = issues.length === 0;
    return {
      graderType: "transcript",
      passed,
      score: passed ? 1 : 0,
      reason: passed ? "Transcript constraints satisfied" : "Transcript constraints failed",
      issues,
    };
  },
};

