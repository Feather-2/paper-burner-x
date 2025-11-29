const PPTGeneratorNavigation = {
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
                        <button class="ppt-icon-btn" onclick="window.location.href='index.html'" title="返回主页">
                            <iconify-icon icon="carbon:home"></iconify-icon>
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
    },

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
    },

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
                            <img src="public/pure.svg" alt="Logo" class="ppt-logo-img">
                            <span>智能演示文稿生成</span>
                        </div>
                        <div class="ppt-project-title">${this.currentProject.title}</div>
                    </div>
                    <div class="ppt-header-right">
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
                        <!-- Right Resizer -->
                    <div class="ppt-resizer" id="pptRightResizer" data-target="pptChatSidebar" data-min="280" data-max="500"></div>
                    <div class="ppt-chat-sidebar" id="pptChatSidebar">
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
            </div>
        `;

        this.renderTodoList();
        this._bindChatEvents();
        this._initWorkspaceResizer();
    },

    /**
     * 初始化工作区右侧分隔条
     */
    _initWorkspaceResizer() {
        const resizer = document.getElementById('pptRightResizer');
        const target = document.getElementById('pptChatSidebar');
        if (!resizer || !target) return;

        const minWidth = parseInt(resizer.dataset.min) || 280;
        const maxWidth = parseInt(resizer.dataset.max) || 500;
        let startX, startWidth;

        const onMouseDown = (e) => {
            startX = e.clientX;
            startWidth = target.offsetWidth;
            resizer.classList.add('dragging');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e) => {
            // 右侧边栏：向左拖动增加宽度
            const dx = startX - e.clientX;
            const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + dx));
            target.style.width = newWidth + 'px';
        };

        const onMouseUp = () => {
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        resizer.addEventListener('mousedown', onMouseDown);
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
