// process/index.js

// 创建一个包含所有将要导出函数的对象
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
function initializeProcessModule() {
    // 将所有模块函数挂载到全局window对象，以兼容app.js
    Object.entries(processModule).forEach(([key, value]) => {
        if (value !== null) {
            window[key] = value;
        } else {
            console.warn(`函数 ${key} 未能正确加载`);
        }
    });

    console.log("Process module loaded and functions exposed to global scope");
}

// 动态加载所有模块的脚本
function loadProcessingScripts() {
    const scripts = [
        'js/process/utils.js',
        'js/process/ocr.js',
        'js/process/tables.js',
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