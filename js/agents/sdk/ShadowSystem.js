/**
 * ShadowSystem - 影子系统 (影中监视者 / 潜意识系统)
 * 
 * 职责:
 * 1. 异步监视主 Agent 的行为 (通过事件订阅)。
 * 2. 在后台执行并发审计 (Fact Checking / Logic Validation)。
 * 3. 产生“潜意识信号” (Subconscious Signals) 并注入主模型。
 * 4. 在极端情况下触发“紧急回退”。
 */

export class ShadowSystem {
    constructor(options = {}) {
        this.agent = options.agent; // 相关联的 AgentInstance
        this.logger = options.logger;
        this.auditorModel = options.model || "haiku"; // 仅在启发式不足时备用
        this.policy = options.policy || "advisor";

        // [架构设计] 影子系统采用 "启发式优先 (Heuristic-First)" 设计。
        // 绝大多数审计（ID 匹配、进度计算、工具监控）均为 0 Token 消耗的本地逻辑。
        // 只有在明确需要“语义审计”时才会调用 auditorModel，确保极致的性价比。

        this._pendingAlerts = [];
        this._isAuditing = false;
        this._isFlowActive = false; // [心流状态] 标志
        this._suppressedIds = new Set(); // 被 Agent 显式忽略或反驳的 ID
        this._suppressedTypes = new Set(); // 被抑制的告警类型

        this._setupListeners();
    }

    /**
     * 进入心流状态 (减少噪音攻击)
     */
    enterFlow() {
        this.logger.info("[Shadow] Agent entered Flow State. Silencing non-critical alerts.");
        this._isFlowActive = true;
    }

    /**
     * 退出心流状态
     */
    exitFlow() {
        this.logger.info("[Shadow] Agent exited Flow State.");
        this._isFlowActive = false;
    }

    _setupListeners() {
        if (!this.agent) return;

        // 订阅工具调用完成事件 (关注结果一致性)
        this.agent.on("*.tool.completed", async (event) => {
            const payload = event.payload || event;
            await this._onActionCompleted(payload);
        });

        // 订阅黑板更新事件 (潜意识最关注的地方)
        this.agent.on("deepsearch.gap.evaluated", async (event) => {
            const payload = event.payload || event;
            await this._onDiscoveryUpdated(payload);
        });

        // 定期进行“全量潜意识扫描”
        this.agent.on("agent.iteration", (event) => {
            const messages = this.agent._loop?.messages || [];
            this._learnFromFeedback(messages);
            this._auditGlobalState();
        });
    }
    /**
      * 潜意识核查：工具执行后的即时反馈
      */
    async _onActionCompleted({ tool, params, result }) {
        // 潜意识不关心具体的执行进度，它关心“行为是否偏离了最初的 Todo/Goal”
        this._checkPlanningDrift(tool, params);
    }

    /**
     * 潜意识最核心的职责：监控黑板事实
     */
    async _onDiscoveryUpdated(discovery) {
        this.logger.debug(`[Shadow] discovery_payload: ${JSON.stringify(discovery)}`);

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
     */
    _checkPlanningDrift(tool, params) {
        // 记录工具调用频率 (简单演示)
        this._toolHistory = this._toolHistory || [];
        this._toolHistory.push({ tool, time: Date.now() });

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

        if (progress > 0.8 && totalGaps > 3) {
            this._triggerAlert({
                type: "status",
                message: `[状态] 核心证据链已基本闭环，可准备 write-report。`,
                severity: "low"
            });
        }
    }
    _triggerAlert(alert) {
        // 防止重复告警
        const isDuplicate = this._pendingAlerts.some(a => a.message === alert.message);
        if (isDuplicate) return;

        // 如果置信度过低，且处于心流状态，直接丢弃
        if ((alert.confidence || 1.0) < 0.6 && this._isFlowActive) return;

        this.logger.warn(`[Shadow Alert] ${alert.message}`);
        this._pendingAlerts.push(alert);

        if (alert.severity === "critical" && this.policy === "governor") {
            this._forceBacktrack(alert.message);
        }
    }

    drainAlerts() {
        const alerts = [...this._pendingAlerts];
        this._pendingAlerts = [];
        return alerts;
    }

    _forceBacktrack(reason) {
        this.agent.eventBus.emit("shadow.force_backtrack", { reason });
    }

    /**
     * 从 Agent 的回复中学习 (元认知反馈)
     */
    _learnFromFeedback(currentMessages = []) {
        const lastAgentMsg = currentMessages.length > 0
            ? currentMessages.filter(m => m.role === "assistant").slice(-1)[0]
            : null;
        const lastAgentContent = lastAgentMsg?.content || "";

        if (lastAgentContent.includes("忽略潜意识") || lastAgentContent.includes("无视提醒") || lastAgentContent.includes("误报")) {
            const match = lastAgentContent.match(/(?:项|ID)\s+(?:为\s+)?[\\"]+([^\\"]+)[\\"]+\s*(?:无关|误报|已处理|处理过|重复)/);
            if (match) {
                this.logger.warn(`[Shadow] Feedback received: Suppressing ID "${match[1]}" due to agent rejection.`);
                this._suppressedIds.add(match[1]);
            }
        }
    }

    /**
     * 元认知过滤：评估告警是否仍然必要
     * 1. 如果主意识已经在处理该 ID，则抑制潜意识信号。
     * 2. 如果短时间内已注入过类似信号且 Agent 正在尝试处理，则抑制。
     */
    _metacognitiveFilter(alerts, currentMessages = []) {
        if (alerts.length === 0) return [];

        const lastAgentMsg = currentMessages.length > 0
            ? currentMessages.filter(m => m.role === "assistant").slice(-1)[0]
            : null;
        const lastAgentContent = lastAgentMsg?.content || "";

        return alerts.filter(alert => {
            if (alert.id && this._suppressedIds.has(alert.id)) return false;

            // 1. 如果 alert 消息中提到的关键 ID (如 [发现] 项 "xxx") 已经在最近的消息中出现过
            // 说明主意识已经关注到了，不再需要潜意识注入。
            // 匹配 [发现] 项 "xxx" 或 ID 为 "xxx"
            const match = alert.message.match(/(?:项|ID)\s+(?:为\s+)?"([^"]+)"/);
            if (match && lastAgentContent.includes(match[1])) {
                this.logger.debug(`[Shadow] Metacognitive suppression: Agent is already aware of "${match[1]}"`);
                return false;
            }

            // 2. 状态相关的提示语，如果在最近的消息中已经有了类似讨论，也抑制
            if (alert.type === "status" || alert.type === "guidance") {
                if (lastAgentContent.includes("报告") || lastAgentContent.includes("总结")) {
                    return false;
                }
            }

            // 3. 显着性过滤：如果置信度极低且处于长对话中，抑制非关键信息
            if ((alert.confidence || 1.0) < 0.7 && currentMessages.length > 20) {
                return false;
            }

            return true;
        });
    }

    getInjectedPrompt(currentMessages = []) {
        if (this._pendingAlerts.length === 0) return null;

        // 1. 初步筛选优先级
        let candidateAlerts = [];
        if (this._isFlowActive) {
            candidateAlerts = this._pendingAlerts.filter(a => a.severity === "high" || a.severity === "critical");
            // 从 pending 中移除已经注入的高优先级告警
            this._pendingAlerts = this._pendingAlerts.filter(a => a.severity !== "high" && a.severity !== "critical");
        } else {
            candidateAlerts = [...this._pendingAlerts];
            this._pendingAlerts = [];
        }

        // 2. 元认知监控：判断“是否真有必要注入”
        const finalAlerts = this._metacognitiveFilter(candidateAlerts, currentMessages);

        if (finalAlerts.length === 0) return null;

        const messages = finalAlerts.map(a => `- ${a.message}`);
        return `\n### 影子系统提醒 (潜意识层)\n这些是你可能忽略或与已知事实矛盾的点，请介入处理：\n${messages.join("\n")}\n`;
    }
}

export default ShadowSystem;
