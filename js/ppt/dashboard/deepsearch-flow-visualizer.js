/**
 * DeepSearch Flow Visualization v6 (Premium)
 * 非线性拓扑 - 支持并行轨迹、条件分支、回溯
 */

import { FlowStage } from '../workflow/workflow-states.js';

const CDN = {
  react: [
    "https://cdn.jsdelivr.net/npm/react@18.2.0/+esm",
    "https://esm.sh/react@18.2.0",
    "https://unpkg.com/react@18.2.0?module",
  ],
  reactDom: [
    "https://cdn.jsdelivr.net/npm/react-dom@18.2.0/+esm",
    "https://esm.sh/react-dom@18.2.0",
    "https://esm.sh/react-dom@18.2.0/client",
    "https://unpkg.com/react-dom@18.2.0?module",
    "https://unpkg.com/react-dom@18.2.0/client?module",
  ],
  reactFlow: [
    "https://cdn.jsdelivr.net/npm/reactflow@11.7.4/+esm",
    "https://esm.sh/reactflow@11.7.4",
    "https://unpkg.com/reactflow@11.7.4?module",
  ],
  dagre: [
    "https://cdn.jsdelivr.net/npm/dagre@0.8.5/dist/dagre.min.js",
    "https://unpkg.com/dagre@0.8.5/dist/dagre.min.js",
  ],
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function ensureArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

async function importEsmWithFallback(urls, label = "module") {
  const candidates = ensureArray(urls);
  let lastErr = null;
  for (const url of candidates) {
    try {
      return await import(url);
    } catch (err) {
      lastErr = err;
    }
  }
  const hint = candidates.length ? `Tried: ${candidates.join(", ")}` : "No candidates provided";
  const err = lastErr instanceof Error ? lastErr : new Error(String(lastErr || "unknown error"));
  err.message = `[flow-viz] Failed to import ${label}. ${hint}. Last error: ${err.message}`;
  throw err;
}

async function loadScriptWithFallback(urls, label = "script") {
  const candidates = ensureArray(urls);
  let lastErr = null;
  for (const url of candidates) {
    try {
      await loadScript(url);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  const hint = candidates.length ? `Tried: ${candidates.join(", ")}` : "No candidates provided";
  const err = lastErr instanceof Error ? lastErr : new Error(String(lastErr || "unknown error"));
  err.message = `[flow-viz] Failed to load ${label}. ${hint}. Last error: ${err.message}`;
  throw err;
}

// 阶段配置 - Premium Colors
const STAGES = {
  [FlowStage.START]: { icon: "▶", label: "Start", color: "#4F46E5" },
  [FlowStage.SCAN]: { icon: "◎", label: "Scan", color: "#0EA5E9" },
  [FlowStage.TODOS]: { icon: "☑", label: "Todos", color: "#F59E0B" },
  [FlowStage.RETRIEVE]: { icon: "⟳", label: "Retrieve", color: "#8B5CF6" },
  [FlowStage.UNDERSTAND]: { icon: "◈", label: "Understand", color: "#10B981" },
  [FlowStage.WRITE]: { icon: "✎", label: "Write", color: "#EC4899" },
  [FlowStage.CONDENSE]: { icon: "◆", label: "Condense", color: "#06B6D4" },
  [FlowStage.EXTERNAL]: { icon: "⊕", label: "Search", color: "#3B82F6" },
  [FlowStage.CHECKPOINT]: { icon: "◉", label: "Save", color: "#F97316" },
  [FlowStage.ITERATION]: { icon: "↻", label: "Iterate", color: "#6366F1" },
  // Design Flow (复用同一可视化引擎)
  [FlowStage.DESIGN_START]: { icon: "▣", label: "Design", color: "#EC4899" },
  [FlowStage.DESIGN_THEME]: { icon: "✦", label: "Theme", color: "#F43F5E" },
  design_phase: { icon: "◧", label: "Phase", color: "#F97316" },
  [FlowStage.DESIGN_BATCH]: { icon: "▦", label: "Batch", color: "#8B5CF6" },
  [FlowStage.DESIGN_SLIDE]: { icon: "▤", label: "Slide", color: "#0EA5E9" },
  [FlowStage.DESIGN_QA]: { icon: "✓", label: "QA", color: "#10B981" },
  [FlowStage.END]: { icon: "✓", label: "Done", color: "#10B981" },
  [FlowStage.ERROR]: { icon: "✕", label: "Error", color: "#EF4444" },
};

/**
 * 非线性 FlowBuilder - 支持并行轨迹和分支
 */
export class FlowBuilder {
  constructor() {
    this.nodes = [];
    this.edges = [];
    this.nodeMap = new Map();
    this.idCounter = 0;
    this.currentIteration = -1;
    this.lastUpdatedNodeId = null;  // 跟踪最后更新的节点

    // 用于追踪父子关系
    this.parentStack = []; // 当前父节点栈
    this.trajectoryNodes = new Map(); // trajectoryId -> nodeId
    this.iterationNodes = new Map(); // iteration -> nodeId
    this.stageLatestNodeId = new Map(); // stage -> nodeId
    this.runIdToStartNode = new Map(); // runId -> start node id (修复边连接问题)

    // 累计数据
    this.todos = new Map();
    this.claims = [];
    this.sections = [];
    this.tokenUsage = { input: 0, output: 0, cost: 0 };
    this.externalProgress = [];

    // Design flow tracking
    this.designBatchNodes = new Map(); // batchIndex -> nodeId
    this.designSlideNodes = new Map(); // slideIndex -> nodeId
    this.designImageNodes = new Map(); // imageId -> nodeId
    this.designPhaseNodes = new Map(); // phase -> nodeId
    this._activeDesignPhaseId = null;
    this._refineStepNodeId = null;
    this._visualRenderNodeId = null;
    this._allEvents = []; // 存储所有处理过的事件用于点选查询
    this._eventNodeMap = new Map(); // eventId -> nodeId 映射
    this._nodeEventMap = new Map(); // nodeId -> [eventId] 映射
  }

  _genId(prefix = "n") {
    return `${prefix}_${++this.idCounter}`;
  }

  _getCurrentParent() {
    return this.parentStack.length > 0 ? this.parentStack[this.parentStack.length - 1] : null;
  }

  _addNode(id, type, data = {}) {
    const config = STAGES[type] || STAGES[FlowStage.START];
    let parentId = data.parentNodeId || this._getCurrentParent();

    // 如果 parentId 是 runId，尝试映射到实际的 start 节点
    if (parentId && this.runIdToStartNode.has(parentId)) {
      parentId = this.runIdToStartNode.get(parentId);
    }

    const node = {
      id,
      type: "rich",
      position: { x: 0, y: 0 },
      data: {
        ...data,
        nodeType: type,
        label: data.label || config.label,
        icon: config.icon,
        color: config.color,
        status: data.status || "pending",
        metrics: data.metrics || {},
        details: data.details || [],
      },
    };
    this.nodes.push(node);
    this.nodeMap.set(id, node);
    this.lastUpdatedNodeId = id;  // 记录最后更新

    // 建立边：连接到父节点
    if (parentId && parentId !== id) {
      this._addEdge(parentId, id);
    }

    // 记录事件映射（如果有 eventId）
    if (data.eventId) {
      this._eventNodeMap.set(data.eventId, id);
      const nodeEvents = this._nodeEventMap.get(id) || [];
      nodeEvents.push(data.eventId);
      this._nodeEventMap.set(id, nodeEvents);
    }

    return node;
  }

  _addEdge(source, target, options = {}) {
    if (!source || !target || source === target) return;
    const id = `e_${source}_${target}`;
    if (this.edges.find(e => e.id === id)) return;
    this.edges.push({
      id,
      source,
      target,
      type: options.type || "smoothstep",
      animated: options.animated || false,
      style: options.style,
      label: options.label,
    });
  }

  _updateNode(id, updates) {
    const node = this.nodeMap.get(id);
    if (node) {
      // 先保存原有 details 和 metrics，防止被覆盖
      const existingDetails = node.data.details || [];
      const existingMetrics = node.data.metrics || {};

      node.data = { ...node.data, ...updates };
      if (updates.metrics) {
        node.data.metrics = { ...existingMetrics, ...updates.metrics };
      }
      // 只在有新内容时追加，否则保持原有
      if (updates.details && updates.details.length > 0) {
        node.data.details = [...existingDetails, ...updates.details];
      } else {
        node.data.details = existingDetails;
      }
      this.lastUpdatedNodeId = id;  // 记录最后更新
    }
  }

  _getLatestStageNode(stage) {
    return this.stageLatestNodeId.get(stage);
  }

  processEvent(event) {
    const name = event?.name || event;
    const payload = event?.payload || event?.record?.payload || event?.record || {};

    // 存储事件用于点选查询
    if (event?.eventId) {
      this._allEvents.push(event);
    }

    switch (name) {
      // === 生命周期 ===
      case "deepsearch.started": {
        const id = "start";
        this._addNode(id, "start", {
          label: "Start Research",
          status: "completed",
          metrics: { runId: payload.runId }
        });
        this.parentStack.push(id);
        // 建立 runId -> start 节点的映射，解决后续事件 parentNodeId 为 runId 时找不到父节点的问题
        if (payload.runId) {
          this.runIdToStartNode.set(payload.runId, id);
        }
        break;
      }

      case "deepsearch.completed": {
        const parentId = this._getCurrentParent();
        this._addNode("end", "end", {
          label: "Completed",
          status: "completed",
          parentNodeId: parentId,
          metrics: {
            slides: payload.slideCount,
            claims: payload.claimCount
          }
        });
        break;
      }

      case "deepsearch.aborted": {
        const parentId = this._getCurrentParent();
        this._addNode("end_abort", "error", {
          label: "Aborted",
          status: "failed",
          parentNodeId: parentId,
          metrics: { iteration: payload.iteration }
        });
        break;
      }

      // === 轨迹分叉 ===
      case "deepsearch.trajectory.forked": {
        const parentId = this._getCurrentParent();
        const forkId = this._genId("fork");
        this._addNode(forkId, "iteration", {
          label: `Parallel x${payload.n}`,
          status: "running",
          parentNodeId: parentId,
          metrics: {
            trajectories: payload.n,
            strategy: payload.mergeStrategy
          }
        });
        this.parentStack.push(forkId);
        break;
      }

      case "deepsearch.trajectory.started": {
        const { trajectoryId, iteration } = payload;
        const parentId = this._getCurrentParent();
        const id = `traj_${trajectoryId}`;
        this._addNode(id, "iteration", {
          label: `Track ${trajectoryId}`,
          status: "running",
          parentNodeId: parentId,
          metrics: { iteration }
        });
        this.trajectoryNodes.set(trajectoryId, id);
        break;
      }

      case "deepsearch.trajectory.completed": {
        const { trajectoryId, claimCount, evidenceCount } = payload;
        const id = this.trajectoryNodes.get(trajectoryId);
        if (id) {
          this._updateNode(id, {
            status: "completed",
            metrics: { claims: claimCount, evidence: evidenceCount }
          });
        }
        break;
      }

      case "deepsearch.trajectory.merge.started": {
        const parentId = this._getCurrentParent();
        const id = this._genId("merge");
        this._addNode(id, "condense", {
          label: "Merge Tracks",
          status: "running",
          parentNodeId: parentId,
          metrics: {
            count: payload.trajectoryCount,
            strategy: payload.mergeStrategy
          }
        });
        // 从所有轨迹节点连接到合并节点
        for (const [, trajNodeId] of this.trajectoryNodes) {
          this._addEdge(trajNodeId, id, { animated: true });
        }
        break;
      }

      case "deepsearch.trajectory.merge.completed": {
        const mergeNodes = this.nodes.filter(n => n.data.label === "Merge Tracks");
        const lastMerge = mergeNodes[mergeNodes.length - 1];
        if (lastMerge) {
          this._updateNode(lastMerge.id, {
            status: "completed",
            metrics: {
              mergedClaims: payload.mergedClaimCount,
              mergedEvidence: payload.mergedEvidenceCount
            }
          });
          // 更新父节点栈
          if (this.parentStack[this.parentStack.length - 1]?.startsWith("fork")) {
            this.parentStack.pop();
          }
          this.parentStack.push(lastMerge.id);
        }
        break;
      }

      // === 迭代 ===
      case "deepsearch.iteration.started": {
        const { iteration, openTodoCount, openGapCount, trajectoryId } = payload;
        this.currentIteration = iteration;

        // 确定父节点：如果在轨迹内，用轨迹节点；否则用当前栈顶
        const parentId = trajectoryId
          ? this.trajectoryNodes.get(trajectoryId)
          : this._getCurrentParent();

        const id = trajectoryId ? `iter_${trajectoryId}_${iteration}` : `iter_${iteration}`;
        this._addNode(id, "iteration", {
          label: `Iteration #${iteration + 1}`,
          status: "running",
          parentNodeId: parentId,
          metrics: {
            openTodos: typeof openTodoCount === "number" ? openTodoCount : openGapCount,
            openGaps: openGapCount,
          }
        });
        this.iterationNodes.set(iteration, id);
        this.parentStack.push(id);
        break;
      }

      case "iteration.completed":
      case "deepsearch.iteration.completed": {
        const { iteration, hitCount, noNewHitsRounds, openTodoCount, openGapCount } = payload;
        const id = this.iterationNodes.get(iteration);
        if (id) {
          this._updateNode(id, {
            status: "completed",
            metrics: {
              hits: hitCount,
              noHitRounds: noNewHitsRounds,
              openTodos: typeof openTodoCount === "number" ? openTodoCount : openGapCount,
              openGaps: openGapCount
            }
          });
        }
        // 迭代完成，弹出栈
        if (this.parentStack[this.parentStack.length - 1] === id) {
          this.parentStack.pop();
        }
        break;
      }

      case "deepsearch.checkpoint.saved": {
        const { checkpointId, iteration, metrics } = payload;
        const parentId = this._getCurrentParent();
        const id = `cp_${iteration}_${this.idCounter}`;
        this._addNode(id, "checkpoint", {
          label: `Checkpoint`,
          status: "completed",
          parentNodeId: parentId,
          metrics: { id: checkpointId?.slice(-6), ...metrics }
        });
        break;
      }

      // === 节点生命周期（阶段节点）===
      case "deepsearch.node.started": {
        const { nodeId, stage, iteration, trajectoryId, parentNodeId: eventParent } = payload;
        const id = nodeId || this._genId(stage);

        // 确定父节点：优先使用 parentStack（迭代节点），这样阶段节点会正确连接到迭代
        // 只有在栈为空时才使用 eventParent 或 trajectoryNodes
        let parentId = this._getCurrentParent();
        if (!parentId && trajectoryId) {
          parentId = this.trajectoryNodes.get(trajectoryId);
        }
        if (!parentId) {
          parentId = eventParent;
        }

        this._addNode(id, stage, {
          status: "running",
          parentNodeId: parentId,
          metrics: { iteration }
        });
        this.stageLatestNodeId.set(stage, id);
        break;
      }

      case "deepsearch.node.completed": {
        const { nodeId, outcome, summary } = payload;
        this._updateNode(nodeId, {
          status: "completed",
          details: summary ? [{ type: "summary", text: summary }] : []
        });
        break;
      }

      case "deepsearch.node.failed": {
        const { nodeId, error } = payload;
        this._updateNode(nodeId, {
          status: "failed",
          details: [{ type: "error", text: typeof error === "string" ? error : error?.message || "Error" }]
        });
        break;
      }

      // === Scan 阶段 ===
      case "deepsearch.scan.completed": {
        const id = this._getLatestStageNode("scan");
        if (id) {
          this._updateNode(id, {
            metrics: {
              sources: payload.sourceCount,
              steps: payload.plannedSteps
            }
          });
        }
        break;
      }

      // === Todos 阶段 ===
      case "deepsearch.todos.started": {
        const id = this._getLatestStageNode("todos");
        const parentId = this._getCurrentParent();
        if (!id) {
          const nodeId = this._genId("todos");
          this._addNode(nodeId, "todos", {
            status: "running",
            parentNodeId: parentId,
            metrics: {
              existing: payload.existingTodoCount,
              hasUserTodos: payload.hasUserTodos
            }
          });
          this.stageLatestNodeId.set("todos", nodeId);
        } else {
          this._updateNode(id, {
            status: "running",
            metrics: {
              existing: payload.existingTodoCount,
              hasUserTodos: payload.hasUserTodos
            }
          });
        }
        break;
      }

      case "deepsearch.todos.completed": {
        const id = this._getLatestStageNode("todos");
        if (id) {
          this._updateNode(id, {
            status: "completed",
            metrics: {
              totalTodos: payload.todoCount,
              createdTodos: payload.createdCount,
              skippedLLM: payload.skippedLLM,
              source: payload.source
            }
          });
        }
        break;
      }

      case "deepsearch.todo.created": {
        const { todoId, status, priority, source, text } = payload;
        if (todoId) {
          this.todos.set(todoId, { todoId, status, priority, source, text });
        }
        const id = this._getLatestStageNode("todos");
        if (id) {
          const summary = this._summarizeTodos();
          this._updateNode(id, {
            metrics: {
              totalTodos: summary.total,
              openTodos: summary.open,
              completedTodos: summary.completed,
              cancelledTodos: summary.cancelled
            },
            details: [
              {
                type: "todo",
                id: todoId,
                text: text || todoId,
                priority,
                status
              }
            ]
          });
        }
        break;
      }

      case "deepsearch.todo.status.changed": {
        const { todoId, to } = payload;
        if (todoId && this.todos.has(todoId)) {
          const row = this.todos.get(todoId);
          this.todos.set(todoId, { ...row, status: to || row.status });
        }
        const id = this._getLatestStageNode("todos");
        if (id) {
          const summary = this._summarizeTodos();
          this._updateNode(id, {
            metrics: {
              totalTodos: summary.total,
              openTodos: summary.open,
              completedTodos: summary.completed,
              cancelledTodos: summary.cancelled
            },
            details: [
              {
                type: "todo_status",
                id: todoId,
                text: `Todo ${todoId}: ${payload.from} → ${payload.to}`
              }
            ]
          });
        }
        break;
      }

      // === Retrieve 阶段 ===
      case "deepsearch.retrieve.completed": {
        const id = this._getLatestStageNode("retrieve");
        if (id) {
          this._updateNode(id, {
            metrics: {
              retrieved: payload.retrievedCount || payload.chunkCount,
              beforeDedupe: payload.retrievedBeforeDedupe,
              externalTriggered: payload.externalSearchTriggered,
              externalChunks: payload.externalChunksCount
            }
          });
        }
        break;
      }

      case "deepsearch.retrieve.deduped": {
        const id = this._getLatestStageNode("retrieve");
        if (id) {
          this._updateNode(id, {
            details: [{
              type: "dedupe",
              text: `Dedupe: ${payload.before} → ${payload.after}`
            }]
          });
        }
        break;
      }

      case "deepsearch.rerank.completed": {
        const id = this._getLatestStageNode("retrieve");
        if (id) {
          this._updateNode(id, {
            details: [{
              type: "rerank",
              text: `Rerank: ${payload.inputCount} → ${payload.outputCount}`
            }]
          });
        }
        break;
      }

      // === Understand 阶段 ===
      case "deepsearch.understand.completed": {
        const id = this._getLatestStageNode("understand");
        if (id) {
          this._updateNode(id, {
            metrics: {
              claims: payload.claimCount,
              evidence: payload.evidenceCount,
              conflicts: payload.conflictCount,
            }
          });
        }
        break;
      }

      case "deepsearch.claim.snapshot": {
        const { claims } = payload;
        if (Array.isArray(claims)) {
          this.claims = claims;
          const id = this._getLatestStageNode("understand");
          if (id) {
            // 显示所有 claims，不截断
            const allClaims = claims.map(c => ({
              type: "claim",
              id: c.claimId,
              text: c.textPreview || '',
              importance: c.importance
            }));
            this._updateNode(id, { details: allClaims });
          }
        }
        break;
      }

      case "deepsearch.reflect.needsmore": {
        const id = this._getLatestStageNode("understand");
        if (id) {
          this._updateNode(id, {
            details: [{
              type: "reflect",
              text: `Needs More: ${payload.suggestions?.join(', ') || 'Continue Research'}`,
            }]
          });
        }
        break;
      }

      // === External Search 阶段（条件分支）===
      case "deepsearch.external.started": {
        const id = this._getLatestStageNode("external");
        if (id) {
          this._updateNode(id, {
            metrics: {
              providers: payload.providerCount,
              gaps: payload.gapCount,
            },
            details: payload.providers ? [{
              type: "providers",
              text: `Providers: ${payload.providers.join(', ')}`
            }] : []
          });
        }
        break;
      }

      case "deepsearch.external.progress": {
        const { provider, query, resultCount } = payload;
        this.externalProgress.push({ provider, query, resultCount });

        const id = this._getLatestStageNode("external");
        if (id) {
          this._updateNode(id, {
            details: [{
              type: "search",
              text: `${provider}: "${query}" → ${resultCount}`
            }]
          });
        }
        break;
      }

      case "deepsearch.external.completed": {
        const id = this._getLatestStageNode("external");
        if (id) {
          this._updateNode(id, {
            metrics: {
              chunks: payload.chunksCount,
              documents: payload.documentsCount,
              evidences: payload.evidencesCount
            }
          });
        }
        break;
      }

      case "deepsearch.external.skipped": {
        // 外搜被跳过 - 可选显示
        break;
      }

      // === Write 阶段 ===
      case "deepsearch.write.toc.planned": {
        const { sections, sectionCount, maxParallel } = payload;
        this.sections = sections || [];

        const id = this._getLatestStageNode("write");
        if (id) {
          this._updateNode(id, {
            metrics: {
              sections: sectionCount,
              parallel: maxParallel
            },
            // 显示所有 sections，不截断
            details: (sections || []).map(s => ({
              type: "section",
              id: s.sectionId,
              text: s.title,
            }))
          });
        }
        break;
      }

      case "deepsearch.write.section.started": {
        const id = this._getLatestStageNode("write");
        if (id) {
          this._updateNode(id, {
            details: [{
              type: "writing",
              text: `Writing: ${payload.sectionTitle} (${payload.sectionIndex + 1}/${payload.sectionCount})`
            }]
          });
        }
        break;
      }

      case "deepsearch.write.section.completed": {
        const id = this._getLatestStageNode("write");
        if (id) {
          this._updateNode(id, {
            details: [{
              type: "written",
              text: `✓ ${payload.sectionTitle}`
            }]
          });
        }
        break;
      }

      case "deepsearch.write.review.completed": {
        const id = this._getLatestStageNode("write");
        if (id) {
          this._updateNode(id, {
            metrics: {
              reviewRound: payload.round,
              score: payload.overallScore,
              issues: payload.issueCount,
            }
          });
        }
        break;
      }

      case "deepsearch.write.completed": {
        const id = this._getLatestStageNode("write");
        if (id) {
          this._updateNode(id, {
            metrics: {
              slides: payload.slideCount,
              claims: payload.claimCount
            }
          });
        }
        break;
      }

      case "deepsearch.write.backtrack.requested": {
        // 回溯请求 - 添加回溯边
        const writeId = this._getLatestStageNode("write");
        const todosId = this._getLatestStageNode("todos");
        if (writeId && todosId) {
          this._addEdge(writeId, todosId, {
            animated: true,
            style: { stroke: "#f59e0b", strokeDasharray: "5,5" },
            label: "Backtrack"
          });
        }
        break;
      }

      // === Condense 阶段 ===
      case "deepsearch.condense.completed": {
        const id = this._getLatestStageNode("condense");
        if (id) {
          this._updateNode(id, {
            metrics: {
              kept: payload.keptChunks
            },
            // 显示完整 summary，不截断
            details: payload.summary ? [{
              type: "summary",
              text: payload.summary
            }] : []
          });
        }
        break;
      }

      // === Token 使用 ===
      case "deepsearch.token.usage": {
        this.tokenUsage.input += payload.inputTokens || 0;
        this.tokenUsage.output += payload.outputTokens || 0;
        this.tokenUsage.cost += payload.cost || 0;
        break;
      }

      // === Design Flow ===
      case "design.started": {
        const id = "design_start";
        this._addNode(id, "design_start", {
          label: "Design Started",
          status: "completed",
          metrics: { runId: payload.runId, slides: payload.slideCount }
        });
        this.parentStack.push(id);
        break;
      }

      case "design.tokens.ended": {
        const parentId = this._getCurrentParent();
        const id = this._genId("theme");
        this._addNode(id, "design_theme", {
          label: "Theme",
          status: "completed",
          parentNodeId: parentId,
          metrics: { theme: payload.theme }
        });
        break;
      }

      case "design.phase.transition": {
        const parentId = this._getCurrentParent();
        const to = payload?.to || payload?.phase;
        const from = payload?.from;
        if (!to) break;

        const phaseLabels = {
          outline_parsing: "Outline Parse",
          outline_confirming: "Outline Confirm",
          style_extracting: "Style Extract",
          style_confirming: "Style Confirm",
          generating: "Generate Slides",
          generating_paused: "Generate Paused",
          reviewing: "Review",
          fixing: "Fix",
          visual_filling: "Visual Fill",
          completed: "Completed",
          failed: "Failed",
          editing: "Editing"
        };
        const label = phaseLabels[to] || to;
        const status = to === "completed" ? "completed" : to === "failed" ? "failed" : "running";
        const existingId = this.designPhaseNodes.get(to);
        const id = existingId || this._genId(`phase_${to}`);

        if (this._activeDesignPhaseId && this._activeDesignPhaseId !== id) {
          this._updateNode(this._activeDesignPhaseId, { status: "completed" });
        }
        if (from && this.designPhaseNodes.has(from)) {
          this._updateNode(this.designPhaseNodes.get(from), { status: "completed" });
        }

        if (existingId) {
          this._updateNode(id, {
            status,
            metrics: { from, to }
          });
        } else {
          this._addNode(id, "design_phase", {
            label,
            status,
            parentNodeId: parentId,
            metrics: { from, to }
          });
        }

        this.designPhaseNodes.set(to, id);
        this._activeDesignPhaseId = status === "running" ? id : null;
        break;
      }

      case "design.image.planning.completed": {
        const parentId = this._getCurrentParent();
        const id = this._genId("img");
        this._addNode(id, "checkpoint", {
          label: "Image Plan",
          status: "completed",
          parentNodeId: parentId,
          metrics: { planned: payload.planned, cost: payload.estimatedCostUSD }
        });
        break;
      }

      case "design.image.generate.started": {
        const imageId = payload.imageId || payload.slotId || this._genId("img");
        const parentId = this._getCurrentParent();
        const id = `img_gen_${imageId}`;
        this._addNode(id, "design_slide", {
          label: `Image ${payload.slideIndex !== undefined ? `S${payload.slideIndex + 1}` : imageId}`,
          status: "running",
          parentNodeId: parentId,
          metrics: { provider: payload.provider }
        });
        if (!this.designImageNodes) this.designImageNodes = new Map();
        this.designImageNodes.set(imageId, id);
        break;
      }

      case "design.image.generate.succeeded": {
        const imageId = payload.imageId || payload.slotId;
        const id = this.designImageNodes?.get(imageId);
        if (id) {
          const metrics = {};
          if (payload.durationMs !== undefined) metrics.duration = payload.durationMs;
          // Preserve the provider from `design.image.generate.started` unless explicitly provided here.
          if (payload.provider !== undefined) metrics.provider = payload.provider;
          this._updateNode(id, {
            status: "completed",
            metrics
          });
        }
        break;
      }

      case "design.image.generate.failed": {
        const imageId = payload.imageId || payload.slotId;
        const id = this.designImageNodes?.get(imageId);
        if (id) {
          this._updateNode(id, {
            status: "failed",
            details: [{ text: `Failed: ${payload.error || "unknown error"}` }]
          });
        }
        break;
      }

      case "design.image.generate.skipped": {
        const imageId = payload.slotId;
        const parentId = this._getCurrentParent();
        const id = `img_skip_${imageId || this.idCounter++}`;
        this._addNode(id, "checkpoint", {
          label: `Image Skipped`,
          status: "completed",
          parentNodeId: parentId,
          metrics: { reason: payload.reason },
          details: [{ text: payload.reason || "Skipped" }]
        });
        break;
      }

      case "design.image.fill.completed": {
        const parentId = this._getCurrentParent();
        const id = this._genId("img_fill");
        this._addNode(id, "checkpoint", {
          label: "Images Filled",
          status: "completed",
          parentNodeId: parentId,
          metrics: { filled: payload.filledCount, pending: payload.pendingCount }
        });
        break;
      }

      case "design.svg.generate.completed": {
        const parentId = this._getCurrentParent();
        const id = this._genId("svg_gen");
        this._addNode(id, "checkpoint", {
          label: "SVG Generated",
          status: "completed",
          parentNodeId: parentId,
          metrics: { slots: payload.slots }
        });
        break;
      }

      case "design.visual.render.started": {
        const parentId = this._getCurrentParent();
        const id = this._genId("visual_render");
        this._addNode(id, "design_slide", {
          label: "Visual Render",
          status: "running",
          parentNodeId: parentId,
          metrics: {
            total: payload.planned?.total,
            images: payload.planned?.["ai-image"],
            svg: payload.planned?.svg
          }
        });
        this._visualRenderNodeId = id;
        break;
      }

      case "design.visual.render.completed": {
        const id = this._visualRenderNodeId;
        if (id) {
          this._updateNode(id, {
            status: "completed",
            metrics: {
              images: payload.report?.completed?.["ai-image"],
              svg: payload.report?.completed?.svg,
              duration: payload.report?.durationMs
            }
          });
          this._visualRenderNodeId = null;
        }
        break;
      }

      case "design.visual.render.failed": {
        const id = this._visualRenderNodeId;
        if (id) {
          this._updateNode(id, {
            status: "failed",
            details: payload.report?.errors?.map(e => ({ text: `${e.renderer}: ${e.error}` })) || []
          });
          this._visualRenderNodeId = null;
        }
        break;
      }

      case "design.visual.errors": {
        const parentId = this._getCurrentParent();
        const id = this._genId("visual_err");
        const errors = Array.isArray(payload?.errors) ? payload.errors : [];
        this._addNode(id, "error", {
          label: "Visual Errors",
          status: "failed",
          parentNodeId: parentId,
          details: errors.map(e => ({ text: `${e.renderer || "visual"}: ${e.error || "unknown"}` }))
        });
        break;
      }

      case "design.batch.started": {
        const batchIndex = typeof payload.batchIndex === "number" ? payload.batchIndex : 0;
        const slideIndexes = Array.isArray(payload.slideIndexes) ? payload.slideIndexes : [];
        const parentId = this._getCurrentParent();
        const id = `batch_${batchIndex}`;
        this._addNode(id, "design_batch", {
          label: `Batch #${batchIndex + 1}`,
          status: "running",
          parentNodeId: parentId,
          metrics: { slides: slideIndexes.length || undefined }
        });
        this.designBatchNodes.set(batchIndex, id);
        this.parentStack.push(id);
        break;
      }

      case "design.batch.completed": {
        const batchIndex = typeof payload.batchIndex === "number" ? payload.batchIndex : 0;
        const id = this.designBatchNodes.get(batchIndex) || `batch_${batchIndex}`;
        this._updateNode(id, {
          status: "completed",
          metrics: { duration: payload.duration }
        });
        if (this.parentStack[this.parentStack.length - 1] === id) this.parentStack.pop();
        break;
      }

      case "design.generate.ended": {
        const parentId = this._getCurrentParent();
        const id = this._genId("gen_end");
        this._addNode(id, "checkpoint", {
          label: "Generation Done",
          status: "completed",
          parentNodeId: parentId,
          metrics: { slides: payload.slides ?? payload.slideCount, batches: payload.batchCount }
        });
        break;
      }

      case "design.slide.started": {
        const slideIndex = typeof payload.slideIndex === "number" ? payload.slideIndex : 0;
        const slideIntent = payload.slideIntent && typeof payload.slideIntent === "object" ? payload.slideIntent : {};
        const parentId = this._getCurrentParent();
        const id = `slide_${slideIndex}`;
        const title = typeof slideIntent.title === "string" ? slideIntent.title : "";
        const label = title ? `S${slideIndex + 1} ${title}` : `Slide ${slideIndex + 1}`;
        this._addNode(id, "design_slide", {
          label,
          status: "running",
          parentNodeId: parentId,
          metrics: { pageType: slideIntent.pageType }
        });
        this.designSlideNodes.set(slideIndex, id);
        break;
      }

      case "design.slide.progress": {
        const slideIndex = typeof payload.slideIndex === "number" ? payload.slideIndex : 0;
        const id = this.designSlideNodes.get(slideIndex) || `slide_${slideIndex}`;
        const detail = `${payload.step || "progress"}${payload.msg ? `: ${payload.msg}` : ""}`;
        this._updateNode(id, {
          status: "running",
          details: detail ? [{ text: detail }] : []
        });
        break;
      }

      case "design.slide.retrying": {
        const slideIndex = typeof payload.slideIndex === "number" ? payload.slideIndex : 0;
        const id = this.designSlideNodes.get(slideIndex) || `slide_${slideIndex}`;
        this._updateNode(id, {
          status: "running",
          details: [{ text: `Retrying (attempt ${Number(payload.attempt || 0)})` }]
        });
        break;
      }

      case "design.slide.failed": {
        const slideIndex = typeof payload.slideIndex === "number" ? payload.slideIndex : 0;
        const id = this.designSlideNodes.get(slideIndex) || `slide_${slideIndex}`;
        const errorMsg = typeof payload.error === "object" ? payload.error?.message : payload.error;
        this._updateNode(id, {
          status: "failed",
          details: [{ text: `Failed: ${errorMsg || "unknown error"}` }]
        });
        break;
      }

      case "design.degraded": {
        const slideIndex = typeof payload.slideIndex === "number" ? payload.slideIndex : undefined;
        const parentId = this._getCurrentParent();
        const id = this._genId("degraded");
        this._addNode(id, "error", {
          label: slideIndex !== undefined ? `S${slideIndex + 1} Degraded` : "Degraded",
          status: "failed",
          parentNodeId: parentId,
          details: [{ text: payload.reason || "Quality degradation detected" }]
        });
        break;
      }

      case "design.slide.completed": {
        const slideIndex = typeof payload.slideIndex === "number" ? payload.slideIndex : 0;
        const id = this.designSlideNodes.get(slideIndex) || `slide_${slideIndex}`;
        this._updateNode(id, {
          status: "completed",
          metrics: { duration: payload.duration }
        });
        break;
      }

      case "design.refine.step": {
        const parentId = this._getCurrentParent();
        const id = this._genId("refine_step");
        this._addNode(id, "iteration", {
          label: `Refine ${payload.step || "Step"}`,
          status: "running",
          parentNodeId: parentId,
          metrics: { iteration: payload.iteration, target: payload.target }
        });
        this._refineStepNodeId = id;
        break;
      }

      case "design.refine.ended": {
        if (this._refineStepNodeId) {
          this._updateNode(this._refineStepNodeId, {
            status: "completed",
            metrics: { improvements: payload.improvements }
          });
          this._refineStepNodeId = null;
        } else {
          const parentId = this._getCurrentParent();
          const id = this._genId("refine_end");
          this._addNode(id, "checkpoint", {
            label: "Refine Done",
            status: "completed",
            parentNodeId: parentId,
            metrics: { improvements: payload.improvements }
          });
        }
        break;
      }

      case "design.qa.ended": {
        const parentId = this._getCurrentParent();
        const id = this._genId("qa");
        this._addNode(id, "design_qa", {
          label: "QA Complete",
          status: "completed",
          parentNodeId: parentId,
          metrics: { degraded: payload.degradedCount, slides: payload.slides }
        });
        break;
      }

      case "design.ended": {
        const parentId = this._getCurrentParent();
        this._addNode("design_end", "end", {
          label: "Design Done",
          status: "completed",
          parentNodeId: parentId,
          metrics: { slides: payload.slides, degraded: payload.degradedCount }
        });
        break;
      }
    }
  }

  getFlowData() {
    return {
      nodes: this.nodes.map(n => ({ ...n, data: { ...n.data } })),
      edges: [...this.edges],
      lastUpdatedNodeId: this.lastUpdatedNodeId
    };
  }

  _summarizeTodos() {
    const todos = [...this.todos.values()];
    const statusOf = (todo) => {
      const raw = String(todo?.status || "open").toLowerCase();
      if (raw === "completed") return "completed";
      if (raw === "cancelled") return "cancelled";
      return "open";
    };
    const completed = todos.filter((t) => statusOf(t) === "completed").length;
    const cancelled = todos.filter((t) => statusOf(t) === "cancelled").length;
    const open = Math.max(0, todos.length - completed - cancelled);
    return { total: todos.length, open, completed, cancelled };
  }

  getStats() {
    return {
      todos: this.todos,
      claims: this.claims,
      sections: this.sections,
      tokenUsage: this.tokenUsage,
      externalProgress: this.externalProgress
    };
  }

  getEventsForNode(nodeId) {
    const eventIds = this._nodeEventMap.get(nodeId) || [];
    return this._allEvents.filter(e => eventIds.includes(e.eventId));
  }

  getNodeForEvent(eventId) {
    return this._eventNodeMap.get(eventId);
  }

  getAllEvents() {
    return this._allEvents;
  }

  findEventsByFilter(filter) {
    return this._allEvents.filter(e => {
      if (filter.nodeId && e.payload?.nodeId !== filter.nodeId) return false;
      if (filter.gapId && e.payload?.gapId !== filter.gapId) return false;
      if (filter.todoId && e.payload?.todoId !== filter.todoId) return false;
      if (filter.trajectoryId && e.payload?.trajectoryId !== filter.trajectoryId) return false;
      if (filter.stage && !e.name?.includes(filter.stage)) return false;
      return true;
    });
  }

  reset() {
    this.nodes = [];
    this.edges = [];
    this.nodeMap.clear();
    this.idCounter = 0;
    this.currentIteration = -1;
    this.lastUpdatedNodeId = null;
    this.parentStack = [];
    this.trajectoryNodes.clear();
    this.iterationNodes.clear();
    this.stageLatestNodeId.clear();
    this.runIdToStartNode.clear();
    this.todos.clear();
    this.claims = [];
    this.sections = [];
    this.tokenUsage = { input: 0, output: 0, cost: 0 };
    this.externalProgress = [];
    this.designBatchNodes.clear();
    this.designSlideNodes.clear();
    this.designImageNodes.clear();
    this.designPhaseNodes.clear();
    this._activeDesignPhaseId = null;
    this._refineStepNodeId = null;
    this._visualRenderNodeId = null;
    this._allEvents = [];
    this._eventNodeMap.clear();
    this._nodeEventMap.clear();
  }
}

// dagre 引用
let dagreLayout = null;
let dagreGraphlib = null;

function applyDagreLayout(nodes, edges, direction = "TB") {
  if (!dagreGraphlib || !dagreLayout || !nodes.length) {
    let y = 30;
    for (const n of nodes) {
      n.position = { x: 40, y };
      n.data.opacity = Math.max(0.2, 1 - (y / 800));
      y += 160;
    }
    return { nodes, edges };
  }

  const validEdges = edges.filter(e => e.source !== e.target);
  const g = new dagreGraphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  // 增加间距避免边与节点重叠
  g.setGraph({
    rankdir: direction,
    nodesep: 80,      // 同一层级节点间距
    ranksep: 120,     // 不同层级间距
    edgesep: 30,      // 边之间的间距
    marginx: 120,     // 增加左右边距，让节点更居中
    marginy: 60,
    ranker: 'tight-tree'  // 更紧凑的层级分配
  });

  for (const n of nodes) {
    const detailCount = Math.min(n.data.details?.length || 0, 3); // Max 3 details shown
    const height = Math.min(60 + detailCount * 40, 180); // Cap height at 180px
    g.setNode(n.id, { width: 280, height });
  }
  for (const e of validEdges) {
    g.setEdge(e.source, e.target);
  }

  dagreLayout(g);

  const isLR = direction === "LR";
  let minPos = Infinity, maxPos = -Infinity;

  for (const n of nodes) {
    const pos = g.node(n.id);
    if (pos) {
      n.position = { x: pos.x - 160, y: pos.y - (pos.height / 2) };
      n.data.layoutDir = direction;  // 注入布局方向
      const val = isLR ? n.position.x : n.position.y;
      minPos = Math.min(minPos, val);
      maxPos = Math.max(maxPos, val);
    }
  }

  // 透明度渐变：LR 按 x（右边新的清晰），TB 按 y（下边新的清晰）
  const range = maxPos - minPos || 1;
  for (const n of nodes) {
    const val = isLR ? n.position.x : n.position.y;
    const progress = (val - minPos) / range;
    // 新的（进度大的）更清晰
    n.data.opacity = Math.max(0.15, 0.15 + progress * 0.85);
  }

  return { nodes, edges: validEdges };
}

/**
 * 初始化流程可视化 - Premium Edition
 */
export async function initDeepSearchFlow(containerId, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  const {
    direction = "TB",
    height = 600,
    acceptPrefixes = ["deepsearch.", "design."],
    acceptNames = ["deepsearch.iteration.completed", "iteration.completed"],
  } = options;

  const [ReactMod, ReactDOMMod, RFMod] = await Promise.all([
    importEsmWithFallback(CDN.react, "react"),
    importEsmWithFallback(CDN.reactDom, "react-dom"),
    importEsmWithFallback(CDN.reactFlow, "reactflow"),
  ]);
  await loadScriptWithFallback(CDN.dagre, "dagre");

  const React = ReactMod.default || ReactMod;
  const ReactDOM = ReactDOMMod.default || ReactDOMMod;
  const { createElement: h, memo, useState, useCallback, useEffect } = React;
  const ReactFlow = RFMod.default;
  const { Handle, Position, applyNodeChanges, applyEdgeChanges } = RFMod;

  dagreLayout = window.dagre?.layout;
  dagreGraphlib = window.dagre?.graphlib;

  // 极简白卡片节点 - Premium Design
  const RichNode = memo(({ data }) => {
    const { nodeType, label, icon, color, status, opacity = 1, metrics = {}, details = [], layoutDir = "TB" } = data;

    const isRunning = status === "running";
    const isCompleted = status === "completed";
    const isFailed = status === "failed";
    const isLR = layoutDir === "LR";

    // Handle 位置
    const targetPos = isLR ? Position.Left : Position.Top;
    const sourcePos = isLR ? Position.Right : Position.Bottom;

    // 状态颜色 - Premium Palette
    const statusColors = {
      running: { dot: "#4F46E5", border: "rgba(79, 70, 229, 0.4)", bg: "#ffffff", text: "#0F172A", shadow: "0 8px 20px -4px rgba(79, 70, 229, 0.15), 0 4px 12px -2px rgba(79, 70, 229, 0.1)" },
      completed: { dot: "#10B981", border: "transparent", bg: "rgba(255,255,255,0.9)", text: "#334155", shadow: "0 2px 6px rgba(0,0,0,0.02)" },
      failed: { dot: "#EF4444", border: "rgba(239, 68, 68, 0.2)", bg: "#fef2f2", text: "#7f1d1d", shadow: "0 2px 8px rgba(239, 68, 68, 0.05)" },
      pending: { dot: "#CBD5E1", border: "transparent", bg: "rgba(248, 250, 252, 0.8)", text: "#94a3b8", shadow: "none" },
    };
    const colors = statusColors[status] || statusColors.pending;

    // 指标文字 - 简化显示
    const metricsText = Object.entries(metrics)
      .filter(([k, v]) => v !== undefined && v !== null && !["iteration", "runId", "strategy", "trajectory"].includes(k))
      .map(([k, v]) => {
        const labels = {
          sources: "Docs", newGaps: "Gaps", totalGaps: "Tot", retrieved: "Chunks",
          claims: "Claims", evidence: "Evid", slides: "Pg", chunks: "Ext",
          kept: "Keep", hits: "Hits", openGaps: "Open", trajectories: "Traj",
          documents: "Doc", evidences: "Ev"
        };
        return `${v} ${labels[k] || k}`;
      })
      .slice(0, 3)
      .join(" · ");

    // Running 状态下的边框动画
    const borderStyle = isRunning ? `1px solid ${colors.border}` : (isCompleted ? "1px solid rgba(0,0,0,0.05)" : "1px solid transparent");

    return h("div", {
      style: {
        width: 260,
        background: colors.bg,
        borderRadius: 16,
        border: data.highlighted ? `2px solid ${colors.dot}` : borderStyle,
        fontFamily: "'Inter', sans-serif",
        opacity,
        boxShadow: colors.shadow,
        transition: "all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)",
        transform: isRunning ? "scale(1.02) translateY(-2px)" : "scale(1)",
        backdropFilter: "blur(8px)",
        position: "relative"
      }
    },
      h(Handle, { type: "target", position: targetPos, style: { opacity: 0 } }),

      // 头部
      h("div", {
        style: {
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }
      },
        // 状态图标容器
        h("div", {
          style: {
            width: 32,
            height: 32,
            borderRadius: 10,
            background: isRunning ? "rgba(79, 70, 229, 0.1)" : (isCompleted ? "rgba(16, 185, 129, 0.1)" : "#f1f5f9"),
            color: colors.dot,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
            flexShrink: 0,
            transition: "all 0.3s"
          }
        }, icon),

        // 标签与状态
        h("div", { style: { flex: 1, minWidth: 0 } },
          h("div", {
            style: { fontSize: 13, fontWeight: 700, color: colors.text, marginBottom: 2, letterSpacing: "-0.01em" }
          }, label),

          metricsText && h("div", {
            style: { fontSize: 10, color: "rgba(0,0,0,0.4)", fontWeight: 500 }
          }, metricsText)
        ),

        // 运行中指示器 (Pulsing Dot)
        isRunning && h("div", {
          style: { width: 6, height: 6, borderRadius: "50%", background: "#4F46E5", boxShadow: "0 0 0 2px rgba(79,70,229,0.2)", animation: "pulse 1.5s infinite" }
        })
      ),

      // 详情 (最多显示3条)
      details.length > 0 && h("div", {
        style: {
          padding: "0 12px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }
      },
        ...details.slice(0, 3).map((d, i) => {
          return h("div", {
            key: i,
            style: {
              fontSize: 10,
              color: "#64748b",
              padding: "4px 8px",
              background: "rgba(241, 245, 249, 0.5)",
              borderRadius: 6,
              lineHeight: 1.3,
              border: "1px solid rgba(0,0,0,0.02)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "100%"
            }
          }, d.text?.slice?.(0, 50) || d.text);
        }),
        details.length > 3 && h("div", {
          style: { fontSize: 9, color: "#94a3b8", paddingLeft: 8 }
        }, `+${details.length - 3} more`)
      ),

      h(Handle, { type: "source", position: sourcePos, style: { opacity: 0 } })
    );
  });

  const nodeTypes = { rich: RichNode };

  let flowApi = null;
  let reactFlowInstance = null;

  function FlowComponent({ nodes: initNodes, edges: initEdges, onApiReady }) {
    const [nodes, setNodes] = useState(initNodes);
    const [edges, setEdges] = useState(initEdges);

    const onNodesChange = useCallback(changes => setNodes(nds => applyNodeChanges(changes, nds)), []);
    const onEdgesChange = useCallback(changes => setEdges(eds => applyEdgeChanges(changes, eds)), []);

    const onInit = useCallback((instance) => {
      reactFlowInstance = instance;
    }, []);

    useEffect(() => {
      onApiReady?.({ setNodes, setEdges, getInstance: () => reactFlowInstance });
    }, [onApiReady]);

    return h(ReactFlow, {
      nodes,
      edges,
      nodeTypes,
      onNodesChange,
      onEdgesChange,
      onInit,
      fitView: true,
      fitViewOptions: { padding: 0.35, maxZoom: 1 },
      minZoom: 0.3,
      maxZoom: 1.5,
      panOnDrag: true,
      zoomOnScroll: true,
      nodesDraggable: false,
      nodesConnectable: false,
      elementsSelectable: false,
      proOptions: { hideAttribution: true },
      defaultEdgeOptions: {
        type: "smoothstep",
        style: { stroke: "#cbd5e1", strokeWidth: 1.5 },
        animated: false,
      },
    });
  }

  const wrapper = document.createElement("div");
  wrapper.className = "ds-flow-rich";
  wrapper.innerHTML = `
    <style>
      .ds-flow-rich {
        width: 100%;
        height: ${height ? `${height}px` : '100%'};
      }
      .ds-flow-rich .react-flow { background: transparent !important; }
      .ds-flow-rich .react-flow__background { display: none !important; }
      .ds-flow-rich .react-flow__controls { display: none !important; }
      .ds-flow-rich .react-flow__minimap { display: none !important; }
      .ds-flow-rich .react-flow__attribution { display: none !important; }
      @keyframes pulse {
        0% { transform: scale(0.95); opacity: 0.5; }
        50% { transform: scale(1.1); opacity: 1; }
        100% { transform: scale(0.95); opacity: 0.5; }
      }
    </style>
    <div id="ds-flow-canvas" style="width:100%;height:100%;"></div>
  `;
  container.appendChild(wrapper);

  const canvas = wrapper.querySelector("#ds-flow-canvas");
  const builder = new FlowBuilder();

  const root = ReactDOM.createRoot ? ReactDOM.createRoot(canvas) : null;
  const render = (nodes, edges) => {
    const el = h(FlowComponent, { nodes, edges, onApiReady: api => { flowApi = api; } });
    if (root) root.render(el);
    else ReactDOM.render(el, canvas);
  };

  render([], []);

  // 智能聚焦：只在节点即将出视野时才移动，且保持更多卡片可见
  const focusOnLatest = (nodes, lastUpdatedId) => {
    const instance = flowApi?.getInstance?.();
    if (!instance || nodes.length === 0) return;

    // 找到最后更新的节点
    const latest = lastUpdatedId
      ? nodes.find(n => n.id === lastUpdatedId)
      : nodes[nodes.length - 1];

    if (!latest) return;

    const nodeWidth = 280;
    const nodeHeight = 80;
    const nodeCenterX = latest.position.x + nodeWidth / 2;
    const nodeCenterY = latest.position.y + nodeHeight / 2;

    // 获取当前视口信息
    const { x: vpX, y: vpY, zoom } = instance.getViewport();
    const container = document.getElementById(containerId);
    if (!container) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // 计算节点在屏幕上的位置
    const screenX = nodeCenterX * zoom + vpX;
    const screenY = nodeCenterY * zoom + vpY;

    // 定义安全边距（节点距离边缘多近时才移动）
    const marginX = containerWidth * 0.15;
    const marginY = containerHeight * 0.15;

    const inViewX = screenX > marginX && screenX < containerWidth - marginX;
    const inViewY = screenY > marginY && screenY < containerHeight - marginY;

    // 如果节点在安全区域内，不移动
    if (inViewX && inViewY) return;

    // 节点快出视野了，计算最小移动量让它回到安全区域
    let targetVpX = vpX;
    let targetVpY = vpY;

    if (!inViewX) {
      if (screenX <= marginX) {
        // 节点在左边，视口往左移（vpX 增大）
        targetVpX = vpX + (marginX - screenX) + 50;
      } else {
        // 节点在右边，视口往右移（vpX 减小）
        targetVpX = vpX - (screenX - (containerWidth - marginX)) - 50;
      }
    }

    if (!inViewY) {
      if (screenY <= marginY) {
        targetVpY = vpY + (marginY - screenY) + 30;
      } else {
        targetVpY = vpY - (screenY - (containerHeight - marginY)) - 30;
      }
    }

    // 平滑移动到新视口位置，保持当前 zoom
    instance.setViewport({ x: targetVpX, y: targetVpY, zoom }, { duration: 300 });
  };

  // 动态计算 fitView padding：节点少时紧凑，节点多时扩大
  const getDynamicPadding = (nodeCount) => {
    if (nodeCount <= 3) return 0.25;
    if (nodeCount <= 6) return 0.35;
    if (nodeCount <= 10) return 0.45;
    return 0.5;
  };

  let lastNodeCount = 0;
  let hasInitialFit = false;

  const refresh = () => {
    const { nodes, edges, lastUpdatedNodeId } = builder.getFlowData();
    const layout = applyDagreLayout(nodes, edges, direction);
    if (flowApi) {
      flowApi.setNodes(layout.nodes);
      flowApi.setEdges(layout.edges);

      const instance = flowApi.getInstance?.();
      const nodeCount = nodes.length;

      if (instance && nodeCount > 0) {
        // 策略：
        // 1. 首次渲染或节点很少时 -> fitView 全览
        // 2. 节点数量增加较多时（如新迭代开始）-> fitView 重新适配
        // 3. 其他情况 -> 只用智能追踪，不打断用户视角

        const shouldFitView = !hasInitialFit
          || nodeCount <= 4
          || (nodeCount - lastNodeCount >= 3);  // 节点增加3个以上才重新适配

        if (shouldFitView) {
          const padding = getDynamicPadding(nodeCount);
          setTimeout(() => {
            instance.fitView({ padding, maxZoom: 0.9, duration: 300 });
            hasInitialFit = true;
          }, 100);
        } else {
          // 节点数量变化不大，只用智能追踪
          setTimeout(() => focusOnLatest(layout.nodes, lastUpdatedNodeId), 100);
        }

        lastNodeCount = nodeCount;
      }
    } else {
      render(layout.nodes, layout.edges);
    }
  };

  return {
    processEvent(event) {
      builder.processEvent(event);
      refresh();
    },
    processEvents(events) {
      events.forEach(e => builder.processEvent(e));
      refresh();
    },
    subscribe(eventBus) {
      const prefixes = Array.isArray(acceptPrefixes) ? acceptPrefixes.filter(Boolean).map(String) : [];
      const names = new Set(Array.isArray(acceptNames) ? acceptNames.filter(Boolean).map(String) : []);
      return eventBus.on("*", event => {
        const name = event?.name || "";
        if (names.has(name)) return this.processEvent(event);
        if (prefixes.some(p => name.startsWith(p))) return this.processEvent(event);
      });
    },
    onNodeClick(nodeId, callback) {
      const events = builder.getEventsForNode(nodeId);
      callback?.(events, nodeId);
      return events;
    },
    seekToEvent(eventId) {
      const nodeId = builder.getNodeForEvent(eventId);
      if (!nodeId) return null;

      const instance = flowApi?.getInstance?.();
      if (!instance) return nodeId;

      const { nodes } = builder.getFlowData();
      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        instance.setCenter(
          node.position.x + 140,
          node.position.y + 40,
          { duration: 300, zoom: 1 }
        );
      }

      return nodeId;
    },
    highlightNode(nodeId, highlight = true) {
      if (!flowApi) return;
      flowApi.setNodes(nds => nds.map(n => ({
        ...n,
        data: {
          ...n.data,
          highlighted: n.id === nodeId ? highlight : false
        }
      })));
    },
    getEventsForNode(nodeId) {
      return builder.getEventsForNode(nodeId);
    },
    getAllEvents() {
      return builder.getAllEvents();
    },
    findEvents(filter) {
      return builder.findEventsByFilter(filter);
    },
    getStats() {
      return builder.getStats();
    },
    reset() {
      builder.reset();
      refresh();
    },
    destroy() {
      if (root) root.unmount();
      wrapper.remove();
    },
  };
}

export default { FlowBuilder, initDeepSearchFlow };
