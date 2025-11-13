/**
 * Paper Burner - KaTeX 渐进式渲染系统
 * Phase 4.2+: 解决复杂消息首次渲染 4.6s 阻塞问题
 *
 * 核心策略：
 * 1. 先渲染 Markdown（不渲染公式），立即显示内容框架
 * 2. 公式位置放占位符
 * 3. 使用 requestIdleCallback 分批渲染公式，避免阻塞主线程
 *
 * 预期效果：
 * - 首次可见：< 300ms
 * - 流式更新：每次 < 50ms
 * - 用户感知：10倍速度提升
 */

(function() {
  'use strict';

  /**
   * 渐进式渲染配置
   */
  const PROGRESSIVE_CONFIG = {
    BATCH_SIZE: 3,                    // 每批渲染的公式数量
    IDLE_TIMEOUT: 50,                 // 空闲回调超时时间 (ms)
    PLACEHOLDER_CLASS: 'katex-placeholder',
    ENABLE: true                      // 是否启用渐进式渲染
  };

  /**
   * 渲染队列管理器
   */
  class KaTeXProgressiveRenderer {
    constructor() {
      this.renderQueue = [];          // 待渲染的公式队列
      this.isRendering = false;       // 是否正在渲染
      this.renderedCount = 0;         // 已渲染数量
      this.totalCount = 0;            // 总公式数量
    }

    /**
     * 第一步：快速渲染 Markdown（不渲染公式）
     * 公式位置用占位符代替
     */
    renderMarkdownWithPlaceholders(md) {
      const formulas = [];
      let formulaCounter = 0;

      // 提取并替换 $$ ... $$ 块级公式
      md = md.replace(/\$\$([\s\S]+?)\$\$/g, (match, tex) => {
        const id = `katex-formula-${formulaCounter++}`;
        formulas.push({
          id: id,
          tex: tex.trim(),
          displayMode: true
        });
        return this.createPlaceholder(id, true);
      });

      // 提取并替换 \[ ... \] 块级公式
      md = md.replace(/\\\[([\s\S]+?)\\\]/g, (match, tex) => {
        const id = `katex-formula-${formulaCounter++}`;
        formulas.push({
          id: id,
          tex: tex.trim(),
          displayMode: true
        });
        return this.createPlaceholder(id, true);
      });

      // 提取并替换 $ ... $ 行内公式
      md = md.replace(/\$([^\$]+?)\$/g, (match, tex) => {
        const id = `katex-formula-${formulaCounter++}`;
        formulas.push({
          id: id,
          tex: tex.trim(),
          displayMode: false
        });
        return this.createPlaceholder(id, false);
      });

      // 提取并替换 \( ... \) 行内公式
      md = md.replace(/\\\(([^)]+?)\\\)/g, (match, tex) => {
        const id = `katex-formula-${formulaCounter++}`;
        formulas.push({
          id: id,
          tex: tex.trim(),
          displayMode: false
        });
        return this.createPlaceholder(id, false);
      });

      return { md, formulas };
    }

    /**
     * 创建公式占位符
     */
    createPlaceholder(id, displayMode) {
      if (displayMode) {
        return `\n<div id="${id}" class="${PROGRESSIVE_CONFIG.PLACEHOLDER_CLASS} katex-block-placeholder" style="min-height: 40px; background: #f8f9fa; border-radius: 4px; padding: 12px; margin: 8px 0; display: flex; align-items: center; justify-content: center; color: #999;">
  <span style="font-size: 12px;">⏳ 渲染公式中...</span>
</div>\n`;
      } else {
        return `<span id="${id}" class="${PROGRESSIVE_CONFIG.PLACEHOLDER_CLASS} katex-inline-placeholder" style="display: inline-block; min-width: 20px; height: 1em; background: #f0f0f0; border-radius: 2px; padding: 0 4px; color: #999; font-size: 0.8em;">⏳</span>`;
      }
    }

    /**
     * 第二步：将公式添加到渲染队列
     */
    queueFormulas(formulas) {
      this.renderQueue.push(...formulas);
      this.totalCount = this.renderQueue.length;
      this.renderedCount = 0;

      // 如果还没开始渲染，启动渲染
      if (!this.isRendering) {
        this.startRendering();
      }
    }

    /**
     * 启动渐进式渲染
     */
    startRendering() {
      this.isRendering = true;
      this.renderNextBatch();
    }

    /**
     * 渲染下一批公式
     */
    renderNextBatch() {
      if (this.renderQueue.length === 0) {
        this.isRendering = false;
        console.log(`[KaTeX Progressive] ✅ 所有公式渲染完成 (${this.totalCount} 个)`);
        return;
      }

      const startTime = performance.now();

      // 取出一批公式
      const batch = this.renderQueue.splice(0, PROGRESSIVE_CONFIG.BATCH_SIZE);

      // 渲染这批公式
      batch.forEach(formula => {
        this.renderFormula(formula);
        this.renderedCount++;
      });

      const duration = performance.now() - startTime;

      // 性能监控
      if (window.PerfMonitor) {
        window.PerfMonitor.recordRender(duration, 'katex_progressive_batch');
      }

      // 使用 requestIdleCallback 或 setTimeout 调度下一批
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => this.renderNextBatch(), {
          timeout: PROGRESSIVE_CONFIG.IDLE_TIMEOUT
        });
      } else {
        setTimeout(() => this.renderNextBatch(), 0);
      }
    }

    /**
     * 渲染单个公式
     */
    renderFormula(formula) {
      const placeholder = document.getElementById(formula.id);
      if (!placeholder) {
        console.warn(`[KaTeX Progressive] 占位符未找到: ${formula.id}`);
        return;
      }

      try {
        const startTime = performance.now();

        // 使用缓存渲染
        const renderFn = window.renderKatexCached || katex.renderToString;
        const html = renderFn(formula.tex, {
          displayMode: formula.displayMode,
          output: 'html',
          strict: 'ignore',
          throwOnError: false,
          trust: false,
          macros: {},
          maxSize: 50,
          maxExpand: 100
        });

        const duration = performance.now() - startTime;

        // 替换占位符
        if (formula.displayMode) {
          placeholder.outerHTML = `<div class="katex-block" data-formula-display="block">${html}</div>`;
        } else {
          placeholder.outerHTML = `<span class="katex-inline" data-formula-display="inline">${html}</span>`;
        }

        // 性能监控
        if (window.PerfMonitor && duration > 10) {
          window.PerfMonitor.recordRender(duration, 'katex_progressive_single');
        }
      } catch (error) {
        console.error(`[KaTeX Progressive] 渲染失败:`, formula.tex, error);
        // 渲染失败时显示原始文本
        placeholder.outerHTML = formula.displayMode
          ? `<div class="katex-fallback katex-block"><pre>${formula.tex}</pre></div>`
          : `<span class="katex-fallback katex-inline">${formula.tex}</span>`;
      }
    }

    /**
     * 清空队列
     */
    clear() {
      this.renderQueue = [];
      this.isRendering = false;
      this.renderedCount = 0;
      this.totalCount = 0;
    }
  }

  // 创建全局实例
  window.KaTeXProgressiveRenderer = KaTeXProgressiveRenderer;

  if (!window.katexProgressiveRenderer) {
    window.katexProgressiveRenderer = new KaTeXProgressiveRenderer();
    console.log('[KaTeX Progressive] 渐进式渲染系统已加载');
  }

  /**
   * 替换原有的 renderWithKatexStreaming
   * 使用渐进式渲染
   */
  if (PROGRESSIVE_CONFIG.ENABLE && window.renderWithKatexStreaming) {
    const originalRender = window.renderWithKatexStreaming;

    window.renderWithKatexStreaming = function(md) {
      const startTime = performance.now();

      // 第一步：快速渲染（带占位符）
      const { md: mdWithPlaceholders, formulas } = window.katexProgressiveRenderer.renderMarkdownWithPlaceholders(md);

      // 渲染 Markdown（不包含公式）
      let html;
      if (typeof window.safeRenderMarkdown === 'function') {
        html = window.safeRenderMarkdown(mdWithPlaceholders);
      } else if (typeof marked !== 'undefined') {
        html = marked.parse(mdWithPlaceholders);
      } else {
        html = mdWithPlaceholders;
      }

      const firstPassDuration = performance.now() - startTime;
      console.log(`[KaTeX Progressive] 首次渲染完成: ${firstPassDuration.toFixed(1)}ms, 公式数: ${formulas.length}`);

      // 第二步：将公式加入渲染队列（异步）
      if (formulas.length > 0) {
        // 使用 setTimeout 确保 DOM 已插入
        setTimeout(() => {
          window.katexProgressiveRenderer.queueFormulas(formulas);
        }, 0);
      }

      return html;
    };

    console.log('[KaTeX Progressive] 已启用渐进式渲染模式');
  }
})();
