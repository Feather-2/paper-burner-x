/**
 * 临时目录 Fixture
 *
 * 支持:
 * - 临时目录创建与自动清理
 * - Git 仓库初始化
 * - 自定义初始化/清理回调
 * - Symbol.asyncDispose 自动资源管理
 *
 * @example
 * // 基础用法
 * const tmp = await tmpdir();
 * console.log(tmp.path); // /tmp/pb-test-xxx
 * await tmp[Symbol.asyncDispose](); // 清理
 *
 * @example
 * // 带 Git 初始化
 * const tmp = await tmpdir({ git: true });
 *
 * @example
 * // 带自定义初始化
 * const tmp = await tmpdir({
 *   init: async (dir) => {
 *     await fs.writeFile(path.join(dir, 'config.json'), '{}');
 *     return { configPath: path.join(dir, 'config.json') };
 *   }
 * });
 * console.log(tmp.extra.configPath);
 *
 * @example
 * // Vitest 中使用 (手动清理)
 * let tmp;
 * beforeEach(async () => { tmp = await tmpdir(); });
 * afterEach(async () => { await tmp?.[Symbol.asyncDispose](); });
 *
 * @module tests/helpers/tmpdir
 */

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCb);

/**
 * @typedef {Object} TmpdirOptions
 * @property {boolean} [git=false] - 是否初始化 Git 仓库
 * @property {boolean} [gitCommit=true] - Git 初始化后是否创建空提交
 * @property {(dir: string) => Promise<T>} [init] - 自定义初始化回调
 * @property {(dir: string) => Promise<void>} [dispose] - 自定义清理回调
 * @property {boolean} [keepOnError=false] - 发生错误时是否保留目录 (调试用)
 * @property {string} [prefix='pb-test'] - 目录名前缀
 * @template T
 */

/**
 * @typedef {Object} TmpdirResult
 * @property {string} path - 临时目录绝对路径
 * @property {T} extra - init 回调返回的额外数据
 * @property {() => Promise<void>} cleanup - 手动清理方法
 * @property {() => Promise<void>} [Symbol.asyncDispose] - 自动清理
 * @template T
 */

/**
 * 创建临时目录
 *
 * @template T
 * @param {TmpdirOptions<T>} [options={}] - 配置选项
 * @returns {Promise<TmpdirResult<T>>} 临时目录对象
 */
export async function tmpdir(options = {}) {
  const {
    git = false,
    gitCommit = true,
    init,
    dispose,
    keepOnError = false,
    prefix = 'pb-test',
  } = options;

  // 生成唯一目录名
  const dirName = `${prefix}-${randomUUID().slice(0, 8)}`;
  const dirPath = path.join(os.tmpdir(), dirName);

  // 创建目录
  await fs.mkdir(dirPath, { recursive: true });

  let extra;
  let initError;

  try {
    // Git 初始化
    if (git) {
      await exec('git init', { cwd: dirPath });
      await exec('git config user.email "test@test.com"', { cwd: dirPath });
      await exec('git config user.name "Test"', { cwd: dirPath });
      if (gitCommit) {
        await exec('git commit --allow-empty -m "init"', { cwd: dirPath });
      }
    }

    // 自定义初始化
    if (init) {
      extra = await init(dirPath);
    }
  } catch (err) {
    initError = err;
    if (!keepOnError) {
      await safeRemove(dirPath);
    }
    throw err;
  }

  // 清理函数
  const cleanup = async () => {
    try {
      if (dispose) {
        await dispose(dirPath);
      }
    } finally {
      await safeRemove(dirPath);
    }
  };

  // 获取真实路径 (解析符号链接)
  const realPath = await fs.realpath(dirPath);

  return {
    path: realPath,
    extra,
    cleanup,
    [Symbol.asyncDispose]: cleanup,
  };
}

/**
 * 安全删除目录
 * @param {string} dirPath - 目录路径
 */
async function safeRemove(dirPath) {
  try {
    if (existsSync(dirPath)) {
      await fs.rm(dirPath, { recursive: true, force: true });
    }
  } catch {
    // 忽略删除错误
  }
}

/**
 * 创建带预置文件的临时目录
 *
 * @param {Record<string, string>} files - 文件路径到内容的映射
 * @param {Omit<TmpdirOptions<void>, 'init'>} [options={}] - 其他选项
 * @returns {Promise<TmpdirResult<void>>}
 *
 * @example
 * const tmp = await tmpdirWithFiles({
 *   'src/index.js': 'console.log("hello")',
 *   'package.json': JSON.stringify({ name: 'test' }),
 * });
 */
export async function tmpdirWithFiles(files, options = {}) {
  return tmpdir({
    ...options,
    init: async (dir) => {
      for (const [filePath, content] of Object.entries(files)) {
        const fullPath = path.join(dir, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
      }
    },
  });
}

/**
 * 创建带 Git 仓库和文件的临时目录
 *
 * @param {Record<string, string>} files - 文件路径到内容的映射
 * @param {Object} [options={}] - 选项
 * @param {boolean} [options.staged=false] - 是否将文件暂存
 * @param {boolean} [options.committed=false] - 是否提交文件
 * @returns {Promise<TmpdirResult<void>>}
 *
 * @example
 * const tmp = await tmpdirWithGit({
 *   'README.md': '# Test',
 * }, { committed: true });
 */
export async function tmpdirWithGit(files, options = {}) {
  const { staged = false, committed = false } = options;

  return tmpdir({
    git: true,
    init: async (dir) => {
      // 写入文件
      for (const [filePath, content] of Object.entries(files)) {
        const fullPath = path.join(dir, filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
      }

      // 暂存或提交
      if (staged || committed) {
        await exec('git add -A', { cwd: dir });
      }
      if (committed) {
        await exec('git commit -m "add files"', { cwd: dir });
      }
    },
  });
}

/**
 * 在测试中使用临时目录的包装器
 *
 * @template T
 * @param {TmpdirOptions<T>} options - tmpdir 选项
 * @param {(tmp: TmpdirResult<T>) => Promise<void>} fn - 测试函数
 *
 * @example
 * await withTmpdir({ git: true }, async (tmp) => {
 *   expect(existsSync(path.join(tmp.path, '.git'))).toBe(true);
 * });
 */
export async function withTmpdir(options, fn) {
  const tmp = await tmpdir(options);
  try {
    await fn(tmp);
  } finally {
    await tmp.cleanup();
  }
}

/**
 * 读取临时目录中的文件
 *
 * @param {TmpdirResult<any>} tmp - tmpdir 返回的对象
 * @param {string} filePath - 相对文件路径
 * @returns {Promise<string>} 文件内容
 */
export async function readTmpFile(tmp, filePath) {
  return fs.readFile(path.join(tmp.path, filePath), 'utf-8');
}

/**
 * 写入临时目录中的文件
 *
 * @param {TmpdirResult<any>} tmp - tmpdir 返回的对象
 * @param {string} filePath - 相对文件路径
 * @param {string} content - 文件内容
 */
export async function writeTmpFile(tmp, filePath, content) {
  const fullPath = path.join(tmp.path, filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}

/**
 * 检查临时目录中的文件是否存在
 *
 * @param {TmpdirResult<any>} tmp - tmpdir 返回的对象
 * @param {string} filePath - 相对文件路径
 * @returns {boolean}
 */
export function tmpFileExists(tmp, filePath) {
  return existsSync(path.join(tmp.path, filePath));
}
