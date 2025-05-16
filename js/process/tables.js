// process/tables.js

/**
 * 在翻译前对Markdown表格进行特殊处理，确保表格在翻译过程中保持完整性
 * @param {string} markdown - 原始Markdown文本
 * @returns {Object} 处理后的文本及表格映射
 */
function protectMarkdownTables(markdown) {
    // 预处理：标准化换行符并确保每行表格前没有空格影响识别
    let normalizedMarkdown = markdown.replace(/\r\n/g, '\n').replace(/^[ \t]+(\|[\s\S]+)$/gm, '$1');

    // 首先检测所有表格边界
    // 使用一种更可靠的表格检测方法：寻找连续的表格行（包括表头、分隔行和数据行）

    // 表格相关的正则表达式
    const tableRowRegex = /^\s*\|.*\|\s*$/;  // 表格行: | 内容 |
    const tableSepRegex = /^\s*\|[\s\-:]+\|\s*$/;  // 表格分隔行: | --:-- |

    // 按行分割文本
    const lines = normalizedMarkdown.split('\n');
    const tableRanges = [];  // 存储表格的范围 [开始行, 结束行]

    // 查找所有可能的表格标题
    const tableTitles = {};  // 行号 -> 标题文本
    for (let i = 0; i < lines.length; i++) {
        if ((lines[i].trim().startsWith('TABLE') ||
             lines[i].trim().startsWith('Table') ||
             lines[i].trim().startsWith('表')) &&
            i < lines.length - 1 &&
            tableRowRegex.test(lines[i+1])) {
            tableTitles[i] = lines[i];
        }
    }

    // 扫描查找所有表格的范围
    let inTable = false;
    let tableStart = -1;
    let minTableRows = 3;  // 最小的有效表格行数

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isTableRow = tableRowRegex.test(line);

        if (!inTable && isTableRow) {
            // 找到表格开始
            tableStart = i;
            inTable = true;
        } else if (inTable && !isTableRow) {
            // 找到表格结束
            if (i - tableStart >= minTableRows) {
                // 表格有足够多的行，是有效表格
                // 检查是否有表格标题
                const titleIndex = tableStart - 1;
                if (tableTitles[titleIndex]) {
                    tableRanges.push([titleIndex, i - 1]);
                    delete tableTitles[titleIndex]; // 已使用此标题
                } else {
                    tableRanges.push([tableStart, i - 1]);
                }
            }
            inTable = false;
            tableStart = -1;
        }
    }

    // 处理文档尾部的表格
    if (inTable && lines.length - tableStart >= minTableRows) {
        const titleIndex = tableStart - 1;
        if (tableTitles[titleIndex]) {
            tableRanges.push([titleIndex, lines.length - 1]);
            delete tableTitles[titleIndex];
        } else {
            tableRanges.push([tableStart, lines.length - 1]);
        }
    }

    // 合并相邻的表格（处理错误分割的表格）
    if (tableRanges.length > 1) {
        const mergedRanges = [tableRanges[0]];
        for (let i = 1; i < tableRanges.length; i++) {
            const lastRange = mergedRanges[mergedRanges.length - 1];
            const currentRange = tableRanges[i];

            // 检查两个表格是否相邻或只隔了一个空行或注释行
            if (currentRange[0] - lastRange[1] <= 2) {
                // 检查中间行是否为注释行或空行
                const middleLines = lines.slice(lastRange[1] + 1, currentRange[0]);
                const areAllMiddleLinesNonTable = middleLines.every(line => {
                    return line.trim() === '' ||
                           line.trim().startsWith('^') ||
                           line.trim().startsWith('*') ||
                           line.trim().startsWith('$') ||
                           /^\s*\[\^\d+\]:/.test(line.trim()) ||
                           line.trim().match(/^[a-zA-Z]?\s*\{\s*\^\s*[a-z]+\s*\}/) ||
                           line.trim().match(/^\$\{\s*\^\s*\\?[a-z]+\s*\}\$/);
                });

                if (areAllMiddleLinesNonTable) {
                    // 合并这两个表格范围
                    lastRange[1] = currentRange[1];
                } else {
                    mergedRanges.push(currentRange);
                }
            } else {
                mergedRanges.push(currentRange);
            }
        }
        tableRanges.length = 0;
        tableRanges.push(...mergedRanges);
    }

    // 提取表格并替换为占位符
    let tableCounter = 0;
    const tablePlaceholders = {};
    let processedText = normalizedMarkdown;

    // 从后向前处理，避免替换影响索引
    for (let i = tableRanges.length - 1; i >= 0; i--) {
        const [start, end] = tableRanges[i];
        const tableLines = lines.slice(start, end + 1);
        const tableContent = tableLines.join('\n');

        // 生成占位符
        const placeholder = `__TABLE_PLACEHOLDER_${tableCounter}__`;
        tablePlaceholders[placeholder] = tableContent;
        tableCounter++;

        // 替换原文中的表格内容
        const beforeTable = lines.slice(0, start).join('\n');
        const afterTable = lines.slice(end + 1).join('\n');
        processedText = beforeTable + (beforeTable ? '\n' : '') +
                        placeholder +
                        (afterTable ? '\n' : '') + afterTable;

        // 更新lines数组，以便后续处理
        lines.splice(start, end - start + 1, placeholder);
    }

    // 为日志添加识别结果
    console.log(`表格识别完成：找到 ${tableCounter} 个表格`);

    return {
        processedText,
        tablePlaceholders
    };
}

/**
 * 从翻译结果中提取表格内容并清理
 * @param {string} translatedText - 翻译后的原始文本
 * @returns {string|null} 提取出的表格文本，如果没有找到则返回null
 */
function extractTableFromTranslation(translatedText) {
    // 清理可能的引号或代码块
    let cleanedText = translatedText.trim();

    // 移除可能的代码块标记
    if (cleanedText.startsWith('```') && cleanedText.endsWith('```')) {
        cleanedText = cleanedText.substring(3, cleanedText.length - 3).trim();

        // 可能的语言标识
        if (cleanedText.startsWith('markdown') || cleanedText.startsWith('md')) {
            cleanedText = cleanedText.substring(cleanedText.indexOf('\n')).trim();
        }
    }

    // 检查是否有表格标题 - 以TABLE或表开头的行
    let titleLine = '';
    const lines = cleanedText.split('\n');
    const firstLine = lines[0].trim();
    if (firstLine.startsWith('TABLE') || firstLine.startsWith('表')) {
        titleLine = lines.shift();
    }

    // 提取表格内容 - 以|开头的连续行
    const tableLines = [];
    let inTable = false;

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('|')) {
            inTable = true;
            tableLines.push(line);
        } else if (inTable) {
            // 如果已经在表格内，但当前行不以|开头，检查是否是表格分隔行或空行
            if (trimmedLine === '' || trimmedLine.includes('---')) {
                tableLines.push(line);
            } else {
                // 真正的非表格内容，表格结束
                inTable = false;
            }
        }
    }

    // 组合标题和表格内容
    const result = titleLine ? (titleLine + '\n' + tableLines.join('\n')) : tableLines.join('\n');
    return result.length > 0 ? result : null;
}

/**
 * 在翻译后恢复Markdown表格，并翻译表格内容但保持表格结构
 * @param {string} translatedText - 翻译后的文本
 * @param {Object} tablePlaceholders - 表格占位符映射
 * @returns {Promise<string>} 恢复了表格的文本
 */
async function restoreMarkdownTables(translatedText, tablePlaceholders, apiConfig = null, targetLang = null, model = null, apiKey = null, logContext = "") {
    let result = translatedText;
    const tablesToTranslate = [];

    // 第一步：收集所有需要翻译的表格
    for (const [placeholder, tableContent] of Object.entries(tablePlaceholders)) {
        tablesToTranslate.push({
            placeholder,
            content: tableContent
        });
    }

    // 第二步：批量翻译所有表格（如果提供了API配置）
    if (apiConfig && targetLang && tablesToTranslate.length > 0) {
        if (typeof addProgressLog === "function") {
            addProgressLog(`${logContext} 准备翻译 ${tablesToTranslate.length} 个表格...`);
        }

        // 为表格翻译构建专门的系统提示词
        const tableSystemPrompt = `你是一个精确翻译表格的助手。请将表格翻译成${targetLang}，严格保持以下格式要求：
1. 保持所有表格分隔符（|）和结构完全不变
2. 保持表格对齐标记（:--:、:--、--:）不变
3. 保持表格的行数和列数完全一致
4. 保持数学公式、符号和百分比等专业内容不变
5. 翻译表格标题（如有）和表格内的文本内容
6. 表格内容与表格外内容要明确区分`;

        for (let i = 0; i < tablesToTranslate.length; i++) {
            const table = tablesToTranslate[i];
            try {
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logContext} 正在翻译第 ${i+1}/${tablesToTranslate.length} 个表格...`);
                }

                // 用户提示词
                const tableUserPrompt = `请将以下Markdown表格翻译成${targetLang}，请确保完全保持表格结构和格式：

${table.content}

注意：请保持表格格式完全不变，包括所有的 | 符号、对齐标记、数学公式和符号。`;

                // 构建请求体
                const requestBody = apiConfig.bodyBuilder
                    ? apiConfig.bodyBuilder(tableSystemPrompt, tableUserPrompt)
                    : {
                        model: apiConfig.modelName,
                        messages: [
                            { role: "system", content: tableSystemPrompt },
                            { role: "user", content: tableUserPrompt }
                        ]
                    };

                // 调用API翻译表格
                const translatedTable = await callTranslationApi(apiConfig, requestBody);

                // 提取和清理翻译结果中的表格部分
                const cleanedTable = extractTableFromTranslation(translatedTable);

                if (cleanedTable) {
                    // 替换原始占位符为翻译后的表格
                    result = result.replace(table.placeholder, cleanedTable);
                } else {
                    // 如果没有提取到表格，使用原始表格
                    console.warn(`${logContext} 无法从翻译结果中提取表格结构，将使用原始表格`);
                    result = result.replace(table.placeholder, table.content);
                }
            } catch (tableError) {
                console.error(`表格翻译失败:`, tableError);
                if (typeof addProgressLog === "function") {
                    addProgressLog(`${logContext} 表格 ${i+1} 翻译失败: ${tableError.message}，将使用原表格`);
                }
                // 如果翻译失败，使用原表格
                result = result.replace(table.placeholder, table.content);
            }
        }
    } else {
        // 没有提供翻译配置，直接恢复原表格
        for (const [placeholder, tableContent] of Object.entries(tablePlaceholders)) {
            result = result.replace(placeholder, tableContent);
        }
    }

    return result;
}

/**
 * 诊断和修复表格格式问题
 * @param {string} tableContent - 表格内容
 * @returns {string} 修复后的表格内容
 */
function diagnoseAndFixTableFormat(tableContent) {
    // 按行分割表格
    const lines = tableContent.split('\n').map(l => l.trim()).filter(l => l);

    if (lines.length < 3) {
        console.log("表格行数不足");
        return tableContent; // 行数不足，可能不是表格
    }

    // 检查第一行（表头）
    const headerRow = lines[0];
    const headerCells = headerRow.split('|').filter(cell => cell.trim() !== '');
    const columnCount = headerCells.length;

    // 检查第二行（分隔行）
    const separatorRow = lines[1];
    // 如果分隔行不包含足够的"-"，可能是格式错误
    if (!separatorRow.includes('-') || !separatorRow.includes('|')) {
        console.log("分隔行格式错误，尝试修复");

        // 创建正确的分隔行
        let newSeparatorRow = '|';
        for (let i = 0; i < columnCount; i++) {
            newSeparatorRow += ' --- |';
        }

        // 插入新的分隔行
        lines.splice(1, 1, newSeparatorRow);
    } else {
        // 检查分隔行的列数是否与表头匹配
        const separatorCells = separatorRow.split('|').filter(cell => cell.trim() !== '');
        if (separatorCells.length !== columnCount) {
            console.log("分隔行列数与表头不匹配，尝试修复");

            // 创建正确的分隔行
            let newSeparatorRow = '|';
            for (let i = 0; i < columnCount; i++) {
                newSeparatorRow += ' --- |';
            }

            // 替换分隔行
            lines.splice(1, 1, newSeparatorRow);
        }
    }

    // 检查并修复所有数据行
    for (let i = 2; i < lines.length; i++) {
        const dataRow = lines[i];
        const dataCells = dataRow.split('|').filter(cell => cell.trim() !== '');

        // 如果数据行的列数与表头不匹配，进行修复
        if (dataCells.length !== columnCount) {
            console.log(`行 ${i+1} 列数与表头不匹配，尝试修复`);

            // 创建正确的数据行
            let newDataRow = '|';
            for (let j = 0; j < columnCount; j++) {
                newDataRow += (j < dataCells.length ? ` ${dataCells[j].trim()} |` : ' |');
            }

            // 替换数据行
            lines.splice(i, 1, newDataRow);
        }
    }

    return lines.join('\n');
}

/**
 * 修复并验证表格格式
 * @param {string} tableContent - 表格内容
 * @returns {string} 修复后的表格内容
 */
function fixTableFormat(tableContent) {
    // 先尝试基本的修复
    let fixedTable = diagnoseAndFixTableFormat(tableContent);

    // 检测是否有特殊的对齐标记行放在错误位置的情况
    const lines = fixedTable.split('\n').map(l => l.trim()).filter(l => l);

    // 检查是否有多行包含对齐标记
    const alignmentLines = lines.filter(line =>
        line.includes(':--:') || line.includes(':--') || line.includes('--:')
    );

    if (alignmentLines.length > 0 && !lines[1].includes('-')) {
        // 找到第一个包含对齐标记的行
        const alignmentLineIndex = lines.findIndex(line =>
            line.includes(':--:') || line.includes(':--') || line.includes('--:')
        );

        if (alignmentLineIndex > 1) {
            // 移动对齐行到正确位置
            const alignmentLine = lines[alignmentLineIndex];
            lines.splice(alignmentLineIndex, 1);
            lines.splice(1, 0, alignmentLine);

            fixedTable = lines.join('\n');
        }
    }

    return fixedTable;
}

// 将函数添加到processModule对象
if (typeof processModule !== 'undefined') {
    processModule.protectMarkdownTables = protectMarkdownTables;
    processModule.extractTableFromTranslation = extractTableFromTranslation;
    processModule.restoreMarkdownTables = restoreMarkdownTables;
    processModule.diagnoseAndFixTableFormat = diagnoseAndFixTableFormat;
    processModule.fixTableFormat = fixTableFormat;
}