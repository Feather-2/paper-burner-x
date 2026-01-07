import { DesignAgentLoop } from "./agent-loop.js";

/**
 * Design stage wrapper
 */
export class DesignStage extends DesignAgentLoop {
  /**
   * @param {object} [options]
   */
  constructor(options = {}) {
    super(options);
  }
}

/**
 * Convenience adapter to register with AgentOrchestrator.registerStage(name, fn).
 * @param {any} runContext
 * @param {any} contentPackage
 * @param {object} [stageApi]
 * @returns {Promise<any>}
 */
export async function runDesignStage(runContext, contentPackage, stageApi = {}) {
  const stage = new DesignStage();
  return stage.execute(runContext, contentPackage, stageApi);
}
