// process/mineru-structured-translation.js
// MinerU 结构化翻译 - 基于 content_list.json 的批量翻译

/**
 * MinerU 结构化翻译管理器
 * 核心功能：
 * 1. 从 content_list.json 提取可翻译内容并分批（10个/批）
 * 2. 构建批量翻译提示词（复用现有的术语库和提示词池机制）
 * 3. 执行批量翻译并保留格式元数据
 */
class MinerUStructuredTranslation {
  constructor() {
    this.BATCH_SIZE = 10; // 每批处理的片段数量
  }

  /**
   * 检查是否支持结构化翻译
   * @param {Object} ocrResult - OCR 结果对象
   * @returns {boolean}
   */
  supportsStructuredTranslation(ocrResult) {
    if (!ocrResult || !ocrResult.metadata) return false;
    return ocrResult.metadata.engine === 'mineru' &&
           ocrResult.metadata.contentListJson &&
           ocrResult.metadata.supportsStructuredTranslation === true;
  }

  /**
   * 提取可翻译内容
   * @param {Array} contentList - content_list.json 数组
   * @returns {Array} 可翻译内容数组
   */
  extractTranslatableContent(contentList) {
    if (!Array.isArray(contentList)) {
      console.error('[MinerU Structured] contentList 不是数组');
      return [];
    }

    return contentList.map((item, index) => {
      const translatable = {
        id: this.generateId(item, index),
        type: item.type,
        bbox: item.bbox,
        page_idx: item.page_idx || 0,
        originalItem: item // 保存原始项以便后续重建
      };

      // 根据类型提取需要翻译的字段
      switch (item.type) {
        case 'text':
          translatable.text = item.text || item.content || '';
          translatable.text_level = item.text_level;
          break;

        case 'image':
          translatable.img_path = item.img_path || item.image_path || '';
          translatable.image_caption = item.image_caption || [];
          break;

        case 'formula':
          translatable.latex = item.latex || '';
          // 公式不翻译，但需要保留
          break;

        case 'table':
          translatable.table_caption = item.table_caption || '';
          translatable.table_data = item.table_data || '';
          // 表格数据不翻译，仅翻译标题
          break;

        default:
          translatable.text = item.text || item.content || '';
      }

      return translatable;
    });
  }

  /**
   * 分批处理内容
   * @param {Array} content - 可翻译内容数组
   * @returns {Array} 批次数组
   */
  splitIntoBatches(content) {
    if (!Array.isArray(content) || content.length === 0) {
      return [];
    }

    const batches = [];

    for (let i = 0; i < content.length; i += this.BATCH_SIZE) {
      batches.push({
        batchIndex: Math.floor(i / this.BATCH_SIZE),
        startIndex: i,
        endIndex: Math.min(i + this.BATCH_SIZE, content.length),
        items: content.slice(i, i + this.BATCH_SIZE),
        // 保留上一批的最后一项作为上下文（如果存在）
        context: i > 0 ? content[i - 1] : null
      });
    }

    return batches;
  }

  /**
   * 构建批量翻译提示词
   * @param {Object} batch - 批次数据
   * @param {string} targetLang - 目标语言
   * @param {string} baseSystemPrompt - 基础系统提示词（来自提示词池或默认）
   * @param {string} baseUserPromptTemplate - 基础用户提示词模板
   * @returns {Object} { systemPrompt, userPrompt }
   */
  buildBatchTranslationPrompt(batch, targetLang, baseSystemPrompt = '', baseUserPromptTemplate = '') {
    // 1. 构建上下文提示
    let contextHint = '';
    if (batch.context) {
      const contextText = this.formatContextItem(batch.context);
      if (contextText) {
        contextHint = `\n【上文参考】：${contextText}\n`;
      }
    }

    // 2. 构建结构化翻译规则
    const structuredRules = `

【结构化翻译规则】：
1. 输入是 JSON 数组格式的文档片段（共 ${batch.items.length} 个片段）
2. 仅翻译以下字段的内容：
   - "text"（文本内容）
   - "image_caption"（图片说明，数组格式）
   - "table_caption"（表格标题）
3. 以下字段**必须保持原样，不翻译**：
   - "type"（类型）
   - "bbox"（位置坐标）
   - "page_idx"（页码）
   - "latex"（LaTeX 公式）
   - "img_path"（图片路径）
   - "table_data"（表格数据）
   - "id", "text_level", "originalItem"（元数据字段）
4. 特殊处理：
   - 如果 type 是 "formula"，保留整个对象不变
   - 如果 type 是 "text" 且 text_level 为 1-3，说明是标题，注意翻译简洁性
   - 术语保持一致（专有名词、学术术语等）
5. 上下文连贯：
   - 考虑上文内容（如有），确保术语和表述一致
   - 保持段落间逻辑关系
6. **输出格式**：
   返回翻译后的完整 JSON 数组，结构与输入完全一致
   使用 JSON 代码块包裹：\`\`\`json\n...\n\`\`\``;

    // 3. 合并系统提示词
    const systemPrompt = (baseSystemPrompt || '你是一位专业的文档翻译助手。') +
                         contextHint +
                         structuredRules;

    // 4. 构建用户提示词
    const jsonContent = JSON.stringify(batch.items, null, 2);

    // 如果有用户提示词模板，使用它；否则使用默认模板
    let userPrompt;
    if (baseUserPromptTemplate && baseUserPromptTemplate.includes('${content}')) {
      userPrompt = baseUserPromptTemplate
        .replace(/\$\{targetLangName\}/g, targetLang)
        .replace(/\$\{content\}/g, `以下是需要翻译的 JSON 数组：\n\n\`\`\`json\n${jsonContent}\n\`\`\``);
    } else {
      userPrompt = `请将以下结构化文档片段翻译成${targetLang}。

**待翻译内容（JSON 格式）**：
\`\`\`json
${jsonContent}
\`\`\`

请严格按照上述规则返回翻译后的 JSON 数组。`;
    }

    return { systemPrompt, userPrompt };
  }

  /**
   * 格式化上下文项为文本
   * @param {Object} contextItem
   * @returns {string}
   */
  formatContextItem(contextItem) {
    if (!contextItem) return '';

    switch (contextItem.type) {
      case 'text':
        return contextItem.text || '';
      case 'image':
        if (Array.isArray(contextItem.image_caption) && contextItem.image_caption.length > 0) {
          return contextItem.image_caption.join(' ');
        }
        return '（图片）';
      case 'table':
        return contextItem.table_caption || '（表格）';
      case 'formula':
        return '（公式）';
      default:
        return '';
    }
  }

  /**
   * 执行批量翻译
   * @param {Array} batches - 分批后的内容
   * @param {string} targetLang - 目标语言
   * @param {string} model - 翻译模型
   * @param {string} apiKey - API Key
   * @param {Object} options - 额外选项
   * @param {Function} onProgress - 进度回调
   * @param {Function} acquireSlot - 获取并发槽位
   * @param {Function} releaseSlot - 释放并发槽位
   * @returns {Promise<Array>} 翻译后的完整内容数组
   */
  async translateBatches(batches, targetLang, model, apiKey, options = {}, onProgress, acquireSlot, releaseSlot) {
    const totalBatches = batches.length;
    let completedCount = 0;

    if (typeof addProgressLog === 'function') {
      addProgressLog(`[结构化翻译] 开始翻译 ${totalBatches} 个批次（共 ${batches.reduce((sum, b) => sum + b.items.length, 0)} 个片段）`);
    }

    // 并发翻译所有批次
    const translateBatch = async (batch, batchIndex) => {
      const logContext = `[批次 ${batchIndex + 1}/${totalBatches}]`;

      // 获取并发槽位
      if (typeof acquireSlot === 'function') {
        await acquireSlot();
      }

      try {
        // 1. 获取基础提示词（来自提示词池或默认）
        let baseSystemPrompt = '';
        let baseUserPromptTemplate = '';

        if (typeof window !== 'undefined' && window.promptPoolUI) {
          const poolPrompt = window.promptPoolUI.getPromptForTranslation();
          if (poolPrompt && poolPrompt.systemPrompt && poolPrompt.userPromptTemplate) {
            baseSystemPrompt = poolPrompt.systemPrompt;
            baseUserPromptTemplate = poolPrompt.userPromptTemplate;
            console.log(`${logContext} 使用提示词池的提示词`);
          }
        }

        // 如果没有提示词池，使用内置模板
        if (!baseSystemPrompt && typeof getBuiltInPrompts === 'function') {
          const prompts = getBuiltInPrompts(targetLang);
          baseSystemPrompt = prompts.systemPrompt;
          baseUserPromptTemplate = prompts.userPromptTemplate;
        }

        // 2. 构建批量翻译提示词
        const { systemPrompt, userPrompt } = this.buildBatchTranslationPrompt(
          batch,
          targetLang,
          baseSystemPrompt,
          baseUserPromptTemplate
        );

        // 3. 注入术语库（如果启用）
        let finalSystemPrompt = systemPrompt;
        try {
          const settings = (typeof loadSettings === 'function') ? loadSettings() : {};
          if (settings.enableGlossary && typeof getGlossaryMatchesForText === 'function') {
            // 合并所有批次项的文本进行术语匹配
            const batchText = batch.items.map(item => {
              if (item.type === 'text') return item.text || '';
              if (item.type === 'image' && Array.isArray(item.image_caption)) {
                return item.image_caption.join(' ');
              }
              if (item.type === 'table') return item.table_caption || '';
              return '';
            }).filter(Boolean).join('\n');

            const matches = getGlossaryMatchesForText(batchText);
            if (matches && matches.length > 0) {
              const instruction = (typeof buildGlossaryInstruction === 'function')
                ? buildGlossaryInstruction(matches, targetLang)
                : '';
              if (instruction) {
                finalSystemPrompt += '\n\n' + instruction;
                if (typeof addProgressLog === 'function') {
                  const names = matches.slice(0, 3).map(m => m.term).join(', ');
                  addProgressLog(`${logContext} 命中术语库 ${matches.length} 条：${names}${matches.length > 3 ? '...' : ''}`);
                }
              }
            }
          }
        } catch (e) {
          console.warn(`${logContext} 术语库注入失败:`, e);
        }

        // 4. 调用翻译 API
        if (typeof addProgressLog === 'function') {
          addProgressLog(`${logContext} 正在翻译 ${batch.items.length} 个片段...`);
        }

        const translatedJson = await this.callTranslationAPI(
          finalSystemPrompt,
          userPrompt,
          model,
          apiKey,
          options
        );

        // 5. 解析并验证翻译结果
        const translatedItems = this.parseTranslationResponse(translatedJson);

        if (!this.validateTranslation(batch.items, translatedItems)) {
          throw new Error('翻译结果结构不匹配');
        }

        // 6. 更新进度
        completedCount++;
        onProgress?.({
          current: completedCount,
          total: totalBatches,
          percentage: Math.floor((completedCount / totalBatches) * 100),
          message: `已完成 ${completedCount}/${totalBatches} 批次`
        });

        if (typeof addProgressLog === 'function') {
          addProgressLog(`${logContext} 翻译完成`);
        }

        return { batchIndex, items: translatedItems };

      } catch (error) {
        console.error(`${logContext} 翻译失败:`, error);
        if (typeof addProgressLog === 'function') {
          addProgressLog(`${logContext} 翻译失败: ${error.message}，将使用原文`);
        }
        // 回退：使用原文
        return { batchIndex, items: batch.items };
      } finally {
        // 释放并发槽位
        if (typeof releaseSlot === 'function') {
          releaseSlot();
        }
      }
    };

    // 并发执行所有批次翻译
    const batchPromises = batches.map((batch, index) => translateBatch(batch, index));
    const batchResults = await Promise.all(batchPromises);

    // 按批次索引排序，确保结果顺序正确
    batchResults.sort((a, b) => a.batchIndex - b.batchIndex);

    // 合并所有翻译结果
    const results = [];
    for (const result of batchResults) {
      results.push(...result.items);
    }

    return results;
  }

  /**
   * 调用翻译 API
   * @param {string} systemPrompt
   * @param {string} userPrompt
   * @param {string} model
   * @param {string} apiKey
   * @param {Object} options
   * @returns {Promise<string>}
   */
  async callTranslationAPI(systemPrompt, userPrompt, model, apiKey, options = {}) {
    // 复用 translation.js 的配置构建逻辑
    if (typeof processModule === 'undefined' ||
        typeof processModule.buildPredefinedApiConfig !== 'function' ||
        typeof processModule.buildCustomApiConfig !== 'function') {
      throw new Error('translation.js 尚未加载');
    }

    if (typeof callTranslationApi !== 'function') {
      throw new Error('callTranslationApi 函数不可用');
    }

    console.log('[MinerU Structured] callTranslationAPI 调用参数:', {
      model,
      hasApiKey: !!apiKey,
      options,
      hasModelConfig: !!(options && options.modelConfig),
      modelConfig: options ? options.modelConfig : null
    });

    // 构建 API 配置
    let apiConfig;
    if (model === 'custom') {
      const modelConfig = options.modelConfig;

      // 修复：支持 apiBaseUrl 或 apiEndpoint
      const apiEndpoint = modelConfig && (modelConfig.apiEndpoint || modelConfig.apiBaseUrl);
      const modelId = modelConfig && modelConfig.modelId;

      console.log('[MinerU Structured] 自定义模型配置检查:', {
        hasModelConfig: !!modelConfig,
        hasApiEndpoint: !!apiEndpoint,
        hasModelId: !!modelId,
        modelConfig
      });

      if (!modelConfig || !apiEndpoint || !modelId) {
        console.error('[MinerU Structured] 自定义模型配置不完整!', {
          modelConfig,
          options,
          apiEndpoint,
          modelId
        });
        throw new Error('自定义模型配置不完整');
      }
      apiConfig = processModule.buildCustomApiConfig(
        apiKey,
        apiEndpoint,
        modelId,
        modelConfig.requestFormat || 'openai',
        modelConfig.temperature !== undefined ? modelConfig.temperature : 0.5,
        modelConfig.max_tokens !== undefined ? modelConfig.max_tokens : 8000,
        { endpointMode: modelConfig.endpointMode || 'auto' }
      );
    } else {
      // 预设模型 - 从 translation.js 获取配置
      const settings = typeof loadSettings === 'function' ? loadSettings() : {};
      const temperature = (settings.customModelSettings && settings.customModelSettings.temperature) || 0.5;
      const maxTokens = (settings.customModelSettings && settings.customModelSettings.max_tokens) || 8000;

      // 简化：仅支持常用模型
      const predefinedConfigs = {
        'deepseek': {
          endpoint: 'https://api.deepseek.com/v1/chat/completions',
          modelName: 'DeepSeek',
          headers: { 'Content-Type': 'application/json' },
          bodyBuilder: (sys, user) => ({
            model: 'deepseek-chat',
            messages: [{ role: "system", content: sys }, { role: "user", content: user }],
            temperature,
            max_tokens: maxTokens
          }),
          responseExtractor: (data) => data?.choices?.[0]?.message?.content
        },
        'mistral': {
          endpoint: 'https://api.mistral.ai/v1/chat/completions',
          modelName: 'Mistral Large',
          headers: { 'Content-Type': 'application/json' },
          bodyBuilder: (sys, user) => ({
            model: 'mistral-large-latest',
            messages: [{ role: "system", content: sys }, { role: "user", content: user }],
            temperature,
            max_tokens: maxTokens
          }),
          responseExtractor: (data) => data?.choices?.[0]?.message?.content
        }
      };

      if (!predefinedConfigs[model]) {
        throw new Error(`不支持的翻译模型: ${model}`);
      }

      apiConfig = processModule.buildPredefinedApiConfig(predefinedConfigs[model], apiKey);
    }

    // 构建请求体
    const requestBody = apiConfig.bodyBuilder
      ? apiConfig.bodyBuilder(systemPrompt, userPrompt)
      : {
          model: apiConfig.modelName,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        };

    // 调用API
    const result = await callTranslationApi(apiConfig, requestBody);
    return result;
  }

  /**
   * 解析翻译响应（提取 JSON）
   * @param {string} response
   * @returns {Array}
   */
  parseTranslationResponse(response) {
    if (!response || typeof response !== 'string') {
      throw new Error('翻译响应为空或不是文本');
    }

    // 尝试提取 JSON 代码块
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (e) {
        console.error('JSON 解析失败（代码块内容）:', e);
      }
    }

    // 尝试直接解析
    try {
      return JSON.parse(response);
    } catch (e) {
      console.error('JSON 解析失败（直接解析）:', e);
      throw new Error('无法解析翻译结果为 JSON 格式');
    }
  }

  /**
   * 验证翻译结果
   * @param {Array} original
   * @param {Array} translated
   * @returns {boolean}
   */
  validateTranslation(original, translated) {
    if (!Array.isArray(original) || !Array.isArray(translated)) {
      console.error('[MinerU Structured] 验证失败：输入不是数组');
      return false;
    }

    if (original.length !== translated.length) {
      console.error('[MinerU Structured] 验证失败：长度不一致', original.length, translated.length);
      return false;
    }

    // 验证每个元素的关键字段
    for (let i = 0; i < original.length; i++) {
      const orig = original[i];
      const trans = translated[i];

      if (orig.type !== trans.type) {
        console.error(`[MinerU Structured] 验证失败：索引 ${i} 的 type 不匹配`);
        return false;
      }

      if (orig.page_idx !== trans.page_idx) {
        console.error(`[MinerU Structured] 验证失败：索引 ${i} 的 page_idx 不匹配`);
        return false;
      }

      // bbox 可能在翻译过程中被保留或丢失，宽松验证
      if (orig.bbox && trans.bbox && JSON.stringify(orig.bbox) !== JSON.stringify(trans.bbox)) {
        console.warn(`[MinerU Structured] 警告：索引 ${i} 的 bbox 不完全匹配`);
      }
    }

    return true;
  }

  /**
   * 生成唯一 ID
   * @param {Object} item
   * @param {number} index
   * @returns {string}
   */
  generateId(item, index) {
    const page = item.page_idx || 0;
    const bbox = item.bbox ? item.bbox.join('_') : 'nobbox';
    return `p${page}_${bbox}_${index}`;
  }

  /**
   * 延迟函数
   * @param {number} ms
   * @returns {Promise}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 重建 Markdown（可选功能，暂不实现）
   * 如果需要基于翻译后的 JSON 重新生成 Markdown，可在此实现
   */
  rebuildMarkdown(translatedContent) {
    // TODO: 实现 Markdown 重建逻辑
    // 目前直接使用原始的 markdown，仅在元数据中保存翻译后的 JSON
    return null;
  }
}

// 导出到全局
if (typeof window !== 'undefined') {
  window.MinerUStructuredTranslation = MinerUStructuredTranslation;
}

// 模块化导出
if (typeof processModule !== 'undefined') {
  processModule.MinerUStructuredTranslation = MinerUStructuredTranslation;
}
