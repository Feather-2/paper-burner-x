import { toNonEmptyString } from "../../../shared/index.js";

/**
 * @typedef {object} TaskNode
 * @property {string[]} dependencies
 */

/**
 * @param {Map<string, TaskNode>} tasks
 * @param {boolean} allowMissing
 * @returns {{ inDegree: Map<string, number>, dependents: Map<string, Set<string>> }}
 */
const buildDependencyIndex = (tasks, allowMissing) => {
  /** @type {Map<string, number>} */
  const inDegree = new Map();
  /** @type {Map<string, Set<string>>} */
  const dependents = new Map();

  for (const [id, task] of tasks) {
    // Filter out missing deps when allowMissingDependencies is true
    const effectiveDeps = allowMissing ? task.dependencies.filter((depId) => tasks.has(depId)) : task.dependencies;
    inDegree.set(id, effectiveDeps.length);
    if (!dependents.has(id)) dependents.set(id, new Set());
    for (const depId of effectiveDeps) {
      if (!tasks.has(depId)) {
        throw new Error(`TaskGraph: missing dependency "${depId}" required by "${id}"`);
      }
      if (!dependents.has(depId)) dependents.set(depId, new Set());
      dependents.get(depId).add(id);
    }
  }

  return { inDegree, dependents };
};

/**
 * @param {Map<string, number>} inDegree
 * @param {Map<string, Set<string>>} dependents
 * @returns {{ levels: string[][], visitedCount: number }}
 */
const buildLevels = (inDegree, dependents) => {
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
    visitedCount += current.length;

    for (const id of current) {
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

  return { levels, visitedCount };
};

/**
 * @param {Map<string, number>} inDegree
 * @returns {string[]}
 */
const collectRemaining = (inDegree) => {
  /** @type {string[]} */
  const remaining = [];
  for (const [id, deg] of inDegree) {
    if (deg > 0) remaining.push(id);
  }
  return remaining;
};

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
   * Add a task and its dependencies to the graph.
   * @param {string} taskId - Non-empty task identifier.
   * @param {string[] | null | undefined} [dependencies] - Optional dependency task ids.
   * @returns {this} Graph instance for chaining.
   * @throws {TypeError} If taskId is empty or invalid.
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
   * Lookup a task by id.
   * @param {string} taskId - Task identifier to fetch.
   * @returns {TaskNode | null} Task data or null when missing/invalid.
   */
  getTask(taskId) {
    const id = toNonEmptyString(taskId);
    if (!id) return null;
    return this._tasks.get(id) || null;
  }

  /**
   * Layered topological sort (Kahn).
   *
   * @param {{ allowMissingDependencies?: boolean } | undefined} [options] - Optional traversal options.
   * @returns {string[][]} Levels of taskIds that can run in parallel.
   * @throws {Error} If a dependency is missing or a cycle is detected.
   */
  getLevels(options = {}) {
    const allowMissing = options?.allowMissingDependencies === true;
    const { inDegree, dependents } = buildDependencyIndex(this._tasks, allowMissing);
    const { levels, visitedCount } = buildLevels(inDegree, dependents);

    if (visitedCount !== this._tasks.size) {
      const remaining = collectRemaining(inDegree);
      throw new Error(`TaskGraph: cycle detected among tasks: ${remaining.join(", ")}`);
    }

    return levels;
  }
}

export default TaskGraph;
