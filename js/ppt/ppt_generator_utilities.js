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
                ${msg.content ? marked.parse(msg.content) : ''}
                ${msg.action ? `<div class="ppt-bubble-action">${msg.action}</div>` : ''}
            </div>
        `;
        container.appendChild(div);
    },

    _scrollToBottom() {
        const container = document.getElementById('pptChatHistory');
        if (container) container.scrollTop = container.scrollHeight;
    },

    async handleUserMessage(text, attachments = []) {
        // 构建消息内容
        let content = text;
        if (!content && attachments.length > 0) {
            content = `上传了 ${attachments.length} 个文件`;
        }
        
        this.addChatMessage('user', content, null, attachments);
        
        setTimeout(() => {
            const fileNames = attachments.map(a => a.name).join(', ');
            const response = attachments.length > 0 
                ? `已收到文件: ${fileNames}。正在分析内容...`
                : '指令已接收。正在为您安排任务...';
            this.addChatMessage('ai', response);
        }, 1000);
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

        // 直接显示编辑器视图
        this.state = 'working';
        this.currentSlideIndex = 0;
        
        // 渲染工作区
        if (typeof this.renderWorkspace === 'function') {
            this.renderWorkspace();
        } else {
            console.error('[Debug] renderWorkspace not available');
        }
        
        console.log('[Debug] Sample loaded successfully!');
    }
};

Object.assign(PPTGenerator.prototype, PPTGeneratorUtilities);
