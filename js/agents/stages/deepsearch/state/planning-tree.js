/**
 * @typedef {object} PlanningTreeOptions
 * @property {string=} rootGoal
 * @property {string=} runId
 */

/**
 * @typedef {object} PlanningTreeJson
 * @property {string=} rootGoal
 * @property {string=} runId
 * @property {any[]=} nodes
 */

import { makeSecureTimestampedId, toNonEmptyString, deepClone } from "../../../shared/index.js";

/**
 * @typedef {object} PlanningNode
 * @property {string} nodeId
 * @property {"gap"|"todo"|"generic"} kind
 * @property {string=} gapId
 * @property {string=} todoId
 * @property {string=} parentId
 * @property {string} title
 * @property {string} status
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {any[]} decisions
 * @property {Record<string, any>} metadata
 */

/**
 * Minimal planning tree scaffold used by DeepSearch.
 *
 * @param {PlanningTreeOptions=} options
 * @returns {PlanningTree}
 */
export class PlanningTree {
  /**
   * @param {PlanningTreeOptions=} [options]
   */
  constructor(options = {}) {
    this.rootGoal = options.rootGoal || "";
    this.runId = options.runId || "";
    /** @type {Map<string, PlanningNode>} */
    this.nodes = new Map();
  }

  /**
   * @param {any} gap
   * @param {{ parentId?: string, nodeId?: string, title?: string, status?: string }=} [options]
   * @returns {PlanningNode}
   */
  expandFromGap(gap, options = {}) {
    const gid = toNonEmptyString(gap?.gapId) || toNonEmptyString(options?.nodeId);
    const existing = gid ? this.getNodesForGap(gid)[0] : null;
    if (existing) {
      if (toNonEmptyString(gap?.status)) existing.status = toNonEmptyString(gap.status);
      if (toNonEmptyString(gap?.summary)) existing.title = toNonEmptyString(gap.summary);
      existing.updatedAt = new Date().toISOString();
      return { ...existing, decisions: deepClone(existing.decisions), metadata: deepClone(existing.metadata) };
    }

    const status = toNonEmptyString(gap?.status) || toNonEmptyString(options?.status) || "open";
    const title = toNonEmptyString(options?.title) || toNonEmptyString(gap?.summary) || toNonEmptyString(gap?.query) || "Gap";

    return this._upsertNode({
      nodeId: toNonEmptyString(options?.nodeId),
      kind: "gap",
      gapId: gid || undefined,
      parentId: toNonEmptyString(options?.parentId),
      title,
      status,
      metadata: gap && typeof gap === "object" ? deepClone(gap) : {},
    });
  }

  /**
   * @param {any} todo
   * @param {{ parentId?: string, nodeId?: string, title?: string, status?: string }=} [options]
   * @returns {PlanningNode}
   */
  expandFromTodo(todo, options = {}) {
    const todoId = toNonEmptyString(todo?.todoId) || toNonEmptyString(todo?.id);
    const existing = todoId ? this.getNodesForTodo(todoId)[0] : null;
    if (existing) {
      if (toNonEmptyString(todo?.status)) existing.status = toNonEmptyString(todo.status);
      if (toNonEmptyString(todo?.text)) existing.title = toNonEmptyString(todo.text);
      existing.updatedAt = new Date().toISOString();
      return { ...existing, decisions: deepClone(existing.decisions), metadata: deepClone(existing.metadata) };
    }

    const status = toNonEmptyString(todo?.status) || toNonEmptyString(options?.status) || "pending";
    const title = toNonEmptyString(options?.title) || toNonEmptyString(todo?.text) || "Todo";
    const parentId = toNonEmptyString(options?.parentId);
    const gapId = toNonEmptyString(todo?.relatedGapId) || undefined;

    return this._upsertNode({
      nodeId: toNonEmptyString(options?.nodeId),
      kind: "todo",
      todoId: todoId || undefined,
      gapId,
      parentId,
      title,
      status,
      metadata: todo && typeof todo === "object" ? deepClone(todo) : {},
    });
  }

  /**
   * @param {string} gapId
   * @returns {PlanningNode[]}
   */
  getNodesForGap(gapId) {
    const wanted = toNonEmptyString(gapId);
    if (!wanted) return [];
    const out = [];
    for (const node of this.nodes.values()) {
      if (toNonEmptyString(node.gapId) === wanted) out.push({ ...node, decisions: deepClone(node.decisions), metadata: deepClone(node.metadata) });
    }
    return out;
  }

  /**
   * @param {string} todoId
   * @returns {PlanningNode[]}
   */
  getNodesForTodo(todoId) {
    const wanted = toNonEmptyString(todoId);
    if (!wanted) return [];
    const out = [];
    for (const node of this.nodes.values()) {
      if (toNonEmptyString(node.todoId) === wanted) out.push({ ...node, decisions: deepClone(node.decisions), metadata: deepClone(node.metadata) });
    }
    return out;
  }

  /**
   * @param {string} nodeId
   * @param {string} status
   * @returns {boolean}
   */
  updateStatus(nodeId, status) {
    const id = toNonEmptyString(nodeId);
    if (!id || !this.nodes.has(id)) return false;
    const nextStatus = toNonEmptyString(status) || "unknown";
    const node = this.nodes.get(id);
    node.status = nextStatus;
    node.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * @param {string} nodeId
   * @param {{ stage?: string, action?: string, reason?: string, outcome?: string, metrics?: Record<string, any> }} decision
   * @returns {boolean}
   */
  recordDecision(nodeId, decision = {}) {
    const id = toNonEmptyString(nodeId);
    if (!id || !this.nodes.has(id)) return false;
    const node = this.nodes.get(id);
    const entry = {
      stage: toNonEmptyString(decision.stage) || "unknown",
      action: toNonEmptyString(decision.action) || "unspecified",
      reason: toNonEmptyString(decision.reason) || "unspecified",
      outcome: toNonEmptyString(decision.outcome) || "unknown",
      metrics: decision.metrics && typeof decision.metrics === "object" ? deepClone(decision.metrics) : {},
      ts: new Date().toISOString(),
    };
    node.decisions.push(entry);
    node.updatedAt = entry.ts;
    return true;
  }

  /**
   * @param {Partial<PlanningNode>} input
   * @returns {PlanningNode}
   */
  _upsertNode(input) {
    const nodeId = toNonEmptyString(input?.nodeId) || makeSecureTimestampedId("plan", { allowInsecureFallback: true });
    const now = new Date().toISOString();
    /** @type {PlanningNode} */
    const node = {
      nodeId,
      kind: input?.kind === "gap" || input?.kind === "todo" ? input.kind : "generic",
      gapId: toNonEmptyString(input?.gapId) || undefined,
      todoId: toNonEmptyString(input?.todoId) || undefined,
      parentId: toNonEmptyString(input?.parentId) || undefined,
      title: toNonEmptyString(input?.title) || "Node",
      status: toNonEmptyString(input?.status) || "pending",
      createdAt: now,
      updatedAt: now,
      decisions: [],
      metadata: input?.metadata && typeof input.metadata === "object" ? deepClone(input.metadata) : {},
    };
    this.nodes.set(nodeId, node);
    return { ...node, decisions: deepClone(node.decisions), metadata: deepClone(node.metadata) };
  }

  /**
   * @returns {PlanningTreeJson}
   */
  serialize() {
    return {
      rootGoal: this.rootGoal,
      runId: this.runId,
      nodes: Array.from(this.nodes.values()).map((node) => ({
        ...node,
        decisions: deepClone(node.decisions),
        metadata: deepClone(node.metadata),
      })),
    };
  }

  /**
   * @returns {PlanningTreeJson}
   */
  toJSON() {
    return this.serialize();
  }

  /**
   * @param {any} json
   * @returns {PlanningTree}
   */
  static fromJSON(json) {
    if (!json || typeof json !== "object") return new PlanningTree();
    const tree = new PlanningTree({ rootGoal: json.rootGoal || "", runId: json.runId || "" });
    const rows = Array.isArray(json.nodes) ? json.nodes : [];
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const nodeId = toNonEmptyString(raw.nodeId);
      if (!nodeId) continue;
      tree.nodes.set(nodeId, {
        nodeId,
        kind: raw.kind === "gap" || raw.kind === "todo" ? raw.kind : "generic",
        gapId: toNonEmptyString(raw.gapId) || undefined,
        todoId: toNonEmptyString(raw.todoId) || undefined,
        parentId: toNonEmptyString(raw.parentId) || undefined,
        title: toNonEmptyString(raw.title) || "Node",
        status: toNonEmptyString(raw.status) || "pending",
        createdAt: toNonEmptyString(raw.createdAt) || new Date().toISOString(),
        updatedAt: toNonEmptyString(raw.updatedAt) || new Date().toISOString(),
        decisions: Array.isArray(raw.decisions) ? deepClone(raw.decisions) : [],
        metadata: raw.metadata && typeof raw.metadata === "object" ? deepClone(raw.metadata) : {},
      });
    }
    return tree;
  }
}
