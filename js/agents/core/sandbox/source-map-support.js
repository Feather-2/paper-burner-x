/**
 * SourceMap Support - QuickJS 错误堆栈行号映射
 *
 * QuickJS 执行的代码经过包装（如 async IIFE），导致错误堆栈中的行号
 * 与原始源码不一致。本模块通过记录包装偏移量，将堆栈行号映射回原始行号。
 *
 * 不依赖 source-map npm 包，仅做简单的行号偏移计算。
 */

/**
 * @typedef {Object} SourceMapping
 * @property {string} sourceCode - 原始源码
 * @property {number} lineOffset - 包装代码添加的行数偏移
 */

/**
 * QuickJS 堆栈帧正则：
 * - `at functionName (filename:line:column)`
 * - `at functionName (filename:line)`
 * - `at filename:line:column`
 * - `at filename:line`
 */
const STACK_FRAME_RE = /^(\s*at\s+)(?:(.*?)\s+\()?(.*?):(\d+)(?::(\d+))?(\))?(.*)$/;

/**
 * SourceMapRegistry - 管理脚本的行号偏移映射
 */
export class SourceMapRegistry {
  constructor() {
    /** @type {Map<string, SourceMapping>} */
    this._mappings = new Map();
  }

  /**
   * 注册源码映射
   * @param {string} scriptId - 脚本标识符
   * @param {string} sourceCode - 原始源码
   * @param {number} lineOffset - 包装代码添加的行数偏移
   */
  register(scriptId, sourceCode, lineOffset) {
    this._mappings.set(scriptId, { sourceCode, lineOffset });
  }

  /**
   * 映射单个位置
   * @param {string} scriptId - 脚本标识符
   * @param {number} line - 包装后的行号
   * @param {number} [column] - 列号（透传，不做映射）
   * @returns {{ line: number, column?: number } | null}
   */
  mapPosition(scriptId, line, column) {
    const mapping = this._mappings.get(scriptId);
    if (!mapping) return null;
    const mapped = line - mapping.lineOffset;
    return { line: Math.max(1, mapped), column };
  }

  /**
   * 将 QuickJS 错误堆栈中的行号映射回原始源码行号
   * @param {string} stack - 原始错误堆栈字符串
   * @param {string} [scriptId] - 限定只映射指定脚本（可选，默认映射所有已注册脚本）
   * @returns {string} 映射后的堆栈字符串
   */
  mapStackTrace(stack, scriptId) {
    if (!stack || this._mappings.size === 0) return stack;

    return stack.split('\n').map(line => {
      const match = line.match(STACK_FRAME_RE);
      if (!match) return line;

      const [, prefix, funcName, filename, lineStr, colStr, paren, rest] = match;
      const origLine = parseInt(lineStr, 10);

      // 确定使用哪个映射
      let id;
      if (scriptId) {
        // 仅当文件名匹配指定 scriptId 时才映射
        if (filename === scriptId || filename.endsWith(scriptId) || scriptId.endsWith(filename)) {
          id = scriptId;
        }
      } else {
        id = this._findScriptId(filename);
      }
      if (!id) return line;

      const mapped = this.mapPosition(id, origLine, colStr ? parseInt(colStr, 10) : undefined);
      if (!mapped) return line;

      const loc = mapped.column != null
        ? `${filename}:${mapped.line}:${mapped.column}`
        : `${filename}:${mapped.line}`;

      if (funcName) {
        return `${prefix}${funcName} (${loc})${rest}`;
      }
      return `${prefix}${loc}${rest}`;
    }).join('\n');
  }

  /**
   * 根据文件名查找已注册的 scriptId
   * @param {string} filename
   * @returns {string | undefined}
   */
  _findScriptId(filename) {
    // 精确匹配
    if (this._mappings.has(filename)) return filename;
    // 尾部匹配（QuickJS 可能使用不同的路径前缀）
    for (const id of this._mappings.keys()) {
      if (filename.endsWith(id) || id.endsWith(filename)) return id;
    }
    return undefined;
  }

  /**
   * 移除指定脚本的映射
   * @param {string} scriptId
   */
  remove(scriptId) {
    this._mappings.delete(scriptId);
  }

  /** 清除所有映射 */
  clear() {
    this._mappings.clear();
  }

  /** @returns {number} 已注册映射数量 */
  get size() {
    return this._mappings.size;
  }
}

/**
 * 计算 async IIFE 包装的行偏移量
 *
 * executeAsync 的包装模板：
 * ```
 * \n      (async () => {\n        ${code}\n      })()\n
 * ```
 * 第一行是空行（模板字面量开头换行），第二行是 `(async () => {`，
 * 原始代码从第三行开始 → 偏移 = 2
 *
 * @returns {number}
 */
export function getAsyncWrapperOffset() {
  return 2;
}

/**
 * 计算同步执行的行偏移量（execute 不包装代码）
 * @returns {number}
 */
export function getSyncWrapperOffset() {
  return 0;
}

export default SourceMapRegistry;
