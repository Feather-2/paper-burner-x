👋走向在线学习，文档即权重
==============

v3 版本引入了子代理机制——用 Task 工具将复杂任务分解给专门的"员工"处理。但有一个问题始终存在：**模型怎么知道"如何"处理特定领域的任务？**

让模型处理 PDF？它需要知道用 `pdftotext` 还是 `PyMuPDF`。让模型构建 MCP 服务器？它需要知道协议规范和最佳实践。让模型做代码审查？它需要一套系统的检查清单。

这些"领域知识"不是工具，而是**专业技能**。Claude Code 的解法是 **Skills 机制**——一套开放标准，让模型按需加载领域专家的"说明书"。

用约 100 行新增代码实现了这个机制的核心：**渐进式披露 + SKILL.md 标准 + 上下文注入**。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

  

本次完整教学代码地址：https://github.com/shareAI-lab/mini\_claude\_code

0\. 知识外化：改变一切的范式转变
------------------

在深入 Skills 机制之前，我想先讲一个更大的故事：**知识外化 (Knowledge Externalization)**。

### 传统 AI 的困境

传统 AI 系统的知识都藏在模型参数里，你没法访问、没法修改、没法复用。

```
┌─────────────────────────────────────────────────────────────────────┐│                     知识存储层级                                      ││                                                                      ││  Model Parameters → Context Window → File System → Skill Library     ││       (内化)            (运行时)        (持久化)      (结构化)         ││                                                                      ││  ←───────── 训练修改 ──────────→  ←────── 自然语言修改 ─────────→     ││     需要集群、数据、专业知识              任何人都可以编辑              │└─────────────────────────────────────────────────────────────────────┘
```

想让模型学会新技能？传统做法：收集数据 → 设置集群 → 参数微调（LoRA/全量）→ 部署新版本。

知识被100%完全锁在神经网络的权重矩阵中。

### 新开发知识范式改变了这一切

**关键突破**：

•

**过去**：修改模型行为 = 修改参数 = 需要训练 = 需要 GPU 集群 + 训练数据 + 专业知识

•

**现在**：修改模型行为 = 修改 SKILL.md = 编辑文本文件 = 任何人都可以做

这就像给 base model 外挂了一个可热插拔的 LoRA 权重，但你不需要对模型本身进行任何参数训练。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

  

### 知识层级对比

| 
层级

 | 

修改方式

 | 

生效时间

 | 

持久性

 | 

成本

 |
| --- | --- | --- | --- | --- |
| 

Model Parameters

 | 

训练/微调

 | 

数小时-数天

 | 

永久

 | 

1M+

 |
| 

Context Window

 | 

API 调用

 | 

即时

 | 

会话内

 | 

~$0.01/次

 |
| 

File System

 | 

编辑文件

 | 

下次加载

 | 

永久

 | 

免费

 |
| **Skill Library** | **编辑 SKILL.md** | **下次触发** | **永久** | **免费** |

Skills 是最甜蜜的平衡点：持久化存储 + 按需加载 + 人类可编辑。

### 这意味着什么

1

**民主化**：不再需要 ML 专业知识来定制模型行为

2

**透明性**：知识以人类可读的 Markdown 存储，可审计、可理解

3

**在线学习**：模型在更大的上下文窗口中"学习"，无需离线训练

4

**即时生效**：修改 SKILL.md 后，下次触发立即生效

传统的微调是**离线学习**：收集数据→训练→部署→使用。  
Skills 是**在线学习**：运行时按需加载知识，立即生效。

**这就是知识外化的力量：把需要训练才能编码的知识，变成任何人都能编辑的文档。**

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

理解了这个背景，Skills 机制的设计就显得顺理成章了。

1\. Skills 的本质：知识包，不是工具
-----------------------

这是最关键的洞察：

| 
概念

 | 

是什么

 | 

例子

 |
| --- | --- | --- |
| **Tool** | 

模型能**做**什么

 | 

bash,read\_file, write\_file

 |
| **Skill** | 

模型**知道怎么做**

 | 

PDF 处理、MCP 构建、代码审查

 |

工具是能力，技能是知识。工具执行动作，技能指导决策。

**为什么不直接把所有知识写进系统提示词？**

因为上下文是稀缺资源。一个 Skill 可能有 2000 词的详细指南，如果你有 20 个 Skills，启动时就要注入 40000 词——模型的注意力会被稀释到几乎无效。

2\. 渐进式披露：三层加载
--------------

这是 Skills 的精髓设计：

```
Layer 1: 元数据 (始终加载)     ~100 tokens/skill         └─ name + description         └─ "当用户要处理 PDF 时用这个"Layer 2: SKILL.md 主体 (触发时加载)   ~2000 tokens         └─ 详细指南、代码示例、决策树Layer 3: 资源文件 (按需加载)     无限制         └─ scripts/, references/, assets/
```

**启动时**：只加载 20 个 Skills 的 name + description = ~2000 tokens  
**触发时**：加载相关 Skill 的完整内容 = ~2000 tokens  
**执行时**：按需读取脚本和参考文档

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

这让模型在保持轻量的同时，能够调用任意深度的领域知识。

3\. SKILL.md 标准
---------------

每个 Skill 就是一个文件夹：

```
skills/├── pdf/│   └── SKILL.md          # 必需：元数据 + 指南├── mcp-builder/│   ├── SKILL.md│   └── references/       # 可选：参考文档│       └── protocol.md└── code-review/    ├── SKILL.md    └── scripts/          # 可选：辅助脚本        └── security_scan.sh
```

**SKILL.md 格式**：YAML 前置 + Markdown 正文

```
---name: pdfdescription: 处理 PDF 文件。当用户需要读取、创建、合并 PDF 时使用。---# PDF 处理技能## 读取 PDF推荐使用 pdftotext:\`\`\`bashpdftotext input.pdf -\`\`\`如果需要更精细控制，使用 PyMuPDF...
```

**关键设计**：

•

`name`：唯一标识符，小写+连字符

•

`description`：触发条件——模型根据这个决定是否加载

4\. 核心实现
--------

### 4.1 SkillLoader

```
class SkillLoader:    def __init__(self, skills_dir: Path):        self.skills = {}        self.load_skills()  # 扫描所有 SKILL.md    def parse_skill_md(self, path: Path) -> dict:        """解析 YAML 前置 + Markdown 正文"""        content = path.read_text()        match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)$', content, re.DOTALL)        # 返回 {name, description, body, path, dir}    def get_descriptions(self) -> str:        """生成元数据列表（注入系统提示词）"""        return "\n".join(f"- {name}: {skill['description']}"                        for name, skill in self.skills.items())    def get_skill_content(self, name: str) -> str:        """获取完整内容（Skill 工具调用时）"""        skill = self.skills[name]        content = f"# Skill: {name}\n\n{skill['body']}"        # 附加可用资源列表        return content
```

### 4.2 Skill 工具

```
SKILL_TOOL = {    "name": "Skill",    "description": """加载技能获取专业知识。可用技能：- pdf: 处理 PDF 文件- mcp-builder: 构建 MCP 服务器- code-review: 代码审查当任务匹配技能描述时，立即调用此工具。""",    "input_schema": {        "properties": {"skill": {"type": "string"}},        "required": ["skill"]    }}
```

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

  

### 4.3 消息注入（保持缓存）

这是最精妙的部分——Skill 内容作为 **tool\_result 注入对话历史**，而不是修改 system prompt：

```
def run_skill(skill_name: str) -> str:    content = SKILLS.get_skill_content(skill_name)    # 完整内容作为 tool_result 返回    # 它会成为对话历史的一部分（user message）    return f"""<skill-loaded name="{skill_name}">{content}</skill-loaded>Follow the instructions in the skill above."""def agent_loop(messages: list) -> list:    while True:        response = client.messages.create(            model=MODEL,            system=SYSTEM,  # 永不改变 - 缓存保持有效！            messages=messages,            tools=ALL_TOOLS,        )        # ... Skill 内容作为 tool_result 进入 messages ...
```

**关键洞察**：

•

Skill 内容作为新消息**追加到末尾**

•

之前的所有内容（system prompt + 历史消息）都被缓存复用

•

只有新追加的 skill 内容需要计算，**整个前缀都命中缓存**

5\. 与 Claude Code 的对比
---------------------

| 
机制

 | 

Claude Code / Kode CLI

 | 

mini Claude Code v4

 |
| --- | --- | --- |
| 

Skill 格式

 | 

SKILL.md (YAML + MD)

 | 

SKILL.md (YAML + MD)

 |
| 

加载机制

 | 

Container API + Skills 数组

 | 

SkillLoader 类

 |
| 

触发方式

 | 

自动（description 匹配）+ Skill 工具

 | 

Skill 工具

 |
| 

缓存机制

 | 

追加到末尾，前缀全部缓存

 | 

相同

 |
| 

资源访问

 | 

scripts/, references/, assets/

 | 

相同目录结构

 |
| 

版本控制

 | 

Skill Versions API

 | 

省略

 |
| 

权限控制

 | 

allowed-tools 字段

 | 

省略

 |

**关键共同点**：两者都不修改 system prompt，而是将 skill 内容注入到对话历史中，从而保持 prompt cache 有效。

6\. 缓存友好设计：Agent 开发中最容易被忽视的成本问题
-------------------------------

Skill 内容作为 tool\_result 注入对话历史，而不是修改 system prompt。这不是随意的设计选择，而是与大模型 API 缓存机制对齐的关键决策。

### 为什么这个问题如此重要？

许多开发者在使用 LangGraph、LangChain 等框架时，习惯性地：

•

在 system prompt 中注入动态状态

•

编辑和压缩历史消息

•

使用滑动窗口截断对话

**这些操作会导致缓存完全失效，成本爆炸 7-50 倍。**

一个 50 轮的典型 SWE 任务：

•

**破坏缓存**: $14.06 (每轮修改 system prompt)

•

**缓存优化**: $1.85 (只追加，不修改)

•

**节省**: 86.9%

对于每天处理 100 个任务的应用，这意味着每年节省 **$45,000+**。

### 核心原理

大模型 API 提供商普遍实现了 **Prompt Cache**：当请求的前缀与之前完全相同时，可以复用已计算的 KV 向量，大幅降低成本。

```
请求 1: [System, User1, Asst1, User2]        ←────── 全部计算 ──────→请求 2: [System, User1, Asst1, User2, Asst2, User3]        ←────── 缓存命中 ──────→ ←─ 新计算 ─→                 (0.1x 价格)       (正常价格)
```

**关键条件**：缓存命中要求**前缀完全相同**。修改 system prompt 或历史消息会使整个前缀缓存失效。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

  

### 为什么 Skill 内容追加到末尾

```
def run_skill(skill_name: str) -> str:    content = SKILLS.get_skill_content(skill_name)    # 作为 tool_result 返回，追加到对话末尾    return f"<skill-loaded>{content}</skill-loaded>"def agent_loop(messages: list):    response = client.messages.create(        system=SYSTEM,  # 永不改变 - 缓存保持有效        messages=messages,  # 只追加，不修改    )
```

•

Skill 内容追加到 messages 末尾

•

System prompt 和历史消息保持不变

•

整个前缀命中缓存，只计算新增的 skill 内容

### 提供商差异

| 
提供商

 | 

自动缓存

 | 

缓存命中折扣

 | 

配置

 |
| --- | --- | --- | --- |
| 

Claude

 | 

✗

 | 

90%

 | 

`cache_control`

 |
| 

GPT-5.2

 | 

✓

 | 

90%

 | 

无需配置

 |
| 

Kimi K2

 | 

✓

 | 

90%

 | 

无需配置

 |
| 

GLM-4.7

 | 

✓

 | 

82%

 | 

无需配置

 |
| 

MiniMax M2.1

 | 

✗

 | 

90%

 | 

`cache_control`

 |
| 

Gemini 3

 | 

✓ (隐式)

 | 

90%

 | 

无需配置

 |

**重要**: Claude 和 MiniMax 需要显式配置 `cache_control`，否则即使前缀相同也不会有缓存。

### 深入了解

上下文缓存是 Agent 开发中最容易被忽视的成本杀手。完整的专题文章深入探讨：

1

**思维转变**: 上下文不是"可编辑的变量"，而是"只追加的日志"

2

**常见陷阱**: 动态system prompt、消息编辑、滑动窗口等5大反模式

3

**成本对比**: 同样任务，破坏缓存vs优化缓存可相差7-50倍成本

请参阅（文章在GitHub中）：

•

上下文缓存经济学：别让你的Agent"烧钱"

7\. 示例技能展示
----------

**pdf**：PDF 处理专家

```
读取 → pdftotext / PyMuPDF创建 → pandoc / reportlab合并 → PyMuPDF
```

**mcp-builder**：MCP 服务器构建专家

```
Python → mcp SDK + @server.tool 装饰器TypeScript → @modelcontextprotocol/sdk测试 → MCP Inspector
```

**code-review**：代码审查专家

```
安全 → 注入、认证、授权、加密正确性 → 逻辑错误、资源泄漏性能 → N+1、内存、阻塞可维护性 → 命名、复杂度、重复
```

8\. 背后的思想：知识外化的实践
-----------------

> **知识作为一等公民**

回到我们开头讨论的知识外化范式。传统观点把 AI Agent 看作"工具调用器"——模型决定用什么工具，代码执行工具。但这忽略了一个关键维度：**模型怎么知道应该怎么做？**

Skills 机制是知识外化的完整实践：

**过去（知识内化）**：

•

知识锁在模型参数里

•

修改需要训练

•

用户无法访问或理解

•

成本高昂，周期漫长

**现在（知识外化）**：

•

知识存在 SKILL.md 文件中

•

修改就是编辑文本

•

人类可读、可审计

•

免费，即时生效

Skills 机制承认：**领域知识本身就是一种资源**，需要被显式管理。

1

**分离元数据与内容**

description 是索引，body 是内容。就像搜索引擎：先用关键词定位，再加载完整页面。

2

**按需加载而非预加载**

上下文窗口是宝贵的认知资源。Skills 用渐进式披露确保每个 token 都在需要时才被使用。

3

**标准化格式促进复用**

SKILL.md 是开放标准。一个 Skill 写一次，可以在 Claude Code、Cursor、Kode CLI 等任何兼容的 Agent 上使用。这就是知识外化带来的复用性。

4

**追加而非编辑**

Skill 内容追加到对话末尾，而非修改 system prompt。这保持了前缀缓存有效，是与自回归模型正确交互的方式。

5

**在线学习 vs 离线学习**

传统微调需要离线收集数据、训练、部署。Skills 实现了真正的"在线学习"——在更大的上下文窗口中，模型通过读取 SKILL.md 即时获得新能力，无需任何参数修改。

知识外化的本质是**把隐式知识变成显式文档**。这不仅改变了技术实现，更改变了人与 AI 协作的方式：

•

开发者可以用自然语言"教"模型新技能

•

团队可以用 Git 管理和共享知识

•

知识可以被版本控制、审计、回滚

**这是一个从"训练 AI"到"教育 AI"的范式转变。**

9\. 五部曲回顾
---------

| 
版本

 | 

核心主题

 | 

行数

 | 

关键洞察

 |
| --- | --- | --- | --- |
| 

v0

 | 

Bash is All

 | 

~50 行

 | 

一个工具 + 递归 = 完整 Agent

 |
| 

v1

 | 

Model as Agent

 | 

~200 行

 | 

模型是 80%，代码是工具循环

 |
| 

v2

 | 

结构化规划

 | 

~300 行

 | 

Todo 工具让计划可见

 |
| 

v3

 | 

分而治之

 | 

~450 行

 | 

子代理隔离上下文

 |
| **v4** | **领域专家** | **~550 行** | **Skills 注入专业知识** |

五个版本，约 1100 行 Python，覆盖了 Claude Code 的核心设计：

1

**工具循环**：模型持续调用工具直到完成

2

**结构化约束**：Todo 引导规划行为

3

**层级委派**：Task 实现任务分解

4

**知识注入**：Skill 提供领域专业

5

**缓存友好**：只追加不编辑，与自回归模型正确交互

* * *

**工具让模型能做事，技能让模型知道怎么做。**

这就是 Skills 机制的全部奥秘——把专家知识打包成可加载的模块，让通用模型在需要时变成领域专家。

完整代码见仓库 `v4_skills_agent.py` 和 `skills/` 目录。

如果你想要生产级实现，欢迎使用 Kode。

本文转自 <https://mp.weixin.qq.com/s/ONX5r_gRz83CMcD1dRbFIA>，如有侵权，请联系删除。