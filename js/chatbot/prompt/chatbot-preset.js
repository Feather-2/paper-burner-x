// chatbot-preset.js


/**
 * @const {Array<string>} PRESET_QUESTIONS
 * 预设问题列表，用于在聊天机器人界面快速提问。
 * 这些问题通常是针对当前文档内容的常见查询。
 */

const PRESET_QUESTIONS = [
  '总结本文', '有哪些关键公式？', '研究背景与意义？', '研究方法及发现？',
  '应用与前景？', '用通俗语言解释全文', '生成思维导图🧠', '生成流程图🔄',
  '生成更多配图🎨'
];

/**
 * @const {string} MERMAID_FLOWCHART_PROMPT
 * Mermaid 流程图生成的提示词模板
 */
const MERMAID_FLOWCHART_PROMPT = `
请用Mermaid语法输出流程图，节点用[]包裹，箭头用-->连接。
- 每一条流程图语句必须单独一行，不能多条语句写在一行。
- 节点内容必须全部在一行内，不能有任何换行、不能有 <br>、不能有 \\n。
- **节点标签内禁止使用特殊符号**：不能包含 [ ] ( ) | { } < > 等符号，如需表示请用中文或文字描述。
  * ❌ 错误：D[PET成像 [11C]K-2] （包含方括号）
  * ✓ 正确：D[PET成像 11C-K-2] 或 D[PET成像使用11C标记的K-2]
- 不允许在节点内容中出现任何 HTML 标签，只能用纯文本。
- **每个节点都必须有连线，不能有孤立节点。**
- **节点定义后不要重复节点ID**：A[文本] --> B 而不是 A[文本]A --> B
- 如果文档内容有分支、并行、循环等，请在流程图中体现出来，不要只画一条直线。
- 如需使用subgraph，必须严格遵守Mermaid语法，subgraph必须单独一行，内容缩进，最后用end结束。
- 只输出代码块，不要解释，不要输出除代码块以外的任何内容。
- 例如：
\`\`\`mermaid
graph TD
A[开始] --> B{条件判断}
B -- 是 --> C[处理1]
B -- 否 --> D[处理2]
subgraph 参与者流程
  C --> E[结束]
  D --> E
end
\`\`\`
`;

/**
 * @const {string} MINDMAP_PROMPT
 * 思维导图生成的提示词模板
 */
const MINDMAP_PROMPT = `
请注意：用户请求生成思维导图。请按照以下Markdown格式返回思维导图结构：
# 文档主题（根节点）
## 一级主题1
### 二级主题1.1
### 二级主题1.2
## 一级主题2
### 二级主题2.1
#### 三级主题2.1.1

只需提供思维导图的结构，不要添加额外的解释。结构应该清晰反映文档的层次关系和主要内容。
`;

/**
 * @const {string} DRAWIO_PICTURES_PROMPT
 * draw.io 配图生成的提示词模板（配合 [加入配图] 前缀使用）。
 */
const DRAWIO_PICTURES_PROMPT = `
你现在处于「配图生成模式」，本轮对话中不要充当通用问答助手，只充当 diagrams.net / draw.io 图形生成器。

请根据当前文章内容和用户要求，为读者补充所需的配图。
用户会在问题中自行说明需要哪类配图（例如：整体结构、方法流程、实验设置、变量关系、对比分析等），请充分理解后再设计图形。

**🎯 核心要求（优先级最高）：**
1. **XML 结构完整**（最关键，否则无法解析）：
   - 所有开始标签必须有对应的结束标签
   - 结束标签顺序：</root> → </mxGraphModel> → </diagram> → </mxfile>
   - 不能缺少任何一个结束标签，否则会导致"Opening and ending tag mismatch"错误
2. **XML 格式正确**：
   - 特殊字符必须转义（" → &quot;, < → &lt;, > → &gt;, & → &amp;）
   - 节点geometry必须有：x, y, width, height, as="geometry"
   - 连线geometry必须有：relative="1", as="geometry"（不要加x,y,width,height）
3. **语言匹配**：节点文本使用用户问题中的语言，或根据用户明确要求的语言输出
4. **必须建立充分的连线关系**：节点之间要有清晰的连接，避免孤立节点，连线数量应接近节点数量
5. **层级关系分明**：使用垂直布局，通过颜色和字体大小区分层级
6. **避免连线交叉**：合理规划节点位置

**⚠️ 关键约束（必须全部遵守）：**

1. **禁止输出任何除 XML 之外的内容**
   - ❌ 禁止添加任何说明文字、解释、注释
   - ❌ 禁止使用 Markdown 格式（不要用 \`\`\`xml）
   - ❌ 禁止使用任何包裹标签（不要用 [xml_content]）
   - ✅ 只能输出纯 XML 内容，从 <?xml 开始，到 </mxfile> 结束

2. **标准 XML 格式（必须严格遵守）**
   - 第一行必须是 XML 声明：<?xml version="1.0" encoding="UTF-8"?>
   - 接下来是完整的 <mxfile> 结构
   - 不要在 XML 前后添加任何其他内容
   - ❌ **所有开始标签必须有对应的结束标签**（标签不匹配会导致解析失败）
   - ✅ **标签闭合顺序必须正确**：先开的后关，后开的先关（LIFO 原则）

3. **XML 结构模板（必须完整输出所有层级）：**

完整的 XML 结构（所有图表类型通用）：
  <?xml version="1.0" encoding="UTF-8"?>
  <mxfile>
    <diagram>
      <mxGraphModel>
        <root>
          <mxCell id="0"/>
          <mxCell id="1" parent="0"/>

          <!-- 在这里添加你的节点和连线 -->
          <mxCell id="2" value="节点1" style="..." vertex="1" parent="1">
            <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
          </mxCell>
          <mxCell id="3" value="节点2" style="..." vertex="1" parent="1">
            <mxGeometry x="300" y="250" width="120" height="60" as="geometry"/>
          </mxCell>
          <mxCell id="4" value="" style="..." edge="1" parent="1" source="2" target="3">
            <mxGeometry relative="1" as="geometry"/>
          </mxCell>

        </root>  <!-- 必须有此结束标签 -->
      </mxGraphModel>  <!-- 必须有此结束标签 -->
    </diagram>  <!-- 必须有此结束标签 -->
  </mxfile>  <!-- 必须有此结束标签 -->

❌ **常见的结构性错误（绝对不能犯）：**
  - 缺少 </root> 结束标签
  - 缺少 </mxGraphModel> 结束标签
  - 缺少 </diagram> 或 </mxfile> 结束标签
  - mxCell 标签没有正确关闭（必须是 <mxCell .../> 或 <mxCell ...>...</mxCell>）
  - 标签嵌套顺序错误（如 <A><B></A></B>，应该是 <A><B></B></A>）

常用节点样式参考（可自由组合）：
  - 矩形框：style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf"
  - 圆角框：style="rounded=1;whiteSpace=wrap;html=1;arcSize=20;fillColor=#d5e8d4;strokeColor=#82b366"
  - 菱形（决策）：style="rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656"
  - 椭圆：style="ellipse;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00"
  - 圆柱（数据库）：style="shape=cylinder3;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666"
  - 文档形状：style="shape=document;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6"
  - 云形（云服务）：style="ellipse;shape=cloud;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366"

连线样式参考：
  - 直线箭头：style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;strokeWidth=2"
  - 曲线箭头：style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=classic;strokeWidth=2"
  - 虚线：style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;dashed=1;dashPattern=5 5;endArrow=open"
  - 双向箭头：style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;startArrow=block;endArrow=block;strokeWidth=2"

层级关系示例（垂直布局）：
  - 顶层节点：<mxGeometry x="300" y="100" width="280" height="60"/>（Y=100）
  - 中层节点：<mxGeometry x="200" y="250" width="200" height="70"/>（Y=250，间距150）
  - 底层节点：<mxGeometry x="300" y="400" width="280" height="60"/>（Y=400，间距150）

从上到下的连线：exitX=0.5;exitY=1;entryX=0.5;entryY=0（从底部出发，顶部进入）

💡 灵活创作提示：
  - 根据内容选择合适的节点形状（流程图、架构图、网络图等）
  - 可以使用 swimlane 创建泳道图
  - 可以组合多种颜色和形状，但保持视觉一致性
  - 优先保证层级清晰和连线整洁，样式可以灵活调整

**生成规则：**
- 只能修改节点文本、坐标、样式，或增删节点/连线
- 必须保留 <mxfile> / <diagram> / <mxGraphModel> / <root> / id="0" / id="1" 等固定结构
- 属性值中不要包含换行符，用空格代替
- 节点数量通常不超过 40 个
- 确保每个 <mxCell> 要么是 vertex="1"（节点），要么是 edge="1"（连线）

**🔧 mxGeometry 格式要求（关键 - 避免"Could not add object mxGeometry"错误）：**
- ✅ **节点的 mxGeometry（vertex）必须包含的属性**：
  - x="坐标值" y="坐标值" width="宽度" height="高度" as="geometry"
  - 示例：<mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
  - 所有5个属性都是必需的，不能省略任何一个

- ✅ **连线的 mxGeometry（edge）只需要两个属性**：
  - relative="1" as="geometry"
  - 示例：<mxGeometry relative="1" as="geometry"/>（自闭合标签，没有子元素）
  - 不要给连线的geometry添加 x, y, width, height（会导致错误）
  - ❌ 不要添加 mxPoint 子元素（会导致"Could not add object mxGeometry"错误）
  - draw.io 会根据 source 和 target 自动计算连接点位置

- ❌ **连线的错误示例（会导致"Could not add object mxGeometry"）**：
  - <mxGeometry relative="1" as="geometry"><mxPoint .../></mxGeometry>  ✗（不要添加mxPoint子元素）
  - <mxGeometry as="geometry"/>  ✗（缺少 relative="1"）
  - <mxGeometry x="100" y="100" as="geometry"/>  ✗（连线不要加坐标）
  - exitX=0.5;exitY=1;entryY;arcSize=6  ✗（style属性值格式错误，缺少等号）

- ✅ **连线的连接点控制（放在style中）**：
  - exitX、exitY、entryX、entryY 必须放在 style 属性中，格式：exitX=0.5;exitY=1;entryX=0.5;entryY=0
  - 每个属性都必须有值，不能省略等号或值
  - 示例：style="edgeStyle=orthogonalEdgeStyle;exitX=0.5;exitY=1;entryX=0.5;entryY=0;endArrow=block"

**🔗 连线关系要求（必须遵守）：**
- ❌ **禁止生成孤立节点**：每个节点至少要有一条连线（入边或出边）
- ✅ **合理的连接密度**：连线数量应该接近节点数量（比例约 0.8-1.5）
  - 例如：20个节点应该有 16-30 条连线
  - 如果节点数 > 连线数的1.5倍，说明连线太少，需要补充
- ✅ **体现逻辑关系**：
  - 流程图：按时间顺序或因果关系连接
  - 架构图：上层模块连接到下层实现
  - 网络图：体现数据流或依赖关系
- ✅ **连线必须有意义**：
  - 不要为了凑数量而乱连
  - 每条连线都应该反映真实的逻辑关系
  - 可以添加连线标签说明关系（使用 value 属性）

**🌐 语言输出要求：**
- ✅ **优先使用用户问题中的语言**：如果用户用中文提问，节点文本用中文；用英文提问，节点文本用英文
- ✅ **遵循用户明确指定的语言**：如果用户明确要求"用英文生成"或"用中文生成"，必须遵守
- ✅ **保持语言一致性**：同一张图表中的所有节点应使用相同语言（专有名词、缩写除外）
- ❌ **避免不必要的混用**：不要在同一节点中混用多种语言

**布局优化要求（避免混乱和重叠）：**
- ✅ **网格对齐**：所有 x, y 坐标必须是 10 的倍数（如 80, 100, 420）
- ✅ **充足间距**：节点之间至少保持 30-50px 间距，避免拥挤重叠
- ✅ **清晰布局**：
  - 流程图：优先从左到右或从上到下的单一方向布局
  - 避免连线交叉：合理安排节点位置，减少箭头交叉
  - 画布边距：图表周围保留至少 10% 的留白空间
- ✅ **智能连接**：连接线优先使用 edgeStyle=orthogonalEdgeStyle（正交路由），美观且清晰
- ✅ **统一样式**：相同类型的节点使用相同的颜色和样式，提升专业度

**🔥 层级关系强化要求（重要）：**
- ✅ **垂直层次分明**：
  - 必须使用「从上到下」的垂直布局来体现层级关系
  - 同一层级的节点应放在相同或相近的 Y 坐标（误差不超过 20px）
  - 不同层级之间保持至少 120-150px 的垂直间距，让层次感更明显
  - 上层节点必须在更小的 Y 坐标，下层节点在更大的 Y 坐标
- ✅ **层级视觉区分**：
  - 顶层节点（如标题、总体概念）：使用较大字体（fontSize=16-18）+ 深色背景（如 #1a73e8）
  - 中层节点（如主要步骤、模块）：使用中等字体（fontSize=14）+ 中等色调（如 #4285f4）
  - 底层节点（如细节、子任务）：使用默认字体（fontSize=12）+ 浅色背景（如 #dae8fc）
- ✅ **箭头方向指引**：
  - 从上层到下层的箭头应严格遵循「从上到下」的方向（exitY=1, entryY=0）
  - 同层节点之间的连接可以使用横向箭头（exitX=1/entryX=0 或相反）
  - 避免向上的箭头（除非是反馈循环，需明确标注）
- ✅ **层级标注建议**：
  - 在左侧或右侧添加文本标签标注层级名称（如"输入层"、"处理层"、"输出层"）
  - 可以用不同的背景色区域（swimlane）来划分层级

**🚫 避免连线交叉（关键约束）：**
- ✅ **规划节点位置时优先考虑连线走向**：
  - 在布局节点前，先分析节点之间的连接关系
  - 如果节点 A 同时连接 B 和 C，应将 B、C 放在 A 的同侧，避免交叉
  - 使用「从左到右」或「从右到左」的一致流向，不要混用
- ✅ **同层节点的水平排列规则**：
  - 优先按「连接顺序」排列节点的 X 坐标
  - 如果多个上层节点连接到同一个下层节点，将下层节点放在上层节点的中间位置
  - 避免「交叉连接」：如果 A→C 和 B→D，不要让 A 在 B 右侧而 C 在 D 左侧
- ✅ **使用正交路由减少交叉**：
  - 所有连线必须使用 edgeStyle=orthogonalEdgeStyle（正交路由）
  - 正交路由会自动避让，但前提是节点位置合理
- ✅ **特殊情况处理**：
  - 如果确实无法避免交叉（复杂网络图），应保证交叉点数量最少
  - 交叉时，使用不同的线条样式区分（如虚线 dashed=1 vs 实线）
  - 可以增加中间节点来分解复杂的连接，将一条长连线拆成多段
- ✅ **验证规则**：
  - 生成图表后，从上到下、从左到右检查每条连线
  - 确保任意两条连线之间没有不必要的交叉
  - 如果发现交叉，调整节点的 X 坐标来消除

**🎯 避免连线穿过节点（空间重叠优化）：**
- ✅ **节点布局的最小间距要求**：
  - 同层节点之间的水平间距至少 60px（建议 80-100px）
  - 不同层之间的垂直间距至少 120px（建议 150px）
  - 足够的间距可以为正交路由提供走线空间
- ✅ **连线路径规划**：
  - 使用 edgeStyle=orthogonalEdgeStyle 时，draw.io 会自动绕过节点
  - 但前提是节点位置合理、间距充足
  - 跨层连线（如从第1层到第3层）应避免穿过第2层的节点区域
- ✅ **节点排列优化策略**：
  - **网格对齐**：节点的 X 坐标应该对齐到网格点（如 100, 200, 300...），便于正交路由
  - **列式布局**：相关节点组成垂直列，列与列之间留足空间（200-300px）
  - **避让原则**：如果 A→C 连线会穿过 B，则调整 B 的 X 坐标，让其偏离 A 和 C 的中线
- ✅ **特殊情况处理**：
  - 对于分支较多的节点（如1个节点连接5个下层节点），应将下层节点均匀分布在较宽的区域
  - 对于汇聚节点（如5个上层节点连接到1个下层节点），应将该节点放在上层节点的中心位置
  - 避免"密集区域"：不要让3个以上的节点在同一个 200x200px 的区域内
- ✅ **验证和调整**：
  - 想象连线的路径：垂直下降 → 横向移动 → 垂直上升
  - 确保横向移动的区域没有节点阻挡
  - 如果发现可能的穿过，优先调整节点的 X 坐标而不是改变连接关系

**文本内容要求（避免渲染失败）：**
- ❌ **禁止使用 LaTeX 公式**：不要输出 $x^2$、$$...$$、\\(...\\)、\\[...\\] 等数学公式语法
- ❌ **禁止使用 Markdown 格式**：不要在节点文本中使用 **粗体**、*斜体*、\`代码\`、# 标题 等 Markdown 语法
- ✅ **使用纯文本描述**：
  - ❌ 错误示例："$f(x) = x^2 + 1$"（LaTeX 公式）
  - ✅ 正确示例："函数 f(x) 等于 x 平方加 1"
  - ❌ 错误示例："**重要步骤**"（Markdown 粗体）
  - ✅ 正确示例："重要步骤"（通过 fontStyle=1 或颜色强调）

**⚠️ XML 转义规则（关键 - 避免解析错误）：**
- ❌ **禁止在 value 属性中使用未转义的特殊字符**：
  - 双引号 " 必须替换为 &quot; 或使用单引号包裹整个属性值
  - 小于号 < 必须替换为 &lt;
  - 大于号 > 必须替换为 &gt;
  - 和号 & 必须替换为 &amp;
  - 单引号 ' 在双引号包裹的属性中可以直接使用
- ✅ **正确示例**：
  - value="研究使用 &quot;双盲&quot; 方法" ✓
  - value='研究使用 "双盲" 方法' ✓
  - value="A &lt; B 且 B &gt; C" ✓
  - value="公司 &amp; 组织" ✓
- ❌ **错误示例**：
  - value="研究使用 "双盲" 方法" ✗（会导致解析错误）
  - value="A < B" ✗（会导致解析错误）
- 💡 **建议**：尽量避免在节点文本中使用特殊字符，或者使用文字替代（如"小于"代替"<"）
- 📝 **数学符号的文字替代**（如果必须表示数学关系）：
  - "x 的平方" 或 "x²" 而不是 "$x^2$"
  - "求和" 或 "Σ" 而不是 "$\\sum$"
  - "小于等于" 或 "≤" 而不是 "$\\leq$"
  - "导数 dy/dx" 而不是 "$\\frac{dy}{dx}$"
  - "积分" 或 "∫" 而不是 "$\\int$"
- 💡 **为什么？** draw.io 不支持 LaTeX 渲染，这些语法会显示为原始文本，严重影响图表美观度

**📋 生成前必检清单（输出前请务必检查）：**

在输出 XML 之前，请在脑海中快速检查以下项目：

✅ **结构完整性检查**：
  1. XML 声明行存在：<?xml version="1.0" encoding="UTF-8"?>
  2. 开始标签：<mxfile> → <diagram> → <mxGraphModel> → <root>
  3. 必要的基础节点：<mxCell id="0"/> 和 <mxCell id="1" parent="0"/>
  4. 所有你的节点和连线
  5. 结束标签（关键！）：</root> → </mxGraphModel> → </diagram> → </mxfile>
  6. 每个 <mxCell> 标签都正确关闭（要么自闭合 />, 要么有配对的 </mxCell>）

✅ **格式正确性检查**：
  1. 所有节点都有 5 个必需的 geometry 属性（x, y, width, height, as="geometry"）
  2. 所有连线都有正确的 geometry（relative="1", as="geometry"，无 x/y/width/height）
  3. 连线没有 mxPoint 子元素
  4. 特殊字符都已转义（", <, >, &）
  5. style 属性中的 exitX/exitY/entryX/entryY 都有值（如 exitX=0.5，不是 exitX;）

✅ **逻辑合理性检查**：
  1. 连线数量 ≈ 节点数量（比例 0.8-1.5）
  2. 没有孤立节点（每个节点至少有一条连线）
  3. 层级间距合理（至少 120-150px）
  4. 同层节点水平间距合理（至少 60-80px）

**⚠️ 如果发现任何一项不符合，请修正后再输出！**

**再次强调：直接输出 XML，不要添加任何说明！**
`;

/**
 * @const {string} BASE_SYSTEM_PROMPT
 * 基础系统提示词模板
 */
const BASE_SYSTEM_PROMPT = `你现在是 PDF 文档智能助手，用户正在查看文档"{docName}"。
你的回答应该：
1. 基于PDF文档内容
2. 简洁清晰
3. 学术准确`;

/**
 * 处理预设问题的点击事件。
 * 当用户点击一个预设问题时，此函数会将问题文本填充到聊天输入框，
 * 并尝试调用全局的 `window.handleChatbotSend` 函数来发送消息。
 *
 * @param {string} q被点击的预设问题文本。
 */
function handlePresetQuestion(q) {
  const input = document.getElementById('chatbot-input');
  if (!input) return;
  let sendText = q;
  if (q.includes('流程图')) {
    sendText += MERMAID_FLOWCHART_PROMPT;
  }
  input.value = sendText;
  if (typeof window.handleChatbotSend === 'function') {
    window.handleChatbotSend();
  }
}

/**
 * 增强用户输入的提示词
 * 如果输入包含特定关键词，添加相应的提示词
 *
 * @param {string|Array} userInput - 用户输入，可能是字符串或多模态消息数组
 * @returns {string|Array} - 增强后的用户输入
 */
function enhanceUserPrompt(userInput) {
  // 如果是数组（多模态消息），找到文本部分并增强
  if (Array.isArray(userInput)) {
    const textPartIndex = userInput.findIndex(p => p.type === 'text');
    if (textPartIndex !== -1) {
      const textContent = userInput[textPartIndex].text;
      if (textContent.includes('流程图') && !textContent.includes('Mermaid语法')) {
        userInput[textPartIndex].text += MERMAID_FLOWCHART_PROMPT;
      }
    }
    return userInput;
  }
  // 如果是字符串，直接增强
  else if (typeof userInput === 'string') {
    if (userInput.includes('流程图') && !userInput.includes('Mermaid语法')) {
      return userInput + MERMAID_FLOWCHART_PROMPT;
    }
  }
  return userInput;
}

/**
 * 检查用户输入是否为配图请求（基于前缀 [加入配图]）。
 *
 * @param {string} input - 用户输入文本
 * @returns {boolean} - 是否为配图请求
 */
function isDrawioPicturesRequest(input) {
  if (!input) return false;
  return input.trim().startsWith('[加入配图]');
}

/**
 * 检查用户输入是否包含思维导图请求关键词
 *
 * @param {string} input - 用户输入文本
 * @returns {boolean} - 是否包含思维导图关键词
 */
function isMindMapRequest(input) {
  if (!input) return false;
  return input.includes('思维导图') || input.includes('脑图');
}

window.ChatbotPreset = {
  PRESET_QUESTIONS,
  MERMAID_FLOWCHART_PROMPT,
  MINDMAP_PROMPT,
  DRAWIO_PICTURES_PROMPT,
  BASE_SYSTEM_PROMPT,
  handlePresetQuestion,
  enhanceUserPrompt,
  isMindMapRequest,
  isDrawioPicturesRequest
};