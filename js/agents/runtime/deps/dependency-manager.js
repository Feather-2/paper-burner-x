/**
 * Python Dependency Manager
 *
 * 管理 Pyodide 环境的依赖加载：
 * 1. 内置包 (pyodide.loadPackage)
 * 2. micropip 包 (PyPI 纯 Python)
 * 3. 自定义 wheels (URL + OPFS 缓存)
 */

import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("runtime/deps/dependency-manager");

// Pyodide 0.26.x 内置包列表
const PYODIDE_BUILTIN = new Set([
  "numpy",
  "pandas",
  "scipy",
  "matplotlib",
  "scikit-learn",
  "sympy",
  "networkx",
  "pillow",
  "opencv-python",
  "statsmodels",
  "sqlalchemy",
  "beautifulsoup4",
  "lxml",
  "html5lib",
  "jsonschema",
  "pyyaml",
  "toml",
  "regex",
  "pytz",
  "six",
  "packaging",
  "pyparsing",
  "certifi",
  "charset-normalizer",
  "idna",
  "urllib3",
]);

/**
 * 解析包名（去掉版本约束）
 */
function parsePackageName(spec) {
  return spec.split(/[<>=!~\[]/)[0].trim().toLowerCase();
}

/**
 * 计算 SHA-256 哈希
 */
async function sha256(data) {
  const buffer = data instanceof ArrayBuffer ? data : data.buffer;
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * @typedef {Object} WheelSpec
 * @property {string} url - Wheel 下载地址
 * @property {string} [sha256] - 可选的 SHA256 校验
 * @property {string} [localPath] - OPFS 缓存路径
 * @property {boolean} [cached] - 是否已缓存
 */

/**
 * @typedef {Object} DependencySpec
 * @property {string[]} [builtin] - Pyodide 内置包
 * @property {string[]} [micropip] - micropip 安装的包
 * @property {WheelSpec[]} [wheels] - 自定义 wheel
 */

/**
 * @typedef {Object} LoadPlan
 * @property {string[]} builtin - 需加载的内置包
 * @property {string[]} micropip - 需 micropip 安装的包
 * @property {WheelSpec[]} wheels - 需安装的 wheels
 */

export class DependencyManager {
  /**
   * @param {Object} options
   * @param {Object} [options.vfs] - VFS 实例用于缓存
   * @param {string} [options.cacheDir] - 缓存目录
   * @param {number} [options.maxCacheBytes] - 最大缓存大小
   */
  constructor(options = {}) {
    this.vfs = options.vfs || null;
    this.cacheDir = options.cacheDir || "/cache/pyodide-wheels";
    this.maxCacheBytes = options.maxCacheBytes || 500 * 1024 * 1024; // 500MB
    this._loaded = new Set();
    this._loading = new Map();
  }

  /**
   * 检查包是否为 Pyodide 内置
   */
  isBuiltin(packageName) {
    return PYODIDE_BUILTIN.has(parsePackageName(packageName));
  }

  /**
   * 解析依赖声明，生成加载计划
   * @param {DependencySpec} deps
   * @returns {Promise<LoadPlan>}
   */
  async resolve(deps) {
    const plan = { builtin: [], micropip: [], wheels: [] };

    // 1. 处理 builtin
    for (const dep of deps.builtin || []) {
      const name = parsePackageName(dep);
      if (!this._loaded.has(name)) {
        if (this.isBuiltin(name)) {
          plan.builtin.push(name);
        } else {
          logger.warn(`Package ${name} declared as builtin but not in Pyodide, falling back to micropip`);
          plan.micropip.push(dep);
        }
      }
    }

    // 2. 处理 micropip
    for (const dep of deps.micropip || []) {
      const name = parsePackageName(dep);
      if (!this._loaded.has(name)) {
        plan.micropip.push(dep);
      }
    }

    // 3. 处理 wheels
    for (const wheel of deps.wheels || []) {
      const cached = await this._getCachedWheel(wheel);
      plan.wheels.push(cached || wheel);
    }

    return plan;
  }

  /**
   * 检查 OPFS 缓存中是否有 wheel
   * @private
   */
  async _getCachedWheel(wheel) {
    if (!this.vfs) return null;

    const filename = wheel.url.split("/").pop();
    const cachePath = `${this.cacheDir}/${filename}`;

    try {
      const cached = await this.vfs.readFile(cachePath);
      if (!cached) return null;

      // 如果有 SHA256，校验
      if (wheel.sha256) {
        const hash = await sha256(cached);
        if (hash !== wheel.sha256.toLowerCase()) {
          logger.warn(`SHA256 mismatch for cached ${filename}, will re-download`);
          return null;
        }
      }

      return { ...wheel, localPath: cachePath, cached: true };
    } catch {
      return null;
    }
  }

  /**
   * 下载并缓存 wheel 到 OPFS
   * @param {WheelSpec} wheel
   * @returns {Promise<WheelSpec>}
   */
  async cacheWheel(wheel) {
    if (!this.vfs) {
      return wheel; // 无 VFS，直接返回原始 URL
    }

    try {
      const resp = await fetch(wheel.url);
      if (!resp.ok) {
        throw new Error(`Failed to fetch ${wheel.url}: ${resp.status}`);
      }

      const data = new Uint8Array(await resp.arrayBuffer());

      // SHA256 校验
      if (wheel.sha256) {
        const hash = await sha256(data);
        if (hash !== wheel.sha256.toLowerCase()) {
          throw new Error(`SHA256 mismatch: expected ${wheel.sha256}, got ${hash}`);
        }
      }

      // 确保缓存目录存在
      await this._ensureCacheDir();

      // 写入缓存
      const filename = wheel.url.split("/").pop();
      const cachePath = `${this.cacheDir}/${filename}`;
      await this.vfs.writeFile(cachePath, data);

      logger.info(`Cached wheel: ${filename} (${data.length} bytes)`);

      return { ...wheel, localPath: cachePath, cached: true };
    } catch (err) {
      logger.error(`Failed to cache wheel ${wheel.url}:`, { error: err.message });
      return wheel; // 失败时返回原始，让 micropip 直接从 URL 加载
    }
  }

  /**
   * 确保缓存目录存在
   * @private
   */
  async _ensureCacheDir() {
    if (!this.vfs) return;
    try {
      await this.vfs.mkdir(this.cacheDir, { recursive: true });
    } catch {
      // 目录可能已存在
    }
  }

  /**
   * 生成 JS 加载脚本 (在 Worker 中执行)
   * @param {LoadPlan} plan
   * @returns {string} - JS 代码，pyodide 作为参数传入
   */
  generateLoadScript(plan) {
    const lines = [];

    // 1. 加载内置包 (JS API)
    if (plan.builtin.length > 0) {
      lines.push(`// Load Pyodide built-in packages`);
      lines.push(`await pyodide.loadPackage(${JSON.stringify(plan.builtin)});`);
    }

    // 2. 如果有 micropip 或 wheels，需要先加载 micropip
    if (plan.micropip.length > 0 || plan.wheels.length > 0) {
      lines.push(`// Load micropip for additional packages`);
      lines.push(`await pyodide.loadPackage('micropip');`);

      // 构建 Python 脚本来安装包
      const pythonLines = ['import micropip'];

      for (const dep of plan.micropip) {
        pythonLines.push(`await micropip.install('${dep}')`);
      }

      for (const wheel of plan.wheels) {
        if (wheel.cached && wheel.localPath) {
          pythonLines.push(`await micropip.install('emfs:${wheel.localPath}')`);
        } else {
          pythonLines.push(`await micropip.install('${wheel.url}')`);
        }
      }

      // 包装成 Python async 代码
      const pythonCode = pythonLines.join('\\n');
      lines.push(`await pyodide.runPythonAsync(\`${pythonCode}\`);`);
    }

    return lines.join("\n");
  }

  /**
   * 标记包为已加载
   * @param {string[]} packages
   */
  markLoaded(packages) {
    for (const pkg of packages) {
      this._loaded.add(parsePackageName(pkg));
    }
  }

  /**
   * 检查包是否已加载
   * @param {string} packageName
   */
  isLoaded(packageName) {
    return this._loaded.has(parsePackageName(packageName));
  }

  /**
   * 清理 OPFS 缓存（LRU 策略）
   * @param {number} [maxBytes] - 最大保留字节数
   */
  async cleanupCache(maxBytes = this.maxCacheBytes) {
    if (!this.vfs) return;

    try {
      const entries = await this.vfs.list(this.cacheDir);
      if (!entries || entries.length === 0) return;

      let totalSize = 0;
      const files = [];

      for (const e of entries) {
        if (e.kind !== "file") continue;
        const fullPath = `${this.cacheDir}/${e.name}`;
        try {
          const stat = await this.vfs.stat(fullPath);
          totalSize += stat.size || 0;
          files.push({
            name: e.name,
            path: fullPath,
            size: stat.size || 0,
            mtime: stat.mtime || 0,
          });
        } catch {
          // 忽略无法 stat 的文件
        }
      }

      if (totalSize <= maxBytes) return;

      // LRU: 按 mtime 排序，删除最旧的
      files.sort((a, b) => a.mtime - b.mtime);

      while (totalSize > maxBytes && files.length > 0) {
        const oldest = files.shift();
        try {
          await this.vfs.deleteFile(oldest.path);
          totalSize -= oldest.size;
          logger.info(`Evicted cached wheel: ${oldest.name}`);
        } catch {
          // 忽略删除失败
        }
      }
    } catch (err) {
      logger.warn(`Cache cleanup failed:`, { error: err.message });
    }
  }

  /**
   * 获取缓存统计
   */
  async getCacheStats() {
    if (!this.vfs) {
      return { available: false, totalSize: 0, fileCount: 0 };
    }

    try {
      const entries = await this.vfs.list(this.cacheDir);
      let totalSize = 0;
      let fileCount = 0;

      for (const e of entries) {
        if (e.kind !== "file") continue;
        try {
          const stat = await this.vfs.stat(`${this.cacheDir}/${e.name}`);
          totalSize += stat.size || 0;
          fileCount++;
        } catch {
          // 忽略
        }
      }

      return { available: true, totalSize, fileCount, maxBytes: this.maxCacheBytes };
    } catch {
      return { available: false, totalSize: 0, fileCount: 0 };
    }
  }
}

export { PYODIDE_BUILTIN, parsePackageName, sha256 };
