/**
 * CDN Fallback Loader
 *
 * 本地文件优先加载，失败时回退到 CDN。
 * 支持离线使用，同时兼容 Vercel 等云部署场景。
 */

// NOTE: Keep this list minimal. Most runtime deps are loaded explicitly in `index.html`
// to preserve deterministic load order. This file is only for deps that are NOT
// otherwise included (e.g. docx-preview for Word preview).
const CDN_FALLBACKS = {
  'lib/docx-preview.min.js': 'https://gcore.jsdelivr.net/npm/docx-preview@0.3.7/dist/docx-preview.min.js',
  // Optional: PPT export support (if needed outside `ppt.html`)
  'lib/pptxgen.bundle.js': 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
};

// If these globals already exist, skip loading to avoid double-including UMD scripts.
const GLOBAL_GUARDS = {
  'lib/docx-preview.min.js': () => typeof window.docx !== 'undefined',
  'lib/pptxgen.bundle.js': () => typeof window.PptxGenJS !== 'undefined',
};

/**
 * 加载脚本，本地优先，CDN fallback
 */
function loadScriptWithFallback(localPath, cdnUrl) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = localPath;
    script.onload = () => {
      console.log(`[CDN-Fallback] Loaded local: ${localPath}`);
      resolve(true);
    };
    script.onerror = () => {
      console.warn(`[CDN-Fallback] Local failed, trying CDN: ${cdnUrl}`);
      const cdnScript = document.createElement('script');
      cdnScript.src = cdnUrl;
      cdnScript.onload = () => {
        console.log(`[CDN-Fallback] Loaded CDN: ${cdnUrl}`);
        resolve(true);
      };
      cdnScript.onerror = () => {
        console.error(`[CDN-Fallback] Both failed: ${localPath}`);
        reject(new Error(`Failed to load: ${localPath}`));
      };
      document.head.appendChild(cdnScript);
    };
    document.head.appendChild(script);
  });
}

/**
 * 加载所有外部依赖
 */
export async function loadExternalDeps() {
  const tasks = Object.entries(CDN_FALLBACKS).map(([local, cdn]) => {
    try {
      const guard = GLOBAL_GUARDS[local];
      if (guard && guard()) return Promise.resolve(true);
    } catch {
      // ignore guard failures; attempt load
    }
    return loadScriptWithFallback(local, cdn).catch(() => null);
  });
  await Promise.all(tasks);
  console.log('[CDN-Fallback] All external dependencies loaded');
}

// 自动执行
if (typeof window !== 'undefined') {
  loadExternalDeps();
}

export default { loadExternalDeps, CDN_FALLBACKS };
