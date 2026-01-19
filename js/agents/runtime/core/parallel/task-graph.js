import { toNonEmptyString } from "../../../shared/utils/value-utils.js";

/**
 * @typedef {object} TaskNode
 * @property {string[]} dependencies
 */

export class TaskGraph {
  constructor() {
    /** @type {Map<string, TaskNode>} */
    this._tasks = new Map();
  }

  /**
   * Clear all tasks from the graph.
   * @returns {void}
   */
  clear() {
    this._tasks.clear();
  }

  /**
   * Dispose the graph (alias for clear).
   * @returns {void}
   */
  dispose() {
    this.clear();
  }

  /**
   * @param {string} taskId
   * @param {string[] | null | undefined} [dependencies]
   * @returns {this}
   */
  addTask(taskId, dependencies = []) {
    const id = toNonEmptyString(taskId);
    if (!id) throw new TypeError("TaskGraph.addTask(taskId): taskId must be a non-empty string");

    const deps = Array.isArray(dependencies)
      ? [...new Set(dependencies.map((d) => toNonEmptyString(d)).filter(Boolean))]
      : [];

    this._tasks.set(id, { dependencies: deps });
    return this;
  }

  /**
   * @param {string} taskId
   * @returns {TaskNode | null}
   */
  getTask(taskId) {
    const id = toNonEmptyString(taskId);
    if (!id) return null;
    return this._tasks.get(id) || null;
  }

  /**
   * Layered topological sort (Kahn).
   *
   * @param {{ allowMissingDependencies?: boolean } | undefined} [options]
   * @returns {string[][]} Levels of taskIds that can run in parallel.
   */
  getLevels(options = {}) {
    const allowMissing = options?.allowMissingDependencies === true;

    /** @type {Map<string, number>} */
    const inDegree = new Map();
    /** @type {Map<string, Set<string>>} */
    const dependents = new Map();

    // Initialize
    for (const [id, task] of this._tasks) {
      // Filter out missing deps when allowMissingDependencies is true
      const effectiveDeps = allowMissing
        ? task.dependencies.filter((depId) => this._tasks.has(depId))
        : task.dependencies;
      inDegree.set(id, effectiveDeps.length);
      if (!dependents.has(id)) dependents.set(id, new Set());
      for (const depId of effectiveDeps) {
        if (!this._tasks.has(depId)) {
          throw new Error(`TaskGraph: missing dependency "${depId}" required by "${id}"`);
        }
        if (!dependents.has(depId)) dependents.set(depId, new Set());
        dependents.get(depId).add(id);
      }
    }

    /** @type {string[]} */
    let queue = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    /** @type {string[][]} */
    const levels = [];
    let visitedCount = 0;

    while (queue.length) {
      const current = queue.slice();
      queue = [];
      levels.push(current);

      for (const id of current) {
        visitedCount++;
        const nextSet = dependents.get(id);
        if (!nextSet) continue;
        for (const depId of nextSet) {
          if (!inDegree.has(depId)) continue;
          const next = (inDegree.get(depId) || 0) - 1;
          inDegree.set(depId, next);
          if (next === 0) queue.push(depId);
        }
      }
    }

    if (visitedCount !== this._tasks.size) {
      const remaining = [];
      for (const [id, deg] of inDegree) {
        if (deg > 0) remaining.push(id);
      }
      throw new Error(`TaskGraph: cycle detected among tasks: ${remaining.join(", ")}`);
    }

    return levels;
  }
}

export default TaskGraph;
