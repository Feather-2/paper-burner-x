/**
 * 检查点管理器 - 持久化 DeepSearch/Design 状态
 */

const STORAGE_KEY_PREFIX = 'ppt_checkpoint_';
const MAX_CHECKPOINTS = 5; // 每个项目最多保留5个检查点

export class CheckpointManager {
  constructor(projectId) {
    this.projectId = projectId || 'default';
    this.storageKey = `${STORAGE_KEY_PREFIX}${this.projectId}`;
  }

  // 保存检查点
  save(stage, state, metadata = {}) {
    try {
      const checkpoints = this._load() || [];
      const checkpoint = {
        id: `cp_${Date.now()}`,
        stage,
        timestamp: new Date().toISOString(),
        metadata: {
          iteration: state?.iteration,
          claimCount: state?.L1?.claims?.length || 0,
          ...metadata,
        },
        state: typeof state?.toJSON === 'function' ? state.toJSON() : state,
      };

      checkpoints.push(checkpoint);

      // 只保留最近的 MAX_CHECKPOINTS 个
      while (checkpoints.length > MAX_CHECKPOINTS) {
        checkpoints.shift();
      }

      localStorage.setItem(this.storageKey, JSON.stringify(checkpoints));
      console.log(`[Checkpoint] Saved: ${stage}`, { id: checkpoint.id });
      return checkpoint;
    } catch (e) {
      console.warn('[Checkpoint] Save failed:', e);
      return null;
    }
  }

  // 获取最新检查点
  getLatest() {
    const checkpoints = this._load();
    return checkpoints?.length ? checkpoints[checkpoints.length - 1] : null;
  }

  // 获取指定阶段的最新检查点
  getLatestByStage(stage) {
    const checkpoints = this._load() || [];
    for (let i = checkpoints.length - 1; i >= 0; i--) {
      if (checkpoints[i].stage === stage) return checkpoints[i];
    }
    return null;
  }

  // 获取所有检查点
  getAll() {
    return this._load() || [];
  }

  // 清除检查点
  clear() {
    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      // ignore
    }
  }

  // 检查是否有可恢复的检查点
  hasRecoverable() {
    const latest = this.getLatest();
    return !!latest;
  }

  // 获取恢复信息摘要
  getRecoverySummary() {
    const latest = this.getLatest();
    if (!latest) return null;
    return {
      stage: latest.stage,
      timestamp: latest.timestamp,
      metadata: latest.metadata,
      canRecover: true,
    };
  }

  _load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
}

// 阶段名称映射
export const STAGE_NAMES = {
  'deepsearch.scan': 'DeepSearch: 扫描',
  'deepsearch.plan': 'DeepSearch: 规划',
  'deepsearch.retrieve': 'DeepSearch: 检索',
  'deepsearch.understand': 'DeepSearch: 理解',
  'deepsearch.write': 'DeepSearch: 写作',
  'deepsearch.complete': 'DeepSearch: 完成',
  'design.system': 'Design: 设计系统',
  'design.brainstorm': 'Design: 创意',
  'design.script': 'Design: 脚本确认',
  'design.layout': 'Design: 页面规划',
  'design.batch': 'Design: 生成',
  'design.visual': 'Design: 渲染',
  'design.refine': 'Design: 优化',
};

export function getStageName(stage) {
  return STAGE_NAMES[stage] || stage;
}

