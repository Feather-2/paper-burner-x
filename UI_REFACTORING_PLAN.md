# UI.js 重构计划

## 当前状态
- **文件大小**: 3789 行
- **主要内容**:
  - DOM 元素引用 (前 94 行)
  - DOMContentLoaded 事件处理器 (95-3789 行)
  - 模型管理器 UI
  - 文件管理
  - 设置面板
  - 进度显示
  - 自定义源站点管理

## 已完成模块

### 1. ui-notifications.js ✅ (已存在)
- 显示通知消息
- 关闭通知
- **导出**: `window.showNotification`, `window.closeNotification`

### 2. ui_dom_elements.js ✅ (新建)
- 集中管理所有 DOM 元素引用
- 提供便捷的访问方法
- **导出**: `window.UIElements`
- **向后兼容**: 所有元素也导出到 window 全局

## 待创建模块 (渐进式)

由于文件过大，采用**渐进式重构**策略：
- 保留 ui.js 主文件
- 只提取高复用、独立的功能模块
- 主文件中的代码继续工作，不影响功能

### 3. ui_progress.js (推荐提取)
**原因**: 进度相关逻辑独立，多处调用

**功能**:
- `updateProgress(percentage, step)` - 更新进度
- `showProgress()` - 显示进度条
- `hideProgress()` - 隐藏进度条
- `addProgressLog(message, type)` - 添加日志
- `clearProgressLog()` - 清空日志

**使用位置**: process.js, 批处理逻辑

### 4. ui_model_config.js (可选提取)
**原因**: 模型配置 UI 逻辑复杂，可独立

**功能**:
- 渲染模型列表
- 渲染 Key 管理器
- 源站点管理

**但考虑**: 这部分代码与 ui.js 耦合紧密，提取成本高

## 推荐重构策略

### 方案 A: 保守重构 (推荐)
1. ✅ 提取 DOM 元素管理 (已完成)
2. ✅ 保持通知系统独立 (已有)
3. ⏳ 提取进度显示模块
4. ⏭️ 主 ui.js 保持不变

**优势**:
- 风险最小
- 不影响现有功能
- 提取的模块可立即使用
- 主文件保持向后兼容

### 方案 B: 激进重构 (不推荐)
完全重构 ui.js 为 10+ 个模块

**劣势**:
- 工作量巨大
- 测试成本高
- 可能引入 bug
- HTML 文件需要大量修改

## 当前采用: 方案 A

## 文件结构

```
js/ui/
├── ui-notifications.js        (已存在)
├── ui_dom_elements.js         (✅ 新建)
├── ui_progress.js             (⏳ 待建)
└── ui.js                      (保持原样，向后兼容)
```

## 向后兼容保证

所有新模块：
1. 导出到 `window` 全局对象
2. 不破坏现有 API
3. ui.js 中的代码继续工作
4. 新代码可选择使用新模块

## 测试要点

- [ ] 文件拖放上传
- [ ] 模型选择和配置
- [ ] API Key 管理
- [ ] 批量模式切换
- [ ] 进度条显示
- [ ] 通知消息
- [ ] 结果下载
- [ ] 设置保存和加载

## 下一步

1. 创建 ui_progress.js 模块
2. 在 process.js 中测试使用新进度模块
3. 如果稳定，继续提取其他独立模块
4. 保持 ui.js 作为主协调文件
