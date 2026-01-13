// state.js - 全局状态变量

/**
 * @const {number} MAX_RETRIES
 * @description 单个文件处理失败时的最大重试次数。
 */
export const MAX_RETRIES = 3;

/**
 * @const {string}
 * @description 批量导出的默认命名模板。
 */
export const DEFAULT_BATCH_TEMPLATE = '{original_name}_{output_language}_{processing_time:YYYYMMDD-HHmmss}.{original_type}';

export const SUPPORTED_FILE_EXTENSIONS = ['pdf', 'md', 'txt', 'docx', 'pptx', 'html', 'htm', 'epub', 'yaml', 'yml', 'json', 'csv', 'ini', 'cfg', 'log', 'tex'];
export const SUPPORTED_ARCHIVE_EXTENSIONS = ['zip'];

/**
 * @type {File[]}
 * @description 存储用户选择的待处理文件列表。
 */
export let pdfFiles = [];

/**
 * @type {Array<Object>}
 * @description 存储所有文件处理后的结果对象。
 */
export let allResults = [];

/**
 * @type {Object}
 * @description 从 localStorage 加载的已处理文件记录。
 */
export let processedFilesRecord = {};

/**
 * @type {boolean}
 * @description 标记当前是否正在进行文件处理流程。
 */
export let isProcessing = false;

/**
 * @type {number}
 * @description 当前活动的（正在处理中的）文件数量。
 */
export let activeProcessingCount = 0;

/**
 * @type {Map<string, number>}
 * @description 记录每个文件当前的重试次数。
 */
export let retryAttempts = new Map();

/**
 * @type {boolean}
 * @description 用户是否开启批量模式的偏好设置。
 */
export let batchModeEnabled = false;

/**
 * @type {string}
 * @description 批量导出使用的命名模板。
 */
export let batchModeTemplate = DEFAULT_BATCH_TEMPLATE;

/**
 * @type {string[]}
 * @description 批量导出需要生成的格式集合。
 */
export let batchModeFormats = ['original', 'markdown'];

/**
 * @type {boolean}
 * @description 批量导出时是否强制打包为 ZIP。
 */
export let batchModeZipEnabled = false;

/**
 * @type {boolean}
 * @description 批量配置面板是否折叠。
 */
export let batchConfigCollapsed = true;

/**
 * @type {Set<string>}
 * @description 被排除的文件扩展名集合。
 */
export const excludedExtensions = new Set();

/**
 * @type {{id:string,total:number,template:string,formats:string[],outputLanguage:string,startedAt:string,counter:number}|null}
 * @description 当前批量处理的上下文信息。
 */
export let activeBatchSession = null;

// State setters
export function setPdfFiles(files) { pdfFiles = files; }
export function setAllResults(results) { allResults = results; }
export function setProcessedFilesRecord(record) { processedFilesRecord = record; }
export function setIsProcessing(processing) { isProcessing = processing; }
export function setActiveProcessingCount(count) { activeProcessingCount = count; }
export function setBatchModeEnabled(enabled) { batchModeEnabled = enabled; }
export function setBatchModeTemplate(template) { batchModeTemplate = template; }
export function setBatchModeFormats(formats) { batchModeFormats = formats; }
export function setBatchModeZipEnabled(enabled) { batchModeZipEnabled = enabled; }
export function setBatchConfigCollapsed(collapsed) { batchConfigCollapsed = collapsed; }
export function setActiveBatchSession(session) { activeBatchSession = session; }
