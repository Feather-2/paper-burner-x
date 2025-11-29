/**
 * PPTGeneratorExport 旧版导出模块
 * 包含: 旧版 PPTX 导出方法（用于兼容性）
 */

const PPTGeneratorExportLegacy = {
    async _exportWithSlideSystem() {
        const btn = document.querySelector('.ppt-export-btn');
        const originalContent = btn?.innerHTML;

        btn.disabled = true;
        btn.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin"></iconify-icon> 正在打包...';

        try {
            const renderer = new PPTXSlideRenderer();
            const filename = `${this.currentProject?.title || 'presentation'}.pptx`;

            await renderer.render(this.slides, filename);

            btn.innerHTML = '<iconify-icon icon="carbon:checkmark"></iconify-icon> 导出成功';
            btn.style.backgroundColor = 'var(--ppt-success)';
            setTimeout(() => {
                btn.disabled = false;
                btn.innerHTML = originalContent;
                btn.style.backgroundColor = '';
            }, 2000);
        } catch (e) {
            console.error('SlideSystem export error:', e);
            alert('导出失败: ' + e.message);
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    },

    _exportLegacy() {
        if (typeof PptxGenJS === 'undefined') {
            alert('PPTX 生成库未加载，请检查网络连接。');
            return;
        }

        const btn = document.querySelector('.ppt-header-right .ppt-btn-primary');
        const originalContent = btn.innerHTML;

        btn.disabled = true;
        btn.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin"></iconify-icon> 正在打包...';

        try {
            const pres = new PptxGenJS();
            pres.layout = 'LAYOUT_16x9';
            pres.title = this.currentProject.title || 'Presentation';

            const SLIDE_W = 10;
            const SLIDE_H = 5.625;

            const COLORS = {
                primary: '4f46e5',
                primaryLight: 'e0e7ff',
                textMain: '0f172a',
                textSecondary: '475569',
                textMuted: '94a3b8',
                success: '16a34a',
                successBg: 'dcfce7',
                danger: 'dc2626',
                dangerBg: 'fee2e2',
                border: 'e2e8f0',
                bgSubtle: 'f8fafc',
                purple: 'faf5ff'
            };

            this.slides.forEach(slideData => {
                const slide = pres.addSlide();
                slide.background = { color: 'FFFFFF' };

                const padding = 0.7;
                const contentWidth = SLIDE_W - padding * 2;

                if (slideData.type === 'cover') {
                    this._renderLegacyCover(slide, slideData, SLIDE_W, SLIDE_H, COLORS);
                } else if (slideData.type === 'toc') {
                    this._renderLegacyToc(slide, slideData, padding, contentWidth, COLORS);
                } else if (slideData.type === 'stats') {
                    this._renderLegacyStats(slide, slideData, padding, contentWidth, SLIDE_H, COLORS);
                } else if (slideData.type === 'comparison') {
                    this._renderLegacyComparison(slide, slideData, padding, contentWidth, SLIDE_H, COLORS);
                } else if (slideData.type === 'image_text') {
                    this._renderLegacyImageText(slide, slideData, padding, contentWidth, SLIDE_H, COLORS);
                } else if (slideData.type === 'icon_grid') {
                    this._renderLegacyIconGrid(slide, slideData, padding, contentWidth, COLORS);
                } else if (slideData.type === 'quote') {
                    this._renderLegacyQuote(slide, slideData, padding, contentWidth, SLIDE_H, COLORS);
                } else if (slideData.type === 'timeline') {
                    this._renderLegacyTimeline(slide, slideData, padding, contentWidth, SLIDE_H, COLORS);
                } else if (slideData.type === 'end') {
                    this._renderLegacyEnd(slide, slideData, padding, contentWidth, SLIDE_W, SLIDE_H);
                } else if (slideData.type === 'list') {
                    this._renderLegacyList(slide, slideData, padding, contentWidth, SLIDE_H, COLORS);
                } else {
                    this._renderLegacyContent(slide, slideData, padding, contentWidth, SLIDE_H, COLORS);
                }
            });

            pres.writeFile({ fileName: `${this.currentProject.title || 'presentation'}.pptx` })
                .then(() => {
                    btn.innerHTML = '<iconify-icon icon="carbon:checkmark"></iconify-icon> 导出成功';
                    btn.style.backgroundColor = 'var(--ppt-success)';
                    setTimeout(() => {
                        btn.disabled = false;
                        btn.innerHTML = originalContent;
                        btn.style.backgroundColor = '';
                    }, 2000);
                })
                .catch(err => {
                    console.error(err);
                    alert('导出失败: ' + err.message);
                    btn.disabled = false;
                    btn.innerHTML = originalContent;
                });

        } catch (e) {
            console.error(e);
            alert('生成 PPTX 时发生错误');
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    },

    _renderLegacyCover(slide, slideData, SLIDE_W, SLIDE_H, COLORS) {
        const coverPadding = 0.93;
        slide.background = { color: COLORS.primary };

        slide.addShape('rect', {
            x: 0, y: 0, w: '100%', h: '100%',
            fill: { type: 'solid', color: '3b82f6', transparency: 50 },
            line: { transparency: 100 }
        });

        slide.addShape('ellipse', {
            x: SLIDE_W - 3.5, y: -1.4, w: 4.6, h: 4.6,
            fill: { type: 'solid', color: 'FFFFFF', transparency: 90 },
            line: { transparency: 100 }
        });

        const startY = SLIDE_H * 0.35;
        slide.addText(slideData.title, {
            x: coverPadding, y: startY, w: SLIDE_W - coverPadding * 2, h: 0.8,
            fontSize: 44, color: 'FFFFFF', bold: true, align: 'left'
        });
        slide.addText(slideData.subtitle || '', {
            x: coverPadding, y: startY + 0.9, w: SLIDE_W - coverPadding * 2, h: 0.5,
            fontSize: 22, color: 'FFFFFF', transparency: 20, align: 'left'
        });
        slide.addText('Generated by Paper Burner X', {
            x: coverPadding, y: SLIDE_H - 0.6, w: SLIDE_W - coverPadding * 2, h: 0.3,
            fontSize: 11, color: 'FFFFFF', transparency: 50, align: 'left'
        });
    },

    _renderLegacyToc(slide, slideData, padding, contentWidth, COLORS) {
        slide.addText(slideData.title, {
            x: padding, y: padding, w: contentWidth, h: 0.6,
            fontSize: 32, color: COLORS.textMain, bold: true
        });

        const items = slideData.items || [];
        const startY = padding + 0.9;
        const itemHeight = 0.55;

        items.forEach((item, i) => {
            const y = startY + i * itemHeight;
            slide.addShape('ellipse', {
                x: padding, y: y, w: 0.4, h: 0.4,
                fill: { color: COLORS.primary },
                line: { transparency: 100 }
            });
            slide.addText(String(i + 1), {
                x: padding, y: y, w: 0.4, h: 0.4,
                fontSize: 14, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle'
            });
            slide.addText(item, {
                x: padding + 0.55, y: y, w: contentWidth - 0.55, h: 0.4,
                fontSize: 20, color: COLORS.textSecondary, valign: 'middle'
            });
        });
    },

    _renderLegacyStats(slide, slideData, padding, contentWidth, SLIDE_H, COLORS) {
        slide.addText(slideData.title, {
            x: padding, y: padding, w: contentWidth, h: 0.6,
            fontSize: 32, color: COLORS.textMain, bold: true
        });

        const stats = slideData.stats || [];
        const cols = Math.min(stats.length, 4);
        const cardW = (contentWidth - 0.3 * (cols - 1)) / cols;
        const cardH = 1.8;
        const startY = (SLIDE_H - cardH) / 2;

        stats.forEach((stat, i) => {
            const x = padding + i * (cardW + 0.3);
            slide.addText(stat.value, {
                x: x, y: startY, w: cardW, h: 1,
                fontSize: 48, color: COLORS.primary, bold: true, align: 'center', valign: 'bottom'
            });
            slide.addText(stat.label, {
                x: x, y: startY + 1.1, w: cardW, h: 0.5,
                fontSize: 14, color: COLORS.textSecondary, align: 'center', valign: 'top'
            });
        });
    },

    _renderLegacyComparison(slide, slideData, padding, contentWidth, SLIDE_H, COLORS) {
        slide.addText(slideData.title, {
            x: padding, y: padding, w: contentWidth, h: 0.6,
            fontSize: 32, color: COLORS.textMain, bold: true
        });

        const boxW = (contentWidth - 0.4) / 2;
        const boxH = SLIDE_H - padding * 2 - 1;
        const boxY = padding + 0.8;

        slide.addShape('roundRect', {
            x: padding, y: boxY, w: boxW, h: boxH,
            fill: { color: COLORS.dangerBg },
            line: { transparency: 100 },
            rectRadius: 0.15
        });
        slide.addText(slideData.left?.title || '', {
            x: padding + 0.3, y: boxY + 0.25, w: boxW - 0.6, h: 0.4,
            fontSize: 20, color: COLORS.danger, bold: true
        });
        const leftItems = (slideData.left?.items || []).map(item => ({
            text: '✕  ' + item,
            options: { fontSize: 16, color: '991b1b', breakLine: true }
        }));
        slide.addText(leftItems, {
            x: padding + 0.3, y: boxY + 0.75, w: boxW - 0.6, h: boxH - 1,
            lineSpacing: 32, valign: 'top'
        });

        const rightX = padding + boxW + 0.4;
        slide.addShape('roundRect', {
            x: rightX, y: boxY, w: boxW, h: boxH,
            fill: { color: COLORS.successBg },
            line: { transparency: 100 },
            rectRadius: 0.15
        });
        slide.addText(slideData.right?.title || '', {
            x: rightX + 0.3, y: boxY + 0.25, w: boxW - 0.6, h: 0.4,
            fontSize: 20, color: COLORS.success, bold: true
        });
        const rightItems = (slideData.right?.items || []).map(item => ({
            text: '✓  ' + item,
            options: { fontSize: 16, color: '166534', breakLine: true }
        }));
        slide.addText(rightItems, {
            x: rightX + 0.3, y: boxY + 0.75, w: boxW - 0.6, h: boxH - 1,
            lineSpacing: 32, valign: 'top'
        });
    },

    _renderLegacyImageText(slide, slideData, padding, contentWidth, SLIDE_H, COLORS) {
        const halfW = (contentWidth - 0.5) / 2;
        const centerY = SLIDE_H / 2;

        slide.addText(slideData.title, {
            x: padding, y: centerY - 1.2, w: halfW, h: 0.6,
            fontSize: 32, color: COLORS.textMain, bold: true
        });
        slide.addText(slideData.content || '', {
            x: padding, y: centerY - 0.4, w: halfW, h: 1.5,
            fontSize: 18, color: COLORS.textSecondary, lineSpacing: 28
        });

        const imgX = padding + halfW + 0.5;
        const imgH = 2.8;
        const imgY = (SLIDE_H - imgH) / 2;
        slide.addShape('roundRect', {
            x: imgX, y: imgY, w: halfW, h: imgH,
            fill: { color: COLORS.primaryLight },
            line: { transparency: 100 },
            rectRadius: 0.15
        });
        slide.addText(slideData.imagePlaceholder || '图片', {
            x: imgX, y: imgY, w: halfW, h: imgH,
            fontSize: 16, color: COLORS.primary, align: 'center', valign: 'middle'
        });
    },

    _renderLegacyIconGrid(slide, slideData, padding, contentWidth, COLORS) {
        slide.addText(slideData.title, {
            x: padding, y: padding, w: contentWidth, h: 0.6,
            fontSize: 32, color: COLORS.textMain, bold: true
        });

        const items = slideData.items || [];
        const cols = Math.min(items.length, 4);
        const cardW = (contentWidth - 0.3 * (cols - 1)) / cols;
        const cardH = 2;
        const startY = padding + 1;

        items.forEach((item, i) => {
            const x = padding + i * (cardW + 0.3);
            slide.addShape('roundRect', {
                x: x, y: startY, w: cardW, h: cardH,
                fill: { color: COLORS.bgSubtle },
                line: { transparency: 100 },
                rectRadius: 0.15
            });
            const iconSize = 0.6;
            const iconX = x + (cardW - iconSize) / 2;
            slide.addShape('roundRect', {
                x: iconX, y: startY + 0.3, w: iconSize, h: iconSize,
                fill: { color: COLORS.primaryLight },
                line: { transparency: 100 },
                rectRadius: 0.1
            });
            slide.addText(item.title, {
                x: x, y: startY + 1.1, w: cardW, h: 0.35,
                fontSize: 16, color: COLORS.textMain, bold: true, align: 'center'
            });
            slide.addText(item.desc, {
                x: x + 0.1, y: startY + 1.45, w: cardW - 0.2, h: 0.4,
                fontSize: 12, color: COLORS.textSecondary, align: 'center'
            });
        });
    },

    _renderLegacyQuote(slide, slideData, padding, contentWidth, SLIDE_H, COLORS) {
        slide.background = { color: COLORS.purple };

        slide.addText('"', {
            x: padding, y: 0.8, w: 1, h: 1,
            fontSize: 72, color: COLORS.primary, transparency: 70
        });

        const quote = slideData.quote || '';
        slide.addText(`"${quote}"`, {
            x: padding + 0.5, y: (SLIDE_H - 1.5) / 2, w: contentWidth - 1, h: 1.5,
            fontSize: 26, color: COLORS.textMain, align: 'center', valign: 'middle', italic: true
        });

        slide.addText(slideData.author || '', {
            x: padding, y: SLIDE_H - 1.2, w: contentWidth, h: 0.35,
            fontSize: 18, color: COLORS.textMain, bold: true, align: 'center'
        });
        slide.addText(slideData.company || '', {
            x: padding, y: SLIDE_H - 0.8, w: contentWidth, h: 0.3,
            fontSize: 14, color: COLORS.textSecondary, align: 'center'
        });
    },

    _renderLegacyTimeline(slide, slideData, padding, contentWidth, SLIDE_H, COLORS) {
        slide.addText(slideData.title, {
            x: padding, y: padding, w: contentWidth, h: 0.6,
            fontSize: 32, color: COLORS.textMain, bold: true
        });

        const items = slideData.items || [];
        const cols = items.length;
        const nodeW = contentWidth / cols;
        const lineY = SLIDE_H / 2;

        slide.addShape('rect', {
            x: padding, y: lineY - 0.02, w: contentWidth, h: 0.04,
            fill: { color: COLORS.border },
            line: { transparency: 100 }
        });

        items.forEach((item, i) => {
            const centerX = padding + nodeW * i + nodeW / 2;
            const circleR = 0.28;
            slide.addShape('ellipse', {
                x: centerX - circleR, y: lineY - circleR, w: circleR * 2, h: circleR * 2,
                fill: { color: COLORS.primary },
                line: { transparency: 100 }
            });
            slide.addText(item.phase, {
                x: centerX - circleR, y: lineY - circleR, w: circleR * 2, h: circleR * 2,
                fontSize: 12, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle'
            });
            slide.addText(item.title, {
                x: centerX - nodeW / 2 + 0.1, y: lineY + 0.4, w: nodeW - 0.2, h: 0.35,
                fontSize: 16, color: COLORS.textMain, bold: true, align: 'center'
            });
            slide.addText(item.desc, {
                x: centerX - nodeW / 2 + 0.1, y: lineY + 0.75, w: nodeW - 0.2, h: 0.4,
                fontSize: 12, color: COLORS.textSecondary, align: 'center'
            });
        });
    },

    _renderLegacyEnd(slide, slideData, padding, contentWidth, SLIDE_W, SLIDE_H) {
        slide.background = { color: '0f172a' };

        slide.addShape('rect', {
            x: 0, y: 0, w: '100%', h: '100%',
            fill: { type: 'solid', color: '1e293b', transparency: 50 },
            line: { transparency: 100 }
        });

        slide.addShape('ellipse', {
            x: SLIDE_W - 3.5, y: -1.4, w: 4.6, h: 4.6,
            fill: { type: 'solid', color: 'FFFFFF', transparency: 95 },
            line: { transparency: 100 }
        });

        const centerY = SLIDE_H * 0.4;
        slide.addText(slideData.title, {
            x: padding, y: centerY, w: contentWidth, h: 0.8,
            fontSize: 44, color: 'FFFFFF', bold: true, align: 'left'
        });
        slide.addText(slideData.subtitle || '', {
            x: padding, y: centerY + 0.9, w: contentWidth, h: 0.5,
            fontSize: 22, color: 'FFFFFF', transparency: 30, align: 'left'
        });
        if (slideData.email) {
            slide.addText(slideData.email, {
                x: padding, y: centerY + 1.6, w: contentWidth, h: 0.4,
                fontSize: 16, color: 'FFFFFF', transparency: 50, align: 'left'
            });
        }
        slide.addText('Generated by Paper Burner X', {
            x: padding, y: SLIDE_H - 0.6, w: contentWidth, h: 0.3,
            fontSize: 11, color: 'FFFFFF', transparency: 60, align: 'left'
        });
    },

    _renderLegacyList(slide, slideData, padding, contentWidth, SLIDE_H, COLORS) {
        slide.addText(slideData.title, {
            x: padding, y: padding, w: contentWidth, h: 0.6,
            fontSize: 32, color: COLORS.textMain, bold: true
        });

        if (slideData.items && slideData.items.length > 0) {
            const listY = padding + 0.9;
            const items = slideData.items.map(item => ({
                text: item,
                options: { fontSize: 20, color: COLORS.textSecondary, breakLine: true }
            }));
            slide.addText(items, {
                x: padding, y: listY, w: contentWidth, h: SLIDE_H - listY - padding,
                bullet: { type: 'bullet', code: '2022' },
                lineSpacing: 40, valign: 'top'
            });
        }
    },

    _renderLegacyContent(slide, slideData, padding, contentWidth, SLIDE_H, COLORS) {
        const titleH = 0.6;
        const contentH = 1.5;
        const totalH = titleH + 0.3 + contentH;
        const startY = (SLIDE_H - totalH) / 2;

        slide.addText(slideData.title, {
            x: padding, y: startY, w: contentWidth, h: titleH,
            fontSize: 32, color: COLORS.textMain, bold: true
        });
        slide.addText(slideData.content || '', {
            x: padding, y: startY + titleH + 0.3, w: contentWidth, h: contentH,
            fontSize: 20, color: COLORS.textSecondary, lineSpacing: 32
        });
    },
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PPTGeneratorExportLegacy;
}
