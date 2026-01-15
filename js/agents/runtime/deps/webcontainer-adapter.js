/**
 * WebContainer Adapter - 浏览器内 Node.js 运行时
 *
 * 基于 StackBlitz WebContainer API，在浏览器中运行完整 Node.js 环境。
 *
 * 能力:
 * - npm install
 * - 运行 Node.js 代码
 * - 虚拟文件系统
 * - 内部端口 (Express 等)
 *
 * 限制:
 * - 无原生 C++ 模块
 * - 网络受 CORS 限制
 * - 需要 WebContainer 商业授权
 */

import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("runtime/deps/webcontainer-adapter");

/**
 * @typedef {Object} WebContainerInstance
 * @property {Object} fs - 文件系统 API
 * @property {Function} spawn - 执行命令
 * @property {Function} on - 事件监听
 * @property {Function} teardown - 销毁实例
 */

/**
 * @typedef {Object} WebContainerAdapterOptions
 * @property {number} [bootTimeout=30000] - 启动超时 (ms)
 * @property {boolean} [installOnBoot=false] - 启动时自动 npm install
 * @property {Object} [initialFiles] - 初始文件
 * @property {Function} [onServerReady] - 服务器就绪回调
 * @property {Function} [onStdout] - 标准输出回调
 * @property {Function} [onStderr] - 标准错误回调
 */

/**
 * @typedef {Object} SpawnResult
 * @property {number} exitCode - 退出码
 * @property {string} stdout - 标准输出
 * @property {string} stderr - 标准错误
 */

/**
 * @typedef {Object} ExecuteResult
 * @property {boolean} success
 * @property {*} [data]
 * @property {string} [error]
 * @property {Object} [metrics]
 */

// WebContainer API 动态导入
let _webContainerModule = null;

/**
 * 动态加载 WebContainer API
 * @returns {Promise<{ WebContainer: any }>}
 */
async function getWebContainerAPI() {
  if (_webContainerModule) return _webContainerModule;

  try {
    _webContainerModule = await import("@webcontainer/api");
    return _webContainerModule;
  } catch (err) {
    throw new Error(
      "WebContainer API not available. Install with: npm install @webcontainer/api\n" +
        "Note: Commercial use requires StackBlitz license."
    );
  }
}

/**
 * 检测 WebContainer 是否可用
 * @returns {Promise<boolean>}
 */
export async function isWebContainerSupported() {
  try {
    // 需要 SharedArrayBuffer 和 cross-origin isolation
    if (typeof SharedArrayBuffer === "undefined") {
      logger.debug("WebContainer: SharedArrayBuffer not available");
      return false;
    }

    // 检查 cross-origin isolation
    if (typeof crossOriginIsolated !== "undefined" && !crossOriginIsolated) {
      logger.debug("WebContainer: cross-origin isolation required");
      return false;
    }

    await getWebContainerAPI();
    return true;
  } catch {
    return false;
  }
}

/**
 * WebContainer 适配器
 */
export class WebContainerAdapter {
  /**
   * @param {WebContainerAdapterOptions} [options={}]
   */
  constructor(options = {}) {
    /** @type {WebContainerAdapterOptions} */
    this._options = {
      bootTimeout: 30000,
      installOnBoot: false,
      initialFiles: {},
      ...options,
    };

    /** @type {WebContainerInstance | null} */
    this._container = null;

    /** @type {boolean} */
    this._booted = false;

    /** @type {boolean} */
    this._disposed = false;

    /** @type {Map<string, string>} */
    this._serverUrls = new Map();

    /** @type {string[]} */
    this._installedPackages = [];
  }

  /**
   * 启动 WebContainer
   * @returns {Promise<void>}
   */
  async boot() {
    if (this._disposed) {
      throw new Error("WebContainerAdapter has been disposed");
    }

    if (this._booted) {
      return;
    }

    const { WebContainer } = await getWebContainerAPI();

    logger.info("Booting WebContainer...");
    const startTime = Date.now();

    // 启动超时保护
    const bootPromise = WebContainer.boot();
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error("WebContainer boot timeout")),
        this._options.bootTimeout
      );
    });

    this._container = await Promise.race([bootPromise, timeoutPromise]);

    // 监听服务器就绪事件
    this._container.on("server-ready", (port, url) => {
      logger.info(`Server ready on port ${port}: ${url}`);
      this._serverUrls.set(String(port), url);
      this._options.onServerReady?.(port, url);
    });

    // 写入初始文件
    if (
      this._options.initialFiles &&
      Object.keys(this._options.initialFiles).length > 0
    ) {
      await this._writeFiles(this._options.initialFiles);
    } else {
      // 最小 package.json
      await this._container.fs.writeFile(
        "/package.json",
        JSON.stringify(
          {
            name: "webcontainer-workspace",
            type: "module",
            private: true,
          },
          null,
          2
        )
      );
    }

    this._booted = true;
    logger.info(`WebContainer booted in ${Date.now() - startTime}ms`);

    // 可选: 启动时安装依赖
    if (this._options.installOnBoot) {
      await this.npmInstall();
    }
  }

  /**
   * 确保已启动
   */
  async ensureBoot() {
    if (!this._booted) {
      await this.boot();
    }
  }

  /**
   * 写入文件
   * @param {string} path - 文件路径
   * @param {string | Uint8Array} content - 文件内容
   */
  async writeFile(path, content) {
    await this.ensureBoot();

    // 确保目录存在
    const dir = path.substring(0, path.lastIndexOf("/"));
    if (dir && dir !== "/") {
      await this._mkdirp(dir);
    }

    await this._container.fs.writeFile(path, content);
    logger.debug(`Wrote file: ${path}`);
  }

  /**
   * 读取文件
   * @param {string} path
   * @returns {Promise<string>}
   */
  async readFile(path) {
    await this.ensureBoot();
    return await this._container.fs.readFile(path, "utf-8");
  }

  /**
   * 批量写入文件
   * @param {Record<string, string | { file: { contents: string } }>} files
   */
  async _writeFiles(files) {
    const mount = this._normalizeFiles(files);
    await this._container.mount(mount);
  }

  /**
   * 规范化文件结构
   * @param {Record<string, any>} files
   * @returns {Object}
   */
  _normalizeFiles(files) {
    const result = {};

    for (const [path, content] of Object.entries(files)) {
      const parts = path.replace(/^\//, "").split("/");
      let current = result;

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!current[part]) {
          current[part] = { directory: {} };
        }
        current = current[part].directory;
      }

      const filename = parts[parts.length - 1];
      if (typeof content === "string") {
        current[filename] = { file: { contents: content } };
      } else if (content?.file) {
        current[filename] = content;
      } else {
        current[filename] = { file: { contents: String(content) } };
      }
    }

    return result;
  }

  /**
   * 递归创建目录
   * @param {string} path
   */
  async _mkdirp(path) {
    const parts = path.replace(/^\//, "").split("/");
    let current = "";

    for (const part of parts) {
      current += "/" + part;
      try {
        await this._container.fs.mkdir(current);
      } catch {
        // 目录可能已存在
      }
    }
  }

  /**
   * 执行命令
   * @param {string} command - 命令
   * @param {string[]} [args=[]] - 参数
   * @param {Object} [options={}] - 选项
   * @returns {Promise<SpawnResult>}
   */
  async spawn(command, args = [], options = {}) {
    await this.ensureBoot();

    const process = await this._container.spawn(command, args, {
      cwd: options.cwd || "/",
      env: options.env || {},
    });

    let stdout = "";
    let stderr = "";

    process.output.pipeTo(
      new WritableStream({
        write: (chunk) => {
          stdout += chunk;
          this._options.onStdout?.(chunk);
          if (options.onStdout) options.onStdout(chunk);
        },
      })
    );

    // stderr 通过 output 统一输出，WebContainer 目前不区分
    // 但我们可以通过内容判断
    const exitCode = await process.exit;

    return { exitCode, stdout, stderr };
  }

  /**
   * npm install
   * @param {string[]} [packages=[]] - 要安装的包，空则安装 package.json 的依赖
   * @returns {Promise<SpawnResult>}
   */
  async npmInstall(packages = []) {
    await this.ensureBoot();

    const args = ["install", ...packages];
    logger.info(`Running: npm ${args.join(" ")}`);

    const result = await this.spawn("npm", args);

    if (result.exitCode === 0) {
      this._installedPackages.push(...packages);
      logger.info("npm install completed");
    } else {
      logger.error("npm install failed", { stdout: result.stdout });
    }

    return result;
  }

  /**
   * 执行 Node.js 代码
   * @param {string} code - 要执行的代码
   * @param {Object} [options={}]
   * @returns {Promise<ExecuteResult>}
   */
  async executeCode(code, options = {}) {
    await this.ensureBoot();

    const startTime = Date.now();
    const filename = options.filename || `/_exec_${Date.now()}.mjs`;

    try {
      // 包装代码以捕获返回值
      const wrappedCode = `
import { writeFileSync } from 'fs';

async function __main__() {
  ${code}
}

try {
  const result = await __main__();
  writeFileSync('/_result.json', JSON.stringify({ success: true, data: result }));
} catch (err) {
  writeFileSync('/_result.json', JSON.stringify({ success: false, error: err.message }));
}
`;

      await this.writeFile(filename, wrappedCode);

      const spawnResult = await this.spawn("node", [filename]);

      // 读取结果
      let result;
      try {
        const resultJson = await this.readFile("/_result.json");
        result = JSON.parse(resultJson);
      } catch {
        // 如果没有结果文件，根据退出码判断
        result = {
          success: spawnResult.exitCode === 0,
          data: spawnResult.stdout,
          error: spawnResult.exitCode !== 0 ? spawnResult.stdout : undefined,
        };
      }

      return {
        ...result,
        metrics: {
          duration: Date.now() - startTime,
          exitCode: spawnResult.exitCode,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        metrics: { duration: Date.now() - startTime },
      };
    }
  }

  /**
   * 执行 Skill
   * @param {Object} skill - Skill 元数据
   * @param {Object} context - 执行上下文
   * @returns {Promise<ExecuteResult>}
   */
  async executeSkill(skill, context = {}) {
    const { metadata, code } = skill;

    // 安装依赖
    if (metadata?.dependencies) {
      const deps = Object.entries(metadata.dependencies).map(
        ([name, version]) => `${name}@${version}`
      );
      if (deps.length > 0) {
        const installResult = await this.npmInstall(deps);
        if (installResult.exitCode !== 0) {
          return {
            success: false,
            error: `Failed to install dependencies: ${installResult.stdout}`,
          };
        }
      }
    }

    // 注入 context
    const wrappedCode = `
// Injected context
const __context__ = ${JSON.stringify(context)};
const state = __context__.state || {};

${code}
`;

    return this.executeCode(wrappedCode, {
      filename: `/${metadata?.name || "skill"}.mjs`,
    });
  }

  /**
   * 获取服务器 URL
   * @param {number} port
   * @returns {string | undefined}
   */
  getServerUrl(port) {
    return this._serverUrls.get(String(port));
  }

  /**
   * 销毁实例
   */
  async dispose() {
    if (this._disposed) return;

    if (this._container) {
      try {
        await this._container.teardown();
      } catch (err) {
        logger.warn("WebContainer teardown error:", err.message);
      }
      this._container = null;
    }

    this._booted = false;
    this._disposed = true;
    this._serverUrls.clear();
    logger.info("WebContainer disposed");
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      booted: this._booted,
      disposed: this._disposed,
      installedPackages: [...this._installedPackages],
      servers: Object.fromEntries(this._serverUrls),
    };
  }
}

/**
 * 创建 WebContainer 适配器
 * @param {WebContainerAdapterOptions} [options]
 * @returns {Promise<WebContainerAdapter>}
 */
export async function createWebContainerAdapter(options = {}) {
  const adapter = new WebContainerAdapter(options);
  await adapter.boot();
  return adapter;
}

export default WebContainerAdapter;
