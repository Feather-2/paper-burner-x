export class PlanningTree {
  constructor(options = {}) {
    this.rootGoal = options.rootGoal || "";
    this.runId = options.runId || "";
    this.nodes = new Map();
  }

  expandFromGap() {}

  expandFromTodo() {}

  serialize() {
    return { rootGoal: this.rootGoal, runId: this.runId };
  }

  toJSON() {
    return this.serialize();
  }

  static fromJSON(json) {
    if (!json || typeof json !== "object") return new PlanningTree();
    return new PlanningTree({ rootGoal: json.rootGoal || "", runId: json.runId || "" });
  }
}
