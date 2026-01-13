/**
 * Core eval framework types (JSDoc-only).
 *
 * This module intentionally contains no runtime logic; it exists so the rest of
 * the eval framework can share consistent typedefs without TypeScript.
 *
 * @module eval/types
 */

/**
 * @typedef {Object} EvalTask
 * @property {string} id - 任务 ID
 * @property {string} description - 任务描述
 * @property {unknown} input - 任务输入
 * @property {unknown} [expected] - 期望输出（用于参考）
 * @property {GraderConfig[]} graders - Grader 配置列表
 * @property {Record<string, unknown>} [metadata] - 元数据
 * @property {'capability' | 'regression'} [type] - 评估类型
 */

/**
 * @typedef {Object} Trial
 * @property {string} taskId - 关联任务 ID
 * @property {number} trialIndex - 试验索引
 * @property {Transcript} transcript - 完整记录
 * @property {unknown} outcome - 最终状态
 * @property {GraderResult[]} graderResults - 各 Grader 结果
 * @property {boolean} passed - 是否通过
 * @property {number} score - 综合得分 (0-1)
 * @property {number} latencyMs - 耗时
 * @property {TrialMetrics} metrics - 指标
 */

/**
 * @typedef {Object} Transcript
 * @property {TranscriptEntry[]} entries - 记录条目
 * @property {number} startTime - 开始时间
 * @property {number} endTime - 结束时间
 */

/**
 * @typedef {Object} TranscriptEntry
 * @property {'input' | 'output' | 'tool_call' | 'tool_result' | 'error' | 'event'} type
 * @property {unknown} content - 内容
 * @property {number} timestamp - 时间戳
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @typedef {Object} GraderConfig
 * @property {string} type - Grader 类型
 * @property {number} [weight] - 权重
 * @property {Record<string, unknown>} [options] - Grader 特定选项
 */

/**
 * @typedef {Object} GraderResult
 * @property {string} graderType - Grader 类型
 * @property {boolean} passed - 是否通过
 * @property {number} score - 得分 (0-1)
 * @property {string} [reason] - 理由
 * @property {EvalIssue[]} [issues] - 问题列表
 */

/**
 * @typedef {Object} EvalIssue
 * @property {string} type - 问题类型
 * @property {'error' | 'warning' | 'info'} severity
 * @property {string} message
 * @property {string} [location]
 */

/**
 * @typedef {Object} TrialMetrics
 * @property {number} turns - 轮次数
 * @property {number} toolCalls - 工具调用数
 * @property {number} totalTokens - Token 总数
 * @property {number} [timeToFirstToken] - 首 Token 延迟
 */

/**
 * @typedef {Object} EvalSuiteResult
 * @property {string} suiteId
 * @property {TaskResult[]} tasks
 * @property {AggregatedMetrics} aggregated
 */

/**
 * @typedef {Object} TaskResult
 * @property {string} taskId
 * @property {Trial[]} trials
 * @property {number} passRate - 单次通过率
 * @property {number} passAtK - pass@k
 * @property {number} passExpK - pass^k
 */

/**
 * @typedef {Object} AggregatedMetrics
 * @property {number} totalTasks
 * @property {number} passedTasks - 至少一次通过的任务数
 * @property {number} avgPassRate
 * @property {number} avgScore
 * @property {number} avgLatencyMs
 */

/**
 * @typedef {Object} EvalSuite
 * @property {string} suiteId
 * @property {EvalTask[]} tasks
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @typedef {Object} Grader
 * @property {string} type
 * @property {(input:any, config: GraderConfig, ...rest:any[]) => (GraderResult | Promise<GraderResult>)} grade
 */

