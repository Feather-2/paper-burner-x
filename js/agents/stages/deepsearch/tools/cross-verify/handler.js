/**
 * cross-verify skill handler
 * 
 * 解决模式 2-5 (验证机制缺失) 和 多代理协同下的信息对质。
 */

import { DiscoveryStatus } from "../../../../sdk/DiscoveryManager.js";
import { handler as taskHandler, getTaskStatus, waitForTask } from "../task/handler.js";
import { robustParseJson } from "../../../../shared/utils/robust-json.js";
import { isPlainObject, safeNumber, toBoolean, toNonEmptyString } from "../../../../shared/utils/value-utils.js";

export const definition = {
  name: "cross-verify",
  description: "对冲突的信息或关键事实进行交叉验证。会启动一个专项子任务（Task/SubAgent）对比不同信源，并把结果写回黑板/状态。",
  priority: "important",
  parameters: {
    factId: "合并后的事实 ID 或 Gap ID（必需）",
    contradiction: "冲突描述（必需）",
    sourceIds: "涉及冲突的信源 ID 列表（可选）",
    subagent_type: "子代理类型: researcher | analyzer（默认 researcher）",
    async: "是否异步执行（默认 true）",
    timeout: "等待超时（毫秒，仅 async=false 时使用，默认 600000）",
    force: "是否强制重新验证（默认 false）",
  },
  layer: 0,
  activation: {
    keywords: ["交叉验证", "对质", "核实冲突", "cross-verify", "compare"],
  },
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_SUBAGENT_TYPE = "researcher";

function normalizeStringArray(value) {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    const s = toNonEmptyString(item);
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeTimeoutMs(value) {
  const n = safeNumber(value);
  if (n === null) return DEFAULT_TIMEOUT_MS;
  const ms = Math.floor(n);
  if (ms <= 0) return DEFAULT_TIMEOUT_MS;
  return ms;
}

function getOrInitCrossVerifyMap(state) {
  if (state && typeof state.getScratchpad === "function" && typeof state.setScratchpad === "function") {
    const existing = state.getScratchpad("crossVerify");
    if (isPlainObject(existing)) return existing;
    const next = {};
    state.setScratchpad("crossVerify", next);
    return next;
  }

  // Fallback: plain object state
  if (!state.L2 || typeof state.L2 !== "object") state.L2 = {};
  if (!state.L2.scratchpad || typeof state.L2.scratchpad !== "object") state.L2.scratchpad = {};
  if (!isPlainObject(state.L2.scratchpad.crossVerify)) state.L2.scratchpad.crossVerify = {};
  return state.L2.scratchpad.crossVerify;
}

function upsertCrossVerifyEntry(state, factId, patch) {
  const map = getOrInitCrossVerifyMap(state);
  const existing = isPlainObject(map[factId]) ? map[factId] : { factId };
  map[factId] = { ...existing, ...patch };
  if (state && typeof state.setScratchpad === "function") {
    // Ensure MemoryStore (if any) stays in sync.
    state.setScratchpad("crossVerify", map);
  }
  return map[factId];
}

function collectEvidence({ sharedContext, discoveryManager, factId, sourceIds }) {
  const targetSources = normalizeStringArray(sourceIds);
  const evidenceIds = sharedContext?.search?.(`evidence:${factId}`) || [];
  const evidences = [];

  for (const evidenceId of evidenceIds) {
    const detail = sharedContext?.getDetail?.(evidenceId);
    if (!detail || typeof detail !== "object") continue;
    const src = toNonEmptyString(detail.sourceId);
    if (targetSources.length > 0 && src && !targetSources.includes(src)) continue;
    evidences.push({ evidenceId, ...detail });
  }

  // Fallback: DiscoveryManager.getEvidences()（不一定带 evidenceId）
  if (evidences.length === 0 && discoveryManager?.getEvidences) {
    const rows = discoveryManager.getEvidences(factId) || [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const src = toNonEmptyString(row.sourceId);
      if (targetSources.length > 0 && src && !targetSources.includes(src)) continue;
      evidences.push({ ...row });
    }
  }

  const inferredSourceIds = [];
  const inferredSet = new Set();
  for (const e of evidences) {
    const sid = toNonEmptyString(e?.sourceId);
    if (!sid || inferredSet.has(sid)) continue;
    inferredSet.add(sid);
    inferredSourceIds.push(sid);
  }

  return { evidenceIds: evidences.map((e) => e?.evidenceId).filter(Boolean), evidences, inferredSourceIds };
}

function buildVerifyTaskPrompt({ factId, contradiction, sourceIds, evidences }) {
  const sourcesText = sourceIds?.length ? sourceIds.join(", ") : "（未限定，可使用所有相关文档）";

  const evidenceLines = (Array.isArray(evidences) ? evidences : [])
    .slice(0, 12)
    .map((e, i) => {
      const src = toNonEmptyString(e?.sourceId) || "unknown_source";
      const eid = toNonEmptyString(e?.evidenceId);
      const conf = e?.confidence;
      const confText = typeof conf === "number" ? `, confidence=${conf.toFixed(2)}` : "";
      const snippet = toNonEmptyString(e?.snippet) || toNonEmptyString(e?.quote) || toNonEmptyString(e?.text) || "";
      const snippetShort = snippet ? snippet.slice(0, 400) : "(no snippet)";
      return `- (${i + 1}) [${src}]${eid ? ` evidenceId=${eid}` : ""}${confText}: ${snippetShort}`;
    });

  return `
你是一个专门负责“事实纠音/交叉验证”的核查员。

目标：对同一事实（factId）在不同信源中的矛盾点进行交叉验证，并给出可落地的结论与建议。

factId: ${factId}
冲突点：${contradiction}
涉及信源：${sourcesText}

已收集到的证据片段（可能不完整）：
${evidenceLines.length ? evidenceLines.join("\n") : "- （暂无证据片段，请先搜索/读取文档补充）"}

要求：
1) 优先用 read-doc / search-docs 找到能直接支撑结论的原文（请记录引用/来源）。
2) 判断冲突属于哪类：时间轴差异/统计口径差异/对象范围差异/数据错误/无法判断。
3) 输出必须在报告最前面包含一个 JSON 代码块（\`\`\`json ...\`\`\`），字段如下：
   - status: "satisfied" | "contradicted" | "partial" | "blocked"
   - conclusion: string（最终结论，尽量一句话）
   - confidence: number（0-1）
   - rationale: string（为什么这么判断）
   - keyEvidence: [{ sourceId, evidenceId?, quote? }]
   - remainingUncertainty: string（若仍不确定，请说明缺什么）
4) JSON 之后用简短要点说明（最多 10 行）。
`.trim();
}

function mapVerdictStatusToDiscoveryStatus(value) {
  const raw = toNonEmptyString(value)?.toLowerCase();
  if (!raw) return null;
  if (raw === "satisfied" || raw === "verified" || raw === "resolved") return DiscoveryStatus.SATISFIED;
  if (raw === "contradicted" || raw === "conflicted" || raw === "conflict") return DiscoveryStatus.CONTRADICTED;
  if (raw === "partial" || raw === "uncertain" || raw === "unknown") return DiscoveryStatus.PARTIAL;
  if (raw === "blocked" || raw === "cannot" || raw === "failed") return DiscoveryStatus.BLOCKED;
  return null;
}

function extractVerdictFromReport(report) {
  const text = typeof report === "string" ? report : "";
  if (!text.trim()) return null;
  const parsed = robustParseJson(text, null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed;
}

function buildSummaryFromVerdict({ factId, contradiction, verdict, fallbackTaskId }) {
  const status = toNonEmptyString(verdict?.status) || "unknown";
  const conclusion = toNonEmptyString(verdict?.conclusion);
  const conf = typeof verdict?.confidence === "number" ? verdict.confidence : null;
  const confText = conf !== null ? ` (conf=${Math.round(conf * 100)}%)` : "";
  if (conclusion) return `[cross-verify] ${factId}: ${conclusion}${confText}`;
  return `[cross-verify] ${factId}: ${String(contradiction || "").slice(0, 60)}… (${status}, task=${fallbackTaskId})`;
}

async function finalizeVerification({ factId, contradiction, sourceIds, evidenceIds, taskId, taskResult, context }) {
  const { state, emit, discoveryManager, sharedContext } = context;

  const stored = sharedContext?.getDetail?.(taskId);
  const taskObjCandidate = taskResult && typeof taskResult === "object" ? taskResult : null;
  const storedCandidate = stored && typeof stored === "object" ? stored : null;

  // Prefer the richer object (typically from sharedContext.store) when available.
  const resultObj =
    storedCandidate && !taskObjCandidate?.result
      ? storedCandidate
      : taskObjCandidate && storedCandidate
        ? { ...taskObjCandidate, ...storedCandidate }
        : taskObjCandidate || storedCandidate;

  const taskStatus = toNonEmptyString(resultObj?.status) || "unknown";
  const report =
    toNonEmptyString(resultObj?.result?.report) ||
    toNonEmptyString(resultObj?.result?.analysis) ||
    toNonEmptyString(resultObj?.result?.findings);

  const verdict = extractVerdictFromReport(report);
  const mapped = mapVerdictStatusToDiscoveryStatus(verdict?.status);
  const finalDiscoveryStatus =
    taskStatus === "failed" || taskStatus === "timeout"
      ? DiscoveryStatus.BLOCKED
      : mapped || DiscoveryStatus.PARTIAL;

  const verification = {
    factId,
    contradiction,
    sourceIds: normalizeStringArray(sourceIds),
    evidenceIds: normalizeStringArray(evidenceIds),
    taskId,
    taskStatus,
    discoveryStatus: finalDiscoveryStatus,
    verdict,
    summary: buildSummaryFromVerdict({ factId, contradiction, verdict, fallbackTaskId: taskId }),
    completedAt: Date.now(),
  };

  // 1) 写入 scratchpad（state）
  upsertCrossVerifyEntry(state, factId, {
    status: taskStatus === "completed" ? "completed" : taskStatus,
    taskId,
    discoveryStatus: finalDiscoveryStatus,
    summary: verification.summary,
    verdict,
    completedAt: verification.completedAt,
  });

  // 2) 写入 SharedContext（全局黑板）
  if (sharedContext) {
    const pointerKey = `cross_verify:${factId}`;
    sharedContext.store(pointerKey, verification);
    sharedContext.addToIndex?.("cross_verify", pointerKey);
    sharedContext.addToIndex?.(`cross_verify:${factId}`, pointerKey);
    for (const sid of verification.sourceIds) sharedContext.addToIndex?.(sid, pointerKey);

    sharedContext.signal?.("verification", {
      type: "verification",
      stage: "verification",
      factId,
      taskId,
      status: finalDiscoveryStatus,
      message: verification.summary,
      ts: Date.now(),
    });

    // L1 摘要（覆盖式，便于每轮看到最近一次验证）
    sharedContext.setSummary?.("verification", verification.summary);
  }

  // 3) 更新 Discovery 状态（sync 信号）
  discoveryManager?.upsertDiscovery?.(factId, {
    status: finalDiscoveryStatus,
    reason: contradiction,
    keywords: ["cross-verify", factId, ...normalizeStringArray(sourceIds)].slice(0, 5),
  });

  emit?.("deepsearch.verify.completed", {
    factId,
    taskId,
    discoveryStatus: finalDiscoveryStatus,
    taskStatus,
    hasVerdict: Boolean(verdict),
  });

  return verification;
}

/**
 * @param {Object} args
 * @param {string} args.factId - 合并后的事实 ID 或 Gap ID
 * @param {string} args.contradiction - 描述冲突的具体点
 * @param {string[]} [args.sourceIds] - 涉及冲突的信源 ID 列表
 * @param {string} [args.subagent_type] - 子代理类型 (researcher | analyzer)
 * @param {boolean} [args.async=true] - 是否异步执行
 * @param {number} [args.timeout=600000] - 同步等待超时
 * @param {boolean} [args.force=false] - 是否强制重新验证
 * @param {Object} context - { state, emit, discoveryManager, executeSkill }
 */
export async function handler(args, context) {
  const { state, emit, discoveryManager, stageApi, sharedContext } = context;

  const factId = toNonEmptyString(args?.factId);
  const contradiction = toNonEmptyString(args?.contradiction);
  if (!factId || !contradiction) {
    return { success: false, error: "factId and contradiction are required" };
  }

  const force = toBoolean(args?.force);
  const isAsync = args?.async === undefined ? true : toBoolean(args?.async);
  const timeoutMs = normalizeTimeoutMs(args?.timeout);

  const requestedSourceIds = normalizeStringArray(args?.sourceIds ?? args?.sources ?? args?.sourceId);

  const subagentType =
    toNonEmptyString(args?.subagent_type) ||
    toNonEmptyString(args?.subagentType) ||
    DEFAULT_SUBAGENT_TYPE;

  // 0) 去重：若已有运行中的验证任务，直接返回
  const existing = getOrInitCrossVerifyMap(state)?.[factId];
  if (!force && isPlainObject(existing) && existing.taskId && existing.status === "running") {
    return {
      success: true,
      factId,
      status: "running",
      taskId: existing.taskId,
      message: "已存在运行中的交叉验证任务",
      hint: "使用 get-task-result 获取结果",
    };
  }

  // 1) 标记状态为 VERIFYING
  discoveryManager?.upsertDiscovery?.(factId, {
    status: DiscoveryStatus.VERIFYING,
    reason: contradiction,
    keywords: ["cross-verify", factId, ...requestedSourceIds].slice(0, 5),
  });
  emit?.("deepsearch.verify.started", { factId, contradiction, sourceIds: requestedSourceIds });

  // 2) 收集证据（黑板）并构造专项子任务 prompt
  const { evidenceIds, evidences, inferredSourceIds } = collectEvidence({
    sharedContext,
    discoveryManager,
    factId,
    sourceIds: requestedSourceIds,
  });

  const taskSourceIds = requestedSourceIds.length > 0 ? requestedSourceIds : inferredSourceIds;
  const verifyTaskPrompt = buildVerifyTaskPrompt({
    factId,
    contradiction,
    sourceIds: taskSourceIds,
    evidences,
  });

  // 3) 启动子任务（使用 Task tool）
  const startedAt = Date.now();
  const taskStart = await taskHandler(
    { subagent_type: subagentType, prompt: verifyTaskPrompt, sourceIds: taskSourceIds, async: true },
    { state, emit, stageApi, sharedContext }
  );

  if (!taskStart?.success || !taskStart.taskId) {
    discoveryManager?.upsertDiscovery?.(factId, {
      status: DiscoveryStatus.BLOCKED,
      reason: taskStart?.error || "Failed to start verification task",
      keywords: ["cross-verify", factId].slice(0, 5),
    });
    emit?.("deepsearch.verify.failed", { factId, error: taskStart?.error || "Failed to start verification task" });
    return { success: false, error: taskStart?.error || "Failed to start verification task" };
  }

  const taskId = taskStart.taskId;

  // 4) 写回指针（state / blackboard）
  upsertCrossVerifyEntry(state, factId, {
    status: "running",
    taskId,
    startedAt,
    contradiction,
    sourceIds: taskSourceIds,
    evidenceIds,
    subagentType,
  });

  if (sharedContext) {
    const pointerKey = `cross_verify:${factId}`;
    sharedContext.store(pointerKey, {
      factId,
      contradiction,
      sourceIds: taskSourceIds,
      evidenceIds,
      taskId,
      status: "running",
      startedAt,
    });
    sharedContext.addToIndex?.("cross_verify", pointerKey);
    sharedContext.addToIndex?.(`cross_verify:${factId}`, pointerKey);
  }

  // 5) 注册完成回调：任务完成后自动回写结果
  const running = getTaskStatus(taskId);
  const promise = running?.promise;
  if (promise && typeof promise.then === "function") {
    promise
      .then((taskResult) =>
        finalizeVerification({
          factId,
          contradiction,
          sourceIds: taskSourceIds,
          evidenceIds,
          taskId,
          taskResult,
          context: { state, emit, discoveryManager, sharedContext },
        })
      )
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        discoveryManager?.upsertDiscovery?.(factId, { status: DiscoveryStatus.BLOCKED, reason: message });
        upsertCrossVerifyEntry(state, factId, { status: "failed", error: message, completedAt: Date.now() });
        emit?.("deepsearch.verify.failed", { factId, taskId, error: message });
      });
  }
  // 竞态兜底：如果任务极快完成，runningTasks 可能已被压缩记录替换，导致拿不到 promise
  if (!promise && running && running.status && running.status !== "running") {
    Promise.resolve()
      .then(() =>
        finalizeVerification({
          factId,
          contradiction,
          sourceIds: taskSourceIds,
          evidenceIds,
          taskId,
          taskResult: sharedContext?.getDetail?.(taskId) || running,
          context: { state, emit, discoveryManager, sharedContext },
        })
      )
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        discoveryManager?.upsertDiscovery?.(factId, { status: DiscoveryStatus.BLOCKED, reason: message });
        upsertCrossVerifyEntry(state, factId, { status: "failed", error: message, completedAt: Date.now() });
        emit?.("deepsearch.verify.failed", { factId, taskId, error: message });
      });
  }

  if (!isAsync) {
    const taskResult = await waitForTask(taskId, timeoutMs);
    const verification = await finalizeVerification({
      factId,
      contradiction,
      sourceIds: taskSourceIds,
      evidenceIds,
      taskId,
      taskResult,
      context: { state, emit, discoveryManager, sharedContext },
    });

    return {
      success: verification.discoveryStatus !== DiscoveryStatus.BLOCKED,
      factId,
      taskId,
      status: verification.taskStatus,
      discoveryStatus: verification.discoveryStatus,
      verification,
    };
  }

  return {
    success: true,
    factId,
    taskId,
    status: "running",
    message: "交叉验证子任务已启动",
    hint: "使用 get-task-result {taskId, wait:true} 获取结果；结果也会自动写回 sharedContext/state",
  };
}

export default { definition, handler };
