/**
 * Python Runtime Worker
 *
 * 运行在独立线程中的 Python 运行时。
 * 负责加载 Pyodide 和执行 Python 代码，避免阻塞主线程。
 *
 * Pyodide 版本: 0.26.4 (锁定)
 * TODO(AI4Sci): 添加 SRI 完整性校验，或改用本地打包
 */

import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("runtime/tools/python-runtime-worker");

// 版本锁定 - 更新时需同步修改 python-adapter.js 中的 indexUrl 默认值
const PYODIDE_VERSION = '0.26.4';
const PYODIDE_CDN_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full`;

let loadPyodide = null;
let pyodide = null;

async function ensurePyodideLoader() {
  if (loadPyodide) return;
  const mod = await import(`${PYODIDE_CDN_BASE}/pyodide.mjs`);
  loadPyodide = mod.loadPyodide;
}

async function initPyodide(indexUrl) {
  if (pyodide) return;
  await ensurePyodideLoader();
  pyodide = await loadPyodide({
    indexURL: indexUrl || PYODIDE_CDN_BASE,
    stdout: (text) => self.postMessage({ type: 'stdout', text }),
    stderr: (text) => self.postMessage({ type: 'stderr', text }),
  });
}

/**
 * 将内核 VFS 传输的数据同步到 Pyodide FS
 */
async function syncFilesToPyodide(files) {
  if (!files || !pyodide) return;
  for (const file of files) {
    const dir = file.path.substring(0, file.path.lastIndexOf('/'));
    if (dir) {
      pyodide.FS.mkdirTree(dir);
    }
    pyodide.FS.writeFile(file.path, file.content);
  }
}

/**
 * 收集 Pyodide FS 中的变更并传回主线程
 */
async function collectFilesFromPyodide(paths) {
  const files = [];
  if (!pyodide) return files;
  
  const walk = (path) => {
    const entries = pyodide.FS.readdir(path).filter(e => e !== '.' && e !== '..');
    for (const name of entries) {
      const fullPath = `${path}/${name}`;
      const stat = pyodide.FS.stat(fullPath);
      if (pyodide.FS.isDir(stat.mode)) {
        walk(fullPath);
      } else {
        files.push({
          path: fullPath,
          content: pyodide.FS.readFile(fullPath)
        });
      }
    }
  };

  for (const p of paths) {
    try {
      walk(p);
    } catch (e) {
      logger.warn(`[PythonWorker] Failed to walk path ${p}: ${e?.message || String(e)}`);
    }
  }
  return files;
}

self.onmessage = async (evt) => {
  const { type, payload, id } = evt.data;

  try {
    if (type === 'init') {
      await initPyodide(payload.indexUrl);
      self.postMessage({ type: 'ready', id });
    } else if (type === 'preload') {
      await initPyodide(payload.indexUrl);

      // 新增: 支持依赖加载脚本 (由 DependencyManager 生成)
      if (payload.loadScript) {
        // loadScript 是 JS 代码，包含 pyodide.loadPackage 和 micropip 调用
        // 使用 AsyncFunction 执行
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const loadFn = new AsyncFunction('pyodide', payload.loadScript);
        await loadFn(pyodide);
      }

      // 兼容旧接口: 直接传 dependencies 数组
      if (payload.dependencies && payload.dependencies.length > 0) {
        await pyodide.loadPackage(payload.dependencies);
      }

      self.postMessage({ type: 'preloaded', id });
    } else if (type === 'execute') {
      await initPyodide(payload.indexUrl);
      
      // 1. 同步输入文件
      if (payload.files) {
        await syncFilesToPyodide(payload.files);
      }

      // 2. 注入状态
      if (payload.state) {
        pyodide.globals.set('__context_state__', pyodide.toPy(payload.state));
      }

      // 3. 处理 SharedArrayBuffer (如果存在)
      if (payload.sharedBuffers) {
        for (const [name, sab] of Object.entries(payload.sharedBuffers)) {
          const jsView = new Uint8Array(sab);
          pyodide.globals.set(name, pyodide.toPy(jsView));
        }
      }

      // 4. 执行
      const result = await pyodide.runPythonAsync(payload.code);
      
      // 5. 收集输出文件
      const outputFiles = payload.watchPaths ? await collectFilesFromPyodide(payload.watchPaths) : [];
      
      // 6. 返回结果
      self.postMessage({ 
        type: 'result', 
        id, 
        data: result,
        files: outputFiles
      });
    }
  } catch (err) {
    self.postMessage({ 
      type: 'error', 
      id, 
      error: err.message 
    });
  }
};
