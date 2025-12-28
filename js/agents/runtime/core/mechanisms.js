/**
 * Agent Loop 共享机制加载器
 *
 * 提供 Checkpoint、BacktrackManager、SharedContext 等可插拔机制
 * 供 DeepSearch、Design、CodeSearch 等 Agent Loop 复用
 */

// 懒加载的机制类
let CheckpointManager = null;
let SharedContext = null;
let BacktrackManager = null;
let DiscoveryManager = null;

let _loaded = false;

/**
 * 加载所有可选机制
 */
export async function loadMechanisms() {
  if (_loaded) return;
  _loaded = true;

  try {
    const checkpoint = await import("../../stages/deepsearch/runtime/checkpoint.js");
    CheckpointManager = checkpoint.CheckpointManager || checkpoint.default;
  } catch { }

  try {
    const shared = await import("../../stages/deepsearch/runtime/shared-context.js");
    SharedContext = shared.SharedContext || shared.default;
  } catch { }

  try {
    const backtrack = await import("../../sdk/BacktrackManager.js");
    BacktrackManager = backtrack.BacktrackManager || backtrack.default;
  } catch { }

  try {
    const discovery = await import("../../sdk/DiscoveryManager.js");
    DiscoveryManager = discovery.DiscoveryManager || discovery.default;
  } catch { }
}

/**
 * 初始化 Agent Loop 的可插拔机制
 * @param {Object} loop - Agent Loop 实例
 * @param {Object} options - 配置
 * @param {Object} options.stageApi - Stage API
 * @param {Function} options.emit - 事件发射函数
 * @param {Object} options.logger - Logger
 * @param {string} options.runId - 运行 ID
 */
export function initMechanisms(loop, options = {}) {
  const { stageApi, emit, logger, runId } = options;

  // SharedContext
  if (SharedContext && !loop.sharedContext) {
    loop.sharedContext = new SharedContext();
  }

  // BacktrackManager
  if (BacktrackManager && !loop.backtrackManager) {
    loop.backtrackManager = new BacktrackManager({
      archive: stageApi?.archive,
      maxBacktracks: loop.maxBacktracks ?? 3,
      emit,
      logger,
    });
  }

  // DiscoveryManager
  if (DiscoveryManager && !loop.discoveryManager) {
    loop.discoveryManager = new DiscoveryManager({
      sharedContext: loop.sharedContext,
      runId,
      logger,
    });
  }

  // CheckpointManager
  if (CheckpointManager && !loop.checkpoint) {
    loop.checkpoint = new CheckpointManager({
      archive: stageApi?.archive,
      emit,
    });
  }
}

/**
 * 获取机制类（用于类型检查或手动实例化）
 */
export function getMechanismClasses() {
  return {
    CheckpointManager,
    SharedContext,
    BacktrackManager,
    DiscoveryManager,
  };
}

export { CheckpointManager, SharedContext, BacktrackManager, DiscoveryManager };
