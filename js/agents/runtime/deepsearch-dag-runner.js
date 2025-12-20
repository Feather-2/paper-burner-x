import { BlockRegistry } from "./block-registry.js";
import { BlockDAGExecutor } from "./block-dag-executor.js";
import { registerDeepSearchBlocks, DEEPSEARCH_DAG } from "../stages/deepsearch/blocks.js";
import { EventBus } from "./event-bus.js";
import { RouterAgent, ModelTier } from "./router-agent.js";

export async function runDeepSearchWithDAG(sources, taskGoal, options = {}) {
  const registry = new BlockRegistry();
  registerDeepSearchBlocks(registry);

  const eventBus = options.eventBus || new EventBus();
  const executor = new BlockDAGExecutor(registry, {
    eventBus,
    checkpointEnabled: options.checkpoint ?? true,
  });

  const input = { sources, taskGoal, userConfig: options.userConfig || {} };
  const runContext = { runId: options.runId || `dag_${Date.now()}` };
  const blockApi = { ...(options.blockApi || {}) };
  if (options.modelRouter && !blockApi.modelRouter) blockApi.modelRouter = options.modelRouter;

  let dag = DEEPSEARCH_DAG;
  if (options.modelRouter) {
    const router = new RouterAgent({
      modelRouter: options.modelRouter,
      blockRegistry: registry,
      modelTier: ModelTier.STRONG,
      eventBus,
      dagExecutor: executor,
    });
    const pipeline = await router.assemblePipeline(
      { taskGoal },
      { sources, totalChars: options.totalChars, estimatedTokens: options.estimatedTokens }
    );
    if (pipeline?.mode === "assembled_dag" && Array.isArray(pipeline.stages) && pipeline.stages.length > 0) {
      const assembled = router.assembleDAG(pipeline.stages);
      if (Array.isArray(assembled?.nodes) && assembled.nodes.length > 0) {
        dag = { nodes: assembled.nodes };
      }
    }
  }

  return executor.execute(dag, runContext, input, blockApi);
}
