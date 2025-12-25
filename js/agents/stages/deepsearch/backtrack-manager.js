/**
 * BacktrackManager - 春秋蝉回溯管理
 *
 * 职责：
 * - 管理回溯次数限制
 * - 从 checkpoint 恢复状态
 * - 发射回溯相关事件
 */

import { migrateCheckpoint } from "../../shared/checkpoint-schema.js";
import { DeepSearchState } from "./state.js";

export class BacktrackManager {
  constructor(options = {}) {
    this.archive = options.archive || null;
    this.maxBacktracks = options.maxBacktracks ?? 3;
    this._backtrackCount = 0;
    this._emit = options.emit || (() => {});
    this._logger = options.logger || console;
  }

  get backtrackCount() {
    return this._backtrackCount;
  }

  get remaining() {
    return Math.max(0, this.maxBacktracks - this._backtrackCount);
  }

  canBacktrack() {
    return this.archive && this._backtrackCount < this.maxBacktracks;
  }

  /**
   * 执行回溯
   * @returns {{ success: boolean, reason: string, state?: DeepSearchState }}
   */
  async backtrack(state, checkpointId, { failReason, correctionHint, sharedContext } = {}) {
    if (!this.archive) {
      return { success: false, reason: "no_archive" };
    }

    const buildTodoContext = (snapshot) => {
      const todos = Array.isArray(snapshot?.todos) ? snapshot.todos : [];
      let open = 0;
      let completed = 0;
      let cancelled = 0;
      const openTodoIds = [];
      for (const t of todos) {
        const status = String(t?.status || "open");
        if (status === "completed") completed += 1;
        else if (status === "cancelled") cancelled += 1;
        else {
          open += 1;
          if (openTodoIds.length < 10) openTodoIds.push(String(t?.todoId || "todo_unknown"));
        }
      }
      return {
        todoCount: todos.length,
        openTodoCount: open,
        completedTodoCount: completed,
        cancelledTodoCount: cancelled,
        openTodoIds,
      };
    };

    if (this._backtrackCount >= this.maxBacktracks) {
      this._logger.warn("春秋蝉: Backtrack limit reached", {
        stage: "backtrack-manager",
        data: { backtrackCount: this._backtrackCount, maxBacktracks: this.maxBacktracks },
      });
      this._emit("deepsearch.agent.backtrack_limit", {
        runId: state.runId,
        backtrackCount: this._backtrackCount,
        maxBacktracks: this.maxBacktracks,
        todoContext: buildTodoContext(state),
      });
      return { success: false, reason: "limit_reached" };
    }

    // 获取 checkpoint ID
    const targetId = checkpointId || this._getFallbackCheckpointId(state);
    if (!targetId) {
      return { success: false, reason: "no_checkpoint" };
    }

    try {
      const restored = migrateCheckpoint(await this.archive.restore(targetId));
      if (!restored?.nodeStates) {
        return { success: false, reason: "invalid_checkpoint" };
      }

      const restoredState = DeepSearchState.fromJSON(restored.nodeStates);
      this._backtrackCount++;

      this._logger.info("春秋蝉: State restored from checkpoint", {
        stage: "backtrack-manager",
        data: {
          checkpointId: targetId,
          backtrackCount: this._backtrackCount,
          remaining: this.remaining,
        },
      });

      this._emit("deepsearch.agent.backtracked", {
        runId: state.runId,
        checkpointId: targetId,
        backtrackCount: this._backtrackCount,
        failReason: failReason || null,
        correctionHint: correctionHint || null,
        todoContext: buildTodoContext(restoredState),
      });

      // 注入语义信号到 SharedContext
      if (sharedContext && typeof sharedContext.signal === "function") {
        sharedContext.signal("backtrack_hint", {
          type: "backtrack_hint",
          stage: "backtrack-manager",
          failReason: failReason || "unknown",
          correctionHint: correctionHint || null,
          checkpointId: targetId,
          backtrackCount: this._backtrackCount,
        });
      }

      return { success: true, reason: "restored", state: restoredState };
    } catch (err) {
      this._logger.warn("春秋蝉: Backtrack failed", {
        stage: "backtrack-manager",
        data: { error: err?.message },
      });
      return { success: false, reason: "restore_failed", error: err?.message };
    }
  }

  _getFallbackCheckpointId(state) {
    const checkpoints = Array.isArray(state?.checkpoints) ? state.checkpoints : [];
    return checkpoints.length >= 2 ? checkpoints[checkpoints.length - 2]?.checkpointId : null;
  }

  reset() {
    this._backtrackCount = 0;
  }
}

export function createBacktrackManager(options) {
  return new BacktrackManager(options);
}
