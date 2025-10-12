# UI.js 重构测试指南

## 本次重构内容
- 提取了模型管理器核心模块 (ui_model_manager_core.js)
- ui.js 从 3789 行减少到 3549 行 (减少 240 行)
- 新增了 DOM 元素管理器 (ui_dom_elements.js)

## 测试前准备

### 1. 确认文件加载
打开浏览器开发者工具 (F12)，检查 Console 是否有错误：

```javascript
// 在 Console 中运行以下命令，检查模块是否正确加载：
console.log('ModelManager:', typeof window.ModelManager);  // 应该输出: function
console.log('modelManager:', typeof window.modelManager);  // 应该输出: object
console.log('UIElements:', typeof window.UIElements);      // 应该输出: object
console.log('supportedModelsForKeyManager:', window.supportedModelsForKeyManager);  // 应该输出模型数组
```

预期输出：
```
ModelManager: function
modelManager: object
UIElements: object
supportedModelsForKeyManager: Array(11) [{key: 'mistral', ...}, ...]
```

## 核心功能测试清单

### ✅ 模型管理器测试

#### 1. 打开模型管理器
- [ ] 点击页面上的"模型与 Key 管理"按钮
- [ ] 模态框应该正常弹出
- [ ] 左侧应该显示模型列表，分为三个组：
  - OCR 方式 (Mistral, MinerU, Doc2X)
  - 翻译和分析 API (DeepSeek, Gemini, 通义, 火山, DeepLX, 自定义)
  - 搜索和检索 (向量搜索, 学术搜索)

#### 2. 模型状态指示
- [ ] 已配置的模型前面应该有 **绿色圆点** ●
- [ ] 未配置的模型前面应该有 **灰色圆点** ●
- [ ] 如果当前 OCR 引擎未配置，应该显示 **红色警告提示**
- [ ] 如果没有翻译 Key，应该显示 **黄色警告提示**

#### 3. 选择模型
- [ ] 点击任意模型，应该：
  - 模型按钮变为 **蓝色高亮**
  - 中间栏显示该模型的配置界面
  - 右侧显示 Key 管理器（如果适用）

#### 4. 导入/导出功能
- [ ] 点击"导出全部"按钮
  - 应该下载一个 JSON 配置文件
- [ ] 点击"导入全部"按钮
  - 应该弹出文件选择对话框
  - 选择配置文件后应该导入成功并刷新列表

#### 5. 关闭模型管理器
- [ ] 点击右上角 X 关闭按钮
- [ ] 应该弹出确认对话框："是否刷新验证状态..."
- [ ] 模态框应该正常关闭

### ✅ 各模型配置测试

#### OCR 模型
- [ ] **Mistral OCR**: 点击后显示 API Key 配置界面
- [ ] **MinerU**: 点击后显示 Worker URL 和 Token 配置
- [ ] **Doc2X**: 点击后显示 Worker URL 和 Token 配置

#### 翻译模型
- [ ] **DeepSeek**: 显示默认模型选择和 Key 管理
- [ ] **Gemini**: 显示默认模型选择和 Key 管理
- [ ] **通义百炼**: 显示配置界面
- [ ] **火山引擎**: 显示配置界面
- [ ] **DeepLX**: 显示端点配置
- [ ] **自定义**: 显示源站点列表和管理界面

#### 搜索模块
- [ ] **向量搜索**: 显示 Embedding 配置界面
- [ ] **学术搜索**: 显示代理配置和搜索源管理

### ✅ 向后兼容性测试

在 Console 中测试原有的全局变量和函数：

```javascript
// 测试全局变量
console.log('mistralApiKeysTextarea:', mistralApiKeysTextarea);  // 应该是 DOM 元素
console.log('modelListColumn:', modelListColumn);  // 应该是 DOM 元素

// 测试函数
console.log('renderModelList:', typeof renderModelList);  // 应该是 function
console.log('selectModelForManager:', typeof selectModelForManager);  // 应该是 function

// 尝试调用函数（应该正常工作）
if (typeof renderModelList === 'function') {
    console.log('✅ renderModelList 函数可调用');
}
```

## 性能测试

### 检查页面加载时间
在 Console 中查看加载性能：

```javascript
// 检查新增模块的加载时间
performance.getEntriesByName('http://localhost:xxxx/js/ui/ui_model_manager_core.js')
performance.getEntriesByName('http://localhost:xxxx/js/ui/ui_dom_elements.js')
```

预期：每个文件加载时间 < 50ms

### 检查内存使用
1. 打开 DevTools > Memory
2. 拍摄堆快照 (Heap Snapshot)
3. 搜索 "ModelManager" 和 "UIElements"
4. 确认只有一个实例存在

## 错误排查

### 如果模型列表不显示
1. 检查 Console 是否有 JavaScript 错误
2. 检查 `window.modelManager` 是否存在：
   ```javascript
   console.log(window.modelManager);
   ```
3. 检查模块加载顺序（ui_model_manager_core.js 必须在 ui.js 之前）

### 如果点击模型没有反应
1. 检查是否有 DOM 事件冲突
2. 在 Console 中手动调用：
   ```javascript
   window.modelManager.selectModel('mistral');
   ```
3. 查看是否抛出异常

### 如果配置界面不显示
1. 检查 `renderModelConfigSection` 是否被正确导出：
   ```javascript
   console.log('renderModelConfigSection:', typeof window.renderModelConfigSection);
   ```
2. 确认函数可以被调用：
   ```javascript
   window.renderModelConfigSection('mistral');
   ```

## 回归测试

### 完整工作流测试
1. [ ] 上传 PDF 文件
2. [ ] 选择 OCR 引擎
3. [ ] 配置翻译模型
4. [ ] 点击"开始处理"
5. [ ] 查看处理进度
6. [ ] 下载处理结果

所有功能应该与重构前**完全一致**。

## 自动化测试（可选）

如果你想编写自动化测试，可以使用以下框架：

```javascript
// 简单的测试脚本
function runTests() {
    const tests = [
        {
            name: 'ModelManager 存在',
            test: () => typeof window.ModelManager === 'function'
        },
        {
            name: 'modelManager 实例存在',
            test: () => typeof window.modelManager === 'object'
        },
        {
            name: 'UIElements 存在',
            test: () => typeof window.UIElements === 'object'
        },
        {
            name: 'supportedModelsForKeyManager 是数组',
            test: () => Array.isArray(window.supportedModelsForKeyManager)
        },
        {
            name: 'renderModelList 函数存在',
            test: () => typeof renderModelList === 'function'
        }
    ];

    tests.forEach(({name, test}) => {
        try {
            const result = test();
            console.log(result ? '✅' : '❌', name);
        } catch (e) {
            console.log('❌', name, '- 错误:', e.message);
        }
    });
}

// 运行测试
runTests();
```

## 测试通过标准

- ✅ 所有 Console 检查都返回预期值
- ✅ 模型管理器可以正常打开和关闭
- ✅ 可以选择和配置各种模型
- ✅ 导入/导出功能正常
- ✅ 没有 JavaScript 错误
- ✅ 完整工作流可以正常运行
- ✅ 页面加载速度没有明显变慢

## 如果发现问题

请报告以下信息：
1. 浏览器版本和类型
2. Console 中的错误信息（截图）
3. 重现步骤
4. 预期行为 vs 实际行为

## 回滚方案

如果测试失败，可以快速回滚：

```bash
# 回滚到重构前的版本
git checkout HEAD~1 -- js/ui/ui.js
git checkout HEAD~1 -- index.html
# 删除新模块文件
rm js/ui/ui_model_manager_core.js
rm js/ui/ui_dom_elements.js
```

然后刷新页面即可恢复到重构前的状态。

---

## 快速测试（2分钟版本）

如果时间有限，至少测试以下关键功能：

1. ✅ 打开浏览器 DevTools Console
2. ✅ 运行: `console.log(window.modelManager)`，确认有输出
3. ✅ 点击"模型与 Key 管理"按钮
4. ✅ 点击任意一个模型
5. ✅ 关闭模型管理器
6. ✅ 上传一个 PDF 并处理

如果以上 6 步都正常，说明重构成功！✅
