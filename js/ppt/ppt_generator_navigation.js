const PPTGeneratorNavigation = {
    async showProjectList() {
        this.state = 'idle';
        this.currentProject = null;

        let projects = [];
        if (window.pptStorage) {
            projects = await window.pptStorage.loadProjects();
        }

        // Sort projects by updatedAt desc
        projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        // Check model status
        const langConfig = window.PPTModelConfigModal ? window.PPTModelConfigModal.loadConfig('lang') : null;
        const imgConfig = window.PPTModelConfigModal ? window.PPTModelConfigModal.loadConfig('img') : null;
        
        const hasLangModel = langConfig && langConfig.modelKey;
        const hasImgModel = imgConfig && imgConfig.modelKey;
        
        const langStatusColor = hasLangModel ? 'var(--ppt-success)' : 'var(--ppt-warning)';
        const imgStatusColor = hasImgModel ? 'var(--ppt-success)' : 'var(--ppt-text-muted)';

        // View mode state (default to grid)
        if (!this.projectListViewMode) this.projectListViewMode = 'grid';
        if (!this.activeTab) this.activeTab = 'recent'; // 'recent' or 'examples'

        this.elements.overlay.innerHTML = `
            <div class="ppt-app-shell">
                <header class="ppt-header">
                    <div class="ppt-header-left">
                        <div class="ppt-logo">
                            <img src="public/h_with_name.svg" alt="Logo" class="ppt-logo-img" style="width: 100px; height: auto;">
                        </div>
                    </div>
                    <div class="ppt-header-right">
                        <button class="ppt-icon-btn" onclick="if(window.PPTModelConfigModal) window.PPTModelConfigModal.openModal()" title="模型配置">
                            <iconify-icon icon="carbon:settings"></iconify-icon>
                        </button>
                        <button class="ppt-icon-btn" onclick="window.location.href='index.html'" title="返回主页">
                            <iconify-icon icon="carbon:home"></iconify-icon>
                        </button>
                    </div>
                </header>
                <main class="ppt-project-list-view">
                    <!-- Modern Hero Section (Split Layout) -->
                    <div class="ppt-hero-section">
                        <div class="ppt-hero-content">
                            <div class="ppt-hero-badge">
                                <iconify-icon icon="carbon:sparkle" style="color: var(--ppt-primary)"></iconify-icon>
                                <span>AI 驱动的演示文稿生成器</span>
                            </div>
                            
                            <h1 class="ppt-hero-title">
                                从文档到精美演示<br>只需一键
                            </h1>
                            
                            <p class="ppt-hero-subtitle">
                                上传您的文档，让 AI 助手为您自动提取大纲、撰写内容、设计排版，生成专业的 PPT 演示文稿。
                            </p>

                            <!-- Hero Actions -->
                            <div class="ppt-hero-actions">
                                <button class="ppt-cta-btn" onclick="window.PPTGenerator.createNewProject()">
                                    <iconify-icon icon="carbon:add-large"></iconify-icon>
                                    开始新创作
                                </button>
                                
                                <div class="ppt-status-row">
                                    <div class="ppt-status-pill-minimal">
                                        <iconify-icon icon="carbon:model-alt" style="color: ${langStatusColor}"></iconify-icon>
                                        <span>${hasLangModel ? '语言模型就绪' : '需配置语言模型'}</span>
                                    </div>
                                    <div class="ppt-status-pill-minimal">
                                        <iconify-icon icon="carbon:image" style="color: ${imgStatusColor}"></iconify-icon>
                                        <span>${hasImgModel ? '图像模型就绪' : '图像模型可选'}</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Feature Highlights (New) -->
                            <div class="ppt-hero-features">
                                <div class="ppt-feature-item">
                                    <div class="ppt-feature-icon">
                                        <iconify-icon icon="carbon:ibm-watson-discovery"></iconify-icon>
                                    </div>
                                    <div class="ppt-feature-text">
                                        <strong>智能大纲</strong>
                                        <span>一键生成结构</span>
                                    </div>
                                </div>
                                <div class="ppt-feature-item">
                                    <div class="ppt-feature-icon">
                                        <iconify-icon icon="carbon:template"></iconify-icon>
                                    </div>
                                    <div class="ppt-feature-text">
                                        <strong>自动排版</strong>
                                        <span>智能布局设计</span>
                                    </div>
                                </div>
                                <div class="ppt-feature-item">
                                    <div class="ppt-feature-icon">
                                        <iconify-icon icon="carbon:document-export"></iconify-icon>
                                    </div>
                                    <div class="ppt-feature-text">
                                        <strong>原生导出</strong>
                                        <span>可编辑 PPTX</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Hero Visual Preview -->
                        <div class="ppt-hero-visual">
                            <div class="ppt-visual-card main">
                                <div class="ppt-visual-header">
                                    <div class="ppt-visual-dots">
                                        <span></span><span></span><span></span>
                                    </div>
                                    <div class="ppt-visual-title">Quantum Computing.pptx</div>
                                </div>
                                <div class="ppt-visual-content">
                                    <div class="ppt-slide-preview-hero">
                                        <h1>QUANTUM LEAP</h1>
                                        <p style="font-size: 18px; opacity: 0.8; margin-top: 16px;">Unlocking the Universe's Compute Power</p>
                                        <div class="ppt-slide-hero-grid" style="margin-top: 40px;">
                                            <div class="ppt-hero-grid-item" style="display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">Foundations</div>
                                            <div class="ppt-hero-grid-item" style="display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">Algorithms</div>
                                            <div class="ppt-hero-grid-item" style="display: flex; align-items: center; justify-content: center; color: white; font-size: 12px;">Hardware</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="ppt-visual-card back-1"></div>
                            <div class="ppt-visual-card back-2"></div>
                            
                            <!-- Floating Elements -->
                            <div class="ppt-float-badge badge-1">
                                <iconify-icon icon="carbon:magic-wand-filled"></iconify-icon>
                                <span>AI Auto-Layout</span>
                            </div>
                            <div class="ppt-float-badge badge-2">
                                <iconify-icon icon="carbon:document-export"></iconify-icon>
                                <span>Export to PPTX</span>
                            </div>
                        </div>
                    </div>

                    ${projects.length > 0 ? `
                        <!-- Projects Section with Tabs -->
                        <div class="ppt-projects-section">
                            <div class="ppt-section-header">
                                <div class="ppt-section-tabs">
                                    <button class="ppt-section-tab active">
                                        最近项目
                                    </button>
                                </div>
                                <div class="ppt-view-toggle">
                                    <button class="ppt-icon-btn ${this.projectListViewMode === 'grid' ? 'active' : ''}" onclick="window.PPTGenerator.toggleProjectView('grid')" title="网格视图">
                                        <iconify-icon icon="carbon:grid"></iconify-icon>
                                    </button>
                                    <button class="ppt-icon-btn ${this.projectListViewMode === 'list' ? 'active' : ''}" onclick="window.PPTGenerator.toggleProjectView('list')" title="列表视图">
                                        <iconify-icon icon="carbon:list"></iconify-icon>
                                    </button>
                                </div>
                            </div>
                            
                            ${projects.length > 0 ? (this.projectListViewMode === 'grid' ? `
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
                            ` : `
                                <div class="ppt-project-list">
                                    ${projects.map(p => `
                                        <div class="ppt-project-list-item" onclick="window.PPTGenerator.loadProject('${p.id}')">
                                            <div class="ppt-list-icon">
                                                <iconify-icon icon="carbon:presentation-file"></iconify-icon>
                                            </div>
                                            <div class="ppt-list-info">
                                                <div class="ppt-list-title">${p.title || '未命名项目'}</div>
                                                <div class="ppt-list-meta">
                                                    更新于 ${new Date(p.updatedAt).toLocaleString()}
                                                </div>
                                            </div>
                                            <div class="ppt-list-actions">
                                                <button class="ppt-icon-btn" onclick="event.stopPropagation(); window.PPTGenerator.confirmDeleteProject('${p.id}')" title="删除项目">
                                                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                                                </button>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            `) : `
                                <!-- Empty State Templates -->
                                <div class="ppt-empty-templates">
                                    <div class="ppt-empty-header">
                                        <span class="ppt-empty-label">快速开始</span>
                                        <p>选择一个场景或直接开始新创作</p>
                                    </div>
                                    <div class="ppt-template-grid">
                                        <div class="ppt-template-card" onclick="window.PPTGenerator.createNewProject('academic')">
                                            <div class="ppt-template-preview t-academic">
                                                <iconify-icon icon="carbon:education"></iconify-icon>
                                            </div>
                                            <div class="ppt-template-info">
                                                <h4>学术报告</h4>
                                                <p>论文答辩、研究分享</p>
                                            </div>
                                        </div>
                                        <div class="ppt-template-card" onclick="window.PPTGenerator.createNewProject('business')">
                                            <div class="ppt-template-preview t-business">
                                                <iconify-icon icon="carbon:chart-line"></iconify-icon>
                                            </div>
                                            <div class="ppt-template-info">
                                                <h4>商业计划</h4>
                                                <p>项目路演、市场分析</p>
                                            </div>
                                        </div>
                                        <div class="ppt-template-card" onclick="window.PPTGenerator.createNewProject('creative')">
                                            <div class="ppt-template-preview t-creative">
                                                <iconify-icon icon="carbon:palette"></iconify-icon>
                                            </div>
                                            <div class="ppt-template-info">
                                                <h4>创意设计</h4>
                                                <p>作品集、视觉展示</p>
                                            </div>
                                        </div>
                                        <div class="ppt-template-card" onclick="window.PPTGenerator.createNewProject('minimal')">
                                            <div class="ppt-template-preview t-minimal">
                                                <iconify-icon icon="carbon:clean"></iconify-icon>
                                            </div>
                                            <div class="ppt-template-info">
                                                <h4>极简风格</h4>
                                                <p>通用汇报、简单演示</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            `}
                        </div>
                    ` : ''}
                </main>
            </div>
        `;
    },

    toggleProjectView(mode) {
        this.projectListViewMode = mode;
        this.showProjectList();
    },

    switchTab(tab) {
        this.activeTab = tab;
        this.showProjectList();
    },

    async createNewProject(template = 'default') {
        const titles = {
            'academic': '未命名学术报告',
            'business': '未命名商业计划',
            'creative': '未命名创意演示',
            'minimal': '未命名演示文稿',
            'default': 'New Mission'
        };

        const newProject = {
            id: crypto.randomUUID(),
            title: titles[template] || titles['default'],
            template: template,
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
    },

    async loadProject(id) {
        if (window.pptStorage) {
            this.currentProject = await window.pptStorage.getProject(id);
        }
        if (!this.currentProject) {
            this.currentProject = { id, logs: [], todos: [], workflowData: {} };
        }
        this.processLogs = this.currentProject.logs || [];
        this.todos = this.currentProject.todos || [];

        // Ensure workflowData and its children are initialized
        this.workflowData = this.currentProject.workflowData || {};
        if (!this.workflowData.files) this.workflowData.files = [];
        if (!this.workflowData.questions) this.workflowData.questions = [];
        if (!this.workflowData.outline) this.workflowData.outline = [];

        // 加载保存的 slides 数据
        if (this.currentProject.slides && this.currentProject.slides.length > 0) {
            this.slides = this.currentProject.slides;
        }

        this.state = this.currentProject.status || 'idle';
        this.enterWorkspace();
    },

    enterWorkspace() {
        this.renderWorkspaceLayout();
        this.renderChatSidebar();
        this.renderPreviewArea();

        if (this.state === 'idle' && this.processLogs.length === 0) {
            this.addChatMessage('ai', '智能助手就绪。请上传资料以开始生成演示文稿。');
        }
    },

    renderWorkspaceLayout() {
        this.elements.overlay.innerHTML = `
            <div class="ppt-app-shell">
                <header class="ppt-header">
                    <div class="ppt-header-left">
                        <div class="ppt-logo">
                            <img src="public/h_with_name.svg" alt="Logo" class="ppt-logo-img" style="width: 100px; height: auto;">
                        </div>
                        <div class="ppt-project-title">${this.currentProject.title}</div>
                    </div>
                    <div class="ppt-header-right">
                        <button class="ppt-icon-btn" onclick="window.PPTGenerator.toggleChatSidebar()" title="切换侧边栏">
                            <iconify-icon icon="carbon:side-panel-open"></iconify-icon>
                        </button>
                        <button class="ppt-icon-btn" onclick="window.PPTGenerator.showProjectList()" title="项目列表">
                            <iconify-icon icon="carbon:grid"></iconify-icon>
                        </button>
                        <button class="ppt-icon-btn" onclick="window.location.href='index.html'" title="返回主页">
                            <iconify-icon icon="carbon:home"></iconify-icon>
                        </button>
                    </div>
                </header>
                <div class="ppt-workspace">
                    <div class="ppt-preview-area" id="pptPreviewArea">
                        <!-- Dynamic Agent Dashboard -->
                    </div>
                    <div class="ppt-chat-sidebar" id="pptChatSidebar">
                        <div class="ppt-chat-wrapper">
                            <div class="ppt-todo-tracker" id="pptTodoTracker"></div>
                            <div class="ppt-chat-history" id="pptChatHistory"></div>
                            <div class="ppt-chat-input-area">
                                <div class="ppt-chat-attachments" id="pptChatAttachments"></div>
                                <div class="ppt-chat-input-wrapper">
                                    <button class="ppt-attach-btn" id="pptAttachBtn" title="上传文件或图片">
                                        <iconify-icon icon="carbon:attachment"></iconify-icon>
                                    </button>
                                    <textarea id="pptChatInput" placeholder="输入您的指令或反馈..."></textarea>
                                    <button class="ppt-send-btn" id="pptSendBtn">
                                        <iconify-icon icon="carbon:send-alt"></iconify-icon>
                                    </button>
                                </div>
                                <input type="file" id="pptFileInput" multiple accept="image/*,.pdf,.docx,.pptx,.txt,.md" hidden>
                            </div>
                        </div>
                    </div>
                    <div class="ppt-resizer" id="pptResizer"></div>
                </div>
            </div>
        `;

        this.renderTodoList();
        this._bindChatEvents();
        this._bindResizerEvents();
    },

    toggleChatSidebar() {
        const sidebar = document.getElementById('pptChatSidebar');
        const previewArea = document.getElementById('pptPreviewArea');
        const resizer = document.getElementById('pptResizer');
        
        if (sidebar && previewArea) {
            const isCollapsed = sidebar.classList.toggle('collapsed');
            previewArea.classList.toggle('expanded');
            
            if (resizer) {
                resizer.classList.toggle('collapsed', isCollapsed);
            }
            
            if (isCollapsed) {
                previewArea.style.marginRight = '0';
            } else {
                const sidebarWidth = sidebar.style.width ? parseInt(sidebar.style.width) : 400;
                previewArea.style.marginRight = `${sidebarWidth + 40}px`;
            }
        }
    },

    _bindResizerEvents() {
        const resizer = document.getElementById('pptResizer');
        const sidebar = document.getElementById('pptChatSidebar');
        const previewArea = document.getElementById('pptPreviewArea');
        
        if (!resizer || !sidebar || !previewArea) return;

        const RIGHT_MARGIN = 24; // chat sidebar 右边距
        const MIN_WIDTH = 260;
        const MAX_WIDTH = 360;

        let startX, startWidth;

        const updatePositions = (newWidth) => {
            // 更新 sidebar 宽度
            sidebar.style.width = `${newWidth}px`;
            // resizer 紧贴 chat 左边缘: right = sidebarWidth + rightMargin
            resizer.style.right = `${newWidth + RIGHT_MARGIN}px`;
            // 预览区 margin 跟随
            previewArea.style.marginRight = `${newWidth + RIGHT_MARGIN + 16}px`;
            // 更新 canvas 尺寸（如果在 presentation 模式）
            if (this._updateCanvasSize) {
                this._updateCanvasSize();
            }
        };

        const onMouseMove = (e) => {
            // 向左拖动增加宽度，向右拖动减少宽度
            const deltaX = startX - e.clientX;
            let newWidth = startWidth + deltaX;
            
            // 限制范围
            newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
            
            updatePositions(newWidth);
        };

        const onMouseUp = () => {
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        const onMouseDown = (e) => {
            e.preventDefault();
            startX = e.clientX;
            startWidth = sidebar.getBoundingClientRect().width;
            
            resizer.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        resizer.addEventListener('mousedown', onMouseDown);
        
        // 初始化位置
        const initialWidth = sidebar.getBoundingClientRect().width || 400;
        resizer.style.right = `${initialWidth + RIGHT_MARGIN}px`;
    },

    _bindChatEvents() {
        const input = document.getElementById('pptChatInput');
        const sendBtn = document.getElementById('pptSendBtn');
        const attachBtn = document.getElementById('pptAttachBtn');
        const fileInput = document.getElementById('pptFileInput');
        const attachmentsContainer = document.getElementById('pptChatAttachments');

        // 存储待发送的附件
        this.pendingAttachments = [];

        const sendMessage = () => {
            const text = input.value.trim();
            if (!text && this.pendingAttachments.length === 0) return;
            this.handleUserMessage(text, this.pendingAttachments);
            input.value = '';
            this.pendingAttachments = [];
            this._renderAttachments();
        };

        sendBtn.addEventListener('click', sendMessage);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // 附件按钮点击
        attachBtn.addEventListener('click', () => fileInput.click());

        // 文件选择处理
        fileInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            files.forEach(file => {
                this.pendingAttachments.push({
                    file,
                    name: file.name,
                    type: file.type,
                    preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null
                });
            });
            this._renderAttachments();
            fileInput.value = ''; // 重置以允许重复选择
        });
    },

    _renderAttachments() {
        const container = document.getElementById('pptChatAttachments');
        if (!container) return;

        if (!this.pendingAttachments || this.pendingAttachments.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = this.pendingAttachments.map((att, index) => `
            <div class="ppt-attachment-item">
                ${att.preview 
                    ? `<img src="${att.preview}" alt="${att.name}">` 
                    : `<iconify-icon icon="carbon:document" style="font-size: 20px; color: #64748b;"></iconify-icon>`
                }
                <span class="ppt-attachment-name">${att.name}</span>
                <span class="ppt-attachment-remove" onclick="window.PPTGenerator.removeAttachment(${index})">
                    <iconify-icon icon="carbon:close"></iconify-icon>
                </span>
            </div>
        `).join('');
    },

    removeAttachment(index) {
        if (this.pendingAttachments[index]?.preview) {
            URL.revokeObjectURL(this.pendingAttachments[index].preview);
        }
        this.pendingAttachments.splice(index, 1);
        this._renderAttachments();
    }
};

Object.assign(PPTGenerator.prototype, PPTGeneratorNavigation);
