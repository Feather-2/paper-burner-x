# PPT 生成流程 UI 架构优化方案

## 1. 核心问题诊断

### 1.1 交互流程层面 (UX)
*   **状态跳变不连贯**：目前流程（上传 -> 配置 -> 需求 -> 大纲）在不同文件和不同渲染函数间切换，缺乏统一的“进度感”。
*   **重复确认**：用户在“上传”后需要多次点击进入下一步，没有形成一站式的向导体验。
*   **反馈缺失**：在生成配置和需求填写阶段，用户难以预知接下来的步骤。

### 1.2 代码结构层面 (DX)
*   **巨型 HTML 字符串**：`ppt_dashboard_upload.js` 等文件中充斥着几百行的模板字符串，极难维护和调试。
*   **全局状态污染**：严重依赖 `window.PPTGenerator` 和 `this.workflowData` 的直接修改，缺乏明确的状态变更接口。
*   **耦合度高**：UI 渲染逻辑与业务逻辑（如文件上传、API 调用）深度耦合，难以单独测试或复用。

---

## 2. 优化方案：基于“向导式任务流 (Wizard-based TaskFlow)”

### 2.1 交互设计建议
我们将流程抽象为 **Wizard (向导)** 模式，每个步骤为一个 **Step**。

```mermaid
graph LR
    A[开始研究] --> B[配置与需求]
    B --> C[DeepSearch 研究]
    C --> D[大纲确认]
    D --> E[设计与生成]
```

*   **合并配置与需求**：将“生成模式选择”、“参数调整”与“项目需求填写”整合在一个连贯的表单界面中，减少跳转。
*   **实时反馈**：在填写需求时，侧边栏实时显示已选配置的摘要。
*   **可视化进度条**：在顶部增加清晰的 Stepper，明确当前所处位置。

### 2.2 架构重构方案

#### 1) 组件化渲染 (Componentized Rendering)
不再使用巨型模板字符串，而是采用小型、专注的渲染函数，并将其组织为 **DashboardView** 对象。

```javascript
// 示例：新的渲染组织方式
const Steps = {
  ResearchInit: () => `...`,
  ConfigAndBrief: (data) => `...`,
  OutlineReview: (outline) => `...`,
};

class PPTWizard {
  render(step) {
    const content = Steps[step](this.data);
    this.container.innerHTML = content;
    this.postRender(step);
  }
}
```

#### 2) 分层设计 (Layered Design)
*   **View Layer**: 只负责 HTML 字符串的拼接和 DOM 事件绑定。
*   **Action/Controller Layer**: 响应 UI 事件，调用 Workflow 逻辑，并更新状态。
*   **State Layer**: 统一管理 `workflowData`，通过 `setState` 触发重新渲染。

#### 3) 样式隔离 (CSS Scoping)
将样式从 JS 模板中提取到独立的 CSS 文件，或者采用更严格的 BEM 命名规范，避免 `.rd-card` 这种通用类名冲突。

---

## 3. 实施步骤 (TODO)

1.  **定义 Step 状态机**：在 `workflow-states.js` 中规范化所有 UI 步骤。
2.  **提取 CSS**：将 `_renderUploadSharedStyles` 中的样式迁移到独立文件。
3.  **拆分组件**：
    *   `SourceSelector.js`: 负责文件/链接上传。
    *   `ProjectBriefForm.js`: 负责需求和配置。
    *   `OutlineEditor.js`: 负责大纲交互。
4.  **引入全局 Dispatcher**：替换 `window.PPTGenerator.xxx()`，改用统一的事件分发。

---

## 4. 讨论点
*   **UI 风格方向**：是否需要更激进的视觉改动（如毛玻璃效果增强、动画过渡）？
*   **配置项精简**：是否默认隐藏高级配置，只显示核心需求填写？
*   **大纲编辑方式**：当前的思维导图预览是否足够好用？是否需要更强的交互性？
