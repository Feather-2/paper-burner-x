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
    this.MAX_RETRIES = 2; // 批次调用最大重试次数（指数退避）
    this.RETRY_BASE_DELAY = 800; // 初始重试延迟(ms)
    // 注意：不再使用 failedItems 数组，失败项由 main.js 从 translatedContentList 统一收集
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
2. 每个片段只包含必要字段：
   - "id"（唯一标识符，必须保持不变）
   - "type"（类型，必须保持不变）
   - 需要翻译的字段（根据类型而定）
3. 翻译规则：
   - type="text"：翻译 "text" 字段的内容
   - type="image"：翻译 "image_caption" 数组中的内容
   - type="table"：翻译 "table_caption" 字段的内容
   - type="formula"：无需翻译，保持原样即可
4. 翻译要求：
   - 术语保持一致（专有名词、学术术语等）
   - 考虑上文内容（如有），确保术语和表述一致
   - 保持段落间逻辑关系
5. **JSON 格式要求（极其重要）**：
   - 字符串中的特殊字符必须正确转义：
     * 双引号：使用 \\"
     * 换行符：使用 \\n
     * 制表符：使用 \\t
     * 反斜杠：使用 \\\\
   - 确保输出是**合法的 JSON 格式**，可以被 JSON.parse() 解析
6. **输出格式**：
   - 返回翻译后的完整 JSON 数组，结构与输入完全一致
   - 使用 JSON 代码块包裹：\`\`\`json\n...\n\`\`\`
   - **id 和 type 字段必须与输入完全一致**`;

    // 3. 合并系统提示词
    const systemPrompt = (baseSystemPrompt || '你是一位专业的文档翻译助手。') +
                         contextHint +
                         structuredRules;

    // 4. 构建用户提示词 - 只提取必要字段发送给AI
    // 简化数据结构，减少token消耗和JSON解析错误
    const simplifiedItems = batch.items.map(item => {
      const simplified = {
        id: item.id,
        type: item.type
      };

      // 根据类型提取需要翻译的字段
      if (item.type === 'text') {
        simplified.text = item.text || '';
      } else if (item.type === 'image' && Array.isArray(item.image_caption)) {
        simplified.image_caption = item.image_caption;
      } else if (item.type === 'table') {
        if (item.table_caption) simplified.table_caption = item.table_caption;
      }
      // formula类型不需要翻译任何内容

      return simplified;
    });

    const jsonContent = JSON.stringify(simplifiedItems, null, 2);

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
      let boundPrompt = null; // 移到外层，以便 catch 块可以访问
      let apiStartTime = 0; // 移到外层，以便 catch 块可以访问

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
          if (poolPrompt && poolPrompt.id && poolPrompt.systemPrompt && poolPrompt.userPromptTemplate) {
            baseSystemPrompt = poolPrompt.systemPrompt;
            baseUserPromptTemplate = poolPrompt.userPromptTemplate;
            boundPrompt = poolPrompt;

            // 记录到提示词池（用于统计和监控）
            if (typeof window.translationPromptPool !== 'undefined' && typeof window.translationPromptPool.enqueueRequest === 'function') {
              const requestId = `req_structured_${Date.now()}_${Math.random().toString(36).slice(2,8)}_b${batchIndex}`;
              window.translationPromptPool.enqueueRequest(poolPrompt.id, { requestId, model: model });
            }

            // 界面日志显示
            if (typeof addProgressLog === 'function') {
              addProgressLog(`${logContext} 使用提示词池: ${poolPrompt.name || poolPrompt.id}`);
            }
            console.log(`${logContext} 使用提示词池的提示词:`, poolPrompt.id);
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

        // 4. 调用翻译 API（带重试机制）
        if (typeof addProgressLog === 'function') {
          addProgressLog(`${logContext} 正在翻译 ${batch.items.length} 个片段...`);
        }

        let lastErr = null;
        let translatedItems = null;
        const maxRetries = options.maxRetries != null ? options.maxRetries : this.MAX_RETRIES;
        const baseDelay = options.retryDelay != null ? options.retryDelay : this.RETRY_BASE_DELAY;
        apiStartTime = Date.now(); // 更新开始时间

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const translatedJson = await this.callTranslationAPI(
              finalSystemPrompt,
              userPrompt,
              model,
              apiKey,
              options
            );
            const parsed = this.parseTranslationResponse(translatedJson);
            if (!this.validateTranslation(batch.items, parsed)) {
              throw new Error('翻译结果结构不匹配');
            }
            translatedItems = parsed;

            // 记录提示词池使用成功
            if (boundPrompt && typeof window.translationPromptPool !== 'undefined' && typeof window.translationPromptPool.recordPromptUsage === 'function') {
              window.translationPromptPool.recordPromptUsage(
                boundPrompt.id,
                true,
                Date.now() - apiStartTime,
                null,
                { model: model, endpoint: 'structured-translation' }
              );
            }

            break; // 成功
          } catch (e) {
            lastErr = e;
            if (attempt < maxRetries) {
              const delay = Math.min(baseDelay * Math.pow(2, attempt), 10000);
              console.warn(`${logContext} 翻译失败（第 ${attempt + 1}/${maxRetries + 1} 次），${delay}ms 后重试:`, e?.message || e);
              await this.delay(delay);
              continue;
            }
          }
        }

        if (!translatedItems) {
          // 全批失败：标记该批所有项失败并返回原文
          const failed = batch.items.map((it, idx) => {
            const clone = { ...it, failed: true };
            // 不在这里添加到 failedItems，让 main.js 统一收集
            return clone;
          });

          // 记录提示词池使用失败
          if (boundPrompt && typeof window.translationPromptPool !== 'undefined' && typeof window.translationPromptPool.recordPromptUsage === 'function') {
            window.translationPromptPool.recordPromptUsage(
              boundPrompt.id,
              false,
              Date.now() - apiStartTime,
              lastErr?.message || '未知错误',
              { model: model, endpoint: 'structured-translation' }
            );
          }

          if (typeof addProgressLog === 'function') {
            addProgressLog(`${logContext} 翻译失败：${lastErr?.message || '未知错误'}（已达最大重试次数）`);
          }
          return { batchIndex, items: failed };
        }

        // 5. 细粒度失败标记 + 合并翻译结果到原始对象
        // 关键：保留原始对象的所有字段（bbox、page_idx、originalItem等），只更新翻译字段
        const markedItems = translatedItems.map((it, idx) => {
          const orig = batch.items[idx];
          let isFailed = false;

          // 先复制原始完整对象，保留所有元数据（bbox、page_idx等，用于定位）
          const out = { ...orig };

          if (orig && it) {
            if (orig.type === 'text') {
              const a = this._normalizeText(orig.text);
              const b = this._normalizeText(it.text);
              isFailed = !b || b === a;

              // 调试日志：记录失败判定详情
              if (isFailed) {
                const reason = !b ? '译文为空' : (b === a ? '译文与原文相同' : '未知原因');
                console.log(`[结构化翻译] 项目 ${idx} 判定为失败: ${reason}`, {
                  原文前50字: a.substring(0, 50),
                  译文前50字: b ? b.substring(0, 50) : '(空)',
                  原文长度: a.length,
                  译文长度: b ? b.length : 0
                });
              }

              // 更新翻译后的文本
              if (!isFailed && it.text !== undefined) {
                out.text = it.text;
              }
            } else if (orig.type === 'image') {
              const a = this._normalizeText(Array.isArray(orig.image_caption) ? orig.image_caption.join(' ') : orig.image_caption);
              const b = this._normalizeText(Array.isArray(it.image_caption) ? it.image_caption.join(' ') : it.image_caption);
              isFailed = !!a && (!b || b === a);
              // 更新翻译后的图片说明
              if (!isFailed && it.image_caption !== undefined) {
                out.image_caption = it.image_caption;
              }
            } else if (orig.type === 'table') {
              const a = this._normalizeText(orig.table_caption);
              const b = this._normalizeText(it.table_caption);
              // 表格数据不翻译，仅检测标题
              isFailed = !!a && (!b || b === a);
              // 更新翻译后的表格标题
              if (!isFailed && it.table_caption !== undefined) {
                out.table_caption = it.table_caption;
              }
            } else if (orig.type === 'formula') {
              isFailed = false; // 公式不需要翻译
            }
          }

          if (isFailed) {
            out.failed = true;
            // 不在这里添加到 failedItems，让 main.js 统一收集
          } else {
            // 翻译成功：明确移除 failed 标记（如果原来有的话）
            delete out.failed;
          }
          return out;
        });

        // 6. 统计本批次失败情况
        const batchFailedCount = markedItems.filter(item => item.failed === true).length;
        const batchSuccessCount = markedItems.length - batchFailedCount;

        console.log(`[结构化翻译] 批次 ${batchIndex + 1} 完成: ${batchSuccessCount}/${markedItems.length} 成功, ${batchFailedCount} 失败`);

        // 7. 更新进度
        completedCount++;
        onProgress?.({
          current: completedCount,
          total: totalBatches,
          percentage: Math.floor((completedCount / totalBatches) * 100),
          message: `已完成 ${completedCount}/${totalBatches} 批次 (${batchSuccessCount}/${markedItems.length} 成功)`
        });

        if (typeof addProgressLog === 'function') {
          addProgressLog(`${logContext} 翻译完成 (${batchSuccessCount}/${markedItems.length} 成功)`);
        }

        return { batchIndex, items: markedItems };

      } catch (error) {
        console.error(`${logContext} 翻译失败:`, error);

        // 记录提示词池使用失败（捕获未预期的异常）
        if (boundPrompt && typeof window.translationPromptPool !== 'undefined' && typeof window.translationPromptPool.recordPromptUsage === 'function') {
          const duration = apiStartTime > 0 ? (Date.now() - apiStartTime) : 0;
          window.translationPromptPool.recordPromptUsage(
            boundPrompt.id,
            false,
            duration,
            error?.message || String(error),
            { model: model, endpoint: 'structured-translation' }
          );
        }

        if (typeof addProgressLog === 'function') {
          addProgressLog(`${logContext} 翻译失败: ${error.message}，将使用原文`);
        }
        // 回退：使用原文并标记失败
        const failed = batch.items.map((it, idx) => {
          const clone = { ...it, failed: true };
          // 不在这里添加到 failedItems，让 main.js 统一收集
          return clone;
        });
        return { batchIndex, items: failed };
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

    // 统计整体翻译情况
    const totalItems = results.length;
    const failedItems = results.filter(item => item.failed === true);
    const failedCount = failedItems.length;
    const successCount = totalItems - failedCount;

    console.log(`[结构化翻译] 全部完成: ${successCount}/${totalItems} 成功, ${failedCount} 失败`);

    if (failedCount > 0) {
      console.warn(`[结构化翻译] 失败项索引:`, failedItems.map((item, idx) => {
        const originalIdx = results.indexOf(item);
        return `#${originalIdx} (${item.type})`;
      }).join(', '));
    }

    if (typeof addProgressLog === 'function') {
      addProgressLog(`结构化翻译完成: ${successCount}/${totalItems} 成功${failedCount > 0 ? `, ${failedCount} 失败` : ''}`);
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
    let result = await callTranslationApi(apiConfig, requestBody);

    // 清理指令块（防止系统提示词泄露到翻译结果中）
    if (typeof stripInstructionBlocks === 'function') {
      result = stripInstructionBlocks(result);
    } else if (typeof processModule !== 'undefined' && typeof processModule.stripInstructionBlocks === 'function') {
      result = processModule.stripInstructionBlocks(result);
    } else {
      // 回退：手动清理
      if (typeof result === 'string') {
        result = result.replace(/\s*\[\[PBX_INSTR_START\]\][\s\S]*?\[\[PBX_INSTR_END\]\]\s*/gi, '').trim();
      }
    }

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

    // 1) 优先提取代码块（兼容 ```json / ``` JSON / ``` 任意）
    let raw = null;
    let m = response.match(/```\s*json\s*([\s\S]*?)\s*```/i);
    if (!m) m = response.match(/```\s*([\s\S]*?)\s*```/);
    if (m) raw = m[1]; else raw = response;

    // 2) 去掉前后噪声，裁剪到 {..} 或 [..]
    const startObj = raw.indexOf('{');
    const startArr = raw.indexOf('[');
    let start = -1;
    if (startObj === -1 && startArr === -1) start = -1;
    else if (startObj === -1) start = startArr; else if (startArr === -1) start = startObj; else start = Math.min(startObj, startArr);
    if (start > 0) raw = raw.slice(start);
    const endObj = raw.lastIndexOf('}');
    const endArr = raw.lastIndexOf(']');
    let end = Math.max(endObj, endArr);
    if (end >= 0) raw = raw.slice(0, end + 1);

    // 3) 规范化：替换花引号、清理无效转义、移除尾随逗号
    let cleaned = raw
      .replace(/[""]/g, '"')  // 中文引号
      .replace(/,\s*([}\]])/g, '$1')  // 尾随逗号
      .replace(/\r\n/g, '\n')  // 统一换行符
      .replace(/\r/g, '\n');

    // 4) 修复常见的无效转义（但保留合法的转义序列）
    // 合法的 JSON 转义：\" \\ \/ \b \f \n \r \t \uXXXX
    // 先处理已经双反斜杠的情况（避免重复转义）
    const placeholder = '\u0000ESCAPED_BACKSLASH\u0000';
    cleaned = cleaned.replace(/\\\\/g, placeholder);

    // 然后处理无效的单反斜杠转义（除了合法的 JSON 转义）
    cleaned = cleaned.replace(/\\(?!["\\\/bfnrtu]|u[0-9a-fA-F]{4})/g, '\\\\');

    // 恢复占位符
    cleaned = cleaned.replace(new RegExp(placeholder, 'g'), '\\\\');

    // 5) 尝试解析
    try {
      return JSON.parse(cleaned);
    } catch (e1) {
      console.error('JSON 解析失败（清理后）:', e1);
      console.error('清理后的内容（前500字符）:', cleaned.substring(0, 500));

      // 最后尝试：更激进的修复
      try {
        // 把所有单反斜杠都转义（可能会破坏一些内容，但至少能解析）
        const aggressive = cleaned.replace(/\\/g, '\\\\');
        return JSON.parse(aggressive);
      } catch (e2) {
        console.error('激进清理也失败:', e2);
        throw new Error('无法解析翻译结果为 JSON 格式');
      }
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
    // 注意：由于发送给AI的是简化数据（只有id、type和翻译字段），
    // AI返回的也只有这些字段，不包含page_idx、bbox等元数据
    for (let i = 0; i < original.length; i++) {
      const orig = original[i];
      const trans = translated[i];

      // 验证 id 是否匹配（用于正确对应原始项）
      if (orig.id !== trans.id) {
        console.error(`[MinerU Structured] 验证失败：索引 ${i} 的 id 不匹配`, orig.id, trans.id);
        return false;
      }

      // 验证 type 是否匹配
      if (orig.type !== trans.type) {
        console.error(`[MinerU Structured] 验证失败：索引 ${i} 的 type 不匹配`, orig.type, trans.type);
        return false;
      }

      // 不再验证 page_idx、bbox 等元数据字段，因为AI返回的简化数据中不包含这些
    }

    return true;
  }

  /**
   * 提取用于重试展示的文本
   */
  extractItemText(item) {
    if (!item) return '';
    if (item.type === 'text') return item.text || '';
    if (item.type === 'image') return Array.isArray(item.image_caption) ? item.image_caption.join(' ') : '';
    if (item.type === 'table') return item.table_caption || '';
    return '';
  }

  _normalizeText(v) {
    if (v == null) return '';
    try {
      if (Array.isArray(v)) return v.join(' ').trim();
      if (typeof v === 'string') return v.trim();
      return String(v).trim();
    } catch (_) { return ''; }
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
