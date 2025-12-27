/**
 * Skill 接口类型定义
 */

/** Skill 参数 Schema */
export interface ParameterSchema {
    type: "string" | "number" | "boolean" | "object" | "array";
    description?: string;
    required?: boolean;
    default?: unknown;
}

/** Skill 定义 */
export interface SkillDefinition {
    name: string;
    description: string;
    activation?: {
        keywords?: string[];
        priority?: number;
    };
    parameters?: Record<string, ParameterSchema>;
    lazy?: boolean;
}

/** Skill 执行上下文 */
export interface SkillContext {
    state: unknown;
    emit: (event: string, payload: unknown) => void;
    signal: AbortSignal;
    logger: {
        debug: (msg: string, data?: unknown) => void;
        info: (msg: string, data?: unknown) => void;
        warn: (msg: string, data?: unknown) => void;
        error: (msg: string, data?: unknown) => void;
    };
}

/** Skill 执行结果 */
export interface SkillResult {
    success: boolean;
    data?: unknown;
    error?: string;
}

/** Skill Handler 函数签名 */
export type SkillHandler = (
    args: Record<string, unknown>,
    context: SkillContext
) => Promise<SkillResult>;

/** 完整 Skill 对象 */
export interface Skill {
    definition: SkillDefinition;
    handler: SkillHandler | null;
    _module?: string;
}

/** Hook 上下文 */
export interface HookContext {
    tool: string;
    params: Record<string, unknown>;
    context: unknown;
    result?: unknown;
}

/** Before Hook - 可跳过或修改参数 */
export type BeforeHook = (ctx: HookContext) => Promise<{
    skip?: boolean;
    value?: unknown;
    params?: Record<string, unknown>;
} | void>;

/** After Hook - 可修改结果 */
export type AfterHook = (ctx: HookContext) => Promise<unknown>;
