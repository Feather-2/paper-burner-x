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
            summary: '',
            questions: [],
            userAnswers: {},
            script: [], // { id, content, sourceRef }
            segments: [], // { slideId, scriptIds, layout, visual }
            designDecisions: []
        };

        this.processLogs = [];
        this.todos = [];
        
        // DOM Elements
        this.elements = {
            overlay: null,
            container: null
        };
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
                            <div class="ppt-logo-icon">
                                <iconify-icon icon="carbon:bot"></iconify-icon>
                            </div>
                            <span>Agent Command Center</span>
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
                        <h1>多智能体协同工作台</h1>
                        <p>Reader · Analyst · Designer · Reviewer</p>
                        <button class="ppt-btn-primary" onclick="window.PPTGenerator.createNewProject()">
                            <iconify-icon icon="carbon:add"></iconify-icon>
                            启动新任务
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
        this.workflowData = this.currentProject.workflowData || {};
        this.state = this.currentProject.status || 'idle';
        this.enterWorkspace();
    }

    enterWorkspace() {
        this.renderWorkspaceLayout();
        this.renderChatSidebar();
        this.renderPreviewArea();
        
        if (this.state === 'idle' && this.processLogs.length === 0) {
            this.addChatMessage('ai', '指挥中心就绪。所有智能体待命。请上传资料以启动 [Reader Agent]。',
                `<button class="ppt-btn-primary" onclick="window.PPTGenerator.startMultiAgentWorkflow()">模拟多源资料上传</button>`);
        }
    }

    renderWorkspaceLayout() {
        this.elements.overlay.innerHTML = `
            <div class="ppt-app-shell">
                <header class="ppt-header">
                    <div class="ppt-header-left">
                        <div class="ppt-logo">
                            <div class="ppt-logo-icon">
                                <iconify-icon icon="carbon:bot"></iconify-icon>
                            </div>
                            <span>Agent Command Center</span>
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
                                <textarea id="pptChatInput" placeholder="向指挥中心发送指令..."></textarea>
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
        
        if (this.state === 'questioning') {
            visContent = this._renderQuestionForm();
        } else {
            // Default: Terminal & File Grid
            visContent = `
                <div class="vis-header">
                    <div class="vis-title">
                        <div class="vis-pulse"></div>
                        <span>System Activity</span>
                    </div>
                    <div style="font-family: var(--ppt-font-mono); font-size: 12px; color: var(--ppt-accent);">
                        CPU: 45% | MEM: 1.2GB
                    </div>
                </div>

                <!-- File Processing Grid (Visible during Reader phase) -->
                <div id="fileProcessingGrid" class="file-grid" style="display: ${this.state === 'reading' ? 'grid' : 'none'}">
                    <!-- Dynamic File Nodes -->
                </div>

                <!-- Terminal Log -->
                <div class="terminal-log" id="agentTerminal">
                    <!-- Logs go here -->
                </div>
            `;
        }

        // Render Agent Dashboard
        container.innerHTML = `
            <div class="agent-dashboard">
                <!-- Active Agents Panel -->
                <div class="agent-status-panel">
                    <h3>Active Agents</h3>
                    
                    ${this._renderAgentCard('reader', 'Reader Agent', 'carbon:document-view', '资料读取与预处理')}
                    ${this._renderAgentCard('analyst', 'Analyst Agent', 'carbon:data-analytics', '结构化分析与大纲')}
                    ${this._renderAgentCard('designer', 'Designer Agent', 'carbon:paint-brush', '视觉布局与配图')}
                    ${this._renderAgentCard('reviewer', 'Reviewer Agent', 'carbon:task-approved', '质量检查与合规')}
                </div>

                <!-- Central Visualization Area -->
                <div class="agent-vis-area">
                    ${visContent}
                </div>
            </div>
        `;
        
        // Restore logs if terminal exists
        const term = document.getElementById('agentTerminal');
        if (term) {
            this.processLogs.forEach(log => this._appendLogToTerminal(log));
        }
    }

    _renderQuestionForm() {
        const questions = this.workflowData.questions || [];
        return `
            <div class="ppt-question-form">
                <div class="form-header">
                    <h3><iconify-icon icon="carbon:user-speaker"></iconify-icon> Analyst Feedback Request</h3>
                    <p>为了生成更精准的演示文稿，请确认以下关键点：</p>
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
                                <input type="text" class="text-option" placeholder="或输入自定义回答..." name="q_${i}_custom">
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="form-footer">
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

    _renderAgentCard(id, name, icon, desc) {
        const agent = this.agents[id];
        const isActive = agent.status === 'active';
        return `
            <div class="agent-card ${isActive ? 'active' : ''}" id="agent-card-${id}">
                <div class="agent-header">
                    <div class="agent-avatar">
                        <iconify-icon icon="${icon}"></iconify-icon>
                    </div>
                    <div class="agent-info">
                        <h4>${name}</h4>
                        <span>${isActive ? 'Running' : 'Idle'}</span>
                    </div>
                </div>
                <div class="agent-activity">${agent.activity}</div>
            </div>
        `;
    }

    // ============================================================
    // Workflow Logic: Multi-Agent Orchestration
    // ============================================================

    async startMultiAgentWorkflow() {
        this.state = 'reading';
        this.updateTodos([
            { text: '[Reader] 深度元数据提取 (3k/10k/Search)', status: 'active' },
            { text: '[Analyst] 关键问题生成与反馈', status: 'pending' },
            { text: '[Analyst] 演讲稿脚本构建', status: 'pending' },
            { text: '[Designer] 脚本分段与溯源映射', status: 'pending' },
            { text: '[Designer] 视觉模板智能决策', status: 'pending' },
            { text: '[Reviewer] 最终渲染与验收', status: 'pending' }
        ]);
        this.renderPreviewArea();

        await this.phase1_DeepReading();
    }

    // --- Phase 1: Reader Agent (Deep Metadata Extraction) ---
    async phase1_DeepReading() {
        this._setAgentStatus('reader', 'active', 'Analyzing document structure...');
        
        const files = [
            { name: 'Project_Nebula_Specs.pdf', size: '2.4MB' },
            { name: 'Market_Research_2025.docx', size: '1.1MB' },
            { name: 'Technical_Architecture_v2.md', size: '15KB' }
        ];
        this._renderFileGrid(files);

        // Step 1.1: Initial 3000 chars scan
        await this.logTerminal('Reader', 'Strategy: Initial scan (First 3000 chars)...', 'normal');
        await this._simulateParallelReading(files, 30); // 30% progress
        await this.logTerminal('Reader', 'Warning: "Project_Nebula_Specs.pdf" summary incomplete. Missing "Budget" section.', 'warning');

        // Step 1.2: Extended 10000 chars scan
        await new Promise(r => setTimeout(r, 800));
        await this.logTerminal('Reader', 'Strategy: Extending scan window to 10,000 chars...', 'highlight');
        await this._simulateParallelReading(files, 70); // 70% progress
        await this.logTerminal('Reader', 'Info: "Budget" section found. Context confidence: 85%.', 'normal');

        // Step 1.3: Search Agent fallback
        await new Promise(r => setTimeout(r, 800));
        await this.logTerminal('Reader', 'Strategy: Invoking Search Agent for "Competitor Analysis"...', 'highlight');
        await this.logTerminal('Search', 'Querying internal knowledge base...', 'normal');
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('Search', 'Found 2 related reports. Merging context.', 'success');
        
        // Finish Phase 1
        this._renderFileGrid(files, 100); // 100% progress
        this._setAgentStatus('reader', 'idle', 'Metadata Extracted');
        
        this.updateTodos([
            { text: '[Reader] 深度元数据提取 (3k/10k/Search)', status: 'completed' },
            { text: '[Analyst] 关键问题生成与反馈', status: 'active' },
            { text: '[Analyst] 演讲稿脚本构建', status: 'pending' },
            { text: '[Designer] 脚本分段与溯源映射', status: 'pending' },
            { text: '[Designer] 视觉模板智能决策', status: 'pending' },
            { text: '[Reviewer] 最终渲染与验收', status: 'pending' }
        ]);

        this.phase2_QuestionGeneration();
    }

    // --- Phase 2: Analyst Agent (Question Generation) ---
    async phase2_QuestionGeneration() {
        this.state = 'questioning';
        this._setAgentStatus('analyst', 'active', 'Formulating strategy questions...');
        
        await this.logTerminal('Analyst', 'Analyzing content density...', 'normal');
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('Analyst', 'Identified 3 key decision points for user.', 'success');

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

        this.addChatMessage('ai', 'Reader Agent 已完成深度扫描。Analyst Agent 生成了几个关键问题，请在右侧面板确认，以便生成更精准的脚本。');
        this.renderPreviewArea(); // Will render Question Form
    }

    autoFillAnswers() {
        // Simulate AI decision
        this.submitAnswers();
    }

    async submitAnswers() {
        // In a real app, we'd gather form data here.
        this.state = 'scripting';
        this.renderPreviewArea(); // Switch back to terminal view
        
        this.updateTodos([
            { text: '[Reader] 深度元数据提取 (3k/10k/Search)', status: 'completed' },
            { text: '[Analyst] 关键问题生成与反馈', status: 'completed' },
            { text: '[Analyst] 演讲稿脚本构建', status: 'active' },
            { text: '[Designer] 脚本分段与溯源映射', status: 'pending' },
            { text: '[Designer] 视觉模板智能决策', status: 'pending' },
            { text: '[Reviewer] 最终渲染与验收', status: 'pending' }
        ]);

        this.phase3_Scripting();
    }

    // --- Phase 3: Analyst Agent (Scripting) ---
    async phase3_Scripting() {
        this._setAgentStatus('analyst', 'active', 'Drafting presentation script...');
        
        await this.logTerminal('Analyst', 'Processing user feedback...', 'normal');
        await this.logTerminal('Analyst', 'Structuring narrative arc: Problem -> Solution -> Impact', 'highlight');
        
        // Simulate batch processing of script generation
        const sections = ['Introduction', 'Market Pain Points', 'Our Solution', 'Tech Stack', 'Roadmap'];
        for (const sec of sections) {
            await new Promise(r => setTimeout(r, 600));
            await this.logTerminal('Analyst', `Drafting section: ${sec}...`, 'normal');
        }
        
        await this.logTerminal('Analyst', 'Script generation complete. 2500 words.', 'success');
        this._setAgentStatus('analyst', 'idle', 'Script Ready');

        this.updateTodos([
            { text: '[Reader] 深度元数据提取 (3k/10k/Search)', status: 'completed' },
            { text: '[Analyst] 关键问题生成与反馈', status: 'completed' },
            { text: '[Analyst] 演讲稿脚本构建', status: 'completed' },
            { text: '[Designer] 脚本分段与溯源映射', status: 'active' },
            { text: '[Designer] 视觉模板智能决策', status: 'pending' },
            { text: '[Reviewer] 最终渲染与验收', status: 'pending' }
        ]);

        this.phase4_Segmentation();
    }

    // --- Phase 4: Designer Agent (Segmentation & Mapping) ---
    async phase4_Segmentation() {
        this._setAgentStatus('designer', 'active', 'Segmenting script into slides...');
        
        await this.logTerminal('Designer', 'Analyzing semantic boundaries...', 'normal');
        await this.logTerminal('Designer', 'Mapping content to source documents (Traceability)...', 'highlight');
        
        // Simulate segmentation
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('Designer', 'Created 12 slide segments.', 'success');
        await this.logTerminal('Designer', 'Linked Segment 3 to "Market_Research_2025.docx" (p.14)', 'normal');
        await this.logTerminal('Designer', 'Linked Segment 7 to "Technical_Architecture_v2.md" (line 45)', 'normal');

        this.updateTodos([
            { text: '[Reader] 深度元数据提取 (3k/10k/Search)', status: 'completed' },
            { text: '[Analyst] 关键问题生成与反馈', status: 'completed' },
            { text: '[Analyst] 演讲稿脚本构建', status: 'completed' },
            { text: '[Designer] 脚本分段与溯源映射', status: 'completed' },
            { text: '[Designer] 视觉模板智能决策', status: 'active' },
            { text: '[Reviewer] 最终渲染与验收', status: 'pending' }
        ]);

        this.phase5_DesignOptimization();
    }

    // --- Phase 5: Designer Agent (Design Optimization) ---
    async phase5_DesignOptimization() {
        this._setAgentStatus('designer', 'active', 'Optimizing visual layout...');
        
        // Simulate batch design decision making (JSON output)
        const designSteps = [
            'Evaluating text density for Slide 1-12...',
            'Decision: Slide 4 needs a bar chart (Data detected).',
            'Decision: Slide 2 needs a hero image (Conceptual).',
            'Decision: Slide 8 split layout (Comparison detected).',
            'Applying "Dark Modern" style tokens...'
        ];

        for (const step of designSteps) {
            await new Promise(r => setTimeout(r, 800));
            await this.logTerminal('Designer', step, 'highlight');
        }

        this._setAgentStatus('designer', 'idle', 'Design Complete');
        
        this.updateTodos([
            { text: '[Reader] 深度元数据提取 (3k/10k/Search)', status: 'completed' },
            { text: '[Analyst] 关键问题生成与反馈', status: 'completed' },
            { text: '[Analyst] 演讲稿脚本构建', status: 'completed' },
            { text: '[Designer] 脚本分段与溯源映射', status: 'completed' },
            { text: '[Designer] 视觉模板智能决策', status: 'completed' },
            { text: '[Reviewer] 最终渲染与验收', status: 'active' }
        ]);

        this.phase6_FinalReview();
    }

    // --- Phase 6: Reviewer Agent ---
    async phase6_FinalReview() {
        this._setAgentStatus('reviewer', 'active', 'Final compliance check...');
        await new Promise(r => setTimeout(r, 1000));
        await this.logTerminal('Reviewer', 'All constraints satisfied.', 'success');
        this._setAgentStatus('reviewer', 'idle', 'Approved');

        this.updateTodos([
            { text: '[Reader] 深度元数据提取 (3k/10k/Search)', status: 'completed' },
            { text: '[Analyst] 关键问题生成与反馈', status: 'completed' },
            { text: '[Analyst] 演讲稿脚本构建', status: 'completed' },
            { text: '[Designer] 脚本分段与溯源映射', status: 'completed' },
            { text: '[Designer] 视觉模板智能决策', status: 'completed' },
            { text: '[Reviewer] 最终渲染与验收', status: 'completed' }
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
            <div class="file-node" id="file-node-${i}">
                <div class="file-node-header">
                    <iconify-icon icon="carbon:document"></iconify-icon>
                    ${f.name}
                </div>
                <div class="file-status">
                    <span>Reading...</span>
                    <span class="file-percent">0%</span>
                </div>
                <div class="file-progress">
                    <div class="file-progress-bar" style="width: 0%"></div>
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
                            node.querySelector('.file-progress-bar').style.width = `${updates[i].progress}%`;
                            node.querySelector('.file-percent').innerText = `${Math.floor(updates[i].progress)}%`;
                            if (updates[i].progress === 100) {
                                node.querySelector('.file-status span').innerText = 'Done';
                                node.querySelector('.file-status span').style.color = 'var(--ppt-success)';
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
        
        const div = document.createElement('div');
        div.className = 'log-line';
        div.innerHTML = `
            <span class="log-ts">[${log.time}]</span>
            <span class="log-agent">${log.agent}:</span>
            <span class="log-msg ${log.type}">${log.msg}</span>
        `;
        term.appendChild(div);
        term.scrollTop = term.scrollHeight;
    }

    // ============================================================
    // Final Presentation Mode (Dark Theme)
    // ============================================================

    renderPresentationMode(container) {
        container.innerHTML = `
            <div class="pres-container">
                <!-- Left: Script & Traceability Sidebar -->
                <div class="pres-sidebar">
                    <div class="pres-sidebar-header">
                        <h3><iconify-icon icon="carbon:script"></iconify-icon> 演讲稿与溯源</h3>
                    </div>
                    
                    <div class="pres-script-list custom-scrollbar">
                        <!-- Script Segment 1 -->
                        <div class="script-segment active">
                            <div class="segment-header">
                                <span class="seg-id">#1 封面</span>
                                <span class="seg-source"><iconify-icon icon="carbon:link"></iconify-icon> Project_Nebula_Specs.pdf</span>
                            </div>
                            <div class="segment-text">
                                各位好，今天我非常荣幸向大家介绍 Project Nebula。这是一个旨在重新定义文档智能处理的下一代平台。
                            </div>
                        </div>

                        <!-- Script Segment 2 -->
                        <div class="script-segment">
                            <div class="segment-header">
                                <span class="seg-id">#2 市场痛点</span>
                                <span class="seg-source"><iconify-icon icon="carbon:link"></iconify-icon> Market_Research_2025.docx</span>
                            </div>
                            <div class="segment-text">
                                根据最新的市场调研，我们发现 85% 的企业在处理非结构化文档时面临效率瓶颈。这正是我们切入的机会。
                            </div>
                        </div>

                        <!-- Script Segment 3 -->
                        <div class="script-segment">
                            <div class="segment-header">
                                <span class="seg-id">#3 核心架构</span>
                                <span class="seg-source"><iconify-icon icon="carbon:link"></iconify-icon> Technical_Architecture_v2.md</span>
                            </div>
                            <div class="segment-text">
                                我们的核心架构采用了多智能体协同模式，Reader, Analyst, Designer 各司其职，确保了处理的高效与精准。
                            </div>
                        </div>
                    </div>

                    <div class="pres-sidebar-footer">
                        <button class="ppt-btn-secondary w-full">
                            <iconify-icon icon="carbon:download"></iconify-icon> 导出完整脚本
                        </button>
                    </div>
                </div>

                <!-- Right: Slide Canvas -->
                <div class="pres-canvas-wrapper">
                    <div class="pres-slide">
                        <div class="slide-modern-cover">
                            <h1 style="font-size: 48px; font-weight: 800; margin-bottom: 20px;">Project Nebula</h1>
                            <p style="font-size: 24px; opacity: 0.8;">Next-Gen Document Intelligence</p>
                            <div style="margin-top: 40px; font-size: 14px; opacity: 0.6;">Generated by Agent Command Center</div>
                        </div>
                    </div>
                    
                    <div class="pres-controls">
                        <button class="pres-nav-btn"><iconify-icon icon="carbon:chevron-left"></iconify-icon></button>
                        <span style="font-family: var(--ppt-font-mono); font-size: 14px; color: var(--ppt-text-secondary);">1 / 12</span>
                        <button class="pres-nav-btn"><iconify-icon icon="carbon:chevron-right"></iconify-icon></button>
                    </div>
                </div>
            </div>
        `;
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
        
        container.innerHTML = this.todos.map(todo => `
            <div class="ppt-todo-item ${todo.status}">
                <div class="ppt-todo-icon">
                    ${todo.status === 'completed' ? '<iconify-icon icon="carbon:checkmark"></iconify-icon>' : 
                      todo.status === 'active' ? '<iconify-icon icon="carbon:circle-dash" class="animate-spin"></iconify-icon>' : 
                      '<iconify-icon icon="carbon:circle-dash"></iconify-icon>'}
                </div>
                <span>${todo.text}</span>
            </div>
        `).join('');
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
            this.addChatMessage('ai', '指令已接收。正在调度智能体...');
        }, 1000);
    }

    async _saveProject() {
        if (window.pptStorage && this.currentProject) {
            await window.pptStorage.saveProject(this.currentProject);
        }
    }
}

// Initialize
window.PPTGenerator = new PPTGenerator();
document.addEventListener('DOMContentLoaded', () => {
    if (window.PPTGenerator) window.PPTGenerator.init();
});
