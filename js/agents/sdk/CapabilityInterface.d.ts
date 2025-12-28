/**
 * Capability 接口类型定义
 */

/** Capability 参数 Schema */
export interface ParameterSchema {
    type: "string" | "number" | "boolean" | "object" | "array";
    description?: string;
    required?: boolean;
    default?: unknown;
}

/**
 * 三层优先级类型
 * - critical: 核心能力，始终在最前面 (🔴)
 * - important: 重要能力，紧随其后 (🟡) - 默认
 * - optional: 可选能力，放在最后 (⚪)
 */
export type CapabilityPriority = "critical" | "important" | "optional" | 0 | 1 | 2;

/** Capability 定义 */
export interface CapabilityDefinition {
    name: string;
    description: string;
    /** 优先级：critical > important > optional */
    priority?: CapabilityPriority;
    activation?: {
        keywords?: string[];
        /** @deprecated 请使用顶层 priority 字段 */
        priority?: number;
    };
    parameters?: Record<string, ParameterSchema>;
    lazy?: boolean;
}

/** Capability 执行上下文 */
export interface CapabilityContext {
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

/** Capability 执行结果 */
export interface CapabilityResult {
    success: boolean;
    data?: unknown;
    error?: string;
}

/** Capability Handler 函数签名 */
export type CapabilityHandler = (
    args: Record<string, unknown>,
    context: CapabilityContext
) => Promise<CapabilityResult>;

/** 完整 Capability 对象 */
export interface Capability {
    definition: CapabilityDefinition;
    handler: CapabilityHandler | null;
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

// ===== 向后兼容别名 (已废弃) =====

/** @deprecated Use CapabilityDefinition instead */
export type SkillDefinition = CapabilityDefinition;
/** @deprecated Use CapabilityContext instead */
export type SkillContext = CapabilityContext;
/** @deprecated Use CapabilityHandler instead */
export type SkillHandler = CapabilityHandler;
/** @deprecated Use CapabilityResult instead */
export type SkillResult = CapabilityResult;
/** @deprecated Use Capability instead */
export type Skill = Capability;
