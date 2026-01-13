/**
 * Grader registry and exports.
 *
 * @module eval/graders
 */

import { regexGrader, stateCheckGrader, toolCallsGrader, transcriptGrader } from "./deterministic.js";
import { rubricGrader, assertionGrader, pairwiseGrader } from "./llm-judge.js";
import { allPassGrader, weightedGrader, thresholdGrader } from "./composite.js";
import { contentGrader } from "./content.js";

/**
 * @typedef {import('../types.js').Grader} Grader
 */

export class GraderRegistry {
  /**
   * @param {Grader[]} [graders=[]]
   */
  constructor(graders = []) {
    /** @type {Map<string, Grader>} */
    this._graders = new Map();
    this.registerAll(graders);
  }

  /**
   * @param {Grader} grader
   * @returns {GraderRegistry}
   */
  register(grader) {
    if (!grader || typeof grader.type !== "string" || typeof grader.grade !== "function") {
      throw new Error("GraderRegistry.register(grader): invalid grader");
    }
    this._graders.set(grader.type, grader);
    return this;
  }

  /**
   * @param {Grader[]} graders
   * @returns {GraderRegistry}
   */
  registerAll(graders) {
    if (!Array.isArray(graders)) return this;
    for (const g of graders) this.register(g);
    return this;
  }

  /**
   * @param {string} type
   * @returns {Grader | undefined}
   */
  get(type) {
    return this._graders.get(type);
  }

  /**
   * @param {string} type
   * @returns {boolean}
   */
  has(type) {
    return this._graders.has(type);
  }

  /**
   * @returns {string[]}
   */
  listTypes() {
    return [...this._graders.keys()];
  }
}

export function createDefaultGraderRegistry() {
  return new GraderRegistry([
    // Deterministic
    regexGrader,
    stateCheckGrader,
    toolCallsGrader,
    transcriptGrader,

    // Content quality (back-compat wrapper)
    contentGrader,

    // LLM-as-judge
    rubricGrader,
    assertionGrader,
    pairwiseGrader,

    // Composite
    allPassGrader,
    weightedGrader,
    thresholdGrader,
  ]);
}

export const defaultGraderRegistry = createDefaultGraderRegistry();

export {
  // deterministic
  regexGrader,
  stateCheckGrader,
  toolCallsGrader,
  transcriptGrader,
  // content
  contentGrader,
  // llm judge
  rubricGrader,
  assertionGrader,
  pairwiseGrader,
  // composite
  allPassGrader,
  weightedGrader,
  thresholdGrader,
};

