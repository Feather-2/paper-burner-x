/**
 * CDN Fallback Loader
 *
 * 本地文件优先加载，失败时回退到 CDN。
 * 支持离线使用，同时兼容 Vercel 等云部署场景。
 */

const CDN_FALLBACKS = {
  'lib/pptxgen.bundle.js': 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
  'lib/docx-preview.min.js': 'https://gcore.jsdelivr.net/npm/docx-preview@0.3.7/dist/docx-preview.min.js',
  'lib/iconify-icon.min.js': 'https://gcore.jsdelivr.net/npm/iconify-icon@2.0.0/dist/iconify-icon.min.js',
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
  const tasks = Object.entries(CDN_FALLBACKS).map(([local, cdn]) =>
    loadScriptWithFallback(local, cdn).catch(() => null)
  );
  await Promise.all(tasks);
  console.log('[CDN-Fallback] All external dependencies loaded');
}

// 自动执行
if (typeof window !== 'undefined') {
  loadExternalDeps();
}

export default { loadExternalDeps, CDN_FALLBACKS };
