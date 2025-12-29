const PPTGeneratorNavigation = {
    async _ensureWorkflowReady() {
        if (!this.__pptWorkflowMixinsReady) return;
        try {
            await this.__pptWorkflowMixinsReady;
        } catch {
            // ignore workflow load failures, fall back to local state
        }
    },

    _forceWorkflowStateSafe(state) {
        const target = state || window.WorkflowState?.IDLE || 'idle';
        if (window.forceWorkflowState && window.WorkflowState) {
            window.forceWorkflowState(this, target);
        } else {
            this.state = target;
        }
    },

	    async showProjectList() {
	        if (this._carouselTimer) {
	            clearInterval(this._carouselTimer);
	            this._carouselTimer = null;
	        }
	        this.cleanupPresentationMode?.();

	        await this._ensureWorkflowReady();
	        this._forceWorkflowStateSafe(window.WorkflowState?.IDLE);
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
                                <button class="ppt-cta-btn secondary" onclick="window.PPTGenerator.importPptx()">
                                    <iconify-icon icon="carbon:document-import"></iconify-icon>
                                    导入 PPTX
                                </button>
                                <button class="ppt-cta-btn secondary" onclick="window.PPTGenerator.debugLoadSample()" title="跳过生成，直接加载 Sample 数据">
                                    <iconify-icon icon="carbon:debug"></iconify-icon>
                                    调试 Sample
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
                                        <iconify-icon icon="carbon:search-advanced"></iconify-icon>
                                    </div>
                                    <div class="ppt-feature-text">
                                        <strong>深度研究</strong>
                                        <span>DeepSearch 增强</span>
                                    </div>
                                </div>
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

                        <!-- Hero Visual Preview - 直接展示幻灯片 -->
                        <div class="ppt-hero-visual direct">
                            <div id="heroSlideCarousel" class="ppt-hero-carousel">
                                <!-- 由 JS 渲染实际幻灯片 -->
                            </div>
                            <!-- 轮播指示器 -->
                            <div id="heroCarouselDots" class="ppt-carousel-dots"></div>
                            
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

                    <!-- Main Content Container -->
                    <div class="ppt-main-container">
                        
                        ${projects.length === 0 ? `
                            <!-- Quick Start Section (Only when no projects) -->
                            <div class="ppt-quick-start-section">
                                <div class="ppt-section-header no-border">
                                    <h3 class="ppt-section-title">
                                        <iconify-icon icon="carbon:flash"></iconify-icon>
                                        快速开始
                                    </h3>
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
                                            <iconify-icon icon="carbon:color-palette"></iconify-icon>
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
                        ` : ''}

                        ${projects.length > 0 ? `
                            <!-- Recent Projects Section -->
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
                                
                                ${this.projectListViewMode === 'grid' ? `
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
                                `}
                            </div>
                        ` : `
                            <!-- Empty State for Recent Projects -->
                            <div class="ppt-projects-section">
                                <div class="ppt-section-header">
                                    <div class="ppt-section-tabs">
                                        <button class="ppt-section-tab active">
                                            最近项目
                                        </button>
                                    </div>
                                </div>
                                <div class="ppt-empty-projects">
                                    <div class="ppt-empty-state-icon">
                                        <iconify-icon icon="carbon:document-blank"></iconify-icon>
                                    </div>
                                    <h3>暂无最近项目</h3>
                                    <p>您的创作历史将在这里显示。现在就开启一段新的灵感旅程吧！</p>
                                    <div class="ppt-empty-state-actions">
                                        <button class="ppt-cta-btn" onclick="window.PPTGenerator.createNewProject()">
                                            <iconify-icon icon="carbon:add-large"></iconify-icon>
                                            立即开始
                                        </button>
                                    </div>
                                </div>
                            </div>
                        `}
                    </div>
                </main>
            </div>
        `;
        
        // 初始化 Hero 幻灯片轮播
        this._initHeroCarousel();
    },

    /**
     * 初始化 Hero 区域的幻灯片轮播
     */
    _initHeroCarousel() {
        const carousel = document.getElementById('heroSlideCarousel');
        const dotsContainer = document.getElementById('heroCarouselDots');
        if (!carousel || !dotsContainer) return;
        
        // 解析示例 HTML 获取 slides（优先使用 Landing 示例）
        const sampleHTML = window.PPT_LANDING_SAMPLE_HTML || window.PPT_SAMPLE_HTML;
        if (!sampleHTML || typeof SlideParser === 'undefined') {
            console.warn('[HeroCarousel] 示例数据或解析器未加载');
            return;
        }
        
        try {
            const slides = SlideParser.parse(sampleHTML);
            
            if (!slides || slides.length === 0) {
                console.warn('[HeroCarousel] 没有解析到幻灯片');
                return;
            }
            
            // 只取前 5 张幻灯片
            const displaySlides = slides.slice(0, 5);
            const renderer = new HTMLSlideRenderer();
            
            // 延迟获取容器尺寸，确保 DOM 已渲染
            requestAnimationFrame(() => {
                // 渲染所有幻灯片
                carousel.innerHTML = displaySlides.map((slide, i) => `
                    <div class="ppt-carousel-slide ${i === 0 ? 'active' : ''}" data-index="${i}">
                        <div class="ppt-carousel-slide-inner">
                            ${renderer.render(slide, i)}
                        </div>
                    </div>
                `).join('');
                
                // 渲染指示器
                dotsContainer.innerHTML = displaySlides.map((_, i) => `
                    <span class="ppt-carousel-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></span>
                `).join('');
                
                // 点击指示器切换
                dotsContainer.querySelectorAll('.ppt-carousel-dot').forEach(dot => {
                    dot.addEventListener('click', () => {
                        this._goToSlide(parseInt(dot.dataset.index));
                    });
                });
                
                // 初始计算缩放
                this._updateCarouselScale();
                
                // 监听窗口大小变化（节流）
                if (!this._resizeHandler) {
                    let resizeTimer;
                    this._resizeHandler = () => {
                        clearTimeout(resizeTimer);
                        resizeTimer = setTimeout(() => this._updateCarouselScale(), 100);
                    };
                    window.addEventListener('resize', this._resizeHandler);
                }
                
                // 自动轮播
                this._carouselIndex = 0;
                this._carouselSlides = displaySlides.length;
                this._startCarouselAutoPlay();
            });
            
        } catch (e) {
            console.error('[HeroCarousel] 初始化失败:', e);
        }
    },
    
    _updateCarouselScale() {
        const carousel = document.getElementById('heroSlideCarousel');
        if (!carousel) return;
        
        const containerWidth = carousel.offsetWidth || 400;
        const containerHeight = carousel.offsetHeight || 225;
        // 取宽高缩放比例的较小值，确保完整显示
        const scaleW = containerWidth / 960;
        const scaleH = containerHeight / 540;
        const scale = Math.min(scaleW, scaleH);
        // 计算居中偏移
        const offsetX = (containerWidth - 960 * scale) / 2;
        const offsetY = (containerHeight - 540 * scale) / 2;
        
        // 更新所有 slide-inner 的缩放
        carousel.querySelectorAll('.ppt-carousel-slide-inner').forEach(inner => {
            inner.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
            inner.style.transformOrigin = 'top left';
        });
    },
    
    _goToSlide(index) {
        const carousel = document.getElementById('heroSlideCarousel');
        const dotsContainer = document.getElementById('heroCarouselDots');
        if (!carousel || !dotsContainer) return;
        
        // 更新 slides
        carousel.querySelectorAll('.ppt-carousel-slide').forEach((slide, i) => {
            slide.classList.toggle('active', i === index);
        });
        
        // 更新 dots
        dotsContainer.querySelectorAll('.ppt-carousel-dot').forEach((dot, i) => {
            dot.classList.toggle('active', i === index);
        });
        
        this._carouselIndex = index;
    },
    
    _startCarouselAutoPlay() {
        // 清除旧的定时器
        if (this._carouselTimer) {
            clearInterval(this._carouselTimer);
        }
        
        this._carouselTimer = setInterval(() => {
            const next = (this._carouselIndex + 1) % this._carouselSlides;
            this._goToSlide(next);
        }, 4000); // 4秒切换
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
        // 健康检查拦截
        if (window.PPTHealthCheck) {
            const isReady = await window.PPTHealthCheck.checkAndShow(true);
            if (!isReady) return; // 拦截，等待配置完成
        }

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
            this.currentProject = { id, logs: [], todos: [], chatHistory: [], workflowData: {} };
        }
        // 确保旧项目有 chatHistory
        if (!this.currentProject.chatHistory) {
            this.currentProject.chatHistory = [];
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

        this._forceWorkflowStateSafe(this.currentProject.status || window.WorkflowState?.IDLE);
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
                            <div class="ppt-chat-header">
                                <iconify-icon icon="solar:chat-round-dots-linear"></iconify-icon>
                                <span>AI 助手</span>
                            </div>
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
                // 移除内联样式，让 CSS calc(19% + 40px) 接管
                previewArea.style.marginRight = '';
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

        // 防御性检查：确保核心元素存在
        if (!input || !sendBtn) {
            console.warn('[PPTGenerator] _bindChatEvents: pptChatInput or pptSendBtn not found, skipping event binding');
            return;
        }

        // 存储待发送的附件
        this.pendingAttachments = [];

        const sendMessage = () => {
            const text = input.value.trim();
            if (!text && this.pendingAttachments.length === 0) return;
            console.log('[PPTGenerator] Chat: sending message:', text.slice(0, 50));
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

        // 附件按钮点击（可选元素）
        if (attachBtn && fileInput) {
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
        }

        console.log('[PPTGenerator] _bindChatEvents: events bound successfully');
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
    },

    // ═══════════════════════════════════════════════════════════════
    // PPTX 导入功能
    // ═══════════════════════════════════════════════════════════════

    /**
     * 导入 PPTX 文件并解析
     */
    async importPptx() {
        // 创建隐藏的 file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pptx';
        
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            // 显示加载状态
            this._showImportProgress('正在解析 PPTX 文件...');
            
            try {
                // 检查 PPTXSlideParser 是否已加载
                if (typeof PPTXSlideParser === 'undefined') {
                    // 动态加载
                    await this._loadScript('js/ppt/core/slide-parser-pptx.js');
                }
                
                const parser = new PPTXSlideParser();
                const result = await parser.parse(file);
                
                console.log('[importPptx] Parsed result:', result);
                
                // 显示解析结果
                this._showImportResult(file.name, result);
                
            } catch (err) {
                console.error('[importPptx] Error:', err);
                this._showImportError(err.message);
            }
        };
        
        input.click();
    },

    /**
     * 动态加载脚本
     */
    _loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Failed to load ${src}`));
            document.head.appendChild(script);
        });
    },

    /**
     * 显示导入进度
     */
    _showImportProgress(message) {
        // 创建模态框
        const modal = document.createElement('div');
        modal.id = 'pptxImportModal';
        modal.className = 'ppt-modal-overlay open';
        modal.innerHTML = `
            <div class="ppt-modal" style="max-width: 500px;">
                <div class="ppt-modal-header">
                    <h3><iconify-icon icon="carbon:document-import"></iconify-icon> 导入 PPTX</h3>
                </div>
                <div class="ppt-modal-body" style="text-align: center; padding: 40px;">
                    <div class="ppt-loading-spinner" style="margin-bottom: 16px;"></div>
                    <p id="importProgressMessage">${message}</p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    /**
     * 显示导入结果
     */
    _showImportResult(filename, result) {
        const modal = document.getElementById('pptxImportModal');
        if (!modal) return;
        
        const { slides, html, metadata } = result;
        
        // 生成预览摘要
        const summary = slides.map((slide, i) => {
            const elements = slide.elements || [];
            const textEls = elements.filter(e => e.type === 'text');
            const shapeEls = elements.filter(e => e.type === 'shape');
            const imageEls = elements.filter(e => e.type === 'image');
            
            // 获取第一个文本作为标题
            const firstText = textEls[0]?.content?.substring(0, 50) || '(无标题)';
            
            return `
                <div class="import-slide-item" style="padding: 8px 12px; border-bottom: 1px solid var(--ppt-border); cursor: pointer;" 
                     onclick="window.PPTGenerator._previewImportedSlide(${i})">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="color: var(--ppt-text-muted); font-size: 12px; width: 24px;">${i + 1}</span>
                        <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this._escapeHtml(firstText)}</span>
                        <span style="color: var(--ppt-text-muted); font-size: 11px;">
                            ${textEls.length}文 ${shapeEls.length}形 ${imageEls.length}图
                        </span>
                    </div>
                </div>
            `;
        }).join('');
        
        modal.querySelector('.ppt-modal').style.maxWidth = '800px';
        modal.querySelector('.ppt-modal').innerHTML = `
            <div class="ppt-modal-header">
                <h3><iconify-icon icon="carbon:checkmark-filled" style="color: var(--ppt-success);"></iconify-icon> 导入成功</h3>
                <button class="ppt-icon-btn" onclick="document.getElementById('pptxImportModal').remove()">
                    <iconify-icon icon="carbon:close"></iconify-icon>
                </button>
            </div>
            <div class="ppt-modal-body" style="padding: 0;">
                <div style="padding: 16px; background: var(--ppt-bg-secondary); border-bottom: 1px solid var(--ppt-border);">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <iconify-icon icon="carbon:presentation-file" style="font-size: 32px; color: var(--ppt-primary);"></iconify-icon>
                        <div>
                            <div style="font-weight: 600;">${this._escapeHtml(filename)}</div>
                            <div style="font-size: 12px; color: var(--ppt-text-muted);">
                                ${slides.length} 页幻灯片 · ${metadata.width.toFixed(1)}" × ${metadata.height.toFixed(1)}"
                            </div>
                        </div>
                    </div>
                </div>
                
                <div style="display: flex; height: 400px;">
                    <!-- 左侧幻灯片列表 -->
                    <div style="width: 240px; border-right: 1px solid var(--ppt-border); overflow-y: auto;" class="custom-scrollbar">
                        ${summary}
                    </div>
                    
                    <!-- 右侧 HTML 代码 -->
                    <div style="flex: 1; display: flex; flex-direction: column;">
                        <div style="padding: 8px 12px; background: var(--ppt-bg-tertiary); border-bottom: 1px solid var(--ppt-border); font-size: 12px; color: var(--ppt-text-muted);">
                            <iconify-icon icon="carbon:code"></iconify-icon> 生成的 HTML 代码 (供 AI 参考)
                        </div>
                        <pre id="importedHtmlCode" style="flex: 1; margin: 0; padding: 12px; font-size: 11px; overflow: auto; background: var(--ppt-bg-primary); font-family: 'Fira Code', monospace;">${this._escapeHtml(html)}</pre>
                    </div>
                </div>
            </div>
            <div class="ppt-modal-footer" style="display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px; border-top: 1px solid var(--ppt-border);">
                <button class="ppt-btn secondary" onclick="window.PPTGenerator._copyImportedHtml()">
                    <iconify-icon icon="carbon:copy"></iconify-icon> 复制 HTML
                </button>
                <button class="ppt-btn secondary" onclick="window.PPTGenerator._useAsReference()">
                    <iconify-icon icon="carbon:ai-status"></iconify-icon> 作为参考导入
                </button>
                <button class="ppt-btn secondary" onclick="window.PPTGenerator._saveImportToProjects()">
                    <iconify-icon icon="carbon:folder-add"></iconify-icon> 添加到最近项目
                </button>
                <button class="ppt-btn primary" onclick="window.PPTGenerator._createProjectFromImport()">
                    <iconify-icon icon="carbon:play-filled-alt"></iconify-icon> 立即编辑
                </button>
            </div>
        `;
        
        // 保存解析结果供后续使用
        this._importedPptxResult = result;
        this._importedPptxFilename = filename.replace(/\.pptx$/i, '');
    },

    /**
     * 显示导入错误
     */
    _showImportError(message) {
        const modal = document.getElementById('pptxImportModal');
        if (!modal) return;
        
        modal.querySelector('.ppt-modal').innerHTML = `
            <div class="ppt-modal-header">
                <h3><iconify-icon icon="carbon:warning-alt" style="color: var(--ppt-danger);"></iconify-icon> 导入失败</h3>
                <button class="ppt-icon-btn" onclick="document.getElementById('pptxImportModal').remove()">
                    <iconify-icon icon="carbon:close"></iconify-icon>
                </button>
            </div>
            <div class="ppt-modal-body" style="text-align: center; padding: 40px;">
                <iconify-icon icon="carbon:warning-alt-filled" style="font-size: 48px; color: var(--ppt-danger); margin-bottom: 16px;"></iconify-icon>
                <p style="color: var(--ppt-text-secondary);">${this._escapeHtml(message)}</p>
            </div>
            <div class="ppt-modal-footer" style="display: flex; justify-content: center; padding: 12px 16px; border-top: 1px solid var(--ppt-border);">
                <button class="ppt-btn secondary" onclick="document.getElementById('pptxImportModal').remove()">关闭</button>
            </div>
        `;
    },

    /**
     * 复制导入的 HTML
     */
    _copyImportedHtml() {
        if (!this._importedPptxResult) return;
        
        navigator.clipboard.writeText(this._importedPptxResult.html).then(() => {
            // 显示成功提示
            const btn = document.querySelector('.ppt-modal-footer .ppt-btn.secondary');
            if (btn) {
                const original = btn.innerHTML;
                btn.innerHTML = '<iconify-icon icon="carbon:checkmark"></iconify-icon> 已复制';
                setTimeout(() => btn.innerHTML = original, 2000);
            }
        });
    },

    /**
     * 作为参考导入（添加到聊天附件）
     */
    async _useAsReference() {
        if (!this._importedPptxResult) return;
        
        // 关闭模态框
        document.getElementById('pptxImportModal')?.remove();
        
        // 创建新项目
        await this.createNewProject('default');
        
        // 将 HTML 作为参考内容添加到聊天
        const refContent = `以下是导入的 PPTX 文件结构，请参考其布局和内容风格进行调整：\n\n\`\`\`html\n${this._importedPptxResult.html}\n\`\`\``;
        
        // 自动填入聊天框
        const chatInput = document.getElementById('pptChatInput');
        if (chatInput) {
            chatInput.value = refContent;
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
        }
    },

    /**
     * 保存导入的 PPTX 到最近项目（不进入编辑）
     */
    async _saveImportToProjects() {
        console.log('[_saveImportToProjects] Called');
        if (!this._importedPptxResult) {
            console.warn('[_saveImportToProjects] No imported result');
            return;
        }
        
        // 创建项目
        const newProject = {
            id: crypto.randomUUID(),
            title: this._importedPptxFilename || '导入的演示文稿',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            slides: this._importedPptxResult.slides,
            sourceHtml: this._importedPptxResult.html
        };
        
        console.log('[_saveImportToProjects] Saving project:', newProject.title, 'with', newProject.slides.length, 'slides');
        
        // 安全检查：确保没有 Promise 对象
        const cleanSlides = JSON.parse(JSON.stringify(newProject.slides));
        newProject.slides = cleanSlides;
        
        if (window.pptStorage) {
            await window.pptStorage.saveProject(newProject);
            console.log('[_saveImportToProjects] Project saved');
        } else {
            console.error('[_saveImportToProjects] pptStorage not available!');
        }
        
        // 关闭模态框
        document.getElementById('pptxImportModal')?.remove();
        
        // 清理
        this._importedPptxResult = null;
        this._importedPptxFilename = null;
        
        // 刷新项目列表
        console.log('[_saveImportToProjects] Refreshing project list...');
        this.showProjectList();
    },

    /**
     * 从导入的 PPTX 创建项目并立即编辑
     */
    async _createProjectFromImport() {
        if (!this._importedPptxResult) return;
        
        // 关闭模态框
        document.getElementById('pptxImportModal')?.remove();
        
        // 使用解析的 slides 创建项目（安全检查：确保没有 Promise 对象）
        this.slides = JSON.parse(JSON.stringify(this._importedPptxResult.slides));
        
        // 创建项目
        const newProject = {
            id: crypto.randomUUID(),
            title: this._importedPptxFilename || '导入的演示文稿',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            slides: this.slides,
            sourceHtml: this._importedPptxResult.html
        };
        
        if (window.pptStorage) {
            await window.pptStorage.saveProject(newProject);
        }
        
        this.currentProject = newProject;
        this.currentSlideIndex = 0;
        
        // 进入演示模式
        this._showPresentation();
        
        // 清理
        this._importedPptxResult = null;
        this._importedPptxFilename = null;
    },

    _escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
};

Object.assign(PPTGenerator.prototype, PPTGeneratorNavigation);
