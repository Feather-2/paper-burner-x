export class PlanningTree {
  constructor({ rootGoal = '', runId = '' } = {}) {
    this.rootId = 'plan_root';
    this.nodes = new Map();
    this.activeNodeId = this.rootId;
    
    // Create root node
    this.nodes.set(this.rootId, {
      nodeId: this.rootId,
      parentId: null,
      type: 'goal',
      content: rootGoal,
      status: 'active',
      children: [],
      metadata: { createdAt: new Date().toISOString(), iteration: 0 }
    });
  }

  addNode(parentId, type, content, metadata = {}) {
    const nodeId = `plan_${this.nodes.size}`;
    const node = {
      nodeId,
      parentId,
      type,
      content,
      status: 'pending',
      children: [],
      metadata: { createdAt: new Date().toISOString(), ...metadata }
    };
    this.nodes.set(nodeId, node);
    const parent = this.nodes.get(parentId);
    if (parent) parent.children.push(nodeId);
    return nodeId;
  }

  updateStatus(nodeId, status) {
    const node = this.nodes.get(nodeId);
    if (node) node.status = status;
  }

  getActiveNodes() {
    return [...this.nodes.values()].filter(n => n.status === 'active');
  }

  getNodePath(nodeId) {
    const path = [];
    let current = this.nodes.get(nodeId);
    while (current) {
      path.unshift(current);
      current = current.parentId ? this.nodes.get(current.parentId) : null;
    }
    return path;
  }

  expandFromGap(gap) {
    const parentId = this.rootId;
    const subgoalId = this.addNode(parentId, 'subgoal', gap.question, { sourceGapId: gap.gapId });
    const queryIds = (gap.queryHints || []).map(hint => 
      this.addNode(subgoalId, 'query', hint, { sourceGapId: gap.gapId })
    );
    return [subgoalId, ...queryIds];
  }

  getNodesForGap(gapId) {
    return [...this.nodes.values()].filter(n => n.metadata?.sourceGapId === gapId);
  }

  serialize() {
    return {
      rootId: this.rootId,
      nodes: Object.fromEntries(this.nodes),
      activeNodeId: this.activeNodeId
    };
  }

  static fromJSON(json) {
    const tree = new PlanningTree();
    tree.rootId = json.rootId;
    tree.nodes = new Map(Object.entries(json.nodes || {}));
    tree.activeNodeId = json.activeNodeId;
    return tree;
  }
}
