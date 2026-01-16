
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { AlertMonitor } from "../../js/agents/sdk/AlertMonitor.js";

/**
 * 创建 mock agent
 * @param {object} [overrides]
 */
function createMockAgent(overrides = {}) {
    const handlers = new Map();
    return {
        on: (event, handler) => {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event).push(handler);
        },
        emit: (event, payload) => {
            const list = handlers.get(event) || [];
            for (const h of list) h({ payload });
        },
        eventBus: {
            emit: vi.fn(),
        },
        loop: { iteration: 0 },
        _loop: { messages: [] },
        discovery: null,
        ...overrides,
    };
}

/**
 * 创建 mock logger
 */
function createMockLogger() {
    return {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    };
}

describe("AlertMonitor", () => {
    describe("constructor", () => {
        it("should initialize with default options", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            expect(monitor.auditorModel).toBe("haiku");
            expect(monitor.policy).toBe("advisor");
            expect(monitor._pendingAlerts.length).toBe(0);
            expect(monitor._isFlowActive).toBe(false);
        });

        it("should accept custom options", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({
                logger,
                model: "gpt-4o",
                policy: "governor",
            });

            expect(monitor.auditorModel).toBe("gpt-4o");
            expect(monitor.policy).toBe("governor");
        });
    });

    describe("enterQuiet / exitQuiet", () => {
        it("should toggle flow active state", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            expect(monitor._isFlowActive).toBe(false);

            monitor.enterQuiet();
            expect(monitor._isFlowActive).toBe(true);
            expect(logger.info.mock.calls.length).toBe(1);

            monitor.exitQuiet();
            expect(monitor._isFlowActive).toBe(false);
            expect(logger.info.mock.calls.length).toBe(2);
        });
    });

    describe("_triggerAlert", () => {
        let monitor;
        let logger;

        beforeEach(() => {
            logger = createMockLogger();
            monitor = new AlertMonitor({ logger });
        });

        it("should add alert to pending list", () => {
            monitor._triggerAlert({
                type: "suggestion",
                message: "test message",
                severity: "low",
            });

            expect(monitor._pendingAlerts.length).toBe(1);
            expect(monitor._pendingAlerts[0].message).toBe("test message");
        });

        it("should prevent duplicate alerts", () => {
            const alert = { type: "suggestion", message: "same message", severity: "low" };
            monitor._triggerAlert(alert);
            monitor._triggerAlert(alert);

            expect(monitor._pendingAlerts.length).toBe(1);
        });

        it("should discard low confidence alerts in flow mode", () => {
            monitor.enterQuiet();
            monitor._triggerAlert({
                type: "suggestion",
                message: "low confidence",
                confidence: 0.5,
            });

            expect(monitor._pendingAlerts.length).toBe(0);
        });

        it("should keep high confidence alerts in flow mode", () => {
            monitor.enterQuiet();
            monitor._triggerAlert({
                type: "suggestion",
                message: "high confidence",
                confidence: 0.8,
            });

            expect(monitor._pendingAlerts.length).toBe(1);
        });

        it("should trigger force backtrack for critical alerts in governor mode", () => {
            const agent = createMockAgent();
            const governorMonitor = new AlertMonitor({
                agent,
                logger,
                policy: "governor",
            });

            governorMonitor._triggerAlert({
                type: "observation",
                message: "critical issue",
                severity: "critical",
            });

            expect(agent.eventBus.emit.mock.calls.length).toBe(1);
            const [eventName, payload] = agent.eventBus.emit.mock.calls[0];
            expect(eventName).toBe("alertmonitor.force_backtrack");
            expect(payload.reason).toBe("critical issue");
        });
    });

    describe("drainAlerts", () => {
        it("should return and clear pending alerts", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            monitor._triggerAlert({ type: "suggestion", message: "alert1", severity: "low" });
            monitor._triggerAlert({ type: "notification", message: "alert2", severity: "medium" });

            const drained = monitor.drainAlerts();

            expect(drained.length).toBe(2);
            expect(monitor._pendingAlerts.length).toBe(0);
        });
    });

    describe("_checkPlanningDrift", () => {
        it("should detect repeated tool calls", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            monitor._checkPlanningDrift("search", {});
            monitor._checkPlanningDrift("search", {});
            monitor._checkPlanningDrift("search", {});

            expect(monitor._pendingAlerts.length).toBe(1);
            expect(monitor._pendingAlerts[0].message.includes("重复调用")).toBeTruthy();
        });

        it("should not trigger for varied tool calls", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            monitor._checkPlanningDrift("search", {});
            monitor._checkPlanningDrift("read", {});
            monitor._checkPlanningDrift("write", {});

            expect(monitor._pendingAlerts.length).toBe(0);
        });
    });

    describe("_onDiscoveryUpdated", () => {
        it("should trigger alert for contradicted discoveries", async () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            await monitor._onDiscoveryUpdated({
                gapId: "gap-123",
                status: "contradicted",
            });

            expect(monitor._pendingAlerts.length).toBe(1);
            expect(monitor._pendingAlerts[0].message.includes("gap-123")).toBeTruthy();
            expect(monitor._pendingAlerts[0].severity).toBe("high");
        });

        it("should not trigger for suppressed IDs", async () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });
            monitor._suppressedIds.add("gap-123");

            await monitor._onDiscoveryUpdated({
                gapId: "gap-123",
                status: "contradicted",
            });

            expect(monitor._pendingAlerts.length).toBe(0);
        });
    });

    describe("_learnFromFeedback", () => {
        it("should add ID to suppressed set when agent rejects alert", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            const messages = [
                { role: "assistant", content: '项 为 "gap-abc" 误报，已处理' },
            ];

            monitor._learnFromFeedback(messages);

            expect(monitor._suppressedIds.has("gap-abc")).toBeTruthy();
        });

        it("should handle empty messages", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            monitor._learnFromFeedback([]);

            expect(monitor._suppressedIds.size).toBe(0);
        });
    });

    describe("_filterAlerts", () => {
        let monitor;
        let logger;

        beforeEach(() => {
            logger = createMockLogger();
            monitor = new AlertMonitor({ logger });
        });

        it("should filter out suppressed IDs", () => {
            monitor._suppressedIds.add("gap-1");

            const alerts = [
                { type: "observation", message: 'Issue with "gap-1"', id: "gap-1" },
                { type: "observation", message: 'Issue with "gap-2"', id: "gap-2" },
            ];

            const filtered = monitor._filterAlerts(alerts, []);

            expect(filtered.length).toBe(1);
            expect(filtered[0].id).toBe("gap-2");
        });

        it("should filter status/guidance when agent discusses reports", () => {
            const alerts = [
                { type: "status", message: "Status update" },
                { type: "guidance", message: "Guidance note" },
                { type: "suggestion", message: "Suggestion" },
            ];

            const messages = [
                { role: "assistant", content: "以下是报告总结" },
            ];

            const filtered = monitor._filterAlerts(alerts, messages);

            expect(filtered.length).toBe(1);
            expect(filtered[0].type).toBe("suggestion");
        });

        it("should filter low confidence alerts in long conversations", () => {
            const alerts = [
                { type: "suggestion", message: "Low conf", confidence: 0.6 },
                { type: "suggestion", message: "High conf", confidence: 0.9 },
            ];

            const messages = new Array(25).fill({ role: "user", content: "msg" });

            const filtered = monitor._filterAlerts(alerts, messages);

            expect(filtered.length).toBe(1);
            expect(filtered[0].message).toBe("High conf");
        });

        it("should return empty array for empty input", () => {
            const filtered = monitor._filterAlerts([], []);
            expect(filtered.length).toBe(0);
        });
    });

    describe("getInjectedPrompt", () => {
        let monitor;
        let logger;

        beforeEach(() => {
            logger = createMockLogger();
            monitor = new AlertMonitor({ logger });
        });

        it("should return null when no alerts", () => {
            const prompt = monitor.getInjectedPrompt([]);
            expect(prompt).toBe(null);
        });

        it("should format alerts as markdown", () => {
            monitor._triggerAlert({ type: "suggestion", message: "Alert 1", severity: "low" });
            monitor._triggerAlert({ type: "notification", message: "Alert 2", severity: "medium" });

            const prompt = monitor.getInjectedPrompt([]);

            expect(prompt.includes("### 提醒")).toBeTruthy();
            expect(prompt.includes("- Alert 1")).toBeTruthy();
            expect(prompt.includes("- Alert 2")).toBeTruthy();
        });

        it("should only return high/critical in flow mode", () => {
            monitor.enterQuiet();
            monitor._pendingAlerts = [
                { type: "suggestion", message: "Low", severity: "low" },
                { type: "observation", message: "High", severity: "high" },
            ];

            const prompt = monitor.getInjectedPrompt([]);

            expect(prompt.includes("High")).toBeTruthy();
            expect(!prompt.includes("Low")).toBeTruthy();

            // low severity should remain in pending
            expect(monitor._pendingAlerts.length).toBe(1);
            expect(monitor._pendingAlerts[0].message).toBe("Low");
        });

        it("should drain alerts after injection (non-flow mode)", () => {
            monitor._triggerAlert({ type: "suggestion", message: "Alert", severity: "low" });

            monitor.getInjectedPrompt([]);

            expect(monitor._pendingAlerts.length).toBe(0);
        });
    });

    describe("_auditGlobalState", () => {
        it("should trigger notification for pending conflicts", () => {
            const logger = createMockLogger();
            const agent = createMockAgent({
                discovery: {
                    getAllDiscoveries: () => [
                        { id: "1", status: "contradicted" },
                        { id: "2", status: "satisfied" },
                    ],
                },
                loop: { iteration: 1 },
            });

            const monitor = new AlertMonitor({ agent, logger });
            monitor._auditGlobalState();

            expect(monitor._pendingAlerts.some(a => a.message.includes("冲突证据"))).toBeTruthy();
        });

        it("should not duplicate conflict notification if alerts pending", () => {
            const logger = createMockLogger();
            const agent = createMockAgent({
                discovery: {
                    getAllDiscoveries: () => [
                        { id: "1", status: "contradicted" },
                    ],
                },
                loop: { iteration: 1 },
            });

            const monitor = new AlertMonitor({ agent, logger });
            monitor._pendingAlerts = [{ message: "existing" }];

            monitor._auditGlobalState();

            // 不应新增冲突通知
            expect(monitor._pendingAlerts.length).toBe(1);
        });
    });

    describe("_auditResearchHealth", () => {
        it("should suggest Recall after many iterations", () => {
            const logger = createMockLogger();
            const agent = createMockAgent({
                loop: { iteration: 10 },
            });

            const monitor = new AlertMonitor({ agent, logger });
            monitor._auditResearchHealth([]);

            expect(monitor._pendingAlerts.some(a => a.message.includes("Recall"))).toBeTruthy();
        });

        it("should suggest Task for many gaps when not in flow mode", () => {
            const logger = createMockLogger();
            const agent = createMockAgent({
                loop: { iteration: 1 },
            });

            const monitor = new AlertMonitor({ agent, logger });
            const manyGaps = new Array(10).fill({ status: "pending" });

            monitor._auditResearchHealth(manyGaps);

            expect(monitor._pendingAlerts.some(a => a.message.includes("Task"))).toBeTruthy();
        });

        it("should not suggest Task in flow mode", () => {
            const logger = createMockLogger();
            const agent = createMockAgent({
                loop: { iteration: 1 },
            });

            const monitor = new AlertMonitor({ agent, logger });
            monitor.enterQuiet();
            const manyGaps = new Array(10).fill({ status: "pending" });

            monitor._auditResearchHealth(manyGaps);

            expect(!monitor._pendingAlerts.some(a => a.message.includes("Task"))).toBeTruthy();
        });

        it("should suggest focus when progress is low", () => {
            const logger = createMockLogger();
            const agent = createMockAgent({
                loop: { iteration: 1 },
            });

            const monitor = new AlertMonitor({ agent, logger });
            const gaps = [
                ...new Array(6).fill({ status: "pending" }),
                { status: "satisfied" },
            ];

            monitor._auditResearchHealth(gaps);

            expect(monitor._pendingAlerts.some(a => a.message.includes("聚焦核心路径"))).toBeTruthy();
        });
    });

    describe("event listeners", () => {
        it("should set up listeners when agent provided", async () => {
            const logger = createMockLogger();
            const agent = createMockAgent();

            new AlertMonitor({ agent, logger });

            // 触发 tool.completed 事件
            agent.emit("*.tool.completed", { tool: "search", params: {}, result: {} });

            // 第一次调用不会触发告警（需要3次重复）
            // 只是验证监听器已注册
        });

        it("should respond to discovery update events", async () => {
            const logger = createMockLogger();
            const agent = createMockAgent();

            const monitor = new AlertMonitor({ agent, logger });

            agent.emit("deepsearch.gap.evaluated", {
                gapId: "test-gap",
                status: "contradicted",
            });

            // 等待异步处理
            await new Promise(r => setTimeout(r, 10));

            expect(monitor._pendingAlerts.some(a => a.message.includes("test-gap"))).toBeTruthy();
        });
    });

    describe("_forceBacktrack", () => {
        it("should emit backtrack event on agent eventBus", () => {
            const logger = createMockLogger();
            const agent = createMockAgent();
            const monitor = new AlertMonitor({ agent, logger });

            monitor._forceBacktrack("test reason");

            expect(agent.eventBus.emit.mock.calls.length).toBe(1);
            const [eventName, payload] = agent.eventBus.emit.mock.calls[0];
            expect(eventName).toBe("alertmonitor.force_backtrack");
            expect(payload.reason).toBe("test reason");
        });

        it("should handle missing agent gracefully", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            // 不应抛错
            monitor._forceBacktrack("test reason");
        });
    });
});
