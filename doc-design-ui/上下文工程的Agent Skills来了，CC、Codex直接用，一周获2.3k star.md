GitHub上最近出现了一个非常火的项目Agent-Skills-for-Context-Engineering，发布不到一周就斩获了2.3k Stars。为什么它能瞬间引爆社区？因为站在2025年末的节点上，我们已经受够了那些只存在于大厂白皮书里的Context Engineering（上下文工程） 理论。

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

对于每天在终端里使用AI编程的极客来说，我们不需要另一篇教我们“什么是上下文”的论文，我们需要的是能直接装进Claude Code里的武器。这个项目正是填补了这一空白！它将晦涩的上下文管理策略，封装成了即插即用的10个Agent Skills。利用Claude的自动按需加载与模型自行触发机制，它让AI终于学会了像资深工程师一样自己管理“内存”。这就是一套Context Engineering的最佳实践工具库，爽点就在于：你只管提问，剩下的脏活累活，让Skill自动替你完成。用之前先把今天这篇文章看完，对每一个SKILL.md有一个大致了解。

项目地址：https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

Skill的解剖学：一个“能力包”长什么样？
----------------------

以下是一个Skills的文件结构，不熟悉的朋友可以了解一下。

`my-skill/   ├── SKILL.md          # 核心：包含元数据（YAML）和指令（Markdown）   ├── scripts/          # 可选：Python/Bash脚本，供Agent调用   ├── references/       # 可选：长文档、API手册、参考资料   └── assets/           # 可选：模板文件、静态资源`

以此构成了Agent的**技能包**。

重新定义上下文：Agent的注意力预算
-------------------

**上下文是稀缺资源，是Agent的全部世界。**

### 上下文的结构

项目作者在第一个skill `context-fundamentals` 中将上下文拆解为五个核心组件。这种分类法能帮您清晰地识别出“Token究竟花在哪了”：

*   **系统指令 (System Prompts)**：Agent的灵魂，规定了行为边界和任务目标。
    
*   **工具定义 (Tool Definitions)**：Agent与外部世界交互的API规范。
    
*   **检索文档 (Retrieved Documents)**：通过RAG引入的外部知识。
    
*   **消息历史 (Message History)**：对话的上下文流。
    
*   **工具输出 (Tool Outputs)**：最危险的部分。研究显示，原始的工具返回结果往往占据了上下文80% 以上的体积。
    

### 渐进式披露：按需加载的艺术

如果您有100项专业技能，全部塞进系统提示词会瞬间耗尽Agent的注意力。项目作者提出的“渐进式披露”策略，是解决该问题的金钥匙：

*   **元数据检索**：初始状态下，Agent只读取所有Skill的 `name` 和 `description`。
    
*   **基于语义的动态路由**：这是最性感的部分。Agent会根据你的Prompt（例如“帮我分析一下这个财报”），在后台自动进行语义匹配。如果发现某个Skill的 `description` 描述了相关能力（“提取财务关键指标”），它就会自动“调包”——将该Skill的详细 `SKILL.md` 加载到上下文中。
    
*   **优势**：这就像操作系统的页交换机制，确保模型始终在处理与其当前任务最相关的“高信号”Token。
    

诊断退化：为什么模型会越聊越笨？
----------------

 `context-degradation` 是第二个Skill，在这个skill中，项目作者总结了长对话中性能下降的必然规律。理解这些模式，能帮您在调试时少走弯路。

### 迷失在中间 (Lost-in-the-Middle)

这是最著名的衰减现象。模型对上下文两端的信息记忆清晰，但对中间部分的信息召回率极低：

*   **数据支撑**：研究表明，信息放在中间位置时，召回准确率可能比放在两端低10-40%。
    
*   **工程建议**：永远将最重要的约束条件放在开头，将当前最紧急的任务目标放在结尾。
    

**原理解析：用Python模拟注意力衰减**

项目中的 `degradation_detector.py` 脚本包含了一个有趣的函数 `_estimate_attention`，它用代码量化了这种“U型曲线”：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

`def _estimate_attention(position, total, is_beginning, is_end):       if is_beginning:           return 0.8 + np.random.random() * 0.2  # 开头：高关注       elif is_end:           return 0.7 + np.random.random() * 0.3  # 结尾：次高关注       else:           # 中间：注意力塌陷区           # 模拟了一个从两端向中间递减的U型谷底           middle_progress = (position - total * 0.1) / (total * 0.8)           base_attention = 0.3 * (1 - middle_progress) + 0.1 * middle_progress           return base_attention` 

这段代码直观地说明：任何放在 `else` 分支（中间区域）的关键信息，都有70%的概率被模型忽略。

### 上下文中毒 (Context Poisoning)

一旦Agent在某一步产生了幻觉或错误，如果不及时清理，后续所有的推理都会基于这个错误前提。

*   **连锁反应**：错误1 -> 基于错误的决策A -> 错误2 -> 逻辑崩塌。
    
*   **识别信号**：如果Agent突然开始坚持执行错误的指令，或者反复调用一个错误的参数，这就是中毒的征兆。
    

### 常见的其他退化模式

*   **上下文干扰 (Distraction)**：无关信息过多，消耗了模型的注意力配额。
    
*   **上下文混淆 (Confusion)**：模型无法区分不同任务阶段的相似指令。
    
*   **上下文冲突 (Clash)**：多份检索文档中的过时信息与实时事实产生矛盾。
    

压缩与优化：每一Token都要物尽其用
-------------------

`context-compression`和context-optimization是第三和第四个skill，当您的上下文水位达到70%时，优化就不再是选项，而是必须。

### 观察掩码 (Observation Masking)

这是项目作者极力推荐的高级技巧。当Agent读取一个几万字的日志或文件时，不要让这些原文留在上下文中：

*   **处理流程**：读取全文 -> 提取核心结论 -> 将原文从上下文抹除 -> 替换为引用ID。
    
*   **效果**：上下文体积骤降90%，同时保留了“回溯能力”。
    

### 锚定迭代摘要 (Anchored Iterative Summarization)

传统的“全量总结”会随着次数增加而丢失细节。项目作者提出的方案是维护一个结构化的状态块：

*   **会话意图**：用户最终要解决什么问题？
    
*   **状态清单**：哪些文件已修改？哪些测试已通过？
    
*   **决策记录**：为什么我们不使用旧方案？
    
*   **下一步**：清晰的Action Item。
    

**原理解析：结构化摘要的Prompt模板**

传统的摘要是“请总结以上对话”，而Context Engineering的摘要指令是填空题。在 `context-compression` Skill中，定义了这样的强制结构：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

`## Session Intent   [用户原本想解决什么问题？]      ## Files Modified   - auth.controller.ts: Fixed JWT token generation   - config/redis.ts: Updated connection pooling      ## Decisions Made   - Using Redis connection pool instead of per-request connections      ## Next Steps   1. Fix remaining test failures   2. Run full test suite`

这种结构的妙处在于，它迫使模型把“非结构化的对话流”转换成了“结构化的状态快照”。当上下文重置时，Agent读到的是这份快照，而不是模糊的回忆。

### KV-Cache命中率优化

在生产环境中，延迟和成本是绕不开的。项目作者指出，优化KV-Cache命中率能带来10倍以上的性能提升：

*   **保持前缀稳定**：系统提示词和工具定义应放在最前方且保持不变。
    
*   **避免动态干扰**：不要在系统提示词开头放每秒都在变化的“当前时间戳”，这会让所有Cache瞬间失效。
    

架构设计：多Agent协作的底层逻辑
------------------

项目作者在第五个skill `multi-agent-patterns` 中反复强调：**多Agent不是为了排场，而是为了“上下文隔离”。**

### 为什么要进行上下文隔离？

*   **干净的窗口**：每个子Agent只关心自己的那一小块任务，不受其他分支信息的干扰。
    
*   **专用的工具**：减少候选工具数量，提高模型调用工具的准确率。
    
*   **故障阻断**：一个子Agent的中毒不会直接传染给整个系统。
    

### 实战案例分析：X-to-Book系统

项目中的这个案例完美展示了上下文如何有序流动：

![图片](https://mmbiz.qpic.cn/mmbiz_png/Iurk1iaf4xdFy0LwRnx2Umib0FcUpAX1SplfkVd5vIU86nXaicBWyibSFCq8iafNNz2orXSSl6kDlicRz0bXDnQWu76g/640?wx_fmt=png&from=appmsg&watermark=1&tp=webp&wxfrom=5&wx_lazy=1#imgIndex=4)

*   **抓取代理 (Scraper)**：任务是高并发抓取。它只拥有抓取工具，其上下文在任务结束后立即清空，数据存入物理文件系统。
    
*   **分析代理 (Analyzer)**：任务是提取主题。它从文件读取数据，通过小窗口分批处理，只输出精炼的摘要。
    
*   **编排代理 (Orchestrator)**：它不需要看到任何推文原文！它只看到摘要，负责在各阶段间“接力”。
    

### 解决“传声筒问题”

主管Agent在转述子Agent的结论时容易产生偏差。项目作者提供的解决方案是：

*   **直连模式**：允许子代理直接向用户或最终文档写入结果。
    
*   **结构化输出**：强制要求子代理返回JSON格式，由程序而非模型进行合并。
    

**原理解析：Supervisor的路由逻辑实现**

在 `multi-agent-patterns` 技能中，Supervisor的核心并不是一个复杂的Prompt，而是一个基于状态机的路由函数。以下是基于LangGraph的实现片段：

![图片](https://mmbiz.qpic.cn/mmbiz_png/Iurk1iaf4xdFy0LwRnx2Umib0FcUpAX1SpYkmdfrFfribMHTOhTVWaovjsM1dFs6oUEbUkbUBEmCOHreKpiadvhMibA/640?wx_fmt=png&from=appmsg&watermark=1&tp=webp&wxfrom=5&wx_lazy=1#imgIndex=5)

`def supervisor_node(state: AgentState) -> AgentState:       task = state["task"]              # 基于任务类型的确定性路由，而非让LLM瞎猜       if"research"in task.lower():           next_agent = "researcher"       elif"write"in task.lower():           next_agent = "writer"       elif"review"in task.lower():           next_agent = "reviewer"       else:           next_agent = "coordinator"              return {           "current_agent": next_agent,           "messages": state["messages"] + [f"Routing to {next_agent}"]       }`

高效的编排往往包含大量的**确定性逻辑**。不要把所有压力都给LLM，工程代码才是最稳定的骨架。

记忆系统：从向量检索到时态图谱
---------------

如果您的Agent需要记住用户一年前的偏好，或者处理随时间变化的信息，普通的RAG将会失效。因此有了第六个skill memory-systems

### 向量存储的“时态盲区”

*   **挑战**：向量检索只看语义相似度。如果您检索“上次我干了什么”，它可能会返回5个过时的选项，而模型无法判断哪一个是现在的。
    
*   **解决方案**：项目作者推荐使用**时态知识图谱 (Temporal Knowledge Graph)**。
    

### 时态知识图谱的关键技术

*   **实体跟踪**：为核心对象（如：用户、项目、代码库）建立唯一的ID。
    
*   **有效性区间**：在关系边上标注 `valid_from` 和 `valid_until`。
    
*   **查询范式**：Agent可以通过专门的工具查询“在X时间点，A与B的关系是什么”。
    

**原理解析：为知识加上时间戳**

项目中的 `memory_store.py` 包含了一个 `TemporalKnowledgeGraph` 类，它扩展了普通图存储，强制要求每条边都具备时间属性：

![图片](https://mmbiz.qpic.cn/mmbiz_png/Iurk1iaf4xdFy0LwRnx2Umib0FcUpAX1SpRJ9JDTjDWadWhXCPCJMsW7OxC2XxKn45Q8JSr96h6VibibGADD2xFibcg/640?wx_fmt=png&from=appmsg&watermark=1&tp=webp&wxfrom=5&wx_lazy=1#imgIndex=6)

`class TemporalKnowledgeGraph(PropertyGraph):       def create_temporal_relationship(        self, source_id, rel_type, target_id,            valid_from, valid_until=None, properties=None    ):           # 创建基础关系           edge_id = super().create_relationship(...)                      # 注入时间维度（这才是关键！）           self.edges[edge_id]["valid_from"] = valid_from.isoformat()           self.edges[edge_id]["valid_until"] = valid_until.isoformat()                      # 建立时间索引，加速"穿越"查询           self._index_by_time(edge_id, valid_from, valid_until)           return edge_id`

正是因为这两行简单的赋值，Agent才能拥有记忆。

* * *

工具设计
----

工具是Agent的手脚。在第七个skill `tool-design` 中，项目作者提出了一个反直觉的建议：**架构缩减**。

### 合并原则 (Consolidation)

不要为每一个细小的功能写一个工具。

*   **痛点**：工具越多，描述占用的Token越多，模型选错的概率越大。
    
*   **方案**：将高度耦合的步骤合并。例如，与其给Agent `check_stock` 和 `place_order` 两个工具，不如直接给一个 `purchase_item_if_available`。
    

### 案例：Vercel d0的架构重构案例

项目中存在一个名为Vercel的案例，它们最初为其内部Agent设计了17个专业工具，效果平平。项目作者详细分析了他们后来的改进：

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

*   **减法逻辑**：删除了15个工具，只给Agent一个“执行Bash命令”的沙箱权限。
    
*   **结果**：成功率从80% 提升到100%，步骤减少了42%。
    
*   **启示**：只要文档写得好，模型可以通过原生的 `grep`、`cat` 等工具自己去探索和理解，这比我们强行定义的复杂API更符合模型的推理直觉。
    

**原理解析：从17个工具到2个**

让我们看看代码层面的变化。

**Before (Over-engineered):**

`// 试图帮模型"思考"，结果限制了模型   tools: [     GetEntityJoins, LoadCatalog, RecallContext,      SearchSchema, GenerateAnalysisPlan, FinalizeQueryPlan,     SyntaxValidator, ExecuteSQL, FormatResults...    ]`

**After (The File System Agent):**

`// 相信模型的推理能力，只提供基础能力   tools: [     {       name: "execute_command",       description: "Execute bash commands (ls, cat, grep) to explore the data layer files.",       parameters: { command: z.string() }     },     {       name: "execute_sql",       description: "Run a SQL query against the database.",       parameters: { query: z.string() }     }   ]`

这种**架构缩减**（Architectural Reduction）是Tool Design技能中最反直觉但也最深刻的一课。

评估体系：如何客观地衡量Agent的“智商”？
-----------------------

Agent的评估不能靠“感觉”，必须依赖评估框架。因此有了第八个skill`evaluation`和第九个Skill`advanced-evaluation`

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

### 95%性能变异公式

项目作者引用了一个重要的研究结论：Agent性能的95%变异由三个因素决定：

1.  **Token使用量 (80%)**：给模型更多的推理空间（如思维链）。
    
2.  **工具调用次数 (~10%)**：更深度的探索能力。
    
3.  **模型本身的选择 (~5%)**：基础智力底座。
    

### 高级评估技巧：LLM-as-a-Judge

为了实现自动化评估，需要训练“裁判模型”

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

*   **思维链强制要求**：裁判必须先写出打分理由，再给出分值。这能显著减少随机性。
    
*   **位置偏见校准**：对比两个答案A和B时，必须交换顺序测两次。如果结果不一致，说明评估无效。
    
*   **多维量表 (Rubric)**：不仅看答案对不对，还要看工具用得省不省，引用全不全。
    

开发方法论：从Demo到生产环境
----------------

拥有了以上9个Skill，我们该如何从零开始构建一个项目？`project-development` 第十个skill给出了一套“五阶段流水线”方法论。这里有一个核心原则：**在写第一行代码前，先用人肉的方式跑通流程。**

### 任务-模型匹配 (Task-Model Fit) 的手动验证

很多项目死在起跑线上，是因为开发者高估了模型的能力。项目作者建议在写代码前，先进行一次“手动原型测试”。

*   **场景**：假设您要开发一个“财报风险分析器”。
    
*   **动作**：找一份真实的财报PDF，复制其中最复杂的一段（比如“管理层讨论”），配合您构思的Prompt，直接粘贴到Claude的网页版对话框里。
    
*   **验证标准**：看它能否输出您预期的JSON格式？能否识别出隐蔽的债务风险？
    
*   **结论**：如果连最强的模型在网页端手动操作都做不到，那么任何自动化的Python代码都是徒劳的。先优化Prompt，直到手动测试通过，再开始写代码。
    

### 文件系统即状态机 (File System as State Machine)

当您开始编写Python脚本来批量处理1000份财报时，不要急着引入MySQL或Redis。项目作者提倡**开发者**直接利用**文件系统**来管理任务进度。

想象一下，对于每一份财报（Item），我们在硬盘上创建一个文件夹，用**文件的存在与否**来标记进度：

`data/batch_2025/report_AAPL/   ├── raw.json         # [阶段1完成]：爬虫已抓取到数据，存盘。   ├── prompt.md        # [阶段2完成]：Python脚本已读取raw.json，组装好了发给LLM的最终提示词。   ├── response.md      # [阶段3完成]：LLM已返回结果。这是最贵、最慢的一步，存盘后这就成了“存档点”。   └── parsed.json      # [阶段4完成]：已从response.md中提取出结构化数据。`

*   **断点续传**：您的代码只需检查 `if os.path.exists("response.md")`，如果存在就跳过LLM调用。这意味着程序随时可以中断，重启后自动接续，且不会浪费一分钱Token。
    
*   **极致透明**：觉得分析结果不对？开发者可以直接打开 `prompt.md` 和 `response.md`，一眼就能看出是提示词拼错了，还是模型发疯了。这种“所见即所得”的调试体验，是去数据库查日志无法比拟的。
    

结语：建立工程化思维
----------

通过对 `Agent-Skills-for-Context-Engineering` 项目的深度解析，我们可以清晰地看到，Agent的开发已经进入了“系统工程”时代。

上下文工程是一个不断进化的领域。项目作者为您提供的这些Skills，是您在这个充满不确定性的AI世界中，构建确定性系统的压舱石。建议您直接深入代码库，去感受那些时态图谱和掩码算法带来的工程魅力。

未来已来，有缘一起同行！

![图片](data:image/svg+xml,%3C%3Fxml version='1.0' encoding='UTF-8'%3F%3E%3Csvg width='1px' height='1px' viewBox='0 0 1 1' version='1.1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'%3E%3Ctitle%3E%3C/title%3E%3Cg stroke='none' stroke-width='1' fill='none' fill-rule='evenodd' fill-opacity='0'%3E%3Cg transform='translate(-249.000000, -126.000000)' fill='%23FFFFFF'%3E%3Crect x='249' y='126' width='1' height='1'%3E%3C/rect%3E%3C/g%3E%3C/g%3E%3C/svg%3E)

<本文完结>

1.  **转载请与本喵联系，私自抓取转载将被起诉**
    

🎉**让我们一起创造更多美好！** 🎉

  

如果您觉得这篇文章对您有帮助

感谢您为我**【点赞】**、**【在看】**

  

**<您为我点赞在看，只有我能看到>**

  

**👉****微信号：xiumaoprompt**

**添加请注明来意！**

本文转自 <https://mp.weixin.qq.com/s/wgxjYRTd2kLB_POukhkTGg?scene=1&click_id=30>，如有侵权，请联系删除。