/**
 * DeepSearch Flow Visualization v6
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

// 阶段配置
const STAGES = {
  start: { icon: "▶", label: "开始", color: "#6366f1" },
  scan: { icon: "◎", label: "扫描", color: "#f59e0b" },
  gaps: { icon: "◇", label: "缺口", color: "#3b82f6" },
  retrieve: { icon: "⟳", label: "检索", color: "#8b5cf6" },
  understand: { icon: "◈", label: "理解", color: "#10b981" },
  write: { icon: "✎", label: "写作", color: "#ec4899" },
  condense: { icon: "◆", label: "压缩", color: "#06b6d4" },
  external: { icon: "⊕", label: "外搜", color: "#0ea5e9" },
  checkpoint: { icon: "◉", label: "存档", color: "#f97316" },
  iteration: { icon: "↻", label: "迭代", color: "#6366f1" },
  end: { icon: "✓", label: "完成", color: "#22c55e" },
  error: { icon: "✕", label: "错误", color: "#ef4444" },
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
          label: "开始研究",
          status: "completed",
          metrics: { runId: payload.runId }
        });
        this.parentStack.push(id);
        break;
      }

      case "deepsearch.completed": {
        const parentId = this._getCurrentParent();
        this._addNode("end", "end", {
          label: "研究完成",
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
          label: "研究中止",
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
          label: `并行探索 ×${payload.n}`,
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
          label: `轨迹 ${trajectoryId}`,
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
          label: "合并轨迹",
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
        const mergeNodes = this.nodes.filter(n => n.data.label === "合并轨迹");
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
          label: `迭代 #${iteration + 1}`,
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
          label: `存档点`,
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
          details: [{ type: "error", text: typeof error === "string" ? error : error?.message || "错误" }]
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
              text: `去重: ${payload.before} → ${payload.after}`
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
              text: `重排: ${payload.inputCount} → ${payload.outputCount}`
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
              text: `需要更多: ${payload.suggestions?.join(', ') || '继续研究'}`,
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
              text: `提供商: ${payload.providers.join(', ')}`
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
              text: `${provider}: "${query}" → ${resultCount}条`
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
              text: `写作: ${payload.sectionTitle} (${payload.sectionIndex + 1}/${payload.sectionCount})`
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
            label: "回溯"
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
 * 初始化流程可视化
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

  // 极简白卡片节点
  const RichNode = memo(({ data }) => {
    const { nodeType, label, icon, color, status, opacity = 1, metrics = {}, details = [], layoutDir = "TB" } = data;

    const isRunning = status === "running";
    const isCompleted = status === "completed";
    const isFailed = status === "failed";
    const isLR = layoutDir === "LR";

    // Handle 位置：LR 布局用左右，TB 布局用上下
    const targetPos = isLR ? Position.Left : Position.Top;
    const sourcePos = isLR ? Position.Right : Position.Bottom;

    // 状态颜色
    const statusColors = {
      running: { dot: "#6366f1", border: "#e0e7ff", bg: "#fafbff" },
      completed: { dot: "#22c55e", border: "#dcfce7", bg: "#fafffe" },
      failed: { dot: "#ef4444", border: "#fee2e2", bg: "#fffafa" },
      pending: { dot: "#cbd5e1", border: "#f1f5f9", bg: "#fafbfc" },
    };
    const colors = statusColors[status] || statusColors.pending;

    // 指标文字 - 显示所有
    const metricsText = Object.entries(metrics)
      .filter(([k, v]) => v !== undefined && v !== null && !["iteration", "runId", "strategy", "trajectory"].includes(k))
      .map(([k, v]) => {
        const labels = {
          sources: "源", newGaps: "+缺口", totalGaps: "缺口", retrieved: "片段",
          claims: "论点", evidence: "证据", slides: "页", chunks: "外部",
          kept: "保留", hits: "命中", openGaps: "待解决", trajectories: "轨迹",
          documents: "文档", evidences: "证据", providers: "搜索源"
        };
        return `${v}${labels[k] || k}`;
      })
      .join(" · ");

    return h("div", {
      style: {
        width: 320,
        background: colors.bg,
        borderRadius: 14,
        border: `1.5px solid ${colors.border}`,
        fontFamily: "Inter, -apple-system, system-ui, sans-serif",
        opacity,
        boxShadow: isRunning
          ? "0 0 0 3px rgba(99,102,241,0.1), 0 4px 16px rgba(0,0,0,0.06)"
          : "0 2px 12px rgba(0,0,0,0.04)",
        transition: "all 0.25s ease",
      }
    },
      h(Handle, { type: "target", position: targetPos, style: { opacity: 0 } }),

      // 头部
      h("div", {
        style: {
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }
      },
        // 状态点
        h("div", {
          style: {
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: colors.dot,
            flexShrink: 0,
            animation: isRunning ? "pulse 1.5s infinite" : "none",
          }
        }),
        // 图标 + 标签
        h("span", { style: { fontSize: 14, opacity: 0.6 } }, icon),
        h("span", {
          style: { fontSize: 13, fontWeight: 600, color: "#334155", flex: 1 }
        }, label),
        // 指标
        metricsText && h("span", {
          style: {
            fontSize: 11,
            color: "#64748b",
            background: "rgba(0,0,0,0.04)",
            padding: "2px 8px",
            borderRadius: 6,
          }
        }, metricsText)
      ),

      // 详情 - 全部展开
      details.length > 0 && h("div", {
        style: {
          padding: "0 12px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }
      },
        ...details.map((d, i) => {
          const typeColors = {
            gap: { bg: "#eff6ff", border: "#3b82f6", icon: "Q" },
            claim: { bg: "#f0fdf4", border: "#22c55e", icon: "•" },
            section: { bg: "#fdf4ff", border: "#d946ef", icon: "§" },
            search: { bg: "#ecfeff", border: "#06b6d4", icon: "⊕" },
            error: { bg: "#fef2f2", border: "#ef4444", icon: "!" },
            reflect: { bg: "#fefce8", border: "#eab308", icon: "?" },
            dedupe: { bg: "#f8fafc", border: "#94a3b8", icon: "−" },
            rerank: { bg: "#f8fafc", border: "#94a3b8", icon: "↕" },
            summary: { bg: "#f8fafc", border: "#94a3b8", icon: "∑" },
            writing: { bg: "#faf5ff", border: "#a855f7", icon: "✎" },
            written: { bg: "#f0fdf4", border: "#22c55e", icon: "✓" },
            providers: { bg: "#ecfeff", border: "#06b6d4", icon: "◎" },
          };
          const tc = typeColors[d.type] || { bg: "#f8fafc", border: "#e2e8f0", icon: "›" };

          return h("div", {
            key: i,
            style: {
              fontSize: 12,
              color: d.type === "error" ? "#b91c1c" : "#475569",
              padding: "8px 10px",
              background: tc.bg,
              borderRadius: 8,
              borderLeft: `3px solid ${tc.border}`,
              lineHeight: 1.5,
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
        style: { stroke: "rgba(148,163,184,0.4)", strokeWidth: 2 },
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
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.2); }
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

    // 计算节点实际高度
    const detailCount = latest.data.details?.length || 0;
    const nodeHeight = 60 + detailCount * 50;
    const nodeWidth = 320;

    // 居中到最后更新的节点
    const centerX = latest.position.x + nodeWidth / 2;
    const centerY = latest.position.y + nodeHeight / 2;

    instance.setCenter(centerX, centerY, { duration: 300, zoom: 0.85 });
  };

  const refresh = () => {
    const { nodes, edges, lastUpdatedNodeId } = builder.getFlowData();
    const layout = applyDagreLayout(nodes, edges, direction);
    if (flowApi) {
      flowApi.setNodes(layout.nodes);
      flowApi.setEdges(layout.edges);
      // 延迟确保 React 渲染完成
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
