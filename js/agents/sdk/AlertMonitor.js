/**
 * AlertMonitor - 异步规则告警监控器
 *
 * 职责:
 * 1. 异步监视 Agent 行为 (通过事件订阅)
 * 2. 基于规则触发告警 (0 token 本地逻辑)
 * 3. 在极端情况下触发紧急回退
 */

/**
 * @typedef {Record<string, any> & { role?: string, content?: any }} ChatMessage
 *
 * @typedef {{ warn?: (...args: any[]) => void, info?: (...args: any[]) => void, error?: (...args: any[]) => void, debug?: (...args: any[]) => void }} LoggerLike
 *
 * @typedef {object} DiscoveryManagerLike
 * @property {() => Array<Record<string, any>>} getAllDiscoveries
 *
 * @typedef {object} AgentLike
 * @property {(eventName: string, handler: (event: any) => void | Promise<void>) => void} on
 * @property {{ emit: (eventName: string, payload: any) => void }} eventBus
 * @property {{ iteration?: number } | null | undefined} [loop]
 * @property {{ messages?: ChatMessage[] } | null | undefined} [_loop]
 * @property {DiscoveryManagerLike | null | undefined} [discovery]
 *
 * @typedef {object} AlertMonitorOptions
 * @property {AgentLike | null} [agent] - 相关联的 Agent 实例
 * @property {LoggerLike} [logger]
 * @property {string} [model] - 仅在启发式不足时的备用审计模型
 * @property {string} [policy] - 告警升级策略（例如 "advisor"/"governor"）
 *
 * @typedef {"suggestion" | "notification" | "guidance" | "tool_advice" | "observation" | "status"} AlertType
 * @typedef {"low" | "medium" | "high" | "critical"} AlertSeverity
 *
 * @typedef {object} AlertRecord
 * @property {AlertType} type
 * @property {string} message
 * @property {AlertSeverity} [severity]
 * @property {number} [confidence]
 * @property {string} [id]
 *
 * @typedef {object} ToolCompletedPayload
 * @property {string} [tool]
 * @property {any} [params]
 * @property {any} [result]
 *
 * @typedef {Record<string, any> & { id?: string, gapId?: string, status?: string }} DiscoveryUpdate
 */

export class AlertMonitor {
    /**
     * @param {AlertMonitorOptions} [options]
     */
    constructor(options = {}) {
        /** @type {AgentLike | null | undefined} */
        this.agent = options.agent; // 相关联的 AgentInstance
        /** @type {LoggerLike} */
        this.logger = options.logger;
        /** @type {string} */
        this.auditorModel = options.model || "haiku"; // 仅在启发式不足时备用
        /** @type {string} */
        this.policy = options.policy || "advisor";

        // 基于规则的告警系统，0 token 消耗的本地逻辑

        /** @type {AlertRecord[]} */
        this._pendingAlerts = [];
        /** @type {boolean} */
        this._isAuditing = false;
        /** @type {boolean} */
        this._isFlowActive = false; // [心流状态] 标志
        /** @type {Set<string>} */
        this._suppressedIds = new Set(); // 被 Agent 显式忽略或反驳的 ID
        /** @type {Set<string>} */
        this._suppressedTypes = new Set(); // 被抑制的告警类型

        this._setupListeners();
    }

    /**
     * 进入静默模式 (减少低优先级告警)
     * @returns {void}
     */
    enterQuiet() {
        this.logger.info("[AlertMonitor] Entering quiet mode.");
        this._isFlowActive = true;
    }

    /**
     * 退出静默模式
     * @returns {void}
     */
    exitQuiet() {
        this.logger.info("[AlertMonitor] Exiting quiet mode.");
        this._isFlowActive = false;
    }

    /** @returns {void} */
    _setupListeners() {
        if (!this.agent) return;

        // 订阅工具调用完成事件 (关注结果一致性)
        this.agent.on("*:toolCompleted", async (event) => {
            const payload = event.payload || event;
            await this._onActionCompleted(payload);
        });

        // 订阅黑板更新事件 (潜意识最关注的地方)
        this.agent.on("deepsearch:gapEvaluated", async (event) => {
            const payload = event.payload || event;
            await this._onDiscoveryUpdated(payload);
        });

        // 定期进行"全量潜意识扫描"
        this.agent.on("agent:iteration", (event) => {
            const messages = this.agent._loop?.messages || [];
            this._learnFromFeedback(messages);
            this._auditGlobalState();
        });
    }
    /**
      * 工具执行后检查
      * @param {ToolCompletedPayload} payload
      * @returns {Promise<void>}
      */
    async _onActionCompleted({ tool, params, result }) {
        this._checkPlanningDrift(tool, params);
    }

    /**
     * 监控黑板状态变化
     * @param {DiscoveryUpdate} discovery
     * @returns {Promise<void>}
     */
    async _onDiscoveryUpdated(discovery) {
        this.logger.debug(`[AlertMonitor] discovery: ${JSON.stringify(discovery)}`);

        // 确保能拿到 ID
        const id = discovery.gapId || discovery.id;

        if (discovery.status === "contradicted") {
            const id = discovery.gapId || discovery.id;
            if (this._suppressedIds.has(id)) return;

            this._triggerAlert({
                type: "observation",
                message: `[发现] 项 "${id}" 存在不一致证据，建议发起 cross-verify 确认。`,
                severity: "high",
                confidence: 0.9,
                id
            });
        }
    }

    /**
     * 行动审计：监控工具调用模式
     * @param {string} tool
     * @param {any} params
     * @returns {void}
     */
    _checkPlanningDrift(tool, params) {
        // 记录工具调用频率 (简单演示)
        /** @type {{ tool: string, time: number }[]} */
        this._toolHistory = this._toolHistory || [];
        this._toolHistory.push({ tool, time: Date.now() });
        if (this._toolHistory.length > 100) this._toolHistory = this._toolHistory.slice(-50);

        // 重复性检查
        const recent = this._toolHistory.slice(-3);
        const isRepeated = recent.length === 3 && recent.every(h => h.tool === tool);

        if (isRepeated) {
            this._triggerAlert({
                type: "suggestion",
                message: `[提示] 检测到重复调用 "${tool}"。如路径受阻，可考虑使用 Backtrack 回溯或 Watchdog 换脑。`,
                severity: "medium"
            });
        }
    }

    /**
     * 扫描黑板与全局状态 (全能辅佐)
     * @returns {void}
     */
    _auditGlobalState() {
        if (!this.agent.discovery) return;

        const discoveries = this.agent.discovery.getAllDiscoveries();
        const pendingConflicts = discoveries.filter(d => d.status === "contradicted");

        // 核心冲突提醒
        if (pendingConflicts.length > 0 && this._pendingAlerts.length === 0) {
            this._triggerAlert({
                type: "notification",
                message: `[发现] 尚有 ${pendingConflicts.length} 项冲突证据待 cross-verify。`,
                severity: "medium"
            });
        }

        this._auditResearchHealth(discoveries);
    }

    /**
     * 针对高级工具箱的隐式引导
     * @param {Array<Record<string, any>>} discoveries
     * @returns {void}
     */
    _auditResearchHealth(discoveries) {
        const iterationCount = this.agent.loop?.iteration || 0;
        const satisfiedCount = discoveries.filter(d => d.status === "satisfied").length;
        const totalGaps = discoveries.length;
        const progress = totalGaps > 0 ? (satisfiedCount / totalGaps) : 0;

        // 1. Recall 提醒 (当历史较长可能面临上下文丢失时)
        if (iterationCount > 5 && iterationCount % 5 === 0) {
            this._triggerAlert({
                type: "tool_advice",
                message: `[提示] 迭代已达 ${iterationCount} 轮。如需调取早期技术细节，建议调用 Recall。`,
                severity: "low",
                confidence: 0.7
            });
        }

        // 2. Task 提醒 (任务重且多，主意识可能过载)
        if (totalGaps > 8 && !this._isFlowActive) {
            this._triggerAlert({
                type: "tool_advice",
                message: `[提示] 发现项较多且杂，可尝试启动子代理 (Task) 协作。`,
                severity: "low",
                confidence: 0.8
            });
        }

        // 3. 状态评估与报告提醒
        if (totalGaps > 5 && progress < 0.2) {
            this._triggerAlert({
                type: "guidance",
                message: `[状态] 发现项多而进展放缓，建议聚焦核心路径。`,
                severity: "low"
            });
        }
    }
    /**
     * @param {AlertRecord} alert
     * @returns {void}
     */
    _triggerAlert(alert) {
        // 防止重复告警
        const isDuplicate = this._pendingAlerts.some(a => a.message === alert.message);
        if (isDuplicate) return;

        // 如果置信度过低，且处于心流状态，直接丢弃
        if ((alert.confidence || 1.0) < 0.6 && this._isFlowActive) return;

        this.logger.warn(`[AlertMonitor] ${alert.message}`);
        this._pendingAlerts.push(alert);

        if (alert.severity === "critical" && this.policy === "governor") {
            this._forceBacktrack(alert.message);
        }
    }

    /**
     * @returns {AlertRecord[]}
     */
    drainAlerts() {
        const alerts = [...this._pendingAlerts];
        this._pendingAlerts = [];
        return alerts;
    }

    /**
     * @param {string} reason
     * @returns {void}
     */
    _forceBacktrack(reason) {
        this.agent?.eventBus?.emit("alertmonitor:forceBacktrack", { reason });
    }

    /**
     * 从 Agent 回复中学习抑制规则
     * @param {ChatMessage[]} [currentMessages]
     * @returns {void}
     */
    _learnFromFeedback(currentMessages = []) {
        const lastAgentMsg = currentMessages.length > 0
            ? currentMessages.filter(m => m.role === "assistant").slice(-1)[0]
            : null;
        const lastAgentContent = lastAgentMsg?.content || "";

        if (lastAgentContent.includes("忽略告警") || lastAgentContent.includes("无视提醒") || lastAgentContent.includes("误报")) {
            const match = lastAgentContent.match(/(?:项|ID)\s+(?:为\s+)?[\\"]+([^\\"]+)[\\"]+\s*(?:无关|误报|已处理|处理过|重复)/);
            if (match) {
                this.logger.warn(`[AlertMonitor] Suppressing ID "${match[1]}" due to agent rejection.`);
                this._suppressedIds.add(match[1]);
            }
        }
    }

    /**
     * 过滤不必要的告警
     * @param {AlertRecord[]} alerts
     * @param {ChatMessage[]} [currentMessages]
     * @returns {AlertRecord[]}
     */
    _filterAlerts(alerts, currentMessages = []) {
        if (alerts.length === 0) return [];

        const lastAgentMsg = currentMessages.length > 0
            ? currentMessages.filter(m => m.role === "assistant").slice(-1)[0]
            : null;
        const lastAgentContent = lastAgentMsg?.content || "";

        return alerts.filter(alert => {
            if (alert.id && this._suppressedIds.has(alert.id)) return false;

            // 如果 Agent 已经在处理该 ID，抑制
            const match = alert.message.match(/(?:项|ID)\s+(?:为\s+)?"([^"]+)"/);
            if (match && lastAgentContent.includes(match[1])) {
                this.logger.debug(`[AlertMonitor] Suppression: Agent already aware of "${match[1]}"`);
                return false;
            }

            // 状态提示在 Agent 已讨论时抑制
            if (alert.type === "status" || alert.type === "guidance") {
                if (lastAgentContent.includes("报告") || lastAgentContent.includes("总结")) {
                    return false;
                }
            }

            // 长对话中低置信度告警抑制
            if ((alert.confidence || 1.0) < 0.7 && currentMessages.length > 20) {
                return false;
            }

            return true;
        });
    }

    /**
     * 基于当前告警生成注入系统提示的 Markdown 片段。
     * @param {ChatMessage[]} [currentMessages]
     * @returns {string | null}
     */
    getInjectedPrompt(currentMessages = []) {
        if (this._pendingAlerts.length === 0) return null;

        let candidateAlerts = [];
        if (this._isFlowActive) {
            candidateAlerts = this._pendingAlerts.filter(a => a.severity === "high" || a.severity === "critical");
            this._pendingAlerts = this._pendingAlerts.filter(a => a.severity !== "high" && a.severity !== "critical");
        } else {
            candidateAlerts = [...this._pendingAlerts];
            this._pendingAlerts = [];
        }

        const finalAlerts = this._filterAlerts(candidateAlerts, currentMessages);

        if (finalAlerts.length === 0) return null;

        const messages = finalAlerts.map(a => `- ${a.message}`);
        return `\n### 提醒\n${messages.join("\n")}\n`;
    }
}

export default AlertMonitor;
