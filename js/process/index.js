// process/index.js

// 创建一个包含所有将要导出函数的对象
// 这个对象作为模块的命名空间，用于集中管理和暴露 process 子模块中的功能。
// 在所有相关脚本加载完成后，这些函数会被挂载到全局 window 对象，以兼容旧的调用方式。
const processModule = {
    // 工具函数
    getRetryDelay: null,
    estimateTokenCount: null,
    escapeRegex: null,

    // OCR处理
    processOcrResults: null,

    // 表格处理
    protectMarkdownTables: null,
    extractTableFromTranslation: null,
    restoreMarkdownTables: null,

    // 翻译相关
    buildPredefinedApiConfig: null,
    buildCustomApiConfig: null,
    translateMarkdown: null,

    // 文档处理
    splitMarkdownIntoChunks: null,
    splitByParagraphs: null,
    translateLongDocument: null,

    // 下载功能
    downloadAllResults: null,

    // 主处理流程
    processSinglePdf: null
};

// 在各模块加载完成后执行此函数，将所有函数挂载到全局
/**
 * 初始化处理模块 (processModule)。
 * 此函数在所有依赖的 process 子模块脚本 (`utils.js`, `ocr.js`, 等) 加载完成后被调用。
 * 它的主要作用是将 `processModule` 对象中收集到的所有函数挂载到全局 `window` 对象上，
 * 这样做是为了确保旧的、直接通过 `window.functionName()` 方式调用这些处理函数的地方能够继续工作。
 *
 * 遍历 `processModule` 中的每一个键值对：
 *  - 如果值 (函数) 不为 `null` (即已成功加载并赋值)，则 `window[key] = value`。
 *  - 如果值为 `null`，则在控制台打印一个警告，表明对应的函数未能正确加载。
 * 最后，在控制台打印一条消息，表示模块加载和函数暴露已完成。
 */
function initializeProcessModule() {
    console.log('index.js: initializeProcessModule STARTING...');
    console.log('index.js: typeof processModule at init start:', typeof processModule);
    if (typeof processModule !== 'undefined') {
        console.log('index.js: processModule keys at init start:', Object.keys(processModule));
        console.log('index.js: typeof processModule.processSinglePdf at init start:', typeof processModule.processSinglePdf);
    }

    Object.entries(processModule).forEach(([key, value]) => {
        if (value !== null) {
            window[key] = value;
        } else {
            // 在这里添加更详细的日志
            console.warn(`index.js: Function ${key} was not loaded correctly. Value is null.`);
            console.log(`index.js: Checking processModule.${key} again:`, processModule[key]);
        }
    });

    console.log("index.js: Process module loaded and functions exposed to global scope (initializeProcessModule ENDING)");
}

// 动态加载所有模块的脚本
/**
 * 动态加载所有 `process` 子模块的 JavaScript 文件。
 * 这种方式允许按需或延迟加载这些处理逻辑，而不是在页面初始加载时就全部引入。
 *
 * 主要步骤：
 * 1. **定义脚本列表**：`scripts` 数组包含所有需要加载的子模块脚本的路径。
 * 2. **计数器初始化**：`loaded` 变量用于跟踪已成功加载的脚本数量。
 * 3. **遍历并创建 script 标签**：
 *    - 对 `scripts` 数组中的每个路径：
 *      - 创建一个新的 `<script>` HTML 元素。
 *      - 设置其 `src` 属性为脚本路径。
 *      - **设置 `onload` 回调**：当脚本成功加载并执行后，`loaded` 计数器加一。
 *        如果 `loaded` 等于脚本总数，说明所有脚本都已加载完毕，此时调用 `initializeProcessModule()` 来完成模块的初始化和全局暴露。
 *      - **设置 `onerror` 回调**：如果脚本加载失败，在控制台打印错误信息。
 *      - 将创建的 `<script>` 标签追加到文档的 `<head>` 中，浏览器会自动开始加载和执行它。
 * 4. **开始加载**：函数最后调用自身，启动脚本加载过程。
 */
function loadProcessingScripts() {
    const scripts = [
        'js/process/utils.js',
        'js/process/ocr.js',
        'js/process/tables.js',
        'js/process/glossary-core.js',
        'js/process/translation.js',
        'js/process/document.js',
        'js/process/download.js',
        'js/process/main.js'
    ];

    let loaded = 0;

    scripts.forEach(src => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => {
            loaded++;
            if (loaded === scripts.length) {
                // 所有脚本加载完成，初始化模块
                initializeProcessModule();
            }
        };
        script.onerror = (err) => {
            console.error(`Failed to load script: ${src}`, err);
        };
        document.head.appendChild(script);
    });
}

// 开始加载脚本
loadProcessingScripts();
