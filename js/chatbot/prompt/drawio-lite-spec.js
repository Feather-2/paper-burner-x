// js/chatbot/prompt/drawio-lite-spec.js

/**
 * DrawioLite DSL 完整语法规范
 * 用于 AI 提示词，确保 AI 生成正确的 DSL 代码
 * @version 1.0.0
 * @date 2025-01-16
 */

const DRAWIO_LITE_SPEC = `
# DrawioLite DSL 语法规范

DrawioLite 是一种极简的文本语法，用于快速生成学术论文级别的 Draw.io 图表。
AI 必须严格按照本规范生成代码。

---

## 1. 节点定义（Node）

### 语法
\`\`\`
node <ID> "<标签文本>" <形状> [颜色]
\`\`\`

### 参数说明
- **ID**：节点唯一标识符（单个字母或单词，如 A, B, node1）
- **标签文本**：显示在节点内的文字（必须用双引号包围）
- **形状**：节点形状类型（见下表）
- **颜色**：可选，节点配色方案（见下表）

### 支持的形状
| 形状关键词 | 说明 | 适用场景 |
|-----------|------|---------|
| \`rect\` | 圆角矩形 | 处理步骤、模块、组件 |
| \`ellipse\` | 椭圆 | 开始/结束、数据源 |
| \`diamond\` | 菱形 | 判断、决策点 |
| \`circle\` | 圆形 | 节点、状态 |
| \`cylinder\` | 圆柱体 | 数据库、存储 |
| \`hexagon\` | 六边形 | 特殊处理、接口 |

### 支持的颜色（学术标准配色）
| 颜色关键词 | fillColor | strokeColor | 语义 |
|-----------|-----------|-------------|------|
| \`gray\` | #F7F9FC | #2C3E50 | 默认/中性（黑白打印友好） |
| \`blue\` | #dae8fc | #3498DB | 主要流程/处理 |
| \`green\` | #d5e8d4 | #82b366 | 成功/通过/数据 |
| \`yellow\` | #fff2cc | #d6b656 | 警告/决策 |
| \`red\` | #f8cecc | #E74C3C | 错误/重点/瓶颈 |
| \`orange\` | #ffe6cc | #d79b00 | 次要流程 |

### 示例
\`\`\`
node A "数据采集" rect blue
node B "预处理" rect green
node C "有效？" diamond yellow
node D "数据库" cylinder gray
node E "结束" ellipse green
\`\`\`

---

## 2. 连接定义（Edge）**【可选】**

### 语法
\`\`\`
<起点ID> -> <终点ID> ["标签文本"]
\`\`\`

### 参数说明
- **起点ID**：源节点的 ID
- **终点ID**：目标节点的 ID
- **标签文本**：可选，连接线上显示的文字（用双引号包围）

### 重要说明
- **连接不是必需的**：节点可以独立存在，不需要连线
- **适用场景**：
  - ✅ 流程图、数据流图：需要表示步骤顺序或数据流向
  - ❌ 架构图、分组图：仅需要表示模块划分，不需要连线
- **与 group 配合**：group 内的节点可以不连线，只表示逻辑分组

### 特性
- 自动使用正交路由（orthogonalEdgeStyle）
- LR 布局下强制从节点左右边连接
- 自动避免连线交叉（Dagre 算法）

### 示例
\`\`\`
# 有连接的流程图
A -> B "原始数据"
B -> C
C -> D "是"
C -> E "否"

# 无连接的分组（仅分类）
node F "模块F" rect blue
node G "模块G" rect blue
# F 和 G 可以在 group 中，但不需要连线
\`\`\`

---

## 3. 分组/容器（Group）

### 语法
\`\`\`
group <ID> "<标题>" {
  <成员节点ID>, <成员节点ID>, ...
}
\`\`\`

### 参数说明
- **ID**：容器唯一标识符（如 G1, layer1）
- **标题**：容器标题（显示在容器顶部）
- **成员节点ID**：用逗号分隔的节点 ID 列表

### 特性
- 生成 Draw.io swimlane 容器
- 自动调整容器大小以包含所有成员
- **成员节点之间不需要连线**：group 的作用是逻辑分组，不是流程连接
- 适合表示层次结构、模块划分、功能分类

### 使用场景
- ✅ **仅分组**：将相关模块放在一起，不需要连线
- ✅ **分组+连线**：既分组又有内部流程
- ✅ **跨组连线**：不同 group 的节点可以连线

### 示例
\`\`\`
# 示例1：仅分组（无连线）
node A "用户模块" rect blue
node B "权限模块" rect blue
node C "订单模块" rect green
node D "支付模块" rect green

group G1 "用户系统" {
  A, B
}

group G2 "交易系统" {
  C, D
}
# A, B, C, D 之间可以没有连线，只是分类展示

# 示例2：分组+内部连线
group G1 "数据处理层" {
  B, C, D
}
B -> C -> D  # group 内部有流程连线

group G2 "输出层" {
  E
}
D -> E  # 跨 group 连线
\`\`\`

---

## 4. 图例（Legend）

### 语法
\`\`\`
legend {
  <形状> <颜色> "<说明文本>"
  <形状> <颜色> "<说明文本>"
  ...
}
\`\`\`

### 参数说明
- **形状**：与节点定义中的形状关键词相同
- **颜色**：与节点定义中的颜色关键词相同
- **说明文本**：该形状/颜色的含义说明

### 特性
- 自动放置在图表右上角
- 包含形状示例和文字说明
- 学术论文必备元素

### 示例
\`\`\`
legend {
  rect blue "处理模块"
  diamond yellow "判断节点"
  ellipse green "起始/结束"
}
\`\`\`

---

## 5. 注释

### 语法
\`\`\`
# 这是注释，会被忽略
\`\`\`

---

## 6. 多图支持（高级功能）

### 6.1 并列子图（Subgraph）

#### 语法
\`\`\`
subgraph <ID> "<标题>" {
  # 在这里定义节点和连接
  node ...
  ... -> ...
}
\`\`\`

#### 特性
- 每个子图独立布局
- 自动左右或上下并列排列
- 适合对比分析图、多阶段流程图

#### 示例：对比分析图
\`\`\`
subgraph S1 "方案A" {
  node A1 "输入" ellipse blue
  node A2 "处理A" rect blue
  node A3 "输出" ellipse green
  A1 -> A2 -> A3
}

subgraph S2 "方案B" {
  node B1 "输入" ellipse blue
  node B2 "处理B" rect orange
  node B3 "输出" ellipse green
  B1 -> B2 -> B3
}

legend {
  rect blue "方案A模块"
  rect orange "方案B模块"
}
\`\`\`

### 6.2 多页图表（Multi-page）

#### 语法
\`\`\`
page "<页面标题1>" {
  # 第一页的内容
}

page "<页面标题2>" {
  # 第二页的内容
}
\`\`\`

#### 特性
- 生成多个 diagram 标签页
- 每页独立，可以不同类型的图表
- 适合复杂系统的分模块展示

#### 示例：分层架构图
\`\`\`
page "系统架构概览" {
  node A "前端" rect blue
  node B "后端" rect orange
  node C "数据库" cylinder gray
  A -> B -> C
}

page "前端详细设计" {
  node F1 "React组件" rect blue
  node F2 "状态管理" rect blue
  node F3 "路由" rect blue
  F1 -> F2 -> F3
}

page "后端详细设计" {
  node B1 "API层" rect orange
  node B2 "业务逻辑" rect orange
  node B3 "数据访问" rect orange
  B1 -> B2 -> B3
}
\`\`\`

### 6.3 跨子图连接

#### 语法
\`\`\`
# 定义连接时使用 子图ID.节点ID 格式
S1.A3 -> S2.B1 "数据传递"
\`\`\`

#### 示例
\`\`\`
subgraph S1 "数据采集" {
  node A1 "传感器" ellipse blue
  node A2 "采集器" rect blue
  A1 -> A2
}

subgraph S2 "数据处理" {
  node B1 "清洗" rect green
  node B2 "分析" rect green
  B1 -> B2
}

# 跨子图连接
S1.A2 -> S2.B1 "原始数据"
\`\`\`

---

## 完整示例：实验流程图

\`\`\`drawiolite
# 定义节点
node A "开始" ellipse green
node B "数据采集" rect blue
node C "数据清洗" rect blue
node D "质量检测" diamond yellow
node E "特征提取" rect blue
node F "模型训练" rect orange
node G "结果输出" rect green
node H "结束" ellipse green

# 定义连接
A -> B "启动"
B -> C "原始数据"
C -> D
D -> E "通过"
D -> C "失败，重试"
E -> F "特征向量"
F -> G "模型参数"
G -> H

# 分组
group G1 "预处理阶段" {
  B, C, D
}

group G2 "建模阶段" {
  E, F, G
}

# 图例
legend {
  rect blue "数据处理"
  rect orange "模型相关"
  diamond yellow "质量检查"
  ellipse green "流程控制"
}
\`\`\`

---

## 输出要求

1. **只输出 DrawioLite DSL 代码**
   - 不要输出任何解释文字
   - 不要使用 markdown 代码块标记（如 \\\`\\\`\\\`）
   - 直接从第一个 node 或 # 注释开始

2. **遵循学术规范**
   - 优先使用 gray 配色（黑白打印友好）
   - 仅在需要区分语义时使用彩色
   - 复杂图表必须包含图例

3. **保持简洁**
   - 节点标签简短明确（不超过15字）
   - 避免冗余连接
   - 合理使用分组，层次清晰

4. **命名规范**
   - 节点 ID 使用 A, B, C... 或 node1, node2...
   - 分组 ID 使用 G1, G2... 或 layer1, layer2...

---

## 错误示例（禁止）

❌ **错误1：缺少引号**
\`\`\`
node A 数据采集 rect blue  // 错误！标签必须加引号
\`\`\`

❌ **错误2：使用不支持的形状**
\`\`\`
node A "开始" star blue  // 错误！star 不是支持的形状
\`\`\`

❌ **错误3：连接到不存在的节点**
\`\`\`
A -> Z  // 错误！节点 Z 未定义
\`\`\`

❌ **错误4：包含解释文字**
\`\`\`
下面是流程图：
node A "开始" ellipse  // 错误！不要输出解释文字
\`\`\`

---

## 正确示例（参考）

✅ **示例1：简单流程图**
\`\`\`
node A "开始" ellipse green
node B "处理" rect blue
node C "结束" ellipse green
A -> B
B -> C
\`\`\`

✅ **示例2：带判断的流程**
\`\`\`
node A "输入数据" rect blue
node B "验证" diamond yellow
node C "保存" rect green
node D "拒绝" rect red
A -> B
B -> C "有效"
B -> D "无效"
\`\`\`

✅ **示例3：系统架构图**
\`\`\`
node A "客户端" rect blue
node B "API网关" hexagon orange
node C "业务逻辑" rect blue
node D "数据库" cylinder gray

A -> B "HTTP请求"
B -> C "路由"
C -> D "查询/写入"

group G1 "后端系统" {
  B, C, D
}

legend {
  rect blue "服务组件"
  cylinder gray "数据存储"
  hexagon orange "网关/接口"
}
\`\`\`
`;

// 导出到全局
window.DRAWIO_LITE_SPEC = DRAWIO_LITE_SPEC;
