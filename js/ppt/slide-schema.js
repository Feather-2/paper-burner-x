/**
 * Slide Schema & Renderer System v2.0
 *
 * 让 AI 输出标准化 HTML，自动同步渲染到预览和 PPTX
 *
 * ═══════════════════════════════════════════════════════════════
 * 模式 1: 预设模板 (data-type="cover|toc|stats|...")
 * ═══════════════════════════════════════════════════════════════
 * 支持的 HTML 结构 → 自动映射到 PPTX 元素：
 * - <section data-type="cover|toc|stats|..."> → Slide
 * - <h1>, <h2> → Title
 * - <p> → Paragraph
 * - <ul>, <ol> → List
 * - <div class="stats-grid"> → Stats layout
 * - <div class="comparison"> → Two-column comparison
 * - <blockquote> → Quote
 * - <div class="timeline"> → Timeline
 * - <img> → Image (placeholder in PPTX)
 *
 * ═══════════════════════════════════════════════════════════════
 * 模式 2: 自由元素 (data-type="freeform") - Fancy 设计模式
 * ═══════════════════════════════════════════════════════════════
 *
 * 【示例 1: 渐变几何封面】
 * <section data-type="freeform" data-gradient="linear-gradient(135deg, #667eea 0%, #764ba2 100%)">
 *   <div data-el="shape" data-shape="circle" data-x="70%" data-y="-20%" data-w="60%" data-h="100%" data-fill="#ffffff" data-opacity="0.08"></div>
 *   <div data-el="shape" data-shape="circle" data-x="-10%" data-y="60%" data-w="30%" data-h="50%" data-fill="#feca57" data-opacity="0.6"></div>
 *   <div data-el="shape" data-shape="rounded" data-x="75%" data-y="70%" data-w="20%" data-h="25%" data-fill="#ff6b6b" data-opacity="0.4" data-radius="20" data-rotate="15"></div>
 *   <div data-el="text" data-x="8%" data-y="30%" data-w="55%" data-h="auto" data-font="52" data-color="#ffffff" data-bold="true">创新驱动未来</div>
 *   <div data-el="text" data-x="8%" data-y="52%" data-w="50%" data-h="auto" data-font="20" data-color="#ffffff" data-opacity="0.85">2024 年度战略报告 · 探索无限可能</div>
 *   <div data-el="line" data-x1="8%" data-y1="68%" data-x2="35%" data-y2="68%" data-stroke="#feca57" data-stroke-width="4"></div>
 *   <div data-el="icon" data-icon="carbon:rocket" data-x="8%" data-y="75%" data-size="28" data-color="#ffffff"></div>
 *   <div data-el="text" data-x="13%" data-y="76%" data-w="30%" data-h="auto" data-font="14" data-color="#ffffff" data-opacity="0.7">Paper Burner X</div>
 * </section>
 *
 * 【示例 2: 玻璃拟态数据卡片】
 * <section data-type="freeform" data-gradient="linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)">
 *   <div data-el="shape" data-shape="circle" data-x="80%" data-y="10%" data-w="25%" data-h="40%" data-fill="#4f46e5" data-opacity="0.3"></div>
 *   <div data-el="shape" data-shape="circle" data-x="-5%" data-y="50%" data-w="20%" data-h="35%" data-fill="#f472b6" data-opacity="0.25"></div>
 *   <div data-el="text" data-x="5%" data-y="8%" data-w="90%" data-h="auto" data-font="32" data-color="#ffffff" data-bold="true" data-align="center">核心业务指标</div>
 *   <div data-el="text" data-x="5%" data-y="18%" data-w="90%" data-h="auto" data-font="14" data-color="#94a3b8" data-align="center">实时数据监控面板</div>
 *   <div data-el="shape" data-shape="rounded" data-x="4%" data-y="28%" data-w="29%" data-h="62%" data-fill="#ffffff" data-opacity="0.08" data-radius="16"></div>
 *   <div data-el="icon" data-icon="carbon:growth" data-x="13%" data-y="35%" data-size="40" data-color="#10b981"></div>
 *   <div data-el="text" data-x="4%" data-y="52%" data-w="29%" data-h="auto" data-font="42" data-color="#10b981" data-bold="true" data-align="center">+127%</div>
 *   <div data-el="text" data-x="4%" data-y="68%" data-w="29%" data-h="auto" data-font="14" data-color="#94a3b8" data-align="center">营收增长率</div>
 *   <div data-el="line" data-x1="8%" data-y1="78%" data-x2="29%" data-y2="78%" data-stroke="#10b981" data-stroke-width="3"></div>
 *   <div data-el="text" data-x="4%" data-y="82%" data-w="29%" data-h="auto" data-font="11" data-color="#6b7280" data-align="center">↑ 较去年同期</div>
 *   <div data-el="shape" data-shape="rounded" data-x="36%" data-y="28%" data-w="29%" data-h="62%" data-fill="#ffffff" data-opacity="0.08" data-radius="16"></div>
 *   <div data-el="icon" data-icon="carbon:user-multiple" data-x="45%" data-y="35%" data-size="40" data-color="#3b82f6"></div>
 *   <div data-el="text" data-x="36%" data-y="52%" data-w="29%" data-h="auto" data-font="42" data-color="#3b82f6" data-bold="true" data-align="center">2.5M</div>
 *   <div data-el="text" data-x="36%" data-y="68%" data-w="29%" data-h="auto" data-font="14" data-color="#94a3b8" data-align="center">活跃用户数</div>
 *   <div data-el="line" data-x1="40%" data-y1="78%" data-x2="61%" data-y2="78%" data-stroke="#3b82f6" data-stroke-width="3"></div>
 *   <div data-el="text" data-x="36%" data-y="82%" data-w="29%" data-h="auto" data-font="11" data-color="#6b7280" data-align="center">日均活跃</div>
 *   <div data-el="shape" data-shape="rounded" data-x="68%" data-y="28%" data-w="29%" data-h="62%" data-fill="#ffffff" data-opacity="0.08" data-radius="16"></div>
 *   <div data-el="icon" data-icon="carbon:star-filled" data-x="77%" data-y="35%" data-size="40" data-color="#f59e0b"></div>
 *   <div data-el="text" data-x="68%" data-y="52%" data-w="29%" data-h="auto" data-font="42" data-color="#f59e0b" data-bold="true" data-align="center">4.9</div>
 *   <div data-el="text" data-x="68%" data-y="68%" data-w="29%" data-h="auto" data-font="14" data-color="#94a3b8" data-align="center">用户满意度</div>
 *   <div data-el="line" data-x1="72%" data-y1="78%" data-x2="93%" data-y2="78%" data-stroke="#f59e0b" data-stroke-width="3"></div>
 *   <div data-el="text" data-x="68%" data-y="82%" data-w="29%" data-h="auto" data-font="11" data-color="#6b7280" data-align="center">满分 5.0</div>
 * </section>
 *
 * 【示例 3: 左右分栏图文】
 * <section data-type="freeform" data-bg="#fafafa">
 *   <div data-el="shape" data-shape="rect" data-x="0%" data-y="0%" data-w="45%" data-h="100%" data-fill="#4f46e5"></div>
 *   <div data-el="shape" data-shape="circle" data-x="30%" data-y="60%" data-w="25%" data-h="45%" data-fill="#ffffff" data-opacity="0.1"></div>
 *   <div data-el="text" data-x="5%" data-y="25%" data-w="35%" data-h="auto" data-font="14" data-color="#a5b4fc" data-bold="true">CHAPTER 01</div>
 *   <div data-el="text" data-x="5%" data-y="33%" data-w="35%" data-h="auto" data-font="36" data-color="#ffffff" data-bold="true">产品愿景</div>
 *   <div data-el="text" data-x="5%" data-y="50%" data-w="35%" data-h="auto" data-font="14" data-color="#c7d2fe" data-line-height="1.6">我们致力于打造下一代智能协作平台，让团队协作更加高效、创意更加自由。</div>
 *   <div data-el="line" data-x1="5%" data-y1="75%" data-x2="25%" data-y2="75%" data-stroke="#feca57" data-stroke-width="3"></div>
 *   <div data-el="image" data-x="50%" data-y="10%" data-w="45%" data-h="80%" data-radius="16" data-alt="产品展示"></div>
 *   <div data-el="shape" data-shape="rounded" data-x="52%" data-y="75%" data-w="40%" data-h="18%" data-fill="#ffffff" data-shadow="true" data-radius="12"></div>
 *   <div data-el="icon" data-icon="carbon:checkmark-filled" data-x="55%" data-y="80%" data-size="24" data-color="#10b981"></div>
 *   <div data-el="text" data-x="62%" data-y="79%" data-w="28%" data-h="auto" data-font="12" data-color="#374151" data-bold="true">已服务 500+ 企业客户</div>
 *   <div data-el="text" data-x="62%" data-y="86%" data-w="28%" data-h="auto" data-font="11" data-color="#6b7280">覆盖金融、科技、制造等行业</div>
 * </section>
 *
 * 【示例 4: 时间轴流程】
 * <section data-type="freeform" data-gradient="linear-gradient(135deg, #fdf2f8 0%, #fce7f3 50%, #fbcfe8 100%)">
 *   <div data-el="text" data-x="5%" data-y="8%" data-w="90%" data-h="auto" data-font="32" data-color="#831843" data-bold="true" data-align="center">产品演进路线</div>
 *   <div data-el="line" data-x1="10%" data-y1="55%" data-x2="90%" data-y2="55%" data-stroke="#f9a8d4" data-stroke-width="4"></div>
 *   <div data-el="shape" data-shape="circle" data-x="8%" data-y="48%" data-w="6%" data-h="10%" data-fill="#ec4899"></div>
 *   <div data-el="text" data-x="6%" data-y="49%" data-w="10%" data-h="auto" data-font="14" data-color="#ffffff" data-bold="true" data-align="center">1</div>
 *   <div data-el="text" data-x="3%" data-y="62%" data-w="16%" data-h="auto" data-font="14" data-color="#9d174d" data-bold="true" data-align="center">概念验证</div>
 *   <div data-el="text" data-x="3%" data-y="70%" data-w="16%" data-h="auto" data-font="11" data-color="#be185d" data-align="center">Q1 2024</div>
 *   <div data-el="shape" data-shape="circle" data-x="30%" data-y="48%" data-w="6%" data-h="10%" data-fill="#ec4899"></div>
 *   <div data-el="text" data-x="28%" data-y="49%" data-w="10%" data-h="auto" data-font="14" data-color="#ffffff" data-bold="true" data-align="center">2</div>
 *   <div data-el="text" data-x="25%" data-y="62%" data-w="16%" data-h="auto" data-font="14" data-color="#9d174d" data-bold="true" data-align="center">MVP 发布</div>
 *   <div data-el="text" data-x="25%" data-y="70%" data-w="16%" data-h="auto" data-font="11" data-color="#be185d" data-align="center">Q2 2024</div>
 *   <div data-el="shape" data-shape="circle" data-x="52%" data-y="48%" data-w="6%" data-h="10%" data-fill="#ec4899"></div>
 *   <div data-el="text" data-x="50%" data-y="49%" data-w="10%" data-h="auto" data-font="14" data-color="#ffffff" data-bold="true" data-align="center">3</div>
 *   <div data-el="text" data-x="47%" data-y="62%" data-w="16%" data-h="auto" data-font="14" data-color="#9d174d" data-bold="true" data-align="center">规模扩展</div>
 *   <div data-el="text" data-x="47%" data-y="70%" data-w="16%" data-h="auto" data-font="11" data-color="#be185d" data-align="center">Q3 2024</div>
 *   <div data-el="shape" data-shape="circle" data-x="74%" data-y="48%" data-w="6%" data-h="10%" data-fill="#ec4899"></div>
 *   <div data-el="text" data-x="72%" data-y="49%" data-w="10%" data-h="auto" data-font="14" data-color="#ffffff" data-bold="true" data-align="center">4</div>
 *   <div data-el="text" data-x="69%" data-y="62%" data-w="16%" data-h="auto" data-font="14" data-color="#9d174d" data-bold="true" data-align="center">全球上线</div>
 *   <div data-el="text" data-x="69%" data-y="70%" data-w="16%" data-h="auto" data-font="11" data-color="#be185d" data-align="center">Q4 2024</div>
 *   <div data-el="shape" data-shape="rounded" data-x="25%" data-y="80%" data-w="50%" data-h="14%" data-fill="#fdf2f8" data-stroke="#f9a8d4" data-stroke-width="2" data-radius="24"></div>
 *   <div data-el="icon" data-icon="carbon:rocket" data-x="30%" data-y="83%" data-size="24" data-color="#ec4899"></div>
 *   <div data-el="text" data-x="37%" data-y="84%" data-w="35%" data-h="auto" data-font="13" data-color="#9d174d" data-bold="true">预计 2025 年覆盖 100+ 国家和地区</div>
 * </section>
 *
 * 【示例 5: 深色结束页】
 * <section data-type="freeform" data-gradient="linear-gradient(135deg, #0f0f23 0%, #1a1a3e 50%, #0f172a 100%)">
 *   <div data-el="shape" data-shape="circle" data-x="60%" data-y="-30%" data-w="80%" data-h="130%" data-fill="#4f46e5" data-opacity="0.08"></div>
 *   <div data-el="shape" data-shape="circle" data-x="-20%" data-y="50%" data-w="40%" data-h="70%" data-fill="#ec4899" data-opacity="0.06"></div>
 *   <div data-el="shape" data-shape="rounded" data-x="35%" data-y="20%" data-w="30%" data-h="8%" data-fill="#4f46e5" data-opacity="0.3" data-radius="20"></div>
 *   <div data-el="text" data-x="35%" data-y="21%" data-w="30%" data-h="auto" data-font="12" data-color="#a5b4fc" data-bold="true" data-align="center">THANK YOU</div>
 *   <div data-el="text" data-x="10%" data-y="38%" data-w="80%" data-h="auto" data-font="48" data-color="#ffffff" data-bold="true" data-align="center">感谢聆听</div>
 *   <div data-el="text" data-x="15%" data-y="55%" data-w="70%" data-h="auto" data-font="18" data-color="#94a3b8" data-align="center">期待与您携手，共创美好未来</div>
 *   <div data-el="line" data-x1="40%" data-y1="68%" data-x2="60%" data-y2="68%" data-stroke="#4f46e5" data-stroke-width="3"></div>
 *   <div data-el="shape" data-shape="rounded" data-x="30%" data-y="75%" data-w="40%" data-h="15%" data-fill="#ffffff" data-opacity="0.05" data-radius="12"></div>
 *   <div data-el="icon" data-icon="carbon:email" data-x="33%" data-y="79%" data-size="20" data-color="#94a3b8"></div>
 *   <div data-el="text" data-x="39%" data-y="78%" data-w="30%" data-h="auto" data-font="13" data-color="#cbd5e1">contact@example.com</div>
 *   <div data-el="icon" data-icon="carbon:logo-github" data-x="33%" data-y="85%" data-size="20" data-color="#94a3b8"></div>
 *   <div data-el="text" data-x="39%" data-y="84%" data-w="30%" data-h="auto" data-font="13" data-color="#cbd5e1">github.com/your-project</div>
 * </section>
 *
 * ═══════════════════════════════════════════════════════════════
 * 元素类型参考
 * ═══════════════════════════════════════════════════════════════
 * text:  data-font, data-color, data-bold, data-italic, data-align(left/center/right), data-valign(top/middle/bottom), data-bg-color, data-bg-radius
 * shape: data-shape(rect/circle/rounded/triangle), data-fill, data-stroke, data-stroke-width, data-radius, data-shadow, data-gradient
 * image: data-src, data-fit(cover/contain/fill), data-radius, data-alt, data-border
 * icon:  data-icon(carbon:xxx), data-size, data-color
 * line:  data-x1, data-y1, data-x2, data-y2, data-stroke, data-stroke-width, data-dash
 * formula: data-latex(LaTeX公式), data-font, data-color, data-align - 使用 KaTeX 渲染数学公式
 * group: 包含子元素，统一定位
 * card:  自动布局卡片组件，支持图标+标题+描述的组合布局
 *        data-layout: horizontal(水平，图标在左) | vertical(垂直，图标在上) | icon-right(图标在右)
 *        data-fill: 背景色
 *        data-icon: 图标名称
 *        data-icon-color: 图标颜色
 *        data-icon-bg: 图标背景色
 *        data-title: 主标题
 *        data-title-color: 标题颜色
 *        data-subtitle: 副标题/描述
 *        data-subtitle-color: 副标题颜色
 *        data-radius: 圆角
 *        data-padding: 内边距(px)
 *
 * 【Card 组件示例】
 * <div data-el="card" data-x="5%" data-y="40%" data-w="40%" data-h="18%"
 *      data-layout="horizontal" data-fill="#FEE2E2" data-radius="12"
 *      data-icon="carbon:time" data-icon-color="#DC2626" data-icon-bg="#FECACA"
 *      data-title="40% Time Lost" data-title-color="#991B1B"
 *      data-subtitle="Manual data reconciliation" data-subtitle-color="#B91C1C">
 * </div>
 *
 * 通用属性: data-x, data-y, data-w, data-h, data-z, data-rotate, data-opacity
 * 坐标支持: 百分比(50%), 像素(200px), 英寸(2in)
 */

// ============================================================
// 1. 样式配置 - 单一数据源，HTML 和 PPTX 共享
// ============================================================
const SlideStyles = {
    // 尺寸 (PPTX uses inches, HTML uses px)
    // 统一使用 960x540 (16:9 标准比例)
    dimensions: {
        width: 10,      // inches (PPTX)
        height: 5.625,  // inches (PPTX)
        pxPerInch: 96,
        htmlWidth: 960,  // HTML 预览宽度 (统一标准)
        htmlHeight: 540, // HTML 预览高度 (统一标准)
    },

    // 字体家族
    fontFamily: {
        // 中文优先使用思源黑体
        main: '"Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
        // PPTX 字体 (需要系统安装或嵌入)
        pptx: 'Source Han Sans SC',      // 思源黑体
        pptxFallback: 'Microsoft YaHei', // 备选：微软雅黑
    },

    // 间距 (以 PPTX 英寸为基准)
    padding: {
        normal: 0.5,    // 标准内边距
        large: 0.6,     // 封面页内边距
    },

    // 颜色
    colors: {
        primary: '#4f46e5',
        primaryLight: '#e0e7ff',
        primarySubtle: '#eef2ff',
        secondary: '#3b82f6',

        textMain: '#0f172a',
        textSecondary: '#475569',
        textMuted: '#94a3b8',

        success: '#16a34a',
        successBg: '#dcfce7',
        danger: '#dc2626',
        dangerBg: '#fee2e2',

        border: '#e2e8f0',
        bgSubtle: '#f8fafc',
        bgPurple: '#faf5ff',

        white: '#ffffff',
        dark: '#0f172a',
        darkSecondary: '#1e293b',
    },

    // 字体大小 (PPTX pt 值，HTML 会自动按比例缩放)
    // PPTX 标准: 10" x 5.625" (约 960x540px @96dpi)
    // HTML 预览: 864x486px
    fonts: {
        coverTitle: 44,      // 封面标题
        coverSubtitle: 22,   // 封面副标题
        title: 32,           // 普通页标题
        subtitle: 20,        // 小标题/对比框标题
        body: 18,            // 正文
        bodySmall: 16,       // 小正文/列表项
        caption: 14,         // 注释/标签
        small: 12,           // 最小文字
        stat: 48,            // 统计数字
    },

    // 圆角 (PPTX 英寸)
    radius: {
        small: 0.08,
        medium: 0.12,
        large: 0.2,
    },

    // HTML 预览缩放比例
    get htmlScale() {
        return this.dimensions.htmlWidth / (this.dimensions.width * this.dimensions.pxPerInch);
    }
};

// ============================================================
// 2. SlideParser - 从 HTML 解析出 Schema
// ============================================================
class SlideParser {
    /**
     * 解析 HTML 字符串或 DOM 元素，返回 SlideSchema 数组
     */
    static parse(htmlInput) {
        console.log('[SlideParser] Starting parse...');
        let container;

        if (typeof htmlInput === 'string') {
            container = document.createElement('div');
            container.innerHTML = htmlInput;
            console.log('[SlideParser] Input is string, length:', htmlInput.length);
        } else {
            container = htmlInput;
            console.log('[SlideParser] Input is element');
        }

        const sections = container.querySelectorAll('section[data-type]');
        console.log('[SlideParser] Found', sections.length, 'sections');
        const slides = [];

        sections.forEach((section, index) => {
            const slide = this.parseSection(section, index);
            if (slide) {
                console.log(`[SlideParser] Slide ${index}: type=${slide.type}, elements=${slide.elements?.length || 0}`);
                slides.push(slide);
            }
        });

        console.log('[SlideParser] Total parsed slides:', slides.length);
        return slides;
    }

    /**
     * 解析单个 section 元素
     */
    static parseSection(section, index) {
        const type = section.dataset.type || 'content';
        const baseSlide = {
            id: section.id || `slide-${index}`,
            type,
            elements: [],
        };

        // 根据类型使用不同的解析策略
        switch (type) {
            case 'cover':
                return this.parseCover(section, baseSlide);
            case 'toc':
                return this.parseToc(section, baseSlide);
            case 'stats':
                return this.parseStats(section, baseSlide);
            case 'comparison':
                return this.parseComparison(section, baseSlide);
            case 'image_text':
                return this.parseImageText(section, baseSlide);
            case 'icon_grid':
                return this.parseIconGrid(section, baseSlide);
            case 'quote':
                return this.parseQuote(section, baseSlide);
            case 'timeline':
                return this.parseTimeline(section, baseSlide);
            case 'end':
                return this.parseEnd(section, baseSlide);
            case 'list':
                return this.parseList(section, baseSlide);
            case 'freeform':
                return this.parseFreeform(section, baseSlide);
            default:
                return this.parseContent(section, baseSlide);
        }
    }

    // --- 具体类型解析器 ---

    static parseCover(section, slide) {
        const h1 = section.querySelector('h1');
        const subtitle = section.querySelector('p, .subtitle');

        slide.title = h1?.textContent?.trim() || '';
        slide.subtitle = subtitle?.textContent?.trim() || '';
        slide.background = 'gradient-primary';

        return slide;
    }

    static parseToc(section, slide) {
        const h2 = section.querySelector('h2');
        const items = section.querySelectorAll('li, .toc-item');

        slide.title = h2?.textContent?.trim() || '目录';
        slide.items = Array.from(items).map(li => li.textContent.trim());

        return slide;
    }

    static parseStats(section, slide) {
        const h2 = section.querySelector('h2');
        const statElements = section.querySelectorAll('.stat, [data-stat]');

        slide.title = h2?.textContent?.trim() || '';
        slide.stats = Array.from(statElements).map(el => ({
            value: el.querySelector('.stat-value, .value')?.textContent?.trim() || el.dataset.value || '',
            label: el.querySelector('.stat-label, .label')?.textContent?.trim() || el.dataset.label || '',
        }));

        return slide;
    }

    static parseComparison(section, slide) {
        const h2 = section.querySelector('h2');
        const leftCol = section.querySelector('.left, [data-side="left"]');
        const rightCol = section.querySelector('.right, [data-side="right"]');

        slide.title = h2?.textContent?.trim() || '';
        slide.left = {
            title: leftCol?.querySelector('h3, .title')?.textContent?.trim() || '',
            items: Array.from(leftCol?.querySelectorAll('li') || []).map(li => li.textContent.trim()),
        };
        slide.right = {
            title: rightCol?.querySelector('h3, .title')?.textContent?.trim() || '',
            items: Array.from(rightCol?.querySelectorAll('li') || []).map(li => li.textContent.trim()),
        };

        return slide;
    }

    static parseImageText(section, slide) {
        const h2 = section.querySelector('h2');
        const p = section.querySelector('p:not(.caption)');
        const img = section.querySelector('img, .image-placeholder');

        slide.title = h2?.textContent?.trim() || '';
        slide.content = p?.textContent?.trim() || '';
        slide.image = img?.src || null;
        slide.imagePlaceholder = img?.alt || img?.textContent?.trim() || '图片';

        return slide;
    }

    static parseIconGrid(section, slide) {
        const h2 = section.querySelector('h2');
        const cards = section.querySelectorAll('.card, .grid-item, [data-icon]');

        slide.title = h2?.textContent?.trim() || '';
        slide.items = Array.from(cards).map(card => ({
            icon: card.dataset.icon || card.querySelector('[data-icon]')?.dataset.icon || 'carbon:star',
            title: card.querySelector('h3, h4, .title')?.textContent?.trim() || '',
            desc: card.querySelector('p, .desc')?.textContent?.trim() || '',
        }));

        return slide;
    }

    static parseQuote(section, slide) {
        const blockquote = section.querySelector('blockquote, .quote');
        const author = section.querySelector('.author, cite');
        const company = section.querySelector('.company, .org');

        slide.quote = blockquote?.textContent?.trim()?.replace(/^[""]|[""]$/g, '') || '';
        slide.author = author?.textContent?.trim() || '';
        slide.company = company?.textContent?.trim() || '';
        slide.background = 'purple';

        return slide;
    }

    static parseTimeline(section, slide) {
        const h2 = section.querySelector('h2');
        const nodes = section.querySelectorAll('.timeline-item, [data-phase]');

        slide.title = h2?.textContent?.trim() || '';
        slide.items = Array.from(nodes).map(node => ({
            phase: node.dataset.phase || node.querySelector('.phase')?.textContent?.trim() || '',
            title: node.querySelector('h3, h4, .title')?.textContent?.trim() || '',
            desc: node.querySelector('p, .desc')?.textContent?.trim() || '',
        }));

        return slide;
    }

    static parseEnd(section, slide) {
        const h1 = section.querySelector('h1, h2');
        const subtitle = section.querySelector('p, .subtitle');
        const email = section.querySelector('.email, [data-email]');

        slide.title = h1?.textContent?.trim() || '';
        slide.subtitle = subtitle?.textContent?.trim() || '';
        slide.email = email?.textContent?.trim() || email?.dataset?.email || '';
        slide.background = 'dark';

        return slide;
    }

    static parseList(section, slide) {
        const h2 = section.querySelector('h2');
        const items = section.querySelectorAll('li');

        slide.title = h2?.textContent?.trim() || '';
        slide.items = Array.from(items).map(li => li.textContent.trim());

        return slide;
    }

    static parseContent(section, slide) {
        const h2 = section.querySelector('h2, h1');
        const p = section.querySelector('p');

        slide.title = h2?.textContent?.trim() || '';
        slide.content = p?.textContent?.trim() || '';

        return slide;
    }

    /**
     * 解析自由布局幻灯片 - AI 可以精确控制每个元素
     */
    static parseFreeform(section, slide) {
        // 解析幻灯片级别属性
        slide.background = section.dataset.bg || '#ffffff';
        slide.backgroundGradient = section.dataset.gradient || null;
        slide.backgroundImage = section.dataset.bgImage || null;

        // 只解析直接子元素，避免嵌套元素被重复解析
        const elements = section.querySelectorAll(':scope > [data-el]');
        slide.elements = Array.from(elements).map((el, i) => this.parseElement(el, i));

        return slide;
    }

    /**
     * 解析单个自由元素
     */
    static parseElement(el, index) {
        const type = el.dataset.el;
        const base = {
            id: el.id || `el-${index}`,
            type,
            // 位置和大小 (支持 %, px, in)
            x: el.dataset.x || '0%',
            y: el.dataset.y || '0%',
            w: el.dataset.w || 'auto',
            h: el.dataset.h || 'auto',
            // 层级
            z: parseInt(el.dataset.z) || index,
            // 旋转
            rotate: parseFloat(el.dataset.rotate) || 0,
            // 透明度
            opacity: parseFloat(el.dataset.opacity) ?? 1,
        };

        switch (type) {
            case 'text':
                // 获取 HTML 内容，同时处理可能被转义的标签
                let textContent = el.innerHTML?.trim() || '';
                // 如果内容包含转义的 HTML 实体，反转义它们
                if (textContent.includes('&lt;') || textContent.includes('&gt;')) {
                    const temp = document.createElement('textarea');
                    temp.innerHTML = textContent;
                    textContent = temp.value;
                }
                // DEBUG: 检查解析结果
                if (textContent.includes('GLOBAL') || textContent.includes('br')) {
                    console.log('[SlideParser] Text content:', JSON.stringify(textContent));
                }
                return {
                    ...base,
                    content: textContent,
                    // 文字样式
                    font: parseFloat(el.dataset.font) || 18,
                    color: el.dataset.color || '#333333',
                    bold: el.dataset.bold === 'true',
                    italic: el.dataset.italic === 'true',
                    align: el.dataset.align || 'left',       // left, center, right
                    valign: el.dataset.valign || 'top',      // top, middle, bottom
                    lineHeight: parseFloat(el.dataset.lineHeight) || 1.4,
                    // 背景
                    bgColor: el.dataset.bgColor || null,
                    bgRadius: parseFloat(el.dataset.bgRadius) || 0,
                };

            case 'shape':
                return {
                    ...base,
                    shape: el.dataset.shape || 'rect',       // rect, circle, rounded, triangle
                    fill: el.dataset.fill || '#4f46e5',
                    stroke: el.dataset.stroke || null,
                    strokeWidth: parseFloat(el.dataset.strokeWidth) || 0,
                    radius: parseFloat(el.dataset.radius) || 0,
                    // 渐变支持
                    gradient: el.dataset.gradient || null,   // "linear(#ff0, #f00)" or "radial(...)"
                    // 阴影
                    shadow: el.dataset.shadow === 'true',
                };

            case 'image':
                return {
                    ...base,
                    src: el.dataset.src || '',
                    alt: el.dataset.alt || '图片',
                    fit: el.dataset.fit || 'cover',          // cover, contain, fill
                    radius: parseFloat(el.dataset.radius) || 0,
                    // 边框
                    border: el.dataset.border || null,
                };

            case 'icon':
                return {
                    ...base,
                    icon: el.dataset.icon || 'carbon:star',
                    size: parseFloat(el.dataset.size) || 24,
                    color: el.dataset.color || '#333333',
                };

            case 'line':
                return {
                    ...base,
                    x1: el.dataset.x1 || '0%',
                    y1: el.dataset.y1 || '0%',
                    x2: el.dataset.x2 || '100%',
                    y2: el.dataset.y2 || '0%',
                    stroke: el.dataset.stroke || '#cccccc',
                    strokeWidth: parseFloat(el.dataset.strokeWidth) || 2,
                    dash: el.dataset.dash || null,           // "5,5" for dashed
                };

            case 'chart':
                // 图表类型：支持 bar, line, pie, doughnut
                return {
                    ...base,
                    chartType: el.dataset.chartType || 'bar',
                    // 数据格式: "Label1:Value1,Label2:Value2,..."
                    chartData: el.dataset.chartData || '',
                    // 颜色数组: "#ff0000,#00ff00,#0000ff"
                    colors: el.dataset.colors || '#4f46e5,#10b981,#f59e0b,#ec4899,#6366f1',
                    title: el.textContent?.trim() || '',
                };

            case 'formula':
                // 数学公式 - 使用 KaTeX 渲染
                return {
                    ...base,
                    latex: el.dataset.latex || el.textContent?.trim() || '',
                    font: parseFloat(el.dataset.font) || 24,
                    color: el.dataset.color || '#333333',
                    align: el.dataset.align || 'center',
                    displayMode: el.dataset.displayMode !== 'false', // 默认为 display 模式
                };

            case 'group':
                // 递归解析子元素
                const children = el.querySelectorAll(':scope > [data-el]');
                return {
                    ...base,
                    children: Array.from(children).map((child, i) => this.parseElement(child, i)),
                };

            case 'card':
                // 卡片组件 - 自动布局图标+标题+描述
                return {
                    ...base,
                    layout: el.dataset.layout || 'horizontal', // horizontal, vertical, icon-right
                    fill: el.dataset.fill || '#ffffff',
                    radius: parseFloat(el.dataset.radius) || 12,
                    padding: parseFloat(el.dataset.padding) || 16,
                    shadow: el.dataset.shadow === 'true',
                    // 图标
                    icon: el.dataset.icon || null,
                    iconSize: parseFloat(el.dataset.iconSize) || 24,
                    iconColor: el.dataset.iconColor || '#4f46e5',
                    iconBg: el.dataset.iconBg || null,
                    // 标题
                    title: el.dataset.title || '',
                    titleSize: parseFloat(el.dataset.titleSize) || 16,
                    titleColor: el.dataset.titleColor || '#1f2937',
                    titleBold: el.dataset.titleBold !== 'false', // 默认加粗
                    // 副标题
                    subtitle: el.dataset.subtitle || '',
                    subtitleSize: parseFloat(el.dataset.subtitleSize) || 13,
                    subtitleColor: el.dataset.subtitleColor || '#6b7280',
                    // 边框
                    stroke: el.dataset.stroke || null,
                    strokeWidth: parseFloat(el.dataset.strokeWidth) || 1,
                };

            default:
                return base;
        }
    }
}

// ============================================================
// 3. HTMLSlideRenderer - 渲染到 HTML (浏览器预览)
// 使用与 PPTX 相同的参数，自动缩放到预览尺寸
// ============================================================
class HTMLSlideRenderer {
    constructor(options = {}) {
        this.styles = SlideStyles;
        // 缩放因子: HTML预览尺寸 / PPTX原始尺寸
        // 现在统一使用 960x540，scale = 1 (无需缩放)
        this.scale = this.styles.htmlScale;
    }

    // 工具方法：将 PPTX pt 转换为 HTML px
    px(pt) { return Math.round(pt * this.scale); }
    // 工具方法：将 PPTX 英寸转换为 HTML px
    inch(val) { return Math.round(val * this.styles.dimensions.pxPerInch * this.scale); }

    // 获取标准 padding (px)
    get padding() { return this.inch(this.styles.padding.normal); }
    get paddingLarge() { return this.inch(this.styles.padding.large); }

    // 字体家族
    get fontFamily() { return this.styles.fontFamily.main; }

    // 字体大小
    get fonts() {
        const f = this.styles.fonts;
        return {
            coverTitle: this.px(f.coverTitle),
            coverSubtitle: this.px(f.coverSubtitle),
            title: this.px(f.title),
            subtitle: this.px(f.subtitle),
            body: this.px(f.body),
            bodySmall: this.px(f.bodySmall),
            caption: this.px(f.caption),
            small: this.px(f.small),
            stat: this.px(f.stat),
        };
    }

    renderAll(slides) {
        return slides.map((slide, i) => this.render(slide, i)).join('');
    }

    render(slide, index = 0) {
        const method = `render${this.capitalize(slide.type)}`;
        if (typeof this[method] === 'function') {
            return this[method](slide, index);
        }
        return this.renderContent(slide, index);
    }

    capitalize(str) {
        return str.replace(/_(\w)/g, (_, c) => c.toUpperCase())
                  .replace(/^(\w)/, (_, c) => c.toUpperCase());
    }

    // --- 渲染方法 ---

    renderCover(slide, index) {
        const f = this.fonts;
        const p = this.paddingLarge;
        return `
            <div class="slide-modern-cover" style="padding: ${p}px;">
                <h1 contenteditable="true" onblur="window.PPTGenerator?.updateSlideContent(${index}, 'title', this.innerText)" style="font-size: ${f.coverTitle}px; font-weight: 800; margin-bottom: ${this.px(12)}px;">${slide.title || ''}</h1>
                <p contenteditable="true" onblur="window.PPTGenerator?.updateSlideContent(${index}, 'subtitle', this.innerText)" style="font-size: ${f.coverSubtitle}px; opacity: 0.8;">${slide.subtitle || ''}</p>
                <div style="margin-top: ${this.px(24)}px; font-size: ${f.small}px; opacity: 0.6;">Generated by Paper Burner X</div>
            </div>
        `;
    }

    renderToc(slide, index) {
        const f = this.fonts;
        const p = this.padding;
        const circleSize = this.px(32);
        const items = (slide.items || []).map((item, i) => `
            <div style="display: flex; align-items: center; gap: ${this.px(12)}px;">
                <span style="width: ${circleSize}px; height: ${circleSize}px; background: var(--ppt-primary); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: ${f.bodySmall}px; flex-shrink: 0;">${i + 1}</span>
                <span contenteditable="true" onblur="window.PPTGenerator?.updateSlideItem(${index}, ${i}, this.innerText)" style="font-size: ${f.body}px; color: var(--ppt-text-secondary);">${item}</span>
            </div>
        `).join('');

        return `
            <div style="padding: ${p}px; height: 100%; display: flex; flex-direction: column; box-sizing: border-box;">
                <h2 contenteditable="true" onblur="window.PPTGenerator?.updateSlideContent(${index}, 'title', this.innerText)" style="font-size: ${f.title}px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: ${this.px(24)}px; flex-shrink: 0;">${slide.title || ''}</h2>
                <div style="display: flex; flex-direction: column; gap: ${this.px(12)}px; overflow: auto;">${items}</div>
            </div>
        `;
    }

    renderStats(slide, index) {
        const f = this.fonts;
        const p = this.padding;
        const stats = (slide.stats || []).map((stat, i) => `
            <div style="text-align: center; padding: ${this.px(12)}px;">
                <div contenteditable="true" onblur="window.PPTGenerator?.updateSlideStat(${index}, ${i}, 'value', this.innerText)" style="font-size: ${f.stat}px; font-weight: 800; color: var(--ppt-primary); margin-bottom: ${this.px(6)}px;">${stat.value}</div>
                <div contenteditable="true" onblur="window.PPTGenerator?.updateSlideStat(${index}, ${i}, 'label', this.innerText)" style="font-size: ${f.caption}px; color: var(--ppt-text-secondary);">${stat.label}</div>
            </div>
        `).join('');

        const cols = Math.min((slide.stats || []).length, 4);

        return `
            <div style="padding: ${p}px; height: 100%; display: flex; flex-direction: column; box-sizing: border-box;">
                <h2 contenteditable="true" onblur="window.PPTGenerator?.updateSlideContent(${index}, 'title', this.innerText)" style="font-size: ${f.title}px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: ${this.px(24)}px; flex-shrink: 0;">${slide.title || ''}</h2>
                <div style="flex: 1; display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: ${this.px(16)}px; align-items: center;">${stats}</div>
            </div>
        `;
    }

    renderComparison(slide, index) {
        const f = this.fonts;
        const p = this.padding;
        const leftItems = (slide.left?.items || []).map(item => `
            <li style="display: flex; align-items: flex-start; gap: ${this.px(6)}px; margin-bottom: ${this.px(8)}px; font-size: ${f.bodySmall}px; color: #991b1b;">
                <iconify-icon icon="carbon:close-filled" style="color: #dc2626; flex-shrink: 0; margin-top: 2px;"></iconify-icon>
                <span contenteditable="true">${item}</span>
            </li>
        `).join('');

        const rightItems = (slide.right?.items || []).map(item => `
            <li style="display: flex; align-items: flex-start; gap: ${this.px(6)}px; margin-bottom: ${this.px(8)}px; font-size: ${f.bodySmall}px; color: #166534;">
                <iconify-icon icon="carbon:checkmark-filled" style="color: #16a34a; flex-shrink: 0; margin-top: 2px;"></iconify-icon>
                <span contenteditable="true">${item}</span>
            </li>
        `).join('');

        return `
            <div style="padding: ${p}px; height: 100%; display: flex; flex-direction: column; box-sizing: border-box;">
                <h2 contenteditable="true" onblur="window.PPTGenerator?.updateSlideContent(${index}, 'title', this.innerText)" style="font-size: ${f.title}px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: ${this.px(16)}px; flex-shrink: 0;">${slide.title || ''}</h2>
                <div style="flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: ${this.px(16)}px; min-height: 0;">
                    <div style="background: #fee2e2; border-radius: ${this.px(12)}px; padding: ${this.px(16)}px; overflow: auto;">
                        <h3 contenteditable="true" style="font-size: ${f.subtitle}px; font-weight: 600; color: #dc2626; margin-bottom: ${this.px(12)}px;">${slide.left?.title || ''}</h3>
                        <ul style="list-style: none; padding: 0; margin: 0;">${leftItems}</ul>
                    </div>
                    <div style="background: #dcfce7; border-radius: ${this.px(12)}px; padding: ${this.px(16)}px; overflow: auto;">
                        <h3 contenteditable="true" style="font-size: ${f.subtitle}px; font-weight: 600; color: #16a34a; margin-bottom: ${this.px(12)}px;">${slide.right?.title || ''}</h3>
                        <ul style="list-style: none; padding: 0; margin: 0;">${rightItems}</ul>
                    </div>
                </div>
            </div>
        `;
    }

    renderImageText(slide, index) {
        const f = this.fonts;
        const p = this.padding;
        return `
            <div style="padding: ${p}px; height: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: ${this.px(24)}px; align-items: center; box-sizing: border-box;">
                <div>
                    <h2 contenteditable="true" onblur="window.PPTGenerator?.updateSlideContent(${index}, 'title', this.innerText)" style="font-size: ${f.title}px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: ${this.px(12)}px;">${slide.title || ''}</h2>
                    <p contenteditable="true" onblur="window.PPTGenerator?.updateSlideContent(${index}, 'content', this.innerText)" style="font-size: ${f.body}px; color: var(--ppt-text-secondary); line-height: 1.5;">${slide.content || ''}</p>
                </div>
                <div style="background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%); border-radius: ${this.px(12)}px; height: ${this.inch(2.5)}px; display: flex; align-items: center; justify-content: center; color: var(--ppt-primary); font-size: ${f.bodySmall}px;">
                    ${slide.image
                        ? `<img src="${slide.image}" style="max-width: 100%; max-height: 100%; object-fit: contain;">`
                        : `<iconify-icon icon="carbon:image" style="font-size: ${this.px(32)}px; opacity: 0.5; margin-right: 8px;"></iconify-icon>${slide.imagePlaceholder || '图片占位'}`
                    }
                </div>
            </div>
        `;
    }

    renderIconGrid(slide, index) {
        const f = this.fonts;
        const p = this.padding;
        const iconBoxSize = this.px(40);
        const items = (slide.items || []).map(item => `
            <div style="background: var(--ppt-bg-subtle); border-radius: ${this.px(10)}px; padding: ${this.px(16)}px; text-align: center;">
                <div style="width: ${iconBoxSize}px; height: ${iconBoxSize}px; background: var(--ppt-primary-subtle); border-radius: ${this.px(10)}px; display: flex; align-items: center; justify-content: center; margin: 0 auto ${this.px(10)}px auto;">
                    <iconify-icon icon="${item.icon || 'carbon:star'}" style="font-size: ${this.px(20)}px; color: var(--ppt-primary);"></iconify-icon>
                </div>
                <h4 contenteditable="true" style="font-size: ${f.body}px; font-weight: 600; color: var(--ppt-text-main); margin-bottom: ${this.px(4)}px;">${item.title}</h4>
                <p contenteditable="true" style="font-size: ${f.caption}px; color: var(--ppt-text-secondary); margin: 0; line-height: 1.3;">${item.desc}</p>
            </div>
        `).join('');

        const cols = Math.min((slide.items || []).length, 4);

        return `
            <div style="padding: ${p}px; height: 100%; display: flex; flex-direction: column; box-sizing: border-box;">
                <h2 contenteditable="true" onblur="window.PPTGenerator?.updateSlideContent(${index}, 'title', this.innerText)" style="font-size: ${f.title}px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: ${this.px(20)}px; flex-shrink: 0;">${slide.title || ''}</h2>
                <div style="flex: 1; display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: ${this.px(16)}px; align-content: center;">${items}</div>
            </div>
        `;
    }

    renderQuote(slide, index) {
        const f = this.fonts;
        const p = this.paddingLarge;
        return `
            <div style="padding: ${p}px; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%); box-sizing: border-box;">
                <iconify-icon icon="carbon:quotes" style="font-size: ${this.px(48)}px; color: var(--ppt-primary); opacity: 0.3; margin-bottom: ${this.px(16)}px;"></iconify-icon>
                <p contenteditable="true" onblur="window.PPTGenerator?.updateSlideContent(${index}, 'quote', this.innerText)" style="font-size: ${f.subtitle}px; color: var(--ppt-text-main); line-height: 1.5; max-width: 90%; margin-bottom: ${this.px(20)}px; font-style: italic;">"${slide.quote || ''}"</p>
                <div>
                    <div contenteditable="true" style="font-size: ${f.body}px; font-weight: 600; color: var(--ppt-text-main);">${slide.author || ''}</div>
                    <div contenteditable="true" style="font-size: ${f.caption}px; color: var(--ppt-text-secondary); margin-top: ${this.px(4)}px;">${slide.company || ''}</div>
                </div>
            </div>
        `;
    }

    renderTimeline(slide, index) {
        const f = this.fonts;
        const p = this.padding;
        const circleSize = this.px(36);
        const items = (slide.items || []).map(item => `
            <div style="text-align: center;">
                <div style="width: ${circleSize}px; height: ${circleSize}px; background: var(--ppt-primary); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: ${f.caption}px; margin: 0 auto ${this.px(10)}px auto; position: relative; z-index: 1;">${item.phase}</div>
                <div contenteditable="true" style="font-size: ${f.bodySmall}px; font-weight: 600; color: var(--ppt-text-main); margin-bottom: ${this.px(4)}px;">${item.title}</div>
                <div contenteditable="true" style="font-size: ${f.small}px; color: var(--ppt-text-secondary); line-height: 1.3;">${item.desc}</div>
            </div>
        `).join('');

        const cols = (slide.items || []).length;

        return `
            <div style="padding: ${p}px; height: 100%; display: flex; flex-direction: column; box-sizing: border-box;">
                <h2 contenteditable="true" onblur="window.PPTGenerator?.updateSlideContent(${index}, 'title', this.innerText)" style="font-size: ${f.title}px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: ${this.px(20)}px; flex-shrink: 0;">${slide.title || ''}</h2>
                <div style="flex: 1; display: flex; align-items: center; position: relative;">
                    <div style="position: absolute; top: 50%; left: 0; right: 0; height: 3px; background: var(--ppt-border); transform: translateY(-50%);"></div>
                    <div style="display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: ${this.px(12)}px; width: 100%; position: relative;">${items}</div>
                </div>
            </div>
        `;
    }

    renderEnd(slide, index) {
        const f = this.fonts;
        const p = this.paddingLarge;
        return `
            <div class="slide-modern-cover" style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: ${p}px;">
                <h1 contenteditable="true" onblur="window.PPTGenerator?.updateSlideContent(${index}, 'title', this.innerText)" style="font-size: ${f.coverTitle}px; font-weight: 800; margin-bottom: ${this.px(10)}px;">${slide.title || ''}</h1>
                <p contenteditable="true" onblur="window.PPTGenerator?.updateSlideContent(${index}, 'subtitle', this.innerText)" style="font-size: ${f.coverSubtitle}px; opacity: 0.7; margin-bottom: ${this.px(20)}px;">${slide.subtitle || ''}</p>
                ${slide.email ? `<div style="font-size: ${f.bodySmall}px; opacity: 0.5;"><iconify-icon icon="carbon:email"></iconify-icon> ${slide.email}</div>` : ''}
                <div style="margin-top: ${this.px(32)}px; font-size: ${f.small}px; opacity: 0.4;">Generated by Paper Burner X</div>
            </div>
        `;
    }

    renderList(slide, index) {
        const f = this.fonts;
        const p = this.padding;
        const items = (slide.items || []).map((item, i) => `
            <li contenteditable="true" onblur="window.PPTGenerator?.updateSlideItem(${index}, ${i}, this.innerText)" style="margin-bottom: ${this.px(6)}px;">${item}</li>
        `).join('');

        return `
            <div style="padding: ${p}px; height: 100%; display: flex; flex-direction: column; box-sizing: border-box;">
                <h2 contenteditable="true" onblur="window.PPTGenerator?.updateSlideContent(${index}, 'title', this.innerText)" style="font-size: ${f.title}px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: ${this.px(20)}px; flex-shrink: 0;">${slide.title || ''}</h2>
                <ul style="font-size: ${f.body}px; color: var(--ppt-text-secondary); line-height: 1.5; padding-left: ${this.px(24)}px; margin: 0; overflow: auto;">${items}</ul>
            </div>
        `;
    }

    renderContent(slide, index) {
        const f = this.fonts;
        const p = this.padding;
        return `
            <div style="padding: ${p}px; height: 100%; display: flex; flex-direction: column; justify-content: center; box-sizing: border-box;">
                <h2 contenteditable="true" onblur="window.PPTGenerator?.updateSlideContent(${index}, 'title', this.innerText)" style="font-size: ${f.title}px; font-weight: 700; color: var(--ppt-text-main); margin-bottom: ${this.px(16)}px;">${slide.title || ''}</h2>
                <p contenteditable="true" onblur="window.PPTGenerator?.updateSlideContent(${index}, 'content', this.innerText)" style="font-size: ${f.body}px; color: var(--ppt-text-secondary); line-height: 1.5;">${slide.content || ''}</p>
            </div>
        `;
    }

    // ═══════════════════════════════════════════════════════════════
    // Freeform 自由布局渲染
    // ═══════════════════════════════════════════════════════════════

    renderFreeform(slide, index) {
        const { htmlWidth, htmlHeight } = this.styles.dimensions;

        // 背景样式
        let bgStyle = `background: ${slide.background};`;
        if (slide.backgroundGradient) {
            bgStyle = `background: ${slide.backgroundGradient};`;
        }
        if (slide.backgroundImage) {
            bgStyle = `background: url('${slide.backgroundImage}') center/cover;`;
        }

        // 渲染所有元素
        const elements = (slide.elements || [])
            .sort((a, b) => (a.z || 0) - (b.z || 0))
            .map(el => this.renderFreeformElement(el, htmlWidth, htmlHeight))
            .join('');

        return `
            <div style="position: relative; width: 100%; height: 100%; ${bgStyle} overflow: hidden; box-sizing: border-box; font-family: ${this.fontFamily};">
                ${elements}
            </div>
        `;
    }

    /**
     * 解析坐标值，支持 %, px, in
     */
    parseCoord(value, total) {
        if (typeof value === 'number') return value;
        const str = String(value).trim();
        if (str.endsWith('%')) {
            return (parseFloat(str) / 100) * total;
        } else if (str.endsWith('in')) {
            return parseFloat(str) * this.styles.dimensions.pxPerInch * this.scale;
        } else if (str.endsWith('px')) {
            return parseFloat(str) * this.scale;
        } else if (str === 'auto') {
            return 'auto';
        }
        return parseFloat(str) || 0;
    }

    /**
     * 格式化 CSS 值，保留原始单位（百分比/px/auto）
     * 避免转换为像素导致的精度损失
     */
    formatCSSValue(value) {
        if (value === 'auto' || value === undefined || value === null) return 'auto';
        const str = String(value).trim();
        // 已有单位（%, px, in, em, rem 等），直接返回
        if (/(%|px|in|em|rem|vh|vw)$/.test(str)) {
            return str;
        }
        // 纯数字，默认当作像素
        const num = parseFloat(str);
        if (isNaN(num)) return 'auto';
        return num + 'px';
    }

    /**
     * 渲染单个自由元素
     * 优化：直接使用百分比值，让浏览器计算精确位置，避免转换精度损失
     */
    renderFreeformElement(el, containerW, containerH) {
        // 直接使用原始值（百分比/px/auto），不转换
        const x = this.formatCSSValue(el.x);
        const y = this.formatCSSValue(el.y);
        let w = this.formatCSSValue(el.w);
        const h = this.formatCSSValue(el.h);

        // 对于公式元素，如果没有指定宽度，根据 x 位置计算合适的宽度以支持居中对齐
        if (el.type === 'formula' && w === 'auto') {
            // 解析 x 值，计算剩余宽度
            const xStr = String(el.x || '0%').trim();
            if (xStr.endsWith('%')) {
                const xPercent = parseFloat(xStr) || 0;
                // 宽度 = 100% - x位置，确保不会超出右边界
                w = `${Math.max(100 - xPercent, 10)}%`;
            } else {
                // 非百分比情况，使用固定宽度
                w = '80%';
            }
        }

        // 基础定位样式 - 保留原始单位
        const baseStyle = `
            position: absolute;
            left: ${x};
            top: ${y};
            ${w !== 'auto' ? `width: ${w};` : ''}
            ${h !== 'auto' ? `height: ${h};` : ''}
            ${el.rotate ? `transform: rotate(${el.rotate}deg);` : ''}
            ${(el.opacity !== undefined && el.opacity !== null && !isNaN(el.opacity) && el.opacity !== 1) ? `opacity: ${el.opacity};` : ''}
            z-index: ${el.z || 0};
        `.replace(/\s+/g, ' ').trim();

        switch (el.type) {
            case 'text':
                return this.renderFreeformText(el, baseStyle);
            case 'shape':
                return this.renderFreeformShape(el, baseStyle);
            case 'image':
                return this.renderFreeformImage(el, baseStyle);
            case 'icon':
                return this.renderFreeformIcon(el, baseStyle);
            case 'line':
                return this.renderFreeformLine(el, containerW, containerH);
            case 'chart':
                return this.renderFreeformChart(el, baseStyle);
            case 'formula':
                return this.renderFreeformFormula(el, baseStyle);
            case 'group':
                return this.renderFreeformGroup(el, baseStyle, containerW, containerH);
            case 'card':
                return this.renderFreeformCard(el, baseStyle);
            default:
                return '';
        }
    }

    renderFreeformText(el, baseStyle) {
        // 垂直对齐使用 flexbox，但文字本身不用 flex 布局
        const needsVerticalAlign = el.valign && el.valign !== 'top';

        const textStyle = `
            ${baseStyle}
            font-size: ${this.px(el.font)}px;
            color: ${el.color};
            ${el.bold ? 'font-weight: 700;' : ''}
            ${el.italic ? 'font-style: italic;' : ''}
            text-align: ${el.align || 'left'};
            line-height: ${el.lineHeight || 1.4};
            ${el.bgColor ? `background: ${el.bgColor}; padding: 8px; border-radius: ${el.bgRadius || 0}px;` : ''}
            overflow-wrap: break-word;
            word-break: break-word;
            hyphens: auto;
        `.replace(/\s+/g, ' ').trim();

        // DEBUG: 检查内容是否包含 HTML 标签
        if (el.content && (el.content.includes('<br') || el.content.includes('<span'))) {
            console.log('[HTMLRenderer] Text with HTML tags:', el.content.substring(0, 100));
        }

        // 如果需要垂直对齐，使用嵌套容器避免 flex 影响 <br> 的行为
        if (needsVerticalAlign) {
            const wrapperStyle = `
                ${baseStyle}
                display: flex;
                flex-direction: column;
                justify-content: ${el.valign === 'middle' ? 'center' : 'flex-end'};
            `.replace(/\s+/g, ' ').trim();
            return `<div style="${wrapperStyle}"><div contenteditable="true" style="font-size: ${this.px(el.font)}px; color: ${el.color}; ${el.bold ? 'font-weight: 700;' : ''} ${el.italic ? 'font-style: italic;' : ''} text-align: ${el.align || 'left'}; line-height: ${el.lineHeight || 1.4};">${el.content}</div></div>`;
        }

        return `<div contenteditable="true" style="${textStyle}">${el.content}</div>`;
    }

    renderFreeformShape(el, baseStyle) {
        let shapeStyle = baseStyle;

        // 形状类型
        if (el.shape === 'circle') {
            shapeStyle += ' border-radius: 50%;';
        } else if (el.shape === 'rounded' || el.radius) {
            shapeStyle += ` border-radius: ${el.radius || 12}px;`;
        }

        // 填充
        if (el.gradient) {
            shapeStyle += ` background: ${el.gradient};`;
        } else {
            shapeStyle += ` background: ${el.fill};`;
        }

        // 边框
        if (el.stroke) {
            shapeStyle += ` border: ${el.strokeWidth || 1}px solid ${el.stroke};`;
        }

        // 阴影
        if (el.shadow) {
            shapeStyle += ' box-shadow: 0 4px 12px rgba(0,0,0,0.15);';
        }

        return `<div style="${shapeStyle}"></div>`;
    }

    renderFreeformImage(el, baseStyle) {
        let imgStyle = baseStyle;

        if (el.radius) {
            imgStyle += ` border-radius: ${el.radius}px; overflow: hidden;`;
        }
        if (el.border) {
            imgStyle += ` border: ${el.border};`;
        }

        const fitStyle = el.fit === 'contain' ? 'object-fit: contain;' :
                         el.fit === 'fill' ? 'object-fit: fill;' :
                         'object-fit: cover;';

        if (el.src) {
            return `<div style="${imgStyle}"><img src="${el.src}" alt="${el.alt}" style="width: 100%; height: 100%; ${fitStyle}"></div>`;
        } else {
            // 占位符
            return `
                <div style="${imgStyle} background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%); display: flex; align-items: center; justify-content: center; color: #4f46e5;">
                    <iconify-icon icon="carbon:image" style="font-size: 32px; opacity: 0.5; margin-right: 8px;"></iconify-icon>
                    ${el.alt}
                </div>
            `;
        }
    }

    renderFreeformIcon(el, baseStyle) {
        const iconStyle = `
            ${baseStyle}
            font-size: ${this.px(el.size)}px;
            color: ${el.color};
            display: flex;
            align-items: center;
            justify-content: center;
        `.replace(/\s+/g, ' ').trim();

        return `<div style="${iconStyle}"><iconify-icon icon="${el.icon}"></iconify-icon></div>`;
    }

    renderFreeformLine(el, containerW, containerH) {
        // SVG 支持百分比坐标，直接使用原始值
        const x1 = this.formatSVGCoord(el.x1);
        const y1 = this.formatSVGCoord(el.y1);
        const x2 = this.formatSVGCoord(el.x2);
        const y2 = this.formatSVGCoord(el.y2);

        const dashStyle = el.dash ? `stroke-dasharray: ${el.dash};` : '';

        return `
            <svg style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: ${el.z || 0};">
                <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
                      stroke="${el.stroke}" stroke-width="${el.strokeWidth}"
                      style="${dashStyle}" />
            </svg>
        `;
    }

    /**
     * 格式化 SVG 坐标值，保留百分比
     */
    formatSVGCoord(value) {
        if (value === undefined || value === null) return '0';
        const str = String(value).trim();
        // 百分比直接返回
        if (str.endsWith('%')) {
            return str;
        }
        // 已有 px 单位，转为纯数字
        if (str.endsWith('px')) {
            return parseFloat(str) || 0;
        }
        // 纯数字
        return parseFloat(str) || 0;
    }

    renderFreeformGroup(el, baseStyle, containerW, containerH) {
        const children = (el.children || [])
            .map(child => this.renderFreeformElement(child, containerW, containerH))
            .join('');

        return `<div style="${baseStyle}">${children}</div>`;
    }

    /**
     * 渲染卡片组件 - 自动布局图标+标题+描述
     * 支持三种布局：horizontal(水平), vertical(垂直), icon-right(图标在右)
     */
    renderFreeformCard(el, baseStyle) {
        const layout = el.layout || 'horizontal';
        const padding = el.padding || 16;
        const radius = el.radius || 12;

        // 容器样式
        let containerStyle = `
            ${baseStyle}
            background: ${el.fill || '#ffffff'};
            border-radius: ${radius}px;
            padding: ${padding}px;
            box-sizing: border-box;
            ${el.shadow ? 'box-shadow: 0 4px 12px rgba(0,0,0,0.1);' : ''}
            ${el.stroke ? `border: ${el.strokeWidth || 1}px solid ${el.stroke};` : ''}
        `.replace(/\s+/g, ' ').trim();

        // 图标部分
        const iconSize = el.iconSize || 24;
        const iconBgSize = iconSize + 12; // 图标背景比图标大一些
        let iconHtml = '';
        if (el.icon) {
            const iconBgStyle = el.iconBg
                ? `background: ${el.iconBg}; width: ${iconBgSize}px; height: ${iconBgSize}px; border-radius: ${iconBgSize / 3}px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;`
                : `width: ${iconSize}px; height: ${iconSize}px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;`;
            iconHtml = `
                <div style="${iconBgStyle}">
                    <iconify-icon icon="${el.icon}" style="font-size: ${iconSize}px; color: ${el.iconColor || '#4f46e5'};"></iconify-icon>
                </div>
            `;
        }

        // 文字部分
        const titleHtml = el.title
            ? `<div style="font-size: ${el.titleSize || 16}px; color: ${el.titleColor || '#1f2937'}; ${el.titleBold !== false ? 'font-weight: 600;' : ''} line-height: 1.3; margin-bottom: ${el.subtitle ? '4px' : '0'};">${el.title}</div>`
            : '';
        const subtitleHtml = el.subtitle
            ? `<div style="font-size: ${el.subtitleSize || 13}px; color: ${el.subtitleColor || '#6b7280'}; line-height: 1.4;">${el.subtitle}</div>`
            : '';
        const textHtml = `<div style="flex: 1; min-width: 0;">${titleHtml}${subtitleHtml}</div>`;

        // 根据布局组织内容
        let innerStyle = '';
        let content = '';

        switch (layout) {
            case 'vertical':
                // 垂直布局：图标在上，文字在下，居中对齐
                innerStyle = 'display: flex; flex-direction: column; align-items: center; text-align: center; height: 100%; justify-content: center; gap: 12px;';
                content = `${iconHtml}${textHtml}`;
                break;
            case 'icon-right':
                // 图标在右：文字在左，图标在右
                innerStyle = 'display: flex; flex-direction: row; align-items: center; height: 100%; gap: 12px;';
                content = `${textHtml}${iconHtml}`;
                break;
            case 'horizontal':
            default:
                // 水平布局：图标在左，文字在右
                innerStyle = 'display: flex; flex-direction: row; align-items: center; height: 100%; gap: 12px;';
                content = `${iconHtml}${textHtml}`;
                break;
        }

        return `<div style="${containerStyle}"><div style="${innerStyle}">${content}</div></div>`;
    }

    /**
     * 渲染数学公式 - 使用 KaTeX
     * 注意：公式居中需要确保容器有宽度，且使用 flex 对齐
     */
    renderFreeformFormula(el, baseStyle) {
        // 确定对齐方式，默认居中
        const align = el.align || 'center';
        let justifyContent = 'center';
        if (align === 'left') {
            justifyContent = 'flex-start';
        } else if (align === 'right') {
            justifyContent = 'flex-end';
        }

        // 容器样式 - 使用 flex 布局实现居中
        const formulaStyle = `
            ${baseStyle}
            display: flex;
            align-items: center;
            justify-content: ${justifyContent};
            color: ${el.color || '#333333'};
            font-size: ${this.px(el.font)}px;
            overflow: visible;
        `.replace(/\s+/g, ' ').trim();

        // 尝试使用 KaTeX 渲染
        let formulaHtml = '';
        const latex = el.latex || '';

        if (typeof katex !== 'undefined' && latex) {
            try {
                // 使用 inline 模式渲染，避免 display 模式的额外垂直间距
                formulaHtml = katex.renderToString(latex, {
                    displayMode: false,
                    throwOnError: false,
                    output: 'html',
                });
                // 清除 KaTeX 默认的 margin，确保垂直居中
                formulaHtml = `<span class="formula-wrapper" style="display: inline-block; line-height: 1; margin: 0; padding: 0;">${formulaHtml}</span>`;
            } catch (e) {
                console.warn('[HTMLRenderer] KaTeX render error:', e);
                formulaHtml = `<code style="font-family: 'Times New Roman', serif; font-style: italic;">${latex}</code>`;
            }
        } else {
            formulaHtml = `<code style="font-family: 'Times New Roman', serif; font-style: italic;">${latex}</code>`;
        }

        return `<div style="${formulaStyle}">${formulaHtml}</div>`;
    }

    /**
     * 渲染简单图表 (SVG)
     * 使用 viewBox 实现响应式缩放，图表会自动填满容器
     */
    renderFreeformChart(el, baseStyle) {
        const data = this.parseChartData(el.chartData);
        const colors = (el.colors || '').split(',').map(c => c.trim());
        const chartType = el.chartType || 'bar';
        const labels = el.labels || '';

        // 图表容器 - 使用 flex 布局让 SVG 填满可用空间
        const chartStyle = `
            ${baseStyle}
            display: flex;
            flex-direction: column;
            background: transparent;
            padding: 0;
            overflow: hidden;
        `.replace(/\s+/g, ' ').trim();

        let chartSvg = '';

        if (chartType === 'bar') {
            chartSvg = this.renderBarChart(data, colors, labels);
        } else if (chartType === 'pie' || chartType === 'doughnut') {
            chartSvg = this.renderPieChart(data, colors, chartType === 'doughnut');
        } else if (chartType === 'line') {
            chartSvg = this.renderLineChart(data, colors, labels);
        }

        const titleHtml = el.title ? `<div style="font-size: 14px; font-weight: 600; color: #1e293b; margin-bottom: 8px;">${el.title}</div>` : '';

        return `<div style="${chartStyle}">${titleHtml}${chartSvg}</div>`;
    }

    parseChartData(dataStr) {
        if (!dataStr) return [];
        return dataStr.split(',').map(item => {
            const [label, value] = item.split(':');
            return { label: label?.trim() || '', value: parseFloat(value) || 0 };
        });
    }

    renderBarChart(data, colors, labels = '') {
        if (!data.length) return '<div style="color: #94a3b8;">No data</div>';

        // 使用固定的 viewBox 坐标系，SVG 会自动缩放填满容器
        const viewBoxWidth = 400;
        const viewBoxHeight = 200;
        const padding = { top: 20, right: 20, bottom: 40, left: 50 };
        const chartWidth = viewBoxWidth - padding.left - padding.right;
        const chartHeight = viewBoxHeight - padding.top - padding.bottom;

        const maxValue = Math.max(...data.map(d => d.value));
        const barWidth = Math.min(50, (chartWidth - (data.length - 1) * 10) / data.length);
        const barGap = (chartWidth - barWidth * data.length) / (data.length + 1);

        // Y轴刻度
        const yTicks = 5;
        const yTickStep = maxValue / yTicks;
        let yAxisHtml = '';
        for (let i = 0; i <= yTicks; i++) {
            const value = i * yTickStep;
            const y = padding.top + chartHeight - (i / yTicks) * chartHeight;
            yAxisHtml += `
                <line x1="${padding.left}" y1="${y}" x2="${viewBoxWidth - padding.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="4"/>
                <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6b7280">${Math.round(value)}</text>
            `;
        }

        // Y轴标签
        const yLabelHtml = labels ? `
            <text x="12" y="${viewBoxHeight / 2}" text-anchor="middle" font-size="12" fill="#6b7280" transform="rotate(-90, 12, ${viewBoxHeight / 2})">${labels}</text>
        ` : '';

        const bars = data.map((d, i) => {
            const color = colors[i % colors.length] || '#4f46e5';
            const barHeight = (d.value / maxValue) * chartHeight;
            const x = padding.left + barGap + i * (barWidth + barGap);
            const y = padding.top + chartHeight - barHeight;

            return `
                <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" rx="4"/>
                <text x="${x + barWidth/2}" y="${y - 8}" text-anchor="middle" font-size="11" fill="#374151" font-weight="500">${d.value}</text>
                <text x="${x + barWidth/2}" y="${viewBoxHeight - 10}" text-anchor="middle" font-size="11" fill="#6b7280">${d.label}</text>
            `;
        }).join('');

        return `
            <svg viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: 100%; flex: 1;">
                <!-- Grid and Y-axis -->
                ${yAxisHtml}
                ${yLabelHtml}
                <!-- Bars -->
                ${bars}
            </svg>
        `;
    }

    renderPieChart(data, colors, isDoughnut = false) {
        if (!data.length) return '<div style="color: #94a3b8;">No data</div>';

        const total = data.reduce((sum, d) => sum + d.value, 0);
        // 使用固定的 viewBox，SVG 会自动缩放
        const viewBoxSize = 200;
        const cx = viewBoxSize / 2, cy = viewBoxSize / 2;
        const r = viewBoxSize / 2 - 10;
        const innerR = isDoughnut ? r * 0.6 : 0;

        let startAngle = -90;
        const paths = data.map((d, i) => {
            const color = colors[i % colors.length] || '#4f46e5';
            const angle = (d.value / total) * 360;
            const endAngle = startAngle + angle;

            const start = this.polarToCartesian(cx, cy, r, startAngle);
            const end = this.polarToCartesian(cx, cy, r, endAngle);
            const innerStart = this.polarToCartesian(cx, cy, innerR, startAngle);
            const innerEnd = this.polarToCartesian(cx, cy, innerR, endAngle);

            const largeArc = angle > 180 ? 1 : 0;

            const path = isDoughnut
                ? `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} L ${innerEnd.x} ${innerEnd.y} A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y} Z`
                : `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;

            startAngle = endAngle;
            return `<path d="${path}" fill="${color}"/>`;
        }).join('');

        return `<svg viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: 100%; max-width: 300px; flex: 1;">${paths}</svg>`;
    }

    polarToCartesian(cx, cy, r, angleDeg) {
        const angleRad = (angleDeg * Math.PI) / 180;
        return {
            x: cx + r * Math.cos(angleRad),
            y: cy + r * Math.sin(angleRad)
        };
    }

    renderLineChart(data, colors, labels = '') {
        if (!data.length) return '<div style="color: #94a3b8;">No data</div>';

        // 使用固定的 viewBox 坐标系，SVG 会自动缩放填满容器
        const viewBoxWidth = 400;
        const viewBoxHeight = 200;
        const padding = { top: 20, right: 30, bottom: 40, left: 50 };
        const chartWidth = viewBoxWidth - padding.left - padding.right;
        const chartHeight = viewBoxHeight - padding.top - padding.bottom;

        const maxValue = Math.max(...data.map(d => d.value));
        const minValue = 0;
        const color = colors[0] || '#6366F1';

        // 计算数据点坐标
        const points = data.map((d, i) => {
            const x = padding.left + (i / (data.length - 1 || 1)) * chartWidth;
            const y = padding.top + chartHeight - ((d.value - minValue) / (maxValue - minValue || 1)) * chartHeight;
            return { x, y, value: d.value, label: d.label };
        });

        // 生成折线路径
        const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

        // 生成填充区域路径（带渐变）
        const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`;

        // Y轴刻度
        const yTicks = 5;
        const yTickStep = (maxValue - minValue) / yTicks;
        let yAxisHtml = '';
        for (let i = 0; i <= yTicks; i++) {
            const value = minValue + i * yTickStep;
            const y = padding.top + chartHeight - (i / yTicks) * chartHeight;
            yAxisHtml += `
                <line x1="${padding.left}" y1="${y}" x2="${viewBoxWidth - padding.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="4"/>
                <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6b7280">${Math.round(value)}</text>
            `;
        }

        // X轴标签
        let xAxisHtml = points.map((p, i) => `
            <text x="${p.x}" y="${viewBoxHeight - 10}" text-anchor="middle" font-size="11" fill="#6b7280">${p.label}</text>
        `).join('');

        // 数据点和悬停效果
        const dotsHtml = points.map((p, i) => `
            <circle cx="${p.x}" cy="${p.y}" r="5" fill="${color}" stroke="white" stroke-width="2"/>
            <text x="${p.x}" y="${p.y - 12}" text-anchor="middle" font-size="11" fill="#374151" font-weight="500">${p.value}</text>
        `).join('');

        // Y轴标签
        const yLabelHtml = labels ? `
            <text x="12" y="${viewBoxHeight / 2}" text-anchor="middle" font-size="12" fill="#6b7280" transform="rotate(-90, 12, ${viewBoxHeight / 2})">${labels}</text>
        ` : '';

        return `
            <svg viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: 100%; flex: 1;">
                <defs>
                    <linearGradient id="lineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:${color};stop-opacity:0.3"/>
                        <stop offset="100%" style="stop-color:${color};stop-opacity:0.05"/>
                    </linearGradient>
                </defs>
                <!-- Grid and Y-axis -->
                ${yAxisHtml}
                ${yLabelHtml}
                <!-- Area fill -->
                <path d="${areaPath}" fill="url(#lineGradient)"/>
                <!-- Line -->
                <path d="${linePath}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                <!-- X-axis labels -->
                ${xAxisHtml}
                <!-- Data points -->
                ${dotsHtml}
            </svg>
        `;
    }
}

// ============================================================
// 4. PPTXSlideRenderer - 渲染到 PPTX
// 使用与 HTMLSlideRenderer 相同的 SlideStyles 配置
// ============================================================
class PPTXSlideRenderer {
    constructor(options = {}) {
        this.styles = SlideStyles;

        // 图标到 Emoji 的映射表
        this.iconEmoji = {
            'carbon:machine-learning': '🧠',
            'carbon:paint-brush': '🎨',
            'carbon:flash': '⚡',
            'carbon:data-check': '✅',
            'carbon:analytics': '📊',
            'carbon:data-vis-1': '📈',
            'carbon:template': '📋',
            'carbon:security': '🔒',
            'carbon:star': '⭐',
            'carbon:checkmark-filled': '✓',
            'carbon:close-filled': '✕',
            'carbon:quotes': '"',
            'carbon:email': '✉',
            'carbon:image': '🖼',
            'carbon:user': '👤',
            'carbon:bot': '🤖',
            'carbon:add-alt': '+',
            'carbon:edit': '✏',
            'carbon:tree-view-alt': '🌲',
            'carbon:warning-alt': '⚠',
            'carbon:warning-filled': '⚠',
            'default': '●'
        };
    }

    getIconEmoji(iconName) {
        return this.iconEmoji[iconName] || this.iconEmoji['default'];
    }

    async render(slides, filename = 'presentation.pptx') {
        if (typeof PptxGenJS === 'undefined') {
            throw new Error('PptxGenJS 未加载');
        }

        console.log('[PPTXSlideRenderer] Starting render with', slides.length, 'slides');

        // 预加载所有图标和公式
        await Promise.all([
            this.preloadAllIcons(slides),
            this.preloadAllFormulas(slides),
        ]);

        const pres = new PptxGenJS();
        pres.layout = 'LAYOUT_16x9';
        pres.title = filename.replace('.pptx', '');

        // 设置默认字体为思源黑体
        pres.theme = { headFontFace: this.styles.fontFamily.pptx, bodyFontFace: this.styles.fontFamily.pptx };

        slides.forEach((slideData, index) => {
            console.log(`[PPTXSlideRenderer] Rendering slide ${index + 1}/${slides.length}: type="${slideData.type}", id="${slideData.id}"`);
            this.renderSlide(pres, slideData);
        });

        console.log('[PPTXSlideRenderer] All slides rendered, writing file...');
        return pres.writeFile({ fileName: filename });
    }

    renderSlide(pres, slideData) {
        const slide = pres.addSlide();
        const method = `render${this.capitalize(slideData.type)}`;

        try {
            if (typeof this[method] === 'function') {
                this[method](slide, slideData);
            } else {
                this.renderContent(slide, slideData);
            }
        } catch (e) {
            console.error(`Error rendering slide type "${slideData.type}":`, e);
            console.error('Slide data:', JSON.stringify(slideData, null, 2));
            throw e;
        }
    }

    capitalize(str) {
        return str.replace(/_(\w)/g, (_, c) => c.toUpperCase())
                  .replace(/^(\w)/, (_, c) => c.toUpperCase());
    }

    color(name) {
        if (!name) return '333333'; // 默认颜色
        const c = this.styles.colors[name] || name;
        return String(c).replace('#', '');
    }

    /**
     * 安全地转换颜色值为 PPTX 格式 (去掉 # 前缀)
     * 处理各种输入情况：null, undefined, 对象, 字符串
     */
    safeColor(value) {
        if (!value) return null;
        if (typeof value === 'object') {
            // 如果是对象，尝试提取 color 属性
            return value.color ? String(value.color).replace('#', '') : null;
        }
        const color = String(value).trim().replace('#', '');
        // 确保返回有效的颜色值或 null
        return color && /^[0-9a-fA-F]{3,8}$/.test(color) ? color : null;
    }

    // 尺寸常量 - 与 SlideStyles 同步
    get SLIDE_W() { return this.styles.dimensions.width; }
    get SLIDE_H() { return this.styles.dimensions.height; }
    get PADDING() { return this.styles.padding.normal; }
    get PADDING_LARGE() { return this.styles.padding.large; }
    get CONTENT_W() { return this.SLIDE_W - this.PADDING * 2; }

    // 字体大小 - 直接使用 SlideStyles
    get fonts() { return this.styles.fonts; }

    // 字体家族
    get fontFace() { return this.styles.fontFamily.pptx; }

    /**
     * 添加文本到幻灯片（自动应用默认字体）
     */
    addText(slide, text, options) {
        slide.addText(text, {
            fontFace: this.fontFace,
            ...options
        });
    }

    // --- 渲染方法 ---

    renderCover(slide, data) {
        const p = this.PADDING_LARGE;
        const f = this.fonts;

        slide.background = { color: this.color('primary') };

        slide.addShape('rect', {
            x: 0, y: 0, w: '100%', h: '100%',
            fill: { type: 'solid', color: this.color('secondary'), transparency: 50 },
            line: { color: 'FFFFFF', transparency: 100 }
        });

        slide.addShape('ellipse', {
            x: this.SLIDE_W - 3.5, y: -1.4, w: 4.6, h: 4.6,
            fill: { type: 'solid', color: 'FFFFFF', transparency: 90 },
            line: { color: 'FFFFFF', transparency: 100 }
        });

        const startY = this.SLIDE_H * 0.35;
        this.addText(slide, data.title, {
            x: p, y: startY, w: this.SLIDE_W - p * 2, h: 0.8,
            fontSize: f.coverTitle, color: 'FFFFFF', bold: true, align: 'left'
        });
        this.addText(slide, data.subtitle || '', {
            x: p, y: startY + 0.7, w: this.SLIDE_W - p * 2, h: 0.5,
            fontSize: f.coverSubtitle, color: 'FFFFFF', transparency: 20, align: 'left'
        });
        this.addText(slide, 'Generated by Paper Burner X', {
            x: p, y: this.SLIDE_H - 0.5, w: this.SLIDE_W - p * 2, h: 0.3,
            fontSize: f.small, color: 'FFFFFF', transparency: 50, align: 'left'
        });
    }

    renderToc(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        this.addText(slide, data.title, {
            x: p, y: p, w: this.CONTENT_W, h: 0.5,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });

        const items = data.items || [];
        const startY = p + 0.7;
        const itemHeight = 0.45;

        items.forEach((item, i) => {
            const y = startY + i * itemHeight;
            slide.addShape('ellipse', {
                x: p, y: y, w: 0.35, h: 0.35,
                fill: { color: this.color('primary') },
                line: { color: 'FFFFFF', transparency: 100 }
            });
            this.addText(slide,String(i + 1), {
                x: p, y: y, w: 0.35, h: 0.35,
                fontSize: f.bodySmall, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle'
            });
            this.addText(slide,item, {
                x: p + 0.5, y: y, w: this.CONTENT_W - 0.5, h: 0.35,
                fontSize: f.body, color: this.color('textSecondary'), valign: 'middle'
            });
        });
    }

    renderStats(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        this.addText(slide, data.title, {
            x: p, y: p, w: this.CONTENT_W, h: 0.5,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });

        const stats = data.stats || [];
        const cols = Math.min(stats.length, 4);
        const cardW = (this.CONTENT_W - 0.25 * (cols - 1)) / cols;
        const startY = (this.SLIDE_H - 1.5) / 2;

        stats.forEach((stat, i) => {
            const x = p + i * (cardW + 0.25);
            this.addText(slide,stat.value, {
                x: x, y: startY, w: cardW, h: 0.8,
                fontSize: f.stat, color: this.color('primary'), bold: true, align: 'center', valign: 'bottom'
            });
            this.addText(slide,stat.label, {
                x: x, y: startY + 0.9, w: cardW, h: 0.4,
                fontSize: f.caption, color: this.color('textSecondary'), align: 'center', valign: 'top'
            });
        });
    }

    renderComparison(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        this.addText(slide, data.title, {
            x: p, y: p, w: this.CONTENT_W, h: 0.5,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });

        const boxW = (this.CONTENT_W - 0.3) / 2;
        const boxH = this.SLIDE_H - p * 2 - 0.8;
        const boxY = p + 0.65;

        // 左侧
        slide.addShape('roundRect', {
            x: p, y: boxY, w: boxW, h: boxH,
            fill: { color: this.color('dangerBg') },
            line: { color: 'FFFFFF', transparency: 100 },
            rectRadius: 0.12
        });
        this.addText(slide,data.left?.title || '', {
            x: p + 0.2, y: boxY + 0.15, w: boxW - 0.4, h: 0.35,
            fontSize: f.subtitle, color: this.color('danger'), bold: true
        });
        const leftItems = (data.left?.items || []).map(item => ({
            text: '✕  ' + item,
            options: { fontSize: f.bodySmall, color: '991b1b', breakLine: true }
        }));
        this.addText(slide,leftItems, {
            x: p + 0.2, y: boxY + 0.55, w: boxW - 0.4, h: boxH - 0.7,
            lineSpacing: 26, valign: 'top'
        });

        // 右侧
        const rightX = p + boxW + 0.3;
        slide.addShape('roundRect', {
            x: rightX, y: boxY, w: boxW, h: boxH,
            fill: { color: this.color('successBg') },
            line: { color: 'FFFFFF', transparency: 100 },
            rectRadius: 0.12
        });
        this.addText(slide,data.right?.title || '', {
            x: rightX + 0.2, y: boxY + 0.15, w: boxW - 0.4, h: 0.35,
            fontSize: f.subtitle, color: this.color('success'), bold: true
        });
        const rightItems = (data.right?.items || []).map(item => ({
            text: '✓  ' + item,
            options: { fontSize: f.bodySmall, color: '166534', breakLine: true }
        }));
        this.addText(slide,rightItems, {
            x: rightX + 0.2, y: boxY + 0.55, w: boxW - 0.4, h: boxH - 0.7,
            lineSpacing: 26, valign: 'top'
        });
    }

    renderImageText(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        const halfW = (this.CONTENT_W - 0.4) / 2;
        const centerY = this.SLIDE_H / 2;

        this.addText(slide,data.title, {
            x: p, y: centerY - 1, w: halfW, h: 0.5,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });
        this.addText(slide,data.content || '', {
            x: p, y: centerY - 0.35, w: halfW, h: 1.2,
            fontSize: f.body, color: this.color('textSecondary'), lineSpacing: 24
        });

        const imgX = p + halfW + 0.4;
        const imgH = 2.5;
        const imgY = (this.SLIDE_H - imgH) / 2;

        if (data.image) {
            try {
                slide.addImage({ path: data.image, x: imgX, y: imgY, w: halfW, h: imgH });
            } catch (e) {
                this.addImagePlaceholder(slide, imgX, imgY, halfW, imgH, data.imagePlaceholder);
            }
        } else {
            this.addImagePlaceholder(slide, imgX, imgY, halfW, imgH, data.imagePlaceholder);
        }
    }

    addImagePlaceholder(slide, x, y, w, h, text) {
        const f = this.fonts;
        slide.addShape('roundRect', {
            x, y, w, h,
            fill: { color: this.color('primaryLight') },
            line: { color: 'FFFFFF', transparency: 100 },
            rectRadius: 0.12
        });
        this.addText(slide,text || '图片', {
            x, y, w, h,
            fontSize: f.bodySmall, color: this.color('primary'), align: 'center', valign: 'middle'
        });
    }

    renderIconGrid(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        this.addText(slide, data.title, {
            x: p, y: p, w: this.CONTENT_W, h: 0.5,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });

        const items = data.items || [];
        const cols = Math.min(items.length, 4);
        const cardW = (this.CONTENT_W - 0.2 * (cols - 1)) / cols;
        const cardH = 1.8;
        const startY = p + 0.75;

        items.forEach((item, i) => {
            const x = p + i * (cardW + 0.2);

            slide.addShape('roundRect', {
                x, y: startY, w: cardW, h: cardH,
                fill: { color: this.color('bgSubtle') },
                line: { color: 'FFFFFF', transparency: 100 },
                rectRadius: 0.1
            });

            const iconSize = 0.45;
            const iconX = x + (cardW - iconSize) / 2;
            slide.addShape('roundRect', {
                x: iconX, y: startY + 0.2, w: iconSize, h: iconSize,
                fill: { color: this.color('primaryLight') },
                line: { color: 'FFFFFF', transparency: 100 },
                rectRadius: 0.08
            });

            const emoji = this.getIconEmoji(item.icon);
            this.addText(slide,emoji, {
                x: iconX, y: startY + 0.2, w: iconSize, h: iconSize,
                fontSize: 20, color: this.color('primary'), align: 'center', valign: 'middle'
            });

            this.addText(slide,item.title, {
                x, y: startY + 0.8, w: cardW, h: 0.3,
                fontSize: f.body, color: this.color('textMain'), bold: true, align: 'center'
            });

            this.addText(slide,item.desc, {
                x: x + 0.08, y: startY + 1.15, w: cardW - 0.16, h: 0.5,
                fontSize: f.caption, color: this.color('textSecondary'), align: 'center'
            });
        });
    }

    renderQuote(slide, data) {
        const p = this.PADDING_LARGE;
        const f = this.fonts;
        slide.background = { color: this.color('bgPurple') };

        this.addText(slide,'"', {
            x: p, y: 0.6, w: 0.8, h: 0.8,
            fontSize: 60, color: this.color('primary'), transparency: 70
        });

        this.addText(slide,`"${data.quote}"`, {
            x: p + 0.3, y: (this.SLIDE_H - 1.2) / 2, w: this.CONTENT_W - 0.6, h: 1.2,
            fontSize: f.subtitle, color: this.color('textMain'), align: 'center', valign: 'middle', italic: true
        });

        this.addText(slide,data.author || '', {
            x: p, y: this.SLIDE_H - 1, w: this.CONTENT_W, h: 0.3,
            fontSize: f.body, color: this.color('textMain'), bold: true, align: 'center'
        });
        this.addText(slide,data.company || '', {
            x: p, y: this.SLIDE_H - 0.65, w: this.CONTENT_W, h: 0.25,
            fontSize: f.caption, color: this.color('textSecondary'), align: 'center'
        });
    }

    renderTimeline(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        this.addText(slide, data.title, {
            x: p, y: p, w: this.CONTENT_W, h: 0.5,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });

        const items = data.items || [];
        const cols = items.length;
        const nodeW = this.CONTENT_W / cols;
        const lineY = this.SLIDE_H / 2;

        slide.addShape('rect', {
            x: p, y: lineY - 0.02, w: this.CONTENT_W, h: 0.04,
            fill: { color: this.color('border') },
            line: { color: 'FFFFFF', transparency: 100 }
        });

        items.forEach((item, i) => {
            const centerX = p + nodeW * i + nodeW / 2;
            const circleR = 0.22;

            slide.addShape('ellipse', {
                x: centerX - circleR, y: lineY - circleR, w: circleR * 2, h: circleR * 2,
                fill: { color: this.color('primary') },
                line: { color: 'FFFFFF', transparency: 100 }
            });
            this.addText(slide,item.phase, {
                x: centerX - circleR, y: lineY - circleR, w: circleR * 2, h: circleR * 2,
                fontSize: f.caption, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle'
            });

            this.addText(slide,item.title, {
                x: centerX - nodeW / 2 + 0.05, y: lineY + 0.35, w: nodeW - 0.1, h: 0.3,
                fontSize: f.bodySmall, color: this.color('textMain'), bold: true, align: 'center'
            });

            this.addText(slide,item.desc, {
                x: centerX - nodeW / 2 + 0.05, y: lineY + 0.65, w: nodeW - 0.1, h: 0.35,
                fontSize: f.small, color: this.color('textSecondary'), align: 'center'
            });
        });
    }

    renderEnd(slide, data) {
        const p = this.PADDING_LARGE;
        const f = this.fonts;
        slide.background = { color: this.color('dark') };

        slide.addShape('rect', {
            x: 0, y: 0, w: '100%', h: '100%',
            fill: { type: 'solid', color: this.color('darkSecondary'), transparency: 50 },
            line: { color: 'FFFFFF', transparency: 100 }
        });

        slide.addShape('ellipse', {
            x: this.SLIDE_W - 3.5, y: -1.4, w: 4.6, h: 4.6,
            fill: { type: 'solid', color: 'FFFFFF', transparency: 95 },
            line: { color: 'FFFFFF', transparency: 100 }
        });

        const centerY = this.SLIDE_H * 0.38;
        this.addText(slide,data.title, {
            x: p, y: centerY, w: this.CONTENT_W, h: 0.7,
            fontSize: f.coverTitle, color: 'FFFFFF', bold: true, align: 'left'
        });
        this.addText(slide,data.subtitle || '', {
            x: p, y: centerY + 0.7, w: this.CONTENT_W, h: 0.4,
            fontSize: f.coverSubtitle, color: 'FFFFFF', transparency: 30, align: 'left'
        });
        if (data.email) {
            this.addText(slide,data.email, {
                x: p, y: centerY + 1.2, w: this.CONTENT_W, h: 0.3,
                fontSize: f.bodySmall, color: 'FFFFFF', transparency: 50, align: 'left'
            });
        }
        this.addText(slide,'Generated by Paper Burner X', {
            x: p, y: this.SLIDE_H - 0.5, w: this.CONTENT_W, h: 0.25,
            fontSize: f.small, color: 'FFFFFF', transparency: 60, align: 'left'
        });
    }

    renderList(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        this.addText(slide, data.title, {
            x: p, y: p, w: this.CONTENT_W, h: 0.5,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });

        if (data.items && data.items.length > 0) {
            const listY = p + 0.7;
            const items = data.items.map(item => ({
                text: item,
                options: { fontSize: f.body, color: this.color('textSecondary'), breakLine: true }
            }));
            this.addText(slide,items, {
                x: p, y: listY, w: this.CONTENT_W, h: this.SLIDE_H - listY - p,
                bullet: { type: 'bullet', code: '2022' },
                lineSpacing: 32, valign: 'top'
            });
        }
    }

    renderContent(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        const titleH = 0.5;
        const contentH = 1.2;
        const totalH = titleH + 0.2 + contentH;
        const startY = (this.SLIDE_H - totalH) / 2;

        this.addText(slide,data.title, {
            x: p, y: startY, w: this.CONTENT_W, h: titleH,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });
        this.addText(slide,data.content || '', {
            x: p, y: startY + titleH + 0.2, w: this.CONTENT_W, h: contentH,
            fontSize: f.body, color: this.color('textSecondary'), lineSpacing: 26
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // Freeform 自由布局渲染 (PPTX)
    // ═══════════════════════════════════════════════════════════════

    renderFreeform(slide, data) {
        // 背景
        if (data.backgroundGradient) {
            // 解析渐变 "linear-gradient(135deg, #ff6b6b 0%, #feca57 100%)"
            // 支持多种格式
            const gradMatch = data.backgroundGradient.match(/linear-gradient\((\d+)deg,\s*([^,]+?)(?:\s+\d+%)?,\s*([^,)]+?)(?:\s+\d+%)?(?:,\s*([^)]+))?\)/);
            if (gradMatch) {
                const angle = parseInt(gradMatch[1]) || 135;
                const color1 = this.safeColor(gradMatch[2]) || '4f46e5';
                const color2 = this.safeColor(gradMatch[3]) || '3b82f6';

                // PptxGenJS 渐变方向映射 (CSS deg → PPTX rotation)
                // CSS: 0deg = 向上, 90deg = 向右, 135deg = 右下
                // PPTX: 0 = 向右, 90 = 向下, 180 = 向左, 270 = 向上
                const cssToOoxml = (cssDeg) => {
                    return (90 - cssDeg + 360) % 360;
                };

                // PptxGenJS 渐变背景格式 - 使用纯色
                slide.background = { color: color1 };
            } else {
                // 解析失败，尝试提取第一个颜色
                const colorMatch = data.backgroundGradient.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/);
                slide.background = { color: colorMatch ? colorMatch[1] : 'FFFFFF' };
            }
        } else if (data.backgroundImage) {
            try {
                slide.background = { path: data.backgroundImage };
            } catch (e) {
                slide.background = { color: 'FFFFFF' };
            }
        } else {
            slide.background = { color: this.safeColor(data.background) || 'FFFFFF' };
        }

        // 按 z-index 排序渲染元素
        const elements = (data.elements || []).sort((a, b) => (a.z || 0) - (b.z || 0));

        elements.forEach(el => {
            this.renderFreeformElementPPTX(slide, el);
        });
    }

    /**
     * 解析坐标值为英寸 (PPTX 单位)
     */
    parseCoordToInch(value, totalInch) {
        if (typeof value === 'number') return value;
        const str = String(value).trim();
        if (str.endsWith('%')) {
            return (parseFloat(str) / 100) * totalInch;
        } else if (str.endsWith('in')) {
            return parseFloat(str);
        } else if (str.endsWith('px')) {
            return parseFloat(str) / this.styles.dimensions.pxPerInch;
        } else if (str === 'auto') {
            return null;
        }
        return parseFloat(str) / this.styles.dimensions.pxPerInch || 0;
    }

    /**
     * 渲染单个自由元素到 PPTX
     */
    renderFreeformElementPPTX(slide, el) {
        const x = this.parseCoordToInch(el.x, this.SLIDE_W);
        const y = this.parseCoordToInch(el.y, this.SLIDE_H);
        const w = this.parseCoordToInch(el.w, this.SLIDE_W);
        const h = this.parseCoordToInch(el.h, this.SLIDE_H);

        try {
            switch (el.type) {
                case 'text':
                    this.renderFreeformTextPPTX(slide, el, x, y, w, h);
                    break;
                case 'shape':
                    this.renderFreeformShapePPTX(slide, el, x, y, w, h);
                    break;
                case 'image':
                    this.renderFreeformImagePPTX(slide, el, x, y, w, h);
                    break;
                case 'icon':
                    this.renderFreeformIconPPTX(slide, el, x, y, w, h);
                    break;
                case 'line':
                    this.renderFreeformLinePPTX(slide, el);
                    break;
                case 'chart':
                    this.renderFreeformChartPPTX(slide, el, x, y, w, h);
                    break;
                case 'formula':
                    this.renderFreeformFormulaPPTX(slide, el, x, y, w, h);
                    break;
                case 'group':
                    // 递归渲染子元素
                    (el.children || []).forEach(child => {
                        this.renderFreeformElementPPTX(slide, child);
                    });
                    break;
                case 'card':
                    this.renderFreeformCardPPTX(slide, el, x, y, w, h);
                    break;
            }
        } catch (e) {
            console.error(`Error rendering freeform element type "${el.type}":`, e);
            console.error('Element data:', JSON.stringify(el, null, 2));
            throw e;
        }
    }

    renderFreeformTextPPTX(slide, el, x, y, w, h) {
        // AI 输出的 font 是像素值，需要转换为点 (pt)
        // 标准转换: pt = px * 72 / 96 = px * 0.75
        // 但实测 PPTX 渲染略大，所以用 0.72 微调
        const fontSizePx = el.font || 18;
        const fontSize = Math.round(fontSizePx * 0.72);

        // 处理 HTML 内容，转换为 PptxGenJS 支持的格式
        let textContent = el.content || '';
        textContent = textContent
            .replace(/\r?\n/g, ' ')                  // 先把源码中的换行符替换为空格
            .replace(/<br\s*\/?>/gi, '\n')           // <br> -> 换行
            .replace(/<\/?(strong|b)>/gi, '')        // 移除 strong/b 标签
            .replace(/<\/?(em|i)>/gi, '')            // 移除 em/i 标签
            .replace(/<[^>]+>/g, '')                 // 移除其他 HTML 标签
            .replace(/&nbsp;/g, ' ')                 // HTML 空格
            .replace(/&amp;/g, '&')                  // &
            .replace(/&lt;/g, '<')                   // <
            .replace(/&gt;/g, '>')                   // >
            .replace(/&quot;/g, '"')                 // "
            .replace(/&#39;/g, "'")                  // '
            .replace(/[ \t]+/g, ' ')                 // 多个空格/制表符合并（保留换行）
            .replace(/ ?\n ?/g, '\n')                // 清理换行符周围的空格
            .trim();                                 // 去除首尾空白

        // 计算合适的高度 - 根据字号和行数估算
        const lineCount = (textContent.match(/\n/g) || []).length + 1;
        const estimatedHeight = (fontSize / 72) * lineCount * 1.5; // pt to inch, 1.5 行高

        const textOptions = {
            x: x || 0,
            y: y || 0,
            w: w || 2,
            h: h || Math.max(estimatedHeight, 0.4), // 至少 0.4 英寸
            fontSize: fontSize,
            fontFace: this.fontFace, // 思源黑体
            color: this.safeColor(el.color) || '333333',
            bold: el.bold || false,
            italic: el.italic || false,
            align: el.align || 'left',
            valign: el.valign === 'middle' ? 'middle' : el.valign === 'bottom' ? 'bottom' : 'top',
        };

        // 旋转
        if (el.rotate) {
            textOptions.rotate = el.rotate;
        }

        // 透明度
        if (el.opacity !== undefined && el.opacity < 1) {
            textOptions.transparency = Math.round((1 - el.opacity) * 100);
        }

        // 背景
        if (el.bgColor) {
            const bgColor = this.safeColor(el.bgColor);
            if (bgColor) {
                textOptions.fill = { color: bgColor };
            }
        }

        try {
            this.addText(slide, textContent, textOptions);
        } catch (e) {
            console.warn('Failed to add text:', e, textContent, textOptions);
        }
    }

    renderFreeformShapePPTX(slide, el, x, y, w, h) {
        // 形状类型映射
        const shapeTypeMap = {
            'rect': 'rect',
            'circle': 'ellipse',
            'rounded': 'roundRect',
            'triangle': 'triangle',
        };
        const shapeType = shapeTypeMap[el.shape] || 'rect';

        const shapeOptions = {
            x: x || 0,
            y: y || 0,
            w: w || 1,
            h: h || 1,
            fill: { color: this.safeColor(el.fill) || '4f46e5' },
            line: el.stroke ? {
                color: this.safeColor(el.stroke) || 'CCCCCC',
                width: el.strokeWidth || 1
            } : { color: 'FFFFFF', transparency: 100 },
        };

        // 圆角
        if (shapeType === 'roundRect' && el.radius) {
            shapeOptions.rectRadius = el.radius / 96; // px to inch
        }

        // 透明度
        if (el.opacity !== undefined && el.opacity < 1) {
            shapeOptions.fill.transparency = Math.round((1 - el.opacity) * 100);
        }

        // 旋转
        if (el.rotate) {
            shapeOptions.rotate = el.rotate;
        }

        // 阴影 - 暂时禁用，PptxGenJS shadow 格式可能有问题
        // if (el.shadow) {
        //     shapeOptions.shadow = {
        //         type: 'outer',
        //         blur: 4,
        //         offset: 2,
        //         angle: 45,
        //         color: '000000',
        //         opacity: 30
        //     };
        // }

        try {
            slide.addShape(shapeType, shapeOptions);
        } catch (e) {
            console.warn('Failed to add shape:', e, shapeOptions);
        }
    }

    renderFreeformImagePPTX(slide, el, x, y, w, h) {
        if (el.src) {
            try {
                const imgOptions = {
                    path: el.src,
                    x: x || 0,
                    y: y || 0,
                    w: w || 2,
                    h: h || 2,
                };

                // 旋转
                if (el.rotate) {
                    imgOptions.rotate = el.rotate;
                }

                // 圆角 (通过裁剪实现)
                if (el.radius) {
                    imgOptions.rounding = true;
                }

                slide.addImage(imgOptions);
            } catch (e) {
                // 图片加载失败，添加占位符
                this.addImagePlaceholder(slide, x, y, w, h, el.alt);
            }
        } else {
            // 占位符
            this.addImagePlaceholder(slide, x || 0, y || 0, w || 2, h || 2, el.alt);
        }
    }

    renderFreeformIconPPTX(slide, el, x, y, w, h) {
        const iconSize = (el.size || 24) / 72; // pt to inch
        const color = this.safeColor(el.color) || '333333';

        // 尝试使用 SVG 图标（如果已缓存）
        const iconKey = `${el.icon}_${color}`;
        if (this.iconCache && this.iconCache[iconKey]) {
            slide.addImage({
                data: this.iconCache[iconKey],
                x: x || 0,
                y: y || 0,
                w: iconSize,
                h: iconSize,
            });
            return;
        }

        // Fallback: 使用 emoji
        const emoji = this.getIconEmoji(el.icon);
        this.addText(slide,emoji, {
            x: x || 0,
            y: y || 0,
            w: iconSize * 2,
            h: iconSize * 2,
            fontSize: el.size || 24,
            color: color,
            align: 'center',
            valign: 'middle',
        });
    }

    /**
     * 预加载图标为 Base64 图片
     * @param {string} iconName - 图标名称，如 "carbon:rocket"
     * @param {string} color - 颜色，如 "4f46e5"
     * @returns {Promise<string>} Base64 数据 URL
     */
    async preloadIcon(iconName, color = '333333') {
        if (!this.iconCache) this.iconCache = {};

        const iconKey = `${iconName}_${color}`;
        if (this.iconCache[iconKey]) return this.iconCache[iconKey];

        try {
            // 使用 Iconify API 获取 SVG
            const [prefix, name] = iconName.split(':');
            const svgUrl = `https://api.iconify.design/${prefix}/${name}.svg?color=%23${color}`;

            const response = await fetch(svgUrl);
            if (!response.ok) throw new Error('Failed to fetch icon');

            const svgText = await response.text();

            // 转换 SVG 为 Base64
            const base64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
            this.iconCache[iconKey] = base64;

            return base64;
        } catch (e) {
            console.warn(`Failed to preload icon ${iconName}:`, e);
            return null;
        }
    }

    /**
     * 预加载所有幻灯片中的图标
     */
    async preloadAllIcons(slides) {
        const iconPromises = [];

        slides.forEach(slide => {
            if (slide.type === 'freeform' && slide.elements) {
                slide.elements.forEach(el => {
                    if (el.type === 'icon' && el.icon) {
                        const color = this.safeColor(el.color) || '333333';
                        iconPromises.push(this.preloadIcon(el.icon, color));
                    }
                });
            }
        });

        if (iconPromises.length > 0) {
            console.log(`[PPTXSlideRenderer] Preloading ${iconPromises.length} icons...`);
            await Promise.all(iconPromises);
            console.log('[PPTXSlideRenderer] Icons preloaded');
        }
    }

    /**
     * 动态加载 html2canvas 库
     */
    async loadHtml2Canvas() {
        if (typeof html2canvas !== 'undefined') {
            return html2canvas;
        }

        // 动态加载
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
            script.onload = () => {
                console.log('[PPTXSlideRenderer] html2canvas loaded');
                resolve(window.html2canvas);
            };
            script.onerror = () => {
                console.warn('[PPTXSlideRenderer] Failed to load html2canvas');
                reject(new Error('Failed to load html2canvas'));
            };
            document.head.appendChild(script);
        });
    }

    /**
     * 内联 KaTeX 样式以确保 html2canvas 正确渲染
     * 复制计算样式到内联样式，修复 vertical-align 问题
     */
    inlineKatexStylesForExport(container) {
        // 处理所有 KaTeX 元素
        const katexElements = container.querySelectorAll('.katex, .katex *');
        katexElements.forEach(el => {
            const computed = window.getComputedStyle(el);
            const critical = [
                'display', 'position',
                'font-size', 'line-height', 'font-family', 'font-weight', 'font-style',
                'margin', 'padding',
                'width', 'height', 'min-width', 'min-height',
                'top', 'bottom', 'left', 'right',
                'transform', 'color', 'border-bottom', 'border-color'
            ];

            const inlineStyles = [];

            // 特殊处理 vertical-align - html2canvas 不支持 em 单位
            const verticalAlign = computed.getPropertyValue('vertical-align');
            if (verticalAlign && verticalAlign.endsWith('em')) {
                const val = parseFloat(verticalAlign);
                if (!isNaN(val) && val !== 0) {
                    inlineStyles.push('position: relative');
                    inlineStyles.push(`top: ${-val * 1.5}em`);
                    inlineStyles.push('vertical-align: baseline');
                }
            } else if (verticalAlign) {
                inlineStyles.push(`vertical-align: ${verticalAlign}`);
            }

            critical.forEach(prop => {
                const value = computed.getPropertyValue(prop);
                if (value && value !== 'auto' && value !== 'normal' && value !== 'none' &&
                    value !== '0px' && value !== 'rgba(0, 0, 0, 0)') {
                    inlineStyles.push(`${prop}: ${value}`);
                }
            });

            if (inlineStyles.length > 0) {
                const existing = el.getAttribute('style') || '';
                el.setAttribute('style', existing + '; ' + inlineStyles.join('; '));
            }
        });

        // 特殊处理分数线
        const fracLines = container.querySelectorAll('.frac-line');
        fracLines.forEach(el => {
            el.style.borderBottom = '1px solid currentColor';
            el.style.width = '100%';
        });
    }

    /**
     * 将 KaTeX 公式渲染为 Base64 图片
     * 使用 html2canvas 截图方式，确保公式完整渲染
     * @param {string} latex - LaTeX 公式
     * @param {object} options - 渲染选项 { fontSize, color, displayMode }
     * @returns {Promise<{data: string, width: number, height: number}>} Base64 图片数据和尺寸
     */
    async renderFormulaToImage(latex, options = {}) {
        const { fontSize = 24, color = '#333333', displayMode = true } = options;

        // 生成缓存键
        const cacheKey = `formula_${latex}_${fontSize}_${color}_${displayMode}`;
        if (!this.formulaCache) this.formulaCache = {};
        if (this.formulaCache[cacheKey]) {
            return this.formulaCache[cacheKey];
        }

        try {
            // 检查 KaTeX 是否可用
            if (typeof katex === 'undefined') {
                console.warn('[PPTXSlideRenderer] KaTeX not available');
                return null;
            }

            // 确保 html2canvas 已加载
            await this.loadHtml2Canvas();

            // 使用 KaTeX 渲染为 HTML - 使用行内模式，布局更简单
            const katexHtml = katex.renderToString(latex, {
                displayMode: false, // 强制使用行内模式，避免复杂布局
                throwOnError: false,
                output: 'html',
            });

            // 创建渲染容器
            const container = document.createElement('div');
            container.style.cssText = `
                position: absolute;
                left: 0;
                top: 0;
                background: white;
                font-size: ${fontSize}px;
                color: ${color};
                display: inline-block;
                white-space: nowrap;
                padding: 8px;
                line-height: 1.2;
            `;
            container.innerHTML = katexHtml;
            document.body.appendChild(container);

            // 等待 KaTeX 字体加载和渲染
            await new Promise(resolve => setTimeout(resolve, 300));

            // 使用 html2canvas 直接截取整个容器
            const scale = 3;
            const canvas = await html2canvas(container, {
                scale: scale,
                backgroundColor: null,
                logging: false,
                useCORS: true,
                allowTaint: true,
            });

            // 清理容器
            document.body.removeChild(container);

            // 转换为 Base64
            const dataUrl = canvas.toDataURL('image/png');

            // 使用 canvas 实际尺寸计算英寸（考虑 scale）
            const actualCanvasW = canvas.width / scale;
            const actualCanvasH = canvas.height / scale;

            const result = {
                data: dataUrl,
                width: actualCanvasW / this.styles.dimensions.pxPerInch,
                height: actualCanvasH / this.styles.dimensions.pxPerInch,
            };

            this.formulaCache[cacheKey] = result;
            console.log(`[PPTXSlideRenderer] Formula rendered: ${latex.substring(0, 30)}... canvas=${canvas.width}x${canvas.height}px, display=${actualCanvasW}x${actualCanvasH}px, inch=${result.width.toFixed(2)}x${result.height.toFixed(2)}`);

            return result;

        } catch (e) {
            console.warn('[PPTXSlideRenderer] Failed to render formula:', e);
            return null;
        }
    }

    /**
     * 内联 KaTeX 样式用于截图
     * 确保所有关键样式都内联，避免 html2canvas 丢失样式
     */
    inlineKatexStylesForCapture(container) {
        // 递归处理所有元素
        const processElement = (el) => {
            if (el.nodeType !== 1) return; // 只处理元素节点

            const computed = window.getComputedStyle(el);
            const styles = [];

            // 关键样式属性 - 不包含 height, max-height, overflow 等可能导致裁剪的属性
            const props = [
                'display', 'position', 'top', 'left', 'right', 'bottom',
                'width', 'min-width',
                'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
                'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
                'font-family', 'font-size', 'font-weight', 'font-style',
                'line-height', 'text-align', 'vertical-align',
                'color',
                'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
                'border-width', 'border-style', 'border-color',
                'transform', 'opacity',
                'box-sizing',
            ];

            props.forEach(prop => {
                const value = computed.getPropertyValue(prop);
                if (value && value !== 'none' && value !== 'auto' && value !== 'normal' &&
                    value !== '0px' && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') {
                    styles.push(`${prop}: ${value}`);
                }
            });

            // 特殊处理 vertical-align（KaTeX 大量使用）
            const va = computed.getPropertyValue('vertical-align');
            if (va && va !== 'baseline') {
                // 将 em 单位转换为 px
                if (va.endsWith('em')) {
                    const emVal = parseFloat(va);
                    const fontSizePx = parseFloat(computed.getPropertyValue('font-size'));
                    const pxVal = emVal * fontSizePx;
                    styles.push(`vertical-align: ${pxVal}px`);
                } else {
                    styles.push(`vertical-align: ${va}`);
                }
            }

            // 应用内联样式
            if (styles.length > 0) {
                el.style.cssText = styles.join('; ') + ';';
            }

            // 递归处理子元素
            Array.from(el.children).forEach(processElement);
        };

        processElement(container);

        // 特殊处理分数线
        container.querySelectorAll('.frac-line').forEach(el => {
            const computed = window.getComputedStyle(el);
            el.style.borderBottomWidth = computed.borderBottomWidth || '1px';
            el.style.borderBottomStyle = 'solid';
            el.style.borderBottomColor = computed.color || 'currentColor';
            el.style.width = '100%';
            el.style.display = 'block';
        });

        // 特殊处理根号
        container.querySelectorAll('.sqrt-line').forEach(el => {
            el.style.borderTopWidth = '1px';
            el.style.borderTopStyle = 'solid';
        });
    }

    /**
     * 预加载所有幻灯片中的公式为图片
     */
    async preloadAllFormulas(slides) {
        const formulaPromises = [];

        slides.forEach(slide => {
            if (slide.type === 'freeform' && slide.elements) {
                slide.elements.forEach(el => {
                    if (el.type === 'formula' && el.latex) {
                        formulaPromises.push(
                            this.renderFormulaToImage(el.latex, {
                                fontSize: el.font || 24,
                                color: el.color || '#333333',
                                displayMode: el.displayMode !== false,
                            })
                        );
                    }
                });
            }
        });

        if (formulaPromises.length > 0) {
            console.log(`[PPTXSlideRenderer] Preloading ${formulaPromises.length} formulas...`);
            await Promise.all(formulaPromises);
            console.log('[PPTXSlideRenderer] Formulas preloaded');
        }
    }

    /**
     * 渲染图表到 PPTX (使用 PptxGenJS 原生图表)
     */
    renderFreeformChartPPTX(slide, el, x, y, w, h) {
        const data = this.parseChartDataPPTX(el.chartData);
        if (!data.length) return;

        const colors = (el.colors || '#4f46e5,#10b981,#f59e0b,#ec4899,#6366f1')
            .split(',')
            .map(c => this.safeColor(c.trim()) || '4f46e5');

        const chartType = el.chartType || 'bar';

        // PptxGenJS 图表类型映射
        const chartTypeMap = {
            'bar': 'bar',
            'line': 'line',
            'pie': 'pie',
            'doughnut': 'doughnut',
        };

        const pptxChartType = chartTypeMap[chartType] || 'bar';

        // 构建图表数据
        const chartData = [{
            name: el.title || 'Data',
            labels: data.map(d => d.label),
            values: data.map(d => d.value),
        }];

        const chartOptions = {
            x: x || 0.5,
            y: y || 0.5,
            w: w || 4,
            h: h || 3,
            chartColors: colors,
            showTitle: !!el.title,
            title: el.title || '',
            showLegend: false,
        };

        // 根据图表类型添加特定选项
        if (pptxChartType === 'bar') {
            chartOptions.barDir = 'bar';
            chartOptions.barGrouping = 'clustered';
        } else if (pptxChartType === 'pie' || pptxChartType === 'doughnut') {
            chartOptions.showPercent = true;
            if (pptxChartType === 'doughnut') {
                chartOptions.holeSize = 50;
            }
        }

        try {
            slide.addChart(pptxChartType, chartData, chartOptions);
        } catch (e) {
            console.warn('Failed to add chart, using placeholder:', e);
            // Fallback: 添加占位符
            slide.addShape('roundRect', {
                x: x || 0.5,
                y: y || 0.5,
                w: w || 4,
                h: h || 3,
                fill: { color: 'F8FAFC' },
                line: { color: 'E2E8F0', width: 1 },
            });
            this.addText(slide,`📊 ${el.title || 'Chart'}`, {
                x: x || 0.5,
                y: y || 0.5,
                w: w || 4,
                h: h || 3,
                fontSize: 14,
                color: '64748B',
                align: 'center',
                valign: 'middle',
            });
        }
    }

    parseChartDataPPTX(dataStr) {
        if (!dataStr) return [];
        return dataStr.split(',').map(item => {
            const parts = item.split(':');
            return {
                label: parts[0]?.trim() || '',
                value: parseFloat(parts[1]) || 0
            };
        });
    }

    renderFreeformLinePPTX(slide, el) {
        let x1 = this.parseCoordToInch(el.x1, this.SLIDE_W) || 0;
        let y1 = this.parseCoordToInch(el.y1, this.SLIDE_H) || 0;
        let x2 = this.parseCoordToInch(el.x2, this.SLIDE_W) || this.SLIDE_W;
        let y2 = this.parseCoordToInch(el.y2, this.SLIDE_H) || y1;

        // 确保 w 和 h 非负（PptxGenJS 要求）
        if (x2 < x1) { [x1, x2] = [x2, x1]; }
        if (y2 < y1) { [y1, y2] = [y2, y1]; }

        // 避免零宽度/高度的线条
        const w = Math.max(x2 - x1, 0.01);
        const h = Math.max(y2 - y1, 0.01);

        const lineOptions = {
            x: x1,
            y: y1,
            w: w,
            h: h,
            line: {
                color: this.safeColor(el.stroke) || 'CCCCCC',
                width: el.strokeWidth || 2,
            }
        };

        // 虚线
        if (el.dash) {
            lineOptions.line.dashType = 'dash';
        }

        try {
            slide.addShape('line', lineOptions);
        } catch (e) {
            console.warn('Failed to add line:', e, lineOptions);
        }
    }

    /**
     * 渲染数学公式到 PPTX
     * 优先使用预渲染的图片，fallback 到 Unicode 文本
     */
    renderFreeformFormulaPPTX(slide, el, x, y, w, h) {
        const fontSizePx = el.font || 24;
        const color = el.color || '#333333';

        // 直接使用 Unicode 文本渲染公式（html2canvas 对 KaTeX 支持不好）
        const fontSize = Math.round(fontSizePx * 0.72);
        let displayText = this.latexToUnicode(el.latex || '');

        console.log('[PPTX Formula] Using Unicode text:', el.latex?.substring(0, 30), '->', displayText?.substring(0, 30));

        const textOptions = {
            x: x || 0,
            y: y || 0,
            w: w || 2,
            h: h || 0.5,
            fontSize: fontSize,
            fontFace: 'Cambria Math',
            color: this.safeColor(color) || '333333',
            align: el.align || 'center',
            valign: 'middle',
        };

        if (el.rotate) {
            textOptions.rotate = el.rotate;
        }

        if (el.opacity !== undefined && el.opacity < 1) {
            textOptions.transparency = Math.round((1 - el.opacity) * 100);
        }

        try {
            this.addText(slide, displayText, textOptions);
        } catch (e) {
            console.warn('Failed to add formula:', e, displayText);
        }
    }

    /**
     * LaTeX 转 Unicode 映射
     * 用于 PPTX 导出时的显示
     * 使用 Unicode 数学字符尽量还原公式外观
     */
    latexToUnicode(latex) {
        if (!latex) return '';

        let result = latex;

        // 首先标准化反斜杠：将双反斜杠转为单反斜杠
        result = result.replace(/\\\\/g, '\\');

        // Unicode 上标字符映射
        const superscripts = {
            '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
            '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
            '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
            'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ', 'y': 'ʸ',
            'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ',
            'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'j': 'ʲ', 'k': 'ᵏ',
            'l': 'ˡ', 'm': 'ᵐ', 'o': 'ᵒ', 'p': 'ᵖ', 'r': 'ʳ',
            's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ', 'v': 'ᵛ', 'w': 'ʷ', 'z': 'ᶻ',
            'N': 'ᴺ', '/': 'ᐟ',
        };

        // Unicode 下标字符映射
        const subscripts = {
            '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
            '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
            '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
            'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ',
            'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'o': 'ₒ',
            'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ',
            'v': 'ᵥ', 'x': 'ₓ',
            'th': 'ₜₕ',
        };

        // 转换上标内容
        const toSuperscript = (str) => {
            return str.split('').map(c => superscripts[c] || c).join('');
        };

        // 转换下标内容
        const toSubscript = (str) => {
            return str.split('').map(c => subscripts[c] || c).join('');
        };

        const replacements = [
            // 量子态 bra-ket 记号
            [/\|([^|⟩\s{}]+)\\rangle/g, '|$1⟩'],
            [/\\langle([^|⟨\s{}]+)\|/g, '⟨$1|'],
            [/\\ket\{([^}]*)\}/g, '|$1⟩'],
            [/\\bra\{([^}]*)\}/g, '⟨$1|'],
            [/\\rangle/g, '⟩'],
            [/\\langle/g, '⟨'],
            [/\\vert/g, '|'],

            // 分数 - 使用斜杠表示
            [/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)'],

            // 根号
            [/\\sqrt\[(\d+)\]\{([^}]*)\}/g, '∜($2)'], // n次根号简化
            [/\\sqrt\{([^}]*)\}/g, '√($1)'],
            [/\\sqrt/g, '√'],

            // 希腊字母（小写）
            [/\\alpha/g, 'α'], [/\\beta/g, 'β'], [/\\gamma/g, 'γ'], [/\\delta/g, 'δ'],
            [/\\epsilon/g, 'ε'], [/\\varepsilon/g, 'ε'], [/\\zeta/g, 'ζ'], [/\\eta/g, 'η'],
            [/\\theta/g, 'θ'], [/\\vartheta/g, 'ϑ'], [/\\iota/g, 'ι'], [/\\kappa/g, 'κ'],
            [/\\lambda/g, 'λ'], [/\\mu/g, 'μ'], [/\\nu/g, 'ν'], [/\\xi/g, 'ξ'],
            [/\\pi/g, 'π'], [/\\varpi/g, 'ϖ'], [/\\rho/g, 'ρ'], [/\\varrho/g, 'ϱ'],
            [/\\sigma/g, 'σ'], [/\\varsigma/g, 'ς'], [/\\tau/g, 'τ'], [/\\upsilon/g, 'υ'],
            [/\\phi/g, 'φ'], [/\\varphi/g, 'φ'], [/\\chi/g, 'χ'], [/\\psi/g, 'ψ'],
            [/\\omega/g, 'ω'],

            // 希腊字母（大写）
            [/\\Gamma/g, 'Γ'], [/\\Delta/g, 'Δ'], [/\\Theta/g, 'Θ'], [/\\Lambda/g, 'Λ'],
            [/\\Xi/g, 'Ξ'], [/\\Pi/g, 'Π'], [/\\Sigma/g, 'Σ'], [/\\Upsilon/g, 'Υ'],
            [/\\Phi/g, 'Φ'], [/\\Psi/g, 'Ψ'], [/\\Omega/g, 'Ω'],

            // 数学运算符
            [/\\infty/g, '∞'], [/\\pm/g, '±'], [/\\mp/g, '∓'],
            [/\\times/g, '×'], [/\\div/g, '÷'], [/\\cdot/g, '·'], [/\\ast/g, '∗'],
            [/\\star/g, '⋆'], [/\\circ/g, '∘'], [/\\bullet/g, '•'],
            [/\\oplus/g, '⊕'], [/\\otimes/g, '⊗'], [/\\odot/g, '⊙'],

            // 关系运算符
            [/\\leq/g, '≤'], [/\\geq/g, '≥'], [/\\neq/g, '≠'], [/\\ne/g, '≠'],
            [/\\approx/g, '≈'], [/\\equiv/g, '≡'], [/\\sim/g, '∼'], [/\\simeq/g, '≃'],
            [/\\cong/g, '≅'], [/\\propto/g, '∝'], [/\\ll/g, '≪'], [/\\gg/g, '≫'],
            [/\\prec/g, '≺'], [/\\succ/g, '≻'], [/\\preceq/g, '⪯'], [/\\succeq/g, '⪰'],

            // 集合运算符
            [/\\subset/g, '⊂'], [/\\supset/g, '⊃'], [/\\subseteq/g, '⊆'], [/\\supseteq/g, '⊇'],
            [/\\in/g, '∈'], [/\\notin/g, '∉'], [/\\ni/g, '∋'],
            [/\\cup/g, '∪'], [/\\cap/g, '∩'], [/\\setminus/g, '∖'],
            [/\\emptyset/g, '∅'], [/\\varnothing/g, '∅'],

            // 逻辑运算符
            [/\\forall/g, '∀'], [/\\exists/g, '∃'], [/\\nexists/g, '∄'],
            [/\\land/g, '∧'], [/\\lor/g, '∨'], [/\\lnot/g, '¬'], [/\\neg/g, '¬'],
            [/\\implies/g, '⟹'], [/\\iff/g, '⟺'],

            // 微积分
            [/\\nabla/g, '∇'], [/\\partial/g, '∂'],
            [/\\sum/g, '∑'], [/\\prod/g, '∏'], [/\\coprod/g, '∐'],
            [/\\int/g, '∫'], [/\\iint/g, '∬'], [/\\iiint/g, '∭'], [/\\oint/g, '∮'],

            // 箭头
            [/\\rightarrow/g, '→'], [/\\leftarrow/g, '←'], [/\\leftrightarrow/g, '↔'],
            [/\\Rightarrow/g, '⇒'], [/\\Leftarrow/g, '⇐'], [/\\Leftrightarrow/g, '⇔'],
            [/\\uparrow/g, '↑'], [/\\downarrow/g, '↓'], [/\\updownarrow/g, '↕'],
            [/\\to/g, '→'], [/\\gets/g, '←'], [/\\mapsto/g, '↦'],
            [/\\longrightarrow/g, '⟶'], [/\\longleftarrow/g, '⟵'],

            // 括号
            [/\\left\(/g, '('], [/\\right\)/g, ')'],
            [/\\left\[/g, '['], [/\\right\]/g, ']'],
            [/\\left\{/g, '{'], [/\\right\}/g, '}'],
            [/\\left\|/g, '‖'], [/\\right\|/g, '‖'],
            [/\\left</g, '⟨'], [/\\right>/g, '⟩'],
            [/\\lfloor/g, '⌊'], [/\\rfloor/g, '⌋'],
            [/\\lceil/g, '⌈'], [/\\rceil/g, '⌉'],

            // 其他符号
            [/\\hbar/g, 'ℏ'], [/\\ell/g, 'ℓ'], [/\\wp/g, '℘'],
            [/\\Re/g, 'ℜ'], [/\\Im/g, 'ℑ'], [/\\aleph/g, 'ℵ'],
            [/\\prime/g, '′'], [/\\angle/g, '∠'], [/\\perp/g, '⊥'],
            [/\\parallel/g, '∥'], [/\\triangle/g, '△'],
            [/\\square/g, '□'], [/\\diamond/g, '◇'],

            // \text{...} 处理
            [/\\text\{([^}]*)\}/g, '$1'],
            [/\\mathrm\{([^}]*)\}/g, '$1'],
            [/\\mathbf\{([^}]*)\}/g, '$1'],
            [/\\mathit\{([^}]*)\}/g, '$1'],

            // 数学函数名
            [/\\log/g, 'log'], [/\\ln/g, 'ln'], [/\\lg/g, 'lg'],
            [/\\sin/g, 'sin'], [/\\cos/g, 'cos'], [/\\tan/g, 'tan'],
            [/\\cot/g, 'cot'], [/\\sec/g, 'sec'], [/\\csc/g, 'csc'],
            [/\\arcsin/g, 'arcsin'], [/\\arccos/g, 'arccos'], [/\\arctan/g, 'arctan'],
            [/\\sinh/g, 'sinh'], [/\\cosh/g, 'cosh'], [/\\tanh/g, 'tanh'],
            [/\\exp/g, 'exp'], [/\\lim/g, 'lim'], [/\\max/g, 'max'], [/\\min/g, 'min'],
            [/\\sup/g, 'sup'], [/\\inf/g, 'inf'], [/\\det/g, 'det'], [/\\dim/g, 'dim'],

            // 移除其他未知 LaTeX 命令
            [/\\[a-zA-Z]+/g, ''],
        ];

        // 应用基本替换
        for (const [pattern, replacement] of replacements) {
            result = result.replace(pattern, replacement);
        }

        // 处理上标 ^{...} 和 ^x
        result = result.replace(/\^\{([^}]+)\}/g, (match, content) => toSuperscript(content));
        result = result.replace(/\^([0-9a-zA-Z+\-])/g, (match, char) => toSuperscript(char));

        // 处理下标 _{...} 和 _x
        result = result.replace(/_\{([^}]+)\}/g, (match, content) => toSubscript(content));
        result = result.replace(/_([0-9a-zA-Z+\-])/g, (match, char) => toSubscript(char));

        // 清理花括号
        result = result.replace(/\{([^{}]*)\}/g, '$1');
        result = result.replace(/[{}]/g, '');

        // 清理多余空格
        result = result.replace(/\s+/g, ' ').trim();

        return result;
    }

    /**
     * 渲染卡片组件到 PPTX - 自动布局图标+标题+描述
     * 将卡片分解为背景形状 + 图标 + 文字元素
     */
    renderFreeformCardPPTX(slide, el, x, y, w, h) {
        const layout = el.layout || 'horizontal';
        const padding = (el.padding || 16) / this.styles.dimensions.pxPerInch; // px to inch
        const radius = (el.radius || 12) / this.styles.dimensions.pxPerInch;

        // 1. 渲染背景形状
        const bgOptions = {
            x: x || 0,
            y: y || 0,
            w: w || 2,
            h: h || 1,
            fill: { color: this.safeColor(el.fill) || 'FFFFFF' },
            line: el.stroke ? {
                color: this.safeColor(el.stroke) || 'E2E8F0',
                width: el.strokeWidth || 1
            } : { color: 'FFFFFF', transparency: 100 },
        };

        if (radius > 0) {
            bgOptions.rectRadius = radius;
        }

        try {
            slide.addShape(radius > 0 ? 'roundRect' : 'rect', bgOptions);
        } catch (e) {
            console.warn('Failed to add card background:', e);
        }

        // 计算内部布局
        const innerX = x + padding;
        const innerY = y + padding;
        const innerW = w - padding * 2;
        const innerH = h - padding * 2;

        const iconSize = (el.iconSize || 24) / this.styles.dimensions.pxPerInch;
        const iconBgSize = iconSize * 1.5;
        const gap = 0.12; // 12px gap in inches

        // px to pt 转换（与 renderFreeformTextPPTX 保持一致）
        const titleSize = Math.round((el.titleSize || 16) * 0.72);
        const subtitleSize = Math.round((el.subtitleSize || 13) * 0.72);

        if (layout === 'vertical') {
            // 垂直布局：图标在上，文字在下，居中
            const contentH = iconBgSize + gap + 0.3 + (el.subtitle ? 0.25 : 0);
            const startY = innerY + (innerH - contentH) / 2;

            // 图标背景（如果有）
            if (el.icon && el.iconBg) {
                const iconBgX = innerX + (innerW - iconBgSize) / 2;
                slide.addShape('roundRect', {
                    x: iconBgX,
                    y: startY,
                    w: iconBgSize,
                    h: iconBgSize,
                    fill: { color: this.safeColor(el.iconBg) },
                    line: { color: 'FFFFFF', transparency: 100 },
                    rectRadius: iconBgSize / 4,
                });
            }

            // 图标（用 emoji fallback）
            if (el.icon) {
                const emoji = this.getIconEmoji(el.icon);
                this.addText(slide, emoji, {
                    x: innerX,
                    y: startY,
                    w: innerW,
                    h: iconBgSize,
                    fontSize: Math.round(el.iconSize || 24),
                    color: this.safeColor(el.iconColor) || '4f46e5',
                    align: 'center',
                    valign: 'middle',
                });
            }

            // 标题
            if (el.title) {
                this.addText(slide, el.title, {
                    x: innerX,
                    y: startY + iconBgSize + gap,
                    w: innerW,
                    h: 0.3,
                    fontSize: titleSize,
                    color: this.safeColor(el.titleColor) || '1f2937',
                    bold: el.titleBold !== false,
                    align: 'center',
                    valign: 'top',
                });
            }

            // 副标题
            if (el.subtitle) {
                this.addText(slide, el.subtitle, {
                    x: innerX,
                    y: startY + iconBgSize + gap + 0.3,
                    w: innerW,
                    h: 0.25,
                    fontSize: subtitleSize,
                    color: this.safeColor(el.subtitleColor) || '6b7280',
                    align: 'center',
                    valign: 'top',
                });
            }
        } else {
            // 水平布局（horizontal 或 icon-right）
            const isIconRight = layout === 'icon-right';
            const iconAreaW = el.icon ? iconBgSize + gap : 0;
            const textAreaW = innerW - iconAreaW;
            const textX = isIconRight ? innerX : innerX + iconAreaW;
            const iconX = isIconRight ? innerX + textAreaW + gap : innerX;

            // 图标背景（如果有）
            if (el.icon && el.iconBg) {
                const iconBgY = innerY + (innerH - iconBgSize) / 2;
                slide.addShape('roundRect', {
                    x: iconX,
                    y: iconBgY,
                    w: iconBgSize,
                    h: iconBgSize,
                    fill: { color: this.safeColor(el.iconBg) },
                    line: { color: 'FFFFFF', transparency: 100 },
                    rectRadius: iconBgSize / 4,
                });
            }

            // 图标
            if (el.icon) {
                const emoji = this.getIconEmoji(el.icon);
                this.addText(slide, emoji, {
                    x: iconX,
                    y: innerY,
                    w: iconBgSize,
                    h: innerH,
                    fontSize: Math.round(el.iconSize || 24),
                    color: this.safeColor(el.iconColor) || '4f46e5',
                    align: 'center',
                    valign: 'middle',
                });
            }

            // 文字区域 - 标题和副标题
            const hasSubtitle = !!el.subtitle;
            const titleH = hasSubtitle ? innerH * 0.5 : innerH;
            const subtitleH = innerH * 0.5;

            // 标题
            if (el.title) {
                this.addText(slide, el.title, {
                    x: textX,
                    y: innerY,
                    w: textAreaW - gap,
                    h: titleH,
                    fontSize: titleSize,
                    color: this.safeColor(el.titleColor) || '1f2937',
                    bold: el.titleBold !== false,
                    align: 'left',
                    valign: hasSubtitle ? 'bottom' : 'middle',
                });
            }

            // 副标题
            if (el.subtitle) {
                this.addText(slide, el.subtitle, {
                    x: textX,
                    y: innerY + titleH,
                    w: textAreaW - gap,
                    h: subtitleH,
                    fontSize: subtitleSize,
                    color: this.safeColor(el.subtitleColor) || '6b7280',
                    align: 'left',
                    valign: 'top',
                });
            }
        }
    }
}

// ============================================================
// 5. 导出
// ============================================================
window.SlideStyles = SlideStyles;
window.SlideParser = SlideParser;
window.HTMLSlideRenderer = HTMLSlideRenderer;
window.PPTXSlideRenderer = PPTXSlideRenderer;

// 便捷方法
window.SlideSystem = {
    styles: SlideStyles,

    /**
     * 从 HTML 解析并渲染
     */
    parseAndRender(html, targetElement) {
        const slides = SlideParser.parse(html);
        const renderer = new HTMLSlideRenderer();
        targetElement.innerHTML = renderer.renderAll(slides);
        return slides;
    },

    /**
     * 从 HTML 解析并导出 PPTX
     */
    async parseAndExport(html, filename = 'presentation.pptx') {
        const slides = SlideParser.parse(html);
        const renderer = new PPTXSlideRenderer();
        return renderer.render(slides, filename);
    },

    /**
     * 从 Schema 渲染 HTML
     */
    renderHTML(slides) {
        const renderer = new HTMLSlideRenderer();
        return renderer.renderAll(slides);
    },

    /**
     * 从 Schema 导出 PPTX
     */
    async exportPPTX(slides, filename = 'presentation.pptx') {
        const renderer = new PPTXSlideRenderer();
        return renderer.render(slides, filename);
    }
};

console.log('SlideSystem loaded - HTML ↔ PPTX unified rendering');
