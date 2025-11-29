const PPTGeneratorPresentation = {
    renderPresentationMode(container) {
        // 更新外层 header，整合工具栏内容
        this._updateHeaderForPresentation();

        container.innerHTML = `
            <div class="pres-container">
                <!-- Main Area -->
                <div class="pres-main-area">
                    <!-- Left Sidebar: Thumbnail Strip -->
                    <div class="pres-sidebar" id="presSidebar" style="width: 140px;">
                        <div class="pres-sidebar-header">
                            <span>幻灯片</span>
                        </div>
                        <div class="pres-thumbnails custom-scrollbar" id="presThumbnails">
                            ${this.slides.map((slide, index) => `
                                <div class="pres-thumb-card ${index === this.currentSlideIndex ? 'active' : ''}" onclick="window.PPTGenerator.goToSlide(${index})">
                                    <div class="pres-thumb-preview">
                                        ${this._renderThumbnail(slide, index)}
                                    </div>
                                    <div class="pres-thumb-num">${index + 1}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <!-- Left Resizer -->
                    <div class="pres-resizer" id="presLeftResizer" data-target="presSidebar" data-min="100" data-max="280"></div>

                    <!-- Canvas -->
                    <div class="pres-canvas-wrapper">
                        ${this.viewMode === 'slide' ? `
                            <div class="pres-slide-container">
                                <div class="pres-slide" id="presSlideCanvas">
                                    ${this._renderSlideContent(this.slides[this.currentSlideIndex])}
                                </div>
                                <!-- Floating Toolbar -->
                                <div class="pres-toolbar-float">
                                    <div class="pres-toolbar-group">
                                        <button class="pres-tool-btn" onclick="window.PPTGenerator.prevSlide()" title="上一页">
                                            <iconify-icon icon="carbon:chevron-left"></iconify-icon>
                                        </button>
                                        <span class="pres-page-info" id="presPageInfo">${this.currentSlideIndex + 1} / ${this.slides.length}</span>
                                        <button class="pres-tool-btn" onclick="window.PPTGenerator.nextSlide()" title="下一页">
                                            <iconify-icon icon="carbon:chevron-right"></iconify-icon>
                                        </button>
                                    </div>
                                    <div class="pres-toolbar-divider"></div>
                                    <div class="pres-toolbar-group">
                                        <button class="pres-tool-btn" onclick="window.PPTGenerator.addSlideWithAI()" title="AI 新增幻灯片">
                                            <iconify-icon icon="carbon:add"></iconify-icon>
                                        </button>
                                        <button class="pres-tool-btn" onclick="window.PPTGenerator.editCurrentSlide()" title="编辑当前页">
                                            <iconify-icon icon="carbon:edit"></iconify-icon>
                                        </button>
                                        <button class="pres-tool-btn" onclick="window.PPTGenerator.duplicateSlide()" title="复制当前页">
                                            <iconify-icon icon="carbon:copy"></iconify-icon>
                                        </button>
                                        <button class="pres-tool-btn danger" onclick="window.PPTGenerator.deleteCurrentSlide()" title="删除当前页">
                                            <iconify-icon icon="carbon:trash-can"></iconify-icon>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ` : `
                            <div class="pres-outline-view custom-scrollbar">
                                ${this._renderOutlineContent()}
                            </div>
                        `}
                    </div>
                </div>
            </div>
        `;
        
        // 初始化可拖动分隔条
        setTimeout(() => this.initResizers(), 0);
    },

    // ============================================================
    // Header Integration for Presentation Mode
    // ============================================================

    /**
     * 更新外层 header，整合视图切换和导出按钮
     */
    _updateHeaderForPresentation() {
        const header = document.querySelector('.ppt-header');
        if (!header) return;

        header.innerHTML = `
            <div class="ppt-header-left">
                <button class="ppt-icon-btn" onclick="window.PPTGenerator.enterWorkspace()">
                    <iconify-icon icon="carbon:arrow-left"></iconify-icon>
                </button>
                <div class="ppt-logo">
                    <img src="public/pure.svg" alt="Logo" class="ppt-logo-img">
                    <span>智能演示文稿生成</span>
                </div>
                <div class="ppt-header-divider"></div>
                <div class="pres-title-wrapper">
                    <input type="text" class="pres-title-input" value="${this.currentProject.title}" 
                           onblur="window.PPTGenerator.updateProjectTitle(this.value)" 
                           onkeydown="if(event.key === 'Enter') this.blur()">
                    <iconify-icon icon="carbon:edit" class="pres-title-icon"></iconify-icon>
                </div>
                <div class="pres-view-toggle">
                    <button class="pres-view-btn ${this.viewMode === 'slide' ? 'active' : ''}" onclick="window.PPTGenerator.toggleViewMode('slide')">
                        <iconify-icon icon="carbon:presentation-file"></iconify-icon>
                        <span>幻灯片</span>
                    </button>
                    <button class="pres-view-btn ${this.viewMode === 'outline' ? 'active' : ''}" onclick="window.PPTGenerator.toggleViewMode('outline')">
                        <iconify-icon icon="carbon:list"></iconify-icon>
                        <span>大纲</span>
                    </button>
                </div>
            </div>
            <div class="ppt-header-right">
                <button class="ppt-play-btn" onclick="window.PPTGenerator.startSlideshow()">
                    <iconify-icon icon="carbon:play-filled"></iconify-icon>
                    <span>播放</span>
                </button>
                <div class="ppt-export-dropdown">
                    <button class="ppt-export-btn" onclick="window.PPTGenerator.toggleExportMenu()">
                        <iconify-icon icon="carbon:export"></iconify-icon>
                        <span>导出</span>
                        <iconify-icon icon="carbon:chevron-down" class="ppt-export-chevron"></iconify-icon>
                    </button>
                    <div class="ppt-export-menu" id="pptExportMenu">
                        <div class="ppt-export-group-label">PowerPoint 导出</div>
                        <button class="ppt-export-item" onclick="window.PPTGenerator.exportAs('pptx')">
                            <iconify-icon icon="carbon:document"></iconify-icon>
                            <div class="ppt-export-item-info">
                                <span class="ppt-export-item-title">标准导出</span>
                                <span class="ppt-export-item-desc">可编辑，公式用文本</span>
                            </div>
                        </button>
                        <button class="ppt-export-item" onclick="window.PPTGenerator.exportAs('pptx-omml')">
                            <iconify-icon icon="carbon:function-math"></iconify-icon>
                            <div class="ppt-export-item-info">
                                <span class="ppt-export-item-title">原生公式</span>
                                <span class="ppt-export-item-desc">公式可编辑（实验性）</span>
                            </div>
                        </button>
                        <button class="ppt-export-item" onclick="window.PPTGenerator.exportAs('pptx-image')">
                            <iconify-icon icon="carbon:image"></iconify-icon>
                            <div class="ppt-export-item-info">
                                <span class="ppt-export-item-title">图片模式</span>
                                <span class="ppt-export-item-desc">效果最好，不可编辑</span>
                            </div>
                        </button>
                        <div class="ppt-export-divider"></div>
                        <button class="ppt-export-item" onclick="window.PPTGenerator.exportAs('pdf')">
                            <iconify-icon icon="carbon:document-pdf"></iconify-icon>
                            <div class="ppt-export-item-info">
                                <span class="ppt-export-item-title">PDF 文档</span>
                                <span class="ppt-export-item-desc">.pdf 便于分享</span>
                            </div>
                        </button>
                        <div class="ppt-export-divider"></div>
                        <button class="ppt-export-item" onclick="window.PPTGenerator.exportAs('images')">
                            <iconify-icon icon="carbon:image"></iconify-icon>
                            <div class="ppt-export-item-info">
                                <span class="ppt-export-item-title">图片打包</span>
                                <span class="ppt-export-item-desc">.zip 每页一张 PNG</span>
                            </div>
                        </button>
                    </div>
                </div>
                <button class="ppt-icon-btn" onclick="window.PPTGenerator.showProjectList()" title="项目列表">
                    <iconify-icon icon="carbon:grid"></iconify-icon>
                </button>
                <button class="ppt-icon-btn" onclick="window.PPTGenerator.hide()" title="关闭">
                    <iconify-icon icon="carbon:close"></iconify-icon>
                </button>
            </div>
        `;
    },

    // ============================================================
    // Presentation Navigation Logic
    // ============================================================

    _renderSlideContent(slide) {
        // 使用统一的 HTMLSlideRenderer（与 PPTX 导出共享逻辑）
        if (typeof HTMLSlideRenderer !== 'undefined') {
            if (!this._htmlRenderer) {
                this._htmlRenderer = new HTMLSlideRenderer();
            }
            return this._htmlRenderer.render(slide, this.currentSlideIndex);
        }
        // Fallback
        return this._renderSlideContentLegacy(slide);
    },

    /**
     * 渲染缩略图预览（缩小版的幻灯片内容）
     */
    _renderThumbnail(slide, index) {
        // 检查 HTMLSlideRenderer 是否可用
        if (typeof HTMLSlideRenderer === 'undefined') {
            // Fallback: 显示幻灯片类型和序号
            const title = slide.title || slide.type || `幻灯片 ${index + 1}`;
            return `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:10px;color:#666;">${title}</div>`;
        }
        if (!this._htmlRenderer) {
            this._htmlRenderer = new HTMLSlideRenderer();
        }
        // 渲染完整内容，然后用 CSS 缩放
        const content = this._htmlRenderer.render(slide, index);
        return `<div class="pres-thumb-content">${content}</div>`;
    },

    _renderSlideContentLegacy(slide) {
        if (slide.type === 'cover') {
            return `
                <div class="slide-modern-cover">
                    <h1 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 48px; font-weight: 800; margin-bottom: 20px;">${slide.title}</h1>
                    <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'subtitle', this.innerText)" style="font-size: 24px; opacity: 0.8;">${slide.subtitle}</p>
                    <div style="margin-top: 40px; font-size: 14px; opacity: 0.6;">Generated by Paper Burner X</div>
                </div>
            `;
        } else if (slide.type === 'toc') {
            // 目录页 - 带序号的列表
            return `
                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 48px;">${slide.title}</h2>
                    <div style="display: flex; flex-direction: column; gap: 20px;">
                        ${slide.items.map((item, i) => `
                            <div style="display: flex; align-items: center; gap: 20px;">
                                <span style="width: 40px; height: 40px; background: var(--ppt-primary); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px;">${i + 1}</span>
                                <span contenteditable="true" onblur="window.PPTGenerator.updateSlideItem(${this.currentSlideIndex}, ${i}, this.innerText)" style="font-size: 24px; color: var(--ppt-text-secondary);">${item}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (slide.type === 'stats') {
            // 数据统计页 - 大数字展示
            return `
                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 48px;">${slide.title}</h2>
                    <div style="flex: 1; display: grid; grid-template-columns: repeat(${Math.min(slide.stats.length, 4)}, 1fr); gap: 32px; align-items: center;">
                        ${slide.stats.map((stat, i) => `
                            <div style="text-align: center; padding: 24px;">
                                <div contenteditable="true" onblur="window.PPTGenerator.updateSlideStat(${this.currentSlideIndex}, ${i}, 'value', this.innerText)" style="font-size: 56px; font-weight: 800; color: var(--ppt-primary); margin-bottom: 12px;">${stat.value}</div>
                                <div contenteditable="true" onblur="window.PPTGenerator.updateSlideStat(${this.currentSlideIndex}, ${i}, 'label', this.innerText)" style="font-size: 16px; color: var(--ppt-text-secondary);">${stat.label}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (slide.type === 'comparison') {
            // 对比页 - 左右分栏
            return `
                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 40px;">${slide.title}</h2>
                    <div style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 40px;">
                        <div style="background: #fee2e2; border-radius: 16px; padding: 32px;">
                            <h3 contenteditable="true" style="font-size: 24px; font-weight: 600; color: #dc2626; margin-bottom: 24px;">${slide.left.title}</h3>
                            <ul style="list-style: none; padding: 0; margin: 0;">
                                ${slide.left.items.map((item, i) => `
                                    <li style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px; font-size: 18px; color: #991b1b;">
                                        <iconify-icon icon="carbon:close-filled" style="color: #dc2626;"></iconify-icon>
                                        <span contenteditable="true">${item}</span>
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                        <div style="background: #dcfce7; border-radius: 16px; padding: 32px;">
                            <h3 contenteditable="true" style="font-size: 24px; font-weight: 600; color: #16a34a; margin-bottom: 24px;">${slide.right.title}</h3>
                            <ul style="list-style: none; padding: 0; margin: 0;">
                                ${slide.right.items.map((item, i) => `
                                    <li style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px; font-size: 18px; color: #166534;">
                                        <iconify-icon icon="carbon:checkmark-filled" style="color: #16a34a;"></iconify-icon>
                                        <span contenteditable="true">${item}</span>
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                    </div>
                </div>
            `;
        } else if (slide.type === 'image_text') {
            // 图文混排页
            return `
                <div style="padding: 60px; height: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center;">
                    <div>
                        <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 24px;">${slide.title}</h2>
                        <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'content', this.innerText)" style="font-size: 20px; color: var(--ppt-text-secondary); line-height: 1.7;">${slide.content}</p>
                    </div>
                    <div style="background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%); border-radius: 16px; height: 280px; display: flex; align-items: center; justify-content: center; color: var(--ppt-primary); font-size: 18px;">
                        <iconify-icon icon="carbon:image" style="font-size: 48px; opacity: 0.5; margin-right: 12px;"></iconify-icon>
                        ${slide.imagePlaceholder || '图片占位'}
                    </div>
                </div>
            `;
        } else if (slide.type === 'icon_grid') {
            // 图标网格页
            return `
                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 48px;">${slide.title}</h2>
                    <div style="flex: 1; display: grid; grid-template-columns: repeat(${Math.min(slide.items.length, 4)}, 1fr); gap: 32px;">
                        ${slide.items.map((item, i) => `
                            <div style="background: var(--ppt-bg-subtle); border-radius: 16px; padding: 32px; text-align: center;">
                                <div style="width: 64px; height: 64px; background: var(--ppt-primary-subtle); border-radius: 16px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px auto;">
                                    <iconify-icon icon="${item.icon}" style="font-size: 32px; color: var(--ppt-primary);"></iconify-icon>
                                </div>
                                <h4 contenteditable="true" style="font-size: 20px; font-weight: 600; color: var(--ppt-text-main); margin-bottom: 8px;">${item.title}</h4>
                                <p contenteditable="true" style="font-size: 14px; color: var(--ppt-text-secondary); margin: 0;">${item.desc}</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } else if (slide.type === 'quote') {
            // 引用/评价页
            return `
                <div style="padding: 80px; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%);">
                    <iconify-icon icon="carbon:quotes" style="font-size: 64px; color: var(--ppt-primary); opacity: 0.3; margin-bottom: 32px;"></iconify-icon>
                    <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'quote', this.innerText)" style="font-size: 28px; color: var(--ppt-text-main); line-height: 1.6; max-width: 700px; margin-bottom: 40px; font-style: italic;">"${slide.quote}"</p>
                    <div>
                        <div contenteditable="true" style="font-size: 20px; font-weight: 600; color: var(--ppt-text-main);">${slide.author}</div>
                        <div contenteditable="true" style="font-size: 16px; color: var(--ppt-text-secondary); margin-top: 4px;">${slide.company}</div>
                    </div>
                </div>
            `;
        } else if (slide.type === 'timeline') {
            // 时间轴/路线图页
            return `
                <div style="padding: 60px; height: 100%; display: flex; flex-direction: column;">
                    <h2 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 36px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: 48px;">${slide.title}</h2>
                    <div style="flex: 1; display: flex; align-items: center; position: relative;">
                        <div style="position: absolute; top: 50%; left: 0; right: 0; height: 4px; background: var(--ppt-border); transform: translateY(-50%);"></div>
                        <div style="display: grid; grid-template-columns: repeat(${slide.items.length}, 1fr); gap: 24px; width: 100%; position: relative;">
                            ${slide.items.map((item, i) => `
                                <div style="text-align: center;">
                                    <div style="width: 56px; height: 56px; background: var(--ppt-primary); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; margin: 0 auto 16px auto; position: relative; z-index: 1;">${item.phase}</div>
                                    <div contenteditable="true" style="font-size: 18px; font-weight: 600; color: var(--ppt-text-main); margin-bottom: 8px;">${item.title}</div>
                                    <div contenteditable="true" style="font-size: 14px; color: var(--ppt-text-secondary);">${item.desc}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
        } else if (slide.type === 'end') {
            // 结束页
            return `
                <div class="slide-modern-cover" style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);">
                    <h1 contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'title', this.innerText)" style="font-size: 48px; font-weight: 800; margin-bottom: 16px;">${slide.title}</h1>
                    <p contenteditable="true" onblur="window.PPTGenerator.updateSlideContent(${this.currentSlideIndex}, 'subtitle', this.innerText)" style="font-size: 24px; opacity: 0.7; margin-bottom: 40px;">${slide.subtitle || ''}</p>
                    ${slide.email ? `<div style="font-size: 18px; opacity: 0.5;"><iconify-icon icon="carbon:email"></iconify-icon> ${slide.email}</div>` : ''}
                    <div style="margin-top: 60px; font-size: 14px; opacity: 0.4;">Generated by Paper Burner X</div>
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
    },

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
    },

    updateSlideItem(slideIndex, itemIndex, value) {
        if (this.slides[slideIndex] && this.slides[slideIndex].items) {
            this.slides[slideIndex].items[itemIndex] = value;
            this._updateSlideView();
        }
    },

    updateSlideStat(slideIndex, statIndex, field, value) {
        if (this.slides[slideIndex] && this.slides[slideIndex].stats && this.slides[slideIndex].stats[statIndex]) {
            this.slides[slideIndex].stats[statIndex][field] = value;
            this._updateSlideView();
        }
    },

    toggleViewMode(mode) {
        this.viewMode = mode;
        this.renderPresentationMode(document.getElementById('pptPreviewArea'));
    },

    _getScriptForSlide(index) {
        const scripts = [
            "Welcome. Today we explore the next frontier of computation: Quantum Computing. We call this the 'Quantum Leap'.",
            "Our agenda covers the physics foundations, key algorithms, hardware approaches, real-world applications, and the roadmap ahead.",
            "It starts with a fundamental shift. Unlike classical bits that are 0 or 1, Qubits exist in a superposition, represented here by the Bloch Sphere.",
            "Mathematically, this is a vector in a complex vector space. The coefficients alpha and beta determine the probability of measuring 0 or 1.",
            "Then there's Entanglement. Einstein called it 'spooky action at a distance'. It allows qubits to be perfectly correlated, instantly.",
            "This power enables algorithms like Shor's, which offers exponential speedup in factoring large numbers, threatening current encryption.",
            "Building this is hard. We use dilution refrigerators to cool superconducting qubits to near absolute zero, or trap individual ions with lasers.",
            "The applications are vast. From simulating molecules for new drugs, to breaking cryptography, and optimizing complex logistics networks.",
            "The market is responding. Investment is surging, with projections reaching $8.5 Billion by 2025 as we move from research to commercialization.",
            "But challenges remain. Decoherence—noise from the environment—destroys quantum states. Error correction is the holy grail.",
            "Our roadmap takes us from the current NISQ era of noisy intermediate-scale quantum devices to fully fault-tolerant logical qubits by 2030.",
            "The future is Quantum. It will solve problems that are impossible today. Join us in preparing for this paradigm shift. Thank you."
        ];
        return scripts[index] || "No speaker notes available.";
    },

    _renderOutlineContent() {
        return `
            <div class="ppt-outline-container">
                ${this.slides.map((slide, index) => {
                    // 从 elements 中提取标题和内容
                    const info = this._extractSlideInfo(slide);
                    return `
                    <div class="ppt-outline-item" onclick="window.PPTGenerator.goToSlideFromOutline(${index})">
                        <div class="ppt-outline-num">${index + 1}</div>
                        <div class="ppt-outline-content">
                            <div class="ppt-outline-title">${info.title || `幻灯片 ${index + 1}`}</div>
                            ${info.subtitle ? `<div class="ppt-outline-text">${info.subtitle}</div>` : ''}
                            ${info.bullets.length > 0 ? `
                                <ul class="ppt-outline-list">
                                    ${info.bullets.slice(0, 5).map(b => `<li>${b}</li>`).join('')}
                                    ${info.bullets.length > 5 ? `<li>... 还有 ${info.bullets.length - 5} 项</li>` : ''}
                                </ul>
                            ` : ''}
                        </div>
                    </div>
                `;}).join('')}
            </div>
        `;
    },

    /**
     * 从幻灯片数据中提取标题、副标题和要点
     */
    _extractSlideInfo(slide) {
        const info = { title: '', subtitle: '', bullets: [] };
        
        // 直接属性（旧格式）
        if (slide.title) info.title = slide.title;
        if (slide.subtitle) info.subtitle = slide.subtitle;
        if (slide.items) info.bullets = slide.items;
        
        // 从 elements 数组提取（新格式）
        if (slide.elements && Array.isArray(slide.elements)) {
            for (const el of slide.elements) {
                const type = el['data-el'] || el.type;
                const text = el['data-text'] || el.text || '';
                
                if (type === 'title' && !info.title) {
                    info.title = text;
                } else if (type === 'subtitle' && !info.subtitle) {
                    info.subtitle = text;
                } else if (type === 'bullet' || type === 'text') {
                    // 从 bullet 文本中提取要点
                    const lines = text.split('\n').filter(l => l.trim());
                    info.bullets.push(...lines);
                }
            }
        }
        
        return info;
    },

    goToSlideFromOutline(index) {
        this.currentSlideIndex = index;
        this.toggleViewMode('slide');
    },

    goToSlide(index) {
        if (index >= 0 && index < this.slides.length) {
            this.currentSlideIndex = index;
            this._updateSlideView();
        }
    },

    prevSlide() {
        if (this.currentSlideIndex > 0) {
            this.currentSlideIndex--;
            this._updateSlideView();
        }
    },

    nextSlide() {
        if (this.currentSlideIndex < this.slides.length - 1) {
            this.currentSlideIndex++;
            this._updateSlideView();
        }
    },

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
    },

    /**
     * 初始化可拖动分隔条
     */
    initResizers() {
        const resizers = document.querySelectorAll('.pres-resizer');
        resizers.forEach(resizer => {
            const targetId = resizer.dataset.target;
            const target = document.getElementById(targetId);
            const minWidth = parseInt(resizer.dataset.min) || 100;
            const maxWidth = parseInt(resizer.dataset.max) || 400;
            
            if (!target) return;

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
                const dx = e.clientX - startX;
                const newWidth = Math.min(maxWidth, Math.max(minWidth, startWidth + dx));
                target.style.width = newWidth + 'px';
                
                // 更新缩略图缩放比例
                this._updateThumbnailScale(newWidth);
            };

            const onMouseUp = () => {
                resizer.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            resizer.addEventListener('mousedown', onMouseDown);
        });
    },

    /**
     * 根据侧边栏宽度更新缩略图缩放比例
     */
    _updateThumbnailScale(sidebarWidth) {
        const thumbWidth = sidebarWidth - 24; // 减去 padding
        const scale = thumbWidth / 960;
        const thumbContents = document.querySelectorAll('.pres-thumb-content');
        thumbContents.forEach(el => {
            el.style.transform = `scale(${scale})`;
        });
    },

    // ============================================================
    // Slideshow Mode (Full Screen Presentation)
    // ============================================================

    /**
     * 启动全屏展示模式
     */
    startSlideshow(startIndex = null) {
        if (!this.slides || this.slides.length === 0) return;
        
        this._slideshowIndex = startIndex !== null ? startIndex : this.currentSlideIndex;
        this._slideshowKeyHandler = this._handleSlideshowKeydown.bind(this);
        
        // 创建全屏容器
        const overlay = document.createElement('div');
        overlay.id = 'slideshowOverlay';
        overlay.className = 'slideshow-overlay';
        overlay.innerHTML = `
            <div class="slideshow-container">
                <div class="slideshow-slide" id="slideshowSlide">
                    ${this._renderSlideContent(this.slides[this._slideshowIndex])}
                    <div class="slideshow-controls">
                        <span id="slideshowPageInfo">${this._slideshowIndex + 1} / ${this.slides.length}</span>
                        <span class="slideshow-hint">← → 翻页 · ESC 退出</span>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        document.addEventListener('keydown', this._slideshowKeyHandler);
        
        // 动态计算缩放比例，使幻灯片尽可能大
        this._updateSlideshowScale();
        window.addEventListener('resize', this._slideshowResizeHandler = () => this._updateSlideshowScale());
        
        // 点击左右区域翻页
        overlay.addEventListener('click', (e) => {
            const rect = overlay.getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (x < rect.width / 3) {
                this._slideshowPrev();
            } else if (x > rect.width * 2 / 3) {
                this._slideshowNext();
            }
        });
        
        // 双击退出
        overlay.addEventListener('dblclick', () => this.exitSlideshow());
        
        // 请求全屏
        if (overlay.requestFullscreen) {
            overlay.requestFullscreen().catch(() => {});
        }
    },

    /**
     * 退出展示模式
     */
    exitSlideshow() {
        const overlay = document.getElementById('slideshowOverlay');
        if (overlay) {
            overlay.remove();
        }
        document.removeEventListener('keydown', this._slideshowKeyHandler);
        window.removeEventListener('resize', this._slideshowResizeHandler);
        
        // 退出全屏
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
        
        // 同步当前页
        this.currentSlideIndex = this._slideshowIndex;
        this._updateSlideView();
    },

    /**
     * 动态计算并应用幻灯片缩放
     */
    _updateSlideshowScale() {
        const overlay = document.getElementById('slideshowOverlay');
        const slide = document.getElementById('slideshowSlide');
        if (!overlay || !slide) return;
        
        // 使用 overlay 的实际尺寸
        const rect = overlay.getBoundingClientRect();
        const availableWidth = rect.width;
        const availableHeight = rect.height;
        const slideWidth = 960;
        const slideHeight = 540;
        
        // 计算缩放比例，完全填满
        const scaleX = availableWidth / slideWidth;
        const scaleY = availableHeight / slideHeight;
        const scale = Math.min(scaleX, scaleY);
        
        slide.style.transform = `scale(${scale})`;
    },

    /**
     * 处理展示模式键盘事件
     */
    _handleSlideshowKeydown(e) {
        switch (e.key) {
            case 'ArrowRight':
            case 'ArrowDown':
            case ' ':
            case 'Enter':
                e.preventDefault();
                this._slideshowNext();
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                e.preventDefault();
                this._slideshowPrev();
                break;
            case 'Escape':
                this.exitSlideshow();
                break;
            case 'Home':
                e.preventDefault();
                this._slideshowGoTo(0);
                break;
            case 'End':
                e.preventDefault();
                this._slideshowGoTo(this.slides.length - 1);
                break;
        }
    },

    _slideshowNext() {
        if (this._slideshowIndex < this.slides.length - 1) {
            this._slideshowIndex++;
            this._updateSlideshowView();
        }
    },

    _slideshowPrev() {
        if (this._slideshowIndex > 0) {
            this._slideshowIndex--;
            this._updateSlideshowView();
        }
    },

    _slideshowGoTo(index) {
        this._slideshowIndex = Math.max(0, Math.min(this.slides.length - 1, index));
        this._updateSlideshowView();
    },

    _updateSlideshowView() {
        const slideEl = document.getElementById('slideshowSlide');
        if (slideEl) {
            slideEl.innerHTML = `
                ${this._renderSlideContent(this.slides[this._slideshowIndex])}
                <div class="slideshow-controls">
                    <span id="slideshowPageInfo">${this._slideshowIndex + 1} / ${this.slides.length}</span>
                    <span class="slideshow-hint">← → 翻页 · ESC 退出</span>
                </div>
            `;
        }
    },

    // ============================================================
    // Slide Editing Actions (Toolbar)
    // ============================================================

    /**
     * 通过 AI 新增幻灯片
     */
    addSlideWithAI() {
        // 聚焦到聊天输入框，并填充提示
        const chatInput = document.getElementById('pptChatInput');
        if (chatInput) {
            chatInput.value = `在第 ${this.currentSlideIndex + 1} 页后新增一页幻灯片，内容是：`;
            chatInput.focus();
            chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
        }
    },

    /**
     * 编辑当前幻灯片
     */
    editCurrentSlide() {
        const chatInput = document.getElementById('pptChatInput');
        if (chatInput) {
            chatInput.value = `修改第 ${this.currentSlideIndex + 1} 页：`;
            chatInput.focus();
            chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
        }
    },

    /**
     * 复制当前幻灯片
     */
    duplicateSlide() {
        if (!this.slides || this.slides.length === 0) return;
        
        const currentSlide = this.slides[this.currentSlideIndex];
        const duplicated = JSON.parse(JSON.stringify(currentSlide));
        
        // 插入到当前页之后
        this.slides.splice(this.currentSlideIndex + 1, 0, duplicated);
        this.currentSlideIndex++;
        
        this._saveProject();
        this._refreshPresentation();
        this.addChatMessage('ai', `已复制第 ${this.currentSlideIndex} 页到第 ${this.currentSlideIndex + 1} 页。`);
    },

    /**
     * 删除当前幻灯片
     */
    deleteCurrentSlide() {
        if (!this.slides || this.slides.length <= 1) {
            this.addChatMessage('ai', '至少需要保留一页幻灯片。');
            return;
        }
        
        const deletedIndex = this.currentSlideIndex + 1;
        this.slides.splice(this.currentSlideIndex, 1);
        
        // 调整当前索引
        if (this.currentSlideIndex >= this.slides.length) {
            this.currentSlideIndex = this.slides.length - 1;
        }
        
        this._saveProject();
        this._refreshPresentation();
        this.addChatMessage('ai', `已删除第 ${deletedIndex} 页。`);
    },

    /**
     * 刷新演示界面
     */
    _refreshPresentation() {
        const container = document.getElementById('pptPreviewArea');
        if (container) {
            this.renderPresentationMode(container);
        }
    }
};

Object.assign(PPTGenerator.prototype, PPTGeneratorPresentation);
