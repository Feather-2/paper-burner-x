/**
 * Python Skill Executor
 *
 * 执行 Python 运行时的 Skill：
 * 1. 解析依赖并生成加载脚本
 * 2. 预加载依赖到 Pyodide
 * 3. 读取并执行 Skill 代码
 * 4. 返回结果
 */

import { DependencyManager } from "../deps/dependency-manager.js";
import { PythonRuntimeAdapter } from "../core/python-adapter.js";
import { SkillRuntime } from "../../skills/model.js";
import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("runtime/deps/python-skill-executor");

/**
 * @typedef {Object} SkillExecutionContext
 * @property {Object} state - 传入 Skill 的状态
 * @property {Object} vfs - VFS 实例
 * @property {AbortSignal} [signal] - 取消信号
 * @property {Object} [inputFiles] - 额外输入文件
 */

/**
 * @typedef {Object} SkillExecutionResult
 * @property {boolean} success - 是否成功
 * @property {any} [data] - 返回数据
 * @property {string} [error] - 错误信息
 * @property {Object} [metrics] - 执行指标
 * @property {Object[]} [outputFiles] - 输出文件
 */

/**
 * Python Skill 执行器
 */
export class PythonSkillExecutor {
  /**
   * @param {Object} options
   * @param {Object} [options.vfs] - VFS 实例
   * @param {PythonRuntimeAdapter} [options.pythonAdapter] - Python 适配器
   * @param {DependencyManager} [options.dependencyManager] - 依赖管理器
   */
  constructor(options = {}) {
    this.vfs = options.vfs || null;
    this.pythonAdapter = options.pythonAdapter || null;
    this.dependencyManager = options.dependencyManager || new DependencyManager({ vfs: this.vfs });
    this._initialized = false;
  }

  /**
   * 确保 Python 适配器已初始化
   */
  async ensureAdapter() {
    if (!this.pythonAdapter) {
      this.pythonAdapter = new PythonRuntimeAdapter({
        watchPaths: ["/mnt/workspace", "/output"],
      });
    }
    if (!this._initialized) {
      await this.pythonAdapter.initialize();
      this._initialized = true;
    }
  }

  /**
   * 执行 Python Skill
   *
   * @param {Object} skill - Skill 元数据
   * @param {SkillExecutionContext} context - 执行上下文
   * @returns {Promise<SkillExecutionResult>}
   */
  async execute(skill, context) {
    const startTime = Date.now();
    const { metadata, path } = skill;

    // 验证运行时类型
    if (metadata.runtime !== SkillRuntime.PYTHON && metadata.runtime !== "python") {
      return {
        success: false,
        error: `Expected Python skill, got runtime: ${metadata.runtime}`,
        metrics: { duration: Date.now() - startTime },
      };
    }

    try {
      await this.ensureAdapter();

      // 1. 解析依赖
      const dependencies = metadata.dependencies || {};
      const plan = await this.dependencyManager.resolve(dependencies);

      logger.info(`Resolved dependencies for ${metadata.name}:`, {
        builtin: plan.builtin.length,
        micropip: plan.micropip.length,
        wheels: plan.wheels.length,
      });

      // 2. 缓存未缓存的 wheels
      for (let i = 0; i < plan.wheels.length; i++) {
        if (!plan.wheels[i].cached) {
          plan.wheels[i] = await this.dependencyManager.cacheWheel(plan.wheels[i]);
        }
      }

      // 3. 预加载依赖（结构化 plan，避免在 Worker 中执行任意 JS）
      await this.pythonAdapter.preloadPlan(plan);
      this.dependencyManager.markLoaded([
        ...plan.builtin,
        ...plan.micropip.map((d) => d.split(/[<>=]/)[0]),
      ]);

      // 4. 读取 Skill 代码
      const entrypoint = metadata.entrypoint || "main.py";
      const skillPath = `${path}/${entrypoint}`;
      let code;

      if (this.vfs) {
        code = await this.vfs.readFile(skillPath);
        if (code instanceof Uint8Array) {
          code = new TextDecoder().decode(code);
        }
      } else {
        return {
          success: false,
          error: `VFS required to read skill code: ${skillPath}`,
          metrics: { duration: Date.now() - startTime },
        };
      }

      // 5. 执行
      const result = await this.pythonAdapter.execute(code, {
        state: context.state || {},
        vfs: this.vfs,
      });

      return {
        success: result.success,
        data: result.data,
        error: result.error,
        metrics: {
          duration: Date.now() - startTime,
          ...result.metrics,
        },
      };
    } catch (err) {
      logger.error(`Failed to execute Python skill ${metadata.name}:`, { error: err.message });
      return {
        success: false,
        error: err.message,
        metrics: { duration: Date.now() - startTime },
      };
    }
  }

  /**
   * 终止执行器
   */
  async terminate() {
    if (this.pythonAdapter) {
      await this.pythonAdapter.terminate();
      this.pythonAdapter = null;
    }
    this._initialized = false;
  }
}

/**
 * 创建 Python Skill 执行器
 * @param {Object} options
 * @returns {PythonSkillExecutor}
 */
export function createPythonSkillExecutor(options = {}) {
  return new PythonSkillExecutor(options);
}

/**
 * 便捷方法：执行单个 Python Skill
 * @param {Object} skill - Skill 元数据和路径
 * @param {SkillExecutionContext} context - 执行上下文
 * @param {Object} [options] - PythonSkillExecutor 选项
 * @returns {Promise<SkillExecutionResult>} 执行结果
 */
export async function executePythonSkill(skill, context, options = {}) {
  const executor = new PythonSkillExecutor({
    vfs: context.vfs,
    ...options,
  });

  try {
    return await executor.execute(skill, context);
  } finally {
    // 不终止适配器，允许复用
  }
}
