/**
 * DeepSearch Flow Visualization v6 (Premium)
 * 非线性拓扑 - 支持并行轨迹、条件分支、回溯
 */

const CDN = {
  react: "https://cdn.jsdelivr.net/npm/react@18.2.0/+esm",
  reactDom: "https://cdn.jsdelivr.net/npm/react-dom@18.2.0/+esm",
  reactFlow: "https://cdn.jsdelivr.net/npm/reactflow@11.7.4/+esm",
  dagre: "https://cdn.jsdelivr.net/npm/dagre@0.8.5/dist/dagre.min.js",
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

// 阶段配置 - Premium Colors
const STAGES = {
  start: { icon: "▶", label: "Start", color: "#4F46E5" },
  scan: { icon: "◎", label: "Scan", color: "#0EA5E9" },
  gaps: { icon: "◇", label: "Gaps", color: "#F59E0B" },
  retrieve: { icon: "⟳", label: "Retrieve", color: "#8B5CF6" },
  understand: { icon: "◈", label: "Understand", color: "#10B981" },
  write: { icon: "✎", label: "Write", color: "#EC4899" },
  condense: { icon: "◆", label: "Condense", color: "#06B6D4" },
  external: { icon: "⊕", label: "Search", color: "#3B82F6" },
  checkpoint: { icon: "◉", label: "Save", color: "#F97316" },
  iteration: { icon: "↻", label: "Iterate", color: "#6366F1" },
  end: { icon: "✓", label: "Done", color: "#10B981" },
  error: { icon: "✕", label: "Error", color: "#EF4444" },
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

    // 累计数据
    this.gaps = new Map();
    this.claims = [];
    this.sections = [];
    this.tokenUsage = { input: 0, output: 0, cost: 0 };
    this.externalProgress = [];
  }

  _genId(prefix = "n") {
    return `${prefix}_${++this.idCounter}`;
  }

  _getCurrentParent() {
    return this.parentStack.length > 0 ? this.parentStack[this.parentStack.length - 1] : null;
  }

  _addNode(id, type, data = {}) {
    const config = STAGES[type] || STAGES.start;
    const parentId = data.parentNodeId || this._getCurrentParent();

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
      // 先保存原有 details，防止被空数组覆盖
      const existingDetails = node.data.details || [];

      node.data = { ...node.data, ...updates };
      if (updates.metrics) {
        node.data.metrics = { ...node.data.metrics, ...updates.metrics };
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
        const { iteration, openGapCount, trajectoryId } = payload;
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
            openGaps: openGapCount,
          }
        });
        this.iterationNodes.set(iteration, id);
        this.parentStack.push(id);
        break;
      }

      case "iteration.completed": {
        const { iteration, hitCount, noNewHitsRounds, openGapCount } = payload;
        const id = this.iterationNodes.get(iteration);
        if (id) {
          this._updateNode(id, {
            status: "completed",
            metrics: {
              hits: hitCount,
              noHitRounds: noNewHitsRounds,
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

        // 确定父节点
        let parentId = eventParent;
        if (!parentId && trajectoryId) {
          parentId = this.trajectoryNodes.get(trajectoryId);
        }
        if (!parentId) {
          parentId = this._getCurrentParent();
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

      // === Gaps 阶段 ===
      case "deepsearch.gaps.completed": {
        const id = this._getLatestStageNode("gaps");
        if (id) {
          this._updateNode(id, {
            metrics: {
              newGaps: payload.gapCount,
              totalGaps: payload.totalGaps,
              todos: payload.todoCount
            }
          });
        }
        break;
      }

      case "deepsearch.gap.upserted": {
        const { gapId, question, status, priority, type } = payload;
        this.gaps.set(gapId, { gapId, question, status, priority, type });

        const id = this._getLatestStageNode("gaps");
        if (id && question) {
          this._updateNode(id, {
            details: [{
              type: "gap",
              id: gapId,
              text: question,
              priority,
              status
            }]
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
        const gapsId = this._getLatestStageNode("gaps");
        if (writeId && gapsId) {
          this._addEdge(writeId, gapsId, {
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
    }
  }

  getFlowData() {
    return {
      nodes: this.nodes.map(n => ({ ...n, data: { ...n.data } })),
      edges: [...this.edges],
      lastUpdatedNodeId: this.lastUpdatedNodeId
    };
  }

  getStats() {
    return {
      gaps: this.gaps,
      claims: this.claims,
      sections: this.sections,
      tokenUsage: this.tokenUsage,
      externalProgress: this.externalProgress
    };
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
    this.gaps.clear();
    this.claims = [];
    this.sections = [];
    this.tokenUsage = { input: 0, output: 0, cost: 0 };
    this.externalProgress = [];
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
    marginx: 60,
    marginy: 60,
    ranker: 'tight-tree'  // 更紧凑的层级分配
  });

  for (const n of nodes) {
    const detailCount = n.data.details?.length || 0;
    const height = 60 + detailCount * 50;
    g.setNode(n.id, { width: 320, height });
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

  const { direction = "TB", height = 600 } = options;

  const [ReactMod, ReactDOMMod, RFMod] = await Promise.all([
    import(CDN.react),
    import(CDN.reactDom),
    import(CDN.reactFlow),
  ]);
  await loadScript(CDN.dagre);

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
        border: borderStyle,
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

      // 详情
      details.length > 0 && h("div", {
        style: {
          padding: "0 12px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }
      },
        ...details.map((d, i) => {
          return h("div", {
            key: i,
            style: {
              fontSize: 11,
              color: "#64748b",
              padding: "6px 10px",
              background: "rgba(241, 245, 249, 0.5)",
              borderRadius: 8,
              lineHeight: 1.4,
              border: "1px solid rgba(0,0,0,0.02)"
            }
          }, d.text);
        })
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
      fitViewOptions: { padding: 0.2, maxZoom: 1 },
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
        height: ${height}px;
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

  // 聚焦最后更新的节点
  const focusOnLatest = (nodes, lastUpdatedId) => {
    const instance = flowApi?.getInstance?.();
    if (!instance || nodes.length === 0) return;

    // 找到最后更新的节点
    const latest = lastUpdatedId
      ? nodes.find(n => n.id === lastUpdatedId)
      : nodes[nodes.length - 1];

    if (!latest) return;

    const detailCount = latest.data.details?.length || 0;
    const nodeHeight = 60 + detailCount * 50;
    const nodeWidth = 320;

    const centerX = latest.position.x + nodeWidth / 2;
    const centerY = latest.position.y + nodeHeight / 2;

    instance.setCenter(centerX, centerY, { duration: 400, zoom: 0.95 });
  };

  const refresh = () => {
    const { nodes, edges, lastUpdatedNodeId } = builder.getFlowData();
    const layout = applyDagreLayout(nodes, edges, direction);
    if (flowApi) {
      flowApi.setNodes(layout.nodes);
      flowApi.setEdges(layout.edges);
      setTimeout(() => focusOnLatest(layout.nodes, lastUpdatedNodeId), 150);
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
      return eventBus.on("*", event => {
        const name = event?.name || "";
        if (name.startsWith("deepsearch.") || name === "iteration.completed") {
          this.processEvent(event);
        }
      });
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
