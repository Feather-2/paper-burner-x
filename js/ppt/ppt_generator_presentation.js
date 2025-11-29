const PPTGeneratorPresentation = {
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
                                <button class="ppt-export-item" onclick="window.PPTGenerator.exportAs('html-raw')">
                                    <iconify-icon icon="carbon:code"></iconify-icon>
                                    <div class="ppt-export-item-info">
                                        <span class="ppt-export-item-title">原始 HTML</span>
                                        <span class="ppt-export-item-desc">AI 输出的 data-* 格式</span>
                                    </div>
                                </button>
                                <button class="ppt-export-item" onclick="window.PPTGenerator.exportAs('html-rendered')">
                                    <iconify-icon icon="carbon:view"></iconify-icon>
                                    <div class="ppt-export-item-info">
                                        <span class="ppt-export-item-title">渲染后 HTML</span>
                                        <span class="ppt-export-item-desc">经过样式处理的 HTML</span>
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
    }
};

Object.assign(PPTGenerator.prototype, PPTGeneratorPresentation);
