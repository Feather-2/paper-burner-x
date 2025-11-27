/**
 * PPT Generation Controller (v5.0 - Multi-Agent Command Center)
 * 
 * Implements a complex, multi-agent workflow for PPT generation:
 * 1. Multi-Agent Orchestration (Reader, Analyst, Designer, Reviewer)
 * 2. Parallel Source Processing
 * 3. Real-time Visualization of Agent Activities
 */

class PPTGenerator {
    constructor() {
        this.overlayId = 'pptGeneratorOverlay';
        this.isVisible = false;
        this.currentProject = null;
        
        // Agent State
        this.agents = {
            reader: { status: 'idle', activity: 'Waiting...' },
            analyst: { status: 'idle', activity: 'Waiting...' },
            designer: { status: 'idle', activity: 'Waiting...' },
            reviewer: { status: 'idle', activity: 'Waiting...' }
        };

        // Workflow Data
        this.workflowData = {
            files: [],
            projectSummary: '',
            questions: [],
            userAnswers: {},
            outline: [], // Mind map structure
            script: [], // { id, content, sourceRef }
            segments: [], // { slideId, scriptIds, layout, visual }
            designDecisions: []
        };

        this.processLogs = [];
        this.todos = [];
        
        this.isTodoListExpanded = true;
        
        // DOM Elements
        this.elements = {
            overlay: null,
            container: null
        };

        // Presentation State
        this.currentSlideIndex = 0;
        this.viewMode = 'slide'; // 'slide' or 'outline'
        this.slides = [
            { title: "Project Nebula", subtitle: "Next-Gen Document Intelligence", type: "cover" },
            { title: "目录", items: ["市场痛点", "解决方案", "核心架构", "竞品分析"], type: "list" },
            { title: "市场痛点", content: "85% 的企业在处理非结构化文档时面临效率瓶颈。", type: "content" },
            { title: "解决方案", content: "AI 深度协同模式，阅读、分析、设计专家各司其职。", type: "content" },
            { title: "核心架构", content: "基于深度语义理解的智能生成引擎。", type: "content" },
            { title: "竞品分析", content: "对比传统 OCR，我们的准确率提升 40%。", type: "content" }
        ];
    }

    init() {
        this.elements.overlay = document.getElementById(this.overlayId);
        if (!this.elements.overlay) return;
        
        this.elements.overlay.innerHTML = '';
        this._bindLaunchers();
        console.log('PPT Generator initialized (v5.0 Multi-Agent).');
    }

    _bindLaunchers() {
        const launchBtns = [
            document.getElementById('openPptGeneratorBtn'),
            document.getElementById('sidebarPptBtn')
        ].filter(Boolean);
        launchBtns.forEach(btn => btn.addEventListener('click', () => this.show()));
    }

    show() {
        if (this.elements.overlay) {
            this.elements.overlay.classList.remove('hidden');
            this.isVisible = true;
            this.showProjectList();
        }
    }

    hide() {
        if (this.elements.overlay) {
            this.elements.overlay.classList.add('hidden');
            this.isVisible = false;
            this.currentProject = null;
        }
    }

    // ============================================================
    // Navigation & Layout
    // ============================================================

    async showProjectList() {
        this.state = 'idle';
        this.currentProject = null;
        
        let projects = [];
        if (window.pptStorage) {
            projects = await window.pptStorage.loadProjects();
        }

        this.elements.overlay.innerHTML = `
            <div class="ppt-app-shell">
                <header class="ppt-header">
                    <div class="ppt-header-left">
                        <div class="ppt-logo">
                            <img src="public/pure.svg" alt="Logo" class="ppt-logo-img">
                            <span>智能演示文稿生成</span>
                        </div>
                    </div>
                    <div class="ppt-header-right">
                        <button class="ppt-icon-btn" onclick="window.PPTGenerator.hide()">
                            <iconify-icon icon="carbon:close"></iconify-icon>
                        </button>
                    </div>
                </header>
                <main class="ppt-project-list-view">
                    <div class="ppt-welcome-hero">
                        <div class="ppt-hero-logo">
                            <img src="public/pure.svg" alt="Logo">
                        </div>
                        <h1>智能演示文稿生成</h1>
                        <p>从文档到精美演示，只需一键。AI 驱动的专业 PPT 制作助手。</p>
                        <button class="ppt-btn-primary" onclick="window.PPTGenerator.createNewProject()">
                            <iconify-icon icon="carbon:add"></iconify-icon>
                            开始创作
                        </button>
                    </div>
                    <div class="ppt-project-grid">
                        ${projects.map(p => `
                            <div class="ppt-project-card" onclick="window.PPTGenerator.loadProject('${p.id}')">
                                <div class="ppt-card-icon">
                                    <iconify-icon icon="carbon:presentation-file"></iconify-icon>
                                </div>
                                <div class="ppt-card-info">
                                    <h3>${p.title || '未命名项目'}</h3>
                                    <span>${new Date(p.updatedAt).toLocaleDateString()}</span>
                                </div>
                                <button class="ppt-card-delete-btn" onclick="event.stopPropagation(); window.PPTGenerator.confirmDeleteProject('${p.id}')" title="删除项目">
                                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </main>
            </div>
        `;
    }

    async createNewProject() {
        const newProject = {
            id: crypto.randomUUID(),
            title: 'New Mission',
            status: 'idle',
            chatHistory: [],
            logs: [],
            todos: [],
            workflowData: {},
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        if (window.pptStorage) {
            await window.pptStorage.saveProject(newProject);
        }
        this.loadProject(newProject.id);
    }

    async loadProject(id) {
        if (window.pptStorage) {
            this.currentProject = await window.pptStorage.getProject(id);
        }
        this.processLogs = this.currentProject.logs || [];
        this.todos = this.currentProject.todos || [];
        
        // Ensure workflowData and its children are initialized
        this.workflowData = this.currentProject.workflowData || {};
        if (!this.workflowData.files) this.workflowData.files = [];
        if (!this.workflowData.questions) this.workflowData.questions = [];
        if (!this.workflowData.outline) this.workflowData.outline = [];

        this.state = this.currentProject.status || 'idle';
        this.enterWorkspace();
    }

    enterWorkspace() {
        this.renderWorkspaceLayout();
        this.renderChatSidebar();
        this.renderPreviewArea();
        
        if (this.state === 'idle' && this.processLogs.length === 0) {
            this.addChatMessage('ai', '智能助手就绪。请上传资料以开始生成演示文稿。');
        }
    }

    renderWorkspaceLayout() {
        this.elements.overlay.innerHTML = `
            <div class="ppt-app-shell">
                <header class="ppt-header">
                    <div class="ppt-header-left">
                        <div class="ppt-logo">
                            <img src="public/pure.svg" alt="Logo" class="ppt-logo-img">
                            <span>智能演示文稿生成</span>
                        </div>
                        <div class="ppt-project-title">${this.currentProject.title}</div>
                    </div>
                    <div class="ppt-header-right">
                        <button class="ppt-icon-btn" onclick="window.PPTGenerator.showProjectList()">
                            <iconify-icon icon="carbon:grid"></iconify-icon>
                        </button>
                        <button class="ppt-icon-btn" onclick="window.PPTGenerator.hide()">
                            <iconify-icon icon="carbon:close"></iconify-icon>
                        </button>
                    </div>
                </header>
                <div class="ppt-workspace">
                    <div class="ppt-preview-area" id="pptPreviewArea">
                        <!-- Dynamic Agent Dashboard -->
                    </div>
                    <div class="ppt-chat-sidebar">
                        <div class="ppt-todo-tracker" id="pptTodoTracker"></div>
                        <div class="ppt-chat-history" id="pptChatHistory"></div>
                        <div class="ppt-chat-input-area">
                            <div class="ppt-chat-input-wrapper">
                                <textarea id="pptChatInput" placeholder="输入您的指令或反馈..."></textarea>
                                <div class="ppt-chat-actions">
                                    <button class="ppt-btn-primary" id="pptSendBtn">
                                        <iconify-icon icon="carbon:send-alt"></iconify-icon> 发送
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this.renderTodoList();
        this._bindChatEvents();
    }

    _bindChatEvents() {
        const input = document.getElementById('pptChatInput');
        const sendBtn = document.getElementById('pptSendBtn');

        const sendMessage = () => {
            const text = input.value.trim();
            if (!text) return;
            this.handleUserMessage(text);
            input.value = '';
        };

        sendBtn.addEventListener('click', sendMessage);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    // ============================================================
    // Agent Dashboard Rendering
    // ============================================================

    renderPreviewArea() {
        const container = document.getElementById('pptPreviewArea');
        if (!container) return;

        if (this.state === 'completed') {
            this.renderPresentationMode(container);
            return;
        }

        // Determine what to show in the central visualization area based on state
        let visContent = '';
        
        if (this.state === 'idle') {
            visContent = this._renderUploadView();
        } else if (this.state === 'questioning') {
            visContent = this._renderQuestionForm();
        } else if (this.state === 'outline_review') {
            visContent = this._renderOutlineReview();
        } else {
            // Default: Simplified Generation View
            visContent = `
                <div class="generation-container">
                    <!-- Progress Stepper -->
                    <div class="gen-stepper">
                        ${this._renderStep('reading', '1', '阅读')}
                        <div class="gen-step-line"></div>
                        ${this._renderStep('questioning', '2', '分析')}
                        <div class="gen-step-line"></div>
                        ${this._renderStep('outline_review', '3', '大纲')}
                        <div class="gen-step-line"></div>
                        ${this._renderStep('scripting', '4', '创作')}
                        <div class="gen-step-line"></div>
                        ${this._renderStep('designer', '5', '设计')}
                    </div>

                    <!-- Main Visualizer -->
                    <div class="gen-visualizer">
                        <div class="gen-status-icon">
                            <iconify-icon icon="${this._getCurrentStatusIcon()}"></iconify-icon>
                        </div>
                        <h2 class="gen-title">${this._getCurrentStatusTitle()}</h2>
                        <p class="gen-subtitle">${this._getCurrentStatusDesc()}</p>

                        <!-- File List (Only show during reading) -->
                        <div id="fileProcessingGrid" class="gen-file-list" style="display: ${this.state === 'reading' ? 'flex' : 'none'}">
                            <!-- Dynamic File Nodes -->
                        </div>

                        <!-- Minimal Log Ticker -->
                        <div class="gen-log-ticker" id="agentTerminal">
                            <!-- Logs go here -->
                        </div>
                    </div>
                </div>
            `;
        }

        // Render Simplified Dashboard (No more grid layout)
        container.innerHTML = visContent;
        
        // Restore logs if terminal exists
        const term = document.getElementById('agentTerminal');
        if (term) {
            this.processLogs.forEach(log => this._appendLogToTerminal(log));
        }
    }

    _renderUploadView() {
        const files = this.workflowData.files || [];
        const hasFiles = files.length > 0;
        
        return `
            <div class="generation-container">
                <div class="ppt-upload-zone" id="pptUploadZone">
                    <iconify-icon icon="carbon:cloud-upload" class="ppt-upload-icon"></iconify-icon>
                    <div class="ppt-upload-text">点击或拖拽上传文档</div>
                    <div class="ppt-upload-subtext">支持 PDF, DOCX, MD, TXT (最大 50MB)</div>
                    <input type="file" id="pptFileInput" class="ppt-file-input" multiple onchange="window.PPTGenerator.handleFileUpload(this.files)">
                </div>

                <div class="ppt-upload-actions">
                    <button class="ppt-upload-btn" onclick="window.PPTGenerator.openHistorySelector()">
                        <iconify-icon icon="carbon:time"></iconify-icon> 从历史项目选择
                    </button>
                    <button class="ppt-upload-btn" onclick="window.PPTGenerator.openUrlInput()">
                        <iconify-icon icon="carbon:link"></iconify-icon> 添加链接资源
                    </button>
                </div>

                ${hasFiles ? `
                    <div class="ppt-upload-list">
                        ${files.map((f, i) => `
                            <div class="ppt-upload-item">
                                <iconify-icon icon="${f.type === 'history' ? 'carbon:time' : 'carbon:document'}" class="ppt-upload-item-icon"></iconify-icon>
                                <div class="ppt-upload-item-info">
                                    <div class="ppt-upload-item-name">${f.name}</div>
                                    <div class="ppt-upload-item-meta">${f.size || 'History Project'}</div>
                                </div>
                                <iconify-icon icon="carbon:close" class="ppt-upload-item-remove" onclick="window.PPTGenerator.removeFile(${i})"></iconify-icon>
                            </div>
                        `).join('')}
                    </div>
                    <button class="ppt-btn-primary" style="margin-top: 24px; width: 100%; max-width: 600px; justify-content: center;" onclick="window.PPTGenerator.startMultiAgentWorkflow()">
                        开始分析 (${files.length} 个资源)
                    </button>
                ` : `
                    <div style="margin-top: 24px; text-align: center; color: var(--ppt-text-secondary); font-size: 13px;">
                        <p>AI 将自动分析文档结构、提取关键信息并生成演示大纲</p>
                    </div>
                `}
            </div>
        `;
    }

    openHistorySelector() {
        // Ensure files array exists
        if (!this.workflowData.files) this.workflowData.files = [];

        // Mock adding a history project
        this.workflowData.files.push({
            name: "Q3 财务报表分析 (History)",
            type: "history",
            size: "Project"
        });
        this.renderPreviewArea();
    }

    openUrlInput() {
        const url = prompt("请输入文章或文档链接:");
        if (url && url.trim()) {
            if (!this.workflowData.files) this.workflowData.files = [];
            this.workflowData.files.push({
                name: url,
                type: "link",
                size: "URL"
            });
            this.renderPreviewArea();
        }
    }

    removeFile(index) {
        this.workflowData.files.splice(index, 1);
        this.renderPreviewArea();
    }

    _renderQuestionForm() {
        const questions = this.workflowData.questions || [];
        return `
            <div class="ppt-question-form">
                <div class="form-header">
                    <h3><iconify-icon icon="carbon:user-speaker"></iconify-icon> 需求确认</h3>
                    <p>AI 已分析文档，请确认以下关键策略以定制演示文稿：</p>
                </div>
                <div class="form-body custom-scrollbar">
                    ${questions.map((q, i) => `
                        <div class="form-group">
                            <label>${i + 1}. ${q.text}</label>
                            <div class="form-options">
                                ${q.options.map(opt => `
                                    <label class="radio-option">
                                        <input type="radio" name="q_${i}" value="${opt}" ${opt === q.default ? 'checked' : ''}>
                                        <span>${opt}</span>
                                    </label>
                                `).join('')}
                                <div style="display: flex; gap: 8px; margin-top: 8px;">
                                    <input type="text" class="ppt-input-field" placeholder="或输入自定义回答..." name="q_${i}_custom">
                                    <button class="ppt-icon-btn" title="咨询 AI 助手" onclick="window.PPTGenerator.askAssistantAboutQuestion(${i})">
                                        <iconify-icon icon="carbon:chat-bot"></iconify-icon>
                                    </button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="form-footer">
                    <div style="flex: 1; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ppt-text-secondary);">
                        <iconify-icon icon="carbon:information"></iconify-icon>
                        <span>您也可以在右侧聊天栏直接提出修改意见</span>
                    </div>
                    <button class="ppt-btn-secondary" onclick="window.PPTGenerator.autoFillAnswers()">
                        <iconify-icon icon="carbon:magic-wand"></iconify-icon> AI 自动决策
                    </button>
                    <button class="ppt-btn-primary" onclick="window.PPTGenerator.submitAnswers()">
                        确认并继续 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                    </button>
                </div>
            </div>
        `;
    }

    askAssistantAboutQuestion(index) {
        const question = this.workflowData.questions[index];
        this.addChatMessage('ai', `关于问题 **"${question.text}"**，根据文档分析，我建议选择 **"${question.default}"**，因为文档主要侧重于...`);
    }

    _renderOutlineReview() {
        // Mock outline data if not present or empty
        let outline = this.workflowData.outline;
        if (!outline || outline.length === 0) {
            outline = [
                { title: "项目背景与痛点", subs: ["当前文档处理效率低下", "非结构化数据提取困难"] },
                { title: "核心解决方案", subs: ["AI 深度阅读引擎", "多智能体协同架构"] },
                { title: "技术优势", subs: ["上下文语义理解", "跨文档知识融合"] },
                { title: "商业价值", subs: ["降低 80% 人力成本", "提升 40% 准确率"] }
            ];
            // Save the mock outline so edits are preserved
            this.workflowData.outline = outline;
        }

        return `
            <div class="ppt-question-form">
                <div class="form-header">
                    <h3><iconify-icon icon="carbon:tree-view-alt"></iconify-icon> 大纲确认</h3>
                    <p>AI 已根据您的需求生成演示大纲，请确认或调整：</p>
                </div>
                <div class="form-body custom-scrollbar">
                    <div class="ppt-outline-toolbar" style="margin-bottom: 16px; display: flex; gap: 8px;">
                        <button class="ppt-btn-secondary" onclick="window.PPTGenerator.addOutlineItem()" style="font-size: 12px; padding: 6px 12px;">
                            <iconify-icon icon="carbon:add-alt"></iconify-icon> 添加新章节
                        </button>
                        <button class="ppt-btn-secondary" onclick="window.PPTGenerator.toggleOutlineEditMode()" style="font-size: 12px; padding: 6px 12px;">
                            <iconify-icon icon="carbon:edit"></iconify-icon> Markdown 编辑
                        </button>
                    </div>
                    
                    <div id="pptOutlineVisualEditor" class="ppt-outline-editor">
                        ${outline.map((item, i) => `
                            <div class="outline-node-card" style="margin-bottom: 16px; padding: 16px; border: 1px solid var(--ppt-border); border-radius: 8px; position: relative;">
                                <button class="ppt-icon-btn" onclick="window.PPTGenerator.removeOutlineItem(${i})" title="删除章节" style="position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; padding: 4px;">
                                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                                </button>
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                                    <span style="font-weight: 600; color: var(--ppt-accent);">${i + 1}.</span>
                                    <input type="text" class="ppt-input-field" value="${item.title}" style="font-weight: 600;" onchange="window.PPTGenerator.updateOutlineTitle(${i}, this.value)">
                                </div>
                                <div style="padding-left: 24px;">
                                    ${item.subs.map((sub, j) => `
                                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                            <iconify-icon icon="carbon:dot-mark" style="color: var(--ppt-text-muted); font-size: 10px;"></iconify-icon>
                                            <input type="text" class="ppt-input-field" value="${sub}" style="font-size: 13px; padding: 6px 8px;" onchange="window.PPTGenerator.updateOutlineSub(${i}, ${j}, this.value)">
                                            <button class="ppt-icon-btn" onclick="window.PPTGenerator.removeOutlineSub(${i}, ${j})" title="删除子项" style="padding: 4px; width: 24px; height: 24px;">
                                                <iconify-icon icon="carbon:close"></iconify-icon>
                                            </button>
                                        </div>
                                    `).join('')}
                                    <button class="ppt-btn-secondary" onclick="window.PPTGenerator.addOutlineSub(${i})" style="margin-top: 8px; padding: 4px 12px; font-size: 12px;">
                                        <iconify-icon icon="carbon:add"></iconify-icon> 添加子项
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>

                    <div id="pptOutlineMarkdownEditor" class="hidden" style="height: 100%;">
                        <textarea id="pptOutlineMarkdownInput" class="w-full h-full p-4 border border-slate-200 rounded-lg font-mono text-sm" style="min-height: 400px; resize: none;" placeholder="# 章节标题&#10;- 子项内容"></textarea>
                        <div style="margin-top: 8px; text-align: right;">
                            <button class="ppt-btn-primary" onclick="window.PPTGenerator.saveMarkdownOutline()">
                                <iconify-icon icon="carbon:save"></iconify-icon> 保存并返回
                            </button>
                        </div>
                    </div>
                </div>
                <div class="form-footer">
                    <button class="ppt-btn-secondary" onclick="window.PPTGenerator.regenerateOutline()">
                        <iconify-icon icon="carbon:renew"></iconify-icon> 重新生成
                    </button>
                    <button class="ppt-btn-primary" onclick="window.PPTGenerator.confirmOutline()">
                        确认大纲 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                    </button>
                </div>
            </div>
        `;
    }

    addOutlineItem() {
        if (!this.workflowData.outline) this.workflowData.outline = [];
        this.workflowData.outline.push({ title: "新章节", subs: ["新子项"] });
        this.renderPreviewArea();
    }

    removeOutlineItem(index) {
        if (!this.workflowData.outline) return;
        this.workflowData.outline.splice(index, 1);
        this.renderPreviewArea();
    }

    toggleOutlineEditMode() {
        const visualEditor = document.getElementById('pptOutlineVisualEditor');
        const mdEditor = document.getElementById('pptOutlineMarkdownEditor');
        const mdInput = document.getElementById('pptOutlineMarkdownInput');
        
        if (visualEditor && mdEditor) {
            if (mdEditor.classList.contains('hidden')) {
                // Switch to Markdown
                const mdText = this.workflowData.outline.map(item => {
                    return `# ${item.title}\n${item.subs.map(sub => `- ${sub}`).join('\n')}`;
                }).join('\n\n');
                
                mdInput.value = mdText;
                visualEditor.classList.add('hidden');
                mdEditor.classList.remove('hidden');
            } else {
                // Switch to Visual (Cancel)
                mdEditor.classList.add('hidden');
                visualEditor.classList.remove('hidden');
            }
        }
    }

    saveMarkdownOutline() {
        const mdInput = document.getElementById('pptOutlineMarkdownInput');
        if (!mdInput) return;

        const text = mdInput.value;
        const lines = text.split('\n');
        const newOutline = [];
        let currentItem = null;

        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('#')) {
                if (currentItem) newOutline.push(currentItem);
                currentItem = { title: trimmed.replace(/^#+\s*/, ''), subs: [] };
            } else if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
                if (currentItem) {
                    currentItem.subs.push(trimmed.replace(/^[-*]\s*/, ''));
                }
            } else if (trimmed.length > 0 && currentItem) {
                 // Treat plain text as sub item if under a header
                 currentItem.subs.push(trimmed);
            }
        });
        if (currentItem) newOutline.push(currentItem);

        this.workflowData.outline = newOutline;
        this.renderPreviewArea();
    }

    _renderStep(stepState, num, label) {
        // Simple logic to determine active/completed state
        const states = ['idle', 'reading', 'questioning', 'outline_review', 'scripting', 'designer', 'reviewer', 'completed'];
        const currentIndex = states.indexOf(this.state);
        const stepIndex = states.indexOf(stepState);
        
        let className = 'gen-step';
        if (this.state === stepState) className += ' active';
        if (currentIndex > stepIndex) className += ' completed';

        return `
            <div class="${className}">
                <div class="gen-step-icon">
                    ${currentIndex > stepIndex ? '<iconify-icon icon="carbon:checkmark"></iconify-icon>' : num}
                </div>
                <span class="gen-step-label">${label}</span>
            </div>
        `;
    }

    _getCurrentStatusIcon() {
        if (this.state === 'reading') return 'carbon:document-view';
        if (this.state === 'questioning') return 'carbon:user-speaker';
        if (this.state === 'scripting') return 'carbon:edit';
        if (this.state === 'designer') return 'carbon:paint-brush';
        return 'carbon:bot';
    }

    _getCurrentStatusTitle() {
        if (this.state === 'reading') return '正在深度阅读文档...';
        if (this.state === 'questioning') return '需要您的确认';
        if (this.state === 'outline_review') return '大纲确认';
        if (this.state === 'scripting') return '正在构建演示大纲...';
        if (this.state === 'designer') return '正在进行视觉设计...';
        return '准备就绪';
    }

    _getCurrentStatusDesc() {
        if (this.state === 'reading') return 'AI 正在分析文档结构并提取关键信息';
        if (this.state === 'questioning') return '请确认几个关键选项以定制演示风格';
        if (this.state === 'outline_review') return 'AI 已根据您的需求生成演示大纲，请确认或调整';
        if (this.state === 'scripting') return '正在梳理逻辑结构并撰写演讲备注';
        if (this.state === 'designer') return '正在匹配最佳模板并生成页面布局';
        return '请上传文档或输入主题开始';
    }

    // ============================================================
    // Workflow Logic: Multi-Agent Orchestration
    // ============================================================

    handleFileUpload(fileList) {
        // Convert FileList to array and mock processing
        const newFiles = Array.from(fileList).map(f => ({ name: f.name, size: this._formatSize(f.size), type: 'file' }));
        if (newFiles.length === 0) return;

        if (!this.workflowData.files) this.workflowData.files = [];
        this.workflowData.files = [...this.workflowData.files, ...newFiles];
        this.renderPreviewArea();
    }

    _formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    async startMultiAgentWorkflow() {
        this.state = 'reading';
        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'active' },
            { text: '关键需求分析与确认', status: 'pending' },
            { text: '生成演示大纲与脚本', status: 'pending' },
            { text: '智能分段与内容映射', status: 'pending' },
            { text: '视觉设计与排版优化', status: 'pending' },
            { text: '最终渲染与质量检查', status: 'pending' }
        ]);
        this.renderPreviewArea();

        await this.phase1_DeepReading();
    }

    // --- Phase 1: Reader Agent (Deep Metadata Extraction) ---
    async phase1_DeepReading() {
        this._setAgentStatus('reader', 'active', 'Analyzing document structure...');
        
        const files = (this.workflowData.files && this.workflowData.files.length > 0) ? this.workflowData.files : [
            { name: 'Project_Nebula_Specs.pdf', size: '2.4MB', type: 'file' },
            { name: 'Market_Research_2025.docx', size: '1.1MB', type: 'file' }
        ];
        this._renderFileGrid(files);

        // Step 1.1: Initial 3000 chars scan
        await this.logTerminal('AI 阅读', `正在并行扫描 ${files.length} 个资源 (前 3000 字符)...`, 'normal');
        await this._simulateParallelReading(files, 30); // 30% progress
        
        // Simulate finding incomplete info
        await new Promise(r => setTimeout(r, 800));
        const firstFile = files[0] || { name: 'Document' };
        await this.logTerminal('AI 阅读', `提示: "${firstFile.name}" 摘要不完整，正在深入扫描...`, 'warning');

        // Step 1.2: Extended 10000 chars scan
        await new Promise(r => setTimeout(r, 800));
        await this.logTerminal('AI 阅读', '扩展扫描范围至 10,000 字符...', 'highlight');
        await this._simulateParallelReading(files, 70); // 70% progress
        await this.logTerminal('AI 阅读', '信息确认: 已定位 "预算" 相关章节。上下文置信度: 85%。', 'normal');

        // Step 1.3: Search Agent fallback (Simulated)
        await new Promise(r => setTimeout(r, 800));
        await this.logTerminal('AI 阅读', '正在调用搜索助手补充 "竞品分析" 数据...', 'highlight');
        await this.logTerminal('AI 搜索', '正在查询内部知识库...', 'normal');
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('AI 搜索', '找到 2 份相关报告，正在合并上下文。', 'success');
        
        // Finish Phase 1
        this._renderFileGrid(files, 100); // 100% progress
        this._setAgentStatus('reader', 'idle', 'Metadata Extracted');
        
        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'active' },
            { text: '生成演示大纲与脚本', status: 'pending' },
            { text: '智能分段与内容映射', status: 'pending' },
            { text: '视觉设计与排版优化', status: 'pending' },
            { text: '最终渲染与质量检查', status: 'pending' }
        ]);

        this.phase2_QuestionGeneration();
    }

    // --- Phase 2: Analyst Agent (Question Generation) ---
    async phase2_QuestionGeneration() {
        this.state = 'questioning';
        this._setAgentStatus('analyst', 'active', 'Formulating strategy questions...');
        
        await this.logTerminal('AI 分析', '正在分析内容密度...', 'normal');
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('AI 分析', '识别出 3 个关键决策点，需要用户确认。', 'success');

        // Mock Questions
        this.workflowData.questions = [
            {
                text: "目标受众的技术背景如何？",
                options: ["非技术高管 (侧重商业价值)", "技术团队 (侧重架构细节)", "混合受众"],
                default: "混合受众"
            },
            {
                text: "演示文稿的色调风格偏好？",
                options: ["深色科技风 (Dark Modern)", "学术严谨 (Academic)", "商务极简 (Business Light)"],
                default: "深色科技风 (Dark Modern)"
            },
            {
                text: "是否需要包含详细的财务报表数据？",
                options: ["是，包含详细图表", "否，仅展示关键指标摘要"],
                default: "否，仅展示关键指标摘要"
            }
        ];

        this.addChatMessage('ai', '已完成深度扫描。为了生成更精准的演示文稿，请确认右侧的关键选项。');
        this.renderPreviewArea(); // Will render Question Form
    }

    autoFillAnswers() {
        // Simulate AI decision
        this.submitAnswers();
    }

    async submitAnswers() {
        // In a real app, we'd gather form data here.
        this.state = 'outline_review';
        this.renderPreviewArea(); // Show Outline Review
        
        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'completed' },
            { text: '生成演示大纲与脚本', status: 'active' }, // Still active as outline is part of this
            { text: '智能分段与内容映射', status: 'pending' },
            { text: '视觉设计与排版优化', status: 'pending' },
            { text: '最终渲染与质量检查', status: 'pending' }
        ]);
    }

    confirmOutline() {
        this.state = 'scripting';
        this.renderPreviewArea(); // Switch back to terminal view
        this.phase3_Scripting();
    }

    regenerateOutline() {
        this.addChatMessage('ai', '正在重新生成大纲，请稍候...');
        // Mock regeneration delay
        setTimeout(() => {
            this.renderPreviewArea();
        }, 1000);
    }

    updateOutlineTitle(index, value) {
        if (!this.workflowData.outline) return;
        this.workflowData.outline[index].title = value;
    }

    updateOutlineSub(parentIndex, subIndex, value) {
        if (!this.workflowData.outline) return;
        this.workflowData.outline[parentIndex].subs[subIndex] = value;
    }

    addOutlineSub(parentIndex) {
        if (!this.workflowData.outline) return;
        this.workflowData.outline[parentIndex].subs.push("新子项");
        this.renderPreviewArea();
    }

    removeOutlineSub(parentIndex, subIndex) {
        if (!this.workflowData.outline) return;
        this.workflowData.outline[parentIndex].subs.splice(subIndex, 1);
        this.renderPreviewArea();
    }

    // --- Phase 3: Analyst Agent (Scripting) ---
    async phase3_Scripting() {
        this._setAgentStatus('analyst', 'active', 'Drafting presentation script...');
        
        await this.logTerminal('AI 分析', '正在处理用户反馈...', 'normal');
        await this.logTerminal('AI 分析', '构建叙事结构: 问题 -> 解决方案 -> 价值影响', 'highlight');
        
        // Simulate batch processing of script generation
        const sections = ['引言', '市场痛点', '解决方案', '技术架构', '未来规划'];
        for (const sec of sections) {
            await new Promise(r => setTimeout(r, 600));
            await this.logTerminal('AI 分析', `正在撰写章节: ${sec}...`, 'normal');
        }
        
        await this.logTerminal('AI 分析', '演讲稿脚本生成完成。共 2500 字。', 'success');
        this._setAgentStatus('analyst', 'idle', 'Script Ready');

        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'completed' },
            { text: '生成演示大纲与脚本', status: 'completed' },
            { text: '智能分段与内容映射', status: 'active' },
            { text: '视觉设计与排版优化', status: 'pending' },
            { text: '最终渲染与质量检查', status: 'pending' }
        ]);

        this.phase4_Segmentation();
    }

    // --- Phase 4: Designer Agent (Segmentation & Mapping) ---
    async phase4_Segmentation() {
        this._setAgentStatus('designer', 'active', 'Segmenting script into slides...');
        
        await this.logTerminal('AI 设计', '正在分析语义边界...', 'normal');
        await this.logTerminal('AI 设计', '正在建立内容溯源映射...', 'highlight');
        
        // Simulate segmentation
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('AI 设计', '已生成 12 个幻灯片分段。', 'success');
        
        // Mock Source Mapping
        const sourceFiles = this.workflowData.files.length > 0 ? this.workflowData.files : [{name: 'Project_Nebula_Specs.pdf'}];
        await this.logTerminal('AI 设计', `分段 3 已关联至 "${sourceFiles[0].name}" (p.14)`, 'normal');
        if (sourceFiles.length > 1) {
            await this.logTerminal('AI 设计', `分段 7 已关联至 "${sourceFiles[1].name}" (line 45)`, 'normal');
        }

        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'completed' },
            { text: '生成演示大纲与脚本', status: 'completed' },
            { text: '智能分段与内容映射', status: 'completed' },
            { text: '视觉设计与排版优化', status: 'active' },
            { text: '最终渲染与质量检查', status: 'pending' }
        ]);

        this.phase5_DesignOptimization();
    }

    // --- Phase 5: Designer Agent (Design Optimization) ---
    async phase5_DesignOptimization() {
        this._setAgentStatus('designer', 'active', 'Optimizing visual layout...');
        
        // Simulate batch design decision making (JSON output)
        const designSteps = [
            { msg: '正在评估幻灯片 1-12 的文本密度...', type: 'normal' },
            { msg: '决策: 幻灯片 4 需要柱状图 (检测到数据)。', type: 'highlight' },
            { msg: '决策: 幻灯片 2 需要首图 (概念性内容)。', type: 'highlight' },
            { msg: '决策: 幻灯片 8 使用分栏布局 (检测到对比内容)。', type: 'highlight' },
            { msg: '正在应用 "深色科技" 风格主题...', type: 'normal' }
        ];

        for (const step of designSteps) {
            await new Promise(r => setTimeout(r, 800));
            await this.logTerminal('AI 设计', step.msg, step.type);
        }

        this._setAgentStatus('designer', 'idle', 'Design Complete');
        
        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'completed' },
            { text: '生成演示大纲与脚本', status: 'completed' },
            { text: '智能分段与内容映射', status: 'completed' },
            { text: '视觉设计与排版优化', status: 'completed' },
            { text: '最终渲染与质量检查', status: 'active' }
        ]);

        this.phase6_FinalReview();
    }

    // --- Phase 6: Reviewer Agent ---
    async phase6_FinalReview() {
        this._setAgentStatus('reviewer', 'active', 'Final compliance check...');
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('AI 审查', '所有约束条件已满足。', 'success');
        this._setAgentStatus('reviewer', 'idle', 'Approved');

        this.updateTodos([
            { text: '深度阅读与信息提取', status: 'completed' },
            { text: '关键需求分析与确认', status: 'completed' },
            { text: '生成演示大纲与脚本', status: 'completed' },
            { text: '智能分段与内容映射', status: 'completed' },
            { text: '视觉设计与排版优化', status: 'completed' },
            { text: '最终渲染与质量检查', status: 'completed' }
        ]);

        this.state = 'completed';
        this.currentProject.status = 'completed';
        this._saveProject();
        
        this.addChatMessage('ai', '任务完成。演示文稿已生成。');
        setTimeout(() => this.renderPreviewArea(), 1000);
    }

    _setAgentStatus(id, status, activity) {
        this.agents[id] = { status, activity };
        // Re-render just the agent cards if possible, or full area
        this.renderPreviewArea();
    }

    _renderFileGrid(files) {
        const grid = document.getElementById('fileProcessingGrid');
        if (!grid) return;
        
        grid.innerHTML = files.map((f, i) => `
            <div class="gen-file-item" id="file-node-${i}">
                <div class="gen-file-icon">
                    <iconify-icon icon="carbon:document"></iconify-icon>
                </div>
                <div class="gen-file-name">${f.name}</div>
                <div class="gen-file-status">
                    <span class="file-percent">0%</span>
                </div>
            </div>
        `).join('');
    }

    async _simulateParallelReading(files, targetProgress = 100) {
        // If we are continuing, we need to know current progress.
        // For simplicity in this simulation, we just animate from 0 or previous known state.
        // But here we'll just animate to targetProgress.
        
        const updates = files.map(() => ({ progress: 0 })); // Reset for demo or track properly
        
        return new Promise(resolve => {
            const interval = setInterval(() => {
                let allReached = true;
                files.forEach((_, i) => {
                    if (updates[i].progress < targetProgress) {
                        updates[i].progress += Math.random() * 5; // Slower
                        if (updates[i].progress > targetProgress) updates[i].progress = targetProgress;
                        
                        // Update DOM
                        const node = document.getElementById(`file-node-${i}`);
                        if (node) {
                            // node.querySelector('.file-progress-bar').style.width = `${updates[i].progress}%`; // Removed bar
                            node.querySelector('.file-percent').innerText = `${Math.floor(updates[i].progress)}%`;
                            if (updates[i].progress === 100) {
                                node.querySelector('.gen-file-status').innerHTML = '<iconify-icon icon="carbon:checkmark-filled" style="color: var(--ppt-success)"></iconify-icon>';
                            }
                        }
                        allReached = false;
                    }
                });
                
                if (allReached) {
                    clearInterval(interval);
                    resolve();
                }
            }, 100);
        });
    }

    async logTerminal(agent, msg, type = 'normal') {
        const entry = { time: new Date().toLocaleTimeString(), agent, msg, type };
        this.processLogs.push(entry);
        this.currentProject.logs = this.processLogs;
        this._saveProject();
        this._appendLogToTerminal(entry);
        await new Promise(r => setTimeout(r, 300)); // Typing delay
    }

    _appendLogToTerminal(log) {
        const term = document.getElementById('agentTerminal');
        if (!term) return;
        
        // Minimal ticker style: just show the latest message with a dot
        term.innerHTML = `
            <div class="gen-log-dot"></div>
            <div class="gen-log-content">
                <span style="font-weight: 600; color: var(--ppt-accent);">${log.agent}:</span>
                <span>${log.msg}</span>
            </div>
        `;
        
        // Ensure the terminal scrolls to show the latest message if needed,
        // though currently it replaces content. If we want history, we'd append.
        // For now, just ensuring the container can handle the height.
    }

    // ============================================================
    // Final Presentation Mode (Dark Theme)
    // ============================================================

    renderPresentationMode(container) {
        container.innerHTML = `
            <div class="pres-container">
                <!-- Top Toolbar -->
                <div class="pres-toolbar">
                    <div class="pres-toolbar-left">
                        <button class="ppt-icon-btn" onclick="window.PPTGenerator.enterWorkspace()">
                            <iconify-icon icon="carbon:arrow-left"></iconify-icon>
                        </button>
                        <div class="pres-title-wrapper">
                            <input type="text" class="pres-title-input" value="${this.currentProject.title}" onblur="window.PPTGenerator.updateProjectTitle(this.value)" onkeydown="if(event.key === 'Enter') this.blur()">
                            <iconify-icon icon="carbon:edit" class="pres-title-icon"></iconify-icon>
                        </div>
                    </div>
                    <div class="pres-toolbar-center">
                        <button class="pres-view-btn ${this.viewMode === 'slide' ? 'active' : ''}" onclick="window.PPTGenerator.toggleViewMode('slide')">幻灯片</button>
                        <button class="pres-view-btn ${this.viewMode === 'outline' ? 'active' : ''}" onclick="window.PPTGenerator.toggleViewMode('outline')">大纲视图</button>
                    </div>
                    <div class="ppt-header-right">
                        <button class="ppt-btn-primary">
                            <iconify-icon icon="carbon:export"></iconify-icon> 导出 PPTX
                        </button>
                    </div>
                </div>

                <!-- Main Area -->
                <div class="pres-main-area">
                    <!-- Canvas -->
                    <div class="pres-canvas-wrapper">
                        ${this.viewMode === 'slide' ? `
                            <div class="pres-slide" id="presSlideCanvas">
                                ${this._renderSlideContent(this.slides[this.currentSlideIndex])}
                            </div>

                            <!-- Floating Pagination -->
                            <div class="pres-pagination">
                                <button class="pres-page-btn" onclick="window.PPTGenerator.prevSlide()"><iconify-icon icon="carbon:chevron-left"></iconify-icon></button>
                                <span class="pres-page-info" id="presPageInfo">${this.currentSlideIndex + 1} / ${this.slides.length}</span>
                                <button class="pres-page-btn" onclick="window.PPTGenerator.nextSlide()"><iconify-icon icon="carbon:chevron-right"></iconify-icon></button>
                            </div>
                        ` : `
                            <div class="pres-outline-view custom-scrollbar">
                                ${this._renderOutlineContent()}
                            </div>
                        `}
                    </div>
                </div>

                <!-- Bottom Thumbnail Strip -->
                <div class="pres-bottom-strip">
                    <div class="pres-strip-header">
                        <span>幻灯片概览</span>
                        <span style="cursor: pointer"><iconify-icon icon="carbon:maximize"></iconify-icon></span>
                    </div>
                    <div class="pres-thumbnails custom-scrollbar" id="presThumbnails">
                        ${this.slides.map((slide, index) => `
                            <div class="pres-thumb-card ${index === this.currentSlideIndex ? 'active' : ''}" onclick="window.PPTGenerator.goToSlide(${index})">
                                <div class="pres-thumb-preview" style="${index === 0 ? 'background: #eff6ff; color: #3b82f6;' : ''}">${slide.title}</div>
                                <div class="pres-thumb-num">${index + 1}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================
    // Presentation Navigation Logic
    // ============================================================

    _renderSlideContent(slide) {
        if (slide.type === 'cover') {
            return `
                <div class="slide-modern-cover">
                    <h1 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 48px; font-weight: 800; margin-bottom: 20px;">${slide.title}</h1>
                    <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'subtitle', this.innerText)" style="font-size: 24px; opacity: 0.8;">${slide.subtitle}</p>
                    <div style="margin-top: 40px; font-size: 14px; opacity: 0.6;">Generated by Paper Burner X</div>
                </div>
            `;
        } else if (slide.type === 'list') {
            return `
                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 40px;">${slide.title}</h2>
                    <ul style="font-size: 24px; color: var(--ppt-text-secondary); line-height: 1.8; padding-left: 40px;">
                        ${slide.items.map((item, i) => `<li contenteditable="true" onblur="window.PPTGenerator.updateSlideItem(${this.currentSlideIndex}, ${i}, this.innerText)">${item}</li>`).join('')}
                    </ul>
                </div>
            `;
        } else {
            return `
                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column; justify-content: center;">
                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 24px;">${slide.title}</h2>
                    <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'content', this.innerText)" style="font-size: 24px; color: var(--ppt-text-secondary); line-height: 1.6;">${slide.content}</p>
                </div>
            `;
        }
    }

    updateSlideContent(slideIndex, field, value) {
        if (this.slides[slideIndex]) {
            this.slides[slideIndex][field] = value;
            // Also update outline view if visible
            if (this.viewMode === 'outline') {
                this.renderPresentationMode(document.getElementById('pptPreviewArea'));
            } else {
                // Update thumbnails
                this._updateSlideView();
            }
        }
    }

    updateSlideItem(slideIndex, itemIndex, value) {
        if (this.slides[slideIndex] && this.slides[slideIndex].items) {
            this.slides[slideIndex].items[itemIndex] = value;
            this._updateSlideView();
        }
    }

    toggleViewMode(mode) {
        this.viewMode = mode;
        this.renderPresentationMode(document.getElementById('pptPreviewArea'));
    }

    _getScriptForSlide(index) {
        const scripts = [
            "各位好，今天我将为大家介绍 Project Nebula，这是我们下一代的文档智能处理平台。",
            "首先，让我们快速浏览一下今天的议程。我们将从市场痛点切入，深入探讨我们的解决方案和核心架构。",
            "在深入技术细节之前，我们必须正视当前的市场现状。数据显示，超过 85% 的企业数据是非结构化的。",
            "针对这一挑战，我们提出了基于 AI 深度协同的全新模式。不仅仅是 OCR，更是理解。",
            "这是我们的核心架构图。可以看到，语义理解引擎处于中心位置，连接着各个处理模块。",
            "最后，用数据说话。在与传统 OCR 方案的对比测试中，我们的准确率实现了质的飞跃。"
        ];
        return scripts[index] || "暂无演讲备注。";
    }

    _renderOutlineContent() {
        return `
            <div class="ppt-outline-container">
                ${this.slides.map((slide, index) => `
                    <div class="ppt-outline-item" onclick="window.PPTGenerator.goToSlideFromOutline(${index})">
                        <div class="ppt-outline-num">${index + 1}</div>
                        <div class="ppt-outline-content">
                            <div class="ppt-outline-title">${slide.title}</div>
                            ${slide.subtitle ? `<div class="ppt-outline-text">${slide.subtitle}</div>` : ''}
                            ${slide.content ? `<div class="ppt-outline-text">${slide.content}</div>` : ''}
                            ${slide.items ? `
                                <ul class="ppt-outline-list">
                                    ${slide.items.map(item => `<li>${item}</li>`).join('')}
                                </ul>
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    goToSlideFromOutline(index) {
        this.currentSlideIndex = index;
        this.toggleViewMode('slide');
    }

    goToSlide(index) {
        if (index >= 0 && index < this.slides.length) {
            this.currentSlideIndex = index;
            this._updateSlideView();
        }
    }

    prevSlide() {
        if (this.currentSlideIndex > 0) {
            this.currentSlideIndex--;
            this._updateSlideView();
        }
    }

    nextSlide() {
        if (this.currentSlideIndex < this.slides.length - 1) {
            this.currentSlideIndex++;
            this._updateSlideView();
        }
    }

    _updateSlideView() {
        // Update Canvas
        const canvas = document.getElementById('presSlideCanvas');
        if (canvas) {
            canvas.innerHTML = this._renderSlideContent(this.slides[this.currentSlideIndex]);
        }

        // Update Pagination Text
        const pageInfo = document.getElementById('presPageInfo');
        if (pageInfo) {
            pageInfo.innerText = `${this.currentSlideIndex + 1} / ${this.slides.length}`;
        }

        // Update Thumbnails
        const thumbsContainer = document.getElementById('presThumbnails');
        if (thumbsContainer) {
            const thumbs = thumbsContainer.querySelectorAll('.pres-thumb-card');
            thumbs.forEach((thumb, index) => {
                if (index === this.currentSlideIndex) {
                    thumb.classList.add('active');
                    thumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                } else {
                    thumb.classList.remove('active');
                }
            });
        }
    }

    // ============================================================
    // Shared Utilities
    // ============================================================

    updateTodos(newTodos) {
        this.todos = newTodos;
        this.currentProject.todos = newTodos;
        this._saveProject();
        this.renderTodoList();
    }

    renderTodoList() {
        const container = document.getElementById('pptTodoTracker');
        if (!container) return;
        
        if (this.todos.length === 0) {
            container.style.display = 'none';
            return;
        }
        container.style.display = 'block';
        
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

        const chevronIcon = this.isTodoListExpanded ? 'carbon:chevron-up' : 'carbon:chevron-down';
        const contentStyle = this.isTodoListExpanded ? '' : 'display: none;';

        container.innerHTML = `
            <div class="ppt-todo-header" onclick="window.PPTGenerator.toggleTodoList()">
                <span>当前任务进度</span>
                <iconify-icon icon="${chevronIcon}"></iconify-icon>
            </div>
            <div class="ppt-todo-content" style="${contentStyle}">
                ${listHtml}
            </div>
        `;
    }

    toggleTodoList() {
        this.isTodoListExpanded = !this.isTodoListExpanded;
        this.renderTodoList();
    }

    renderChatSidebar() {
        const container = document.getElementById('pptChatHistory');
        if (!container) return;
        container.innerHTML = '';
        this.currentProject.chatHistory.forEach(msg => this._appendMessageToDOM(msg));
        this._scrollToBottom();
    }

    addChatMessage(role, content, actionHtml = null) {
        const msg = { role, content, action: actionHtml, timestamp: Date.now() };
        this.currentProject.chatHistory.push(msg);
        this._saveProject();
        this._appendMessageToDOM(msg);
        this._scrollToBottom();
    }

    _appendMessageToDOM(msg) {
        const container = document.getElementById('pptChatHistory');
        const div = document.createElement('div');
        div.className = `ppt-message ${msg.role}`;
        div.innerHTML = `
            <div class="ppt-avatar ${msg.role}">
                ${msg.role === 'ai' ? 'AI' : '<iconify-icon icon="carbon:user"></iconify-icon>'}
            </div>
            <div class="ppt-bubble">
                ${marked.parse(msg.content)}
                ${msg.action ? `<div class="ppt-bubble-action">${msg.action}</div>` : ''}
            </div>
        `;
        container.appendChild(div);
    }

    _scrollToBottom() {
        const container = document.getElementById('pptChatHistory');
        if (container) container.scrollTop = container.scrollHeight;
    }

    async handleUserMessage(text) {
        this.addChatMessage('user', text);
        setTimeout(() => {
            this.addChatMessage('ai', '指令已接收。正在为您安排任务...');
        }, 1000);
    }

    async _saveProject() {
        if (window.pptStorage && this.currentProject) {
            await window.pptStorage.saveProject(this.currentProject);
        }
    }

    async updateProjectTitle(newTitle) {
        if (this.currentProject && newTitle.trim()) {
            this.currentProject.title = newTitle.trim();
            await this._saveProject();
            // Update header title if visible
            const headerTitle = document.querySelector('.ppt-project-title');
            if (headerTitle) headerTitle.innerText = this.currentProject.title;
        }
    }

    // ============================================================
    // Project Deletion (Multi-step Confirmation)
    // ============================================================

    confirmDeleteProject(id) {
        this.projectToDelete = id;
        this.deleteStep = 1;
        this._renderDeleteModal();
    }

    _renderDeleteModal() {
        let modal = document.getElementById('pptDeleteModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'pptDeleteModal';
            modal.className = 'ppt-modal-overlay';
            document.body.appendChild(modal);
        }

        let content = '';
        if (this.deleteStep === 1) {
            content = `
                <div class="ppt-modal-card">
                    <div class="ppt-modal-header">
                        <h3><iconify-icon icon="carbon:warning-alt" style="color: var(--ppt-warning)"></iconify-icon> 确认删除</h3>
                    </div>
                    <div class="ppt-modal-body">
                        <p>您确定要删除此项目吗？此操作不可恢复。</p>
                    </div>
                    <div class="ppt-modal-footer">
                        <button class="ppt-btn-secondary" onclick="window.PPTGenerator.closeDeleteModal()">取消</button>
                        <button class="ppt-btn-danger" onclick="window.PPTGenerator.advanceDeleteStep()">继续删除</button>
                    </div>
                </div>
            `;
        } else if (this.deleteStep === 2) {
            content = `
                <div class="ppt-modal-card">
                    <div class="ppt-modal-header">
                        <h3><iconify-icon icon="carbon:warning-filled" style="color: #ef4444"></iconify-icon> 最终确认</h3>
                    </div>
                    <div class="ppt-modal-body">
                        <p>请输入 <strong>"确认删除"</strong> 以永久删除此项目。</p>
                        <input type="text" id="pptDeleteConfirmInput" class="ppt-input-field" placeholder="确认删除">
                    </div>
                    <div class="ppt-modal-footer">
                        <button class="ppt-btn-secondary" onclick="window.PPTGenerator.closeDeleteModal()">取消</button>
                        <button class="ppt-btn-danger" id="pptFinalDeleteBtn" disabled onclick="window.PPTGenerator.executeDelete()">永久删除</button>
                    </div>
                </div>
            `;
        }

        modal.innerHTML = content;
        modal.classList.remove('hidden');

        if (this.deleteStep === 2) {
            const input = document.getElementById('pptDeleteConfirmInput');
            const btn = document.getElementById('pptFinalDeleteBtn');
            input.addEventListener('input', (e) => {
                btn.disabled = e.target.value !== '确认删除';
            });
        }
    }

    advanceDeleteStep() {
        this.deleteStep = 2;
        this._renderDeleteModal();
    }

    closeDeleteModal() {
        const modal = document.getElementById('pptDeleteModal');
        if (modal) {
            modal.classList.add('hidden');
            setTimeout(() => modal.remove(), 200); // Allow for fade out if added
        }
        this.projectToDelete = null;
        this.deleteStep = 0;
    }

    async executeDelete() {
        if (this.projectToDelete && window.pptStorage) {
            await window.pptStorage.deleteProject(this.projectToDelete);
            this.closeDeleteModal();
            this.showProjectList(); // Refresh list
        }
    }
}

// Initialize
window.PPTGenerator = new PPTGenerator();
document.addEventListener('DOMContentLoaded', () => {
    if (window.PPTGenerator) window.PPTGenerator.init();
});
