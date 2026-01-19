/**
 * BacktrackManager - 春秋蝉回溯管理
 *
 * 职责：
 * - 管理回溯次数限制
 * - 从 checkpoint 恢复状态
 * - 发射回溯相关事件
 */

import { migrateCheckpoint } from "../../../shared/archive/checkpoint-schema.js";
import { DeepSearchState } from "../state.js";

/**
 * Archive interface for checkpoint storage.
 * @typedef {object} BacktrackArchive
 * @property {(checkpointId: string) => Promise<object>} restore - Restore a checkpoint by ID
 * @property {(runId: string, checkpoint: object) => Promise<string>} save - Save a checkpoint
 *
 * Logger interface (console-compatible).
 * @typedef {object} BacktrackLogger
 * @property {(message: string, context?: object) => void} info - Log info message
 * @property {(message: string, context?: object) => void} warn - Log warning message
 * @property {(message: string, context?: object) => void} error - Log error message
 *
 * SideEffects manager interface for rollback support.
 * @typedef {object} BacktrackSideEffects
 * @property {(cursor: string|null, options?: {reason?: string}) => Promise<{ok: boolean, reason?: string, error?: string}>} rollbackToCursor - Rollback side effects to a cursor
 *
 * SharedContext interface for cross-stage communication.
 * @typedef {object} BacktrackSharedContext
 * @property {(key: string, value: object) => void} signal - Emit a signal to shared context
 *
 * @typedef {object} BacktrackManagerOptions
 * @property {BacktrackArchive=} archive - Archive for checkpoint storage
 * @property {number=} maxBacktracks - Maximum allowed backtrack attempts (default: 3)
 * @property {((eventName: string, payload: object) => void)=} emit - Event emitter callback
 * @property {BacktrackLogger=} logger - Logger instance (defaults to console)
 * @property {BacktrackSideEffects=} sideEffects - Side effects manager for rollback
 *
 * @typedef {object} BacktrackArgs
 * @property {string=} failReason - Reason for the backtrack (e.g., "parse_error")
 * @property {string=} correctionHint - Hint for corrective action after restore
 * @property {BacktrackSharedContext=} sharedContext - Shared context for signal injection
 *
 * @typedef {object} BacktrackResult
 * @property {boolean} success - Whether backtrack succeeded
 * @property {string} reason - Result reason code (e.g., "restored", "limit_reached", "no_archive")
 * @property {DeepSearchState=} state - Restored state on success
 * @property {string=} error - Error message on failure
 * @property {BacktrackResultDetails=} details - Additional details for diagnostics
 *
 * @typedef {object} BacktrackResultDetails
 * @property {string=} checkpointId - The checkpoint ID involved in the operation
 * @property {string=} stage - The stage where error occurred
 * @property {string=} schemaVersion - The schema version of the checkpoint
 * @property {string[]=} keys - Top-level keys when checkpoint is invalid
 */

export class BacktrackManager {
  /**
   * @param {BacktrackManagerOptions=} options
   */
  constructor(options = {}) {
    this.archive = options.archive || null;
    this.maxBacktracks = options.maxBacktracks ?? 3;
    this._backtrackCount = 0;
    this._emit = options.emit || (() => {});
    this._logger = options.logger || console;
    this.sideEffects = options.sideEffects || null;
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
   * 执行回溯 - 从指定 checkpoint 恢复状态
   * @param {DeepSearchState} state - Current DeepSearch state to backtrack from
   * @param {string|null} checkpointId - Target checkpoint ID (null uses fallback strategy)
   * @param {BacktrackArgs=} options - Additional backtrack options
   * @returns {Promise<BacktrackResult>} Result indicating success/failure with restored state or error details
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
      let restoredRaw = null;
      try {
        restoredRaw = await this.archive.restore(targetId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error && typeof err.stack === "string" ? err.stack : null;
        this._logger.warn("春秋蝉: archive.restore failed", {
          stage: "backtrack-manager",
          data: { checkpointId: targetId, error: msg, ...(stack ? { stack } : {}) },
        });
        return {
          success: false,
          reason: "restore_failed",
          error: msg,
          details: { checkpointId: targetId, stage: "archive.restore" },
        };
      }

      let restored = null;
      try {
        restored = migrateCheckpoint(restoredRaw);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error && typeof err.stack === "string" ? err.stack : null;
        this._logger.warn("春秋蝉: migrateCheckpoint failed", {
          stage: "backtrack-manager",
          data: { checkpointId: targetId, error: msg, ...(stack ? { stack } : {}) },
        });
        return {
          success: false,
          reason: "invalid_checkpoint",
          error: msg,
          details: { checkpointId: targetId, stage: "migrateCheckpoint" },
        };
      }

      if (!restored?.nodeStates) {
        return {
          success: false,
          reason: "invalid_checkpoint",
          error: "missing_nodeStates",
          details: {
            checkpointId: targetId,
            schemaVersion: restored?.schemaVersion,
            keys: restored && typeof restored === "object" ? Object.keys(restored).slice(0, 20) : [],
          },
        };
      }

      const restoredState = DeepSearchState.fromJSON(restored.nodeStates);
      this._backtrackCount++;

      // Best-effort: roll back reversible "physical" side effects to the cursor captured in checkpoint metadata.
      let sideEffectsRollback = null;
      const cursor = restored?.metadata?.sideEffectsCursor;
      if (this.sideEffects && typeof this.sideEffects.rollbackToCursor === "function") {
        try {
          sideEffectsRollback = await this.sideEffects.rollbackToCursor(cursor, {
            reason: `backtrack:${targetId}`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          sideEffectsRollback = { ok: false, reason: "rollback_failed", error: msg };
          this._logger.warn("春秋蝉: SideEffects rollback failed (ignored)", {
            stage: "backtrack-manager",
            data: { checkpointId: targetId, cursor, error: msg },
          });
        }
      }

      this._logger.info("春秋蝉: State restored from checkpoint", {
        stage: "backtrack-manager",
        data: {
          checkpointId: targetId,
          backtrackCount: this._backtrackCount,
          remaining: this.remaining,
          ...(sideEffectsRollback ? { sideEffectsRollback } : {}),
        },
      });

      this._emit("deepsearch.agent.backtracked", {
        runId: state.runId,
        checkpointId: targetId,
        backtrackCount: this._backtrackCount,
        failReason: failReason || null,
        correctionHint: correctionHint || null,
        todoContext: buildTodoContext(restoredState),
        ...(sideEffectsRollback ? { sideEffectsRollback } : {}),
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
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error && typeof err.stack === "string" ? err.stack : null;
      this._logger.warn("春秋蝉: Backtrack failed", {
        stage: "backtrack-manager",
        data: { error: msg, ...(stack ? { stack } : {}) },
      });
      return { success: false, reason: "restore_failed", error: msg };
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

/**
 * @param {BacktrackManagerOptions} options
 * @returns {BacktrackManager}
 */
export function createBacktrackManager(options) {
  return new BacktrackManager(options);
}
