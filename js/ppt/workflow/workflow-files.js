/**
 * Workflow Files Mixin
 * 文件上传、粘贴文档、PPTX 导入
 */

import { WorkflowState, transitionWorkflow, forceWorkflowState } from './workflow-states.js';
import { WorkflowTodoStatus } from '../../agents/runtime/core/constants.js';

export const filesMixin = {
    handleFileUpload(fileList) {
        const newFiles = Array.from(fileList).map(f => ({
            name: f.name,
            size: this._formatSize(f.size),
            rawSize: f.size,
            mimeType: f.type,
            type: 'file',
            file: f
        }));
        if (newFiles.length === 0) return;

        if (!this.workflowData.files) this.workflowData.files = [];
        this.workflowData.files = [...this.workflowData.files, ...newFiles];
        this.renderPreviewArea();
    },

    _formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    async startFromPastedText(pastedContent, options = {}) {
        const content = typeof pastedContent === 'string' ? pastedContent : '';
        if (!content || !content.trim()) {
            if (typeof this.logTerminal === 'function') this.logTerminal('系统', '粘贴内容为空', 'warning');
            return;
        }

        this._ensureDesignSystemInitialized();

        const charCount = content.length;
        // 用户手动选择模式，或根据长度自动判断
        const mode = options.mode || (charCount > 5000 ? 'deepsearch' : 'simple');

        if (typeof this.logTerminal === 'function') {
            const modeLabels = { simple: '快速生成', planned: '规划模式', deepsearch: '深度研究' };
            this.logTerminal('系统', `文档长度: ${charCount} 字，模式: ${modeLabels[mode] || mode}`, 'normal');
        }

        if (mode === 'deepsearch') {
            await this._startFromPastedTextDeepSearch(content);
        } else if (mode === 'planned') {
            await this._startFromPastedTextPlanned(content);
        } else {
            await this._startFromPastedTextSimple(content);
        }
    },

    async _startFromPastedTextPlanned(content) {
        if (typeof this.logTerminal === 'function') {
            this.logTerminal('系统', '正在扫描文档结构...', 'normal');
        }

        transitionWorkflow(this, WorkflowState.SCANNING);
        this.renderPreviewArea?.();

        // 快速扫描：提取标题和结构
        const title = this._extractTitleFromText(content);
        const sections = this._extractSectionsFromMarkdown(content);

        // 生成初步大纲建议
        const suggestedOutline = sections.map((sec, idx) => ({
            id: `section_${idx}`,
            title: sec.title || `第 ${idx + 1} 部分`,
            suggestedPages: Math.max(1, Math.ceil(sec.content.length / 1500)), // 大约 1500 字符一页
            content: sec.content,
            sourceFiles: [], // 用户可以拖入额外文件
            notes: '',
        }));

        // 存储到 workflowData
        this.workflowData.plannedOutline = suggestedOutline;
        this.workflowData.reportMarkdown = content;
        this.workflowData._mode = 'planned';

        if (typeof this.logTerminal === 'function') {
            this.logTerminal('系统', `已识别 ${suggestedOutline.length} 个章节，请在规划器中配置每页内容`, 'normal');
        }

        // 进入规划界面
        transitionWorkflow(this, WorkflowState.OUTLINE_PLANNING);
        this.renderPreviewArea?.();

        // 打开规划器 modal
        if (typeof this.openOutlinePlanner === 'function') {
            this.openOutlinePlanner(suggestedOutline);
        }
    },

    _extractSectionsFromMarkdown(content) {
        const lines = content.split('\n');
        const sections = [];
        let currentSection = null;
        let buffer = [];

        for (const line of lines) {
            const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
            if (headingMatch) {
                // 保存上一个 section
                if (currentSection) {
                    currentSection.content = buffer.join('\n').trim();
                    sections.push(currentSection);
                }
                currentSection = {
                    level: headingMatch[1].length,
                    title: headingMatch[2].trim(),
                    content: '',
                };
                buffer = [];
            } else {
                buffer.push(line);
            }
        }

        // 保存最后一个 section
        if (currentSection) {
            currentSection.content = buffer.join('\n').trim();
            sections.push(currentSection);
        }

        // 如果没有找到任何标题，把整个内容作为一个 section
        if (sections.length === 0 && content.trim()) {
            sections.push({
                level: 1,
                title: '内容',
                content: content.trim(),
            });
        }

        return sections;
    },

    async _startFromPastedTextDeepSearch(content) {
        const title = this._extractTitleFromText(content);

        const sourceId = `paste_${Date.now()}`;
        const source = {
            sourceId,
            kind: 'user_text',
            title,
            uri: null,
            sourceTextNormalized: content,
            metadata: { source: 'paste', timestamp: Date.now() }
        };

        if (!this.workflowData.files) this.workflowData.files = [];
        this.workflowData.files.push({
            name: title || '粘贴文档',
            size: this._formatSize(content.length),
            rawSize: content.length,
            mimeType: 'text/markdown',
            type: 'paste',
            content,
            _source: source
        });

        this.workflowData._pastedSources = [source];
        this.workflowData._useDeepSearch = true;
        this.workflowData.reportMarkdown = content;

        if (typeof this.logTerminal === 'function') {
            this.logTerminal('系统', '长文档已加载，将进行深度分析。请设置项目目标后开始。', 'normal');
        }

        forceWorkflowState(this, WorkflowState.IDLE);
        this.renderPreviewArea();

        if (typeof this.openProjectBriefForm === 'function') {
            this.openProjectBriefForm();
        }
    },

    async _startFromPastedTextSimple(content) {
        await this._ensureRuntime({ mode: 'textprep' });

        if (typeof this.logTerminal === 'function') this.logTerminal('系统', '开始处理粘贴文档...', 'normal');
        transitionWorkflow(this, WorkflowState.READING);
        if (Array.isArray(this._runtimeTodoTexts) && typeof this.updateTodos === 'function') {
            this.updateTodos(this._runtimeTodoTexts.map((text, i) => ({
                text,
                status: i === 0 ? WorkflowTodoStatus.ACTIVE : WorkflowTodoStatus.PENDING,
            })));
        }
        this.renderPreviewArea();

        const title = this._extractTitleFromText(content);
        const summaryText = content.replace(/^#{1,6}\s+.+\n?/gm, '').trim().slice(0, 800);
        const contentPackage = {
            title,
            summary: summaryText,
            report: { markdown: content },
            slideIntents: this._generateSlideIntentsFromMarkdown(content),
            metadata: { source: 'paste', timestamp: Date.now() }
        };

        this.workflowData.contentPackage = contentPackage;
        this.workflowData.report = contentPackage.report;
        this.workflowData.slideIntents = contentPackage.slideIntents;
        this.workflowData.reportMarkdown = content;

        this.workflowData._needsTextPrep = true;
        this.workflowData._useDeepSearch = false;

        if (typeof this.logTerminal === 'function') this.logTerminal('系统', '文档已解析，点击确认后将进行 AI 分析', 'normal');
        transitionWorkflow(this, WorkflowState.SCRIPT_REVIEW);
        if (Array.isArray(this._runtimeTodoTexts) && typeof this.updateTodos === 'function') {
            this.updateTodos(this._runtimeTodoTexts.map((text, i) => {
                if (i < 2) return { text, status: WorkflowTodoStatus.COMPLETED };
                if (i === 2) return { text, status: WorkflowTodoStatus.ACTIVE };
                return { text, status: WorkflowTodoStatus.PENDING };
            }));
        }
        this.renderPreviewArea();
    },

    _extractTitleFromText(text) {
        const content = typeof text === 'string' ? text : '';
        const match = content.match(/^#\s+(.+)/m);
        if (match) return match[1].trim();
        return content.slice(0, 50).split('\n')[0].trim() || '粘贴文档';
    },

    _generateSlideIntentsFromMarkdown(markdown) {
        const md = typeof markdown === 'string' ? markdown : '';
        const hasHeadings = /^#{1,2}\s/m.test(md);

        const extractKeyPoints = (text, max = 8) => {
            const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
            const bullets = lines.filter(l => /^[-*•]\s/.test(l)).map(l => l.replace(/^[-*•]\s*/, ''));
            const numbered = lines.filter(l => /^\d+[.)]\s/.test(l)).map(l => l.replace(/^\d+[.)]\s*/, ''));
            const shortParas = lines.filter(l => !l.startsWith('#') && l.length > 10 && l.length < 200);
            return [...bullets, ...numbered, ...shortParas].slice(0, max);
        };

        if (!hasHeadings) {
            const keyPoints = extractKeyPoints(md);
            return [{
                slideIntentId: 'si_0',
                index: 0,
                title: '内容',
                content: md,
                pageType: 'content',
                keyPoints: keyPoints.length ? keyPoints : md.split(/\n+/).filter(l => l.trim()).slice(0, 8)
            }];
        }

        const sections = md.split(/(?=^#{1,2}\s)/m).filter(Boolean);
        return sections.map((section, i) => {
            const titleMatch = section.match(/^#{1,2}\s+(.+)/m);
            const bodyText = section.replace(/^#{1,2}\s+.+\n?/, '').trim();
            const keyPoints = extractKeyPoints(bodyText);
            return {
                slideIntentId: `si_${i}`,
                index: i,
                title: titleMatch ? titleMatch[1].trim() : `第 ${i + 1} 页`,
                content: section.trim(),
                pageType: i === 0 ? 'cover' : 'content',
                keyPoints: keyPoints.length ? keyPoints : bodyText.split(/\n+/).filter(l => l.trim() && !l.startsWith('#')).slice(0, 8),
                objective: bodyText.slice(0, 200)
            };
        });
    },

    async _ensurePptxSlideParser() {
        if (typeof PPTXSlideParser !== 'undefined') return PPTXSlideParser;
        if (typeof window !== 'undefined' && window?.PPTXSlideParser) return window.PPTXSlideParser;

        if (typeof document !== 'undefined' && document?.createElement) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'js/ppt/core/slide-parser-pptx.js';
                script.async = true;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error('加载 slide-parser-pptx.js 失败'));
                document.head.appendChild(script);
            });
            if (typeof PPTXSlideParser !== 'undefined') return PPTXSlideParser;
            if (typeof window !== 'undefined' && window?.PPTXSlideParser) return window.PPTXSlideParser;
        }

        throw new Error('PPTXSlideParser 未加载');
    },

    _pptxSlidesToSlideIntents(slides = [], filename = 'slides.pptx') {
        const safeSlides = Array.isArray(slides) ? slides : [];

        const toText = (v) => (typeof v === 'string' ? v : (v === null || v === undefined ? '' : String(v)));
        const slideTitle = (slide) => {
            const els = Array.isArray(slide?.elements) ? slide.elements : [];
            for (const el of els) {
                if (el?.type !== 'text') continue;
                const role = toText(el?.role).trim();
                const content = toText(el?.content).trim();
                if (role === 'title' && content) return content;
            }
            for (const el of els) {
                if (el?.type !== 'text') continue;
                const content = toText(el?.content).trim();
                if (content) return content;
            }
            return '';
        };

        const keyPointsFromSlide = (slide) => {
            const els = Array.isArray(slide?.elements) ? slide.elements : [];
            const lines = [];
            for (const el of els) {
                if (el?.type !== 'text') continue;
                const content = toText(el?.content).trim();
                if (!content) continue;
                lines.push(...content.split(/\n+/).map((s) => s.trim()).filter(Boolean));
            }
            return lines.slice(0, 8);
        };

        return safeSlides.map((slide, i) => {
            const title = slideTitle(slide) || `Slide ${i + 1}`;
            const keyPoints = keyPointsFromSlide(slide).filter((v) => v !== title).slice(0, 8);
            return {
                slideIntentId: `pptx_s${i + 1}`,
                index: i,
                pageType: i === 0 ? 'cover' : 'content',
                title,
                objective: '',
                keyPoints,
                claimIds: [],
                dataTableIds: [],
                source: { type: 'pptx', filename },
            };
        });
    },

    _pptxSlidesToDeckHtmlDsl(slides = []) {
        const safeSlides = Array.isArray(slides) ? slides : [];

        const escapeAttr = (v) =>
            String(v ?? '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

        const escapeHtml = (v) =>
            String(v ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/\n/g, '<br>');

        const attr = (k, v) => {
            if (v === undefined || v === null) return '';
            const s = String(v).trim();
            if (!s) return '';
            return ` ${k}="${escapeAttr(s)}"`;
        };

        const elToHtml = (el) => {
            if (!el || typeof el !== 'object') return '';
            const type = String(el.type || '').trim();
            if (!type) return '';

            const id = el.id ? ` id="${escapeAttr(el.id)}"` : '';
            const pos = `${attr('data-x', el.x)}${attr('data-y', el.y)}${attr('data-w', el.w)}${attr('data-h', el.h)}`;
            const rotate = attr('data-rotate', el.rotate ?? el.rotation);

            if (type === 'text') {
                const role = attr('data-role', el.role);
                const font = attr('data-font', el.fontSize ?? el.font);
                const color = attr('data-color', el.color);
                const bold = el.bold ? ' data-bold="true"' : '';
                const italic = el.italic ? ' data-italic="true"' : '';
                const align = attr('data-align', el.align);
                return `<div data-el="text"${id}${pos}${rotate}${font}${color}${bold}${italic}${align}${role}>${escapeHtml(el.content || '')}</div>`;
            }

            if (type === 'image') {
                const src = el.src || '';
                const alt = el.alt || '图片';
                return `<div data-el="image"${id}${pos}${rotate}${attr('data-src', src)}${attr('data-alt', alt)}></div>`;
            }

            if (type === 'shape') {
                const shape = el.shape || el.shapeType || 'rect';
                const fill = el.fill || '#4f46e5';
                const stroke = attr('data-stroke', el.stroke);
                const strokeWidth = attr('data-stroke-width', el.strokeWidth);
                const role = attr('data-role', el.role);
                return `<div data-el="shape"${id}${pos}${rotate}${attr('data-shape', shape)}${attr('data-fill', fill)}${stroke}${strokeWidth}${role}></div>`;
            }

            if (type === 'chart') {
                return `<div data-el="chart"${id}${pos}${rotate}${attr('data-chart-type', el.chartType)}${attr('data-title', el.title)}${attr('data-chart-data', JSON.stringify(el.chartData || {}))}></div>`;
            }

            if (type === 'table') {
                return `<div data-el="table"${id}${pos}${rotate}${attr('data-data', JSON.stringify(el.data || []))}></div>`;
            }

            if (type === 'line') {
                return `<div data-el="line"${id}${attr('data-x1', el.x1)}${attr('data-y1', el.y1)}${attr('data-x2', el.x2)}${attr('data-y2', el.y2)}${attr('data-stroke', el.stroke)}${attr('data-stroke-width', el.strokeWidth)}></div>`;
            }

            return '';
        };

        return safeSlides
            .map((slide, i) => {
                const bg = String(slide?.background || '#ffffff');
                const bgAttr = bg.startsWith('linear-gradient') ? ` data-gradient="${escapeAttr(bg)}"` : ` data-bg="${escapeAttr(bg)}"`;
                const sectionId = `pptx-slide-${i + 1}`;
                const els = (Array.isArray(slide?.elements) ? slide.elements : []).map(elToHtml).filter(Boolean).join('\n  ');
                return `<section data-type="freeform" id="${sectionId}"${bgAttr}>\n  ${els}\n</section>`;
            })
            .join('\n\n');
    },

    async importPptxAsDeck(pptxFile, { autoOpenAfter = true } = {}) {
        try {
            if (!pptxFile) throw new Error('请选择 PPTX 文件');

            transitionWorkflow(this, WorkflowState.READING);
            const filename = typeof pptxFile?.name === 'string' ? pptxFile.name : 'slides.pptx';
            const Parser = await this._ensurePptxSlideParser();
            const parser = new Parser();

            const input = typeof pptxFile?.arrayBuffer === 'function' ? await pptxFile.arrayBuffer() : pptxFile;
            const result = await parser.parse(input);

            const slides = Array.isArray(result?.slides) ? result.slides : [];
            if (!slides.length) throw new Error('PPTX 解析失败：未读取到幻灯片');

            const slideIntents = this._pptxSlidesToSlideIntents(slides, filename);
            const templateDeckHtmlDsl = this._pptxSlidesToDeckHtmlDsl(slides);

            if (!this.workflowData) this.workflowData = {};
            this.workflowData.slideIntents = slideIntents;
            this.workflowData.contentPackage = {
                schemaVersion: '0.1',
                title: filename,
                summary: 'Imported PPTX template',
                constraints: {},
                slideIntents,
                templateDeckHtmlDsl,
                templateMeta: result?.metadata || null,
            };

            await this._ensureRuntime({ mode: 'textprep' });
            this._orchestrator?.start?.();

            transitionWorkflow(this, WorkflowState.SCRIPT_REVIEW);
            transitionWorkflow(this, WorkflowState.PAGE_LAYOUT);
            transitionWorkflow(this, WorkflowState.DESIGNER);
            this.renderPreviewArea?.();

            await this._orchestrator.runStage('design.batch', { contentPackage: this.workflowData.contentPackage });

            if (autoOpenAfter) {
                transitionWorkflow(this, WorkflowState.COMPLETED);
                this.renderPreviewArea?.();
            }

            return { ok: true, slideCount: slides.length };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err || 'unknown error');
            console.warn('[importPptxAsDeck] failed:', err);
            this.addChatMessage?.('ai', `PPTX 导入失败：${msg}。已回退到手动输入流程。`);
            forceWorkflowState(this, WorkflowState.IDLE);
            this.renderPreviewArea?.();
            try {
                this.openPasteDocumentModal?.();
            } catch {
                // ignore
            }
            return { ok: false, error: msg };
        }
    },

    async importPptxAsDeckFromPicker() {
        if (typeof document === 'undefined') {
            throw new Error('当前环境不支持文件选择器');
        }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pptx';
        input.onchange = async (e) => {
            const file = e?.target?.files?.[0];
            if (!file) return;
            await this.importPptxAsDeck(file);
        };
        input.click();
    },

    _buildIngestInputFromWorkflowFiles(files) {
        const out = { files: [], urls: [], historyIds: [], rawTexts: [], sources: [] };
        for (const item of Array.isArray(files) ? files : []) {
            if (!item) continue;
            if (item.type === 'link') {
                if (typeof item.name === 'string' && item.name.trim()) out.urls.push(item.name.trim());
                continue;
            }
            if (item.type === 'history') {
                if (typeof item.historyId === 'string' && item.historyId.trim()) out.historyIds.push(item.historyId.trim());
                continue;
            }
            if (item.type === 'rawText') {
                if (typeof item.text === 'string' && item.text.trim()) out.rawTexts.push({ title: item.name || 'User Input', text: item.text });
                continue;
            }
            if (item.type === 'paste' && item._source) {
                out.sources.push(item._source);
                continue;
            }
            if (item.type === 'paste' && typeof item.content === 'string') {
                out.rawTexts.push({ title: item.name || '粘贴文档', text: item.content });
                continue;
            }
            if (item.type === 'history-report' && typeof item.content === 'string' && item.content.trim()) {
                out.rawTexts.push({ title: item.name || '历史研究报告', text: item.content });
                continue;
            }
            if (item.type === 'history-source' && typeof item.content === 'string' && item.content.trim()) {
                out.sources.push({
                    sourceId: item.sourceId || `hist_src_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    kind: 'history_import',
                    uri: item.sourceUri || '',
                    title: item.name || '历史来源',
                    sourceTextNormalized: item.content,
                    fetchedAt: new Date().toISOString(),
                    metadata: { importedFrom: 'history' },
                });
                continue;
            }
            if ((item.type === 'history-checkpoint' || item.type === 'history-document') && typeof item.content === 'string' && item.content.trim()) {
                out.rawTexts.push({ title: item.name || '历史项目', text: item.content });
                continue;
            }
            if (item.file) {
                out.files.push(item.file);
                continue;
            }
            if (typeof item.text === 'function' || typeof item.arrayBuffer === 'function') out.files.push(item);
        }
        return out;
    },
};
