# Audit History - adapters

Archived issues from security audits.

---

## Archived: 2026-01-18

### [RESOLVED] browser-compatibility
*Archived: 2026-01-18T21:10:41.075Z*

- **File**: js/agents/ingest/adapters/pdf.js:95
- **Description**: 多个适配器在路径输入分支中动态 import `node:path`/`node:fs/promises`，违反“无 Node-only API”的浏览器兼容性约束；在浏览器打包/运行时会报错或引入 Node polyfills。受影响文件：audio/docx/epub/html/markdown/pdf/pptx/code/video。
- **Suggestion**: 把路径读取逻辑拆为 Node-only 适配器或注入式 reader；浏览器版本仅接受 File/ArrayBuffer；避免在共享适配器里出现 `node:` 导入。
```
async function basenameOfPath(path) {
  const { basename } = await import("node:path");
  return basename(path);
}

async function fileLikeFromPath(path, { maxBytes } = {}) {
  const { readFile, stat } = await import("node:fs/promises");
```

### [RESOLVED] browser-compatibility/security
*Archived: 2026-01-18T21:10:41.075Z*

- **File**: js/agents/ingest/adapters/pptx.js:66
- **Description**: PptxAdapter 使用 `node:vm` 执行脚本加载解析器，属于 Node-only API 且引入动态代码执行面，在浏览器或受限环境会失败。
- **Suggestion**: 改为 ESM 静态 import 或通过 stageApi 注入解析器；若必须使用 vm，仅在 Node 版本启用并与浏览器版本隔离。
```
async function loadPptxSlideParserFromScript() {
  const { readFile } = await import("node:fs/promises");
  const vm = await import("node:vm");

  const { DOMParser } = await import("linkedom");
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:10:41.075Z*

- **File**: js/agents/ingest/adapters/base.js:267
- **Description**: BaseAdapter.buildParsedDocument 缺少 JSDoc @param/@returns 类型注解，不符合项目 JSDoc 规范。
- **Suggestion**: 补充 @param 对象字段说明与 @returns ParsedDocument，并定义/引用相关 @typedef。
```
buildParsedDocument({ sourceType, origin, markdown, assets, metadata, parseInfo, docId, chunkOptions, useSmartChunk = false } = {}) {
```

### [RESOLVED] jsdoc
*Archived: 2026-01-18T21:10:41.075Z*

- **File**: js/agents/ingest/adapters/code.js:151
- **Description**: CodeAdapter 的公开方法（isSupported/getSupportedExtensions/buildMarkdown/extractDocComment）缺少 @param/@returns 类型注解。
- **Suggestion**: 为这些方法补齐 @param/@returns 类型（filename/code/lang 等），确保类型提示完整。
```
/**
 * Check if a file is a supported code file
 */
static isSupported(filename) {
```

### [RESOLVED] async-error-handling
*Archived: 2026-01-18T21:10:41.075Z*

- **File**: js/agents/ingest/adapters/pdf.js:182
- **Description**: PdfAdapter 在 OCR 分支直接 await ocr.processFile，异常会中断解析并跳过内置字符串回退逻辑。
- **Suggestion**: 对 ocr.processFile 添加 try/catch，失败时记录 warning 并回退到 extractAsciiStrings。
```
if (ocr) {
  ocrResult = await ocr.processFile(file, progress);
  markdown = String(ocrResult?.markdown || "");
```

---

