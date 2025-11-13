// js/processing/markdown_processor_integration.js
// AST 注释系统集成辅助函数
// 提供平滑的迁移路径：从 marked.Renderer 到 AST 注释

(function(global) {
    'use strict';

    // Phase 3.5: 警告标志位，避免流式更新时重复输出
    let _rendererWarningShown = false;

    /**
     * 智能渲染函数：自动选择最佳渲染方式
     * @param {string} markdown - Markdown 文本
     * @param {Array} images - 图片数组
     * @param {Array|Object} annotationsOrRenderer - 注释数组或自定义渲染器
     * @param {string} contentIdentifier - 内容标识符
     * @returns {string} HTML
     */
    function smartRender(markdown, images, annotationsOrRenderer, contentIdentifier) {
        // 检测是否使用 AST 处理器
        const useAST = global.MarkdownProcessorAST && global.MarkdownProcessorAST.render;

        if (!useAST) {
            // 降级到旧版
            return global.MarkdownProcessor.renderWithKatexFailback(
                global.MarkdownProcessor.safeMarkdown(markdown, images),
                annotationsOrRenderer  // 作为 customRenderer
            );
        }

        // 检测传入的是注释数组还是 Renderer
        const isAnnotationArray = Array.isArray(annotationsOrRenderer);
        const isRenderer = annotationsOrRenderer && typeof annotationsOrRenderer.heading === 'function';

        if (isAnnotationArray && annotationsOrRenderer.length > 0) {
            // 使用 AST 注释插件
            console.log('[Integration] 使用 AST 注释插件 -', annotationsOrRenderer.length, '个注释');
            return global.MarkdownProcessorAST.renderWithAnnotations(
                markdown,
                images,
                annotationsOrRenderer,
                contentIdentifier
            );
        } else if (isRenderer) {
            // 传入了 marked.Renderer（旧版方式）
            // 在 AST 模式下，renderer 会被忽略，应该使用后处理方式
            // Phase 3.5: 只输出一次警告，避免流式更新时刷屏
            if (!_rendererWarningShown) {
                console.warn('[Integration] 检测到 marked.Renderer，但 AST 模式不支持。请使用后处理或迁移到注释数组。');
                _rendererWarningShown = true;
            }
            return global.MarkdownProcessorAST.render(markdown, images);
        } else {
            // 没有注释或空数组
            return global.MarkdownProcessorAST.render(markdown, images);
        }
    }

    /**
     * 兼容旧版 API：替代 createCustomMarkdownRenderer
     *
     * 用法：
     * // 旧版（不再工作）
     * const renderer = createCustomMarkdownRenderer(annotations, 'ocr', ...);
     * marked(md, { renderer });
     *
     * // 新版（AST）
     * const config = createAnnotationConfig(annotations, 'ocr');
     * smartRender(md, images, config.annotations, config.identifier);
     */
    function createAnnotationConfig(annotations, contentIdentifier) {
        return {
            annotations: annotations || [],
            identifier: contentIdentifier || 'default',

            // 兼容接口：提供渲染函数
            render: function(markdown, images) {
                return smartRender(markdown, images, this.annotations, this.identifier);
            }
        };
    }

    /**
     * 批量渲染 tokens（用于增量渲染）
     * @param {Array} tokens - marked.lexer() 的 tokens
     * @param {Array} images - 图片数组
     * @param {Array} annotations - 注释数组
     * @param {string} contentIdentifier - 内容标识符
     * @returns {Array} HTML 字符串数组
     */
    function renderTokens(tokens, images, annotations, contentIdentifier) {
        return tokens.map(token => {
            const markdown = token.raw || '';
            return smartRender(markdown, images, annotations, contentIdentifier);
        });
    }

    /**
     * 检测当前使用的渲染架构
     */
    function getActiveArchitecture() {
        if (global.MarkdownProcessorAST && global.MarkdownProcessor === global.MarkdownProcessorAST) {
            return 'AST';
        } else if (global.MarkdownProcessorEnhanced) {
            return 'Enhanced';
        } else {
            return 'Legacy';
        }
    }

    /**
     * 性能指标
     */
    function getMetrics() {
        const arch = getActiveArchitecture();
        const base = {
            architecture: arch,
            timestamp: Date.now()
        };

        if (arch === 'AST' && global.MarkdownProcessorAST.getMetrics) {
            return {
                ...base,
                ...global.MarkdownProcessorAST.getMetrics()
            };
        }

        return base;
    }

    // 导出 API
    global.MarkdownIntegration = {
        // 核心函数
        smartRender: smartRender,
        createAnnotationConfig: createAnnotationConfig,
        renderTokens: renderTokens,

        // 工具函数
        getActiveArchitecture: getActiveArchitecture,
        getMetrics: getMetrics,

        // 版本信息
        version: '1.0.0',
        description: 'Integration layer between marked.Renderer and AST annotations'
    };

    console.log('[MarkdownIntegration] 集成层已加载，当前架构:', getActiveArchitecture());

})(window);
