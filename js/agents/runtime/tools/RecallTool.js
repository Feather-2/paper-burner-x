/**
 * Recall 工具 - 允许模型回想（查询）之前被压缩或存档的记忆细节。
 *
 * 对应 cc.md 中提到的"平时记纲要，用时翻档案"的设计。
 */

import { normalizeToolResult } from "../core/agent-loop.js";

/**
 * @typedef {object} CicadaCompressor
 * @property {Function} [query]
 * @property {Function} [recall]
 * @property {Function} [listArchives]
 * @property {Function} [restore]
 */

/**
 * 创建 Recall 工具 Handler
 * @param {Object} options
 * @param {CicadaCompressor} options.compressor - Cicada 实例，用于访问归档
 * @returns {Function}
 */
export function createRecallTool({ compressor }) {
    if (!compressor) {
        throw new Error("RecallTool requires a CicadaCompressor instance");
    }

    /**
     * Recall 工具实现
     * @param {Object} args
     * @param {"list"|"search"|"get"} args.action - 操作类型
     * @param {string} [args.query] - 搜索关键词 (用于 search)
     * @param {string} [args.archive_id] - 存档 ID (用于 get)
     * @param {number} [args.limit=5] - 返回结果数量限制
     */
    return async function recallHandler(args, context) {
        const { action = "list", query, archive_id, limit = 5 } = args;
        const { logger } = context;

        try {
            switch (action) {
                case "list": {
                    const archives = await compressor.listArchives({ limit });
                    if (archives.length === 0) {
                        return { ok: true, data: "No archived memories found." };
                    }
                    const list = archives.map(a =>
                        `ID: ${a.id} | Time: ${new Date(a.timestamp).toLocaleString()} | Summary: ${a.summary}`
                    ).join("\n");
                    return { ok: true, data: `Available memories:\n${list}` };
                }

                case "search": {
                    if (!query) return { ok: false, error: "Query is required for search" };
                    const results = await compressor.listArchives({ pattern: query, limit });
                    if (results.length === 0) {
                        return { ok: true, data: `No memories matching "${query}" found.` };
                    }
                    const list = results.map(a =>
                        `ID: ${a.id} | Summary: ${a.summary}`
                    ).join("\n");
                    return { ok: true, data: `Search results for "${query}":\n${list}` };
                }

                case "get": {
                    if (!archive_id) return { ok: false, error: "Archive ID is required for get" };
                    const snapshot = await compressor.restore(archive_id);
                    if (!snapshot) {
                        return { ok: false, error: `Memory with ID "${archive_id}" not found.` };
                    }
                    // 返回完整上下文细节
                    return { ok: true, data: snapshot.context || snapshot };
                }

                default:
                    return { ok: false, error: `Unknown action: ${action}` };
            }
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            logger.error(`Recall tool failed: ${error}`);
            return { ok: false, error };
        }
    };
}

/**
 * Recall 工具定义 (JSON Schema)
 */
export const RECALL_TOOL_DEFINITION = {
    name: "Recall",
    description: "Search or retrieve detailed historical memories from archives. Use this to 'remember' details that were summarized or compressed earlier.",
    parameters: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["list", "search", "get"],
                description: "The action to perform: 'list' (recent memories), 'search' (grep through memories), 'get' (retrieve full detail by ID).",
            },
            query: {
                type: "string",
                description: "The search keyword (for 'search' action).",
            },
            archive_id: {
                type: "string",
                description: "The ID of the memory snapshot to retrieve (for 'get' action).",
            },
            limit: {
                type: "number",
                description: "Maximum number of results to return.",
                default: 5,
            },
        },
        required: ["action"],
    },
};
