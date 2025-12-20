import { WatchdogEvents } from "./events.js";
import { CicadaCompressor } from "../shared/cicada-compressor.js";
import { toNonEmptyString } from "../shared/value-utils.js";

export const DelegationMode = Object.freeze({
  WATCHDOG: "watchdog",
  SUBAGENT: "subagent",
});

export const DelegationReason = Object.freeze({
  GRAY_ZONE_DECISION: "gray_zone_decision",
  CONTEXT_DEPENDENT: "context_dependent",
  PARALLEL_INDEPENDENT: "parallel_independent",
  EXTERNAL_TOOL: "external_tool",
  SIMPLE_TASK: "simple_task",
  COMPLEX_DEFAULT: "complex_default",
});

function normalizeConfidence(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

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

  decideDelegationMode(task = {}, context = {}) {
    const confidence = normalizeConfidence(task.confidenceScore ?? task.confidence);
    let decision = null;

    if (confidence !== null && confidence >= 0.3 && confidence <= 0.5) {
      decision = { mode: DelegationMode.WATCHDOG, reason: DelegationReason.GRAY_ZONE_DECISION };
    } else if (task.requiresHistory || task.requiresPriorResults || context.requiresHistory || context.requiresPriorResults) {
      decision = { mode: DelegationMode.WATCHDOG, reason: DelegationReason.CONTEXT_DEPENDENT };
    } else if (task.parallelizable && task.independent) {
      decision = {
        mode: DelegationMode.SUBAGENT,
        reason: DelegationReason.PARALLEL_INDEPENDENT,
        parallel: true,
      };
    } else {
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
}

export default Watchdog;
