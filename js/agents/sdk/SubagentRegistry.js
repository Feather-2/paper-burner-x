/**
 * SubagentRegistry - 子代理注册表
 *
 * 管理可用的子代理类型及其工厂函数。
 * 允许模型通过 Task 工具动态启动特定类型的子代理。
 */

export class SubagentRegistry {
    constructor() {
        /** @type {Map<string, {factory: Function, description: string}>} */
        this._subagents = new Map();
    }

    /**
     * 注册子代理类型
     * @param {string} type - 子代理类型 (如 "Explore", "Coder")
     * @param {Function} factory - 创建 AgentInstance 的工厂函数
     * @param {string} [description] - 子代理用途描述
     */
    register(type, factory, description = "") {
        this._subagents.set(type.toLowerCase(), { factory, description });
    }

    /**
     * 获取子代理工厂函数
     * @param {string} type
     * @returns {Function|null}
     */
    getFactory(type) {
        const entry = this._subagents.get(type.toLowerCase());
        return entry ? entry.factory : null;
    }

    /**
     * 获取所有可用的子代理类型及描述
     * @returns {Array<{type: string, description: string}>}
     */
    getAvailableTypes() {
        return Array.from(this._subagents.entries()).map(([type, entry]) => ({
            type,
            description: entry.description,
        }));
    }

    /**
     * 生成子代理目录 Prompt
     * @returns {string}
     */
    getSubagentCatalogPrompt() {
        if (this._subagents.size === 0) return "";

        const lines = ["## 可用子代理 (Subagents)", "当需要处理复杂、多步或需要独立上下文的任务时，使用 Task 工具启动这些专用的子代理："];
        for (const [type, entry] of this._subagents) {
            lines.push(`- **${type}**: ${entry.description}`);
        }
        return lines.join("\n");
    }
}

export const globalSubagentRegistry = new SubagentRegistry();
export default SubagentRegistry;
