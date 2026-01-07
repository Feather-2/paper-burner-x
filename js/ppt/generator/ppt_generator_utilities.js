// ESM 导入核心类以确保 mixin 安装时类已存在
import PPTGeneratorCtor from './ppt_generator_core.js';

function sanitizeHtml(html) {
    if (!html) return '';
    return String(html)
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/\bon\w+\s*=/gi, 'data-removed-handler=');
}

const PPTGeneratorUtilities = {
    updateTodos(newTodos) {
        this.todos = newTodos;
        this.currentProject.todos = newTodos;
        this._saveProject();
        this.renderTodoList();
    },

    renderTodoList() {
        const container = document.getElementById('pptTodoTracker');
        if (!container) return;

        if (this.todos.length === 0) {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'block';

        const completedCount = this.todos.filter(t => t.status === 'completed').length;
        const totalCount = this.todos.length;
        const allCompleted = completedCount === totalCount;

        // 默认收起
        if (this.isTodoListExpanded === undefined) {
            this.isTodoListExpanded = false;
        }

        const listHtml = this.todos.map(todo => `
            <div class="ppt-todo-item ${todo.status}">
                <div class="ppt-todo-icon">
                    ${todo.status === 'completed' ? '<iconify-icon icon="carbon:checkmark-filled"></iconify-icon>' :
                      todo.status === 'active' ? '<iconify-icon icon="carbon:circle-dash" class="animate-spin"></iconify-icon>' :
                      '<iconify-icon icon="carbon:radio-button"></iconify-icon>'}
                </div>
                <span>${todo.text}</span>
            </div>
        `).join('');

        const progressText = !this.isTodoListExpanded ? `<span style="font-weight: normal; color: var(--ppt-text-muted); margin-left: 8px;">${allCompleted ? '✓ 已完成' : `(${completedCount}/${totalCount})`}</span>` : '';

        const chevronIcon = this.isTodoListExpanded ? 'carbon:chevron-up' : 'carbon:chevron-down';
        const contentStyle = this.isTodoListExpanded ? '' : 'display: none;';

        container.innerHTML = `
            <div class="ppt-todo-header" onclick="window.PPTGenerator.toggleTodoList()">
                <div style="display: flex; align-items: center;">
                    <span>当前任务进度</span>
                    ${progressText}
                </div>
                <iconify-icon icon="${chevronIcon}"></iconify-icon>
            </div>
            <div class="ppt-todo-content" style="${contentStyle}">
                ${listHtml}
            </div>
        `;
    },

    toggleTodoList() {
        this.isTodoListExpanded = !this.isTodoListExpanded;
        this.renderTodoList();
    },

    renderChatSidebar() {
        const container = document.getElementById('pptChatHistory');
        if (!container) return;
        container.innerHTML = '';
        const history = this.currentProject?.chatHistory || [];
        history.forEach(msg => this._appendMessageToDOM(msg));
        this._scrollToBottom();
    },

    addChatMessage(role, content, actionHtml = null, attachments = []) {
        const msg = { 
            role, 
            content, 
            action: actionHtml, 
            attachments: attachments.map(a => ({ name: a.name, type: a.type, preview: a.preview })),
            timestamp: Date.now() 
        };
        this.currentProject.chatHistory.push(msg);
        this._saveProject();
        this._appendMessageToDOM(msg);
        this._scrollToBottom();
    },

    _appendMessageToDOM(msg) {
        const container = document.getElementById('pptChatHistory');
        const div = document.createElement('div');
        div.className = `ppt-message ${msg.role}`;

        // Only show avatar for user, or if it's the very first message for AI to establish context
        // But user requested "ugly AI avatar" to be removed. Let's make it cleaner.
        // We'll remove the avatar circle for AI and just use a clean label or nothing if continuous.
        // For now, let's just remove the AI avatar circle as requested and keep user's.

        let avatarHtml = '';
        if (msg.role === 'user') {
            avatarHtml = `
                <div class="ppt-avatar user">
                    <iconify-icon icon="carbon:user"></iconify-icon>
                </div>
            `;
        } else {
            // For AI, maybe just a small icon or nothing if we want it cleaner?
            // User said "logo don't show always". Let's try a minimal approach.
            // We'll skip the big 'AI' circle.
            avatarHtml = `
                <div class="ppt-avatar ai-minimal">
                    <iconify-icon icon="carbon:bot"></iconify-icon>
                </div>
            `;
        }

        // 渲染附件
        let attachmentsHtml = '';
        if (msg.attachments && msg.attachments.length > 0) {
            attachmentsHtml = `
                <div class="ppt-msg-attachments">
                    ${msg.attachments.map(att => `
                        <div class="ppt-msg-attachment">
                            ${att.preview 
                                ? `<img src="${att.preview}" alt="${att.name}">` 
                                : `<iconify-icon icon="carbon:document"></iconify-icon>`
                            }
                            <span>${att.name}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

	        div.innerHTML = `
	            ${avatarHtml}
	            <div class="ppt-bubble">
	                ${attachmentsHtml}
	                ${msg.content ? sanitizeHtml(marked.parse(msg.content)) : ''}
	                ${msg.action ? `<div class="ppt-bubble-action">${msg.action}</div>` : ''}
	            </div>
	        `;
	        container.appendChild(div);
	    },

    _scrollToBottom() {
        const container = document.getElementById('pptChatHistory');
        if (container) container.scrollTop = container.scrollHeight;
    },

    _appendThinkingIndicator(id) {
        const container = document.getElementById('pptChatHistory');
        if (!container) return;
        const div = document.createElement('div');
        div.id = id;
        div.className = 'ppt-message ai ppt-thinking';
        div.innerHTML = `
            <div class="ppt-avatar ai-minimal">
                <iconify-icon icon="carbon:bot"></iconify-icon>
            </div>
            <div class="ppt-bubble">
                <span class="ppt-thinking-dots">思考中<span>.</span><span>.</span><span>.</span></span>
            </div>
        `;
        container.appendChild(div);
        this._scrollToBottom();
    },

    _removeThinkingIndicator(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    },

    async _loadScriptOnce(src) {
        if (typeof document === 'undefined') {
            throw new Error('当前环境不支持动态加载脚本');
        }
        this._chatScriptPromises = this._chatScriptPromises || new Map();
        if (this._chatScriptPromises.has(src)) return this._chatScriptPromises.get(src);

        const p = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`加载脚本失败: ${src}`));
            document.head.appendChild(script);
        });

        this._chatScriptPromises.set(src, p);
        return p;
    },

    async _ensureIntentParser() {
        if (window.IntentParser?.parse) return;
        if (window.IntentParser?.parseIntent) return;
        // lazy load (ppt.html 默认不加载 intent-parser)
        await this._loadScriptOnce('js/ppt/editor/intent/intent-parser.js');
        if (!window.IntentParser?.parse && window.IntentParser?.parseIntent) {
            window.IntentParser.parse = window.IntentParser.parseIntent;
        }
    },

    _enqueueChatIntent(fn) {
        if (!this._chatIntentQueue) {
            this._chatIntentQueue = Promise.resolve();
        }
        const run = () => Promise.resolve().then(fn);
        const next = this._chatIntentQueue.then(run, run);
        // swallow to keep queue alive
        this._chatIntentQueue = next.catch(() => {});
        return next;
    },

    _isEditIntentType(type) {
        return new Set(['MODIFY_ELEMENT', 'DELETE_SLIDE', 'MOVE_SLIDE', 'MOVE_ELEMENT']).has(String(type || ''));
    },

    _isGenerationIntentType(type) {
        return new Set(['REDO_SLIDE', 'REDO_RANGE', 'INSERT_SLIDE', 'RESTYLE_SLIDE', 'RESTYLE_RANGE']).has(String(type || ''));
    },

    _ensureSlideIntentIds(contentPackage) {
        const pkg = contentPackage && typeof contentPackage === 'object' ? contentPackage : null;
        const intents = Array.isArray(pkg?.slideIntents) ? pkg.slideIntents : null;
        if (!intents) return;

        intents.forEach((si, i) => {
            if (!si || typeof si !== 'object') return;
            if (!si.slideIntentId) si.slideIntentId = `si_${Date.now()}_${i}_${Math.random().toString(16).slice(2)}`;
            if (typeof si.index === 'number') return;
            si.index = i;
        });
    },

    _insertSlideIntentAt(contentPackage, index) {
        const pkg = contentPackage && typeof contentPackage === 'object' ? contentPackage : null;
        if (!pkg) return false;
        if (!Array.isArray(pkg.slideIntents)) pkg.slideIntents = [];

        this._ensureSlideIntentIds(pkg);

        const insertIndex = Math.max(0, Math.min(pkg.slideIntents.length, Number(index) || 0));
        const newIntent = {
            slideIntentId: `si_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            pageType: 'content',
            title: '新页面',
            objective: '',
            keyPoints: [],
            claimIds: [],
            dataTableIds: [],
            content: '',
            index: insertIndex
        };

        pkg.slideIntents.splice(insertIndex, 0, newIntent);
        // re-index
        pkg.slideIntents.forEach((si, i) => {
            if (si && typeof si === 'object') si.index = i;
        });

        return true;
    },

    async _dispatchGenerationIntent(intent, userInput) {
        const type = String(intent?.type || '');
        if (typeof this._ensureRuntime !== 'function') {
            throw new Error('运行时未初始化，无法调用设计引擎');
        }

        // 对 “新增页面” 做最小可用的 slideIntents 插入，随后走 design.batch
        if (type === 'INSERT_SLIDE') {
            const pkg = this.workflowData?.contentPackage;
            if (!pkg) {
                this.addChatMessage('ai', '请先生成一份演示文稿（或先粘贴/上传素材）后，再新增页面。');
                return;
            }
            const baseIndex = typeof intent?.target?.slideIndex === 'number' ? intent.target.slideIndex : 0;
            const position = String(intent?.target?.position || 'after');
            const insertIndex = position === 'before' ? baseIndex : baseIndex + 1;
            const ok = this._insertSlideIntentAt(pkg, insertIndex);
            if (!ok) throw new Error('新增页面失败：contentPackage 不可用');
        }

        this.addChatMessage('ai', '正在调用设计引擎生成/优化页面，请稍候...');
        await this._ensureRuntime({ mode: 'textprep' });

        // design.batch stage reads workflowData.contentPackage by default
        await this._orchestrator.runStage('design.batch', { contentPackage: this.workflowData?.contentPackage, userInput });

        // 设计完成后，如果编辑器已初始化，同步到编辑器数据源
        if (typeof this._syncToEditor === 'function') {
            try { this._syncToEditor(); } catch (e) { /* ignore */ }
        }
    },

    async handleUserMessage(text, attachments = []) {
        // 构建消息内容
        let content = text;
        if (!content && attachments.length > 0) {
            content = `上传了 ${attachments.length} 个文件`;
        }

        console.log('[PPTGenerator] handleUserMessage:', { content: content?.slice(0, 50), attachments: attachments.length });

        // 防御性检查：确保 currentProject 存在
        if (!this.currentProject) {
            console.error('[PPTGenerator] handleUserMessage: currentProject not initialized');
            return;
        }
        if (!this.currentProject.chatHistory) {
            this.currentProject.chatHistory = [];
        }

        this.addChatMessage('user', content, null, attachments);

        // 显示"思考中"状态
        const thinkingId = `thinking_${Date.now()}`;
        this._appendThinkingIndicator(thinkingId);

        // 排队处理：避免并发指令互相覆盖（尤其是 redo/design）
        return this._enqueueChatIntent(async () => {
            try {
                await this._ensureIntentParser();

                const parse = window.IntentParser?.parse || window.IntentParser?.parseIntent;
                if (typeof parse !== 'function') {
                    console.error('[PPTGenerator] IntentParser not loaded after _ensureIntentParser');
                    throw new Error('IntentParser 未加载');
                }

                // 构建 LLM 适配器，使 IntentParser 可以使用 aiApiService
                const llmAdapter = window.aiApiService ? {
                    chat: async (messages) => {
                        try {
                            const resp = await window.aiApiService.chat({
                                messages,
                                model: 'auto',
                                usage: 'worker',
                                temperature: 0.3,
                                maxTokens: 1024,
                            });
                            return resp?.content || '';
                        } catch (e) {
                            console.warn('[PPTGenerator] LLM chat failed:', e);
                            return null;
                        }
                    }
                } : null;

                console.log('[PPTGenerator] Parsing intent...', { hasLlm: !!llmAdapter });
                const intent = await parse(content, {
                    currentSlideIndex: this.currentSlideIndex,
                    attachments,
                    llm: llmAdapter,
                });
                console.log('[PPTGenerator] Parsed intent:', intent);

                if (this._isEditIntentType(intent?.type)) {
                    if (typeof this.initEditor === 'function') {
                        await this.initEditor();
                    }
                    if (!this.editor?.executeNaturalLanguage) {
                        this.addChatMessage('ai', '当前无法执行编辑指令：编辑器未初始化。请先进入「编辑模式」。');
                        return;
                    }

                    const result = await this.editor.executeNaturalLanguage(content, {
                        currentSlideIndex: this.currentSlideIndex,
                        attachments,
                    });

                    // 同步 DSL（用于保存/回放），以及更新预览 HTML
                    if (typeof this.syncDSL === 'function') {
                        try { this.syncDSL({ reason: 'chat_edit', intent: result?.intent }); } catch (e) { /* ignore */ }
                    }

                    this.addChatMessage('ai', '已完成修改。');
                    return;
                }

                if (this._isGenerationIntentType(intent?.type)) {
                    await this._dispatchGenerationIntent(intent, content);
                    this.addChatMessage('ai', '已完成生成/优化。');
                    return;
                }

                // 兜底：未知指令 - 尝试作为普通对话处理
                console.log('[PPTGenerator] Unknown intent type:', intent?.type, '- trying chat fallback');

                // 如果有 LLM，尝试进行对话
                if (llmAdapter) {
                    try {
                        const chatReply = await window.aiApiService.chat({
                            messages: [
                                { role: 'system', content: '你是一个 PPT 设计助手。用户正在制作演示文稿，请简洁友好地回答问题或提供建议。如果用户想要执行操作，提示他们可以使用的指令格式。' },
                                { role: 'user', content: content }
                            ],
                            model: 'auto',
                            usage: 'worker',
                            temperature: 0.7,
                            maxTokens: 512,
                        });
                        if (chatReply?.content) {
                            this.addChatMessage('ai', chatReply.content);
                            return;
                        }
                    } catch (e) {
                        console.warn('[PPTGenerator] Chat fallback failed:', e);
                    }
                }

                // 无 LLM 或 LLM 失败时的兜底
                this.addChatMessage('ai', '我理解你的需求了，但暂不支持该类型指令。你可以试试：把标题改成… / 重新设计第3页 / 在第2页后新增一页');
            } catch (err) {
                console.warn('[PPTGeneratorUtilities] handleUserMessage failed:', err);
                this.addChatMessage('ai', '抱歉，我暂时无法理解这条指令。你可以换一种说法，例如：把标题改成… / 重新设计第3页。');
            } finally {
                // 移除"思考中"指示器
                this._removeThinkingIndicator(thinkingId);
            }
        });
    },

    async _saveProject() {
        if (window.pptStorage && this.currentProject) {
            // 同步 slides 数据到 currentProject
            if (this.slides) {
                this.currentProject.slides = this.slides;
            }
            await window.pptStorage.saveProject(this.currentProject);
        }
    },
    
    /**
     * 标记需要自动保存
     */
    setAutoSaveNeeded() {
        // 同步 slides 数据
        if (this.slides && this.currentProject) {
            this.currentProject.slides = this.slides;
        }
        // 触发自动保存（使用防抖）
        if (this._autoSaveTimer) {
            clearTimeout(this._autoSaveTimer);
        }
        this._autoSaveTimer = setTimeout(() => {
            this._saveProject();
        }, 2000);
    },

    async updateProjectTitle(newTitle) {
        if (this.currentProject && newTitle.trim()) {
            this.currentProject.title = newTitle.trim();
            await this._saveProject();
            // Update header title if visible
            const headerTitle = document.querySelector('.ppt-project-title');
            if (headerTitle) headerTitle.innerText = this.currentProject.title;
        }
    },

    /**
     * 调试：直接加载 Sample 数据，跳过 AI 生成过程
     */
    async debugLoadSample() {
        console.log('[Debug] Loading sample data...');
        
        // 创建临时项目
        const projectId = 'debug_' + Date.now();
        this.currentProject = {
            id: projectId,
            title: '调试项目 (Sample)',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            slides: [],
            messages: []
        };

        // 解析 Sample HTML
        if (typeof SlideParser !== 'undefined' && window.PPT_SAMPLE_HTML) {
            try {
                this.slides = SlideParser.parse(window.PPT_SAMPLE_HTML);
                this.currentProject.slides = this.slides;
                console.log('[Debug] Parsed', this.slides.length, 'slides from PPT_SAMPLE_HTML');
            } catch (e) {
                console.error('[Debug] Parse error:', e);
                alert('解析 Sample 数据失败: ' + e.message);
                return;
            }
        } else {
            alert('PPT_SAMPLE_HTML 或 SlideParser 不可用');
            return;
        }

        // 设置为完成状态，直接显示演示视图
        window.forceWorkflowState(this, window.WorkflowState.COMPLETED);
        this.currentSlideIndex = 0;
        
        // 进入工作区（会根据 state 自动渲染演示模式）
        if (typeof this.enterWorkspace === 'function') {
            this.enterWorkspace();
        } else {
            console.error('[Debug] enterWorkspace not available');
        }
        
        console.log('[Debug] Sample loaded successfully!');
    }
};

// Mixin install (legacy scripts + ESM entrypoints).
(() => {
    try {
        const ctor = PPTGeneratorCtor ||
            (typeof globalThis !== 'undefined' && globalThis.PPTGeneratorCtor?.prototype)
                ? globalThis.PPTGeneratorCtor
                : ((typeof PPTGenerator !== 'undefined' && PPTGenerator?.prototype) ? PPTGenerator : null);
        if (!ctor?.prototype) return;
        Object.assign(ctor.prototype, PPTGeneratorUtilities);
    } catch {
        // ignore
    }
})();
