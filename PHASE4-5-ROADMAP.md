# Paper Burner - Phase 4 & Phase 5 性能优化路线图

## 📋 当前状态回顾 (Phase 3.5 已完成)

### ✅ 已完成的优化
1. **智能降频机制**（Phase 3）
   - 前台 400ms / 后台 1500ms 更新间隔
   - 防抖延迟 100ms

2. **增量渲染**（Phase 3.5）
   - 流式更新只渲染最后一条消息
   - 支持 content 和 reasoning 的独立更新
   - 使用长度判断避免无效更新

3. **智能跳帧与衰减机制**（Phase 3.5）
   - 渲染慢时逐步降频（1x → 2x → 4x）
   - 渲染快时逐步恢复（4x → 2x → 1x）

4. **统一配置管理**（Phase 3.5）
   - `window.PerformanceConfig` - 性能配置
   - `window.PerfLogger` - 日志工具
   - `window.ChatbotRenderState` - 状态管理

5. **日志优化**（Phase 3.5）
   - FormulaPostProcessor 只在有处理时输出
   - Renderer 警告只输出一次
   - 图片警告去重

### 📊 当前性能指标
- **流式更新频率**: 每 0.5 秒（400ms 间隔 + 100ms 防抖）
- **智能跳帧**: 根据渲染耗时动态调整（1x ~ 4x）
- **增量渲染**: 只更新变化的内容，避免全量重渲染

---

## 🎯 Phase 4: 精细化性能优化

**目标**: 进一步降低渲染开销，提升流畅度，优化长对话场景

### 4.1 滚动性能优化 🔴 高优先级

#### 问题
- Code Review 发现：表格滚动监听器（[chatbot-ui.js:600-626](f:/pb/paper-burner/js/chatbot/ui/chatbot-ui.js#L600-L626)）没有防抖/节流
- 每次滚动都触发事件，在流式更新期间可能加重性能负担

#### 方案 A: requestAnimationFrame 优化
```javascript
// 使用 RAF 节流滚动事件
let scrollRAF = null;
table.addEventListener('scroll', () => {
  if (scrollRAF) return;
  scrollRAF = requestAnimationFrame(() => {
    const isScrolledToEnd = table.scrollLeft >= (table.scrollWidth - table.clientWidth - 5);
    table.classList.toggle('scrolled-to-end', isScrolledToEnd);
    scrollRAF = null;
  });
});
```

**优点**：
- 与浏览器刷新率同步
- 性能最优

**缺点**：
- 仍需监听每次滚动事件

#### 方案 B: Intersection Observer API ⭐ 推荐
```javascript
// 使用 Intersection Observer 检测表格边界
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    const table = entry.target.closest('table');
    table.classList.toggle('scrolled-to-end', entry.isIntersecting);
  });
}, { root: table, threshold: 1.0 });

// 观察表格的最右侧元素
const lastCell = table.querySelector('tr:first-child td:last-child');
observer.observe(lastCell);
```

**优点**：
- 浏览器原生优化，性能最好
- 不需要监听 scroll 事件
- 自动处理多个表格

**缺点**：
- 需要确保表格结构正确

#### 实施计划
- [ ] **4.1.1** 实现 Intersection Observer 方案
- [ ] **4.1.2** 添加降级方案（RAF 节流）
- [ ] **4.1.3** 性能测试对比（100 个表格场景）

---

### 4.2 增量渲染优化 🟡 中优先级

#### 问题
- 当前增量渲染：重新渲染整个 `content` 和 `reasoning`
- 对于长文本，每次都完整渲染 KaTeX/Markdown 仍有开销

#### 方案: 文本 Diff 增量更新
```javascript
// 只更新新增的部分
const oldContent = contentDiv.dataset.lastContent || '';
const newContent = lastMessage.content;

if (newContent.startsWith(oldContent)) {
  // 新内容是旧内容的扩展，只追加新增部分
  const appendedText = newContent.slice(oldContent.length);
  const appendedHtml = renderWithKatexStreaming(appendedText);

  // 创建临时容器解析新HTML
  const temp = document.createElement('div');
  temp.innerHTML = appendedHtml;

  // 追加到现有内容
  while (temp.firstChild) {
    contentDiv.appendChild(temp.firstChild);
  }

  contentDiv.dataset.lastContent = newContent;
} else {
  // 内容不是扩展（可能是回退），完整重渲染
  contentDiv.innerHTML = renderWithKatexStreaming(newContent);
  contentDiv.dataset.lastContent = newContent;
}
```

**优点**：
- 减少重复渲染
- 特别适合流式输出场景

**缺点**：
- 复杂度增加
- 需要处理边界情况（内容回退、编辑）

**风险**：
- Markdown 结构可能跨越追加边界（如代码块、列表）
- 需要智能判断是否可以追加

#### 实施计划
- [ ] **4.2.1** 实现简单追加逻辑（纯文本）
- [ ] **4.2.2** 处理 Markdown 结构边界问题
- [ ] **4.2.3** A/B 测试验证性能提升

---

### 4.3 虚拟滚动 (长对话优化) 🟢 低优先级

#### 问题
- 对话历史超过 100 条时，DOM 节点过多
- 滚动性能下降，内存占用增加

#### 方案: 虚拟滚动实现
```javascript
// 只渲染可见区域的消息
const VISIBLE_MESSAGES = 20; // 可见消息数量
const BUFFER_MESSAGES = 5;   // 上下缓冲区

const visibleRange = calculateVisibleRange(
  chatBody.scrollTop,
  chatBody.clientHeight,
  VISIBLE_MESSAGES,
  BUFFER_MESSAGES
);

// 只渲染 visibleRange 内的消息
const messagesHtml = window.ChatbotCore.chatHistory
  .slice(visibleRange.start, visibleRange.end)
  .map((m, index) => renderMessage(m, visibleRange.start + index))
  .join('');
```

**优点**：
- 大幅减少 DOM 节点数量
- 支持无限长对话历史

**缺点**：
- 实现复杂度高
- 需要处理滚动定位
- 搜索、复制等功能需要适配

#### 实施计划
- [ ] **4.3.1** 调研虚拟滚动库（react-window, vue-virtual-scroller）
- [ ] **4.3.2** 设计消息高度缓存机制
- [ ] **4.3.3** 实现虚拟滚动原型
- [ ] **4.3.4** 完整功能适配（搜索、复制、导出）

---

### 4.4 配置优化和 A/B 测试 🟡 中优先级

#### 目标
- 找到最优的性能配置参数
- 支持不同设备的动态配置

#### 方案: 设备自适应配置
```javascript
window.PerformanceConfig = {
  UPDATE_INTERVALS: {
    // 根据设备性能动态调整
    FOREGROUND: detectDevicePerformance() === 'high' ? 300 : 400,
    BACKGROUND: 1500,
    DEBOUNCE: 100
  },

  ADAPTIVE_RENDER: {
    // 根据 CPU 核心数调整阈值
    HEAVY_THRESHOLD: navigator.hardwareConcurrency > 4 ? 300 : 200,
    MIN_MULTIPLIER: 1,
    MAX_MULTIPLIER: detectDevicePerformance() === 'low' ? 8 : 4
  }
};

function detectDevicePerformance() {
  const memory = navigator.deviceMemory; // GB
  const cores = navigator.hardwareConcurrency;

  if (memory >= 8 && cores >= 8) return 'high';
  if (memory >= 4 && cores >= 4) return 'medium';
  return 'low';
}
```

#### A/B 测试框架
```javascript
window.PerformanceExperiment = {
  variant: localStorage.getItem('perf_variant') || 'control',

  getConfig(key) {
    const variants = {
      control: { FOREGROUND: 400, DEBOUNCE: 100 },
      variant_a: { FOREGROUND: 300, DEBOUNCE: 80 },
      variant_b: { FOREGROUND: 500, DEBOUNCE: 120 }
    };
    return variants[this.variant][key];
  }
};
```

#### 实施计划
- [ ] **4.4.1** 实现设备性能检测
- [ ] **4.4.2** 设计 A/B 测试框架
- [ ] **4.4.3** 收集性能数据（渲染耗时、FPS）
- [ ] **4.4.4** 分析最优配置

---

## 🚀 Phase 5: 架构级优化

**目标**: 引入现代 Web 技术，实现质的飞跃

### 5.1 Web Worker 多线程优化 🔴 高优先级

#### 目标
- 将重量级任务移到后台线程
- 避免阻塞主线程渲染

#### 方案: 任务分离
```javascript
// worker.js
self.addEventListener('message', (e) => {
  const { type, data } = e.data;

  switch (type) {
    case 'render_markdown':
      const html = marked.parse(data.content);
      self.postMessage({ type: 'result', html });
      break;

    case 'process_formulas':
      // 在 Worker 中处理 KaTeX 渲染
      const processed = processFormulas(data.content);
      self.postMessage({ type: 'result', processed });
      break;
  }
});
```

**适合 Worker 处理的任务**：
- ✅ Markdown 解析
- ✅ 语法高亮（highlight.js）
- ✅ 文本搜索和过滤
- ❌ DOM 操作（必须在主线程）
- ❌ KaTeX 渲染（依赖 DOM）

#### 实施计划
- [ ] **5.1.1** 评估哪些任务适合 Worker
- [ ] **5.1.2** 实现 Markdown Worker
- [ ] **5.1.3** 实现通信队列和任务调度
- [ ] **5.1.4** 性能测试和回退方案

---

### 5.2 Service Worker 缓存优化 🟡 中优先级

#### 目标
- 缓存静态资源（JS/CSS）
- 离线可用
- 加快首屏加载

#### 方案
```javascript
// service-worker.js
const CACHE_NAME = 'paper-burner-v1';
const urlsToCache = [
  '/js/chatbot/config/performance-config.js',
  '/js/chatbot/core/message-sender.js',
  '/js/chatbot/ui/chatbot-ui.js',
  '/js/processing/markdown_processor_ast.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});
```

#### 实施计划
- [ ] **5.2.1** 设计缓存策略（Cache First / Network First）
- [ ] **5.2.2** 实现 Service Worker
- [ ] **5.2.3** 添加版本管理和更新机制
- [ ] **5.2.4** 测试离线功能

---

### 5.3 性能监控和上报系统 🟡 中优先级

#### 目标
- 实时监控性能指标
- 收集用户设备数据
- 指导优化方向

#### 方案: Performance Observer API
```javascript
window.PerfMonitor = {
  metrics: {
    renderTime: [],
    fps: [],
    memoryUsage: []
  },

  init() {
    // 监控长任务
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) {
          this.reportLongTask(entry);
        }
      }
    });
    observer.observe({ entryTypes: ['longtask'] });

    // 监控 FPS
    this.measureFPS();

    // 监控内存（Chrome only）
    if (performance.memory) {
      setInterval(() => {
        this.metrics.memoryUsage.push({
          used: performance.memory.usedJSHeapSize,
          total: performance.memory.totalJSHeapSize,
          timestamp: Date.now()
        });
      }, 5000);
    }
  },

  measureFPS() {
    let lastTime = performance.now();
    let frames = 0;

    const loop = () => {
      frames++;
      const now = performance.now();

      if (now >= lastTime + 1000) {
        const fps = Math.round((frames * 1000) / (now - lastTime));
        this.metrics.fps.push({ fps, timestamp: Date.now() });
        frames = 0;
        lastTime = now;
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  },

  report() {
    // 定期上报到服务器
    const summary = {
      avgRenderTime: average(this.metrics.renderTime),
      avgFPS: average(this.metrics.fps.map(f => f.fps)),
      peakMemory: Math.max(...this.metrics.memoryUsage.map(m => m.used)),
      device: {
        cores: navigator.hardwareConcurrency,
        memory: navigator.deviceMemory,
        userAgent: navigator.userAgent
      }
    };

    // 发送到分析服务
    navigator.sendBeacon('/api/performance', JSON.stringify(summary));
  }
};
```

#### 实施计划
- [ ] **5.3.1** 实现 Performance Observer 监控
- [ ] **5.3.2** 设计性能指标上报接口
- [ ] **5.3.3** 搭建性能数据分析看板
- [ ] **5.3.4** 设置性能预算和告警

---

### 5.4 懒加载和代码分割 🟢 低优先级

#### 目标
- 减少首屏加载时间
- 按需加载功能模块

#### 方案
```javascript
// 动态导入
async function loadChatbot() {
  const { initChatbotUI } = await import('./js/chatbot/ui/chatbot-ui.js');
  const { ChatbotCore } = await import('./js/chatbot/core/chatbot-core.js');

  initChatbotUI();
}

// 功能模块懒加载
async function loadAdvancedFeatures() {
  if (window.chatbotActiveOptions.enableSemanticFeatures) {
    await import('./js/chatbot/agents/semantic-vector-search.js');
  }

  if (window.chatbotActiveOptions.multiHopRetrieval) {
    await import('./js/chatbot/core/streaming-multi-hop.js');
  }
}
```

#### 实施计划
- [ ] **5.4.1** 模块依赖分析
- [ ] **5.4.2** 实现动态导入
- [ ] **5.4.3** 优化打包配置（Webpack/Rollup）
- [ ] **5.4.4** 测试加载性能

---

### 5.5 图片优化 🟢 低优先级

#### 方案
1. **懒加载**
```javascript
const images = chatBody.querySelectorAll('img[data-src]');
const imageObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target;
      img.src = img.dataset.src;
      imageObserver.unobserve(img);
    }
  });
});

images.forEach(img => imageObserver.observe(img));
```

2. **响应式图片**
```html
<img
  srcset="image-320w.jpg 320w,
          image-640w.jpg 640w,
          image-1280w.jpg 1280w"
  sizes="(max-width: 320px) 280px,
         (max-width: 640px) 600px,
         1200px"
  src="image-640w.jpg"
  alt="..." />
```

#### 实施计划
- [ ] **5.5.1** 实现图片懒加载
- [ ] **5.5.2** 生成多尺寸图片
- [ ] **5.5.3** 集成图片 CDN

---

## 📊 优先级矩阵

| 优化项 | 性能提升 | 实现难度 | 优先级 | 预计周期 |
|--------|---------|---------|--------|---------|
| 4.1 滚动性能优化 | 🔥🔥🔥 | ⭐⭐ | 🔴 高 | 2-3 天 |
| 4.4 配置优化与 A/B 测试 | 🔥🔥 | ⭐⭐ | 🟡 中 | 3-5 天 |
| 4.2 增量渲染优化 | 🔥🔥 | ⭐⭐⭐⭐ | 🟡 中 | 5-7 天 |
| 5.1 Web Worker | 🔥🔥🔥🔥 | ⭐⭐⭐⭐⭐ | 🔴 高 | 1-2 周 |
| 5.3 性能监控 | 🔥 | ⭐⭐⭐ | 🟡 中 | 3-5 天 |
| 4.3 虚拟滚动 | 🔥🔥🔥 | ⭐⭐⭐⭐⭐ | 🟢 低 | 1-2 周 |
| 5.2 Service Worker | 🔥🔥 | ⭐⭐⭐ | 🟡 中 | 5-7 天 |
| 5.4 代码分割 | 🔥 | ⭐⭐⭐ | 🟢 低 | 3-5 天 |
| 5.5 图片优化 | 🔥 | ⭐⭐ | 🟢 低 | 2-3 天 |

---

## 🎯 推荐实施顺序

### Phase 4.1 (立即执行)
**Week 1-2**
1. ✅ 滚动性能优化（Intersection Observer）
2. ✅ 配置优化与设备自适应

### Phase 4.2 (短期)
**Week 3-4**
1. ✅ A/B 测试框架搭建
2. ✅ 增量渲染优化（可选，根据测试结果决定）

### Phase 5.1 (中期)
**Week 5-8**
1. ✅ 性能监控系统
2. ✅ Web Worker 多线程优化
3. ✅ Service Worker 缓存

### Phase 5.2 (长期)
**Week 9-12**
1. ✅ 虚拟滚动（如有需求）
2. ✅ 代码分割和懒加载
3. ✅ 图片优化

---

## 📈 预期效果

### Phase 4 完成后
- **渲染帧率**: 55-60 FPS（当前 50-55 FPS）
- **滚动流畅度**: 提升 30%
- **长对话性能**: 支持 500+ 消息无卡顿

### Phase 5 完成后
- **首屏加载**: 减少 40%（代码分割）
- **主线程空闲率**: 提升 50%（Web Worker）
- **离线可用**: 支持（Service Worker）
- **超长对话**: 支持 1000+ 消息（虚拟滚动）

---

## 🛠️ 技术栈

### 已使用
- ✅ Performance API
- ✅ requestAnimationFrame
- ✅ MutationObserver（事件委托）

### 待引入
- ⏳ Intersection Observer API
- ⏳ Web Worker
- ⏳ Service Worker
- ⏳ Performance Observer API
- ⏳ PerformanceNavigationTiming
- ⏳ Long Tasks API

---

## 📝 备注

1. **兼容性考虑**
   - Intersection Observer: Chrome 51+, Safari 12.1+
   - Web Worker: 所有现代浏览器
   - Service Worker: HTTPS 必需

2. **降级方案**
   - 所有新特性都需要 feature detection
   - 不支持时回退到当前实现

3. **性能预算**
   - 主线程任务 < 50ms
   - 流式更新刷新率 > 2 Hz
   - FPS > 55
   - 内存增长 < 50MB/小时

---

## 🔗 相关文档

- [Phase 3.5 Code Review 修复报告](phase3.5-code-review-fixes.md)
- [Performance Config 配置说明](../js/chatbot/config/performance-config.js)
- [Intersection Observer MDN](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
- [Web Workers MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
