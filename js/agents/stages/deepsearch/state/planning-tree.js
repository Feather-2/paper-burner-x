/**
 * @typedef {object} PlanningTreeOptions
 * @property {string=} rootGoal
 * @property {string=} runId
 */

/**
 * @typedef {object} PlanningTreeJson
 * @property {string=} rootGoal
 * @property {string=} runId
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
    /** @type {Map<string, any>} */
    this.nodes = new Map();
  }

  /**
   * @returns {void}
   */
  expandFromGap() {}

  /**
   * @returns {void}
   */
  expandFromTodo() {}

  /**
   * @returns {PlanningTreeJson}
   */
  serialize() {
    return { rootGoal: this.rootGoal, runId: this.runId };
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
    return new PlanningTree({ rootGoal: json.rootGoal || "", runId: json.runId || "" });
  }
}
