import { WatchdogEvents } from "../events/events.js";
import { CicadaCompressor } from "./cicada-compressor.js";
import { toNonEmptyString } from "../../shared/utils/value-utils.js";

export const DelegationMode = Object.freeze({
  WATCHDOG: "watchdog",
  SUBAGENT: "subagent",
  HANDOFF: "handoff",  // 清除重来，换脑子
});

export const DelegationReason = Object.freeze({
  GRAY_ZONE_DECISION: "gray_zone_decision",
  CONTEXT_DEPENDENT: "context_dependent",
  PARALLEL_INDEPENDENT: "parallel_independent",
  EXTERNAL_TOOL: "external_tool",
  SIMPLE_TASK: "simple_task",
  COMPLEX_DEFAULT: "complex_default",
  STUCK_OR_WRONG: "stuck_or_wrong",  // 卡住或怀疑自己错了
  CONTEXT_FULL: "context_full",      // context 满了
});

export class Watchdog {
  constructor({ eventBus, cicadaCompressor, archive } = {}) {
    this.eventBus = eventBus || null;
    this.archive = archive || null;
    this.cicadaCompressor = cicadaCompressor || new CicadaCompressor({
      eventBus: this.eventBus,
      archive: this.archive,
    });
    this._observers = new Map();
  }

  _emit(name, payload) {
    if (this.eventBus && typeof this.eventBus.emit === "function") {
      this.eventBus.emit(name, { actor: "watchdog", status: "info", payload });
    }
    const handlers = this._observers.get(name);
    if (handlers) {
      for (const handler of handlers) {
        handler(payload);
      }
    }
  }

  observe(eventName, handler) {
    if (typeof handler !== "function") {
      throw new TypeError("Watchdog.observe(eventName, handler): handler must be a function");
    }
    const name = toNonEmptyString(eventName);
    if (!name) {
      throw new Error("Watchdog.observe(eventName, handler): eventName must be a non-empty string");
    }

    let set = this._observers.get(name);
    if (!set) {
      set = new Set();
      this._observers.set(name, set);
    }
    set.add(handler);

    return () => {
      set.delete(handler);
      if (set.size === 0) this._observers.delete(name);
    };
  }

  /**
   * 决定委托模式（基于任务特征，不使用硬编码阈值）
   * 注意：AI 应主动调用 watchdog skill，而不是依赖此方法的自动判断
   */
  decideDelegationMode(task = {}, context = {}) {
    let decision = null;

    // AI 明确请求 handoff
    if (task.requestHandoff || context.requestHandoff) {
      decision = { mode: DelegationMode.HANDOFF, reason: DelegationReason.STUCK_OR_WRONG };
    }
    // 需要历史上下文 → watchdog 深度思考
    else if (task.requiresHistory || task.requiresPriorResults || context.requiresHistory || context.requiresPriorResults) {
      decision = { mode: DelegationMode.WATCHDOG, reason: DelegationReason.CONTEXT_DEPENDENT };
    }
    // 可并行且独立 → subagent
    else if (task.parallelizable && task.independent) {
      decision = {
        mode: DelegationMode.SUBAGENT,
        reason: DelegationReason.PARALLEL_INDEPENDENT,
        parallel: true,
      };
    }
    // 外部工具 → subagent
    else {
      const toolType = String(task.toolType || "").toLowerCase();
      if (toolType === "mcp" || toolType === "external") {
        decision = { mode: DelegationMode.SUBAGENT, reason: DelegationReason.EXTERNAL_TOOL };
      } else if (task.complexity === "simple" && task.inputSchema) {
        decision = { mode: DelegationMode.SUBAGENT, reason: DelegationReason.SIMPLE_TASK };
      } else {
        decision = { mode: DelegationMode.WATCHDOG, reason: DelegationReason.COMPLEX_DEFAULT };
      }
    }

    this._emit(WatchdogEvents.WATCHDOG_DECISION, { decision, task, context });
    return decision;
  }

  async watchdogDelegate(task, agentLoop, options = {}) {
    if (!agentLoop || typeof agentLoop.fork !== "function") {
      throw new TypeError("Watchdog.watchdogDelegate(task, agentLoop): agentLoop.fork is required");
    }

    const forkOptions = {
      mode: "delegate",
      shareContext: true,
      trackProcessMemory: true,
      ...(options.forkOptions || {}),
    };

    const forked = agentLoop.fork(forkOptions);
    this._emit(WatchdogEvents.WATCHDOG_DELEGATED, { task, forkOptions });

    if (!forked || typeof forked.execute !== "function" || typeof forked.getProcessMemory !== "function") {
      throw new TypeError("Watchdog.watchdogDelegate(task, agentLoop): forked loop must provide execute() and getProcessMemory()");
    }

    const result = await forked.execute(task, options.executeOptions);
    const processMemory = await forked.getProcessMemory();

    const stageKey = toNonEmptyString(task?.stageKey) || "watchdog";
    const sharedContext = agentLoop?.sharedContext || null;

    const compression = await this.cicadaCompressor.compress(stageKey, processMemory, {
      sharedContext,
      contentType: options.contentType,
    });

    const summary = compression?.summary ?? null;
    const archiveId = compression?.archiveId ?? null;
    const summaryText = typeof summary === "string" ? summary : JSON.stringify(summary);

    const contextDelta = {
      type: "watchdog_summary",
      stage: stageKey,
      summary: summaryText,
      archiveRef: archiveId,
    };

    if (typeof agentLoop.addToContext === "function") {
      agentLoop.addToContext(contextDelta);
    }

    this._emit(WatchdogEvents.WATCHDOG_COMPRESSED, {
      stageKey,
      summary,
      archiveId,
      contextDelta,
    });

    return { result, summary, archiveId, contextDelta };
  }

  intervene(decision, options = {}) {
    const action = typeof decision === "string" ? decision : (decision?.action || decision?.type || "unknown");
    const payload = { action, decision, options };
    this._emit(WatchdogEvents.WATCHDOG_INTERVENTION, payload);
    return payload;
  }

  /**
   * 构建 Handoff 交接文档
   * @param {Object} state - agent 状态
   * @param {Object} sharedContext - 共享上下文
   * @returns {Object} handoff 文档
   */
  buildHandoff(state, sharedContext) {
    const todos = Array.isArray(state?.todos) ? state.todos : [];
    const pending = todos.filter(t => t.status !== "done" && t.status !== "completed");
    const completed = todos.filter(t => t.status === "done" || t.status === "completed");

    return {
      runId: state?.runId,
      timestamp: new Date().toISOString(),

      // 已完成
      accomplished: {
        summary: sharedContext?.buildSummaryText?.() || "",
        completedTodos: completed.map(t => t.content || t.title),
        claimCount: state?.L1?.claims?.length || 0,
      },

      // 待办
      pending: {
        todos: pending.map(t => ({ content: t.content || t.title, priority: t.priority })),
        taskGoal: state?.taskGoal || "",
      },

      // 关键决策（最近5条）
      decisions: sharedContext?.getDecisions?.()?.slice(-5) || [],

      // 继续指南
      resumeGuide: {
        nextAction: pending[0]?.content || pending[0]?.title || null,
        context: sharedContext?.getAllSummaries?.() || {},
        warnings: state?.L2?.warnings || [],
        iteration: state?.iteration || 0,
      },
    };
  }

  /**
   * 执行 Handoff - 生成交接文档并归档
   * @param {Object} state - agent 状态
   * @param {Object} sharedContext - 共享上下文
   * @param {Object} options - { archive, reason }
   * @returns {Object} { handoff, archiveId }
   */
  async handoff(state, sharedContext, options = {}) {
    const handoff = this.buildHandoff(state, sharedContext);
    const reason = options.reason || DelegationReason.STUCK_OR_WRONG;

    let archiveId = null;
    if (this.archive && typeof this.archive.save === "function") {
      const runId = toNonEmptyString(state?.runId) || `handoff_${Date.now()}`;
      archiveId = await this.archive.save(runId, {
        nodeStates: { handoff, fullState: state },
        metadata: { type: "handoff", reason },
      });
    }

    this._emit(WatchdogEvents.WATCHDOG_HANDOFF || "watchdog.handoff", {
      handoff,
      archiveId,
      reason,
    });

    return { handoff, archiveId };
  }
}

export default Watchdog;
