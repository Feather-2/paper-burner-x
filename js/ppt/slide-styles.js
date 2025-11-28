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
