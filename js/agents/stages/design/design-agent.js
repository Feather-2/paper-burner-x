import { DesignAgentLoop } from "./agent-loop.js";

export class DesignStage extends DesignAgentLoop {
  constructor(options = {}) {
    super(options);
  }
}

// Convenience adapter to register with AgentOrchestrator.registerStage(name, fn).
export async function runDesignStage(runContext, contentPackage, stageApi = {}) {
  const stage = new DesignStage();
  return stage.execute(runContext, contentPackage, stageApi);
}
