import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:events", async () => {
    const actual = await vi.importActual("node:events");
    return actual;
});

import { EventEmitter } from "node:events";
import { AlertMonitor } from "../../../../js/agents/sdk/AlertMonitor.js";

const createLogger = () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
});

const createAgent = (overrides = {}) => {
    const agent = new EventEmitter();
    agent.eventBus = new EventEmitter();
    agent.loop = { iteration: 0 };
    agent._loop = { messages: [] };
    agent.discovery = { getAllDiscoveries: vi.fn(() => []) };
    return Object.assign(agent, overrides);
};

const createDeepNested = (depth) => {
    const root = { level: 0 };
    let current = root;
    for (let i = 1; i <= depth; i += 1) {
        current.child = { level: i };
        current = current.child;
    }
    return root;
};

describe("AlertMonitor", () => {
    let logger;

    beforeEach(() => {
        logger = createLogger();
    });

    it("initializes defaults and handles null/undefined agent", () => {
        const monitorWithNull = new AlertMonitor({ agent: null, logger });
        expect(monitorWithNull.agent).toBeNull();
        expect(monitorWithNull.auditorModel).toBe("haiku");
        expect(monitorWithNull.policy).toBe("advisor");
        expect(monitorWithNull._pendingAlerts).toEqual([]);
        expect(monitorWithNull._isFlowActive).toBe(false);

        const monitorWithUndefined = new AlertMonitor({ logger });
        expect(monitorWithUndefined.agent).toBeUndefined();
    });

    it("registers listeners and dispatches events", async () => {
        const agent = createAgent();
        const onSpy = vi.spyOn(agent, "on");
        const monitor = new AlertMonitor({ agent, logger });

        expect(onSpy).toHaveBeenCalledTimes(3);
        expect(onSpy).toHaveBeenCalledWith("*:toolCompleted", expect.any(Function));
        expect(onSpy).toHaveBeenCalledWith("deepsearch.gap.evaluated", expect.any(Function));
        expect(onSpy).toHaveBeenCalledWith("agent:iteration", expect.any(Function));

        const actionSpy = vi.spyOn(monitor, "_onActionCompleted").mockResolvedValue();
        const discoverySpy = vi.spyOn(monitor, "_onDiscoveryUpdated").mockResolvedValue();
        const learnSpy = vi.spyOn(monitor, "_learnFromFeedback");
        const auditSpy = vi.spyOn(monitor, "_auditGlobalState");

        const toolPayload = { tool: "alpha", params: { a: 1 }, result: null };
        agent.emit("*:toolCompleted", { payload: toolPayload });
        await Promise.resolve();
        expect(actionSpy).toHaveBeenCalledWith(toolPayload);

        const discovery = { status: "pending", id: "d-1" };
        agent.emit("deepsearch.gap.evaluated", { payload: discovery });
        await Promise.resolve();
        expect(discoverySpy).toHaveBeenCalledWith(discovery);

        agent._loop.messages = [{ role: "assistant", content: "ok" }];
        agent.emit("agent:iteration", {});
        expect(learnSpy).toHaveBeenCalledWith(agent._loop.messages);
        expect(auditSpy).toHaveBeenCalledTimes(1);
    });

    it("enterQuiet and exitQuiet toggle flow state and log", () => {
        const monitor = new AlertMonitor({ logger });
        monitor.enterQuiet();
        expect(monitor._isFlowActive).toBe(true);
        expect(logger.info).toHaveBeenCalledWith("[AlertMonitor] Entering quiet mode.");

        monitor.exitQuiet();
        expect(monitor._isFlowActive).toBe(false);
        expect(logger.info).toHaveBeenCalledWith("[AlertMonitor] Exiting quiet mode.");
    });

    it("calls _checkPlanningDrift from _onActionCompleted", async () => {
        const monitor = new AlertMonitor({ logger });
        const driftSpy = vi.spyOn(monitor, "_checkPlanningDrift");

        await monitor._onActionCompleted({ tool: "T", params: { foo: "bar" }, result: {} });

        expect(driftSpy).toHaveBeenCalledWith("T", { foo: "bar" });
    });

    it("detects repeated tools with empty name and rapid consecutive calls", () => {
        const monitor = new AlertMonitor({ logger });
        const triggerSpy = vi.spyOn(monitor, "_triggerAlert");

        monitor._checkPlanningDrift("");
        monitor._checkPlanningDrift("");
        monitor._checkPlanningDrift("");

        expect(triggerSpy).toHaveBeenCalledTimes(1);
        expect(triggerSpy.mock.calls[0][0].message).toContain('""');
    });

    it("does not alert when tools vary, including negative and whitespace names", () => {
        const monitor = new AlertMonitor({ logger });
        const triggerSpy = vi.spyOn(monitor, "_triggerAlert");

        monitor._checkPlanningDrift(-1);
        monitor._checkPlanningDrift("   ");
        monitor._checkPlanningDrift(-1);

        expect(triggerSpy).not.toHaveBeenCalled();
    });

    it("handles concurrent tool completions with numeric tool names", async () => {
        const monitor = new AlertMonitor({ logger });
        await Promise.all([
            monitor._onActionCompleted({ tool: 0, params: null, result: null }),
            monitor._onActionCompleted({ tool: 0, params: undefined, result: null }),
            monitor._onActionCompleted({ tool: 0, params: {}, result: null })
        ]);

        expect(monitor._pendingAlerts).toHaveLength(1);
        expect(monitor._pendingAlerts[0].message).toContain('"0"');
    });

    it("triggers observation for contradicted discovery and respects suppression", async () => {
        const monitor = new AlertMonitor({ logger });
        const triggerSpy = vi.spyOn(monitor, "_triggerAlert");

        await monitor._onDiscoveryUpdated({ status: "contradicted", gapId: "gap-123" });
        expect(triggerSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: "observation",
            severity: "high",
            confidence: 0.9,
            id: "gap-123"
        }));

        triggerSpy.mockClear();
        monitor._suppressedIds.add("gap-123");
        await monitor._onDiscoveryUpdated({ status: "contradicted", id: "gap-123" });
        expect(triggerSpy).not.toHaveBeenCalled();
    });

    it("ignores non-contradicted or empty discovery and handles deep nested payload", async () => {
        const monitor = new AlertMonitor({ logger });
        const triggerSpy = vi.spyOn(monitor, "_triggerAlert");

        await monitor._onDiscoveryUpdated({});
        expect(triggerSpy).not.toHaveBeenCalled();

        const discovery = {
            status: "contradicted",
            id: "deep-id",
            meta: createDeepNested(40)
        };
        await monitor._onDiscoveryUpdated(discovery);

        expect(triggerSpy).toHaveBeenCalledTimes(1);
        expect(triggerSpy.mock.calls[0][0].message).toContain("deep-id");
    });

    it("throws when discovery update is null", async () => {
        const monitor = new AlertMonitor({ logger });
        await expect(monitor._onDiscoveryUpdated(null)).rejects.toThrow(TypeError);
    });

    it("auditGlobalState triggers notification for pending conflicts and skips when alerts exist", () => {
        const agent = createAgent();
        agent.discovery.getAllDiscoveries.mockReturnValue([
            { id: "a", status: "contradicted" },
            { id: "b", status: "satisfied" }
        ]);

        const monitor = new AlertMonitor({ logger, agent });
        monitor._auditGlobalState();

        expect(monitor._pendingAlerts).toHaveLength(1);
        expect(monitor._pendingAlerts[0].type).toBe("notification");

        monitor._pendingAlerts.push({ type: "suggestion", message: "already", severity: "low" });
        monitor._auditGlobalState();

        const notifications = monitor._pendingAlerts.filter(alert => alert.type === "notification");
        expect(notifications).toHaveLength(1);
    });

    it("auditResearchHealth emits guidance for slow progress with string iteration count", () => {
        const agent = createAgent({ loop: { iteration: "10" } });
        const monitor = new AlertMonitor({ logger, agent });
        const discoveries = [
            { status: "satisfied" },
            ...Array.from({ length: 8 }, () => ({ status: "pending" }))
        ];

        monitor._auditResearchHealth(discoveries);

        const toolAdviceCount = monitor._pendingAlerts.filter(alert => alert.type === "tool_advice").length;
        expect(toolAdviceCount).toBe(2);
        expect(monitor._pendingAlerts.find(alert => alert.type === "guidance")).toBeTruthy();
    });

    it.each([0, -1, Number.MAX_SAFE_INTEGER])(
        "auditResearchHealth handles iteration %s without alerts when no gaps",
        (iteration) => {
            const agent = createAgent({ loop: { iteration } });
            const monitor = new AlertMonitor({ logger, agent });

            monitor._auditResearchHealth([]);

            expect(monitor._pendingAlerts).toHaveLength(0);
        }
    );

    it("triggerAlert de-duplicates, suppresses low confidence in flow, and handles large messages", () => {
        const monitor = new AlertMonitor({ logger });
        const hugeMessage = "x".repeat(10000);

        monitor._triggerAlert({ type: "suggestion", message: hugeMessage, severity: "low", confidence: 0.9 });
        monitor._triggerAlert({ type: "suggestion", message: hugeMessage, severity: "low", confidence: 0.9 });

        expect(monitor._pendingAlerts).toHaveLength(1);

        monitor._isFlowActive = true;
        monitor._triggerAlert({ type: "notification", message: "low conf", severity: "low", confidence: 0.5 });

        expect(monitor._pendingAlerts).toHaveLength(1);
    });

    it("forces backtrack on critical governor alerts and tolerates missing agent", () => {
        const agent = createAgent();
        const emitSpy = vi.spyOn(agent.eventBus, "emit");
        const monitor = new AlertMonitor({ logger, agent, policy: "governor" });

        monitor._triggerAlert({ type: "notification", message: "boom", severity: "critical" });

        expect(emitSpy).toHaveBeenCalledWith("alertmonitor.force_backtrack", { reason: "boom" });

        const noAgentMonitor = new AlertMonitor({ logger });
        expect(() => noAgentMonitor._forceBacktrack("reason")).not.toThrow();
    });

    it("drainAlerts returns and clears pending alerts", () => {
        const monitor = new AlertMonitor({ logger });
        monitor._pendingAlerts.push(
            { type: "status", message: "A" },
            { type: "status", message: "B" }
        );

        const drained = monitor.drainAlerts();

        expect(drained).toHaveLength(2);
        expect(monitor._pendingAlerts).toEqual([]);
    });

    it("learns suppression ids from agent feedback and ignores empty messages", () => {
        const monitor = new AlertMonitor({ logger });

        monitor._learnFromFeedback([]);
        expect(monitor._suppressedIds.size).toBe(0);

        const messages = [
            { role: "assistant", content: '忽略告警，项 "gap-42" 误报' }
        ];
        monitor._learnFromFeedback(messages);

        expect(monitor._suppressedIds.has("gap-42")).toBe(true);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("gap-42"));
    });

    it("filters alerts based on suppression rules and agent context", () => {
        const monitor = new AlertMonitor({ logger });
        monitor._suppressedIds.add("id-1");

        const alerts = [
            { type: "notification", message: "alert for id-1", id: "id-1" },
            { type: "notification", message: '项 "id-2" 已记录', id: "id-2" },
            { type: "status", message: "状态更新" }
        ];
        const currentMessages = [
            { role: "assistant", content: "关于 id-2 的报告已完成" }
        ];

        const result = monitor._filterAlerts(alerts, currentMessages);

        expect(result).toEqual([]);
    });

    it("suppresses low-confidence alerts for long conversations and handles array-like objects", () => {
        const monitor = new AlertMonitor({ logger });
        const alerts = [
            { type: "notification", message: "low", confidence: 0.5 },
            { type: "notification", message: "keep", confidence: 0.9 }
        ];
        const arrayLikeMessages = {
            length: 21,
            filter: () => []
        };

        const result = monitor._filterAlerts(alerts, arrayLikeMessages);

        expect(result).toHaveLength(1);
        expect(result[0].message).toBe("keep");
    });

    it("getInjectedPrompt returns null with no alerts and filters by flow state", () => {
        const monitor = new AlertMonitor({ logger });

        expect(monitor.getInjectedPrompt(undefined)).toBeNull();

        monitor.enterQuiet();
        monitor._triggerAlert({ type: "status", message: "low", severity: "low" });
        monitor._triggerAlert({ type: "status", message: "high", severity: "high" });
        monitor._triggerAlert({ type: "status", message: "critical", severity: "critical" });

        const prompt = monitor.getInjectedPrompt([]);
        expect(prompt).toContain("high");
        expect(prompt).toContain("critical");
        expect(prompt).not.toContain("low");

        expect(monitor._pendingAlerts).toHaveLength(1);
        expect(monitor._pendingAlerts[0].message).toBe("low");
    });

    it("getInjectedPrompt suppresses alerts based on agent context and clears pending in normal mode", () => {
        const monitor = new AlertMonitor({ logger });
        monitor._triggerAlert({ type: "notification", message: '项 "id-9" 需要处理', id: "id-9" });

        const prompt = monitor.getInjectedPrompt([
            { role: "assistant", content: "正在处理 id-9" }
        ]);

        expect(prompt).toBeNull();
        expect(monitor._pendingAlerts).toHaveLength(0);
    });
});
