/**
 * PPTX 幻灯片解析器
 * 将 PPTX 文件解析为 Slide[] 数据结构，供编辑和 AI 参考
 * 
 * 依赖: JSZip (已在项目中使用)
 */

class PPTXSlideParser {
    constructor() {
        // EMU (English Metric Units) 转换常量
        this.EMU_PER_INCH = 914400;
        this.EMU_PER_PT = 12700;
        
        // 默认幻灯片尺寸 (16:9)
        this.SLIDE_WIDTH_EMU = 12192000;  // 13.333 inches
        this.SLIDE_HEIGHT_EMU = 6858000;  // 7.5 inches
        
        // 主题颜色映射（解析时填充）
        this.themeColors = {};

        // 字体方案（解析时填充）
        this.fontScheme = {};

        // 颜色使用频率统计（用于分析主导颜色）
        this.colorUsage = {};
        
        // 媒体文件缓存
        this.mediaCache = {};
        
        // 关系映射
        this.relationships = {};
        
        // 布局占位符位置缓存 { layoutId: { phType: {x,y,w,h} } }
        this.layoutPlaceholders = {};
        
        // 幻灯片使用的布局映射 { slideNum: layoutPath }
        this.slideLayouts = {};
    }

    // ═══════════════════════════════════════════════════════════════
    // 主入口
    // ═══════════════════════════════════════════════════════════════

    /**
     * 解析 PPTX 文件
     * @param {File|Blob|ArrayBuffer} pptxFile - PPTX 文件
     * @returns {Promise<{slides: Array, html: string, metadata: Object}>}
     */
    async parse(pptxFile) {
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip 未加载');
        }

        console.log('[PPTXSlideParser] Starting parse...');
        
        const zip = await JSZip.loadAsync(pptxFile);
        this.zip = zip;
        
        // 1. 解析演示文稿元数据
        const metadata = await this.parsePresentation(zip);
        
        // 2. 解析主题（获取颜色方案）
        await this.parseTheme(zip);
        
        // 3. 解析所有布局（获取占位符默认位置）
        await this.parseLayouts(zip);
        
        // 4. 按顺序解析每张幻灯片
        const slides = [];
        for (let i = 0; i < metadata.slideCount; i++) {
            const slideNum = i + 1;
            console.log(`[PPTXSlideParser] Parsing slide ${slideNum}...`);
            
            try {
                // 加载幻灯片关系
                await this.loadSlideRelationships(zip, slideNum);
                
                const slide = await this.parseSlide(zip, slideNum);
                slides.push(slide);
            } catch (e) {
                console.error(`[PPTXSlideParser] Error parsing slide ${slideNum}:`, e);
                // 添加一个空白幻灯片占位
                slides.push({
                    type: 'freeform',
                    id: `slide-${slideNum}`,
                    background: '#ffffff',
                    elements: [],
                    error: e.message
                });
            }
        }
        
        // 4. 生成类 HTML 表示（供 AI 参考）
        const html = this.generateHtml(slides);
        
        console.log(`[PPTXSlideParser] Parsed ${slides.length} slides`);
        
        return { slides, html, metadata };
    }

    // ═══════════════════════════════════════════════════════════════
    // 演示文稿元数据
    // ═══════════════════════════════════════════════════════════════

    async parsePresentation(zip) {
        const presXml = await zip.file('ppt/presentation.xml')?.async('string');
        if (!presXml) throw new Error('Invalid PPTX: missing presentation.xml');
        
        const doc = this.parseXml(presXml);
        
        // 获取幻灯片尺寸
        const sldSz = doc.querySelector('sldSz');
        if (sldSz) {
            this.SLIDE_WIDTH_EMU = parseInt(sldSz.getAttribute('cx')) || this.SLIDE_WIDTH_EMU;
            this.SLIDE_HEIGHT_EMU = parseInt(sldSz.getAttribute('cy')) || this.SLIDE_HEIGHT_EMU;
        }
        
        // 获取幻灯片列表
        const sldIdLst = doc.querySelectorAll('sldIdLst > sldId');
        
        return {
            slideCount: sldIdLst.length,
            width: this.SLIDE_WIDTH_EMU / this.EMU_PER_INCH,
            height: this.SLIDE_HEIGHT_EMU / this.EMU_PER_INCH,
            aspectRatio: this.SLIDE_WIDTH_EMU / this.SLIDE_HEIGHT_EMU
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // 主题解析
    // ═══════════════════════════════════════════════════════════════

    async parseTheme(zip) {
        const themeXml = await zip.file('ppt/theme/theme1.xml')?.async('string');
        if (!themeXml) return;
        
        const doc = this.parseXml(themeXml);

        // 解析字体方案
        this.parseFontScheme(doc);
        
        // 解析颜色方案
        const clrScheme = doc.querySelector('clrScheme');
        if (clrScheme) {
            const colorNames = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 
                               'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
            
            colorNames.forEach(name => {
                const colorEl = clrScheme.querySelector(name);
                if (colorEl) {
                    const srgbClr = colorEl.querySelector('srgbClr');
                    const sysClr = colorEl.querySelector('sysClr');
                    
                    if (srgbClr) {
                        this.themeColors[name] = { name, value: '#' + srgbClr.getAttribute('val') };
                    } else if (sysClr) {
                        this.themeColors[name] = { name, value: '#' + (sysClr.getAttribute('lastClr') || '000000') };
                    }
                }
            });
        }
        
        console.log('[PPTXSlideParser] Theme colors:', this.themeColors);
    }

    parseFontScheme(doc) {
        if (!doc) return;
        
        const fontScheme = doc.querySelector('fontScheme');
        if (!fontScheme) return;
        
        const majorFont = fontScheme.querySelector('majorFont > latin')?.getAttribute('typeface') || '';
        const minorFont = fontScheme.querySelector('minorFont > latin')?.getAttribute('typeface') || '';
        
        this.fontScheme = { majorFont, minorFont };
        console.log('[PPTXSlideParser] Font scheme:', this.fontScheme);
    }

    async extractStyleSpec() {
        if (!this.zip) {
            throw new Error('PPTX 未解析，无法提取样式信息');
        }
        
        // 确保主题已解析
        if (!Object.keys(this.themeColors || {}).length || !Object.keys(this.fontScheme || {}).length) {
            await this.parseTheme(this.zip);
        }
        
        return {
            themeColors: this.themeColors,
            fontScheme: this.fontScheme,
            designTraits: this.analyzeDesignTraits()
        };
    }

    analyzeDesignTraits() {
        // 分析主色调冷暖
        const colorTone = this.analyzeColorTone(this.themeColors);
        // 提取主导颜色（使用频率最高的）
        const dominantColors = this.extractDominantColors();
        
        return {
            colorTone,
            dominantColors
        };
    }

    analyzeColorTone(themeColors) {
        const keys = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
        const colors = keys.map(k => themeColors?.[k]?.value).filter(Boolean);
        
        let warm = 0;
        let cool = 0;
        let neutral = 0;
        
        colors.forEach(hex => {
            const rgb = this.hexToRgb(hex);
            if (!rgb) return;
            
            const hsl = this.rgbToHsl(rgb.r, rgb.g, rgb.b);
            if (!hsl) return;
            
            const { h, s, l } = hsl;
            
            // 低饱和、接近黑白认为是中性
            if (s < 0.15 || l < 0.12 || l > 0.88) {
                neutral++;
                return;
            }
            
            // 暖色：红-橙-黄 & 紫红区；冷色：绿-青-蓝区
            if (h < 60 || h >= 300) warm++;
            else if (h >= 120 && h < 240) cool++;
            else neutral++;
        });
        
        if (warm > cool && warm > neutral) return 'warm';
        if (cool > warm && cool > neutral) return 'cool';
        return 'neutral';
    }

    extractDominantColors() {
        const usageEntries = Object.entries(this.colorUsage || {});
        usageEntries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
        
        const dominant = [];
        for (const [hex] of usageEntries) {
            if (dominant.length >= 3) break;
            if (!dominant.includes(hex)) dominant.push(hex);
        }
        
        // 如果没有统计到使用频率，回退到主题色
        if (!dominant.length) {
            const fallbackKeys = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
            fallbackKeys.forEach(k => {
                const hex = this.themeColors?.[k]?.value;
                if (hex && dominant.length < 3 && !dominant.includes(hex.toUpperCase())) {
                    dominant.push(hex.toUpperCase());
                }
            });
        }
        
        return dominant.slice(0, 3);
    }

    hexToRgb(hex) {
        if (!hex || typeof hex !== 'string') return null;
        const m = hex.trim().match(/^#?([0-9a-fA-F]{6})$/);
        if (!m) return null;
        const v = m[1];
        return {
            r: parseInt(v.slice(0, 2), 16),
            g: parseInt(v.slice(2, 4), 16),
            b: parseInt(v.slice(4, 6), 16)
        };
    }

    rgbToHsl(r, g, b) {
        if ([r, g, b].some(v => typeof v !== 'number' || Number.isNaN(v))) return null;
        r /= 255;
        g /= 255;
        b /= 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;
        
        if (d !== 0) {
            s = d / (1 - Math.abs(2 * l - 1));
            switch (max) {
                case r:
                    h = ((g - b) / d) % 6;
                    break;
                case g:
                    h = (b - r) / d + 2;
                    break;
                case b:
                    h = (r - g) / d + 4;
                    break;
            }
            h = Math.round(h * 60);
            if (h < 0) h += 360;
        }
        
        return { h, s, l };
    }

    // ═══════════════════════════════════════════════════════════════
    // 布局解析（获取占位符默认位置）
    // ═══════════════════════════════════════════════════════════════

    async parseLayouts(zip) {
        // 查找所有布局文件
        const layoutFiles = Object.keys(zip.files).filter(f => 
            f.startsWith('ppt/slideLayouts/') && f.endsWith('.xml') && !f.includes('_rels')
        );
        
        for (const layoutPath of layoutFiles) {
            const layoutXml = await zip.file(layoutPath)?.async('string');
            if (!layoutXml) continue;
            
            const doc = this.parseXml(layoutXml);
            const layoutId = layoutPath.replace('ppt/slideLayouts/', '').replace('.xml', '');
            
            this.layoutPlaceholders[layoutId] = {};
            
            // 解析布局中的所有形状占位符
            doc.querySelectorAll('sp').forEach(sp => {
                const ph = sp.querySelector('nvSpPr > nvPr > ph');
                if (!ph) return;
                
                const phType = ph.getAttribute('type') || 'body';
                const phIdx = ph.getAttribute('idx') || '0';
                const key = `${phType}_${phIdx}`;
                
                // 获取位置
                const xfrm = sp.querySelector('spPr > xfrm');
                if (xfrm) {
                    const off = xfrm.querySelector('off');
                    const ext = xfrm.querySelector('ext');
                    
                    this.layoutPlaceholders[layoutId][key] = {
                        type: phType,
                        idx: phIdx,
                        xEmu: parseInt(off?.getAttribute('x')) || 0,
                        yEmu: parseInt(off?.getAttribute('y')) || 0,
                        wEmu: parseInt(ext?.getAttribute('cx')) || 0,
                        hEmu: parseInt(ext?.getAttribute('cy')) || 0
                    };
                }
            });
        }
        
        console.log('[PPTXSlideParser] Parsed layouts:', Object.keys(this.layoutPlaceholders).length);
    }

    // ═══════════════════════════════════════════════════════════════
    // 幻灯片关系
    // ═══════════════════════════════════════════════════════════════

    async loadSlideRelationships(zip, slideNum) {
        const relsPath = `ppt/slides/_rels/slide${slideNum}.xml.rels`;
        const relsXml = await zip.file(relsPath)?.async('string');
        
        this.relationships = {};
        this.currentLayoutId = null;
        
        if (relsXml) {
            const doc = this.parseXml(relsXml);
            const rels = doc.querySelectorAll('Relationship');
            
            rels.forEach(rel => {
                const id = rel.getAttribute('Id');
                const target = rel.getAttribute('Target');
                const type = rel.getAttribute('Type');
                
                this.relationships[id] = {
                    target: target,
                    type: type,
                    // 解析相对路径
                    fullPath: target.startsWith('../') 
                        ? 'ppt/' + target.substring(3)
                        : `ppt/slides/${target}`
                };
                
                // 记录布局关系
                if (type?.includes('slideLayout')) {
                    // 从 ../slideLayouts/slideLayout1.xml 提取 slideLayout1
                    const match = target.match(/slideLayout(\d+)\.xml/);
                    if (match) {
                        this.currentLayoutId = `slideLayout${match[1]}`;
                    }
                }
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 幻灯片解析
    // ═══════════════════════════════════════════════════════════════

    async parseSlide(zip, slideNum) {
        const slidePath = `ppt/slides/slide${slideNum}.xml`;
        const slideXml = await zip.file(slidePath)?.async('string');
        
        if (!slideXml) {
            return { type: 'freeform', elements: [], error: `Slide ${slideNum} not found` };
        }
        
        const doc = this.parseXml(slideXml);
        
        // 解析背景
        const background = this.parseBackground(doc);
        
        // 解析所有元素
        const elements = [];
        const spTree = doc.querySelector('spTree');
        let elementIndex = 0;  // 全局唯一索引
        
        if (spTree) {
            // 形状 (包含文本框) - 异步处理
            const sps = spTree.querySelectorAll(':scope > sp');
            for (let i = 0; i < sps.length; i++) {
                const el = await this.parseShape(zip, sps[i], elementIndex++);
                if (el) elements.push(el);
            }
            
            // 图片 (异步提取)
            const pics = spTree.querySelectorAll(':scope > pic');
            for (let i = 0; i < pics.length; i++) {
                const el = await this.parsePicture(zip, pics[i], elementIndex++);
                if (el) elements.push(el);
            }
            
            // 图形框架 (表格、图表等) - 异步
            const gfs = spTree.querySelectorAll(':scope > graphicFrame');
            for (let i = 0; i < gfs.length; i++) {
                const el = await this.parseGraphicFrame(zip, gfs[i], elementIndex++);
                if (el) elements.push(el);
            }
            
            // 连接线
            spTree.querySelectorAll(':scope > cxnSp').forEach((cxn) => {
                const el = this.parseConnector(cxn, elementIndex++);
                if (el) elements.push(el);
            });
            
            // 分组 (异步处理) - 展平到顶层
            const grps = spTree.querySelectorAll(':scope > grpSp');
            for (let i = 0; i < grps.length; i++) {
                const groupChildren = await this.parseGroupFlattened(zip, grps[i], elementIndex);
                elements.push(...groupChildren);
                elementIndex += groupChildren.length;
            }
        }
        
        return {
            type: 'freeform',
            id: `slide-${slideNum}`,
            background,
            elements
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // 背景解析
    // ═══════════════════════════════════════════════════════════════

    parseBackground(doc) {
        const bgPr = doc.querySelector('cSld > bg > bgPr');
        const bgRef = doc.querySelector('cSld > bg > bgRef');
        
        if (bgPr) {
            // 纯色背景
            const solidFill = bgPr.querySelector('solidFill');
            if (solidFill) {
                return this.parseColorValue(solidFill);
            }
            
            // 渐变背景
            const gradFill = bgPr.querySelector('gradFill');
            if (gradFill) {
                return this.parseGradient(gradFill);
            }
            
            // 图片背景
            const blipFill = bgPr.querySelector('blipFill');
            if (blipFill) {
                return this.parseBlipFill(blipFill);
            }
        }
        
        return '#ffffff';
    }

    // ═══════════════════════════════════════════════════════════════
    // 形状解析 (文本框、形状)
    // ═══════════════════════════════════════════════════════════════

    async parseShape(zip, sp, index) {
        // 获取占位符信息（用于查找布局位置）
        const ph = sp.querySelector('nvSpPr > nvPr > ph');
        const placeholderType = ph?.getAttribute('type') || 'body';
        const placeholderIdx = ph?.getAttribute('idx') || '0';
        const placeholderRole = this.mapPlaceholderType(placeholderType);
        
        // 获取位置和大小
        const xfrm = sp.querySelector('spPr > xfrm');
        let { x, y, w, h, rotate, _rawEmu } = this.parseTransform(xfrm);
        
        // 如果没有位置信息，从布局继承
        if (ph && (!xfrm || (x === '0%' && y === '0%' && w === '10%' && h === '10%'))) {
            const layoutPos = this.getLayoutPlaceholderPosition(placeholderType, placeholderIdx);
            if (layoutPos) {
                x = layoutPos.x;
                y = layoutPos.y;
                w = layoutPos.w;
                h = layoutPos.h;
            }
        }
        
        // 获取形状类型
        const prstGeom = sp.querySelector('spPr > prstGeom');
        const shapeType = prstGeom?.getAttribute('prst') || 'rect';
        
        // 获取填充
        const spPr = sp.querySelector('spPr');
        let fill = this.parseFill(spPr);
        
        // 如果是图片填充，转换为图片元素
        if (fill && fill.type === 'image') {
            const src = await this.extractBlipFillImage(zip, fill.blipFill);
            return {
                type: 'image',
                id: `el-${index}`,
                x, y, w, h, rotate,
                _rawEmu,
                src,
                alt: '图片'
            };
        }
        
        // 获取边框
        const ln = sp.querySelector('spPr > ln');
        const { stroke, strokeWidth } = this.parseLine(ln);
        
        // 获取文本内容
        const txBody = sp.querySelector('txBody');
        const textInfo = this.parseTextBody(txBody);
        
        // 判断是文本框还是形状
        const isTextBox = shapeType === 'rect' && !fill && textInfo.content;
        
        // 跳过空的占位符（没有内容也没有可见填充）
        const isEmpty = !textInfo.content && !fill && !stroke;
        if (isEmpty && ph) {
            // 这是一个空的占位符，跳过
            return null;
        }
        
        if (isTextBox) {
            const result = {
                type: 'text',
                id: `el-${index}`,
                x, y, w, h, rotate,
                _rawEmu,  // 保留原始坐标用于分组变换
                content: textInfo.content,
                font: textInfo.fontSize,
                color: textInfo.color,
                bold: textInfo.bold,
                italic: textInfo.italic,
                align: textInfo.align,
                valign: textInfo.valign,
                lineHeight: textInfo.lineHeight,
                wrap: textInfo.wrap,
                overflow: textInfo.overflow
            };
            
            // 添加语义角色
            if (placeholderRole) result.role = placeholderRole;
            if (textInfo.hasBullets) result.hasBullets = true;
            if (textInfo.bulletType) result.bulletType = textInfo.bulletType;
            if (textInfo.links) result.links = textInfo.links;
            
            return result;
        } else {
            const result = {
                type: 'shape',
                id: `el-${index}`,
                x, y, w, h, rotate,
                _rawEmu,  // 保留原始坐标用于分组变换
                shape: this.mapShapeType(shapeType),
                fill: fill || '#4f46e5',
                stroke,
                strokeWidth
            };
            
            // 如果形状内有文字
            if (textInfo.content) {
                result.text = textInfo.content;
                result.textColor = textInfo.color;
                result.textSize = textInfo.fontSize;
            }
            
            // 添加语义角色
            if (placeholderRole) result.role = placeholderRole;
            
            return result;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 图片解析
    // ═══════════════════════════════════════════════════════════════

    async parsePicture(zip, pic, index) {
        // 获取位置和大小
        const xfrm = pic.querySelector('spPr > xfrm');
        const { x, y, w, h, rotate, _rawEmu } = this.parseTransform(xfrm);
        
        // 获取图片引用
        const blip = pic.querySelector('blipFill > blip');
        const embedId = blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
        
        let src = '';
        if (embedId && this.relationships[embedId]) {
            const imagePath = this.relationships[embedId].fullPath;
            try {
                // 提取图片为 Base64
                const imageFile = zip.file(imagePath);
                if (imageFile) {
                    const imageData = await imageFile.async('base64');
                    // 根据扩展名确定 MIME 类型
                    const ext = imagePath.split('.').pop().toLowerCase();
                    const mimeTypes = {
                        'png': 'image/png',
                        'jpg': 'image/jpeg',
                        'jpeg': 'image/jpeg',
                        'gif': 'image/gif',
                        'bmp': 'image/bmp',
                        'webp': 'image/webp',
                        'svg': 'image/svg+xml',
                        'emf': 'image/emf',
                        'wmf': 'image/wmf'
                    };
                    const mimeType = mimeTypes[ext] || 'image/png';
                    src = `data:${mimeType};base64,${imageData}`;
                }
            } catch (e) {
                console.warn(`[PPTXSlideParser] Failed to extract image: ${imagePath}`, e);
                src = `[图片提取失败: ${imagePath}]`;
            }
        }
        
        return {
            type: 'image',
            id: `el-${index}`,
            x, y, w, h, rotate,
            _rawEmu,
            src,
            alt: '图片'
        };
    }
    
    /**
     * 从 blipFill 提取图片
     */
    async extractBlipFillImage(zip, blipFill) {
        const blip = blipFill.querySelector('blip');
        const embedId = blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed')
                     || blip?.getAttribute('embed');  // 命名空间可能被移除
        
        if (embedId && this.relationships[embedId]) {
            const imagePath = this.relationships[embedId].fullPath;
            try {
                const imageFile = zip.file(imagePath);
                if (imageFile) {
                    const imageData = await imageFile.async('base64');
                    const ext = imagePath.split('.').pop().toLowerCase();
                    const mimeTypes = {
                        'png': 'image/png',
                        'jpg': 'image/jpeg',
                        'jpeg': 'image/jpeg',
                        'gif': 'image/gif',
                        'bmp': 'image/bmp',
                        'webp': 'image/webp'
                    };
                    const mimeType = mimeTypes[ext] || 'image/png';
                    return `data:${mimeType};base64,${imageData}`;
                }
            } catch (e) {
                console.warn(`[PPTXSlideParser] Failed to extract blip image: ${imagePath}`, e);
            }
        }
        return '';
    }

    // ═══════════════════════════════════════════════════════════════
    // 图形框架解析 (表格、图表)
    // ═══════════════════════════════════════════════════════════════

    async parseGraphicFrame(zip, gf, index) {
        const xfrm = gf.querySelector('xfrm');
        const { x, y, w, h, _rawEmu } = this.parseTransform(xfrm);
        
        // 检查是否是表格
        const tbl = gf.querySelector('graphic > graphicData > tbl');
        if (tbl) {
            return this.parseTable(tbl, index, x, y, w, h, _rawEmu);
        }
        
        // 检查是否是图表
        const chart = gf.querySelector('graphic > graphicData > chart');
        if (chart) {
            return await this.parseChart(zip, chart, index, x, y, w, h, _rawEmu);
        }
        
        return null;
    }

    // ═══════════════════════════════════════════════════════════════
    // 表格解析
    // ═══════════════════════════════════════════════════════════════

    parseTable(tbl, index, x, y, w, h, _rawEmu) {
        const data = [];
        
        const rows = tbl.querySelectorAll('tr');
        rows.forEach(tr => {
            const rowData = [];
            const cells = tr.querySelectorAll('tc');
            
            cells.forEach(tc => {
                const txBody = tc.querySelector('txBody');
                const textInfo = this.parseTextBody(txBody);
                rowData.push(textInfo.content || '');
            });
            
            data.push(rowData);
        });
        
        return {
            type: 'table',
            id: `el-${index}`,
            x, y, w, h,
            _rawEmu,
            data
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // 图表解析
    // ═══════════════════════════════════════════════════════════════

    async parseChart(zip, chartRef, index, x, y, w, h, _rawEmu) {
        const rId = chartRef.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
                 || chartRef.getAttribute('id');
        
        let chartType = 'bar';
        let chartData = { categories: [], series: [] };
        let title = '';
        
        // 获取图表文件路径
        if (rId && this.relationships[rId]) {
            const chartPath = this.relationships[rId].fullPath;
            try {
                const chartXml = await zip.file(chartPath)?.async('string');
                if (chartXml) {
                    const doc = this.parseXml(chartXml);
                    
                    // 提取图表标题
                    const titleEl = doc.querySelector('chart > title > tx > rich > p > r > t');
                    title = titleEl?.textContent || '';
                    
                    // 检测图表类型
                    const plotArea = doc.querySelector('chart > plotArea');
                    if (plotArea) {
                        if (plotArea.querySelector('barChart')) chartType = 'bar';
                        else if (plotArea.querySelector('lineChart')) chartType = 'line';
                        else if (plotArea.querySelector('pieChart')) chartType = 'pie';
                        else if (plotArea.querySelector('areaChart')) chartType = 'area';
                        else if (plotArea.querySelector('scatterChart')) chartType = 'scatter';
                        else if (plotArea.querySelector('doughnutChart')) chartType = 'doughnut';
                        
                        // 提取数据
                        chartData = this.extractChartData(plotArea, chartType);
                    }
                }
            } catch (e) {
                console.warn(`[PPTXSlideParser] Failed to parse chart: ${chartPath}`, e);
            }
        }
        
        return {
            type: 'chart',
            id: `el-${index}`,
            x, y, w, h,
            _rawEmu,
            chartType,
            title,
            chartData,
            ref: rId
        };
    }
    
    /**
     * 提取图表数据
     */
    extractChartData(plotArea, chartType) {
        const result = { categories: [], series: [] };
        
        // 查找数据系列
        const serElements = plotArea.querySelectorAll('ser');
        
        serElements.forEach((ser, i) => {
            const seriesData = { name: '', values: [] };
            
            // 系列名称
            const txEl = ser.querySelector('tx > strRef > strCache > pt > v') 
                      || ser.querySelector('tx > v');
            seriesData.name = txEl?.textContent || `系列${i + 1}`;
            
            // 类别标签 (从第一个系列获取)
            if (i === 0) {
                const catPts = ser.querySelectorAll('cat > strRef > strCache > pt');
                if (catPts.length > 0) {
                    catPts.forEach(pt => {
                        result.categories.push(pt.querySelector('v')?.textContent || '');
                    });
                } else {
                    // 数值类别
                    const numCatPts = ser.querySelectorAll('cat > numRef > numCache > pt');
                    numCatPts.forEach(pt => {
                        result.categories.push(pt.querySelector('v')?.textContent || '');
                    });
                }
            }
            
            // 数据值
            const valPts = ser.querySelectorAll('val > numRef > numCache > pt');
            valPts.forEach(pt => {
                const val = parseFloat(pt.querySelector('v')?.textContent) || 0;
                seriesData.values.push(val);
            });
            
            result.series.push(seriesData);
        });
        
        return result;
    }

    // ═══════════════════════════════════════════════════════════════
    // 连接线解析
    // ═══════════════════════════════════════════════════════════════

    parseConnector(cxn, index) {
        const xfrm = cxn.querySelector('spPr > xfrm');
        const { x, y, w, h, rotate, _rawEmu } = this.parseTransform(xfrm);
        
        const ln = cxn.querySelector('spPr > ln');
        const { stroke, strokeWidth } = this.parseLine(ln);
        
        return {
            type: 'line',
            id: `el-${index}`,
            x1: x, y1: y,
            x2: `${parseFloat(x) + parseFloat(w)}%`,
            y2: `${parseFloat(y) + parseFloat(h)}%`,
            _rawEmu,
            stroke: stroke || '#cccccc',
            strokeWidth: strokeWidth || 1
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // 分组解析
    // ═══════════════════════════════════════════════════════════════

    async parseGroup(zip, grp, index) {
        const xfrm = grp.querySelector('grpSpPr > xfrm');
        const { x, y, w, h } = this.parseTransform(xfrm);
        
        // 获取分组的子元素坐标系统
        const groupTransform = this.parseGroupTransform(xfrm);
        
        const children = [];
        let childIndex = 0;
        
        // 形状 (异步)
        const sps = grp.querySelectorAll(':scope > sp');
        for (let i = 0; i < sps.length; i++) {
            const el = await this.parseShape(zip, sps[i], childIndex++);
            if (el) {
                this.applyGroupTransform(el, groupTransform);
                children.push(el);
            }
        }
        
        // 图片 (异步)
        const pics = grp.querySelectorAll(':scope > pic');
        for (let i = 0; i < pics.length; i++) {
            const el = await this.parsePicture(zip, pics[i], childIndex++);
            if (el) {
                this.applyGroupTransform(el, groupTransform);
                children.push(el);
            }
        }
        
        // 连接线
        grp.querySelectorAll(':scope > cxnSp').forEach((cxn) => {
            const el = this.parseConnector(cxn, childIndex++);
            if (el) {
                this.applyGroupTransform(el, groupTransform);
                children.push(el);
            }
        });
        
        // 图形框架 (表格、图表) - 异步
        const gfs = grp.querySelectorAll(':scope > graphicFrame');
        for (let i = 0; i < gfs.length; i++) {
            const el = await this.parseGraphicFrame(zip, gfs[i], childIndex++);
            if (el) {
                this.applyGroupTransform(el, groupTransform);
                children.push(el);
            }
        }
        
        // 嵌套分组 (递归，异步)
        const nestedGroups = grp.querySelectorAll(':scope > grpSp');
        for (let i = 0; i < nestedGroups.length; i++) {
            const el = await this.parseGroup(zip, nestedGroups[i], childIndex++);
            if (el) {
                this.applyGroupTransform(el, groupTransform);
                children.push(el);
            }
        }
        
        return {
            type: 'group',
            id: `el-${index}`,
            x, y, w, h,
            children
        };
    }
    
    /**
     * 展平版本的分组解析 - 返回子元素数组而不是嵌套结构
     */
    async parseGroupFlattened(zip, grp, startIndex) {
        const xfrm = grp.querySelector('grpSpPr > xfrm');
        const groupTransform = this.parseGroupTransform(xfrm);
        
        const flatElements = [];
        let childIndex = startIndex;
        
        // 形状 (异步)
        const sps = grp.querySelectorAll(':scope > sp');
        for (let i = 0; i < sps.length; i++) {
            const el = await this.parseShape(zip, sps[i], childIndex++);
            if (el) {
                this.applyGroupTransform(el, groupTransform);
                flatElements.push(el);
            }
        }
        
        // 图片 (异步)
        const pics = grp.querySelectorAll(':scope > pic');
        for (let i = 0; i < pics.length; i++) {
            const el = await this.parsePicture(zip, pics[i], childIndex++);
            if (el) {
                this.applyGroupTransform(el, groupTransform);
                flatElements.push(el);
            }
        }
        
        // 连接线
        grp.querySelectorAll(':scope > cxnSp').forEach((cxn) => {
            const el = this.parseConnector(cxn, childIndex++);
            if (el) {
                this.applyGroupTransform(el, groupTransform);
                flatElements.push(el);
            }
        });
        
        // 图形框架 (表格、图表) - 异步
        const gfs = grp.querySelectorAll(':scope > graphicFrame');
        for (let i = 0; i < gfs.length; i++) {
            const el = await this.parseGraphicFrame(zip, gfs[i], childIndex++);
            if (el) {
                this.applyGroupTransform(el, groupTransform);
                flatElements.push(el);
            }
        }
        
        // 嵌套分组 (递归展平)
        const nestedGroups = grp.querySelectorAll(':scope > grpSp');
        for (let i = 0; i < nestedGroups.length; i++) {
            const nestedElements = await this.parseGroupFlattened(zip, nestedGroups[i], childIndex);
            // 对嵌套的子元素也应用当前分组的变换
            nestedElements.forEach(el => {
                this.applyGroupTransform(el, groupTransform);
            });
            flatElements.push(...nestedElements);
            childIndex += nestedElements.length;
        }
        
        return flatElements;
    }
    
    /**
     * 解析分组变换信息
     */
    parseGroupTransform(xfrm) {
        if (!xfrm) return null;
        
        const off = xfrm.querySelector('off');
        const ext = xfrm.querySelector('ext');
        const chOff = xfrm.querySelector('chOff');
        const chExt = xfrm.querySelector('chExt');
        
        if (!chOff || !chExt) return null;
        
        return {
            // 分组在幻灯片上的位置
            grpX: parseInt(off?.getAttribute('x')) || 0,
            grpY: parseInt(off?.getAttribute('y')) || 0,
            grpW: parseInt(ext?.getAttribute('cx')) || this.SLIDE_WIDTH_EMU,
            grpH: parseInt(ext?.getAttribute('cy')) || this.SLIDE_HEIGHT_EMU,
            // 子元素坐标系统
            chX: parseInt(chOff.getAttribute('x')) || 0,
            chY: parseInt(chOff.getAttribute('y')) || 0,
            chW: parseInt(chExt.getAttribute('cx')) || this.SLIDE_WIDTH_EMU,
            chH: parseInt(chExt.getAttribute('cy')) || this.SLIDE_HEIGHT_EMU
        };
    }
    
    /**
     * 将子元素坐标从分组坐标系转换到幻灯片坐标系
     * 注意：子元素的 _rawEmu 保存原始 EMU 坐标
     */
    applyGroupTransform(el, groupTransform) {
        if (!groupTransform || !el) return;
        
        const { grpX, grpY, grpW, grpH, chX, chY, chW, chH } = groupTransform;
        
        // 使用原始 EMU 坐标（如果有）
        let elXEmu, elYEmu, elWEmu, elHEmu;
        
        if (el._rawEmu) {
            elXEmu = el._rawEmu.x;
            elYEmu = el._rawEmu.y;
            elWEmu = el._rawEmu.w;
            elHEmu = el._rawEmu.h;
        } else {
            // 回退：从百分比反推（不精确）
            const parsePercent = (str) => parseFloat(str) || 0;
            elXEmu = (parsePercent(el.x) / 100) * this.SLIDE_WIDTH_EMU;
            elYEmu = (parsePercent(el.y) / 100) * this.SLIDE_HEIGHT_EMU;
            elWEmu = (parsePercent(el.w) / 100) * this.SLIDE_WIDTH_EMU;
            elHEmu = (parsePercent(el.h) / 100) * this.SLIDE_HEIGHT_EMU;
        }
        
        // 子元素坐标是相对于 chOff 的，计算在分组内的相对位置 (0-1)
        const relX = chW > 0 ? (elXEmu - chX) / chW : 0;
        const relY = chH > 0 ? (elYEmu - chY) / chH : 0;
        const relW = chW > 0 ? elWEmu / chW : 0;
        const relH = chH > 0 ? elHEmu / chH : 0;
        
        // 映射到分组在幻灯片上的实际位置
        const newXEmu = grpX + relX * grpW;
        const newYEmu = grpY + relY * grpH;
        const newWEmu = relW * grpW;
        const newHEmu = relH * grpH;
        
        // 更新 _rawEmu 用于嵌套分组
        el._rawEmu = { x: newXEmu, y: newYEmu, w: newWEmu, h: newHEmu };
        
        // 转成百分比
        el.x = ((newXEmu / this.SLIDE_WIDTH_EMU) * 100).toFixed(2) + '%';
        el.y = ((newYEmu / this.SLIDE_HEIGHT_EMU) * 100).toFixed(2) + '%';
        el.w = ((newWEmu / this.SLIDE_WIDTH_EMU) * 100).toFixed(2) + '%';
        el.h = ((newHEmu / this.SLIDE_HEIGHT_EMU) * 100).toFixed(2) + '%';
    }

    // ═══════════════════════════════════════════════════════════════
    // 工具方法
    // ═══════════════════════════════════════════════════════════════

    parseXml(xmlString) {
        const parser = new DOMParser();
        // 移除命名空间前缀以简化查询
        const cleanXml = xmlString.replace(/<(\/?)[a-z]+:/g, '<$1');
        return parser.parseFromString(cleanXml, 'text/xml');
    }

    parseTransform(xfrm) {
        if (!xfrm) return { x: '0%', y: '0%', w: '10%', h: '10%', rotate: 0, _rawEmu: { x: 0, y: 0, w: 0, h: 0 } };
        
        const off = xfrm.querySelector('off');
        const ext = xfrm.querySelector('ext');
        
        const xEmu = parseInt(off?.getAttribute('x')) || 0;
        const yEmu = parseInt(off?.getAttribute('y')) || 0;
        const wEmu = parseInt(ext?.getAttribute('cx')) || 0;
        const hEmu = parseInt(ext?.getAttribute('cy')) || 0;
        const rotAttr = xfrm.getAttribute('rot');
        
        // 转换为百分比
        const x = ((xEmu / this.SLIDE_WIDTH_EMU) * 100).toFixed(2) + '%';
        const y = ((yEmu / this.SLIDE_HEIGHT_EMU) * 100).toFixed(2) + '%';
        const w = ((wEmu / this.SLIDE_WIDTH_EMU) * 100).toFixed(2) + '%';
        const h = ((hEmu / this.SLIDE_HEIGHT_EMU) * 100).toFixed(2) + '%';
        
        // 旋转角度 (60000 = 1度)
        const rotate = rotAttr ? parseInt(rotAttr) / 60000 : 0;
        
        // 保留原始 EMU 坐标用于分组变换
        return { x, y, w, h, rotate, _rawEmu: { x: xEmu, y: yEmu, w: wEmu, h: hEmu } };
    }

    parseTextBody(txBody) {
        if (!txBody) return { content: '', fontSize: 18, color: '#333333' };
        
        const paragraphs = [];
        const links = [];
        let fontSize = 18;
        let color = '#333333';
        let bold = false;
        let italic = false;
        let align = 'left';
        let hasBullets = false;
        let bulletType = null;
        let spaceBeforePt;
        let spaceAfterPt;
        let lineSpacingPt;
        
        // 解析文本框属性 (bodyPr)
        const bodyPr = txBody.querySelector('bodyPr');
        const wrap = bodyPr?.getAttribute('wrap') || 'square';  // square=自动换行, none=不换行
        const anchor = bodyPr?.getAttribute('anchor') || 't';   // t=顶部, ctr=居中, b=底部
        const overflow = bodyPr?.getAttribute('overflow') || 'overflow'; // overflow, clip
        
        txBody.querySelectorAll('p').forEach(p => {
            // 段落属性
            const pPr = p.querySelector('pPr');
            const algn = pPr?.getAttribute('algn');
            if (algn) {
                align = { l: 'left', ctr: 'center', r: 'right', just: 'justify' }[algn] || 'left';
            }

            // 段前/段后/行距
            if (pPr) {
                if (spaceBeforePt === undefined) {
                    const spcBefPts = pPr.querySelector('spcBef > spcPts')?.getAttribute('val');
                    if (spcBefPts) spaceBeforePt = parseInt(spcBefPts) / 100;
                }
                
                if (spaceAfterPt === undefined) {
                    const spcAftPts = pPr.querySelector('spcAft > spcPts')?.getAttribute('val');
                    if (spcAftPts) spaceAfterPt = parseInt(spcAftPts) / 100;
                }
            }
            
            // 项目符号检测
            const buChar = pPr?.querySelector('buChar');
            const buAutoNum = pPr?.querySelector('buAutoNum');
            const buNone = pPr?.querySelector('buNone');
            
            let bulletPrefix = '';
            if (buChar && !buNone) {
                hasBullets = true;
                bulletType = 'bullet';
                bulletPrefix = (buChar.getAttribute('char') || '•') + ' ';
            } else if (buAutoNum && !buNone) {
                hasBullets = true;
                bulletType = 'number';
                // 简化：只标记为编号列表
                bulletPrefix = '# ';
            }
            
            // 缩进级别
            const lvl = pPr?.getAttribute('lvl') || '0';
            const indent = '  '.repeat(parseInt(lvl));
            
            // 行距（可能是 spcPts 或 spcPct）
            let lnSpcSpec = null;
            if (pPr && lineSpacingPt === undefined) {
                const lnSpc = pPr.querySelector('lnSpc');
                const spcPts = lnSpc?.querySelector('spcPts')?.getAttribute('val');
                const spcPct = lnSpc?.querySelector('spcPct')?.getAttribute('val');
                
                if (spcPts) {
                    lnSpcSpec = { type: 'pts', val: parseInt(spcPts) / 100 };
                } else if (spcPct) {
                    lnSpcSpec = { type: 'pct', val: parseInt(spcPct) / 100000 };
                }
            }
            
            // 文本运行
            const runs = [];
            p.querySelectorAll('r').forEach(r => {
                const text = r.querySelector('t')?.textContent || '';
                runs.push(text);
                
                // 文本属性
                const rPr = r.querySelector('rPr');
                if (rPr) {
                    const sz = rPr.getAttribute('sz');
                    if (sz) fontSize = parseInt(sz) / 100;
                    
                    bold = rPr.getAttribute('b') === '1';
                    italic = rPr.getAttribute('i') === '1';
                    
                    const solidFill = rPr.querySelector('solidFill');
                    if (solidFill) {
                        color = this.parseColorValue(solidFill);
                    }
                    
                    // 超链接
                    const hlinkClick = rPr.querySelector('hlinkClick');
                    if (hlinkClick) {
                        const rId = hlinkClick.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
                        if (rId && this.relationships[rId]) {
                            links.push({
                                text: text,
                                url: this.relationships[rId].target
                            });
                        }
                    }
                }
            });

            if (lnSpcSpec && lineSpacingPt === undefined) {
                if (lnSpcSpec.type === 'pts') {
                    lineSpacingPt = lnSpcSpec.val;
                } else if (lnSpcSpec.type === 'pct') {
                    lineSpacingPt = fontSize * lnSpcSpec.val;
                }
            }
            
            if (runs.length > 0) {
                paragraphs.push(indent + bulletPrefix + runs.join(''));
            }
        });
        
        // 垂直对齐映射
        const valignMap = { t: 'top', ctr: 'middle', b: 'bottom' };
        
        return {
            content: paragraphs.join('\n'),
            fontSize,
            color,
            bold,
            italic,
            align,
            valign: valignMap[anchor] || 'top',
            lineHeight: 1.4,
            wrap: wrap === 'none' ? 'nowrap' : 'normal',
            overflow: overflow === 'clip' ? 'hidden' : 'visible',
            spaceBeforePt,
            spaceAfterPt,
            lineSpacingPt,
            hasBullets,
            bulletType,
            links: links.length > 0 ? links : undefined
        };
    }

    parseFill(spPr) {
        if (!spPr) return null;
        
        const solidFill = spPr.querySelector('solidFill');
        if (solidFill) {
            return this.parseColorValue(solidFill);
        }
        
        // 图片填充
        const blipFill = spPr.querySelector('blipFill');
        if (blipFill) {
            return { type: 'image', blipFill };  // 标记为图片填充，稍后处理
        }
        
        // 渐变填充
        const gradFill = spPr.querySelector('gradFill');
        if (gradFill) {
            return '#4f46e5';  // 简化处理
        }
        
        const noFill = spPr.querySelector('noFill');
        if (noFill) return null;
        
        return null;
    }

    parseColor(fillEl) {
        if (!fillEl) return { type: 'rgb', value: '#333333' };
        
        // sRGB 颜色
        const srgbClr = fillEl.querySelector('srgbClr');
        if (srgbClr) {
            return { type: 'rgb', value: '#' + srgbClr.getAttribute('val') };
        }
        
        // 系统颜色
        const sysClr = fillEl.querySelector('sysClr');
        if (sysClr) {
            return { type: 'rgb', value: '#' + (sysClr.getAttribute('lastClr') || '000000') };
        }
        
        // 主题颜色
        const schemeClr = fillEl.querySelector('schemeClr');
        if (schemeClr) {
            const name = schemeClr.getAttribute('val');
            const themeEntry = this.themeColors[name];
            return {
                type: 'theme',
                name,
                value: themeEntry?.value || '#333333'
            };
        }
        
        return { type: 'rgb', value: '#333333' };
    }

    parseColorValue(fillEl) {
        const spec = this.parseColor(fillEl);
        const value = typeof spec === 'string' ? spec : (spec?.value || '#333333');
        this.recordColorUsage(value);
        return value;
    }

    recordColorUsage(colorValue) {
        if (!colorValue || typeof colorValue !== 'string') return;
        const hex = colorValue.trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
        const key = hex.toUpperCase();
        this.colorUsage[key] = (this.colorUsage[key] || 0) + 1;
    }

    parseGradient(gradFill) {
        const gsLst = gradFill.querySelectorAll('gsLst > gs');
        const colors = [];
        
        gsLst.forEach(gs => {
            const pos = parseInt(gs.getAttribute('pos')) / 1000;
            const color = this.parseColorValue(gs);
            colors.push(`${color} ${pos}%`);
        });
        
        if (colors.length >= 2) {
            return `linear-gradient(135deg, ${colors.join(', ')})`;
        }
        
        return '#ffffff';
    }

    parseBlipFill(blipFill) {
        const blip = blipFill.querySelector('blip');
        const embedId = blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
        
        if (embedId && this.relationships[embedId]) {
            return `url(${this.relationships[embedId].fullPath})`;
        }
        
        return '#ffffff';
    }

    parseLine(ln) {
        if (!ln) return { stroke: null, strokeWidth: 0 };
        
        const w = ln.getAttribute('w');
        const strokeWidth = w ? parseInt(w) / this.EMU_PER_PT : 1;
        
        const solidFill = ln.querySelector('solidFill');
        const stroke = solidFill ? this.parseColorValue(solidFill) : null;
        
        const noFill = ln.querySelector('noFill');
        if (noFill) return { stroke: null, strokeWidth: 0 };
        
        return { stroke, strokeWidth };
    }

    mapShapeType(prstGeom) {
        const shapeMap = {
            'rect': 'rect',
            'roundRect': 'rounded',
            'ellipse': 'circle',
            'triangle': 'triangle',
            'diamond': 'diamond',
            'pentagon': 'pentagon',
            'hexagon': 'hexagon',
            'star5': 'star',
            'arrow': 'arrow',
            'line': 'line'
        };
        return shapeMap[prstGeom] || 'rect';
    }
    
    /**
     * 映射占位符类型到语义角色
     */
    mapPlaceholderType(phType) {
        if (!phType) return null;
        
        const roleMap = {
            'title': 'title',           // 标题
            'ctrTitle': 'title',        // 居中标题
            'subTitle': 'subtitle',     // 副标题
            'body': 'body',             // 正文
            'obj': 'content',           // 内容占位符
            'chart': 'chart',           // 图表
            'tbl': 'table',             // 表格
            'clipArt': 'image',         // 剪贴画
            'dgm': 'diagram',           // 图表/SmartArt
            'media': 'media',           // 媒体
            'sldNum': 'page-number',    // 页码
            'dt': 'date',               // 日期
            'ftr': 'footer',            // 页脚
            'hdr': 'header',            // 页眉
            'pic': 'image',             // 图片
            'sldImg': 'slide-image'     // 幻灯片图片
        };
        
        return roleMap[phType] || phType;
    }
    
    /**
     * 从当前布局获取占位符的默认位置
     */
    getLayoutPlaceholderPosition(phType, phIdx) {
        if (!this.currentLayoutId || !this.layoutPlaceholders[this.currentLayoutId]) {
            return null;
        }
        
        const layout = this.layoutPlaceholders[this.currentLayoutId];
        const key = `${phType}_${phIdx}`;
        
        // 精确匹配
        if (layout[key]) {
            const pos = layout[key];
            return {
                x: ((pos.xEmu / this.SLIDE_WIDTH_EMU) * 100).toFixed(2) + '%',
                y: ((pos.yEmu / this.SLIDE_HEIGHT_EMU) * 100).toFixed(2) + '%',
                w: ((pos.wEmu / this.SLIDE_WIDTH_EMU) * 100).toFixed(2) + '%',
                h: ((pos.hEmu / this.SLIDE_HEIGHT_EMU) * 100).toFixed(2) + '%'
            };
        }
        
        // 按类型匹配（忽略 idx）
        for (const k in layout) {
            if (layout[k].type === phType) {
                const pos = layout[k];
                return {
                    x: ((pos.xEmu / this.SLIDE_WIDTH_EMU) * 100).toFixed(2) + '%',
                    y: ((pos.yEmu / this.SLIDE_HEIGHT_EMU) * 100).toFixed(2) + '%',
                    w: ((pos.wEmu / this.SLIDE_WIDTH_EMU) * 100).toFixed(2) + '%',
                    h: ((pos.hEmu / this.SLIDE_HEIGHT_EMU) * 100).toFixed(2) + '%'
                };
            }
        }
        
        return null;
    }

    // ═══════════════════════════════════════════════════════════════
    // 生成 HTML 表示 (供 AI 参考)
    // ═══════════════════════════════════════════════════════════════

    generateHtml(slides) {
        const sections = slides.map((slide, i) => {
            const bgStyle = typeof slide.background === 'string' && slide.background.startsWith('linear-gradient')
                ? `data-gradient="${slide.background}"`
                : `data-bg="${slide.background || '#ffffff'}"`;
            
            const elementsHtml = (slide.elements || []).map(el => this.elementToHtml(el)).join('\n    ');
            
            return `<section data-type="freeform" id="slide-${i + 1}" ${bgStyle}>
    ${elementsHtml}
</section>`;
        });
        
        return sections.join('\n\n');
    }

    elementToHtml(el) {
        const baseAttrs = `data-el="${el.type}" style="left:${el.x}; top:${el.y}; width:${el.w}; height:${el.h};"`;
        
        switch (el.type) {
            case 'text':
                const textStyle = [
                    `font-size:${el.font}px`,
                    `color:${el.color}`,
                    el.bold ? 'font-weight:bold' : '',
                    el.italic ? 'font-style:italic' : '',
                    `text-align:${el.align}`,
                    el.wrap ? `white-space:${el.wrap}` : '',
                    el.overflow ? `overflow:${el.overflow}` : ''
                ].filter(Boolean).join('; ');
                
                // 添加语义属性
                const textAttrs = [
                    el.role ? `data-role="${el.role}"` : '',
                    el.hasBullets ? `data-bullets="${el.bulletType || 'bullet'}"` : '',
                    el.links?.length ? `data-has-links="true"` : '',
                    el.valign ? `data-valign="${el.valign}"` : ''
                ].filter(Boolean).join(' ');
                
                return `<div ${baseAttrs} ${textAttrs} style="left:${el.x}; top:${el.y}; width:${el.w}; height:${el.h}; ${textStyle}">${this.escapeHtml(el.content)}</div>`;
            
            case 'shape':
                const shapeAttrs = [
                    `data-shape="${el.shape}"`,
                    `data-fill="${el.fill}"`,
                    el.stroke ? `data-stroke="${el.stroke}"` : '',
                    el.strokeWidth ? `data-stroke-width="${el.strokeWidth}"` : '',
                    el.role ? `data-role="${el.role}"` : ''
                ].filter(Boolean).join(' ');
                
                let shapeContent = el.text ? this.escapeHtml(el.text) : '';
                return `<div ${baseAttrs} ${shapeAttrs}>${shapeContent}</div>`;
            
            case 'image':
                // 在 HTML 输出中使用简化的引用，实际数据保留在 slides 中
                const srcDisplay = el.src?.startsWith('data:') 
                    ? `[嵌入图片:${el.id}]`
                    : el.src;
                return `<div ${baseAttrs} data-src="${srcDisplay}" data-alt="${el.alt || '图片'}"></div>`;
            
            case 'table':
                const tableData = JSON.stringify(el.data);
                return `<div ${baseAttrs} data-data='${tableData}'></div>`;
            
            case 'chart':
                const chartDataJson = JSON.stringify(el.chartData);
                const chartTitle = el.title ? ` data-title="${this.escapeHtml(el.title)}"` : '';
                return `<div ${baseAttrs} data-chart-type="${el.chartType}"${chartTitle} data-chart-data='${chartDataJson}'></div>`;
            
            case 'line':
                return `<div data-el="line" data-x1="${el.x1}" data-y1="${el.y1}" data-x2="${el.x2}" data-y2="${el.y2}" data-stroke="${el.stroke}" data-stroke-width="${el.strokeWidth}"></div>`;
            
            case 'group':
                const children = (el.children || []).map(c => this.elementToHtml(c)).join('\n      ');
                return `<div ${baseAttrs}>\n      ${children}\n    </div>`;
            
            default:
                return `<!-- Unknown element type: ${el.type} -->`;
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/\n/g, '<br>');
    }

    // ═══════════════════════════════════════════════════════════════
    // 生成结构化描述 (更易于 AI 理解)
    // ═══════════════════════════════════════════════════════════════

    generateDescription(slides) {
        const lines = [];
        
        slides.forEach((slide, i) => {
            lines.push(`## 幻灯片 ${i + 1}`);
            lines.push(`背景: ${slide.background}`);
            lines.push('');
            
            (slide.elements || []).forEach((el, j) => {
                const roleStr = el.role ? ` [${el.role}]` : '';
                lines.push(`### 元素 ${j + 1}: ${el.type}${roleStr}`);
                lines.push(`- 位置: (${el.x}, ${el.y})`);
                lines.push(`- 大小: ${el.w} × ${el.h}`);
                
                if (el.type === 'text') {
                    lines.push(`- 内容: "${el.content?.substring(0, 100)}${el.content?.length > 100 ? '...' : ''}"`);
                    lines.push(`- 字号: ${el.font}px, 颜色: ${el.color}`);
                    if (el.hasBullets) lines.push(`- 列表: ${el.bulletType === 'number' ? '编号' : '项目符号'}`);
                    if (el.links?.length) lines.push(`- 链接: ${el.links.length} 个`);
                } else if (el.type === 'shape') {
                    lines.push(`- 形状: ${el.shape}, 填充: ${el.fill}`);
                    if (el.text) lines.push(`- 文字: "${el.text}"`);
                } else if (el.type === 'image') {
                    const imgInfo = el.src?.startsWith('data:') ? '[嵌入图片 Base64]' : el.src;
                    lines.push(`- 图片: ${imgInfo}`);
                } else if (el.type === 'table') {
                    lines.push(`- 表格: ${el.data?.length || 0} 行`);
                } else if (el.type === 'chart') {
                    lines.push(`- 图表类型: ${el.chartType}`);
                    if (el.title) lines.push(`- 标题: ${el.title}`);
                    if (el.chartData?.categories?.length) {
                        lines.push(`- 类别: ${el.chartData.categories.join(', ')}`);
                    }
                    if (el.chartData?.series?.length) {
                        el.chartData.series.forEach(s => {
                            lines.push(`- 系列 "${s.name}": [${s.values.join(', ')}]`);
                        });
                    }
                }
                
                lines.push('');
            });
        });
        
        return lines.join('\n');
    }
}

// 全局导出
window.PPTXSlideParser = PPTXSlideParser;

// ESM 导出
export { PPTXSlideParser };
