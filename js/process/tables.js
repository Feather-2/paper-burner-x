// process/tables.js

/**
 * 在翻译前对Markdown表格进行特殊处理，将其替换为占位符，以确保表格结构在翻译过程中保持完整性。
 *
 * 主要步骤：
 * 1. **预处理**：
 *    - 标准化换行符为 `\n`。
 *    - 移除每行表格前可能存在的影响识别的行首空格或制表符。
 * 2. **表格边界检测**：
 *    - 使用更可靠的方法检测表格：寻找连续的表格行（包括表头、分隔行和数据行）。
 *    - 定义表格行 (`tableRowRegex`) 和表格分隔行 (`tableSepRegex`) 的正则表达式。
 *    - 扫描文本行，识别潜在的表格标题（以 "TABLE", "Table", "表" 开头且下一行是表格行的行）。
 * 3. **表格范围确定**：
 *    - 遍历文本行，标记表格的开始和结束行号，存入 `tableRanges`。
 *    - 考虑最小有效表格行数 (`minTableRows`)，避免将非表格内容误认为表格。
 *    - 如果表格前有识别到的标题，则将标题行也包含在表格范围内。
 *    - 特殊处理文档末尾的表格。
 * 4. **合并相邻表格**：
 *    - 遍历 `tableRanges`，如果两个表格范围相邻或仅由空行/特定注释行隔开，则将它们合并为一个范围。
 *      这有助于处理因 Markdown 解析不完美或原始文档格式问题导致的表格被错误分割的情况。
 * 5. **提取表格并替换为占位符**：
 *    - 从后向前遍历 `tableRanges`（避免替换影响后续行号的准确性）。
 *    - 对每个表格范围，提取其完整的 Markdown 内容。
 *    - 生成唯一的占位符，如 `__TABLE_PLACEHOLDER_0__`。
 *    - 将原始表格内容存储在 `tablePlaceholders` 对象中，键为占位符，值为表格 Markdown 文本。
 *    - 在原始文本 (`processedText`) 中，用占位符替换掉实际的表格内容。
 *    - 同时更新 `lines` 数组（用于内部处理），将表格内容替换为占位符，以便后续步骤的正确索引。
 * 6. **返回结果**：返回一个对象，包含：
 *    - `processedText`：表格已被占位符替换的 Markdown 文本。
 *    - `tablePlaceholders`：一个映射对象，键是占位符，值是对应的原始表格 Markdown 内容。
 *
 * @param {string} markdown - 原始的 Markdown 文本内容。
 * @returns {Object} 一个包含两部分的对象：
 *                   `{ processedText: string, tablePlaceholders: Object }`。
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
 * 从大语言模型翻译返回的文本中提取并清理出 Markdown 表格内容。
 * 模型返回的表格有时可能被包裹在代码块中，或者包含额外的解释性文字，此函数旨在尽可能准确地提取核心表格。
 *
 * 主要步骤：
 * 1. **初步清理**：移除字符串首尾的空格。
 * 2. **移除代码块标记**：如果文本以 ` ``` `开始和结束，则移除这些标记。
 *    - 如果代码块内部有语言标识 (如 `markdown` 或 `md`)，也一并移除。
 * 3. **提取潜在表格标题**：检查清理后文本的第一行是否以 "TABLE" 或 "表" 开头，如果是，则将其视为表格标题并暂存。
 * 4. **提取表格行**：
 *    - 遍历剩余的文本行。
 *    - 如果一行以 `|` 开头，则认为进入了表格内容，将其加入 `tableLines` 数组。
 *    - 如果已在表格内部，但当前行不以 `|` 开头：
 *      - 若该行为空行或包含表格分隔符特征 (`---`)，则仍视为表格的一部分。
 *      - 否则，认为表格内容结束。
 * 5. **组合结果**：将提取到的标题行（如果有）和表格行重新组合成完整的表格 Markdown 文本。
 * 6. **返回结果**：如果成功提取到表格内容，则返回该内容；否则返回 `null`。
 *
 * @param {string} translatedText - 从翻译 API 收到的原始响应文本，可能包含表格。
 * @returns {string|null} 清理并提取出的 Markdown 表格文本。如果未找到有效表格结构，则返回 `null`。
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
 * 在翻译后的文本中恢复 Markdown 表格，并将原始表格内容（存储在占位符中的）进行翻译后再替换回去。
 * 此函数旨在确保表格结构在整个翻译流程中保持不变，同时表格内的文本得到正确翻译。
 *
 * 主要步骤：
 * 1. **收集待翻译表格**：遍历 `tablePlaceholders` 对象，将每个占位符及其对应的原始表格内容收集到 `tablesToTranslate` 数组中。
 * 2. **批量翻译表格 (如果提供了 API 配置)**：
 *    - 检查是否提供了 `apiConfig` 和 `targetLang`。如果未提供或没有需要翻译的表格，则跳过翻译步骤，直接用原始表格替换占位符。
 *    - **构建专用提示词**：为表格翻译创建特定的系统提示 (`tableSystemPrompt`) 和用户提示 (`tableUserPrompt`)。
 *      这些提示词强调保持表格结构（分隔符 `|`, 对齐标记 `:--:`, 行列数, 数学公式等）不变，仅翻译文本内容。
 *    - **逐个翻译表格**：
 *      - 对 `tablesToTranslate` 中的每个表格：
 *        - 使用 `apiConfig.bodyBuilder` 构建请求体。
 *        - 调用 `callTranslationApi` 发送翻译请求。
 *        - 使用 `extractTableFromTranslation` 从翻译结果中提取并清理表格内容。
 *        - 如果成功提取到翻译后的表格 (`cleanedTable`)，则在主文本 (`result`) 中用它替换掉对应的占位符。
 *        - 如果提取失败或翻译出错，则记录警告/错误，并使用原始表格内容替换占位符作为兜底。
 * 3. **直接恢复原始表格 (如果未提供 API 配置或无表格)**：
 *    - 如果跳过了翻译步骤，则直接遍历 `tablePlaceholders`，用原始表格内容替换主文本中的占位符。
 * 4. **返回结果**：返回已恢复（并可能已翻译）表格的完整 Markdown 文本。
 *
 * @param {string} translatedText - 包含表格占位符的、已经过初步翻译的 Markdown 文本。
 * @param {Object} tablePlaceholders - 一个对象，键是表格占位符 (如 `__TABLE_PLACEHOLDER_0__`)，值是对应的原始表格 Markdown 内容。
 * @param {Object} [apiConfig=null] - (可选) 用于翻译表格的 API 配置对象。如果为 `null`，表格将不被翻译，直接用原文恢复。
 * @param {string} [targetLang=null] - (可选) 目标翻译语言。与 `apiConfig` 一同提供时用于翻译表格。
 * @param {string} [model=null] - (可选, 未直接使用，但暗示了 apiConfig 的来源) 使用的模型名称。
 * @param {string} [apiKey=null] - (可选, 未直接使用，但暗示了 apiConfig 的来源) API 密钥。
 * @param {string} [logContext=""] - (可选) 日志记录的上下文前缀。
 * @returns {Promise<string>} 已恢复表格（内容可能已翻译）的 Markdown 文本。
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
 * 诊断并尝试修复 Markdown 表格的常见格式问题。
 * 此函数主要关注表头与分隔行的一致性，以及数据行列数与表头的一致性。
 *
 * 主要步骤：
 * 1. **预处理**：按行分割表格内容，移除空行和行首尾空格。
 * 2. **基本检查**：如果行数少于3行（表头、分隔、至少一行数据），则认为不是有效表格或过于简单，直接返回原内容。
 * 3. **表头分析**：分割表头行，计算列数 (`columnCount`)。
 * 4. **分隔行修复**：
 *    - 检查分隔行 (`lines[1]`) 是否包含必要的 `-` 和 `|` 字符。
 *    - 如果格式明显错误（如缺少 `-`），则根据 `columnCount` 生成一个标准的分隔行 (`| --- | --- | ... |`) 并替换原分隔行。
 *    - 如果格式基本正确，但其单元格数量与表头不匹配，也重新生成标准分隔行并替换。
 * 5. **数据行修复**：
 *    - 遍历从第三行开始的所有数据行。
 *    - 分割每行数据，计算其单元格数量。
 *    - 如果单元格数量与 `columnCount` 不匹配，则尝试通过添加或截断单元格来修复该行，使其列数与表头一致。
 *      （当前实现是补齐空单元格 `| |`）。
 * 6. **返回结果**：返回修复后的表格内容（行通过 `\n` 连接）。
 *
 * @param {string} tableContent - 存在格式问题的 Markdown 表格文本。
 * @returns {string} 尝试修复后的 Markdown 表格文本。
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
 * 尝试修复并验证 Markdown 表格的格式，特别是处理对齐标记行错位的问题。
 * 此函数首先调用 `diagnoseAndFixTableFormat` 进行初步的格式修复，
 * 然后专门检查是否存在多行对齐标记或对齐标记行不在第二行（分隔行）的情况。
 *
 * 主要步骤：
 * 1. **初步修复**：调用 `diagnoseAndFixTableFormat(tableContent)` 对表格进行基础的格式修正。
 * 2. **对齐标记行检查**：
 *    - 将修复后的表格按行分割，并过滤掉空行。
 *    - 查找所有包含对齐标记（`:--:`, `:--`, `--:`）的行 (`alignmentLines`)。
 *    - **错位处理**：如果找到了对齐标记行，并且表格的第二行（预期的分隔行位置）并不包含连字符 `-`（表明它可能不是一个正常的分隔行）：
 *      - 找到第一个包含对齐标记的行的索引 (`alignmentLineIndex`)。
 *      - 如果该对齐标记行不在第二行 (`alignmentLineIndex > 1`)，则将其移动到第二行的位置，即先删除原来的对齐标记行，然后在第二行处插入它。
 * 3. **返回结果**：返回经过上述处理（可能被进一步修复）的表格 Markdown 文本。
 *
 * @param {string} tableContent - 可能包含格式问题（尤其是对齐标记错位）的 Markdown 表格文本。
 * @returns {string} 修复后的 Markdown 表格文本。
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