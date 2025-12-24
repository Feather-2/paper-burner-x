/**
 * ReAct Writer - 问题驱动的渐进式报告生成
 *
 * 核心理念：让 AI 按待办（todo）逐个检索证据并写作，而不是一次性 dump 所有数据
 *
 * 工具集：
 * - getTodos(): 获取待回答的 todo 列表
 * - getTodoDetail(todoId): 获取 todo 详情及关联的论点
 * - getClaimsForTodo(todoId): 获取 todo 关联的所有论点
 * - getEvidence(evidenceId): 获取证据详情（含原文引用）
 * - getSourceChunk(sourceId, start, end): 读取更多原文上下文
 * - searchEvidence(query): 语义搜索证据库
 * - planOutline(sections): 规划报告大纲
 * - writeSection({sectionId?, todoId?, gapId?, title?, markdown}): 写入/更新一个章节
 * - editSection({sectionId, markdown}): 编辑已写章节
 * - getProgress(): 获取写作进度
 * - finishReport({title, executiveSummary}): 完成报告
 *
 * 兼容：保留 getGaps/getGapDetail/getClaimsForGap 作为别名
 *
 * 流程：
 * 1. AI 调用 getTodos() 了解需要回答的 todo
 * 2. 对每个 todo，调用 getTodoDetail/getClaimsForTodo 获取关联论点
 * 3. 对每个论点，调用 getEvidence 获取支撑证据
 * 4. 如需更多上下文，调用 getSourceChunk 读取原文
 * 5. 调用 writeSection 写入该问题的章节
 * 6. 循环直到所有问题处理完毕
 * 7. 调用 finishReport 生成标题和摘要
 */

import { extractJsonCandidate, checkCancelled } from "./state.js";
import { getModelCaller } from "./model.js";
import { countWordsApprox } from "./report-diff.js";
import { extractEvidenceIdsFromMarkdownCitations, finalizeCitationsInMarkdown } from "./citations.js";
import { isPlainObject, toNonEmptyString, safeInt } from "../../shared/value-utils.js";
import { loadPrompt } from "../../prompts/prompt-loader.js";

// 缓存的提示词
let _writerSystemPrompt = null;
let _writerInitialPrompt = null;

/**
 * 异步获取 writer system prompt
 */
export async function getWriterSystemPrompt() {
  if (_writerSystemPrompt) return _writerSystemPrompt;
  try {
    _writerSystemPrompt = await loadPrompt("deepsearch/writer-system");
    return _writerSystemPrompt;
  } catch (e) {
    console.warn("[react-writer] Failed to load writer-system.md:", e.message);
    return WRITER_SYSTEM_PROMPT;
  }
}

/**
 * 异步获取 writer initial prompt
 */
export async function getWriterInitialPrompt() {
  if (_writerInitialPrompt) return _writerInitialPrompt;
  try {
    _writerInitialPrompt = await loadPrompt("deepsearch/writer-initial");
    return _writerInitialPrompt;
  } catch (e) {
    console.warn("[react-writer] Failed to load writer-initial.md:", e.message);
    return WRITER_INITIAL_PROMPT;
  }
}

// ===== 工具实现 =====

export function normalizeHeading(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, "")
    .trim();
}

export function stripLeadingDuplicateHeading(markdown, title) {
  let md = typeof markdown === "string" ? markdown : String(markdown || "");
  const headingMatch = md.match(/^(#{1,6})\s*(.+?)\s*\n/);
  if (headingMatch && normalizeHeading(headingMatch[2]) === normalizeHeading(title)) {
    md = md.slice(headingMatch[0].length);
  }
  return md;
}

function deriveTodoIdFromGapId(gapId) {
  if (!gapId) return "";
  const raw = String(gapId);
  const m = raw.match(/^gap_(\d+)$/);
  if (m) return `todo_${m[1]}`;
  return `todo_${raw}`;
}

function resolveTodoStatusFromGapStatus(gapStatus) {
  const s = String(gapStatus || "").toLowerCase();
  if (s === "filled") return "completed";
  if (s === "blocked") return "cancelled";
  if (!s || s === "open" || s === "searching" || s === "understanding") return "open";
  return "open";
}

/**
 * 创建 ReAct Writer 的工具执行器
 */
export function createWriterToolExecutor(context) {
  const { state, claims, evidenceLedger, sources, todos, gaps } = context;
  const targetWords = safeInt(context?._targetWords) ?? 3500;

  // 索引构建
  const claimById = new Map();
  const claimIdsByEvidenceId = new Map();
  for (const c of Array.isArray(claims) ? claims : []) {
    const cid = toNonEmptyString(c?.claimId);
    if (!cid) continue;
    claimById.set(cid, c);
    const eids = Array.isArray(c?.evidenceIds) ? c.evidenceIds : [];
    for (const rawEid of eids) {
      const eid = toNonEmptyString(rawEid);
      if (!eid) continue;
      if (!claimIdsByEvidenceId.has(eid)) claimIdsByEvidenceId.set(eid, new Set());
      claimIdsByEvidenceId.get(eid).add(cid);
    }
  }

  const evidenceById = new Map();
  for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
    const eid = toNonEmptyString(e?.evidenceId);
    if (eid) evidenceById.set(eid, e);
  }

  const sourceById = new Map();
  const sourceTextById = new Map();
  for (const s of Array.isArray(sources) ? sources : []) {
    const sid = toNonEmptyString(s?.sourceId);
    if (sid) {
      sourceById.set(sid, s);
      if (typeof s.sourceTextNormalized === "string") {
        sourceTextById.set(sid, s.sourceTextNormalized);
      }
    }
  }

  const gapRows = Array.isArray(gaps) ? gaps : [];
  const todoRows = Array.isArray(todos) ? todos : [];
  const gapById = new Map();
  const todoById = new Map();
  const todoIdByGapId = new Map();
  const todoList = todoRows.slice();

  for (const g of gapRows) {
    const gid = toNonEmptyString(g?.gapId);
    if (gid && !gapById.has(gid)) gapById.set(gid, g);
  }

  for (const t of todoRows) {
    const tid = toNonEmptyString(t?.todoId);
    if (!tid || todoById.has(tid)) continue;
    todoById.set(tid, t);
    const gapId = toNonEmptyString(t?.relatedGapId) || toNonEmptyString(t?.gapId);
    if (gapId && !todoIdByGapId.has(gapId)) todoIdByGapId.set(gapId, tid);
  }

  for (const g of gapById.values()) {
    const gid = toNonEmptyString(g?.gapId);
    if (!gid || todoIdByGapId.has(gid)) continue;
    const fallback = {
      todoId: deriveTodoIdFromGapId(gid) || `todo_${Date.now().toString(36)}`,
      text: toNonEmptyString(g?.question) || `Gap: ${gid}`,
      priority: g?.priority,
      status: resolveTodoStatusFromGapStatus(g?.status),
      relatedGapId: gid,
    };
    todoList.push(fallback);
    todoById.set(fallback.todoId, fallback);
    todoIdByGapId.set(gid, fallback.todoId);
  }

  const resolveTodoIdsForClaim = (claim) => {
    let todoIds = Array.isArray(claim?.todoIds) ? claim.todoIds : [];
    if (!todoIds.length) {
      const gapIds = Array.isArray(claim?.gapIds) ? claim.gapIds : [];
      if (gapIds.length) {
        todoIds = gapIds
          .map((gid) => todoIdByGapId.get(String(gid)) || deriveTodoIdFromGapId(gid))
          .map((id) => String(id || "").trim())
          .filter(Boolean);
      }
    }
    return todoIds;
  };

  // 按 todoId 分组 claims
  const claimsByTodoId = new Map();
  for (const c of Array.isArray(claims) ? claims : []) {
    const todoIds = resolveTodoIdsForClaim(c);
    for (const tid of todoIds) {
      const key = String(tid);
      if (!claimsByTodoId.has(key)) claimsByTodoId.set(key, []);
      claimsByTodoId.get(key).push(c);
    }
  }

  // 兼容：按 gapId 分组 claims
  const claimsByGapId = new Map();
  for (const c of Array.isArray(claims) ? claims : []) {
    let gapIds = Array.isArray(c?.gapIds) ? c.gapIds : [];
    if (!gapIds.length) {
      const todoIds = resolveTodoIdsForClaim(c);
      gapIds = todoIds
        .map((tid) => toNonEmptyString(todoById.get(String(tid))?.relatedGapId))
        .filter(Boolean);
    }
    for (const gid of gapIds) {
      const key = String(gid);
      if (!claimsByGapId.has(key)) claimsByGapId.set(key, []);
      claimsByGapId.get(key).push(c);
    }
  }

  // 收集写入的章节
  const writtenSections = [];
  const sectionClaimIdsBySectionId = new Map();
  const usedClaimIds = new Set();

  const recomputeUsedClaimIds = () => {
    usedClaimIds.clear();
    for (const claimIds of sectionClaimIdsBySectionId.values()) {
      for (const cid of claimIds) usedClaimIds.add(cid);
    }
  };

  const computeClaimIdsUsedByMarkdown = (markdown) => {
    const evidenceIds = extractEvidenceIdsFromMarkdownCitations(markdown);
    const claimIds = new Set();
    for (const rawEid of evidenceIds) {
      const eid = toNonEmptyString(rawEid);
      const claimIdsForEvidence = eid ? claimIdsByEvidenceId.get(String(eid)) : null;
      if (!claimIdsForEvidence) continue;
      for (const cid of claimIdsForEvidence) claimIds.add(cid);
    }
    return claimIds;
  };
  let reportFinished = false;
  let reportTitle = "";
  let reportSummary = "";

  const resolveTodoId = ({ todoId, gapId }) => {
    const tid = toNonEmptyString(todoId);
    if (tid) return tid;
    const gid = toNonEmptyString(gapId);
    if (!gid) return "";
    return todoIdByGapId.get(gid) || deriveTodoIdFromGapId(gid);
  };

  const resolveGapIdForTodo = (todo) => toNonEmptyString(todo?.relatedGapId) || toNonEmptyString(todo?.gapId) || "";

  const getTodosImpl = async () => {
    const visibleTodos = todoList.filter((t) => {
      const status = toNonEmptyString(t?.status) || "open";
      return status !== "cancelled";
    });

    return {
      totalTodos: visibleTodos.length,
      todos: visibleTodos.map((t) => {
        const tid = toNonEmptyString(t?.todoId);
        const relatedGapId = resolveGapIdForTodo(t);
        return {
          todoId: tid,
          text: t?.text,
          priority: t?.priority,
          status: t?.status,
          expectedEvidence: t?.expectedEvidence,
          queryHints: Array.isArray(t?.queryHints) ? t.queryHints : [],
          ...(relatedGapId ? { relatedGapId } : {}),
          ...(relatedGapId ? { gapId: relatedGapId } : {}),
          claimCount: tid ? (claimsByTodoId.get(String(tid)) || []).length : 0,
        };
      }),
    };
  };

  const getTodoDetailImpl = async ({ todoId, gapId }) => {
    const tid = resolveTodoId({ todoId, gapId });
    if (!tid) return { error: "todoId is required" };

    const todo = todoById.get(tid);
    if (!todo) return { error: `Todo not found: ${tid}` };

    const relatedClaims = claimsByTodoId.get(String(tid)) || [];
    const relatedGapId = resolveGapIdForTodo(todo);

    return {
      todoId: toNonEmptyString(todo?.todoId) || tid,
      text: todo?.text,
      priority: todo?.priority,
      status: todo?.status,
      expectedEvidence: todo?.expectedEvidence,
      queryHints: Array.isArray(todo?.queryHints) ? todo.queryHints : [],
      ...(relatedGapId ? { relatedGapId } : {}),
      ...(relatedGapId ? { gapId: relatedGapId } : {}),
      claims: relatedClaims.map((c) => ({
        claimId: c.claimId,
        text: c.text,
        importance: c.importance,
        evidenceCount: Array.isArray(c.evidenceIds) ? c.evidenceIds.length : 0,
        evidenceIds: c.evidenceIds,
        todoIds: c.todoIds,
        gapIds: c.gapIds,
      })),
    };
  };

  const getClaimsForTodoImpl = async ({ todoId, gapId }) => {
    const tid = resolveTodoId({ todoId, gapId });
    if (!tid) return { error: "todoId is required" };

    const relatedClaims = claimsByTodoId.get(String(tid)) || [];
    if (!relatedClaims.length) {
      return { todoId: tid, claims: [], message: `No claims found for todo: ${tid}` };
    }

    return {
      todoId: tid,
      claims: relatedClaims.map((c) => ({
        claimId: c.claimId,
        text: c.text,
        importance: c.importance,
        evidenceIds: c.evidenceIds,
        todoIds: c.todoIds,
        gapIds: c.gapIds,
        usedInOtherSection: usedClaimIds.has(String(c.claimId)),
        // 预览每个 evidence 的引用
        evidencePreviews: (Array.isArray(c.evidenceIds) ? c.evidenceIds : []).slice(0, 5).map((eid) => {
          const e = evidenceById.get(String(eid));
          if (!e) return { evidenceId: eid, error: "not found" };
          return {
            evidenceId: e.evidenceId,
            sourceId: e.sourceId,
            sourceTitle: sourceById.get(String(e.sourceId))?.title || "Unknown",
            quotePreview: typeof e.quote === "string" ? e.quote.slice(0, 150) + (e.quote.length > 150 ? "..." : "") : "",
          };
        }),
      })),
    };
  };

  const tools = {
    /**
     * 获取所有待回答的 todo（按优先级排序）
     */
    getTodos: getTodosImpl,

    /**
     * 获取 todo 详情及关联的论点概要
     */
    getTodoDetail: getTodoDetailImpl,

    /**
     * 获取 todo 关联的所有论点（完整信息）
     */
    getClaimsForTodo: getClaimsForTodoImpl,

    /**
     * 兼容：获取问题列表
     */
    getGaps: async () => {
      const out = await getTodosImpl();
      return {
        totalGaps: out.totalTodos,
        gaps: (out.todos || []).map((t) => ({
          gapId: t.relatedGapId || t.gapId || t.todoId,
          question: t.text,
          type: "todo",
          priority: t.priority,
          status: t.status,
          claimCount: t.claimCount,
        })),
      };
    },

    /**
     * 兼容：获取问题详情及关联的论点概要
     */
    getGapDetail: async ({ gapId }) => {
      const gid = toNonEmptyString(gapId);
      if (!gid) return { error: "gapId is required" };
      const tid = todoIdByGapId.get(gid);
      if (tid) {
        const out = await getTodoDetailImpl({ todoId: tid });
        if (out?.error) return out;
        return {
          gapId: gid,
          question: out.text,
          type: "todo",
          priority: out.priority,
          status: out.status,
          claims: out.claims,
        };
      }
      const gap = gapById.get(gid);
      if (!gap) return { error: `Gap not found: ${gid}` };
      const relatedClaims = claimsByGapId.get(gid) || [];
      return {
        gapId: gap.gapId,
        question: gap.question,
        type: gap.type,
        priority: gap.priority,
        status: gap.status,
        claims: relatedClaims.map((c) => ({
          claimId: c.claimId,
          text: c.text,
          importance: c.importance,
          evidenceCount: Array.isArray(c.evidenceIds) ? c.evidenceIds.length : 0,
          evidenceIds: c.evidenceIds,
        })),
      };
    },

    /**
     * 兼容：获取问题关联的所有论点（完整信息）
     */
    getClaimsForGap: async ({ gapId }) => {
      const gid = toNonEmptyString(gapId);
      if (!gid) return { error: "gapId is required" };
      const tid = todoIdByGapId.get(gid);
      if (tid) {
        const out = await getClaimsForTodoImpl({ todoId: tid });
        if (out?.error) return out;
        return { gapId: gid, claims: out.claims, message: out.message };
      }
      const relatedClaims = claimsByGapId.get(gid) || [];
      if (!relatedClaims.length) {
        return { claims: [], message: `No claims found for gap: ${gid}` };
      }
      return {
        gapId: gid,
        claims: relatedClaims.map((c) => ({
          claimId: c.claimId,
          text: c.text,
          importance: c.importance,
          evidenceIds: c.evidenceIds,
          usedInOtherSection: usedClaimIds.has(String(c.claimId)),
          evidencePreviews: (Array.isArray(c.evidenceIds) ? c.evidenceIds : []).slice(0, 5).map((eid) => {
            const e = evidenceById.get(String(eid));
            if (!e) return { evidenceId: eid, error: "not found" };
            return {
              evidenceId: e.evidenceId,
              sourceId: e.sourceId,
              sourceTitle: sourceById.get(String(e.sourceId))?.title || "Unknown",
              quotePreview: typeof e.quote === "string" ? e.quote.slice(0, 150) + (e.quote.length > 150 ? "..." : "") : "",
            };
          }),
        })),
      };
    },

    /**
     * 获取证据详情（完整原文引用）
     */
    getEvidence: async ({ evidenceId }) => {
      const eid = toNonEmptyString(evidenceId);
      if (!eid) return { error: "evidenceId is required" };

      const e = evidenceById.get(eid);
      if (!e) return { error: `Evidence not found: ${eid}` };

      const source = sourceById.get(String(e.sourceId));
      let todoIds = Array.isArray(e?.todoIds) ? e.todoIds : [];
      if (!todoIds.length && Array.isArray(e?.gapIds)) {
        todoIds = e.gapIds
          .map((gid) => todoIdByGapId.get(String(gid)) || deriveTodoIdFromGapId(gid))
          .map((id) => String(id || "").trim())
          .filter(Boolean);
      }

      return {
        evidenceId: e.evidenceId,
        sourceId: e.sourceId,
        sourceTitle: source?.title || "Unknown Source",
        sourceUri: source?.uri,
        quote: e.quote,
        locator: e.locator,
        todoIds,
        gapIds: e.gapIds,
        // 提示：可以用 getSourceChunk 获取更多上下文
        hint: e.locator ? "Use getSourceChunk to read more context around this quote" : null,
      };
    },

    /**
     * 读取原文片段（扩展上下文）
     */
    getSourceChunk: async ({ sourceId, start, end }) => {
      const sid = toNonEmptyString(sourceId);
      if (!sid) return { error: "sourceId is required" };

      const sourceText = sourceTextById.get(sid);
      if (typeof sourceText !== "string") {
        return { error: `Source text not available for: ${sid}` };
      }

      const s = safeInt(start) ?? 0;
      const e = safeInt(end) ?? Math.min(s + 1000, sourceText.length);
      const clampedStart = Math.max(0, Math.min(s, sourceText.length));
      const clampedEnd = Math.max(clampedStart, Math.min(e, sourceText.length));

      const source = sourceById.get(sid);

      return {
        sourceId: sid,
        sourceTitle: source?.title || "Unknown",
        charStart: clampedStart,
        charEnd: clampedEnd,
        totalLength: sourceText.length,
        text: sourceText.slice(clampedStart, clampedEnd),
      };
    },

    /**
     * 语义搜索证据库
     */
    searchEvidence: async ({ query, limit = 10 }) => {
      const q = toNonEmptyString(query);
      if (!q) return { error: "query is required" };

      const queryLower = q.toLowerCase();
      const results = [];

      for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
        const quote = typeof e?.quote === "string" ? e.quote : "";
        const score = quote.toLowerCase().includes(queryLower) ? 1 : 0;
        if (score > 0 || results.length < 3) { // 保证至少返回一些结果
          const source = sourceById.get(String(e.sourceId));
          let todoIds = Array.isArray(e?.todoIds) ? e.todoIds : [];
          if (!todoIds.length && Array.isArray(e?.gapIds)) {
            todoIds = e.gapIds
              .map((gid) => todoIdByGapId.get(String(gid)) || deriveTodoIdFromGapId(gid))
              .map((id) => String(id || "").trim())
              .filter(Boolean);
          }
          results.push({
            evidenceId: e.evidenceId,
            sourceId: e.sourceId,
            sourceTitle: source?.title || "Unknown",
            quotePreview: quote.slice(0, 200) + (quote.length > 200 ? "..." : ""),
            relevanceScore: score,
            todoIds,
            gapIds: e.gapIds,
          });
        }
      }

      // 按相关性排序
      results.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));

      return {
        query: q,
        totalResults: results.length,
        results: results.slice(0, safeInt(limit) || 10),
      };
    },

    // 大纲规划
    planOutline: async ({ sections }) => {
      if (!Array.isArray(sections) || !sections.length) {
        return { error: "sections array is required" };
      }

      context._plannedOutline = sections.map((s, i) => ({
        sectionId: s.sectionId || `sec_${i + 1}`,
        title: s.title || `Section ${i + 1}`,
        todoIds: Array.isArray(s.todoIds) ? s.todoIds : toNonEmptyString(s.todoId) ? [String(s.todoId)] : [],
        gapIds: Array.isArray(s.gapIds) ? s.gapIds : toNonEmptyString(s.gapId) ? [String(s.gapId)] : [],
        targetWords: s.targetWords || Math.floor(targetWords / sections.length),
      }));

      return {
        success: true,
        outline: context._plannedOutline,
        message: "Outline planned. Now write sections in order.",
      };
    },

    // 编辑已写章节
    editSection: async ({ sectionId, markdown }) => {
      const sid = toNonEmptyString(sectionId);
      const md = toNonEmptyString(markdown);
      if (!sid || !md) return { error: "sectionId and markdown required" };

      const idx = writtenSections.findIndex(s => s.sectionId === sid);
      if (idx === -1) return { error: `Section not found: ${sid}` };

      writtenSections[idx].markdown = md;
      writtenSections[idx].wordCount = countWordsApprox(md);
      sectionClaimIdsBySectionId.set(sid, computeClaimIdsUsedByMarkdown(md));
      recomputeUsedClaimIds();

      return {
        success: true,
        sectionId: sid,
        newWordCount: writtenSections[idx].wordCount,
      };
    },

    // 获取写作进度
    getProgress: async () => {
      const currentWords = writtenSections.reduce((sum, s) => sum + (s.wordCount || 0), 0);
      const plannedSections = context._plannedOutline || [];
      const writtenIds = new Set(writtenSections.map(s => s.sectionId));
      const remaining = plannedSections.filter(s => !writtenIds.has(s.sectionId));

      return {
        currentWords,
        targetWords: context._targetWords || 3500,
        minWords: context._minWords || 2000,
        maxWords: context._maxWords || 5000,
        progress: currentWords / (context._targetWords || 3500),
        sectionsWritten: writtenSections.length,
        sectionsRemaining: remaining.length,
        remainingSectionIds: remaining.map(s => s.sectionId),
        onTrack: currentWords >= (context._minWords || 2000) * 0.8,
      };
    },

    /**
     * 写入一个章节（问题驱动）
     */
    writeSection: async ({ sectionId, todoId, gapId, title, markdown }) => {
      const md = toNonEmptyString(markdown);
      if (!md) return { error: "markdown content is required" };

      const sid = toNonEmptyString(sectionId) || `sec_${writtenSections.length + 1}`;
      const tid = resolveTodoId({ todoId, gapId });
      const todo = tid ? todoById.get(tid) : null;
      const gid = toNonEmptyString(gapId) || resolveGapIdForTodo(todo);
      const gap = gid ? gapById.get(gid) : null;
      const sectionTitle =
        toNonEmptyString(title) || (todo?.text ? String(todo.text) : gap?.question ? String(gap.question) : `Section ${writtenSections.length + 1}`);

      // 检查是否已存在该 sectionId，如果是则更新
      const existingIdx = writtenSections.findIndex(s => s.sectionId === sid);
      const resolvedTodoId = tid || (existingIdx !== -1 ? writtenSections[existingIdx]?.todoId : null) || null;
      const resolvedGapId = gid || (existingIdx !== -1 ? writtenSections[existingIdx]?.gapId : null) || null;
      if (existingIdx !== -1) {
        writtenSections[existingIdx] = {
          ...writtenSections[existingIdx],
          todoId: resolvedTodoId,
          gapId: resolvedGapId,
          title: sectionTitle,
          markdown: md,
          wordCount: countWordsApprox(md),
        };
      } else {
        writtenSections.push({
          sectionId: sid,
          todoId: resolvedTodoId,
          gapId: resolvedGapId,
          title: sectionTitle,
          markdown: md,
          wordCount: countWordsApprox(md),
        });
      }

      sectionClaimIdsBySectionId.set(sid, computeClaimIdsUsedByMarkdown(md));
      recomputeUsedClaimIds();

      const currentWords = writtenSections.reduce((sum, s) => sum + (s.wordCount || 0), 0);

      return {
        success: true,
        todoId: resolvedTodoId,
        gapId: resolvedGapId,
        sectionId: sid,
        title: sectionTitle,
        wordCount: countWordsApprox(md),
        totalWords: currentWords,
        targetWords: context._targetWords || 3500,
        progress: `${currentWords}/${context._targetWords || 3500} words`,
      };
    },

    /**
     * 完成报告
     */
    finishReport: async ({ title, executiveSummary, summary }) => {
      reportTitle = toNonEmptyString(title) || "Research Report";
      reportSummary = toNonEmptyString(executiveSummary) || toNonEmptyString(summary) || "";
      reportFinished = true;

      const totalWords = writtenSections.reduce((sum, s) => sum + (s.wordCount || 0), 0);
      const meetsMin = totalWords >= (context._minWords || 1500);

      return {
        success: true,
        title: reportTitle,
        sectionsCount: writtenSections.length,
        totalWords,
        meetsMinimum: meetsMin,
        warning: meetsMin ? null : `Report is ${(context._minWords || 1500) - totalWords} words short of minimum`,
      };
    },
  };

  // 返回执行器和结果获取函数
  return {
    execute: async (toolName, params) => {
      const tool = tools[toolName];
      if (!tool) {
        return { error: `Unknown tool: ${toolName}` };
      }
      try {
        return await tool(params || {});
      } catch (err) {
        return { error: String(err?.message || err) };
      }
    },

    getResult: () => ({
      finished: reportFinished,
      title: reportTitle,
      summary: reportSummary,
      sections: writtenSections,
    }),

    getAvailableTools: () => Object.keys(tools),
  };
}

// ===== ReAct Writer 主循环 =====

const WRITER_SYSTEM_PROMPT = `You are an expert research report writer. Your task is to write a well-structured, insightful report.

## Writing Philosophy
- **Synthesize, don't enumerate**: Connect ideas across questions, find patterns and insights
- **Reader-first**: Guide readers through a logical narrative, not a Q&A dump
- **Evidence-backed**: Every claim needs citation, but weave them naturally into prose
- **Professional tone**: Match the specified style (academic/business/casual)
- **Follow language instructions**: Obey any language requirement in the user prompt

## Report Structure
1. **Executive Summary**: Key findings and implications (written LAST)
2. **Introduction**: Context, scope, why this matters
3. **Main Sections**: Organized by THEME, not by question
   - Group related questions into coherent sections
   - Use transitions between sections
   - Synthesize findings, don't just list them
4. **Conclusion**: Key takeaways, implications, recommendations

## Available Tools
- getTodos(): Get todos to understand scope
- getTodoDetail({todoId}): Get todo details and claims
- getClaimsForTodo({todoId}): Get all claims with evidence
- getEvidence({evidenceId}): Get full quote and source
- getSourceChunk({sourceId, start, end}): Read more context
- searchEvidence({query}): Search evidence by keyword
- planOutline({sections}): Plan report structure BEFORE writing
- writeSection({sectionId, todoId, title, markdown}): Write a section
- editSection({sectionId, markdown}): Edit existing section
- getProgress(): Check current word count vs target
- finishReport({title, executiveSummary}): Complete with summary

## Response Format
{
  "thought": "Reasoning about current state and next action",
  "action": { "tool": "...", "params": {...} }
}

## Writing Process
1. FIRST: Call getTodos() to understand all tasks
2. THEN: Call planOutline() to design report structure
3. FOR EACH section: gather evidence, then writeSection
4. PERIODICALLY: call getProgress() to check word count
5. FINALLY: write executive summary and finishReport

## Citation Format
Use {{cite:EVIDENCE_ID}} inline. Example:
"The market grew 15% {{cite:e_1}} driven by AI adoption {{cite:e_2}}."

## Anti-patterns (NEVER do these)
- ❌ Do NOT repeat section titles in markdown headings
- ❌ Do NOT create a "References" or "Bibliography" section (handled automatically)
- ❌ Do NOT cite the same evidence more than 3 times per section
- ❌ Do NOT include raw tables or code blocks in citations
- ❌ Do NOT generate section summaries at the end of each section`;

const WRITER_INITIAL_PROMPT = `## Research Task
{taskGoal}

## Language
{languageInstruction}

## Report Requirements
- Target length: {targetWords} words (min: {minWords}, max: {maxWords})
- Writing style: {tone}
- Target audience: {audience}

## Instructions
1. Start by calling getTodos() to see all tasks
2. Then call planOutline() to design your report structure
3. Write sections that SYNTHESIZE findings (don't just answer questions one by one)
4. Check getProgress() periodically to stay on target

Begin now.`;

/**
 * 运行 ReAct Writer
 */
export async function runReactWriter(context, options = {}) {
  const { state, claims, evidenceLedger, sources, stageApi, todos, gaps } = context;
  const gapRows = Array.isArray(gaps) ? gaps : Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const todoRows = Array.isArray(todos) ? todos : Array.isArray(state?.todos) ? state.todos : [];

  const {
    targetWords = 2000,
    minWords = 1500,
    maxWords = 3000,
    tone,
    audience,
    hardLimit = 30,
    onStep,
  } = options;

  const callModel = getModelCaller(stageApi, { usage: "writer", state });
  if (!callModel) {
    throw new Error("No model caller available for writer");
  }

  const toolExecutor = createWriterToolExecutor({
    state,
    claims,
    evidenceLedger,
    sources,
    todos: todoRows,
    gaps: gapRows,
    // 新增：传递配置
    _targetWords: targetWords,
    _minWords: minWords,
    _maxWords: maxWords,
    _tone: tone || "business",
    _audience: audience || "general",
  });

  const taskGoal = toNonEmptyString(state?.taskGoal) || "Generate research report";
  const toneText = toNonEmptyString(tone) || "business";
  const audienceText = toNonEmptyString(audience) || "general";
  const language = toNonEmptyString(options.language) || 'auto';

  let languageInstruction = '';
  if (language === 'zh') {
    languageInstruction = '**IMPORTANT: Write the entire report in Chinese (中文).**';
  } else if (language === 'en') {
    languageInstruction = '**IMPORTANT: Write the entire report in English.**';
  } else {
    languageInstruction = '**IMPORTANT: Write in the same language as the task goal. If the task is in Chinese, write in Chinese. If in English, write in English.**';
  }

  // 异步加载提示词
  const writerSystemPrompt = await getWriterSystemPrompt();
  const writerInitialPrompt = await getWriterInitialPrompt();

  const messages = [
    { role: "system", content: writerSystemPrompt },
    {
      role: "user",
      content: writerInitialPrompt
        .replace("{taskGoal}", taskGoal)
        .replace("{languageInstruction}", languageInstruction)
        .replace("{targetWords}", String(targetWords))
        .replace("{minWords}", String(minWords))
        .replace("{maxWords}", String(maxWords))
        .replace("{tone}", toneText)
        .replace("{audience}", audienceText),
    },
  ];

  const steps = [];
  let stepCount = 0;

  while (stepCount < hardLimit) {
    checkCancelled(stageApi);
    stepCount++;

    // 调用模型
    const response = await callModel(messages, {
      model: "auto",
      temperature: 0.3,
      maxTokens: 1500,
    });

    const content = response?.content || "";
    const jsonCandidate = extractJsonCandidate(content);

    let parsed = null;
    try {
      parsed = jsonCandidate ? JSON.parse(jsonCandidate) : null;
    } catch {
      parsed = null;
    }

    if (!parsed || !isPlainObject(parsed)) {
      // 模型输出无效，记录并继续
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: "Invalid response format. Please respond with valid JSON containing 'thought' and 'action' or 'finish'.",
      });
      continue;
    }

    const thought = toNonEmptyString(parsed.thought) || "";
    const action = parsed.action;
    const finish = parsed.finish;

    // 记录步骤
    const step = {
      stepNumber: stepCount,
      thought,
      action: action || finish,
      observation: null,
    };

    // 添加到消息历史
    messages.push({ role: "assistant", content });

    // 处理 finish
    if (finish && isPlainObject(finish)) {
      const toolName = finish.tool || "finishReport";
      const params = finish.params || {};

      const result = await toolExecutor.execute(toolName, params);
      step.observation = result;
      steps.push(step);

      onStep?.(step);
      break;
    }

    // 处理 action
    if (action && isPlainObject(action)) {
      const toolName = toNonEmptyString(action.tool);
      const params = action.params || {};

      if (!toolName) {
        messages.push({
          role: "user",
          content: "Action must specify a 'tool' name. Available tools: " + toolExecutor.getAvailableTools().join(", "),
        });
        continue;
      }

      const result = await toolExecutor.execute(toolName, params);
      step.observation = result;
      steps.push(step);

      onStep?.(step);

      if (toolName === "finishReport" || toolExecutor.getResult().finished) {
        break;
      }

      // 将观察结果返回给模型
      messages.push({
        role: "user",
        content: `Observation:\n${JSON.stringify(result, null, 2)}\n\nContinue with next action or finish if all questions are answered.`,
      });
      continue;
    }

    // 无效的响应结构
    messages.push({
      role: "user",
      content: "Please respond with either 'action' (to use a tool) or 'finish' (to complete the report).",
    });
  }

  // 获取最终结果
  const writerResult = toolExecutor.getResult();

  // 组装报告
  const sectionsMarkdown = writerResult.sections
    .map(s => {
      const md = stripLeadingDuplicateHeading(s.markdown, s.title);
      return `## ${s.title}\n\n${md}`;
    })
    .join("\n\n");

  const fullMarkdown = `# ${writerResult.title || "Research Report"}\n\n${writerResult.summary ? writerResult.summary + "\n\n" : ""}${sectionsMarkdown}`;

  // 处理引用
  const finalized = finalizeCitationsInMarkdown(fullMarkdown, evidenceLedger, sources);

  return {
    title: writerResult.title,
    summary: writerResult.summary,
    sections: writerResult.sections,
    draftMarkdown: fullMarkdown,
    markdown: finalized.markdown,
    citations: finalized.citations,
    steps,
    stepCount,
    finished: writerResult.finished,
  };
}

export default { createWriterToolExecutor, runReactWriter };
