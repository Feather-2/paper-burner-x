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

        const completedCount = this.todos.filter(t => t.status === 'completed').length;
        const totalCount = this.todos.length;
        const progressText = !this.isTodoListExpanded ? `<span style="font-weight: normal; color: var(--ppt-text-muted); margin-left: 8px;">(${completedCount}/${totalCount})</span>` : '';

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
        this.currentProject.chatHistory.forEach(msg => this._appendMessageToDOM(msg));
        this._scrollToBottom();
    },

    addChatMessage(role, content, actionHtml = null) {
        const msg = { role, content, action: actionHtml, timestamp: Date.now() };
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

        div.innerHTML = `
            ${avatarHtml}
            <div class="ppt-bubble">
                ${marked.parse(msg.content)}
                ${msg.action ? `<div class="ppt-bubble-action">${msg.action}</div>` : ''}
            </div>
        `;
        container.appendChild(div);
    },

    _scrollToBottom() {
        const container = document.getElementById('pptChatHistory');
        if (container) container.scrollTop = container.scrollHeight;
    },

    async handleUserMessage(text) {
        this.addChatMessage('user', text);
        setTimeout(() => {
            this.addChatMessage('ai', '指令已接收。正在为您安排任务...');
        }, 1000);
    },

    async _saveProject() {
        if (window.pptStorage && this.currentProject) {
            await window.pptStorage.saveProject(this.currentProject);
        }
    },

    async updateProjectTitle(newTitle) {
        if (this.currentProject && newTitle.trim()) {
            this.currentProject.title = newTitle.trim();
            await this._saveProject();
            // Update header title if visible
            const headerTitle = document.querySelector('.ppt-project-title');
            if (headerTitle) headerTitle.innerText = this.currentProject.title;
        }
    }
};

Object.assign(PPTGenerator.prototype, PPTGeneratorUtilities);
