/**
 * @file js/ui/components/progress-bar.js
 * @description 进度条组件 - ESM 模块化
 */

/**
 * 进度条配置
 */
const defaultConfig = {
  height: '4px',
  color: '#3b82f6',
  backgroundColor: '#e5e7eb',
  animationDuration: '300ms'
};

/**
 * 创建进度条
 * @param {HTMLElement|string} container - 容器元素或选择器
 * @param {Object} [options] - 配置选项
 * @returns {Object} 进度条控制器
 */
export function createProgressBar(container, options = {}) {
  const config = { ...defaultConfig, ...options };
  const containerEl = typeof container === 'string'
    ? document.querySelector(container)
    : container;

  if (!containerEl) {
    console.error('[ProgressBar] Container not found');
    return null;
  }

  // 创建进度条元素
  const wrapper = document.createElement('div');
  wrapper.className = 'progress-bar-wrapper';
  wrapper.style.cssText = `
    width: 100%;
    height: ${config.height};
    background: ${config.backgroundColor};
    border-radius: 2px;
    overflow: hidden;
  `;

  const bar = document.createElement('div');
  bar.className = 'progress-bar-fill';
  bar.style.cssText = `
    width: 0%;
    height: 100%;
    background: ${config.color};
    transition: width ${config.animationDuration} ease-out;
  `;

  wrapper.appendChild(bar);
  containerEl.appendChild(wrapper);

  let currentProgress = 0;

  return {
    /**
     * 设置进度
     * @param {number} percent - 进度百分比 (0-100)
     */
    setProgress(percent) {
      currentProgress = Math.max(0, Math.min(100, percent));
      bar.style.width = `${currentProgress}%`;
    },

    /**
     * 获取当前进度
     */
    getProgress() {
      return currentProgress;
    },

    /**
     * 增加进度
     * @param {number} delta - 增加量
     */
    increment(delta = 1) {
      this.setProgress(currentProgress + delta);
    },

    /**
     * 重置进度
     */
    reset() {
      this.setProgress(0);
    },

    /**
     * 完成（设为100%）
     */
    complete() {
      this.setProgress(100);
    },

    /**
     * 设置颜色
     */
    setColor(color) {
      bar.style.background = color;
    },

    /**
     * 显示
     */
    show() {
      wrapper.style.display = 'block';
    },

    /**
     * 隐藏
     */
    hide() {
      wrapper.style.display = 'none';
    },

    /**
     * 销毁
     */
    destroy() {
      if (wrapper.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
      }
    },

    /**
     * 获取元素
     */
    getElement() {
      return wrapper;
    }
  };
}

/**
 * 创建带标签的进度条
 */
export function createLabeledProgressBar(container, options = {}) {
  const containerEl = typeof container === 'string'
    ? document.querySelector(container)
    : container;

  if (!containerEl) {
    console.error('[ProgressBar] Container not found');
    return null;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'labeled-progress-bar';
  wrapper.innerHTML = `
    <div class="progress-info" style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 14px;">
      <span class="progress-label">${options.label || ''}</span>
      <span class="progress-percent">0%</span>
    </div>
    <div class="progress-container"></div>
  `;

  containerEl.appendChild(wrapper);

  const progressContainer = wrapper.querySelector('.progress-container');
  const percentLabel = wrapper.querySelector('.progress-percent');
  const labelEl = wrapper.querySelector('.progress-label');

  const progressBar = createProgressBar(progressContainer, options);

  return {
    ...progressBar,

    setProgress(percent) {
      progressBar.setProgress(percent);
      percentLabel.textContent = `${Math.round(percent)}%`;
    },

    setLabel(text) {
      labelEl.textContent = text;
    },

    destroy() {
      progressBar.destroy();
      if (wrapper.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
      }
    },

    getElement() {
      return wrapper;
    }
  };
}

/**
 * 创建文件处理进度条
 */
export function createFileProgressBar(container, options = {}) {
  const bar = createLabeledProgressBar(container, {
    label: options.label || '处理进度',
    ...options
  });

  if (!bar) return null;

  let total = 0;
  let completed = 0;
  let errors = 0;

  const wrapper = bar.getElement();
  const statsEl = document.createElement('div');
  statsEl.className = 'progress-stats';
  statsEl.style.cssText = 'font-size: 12px; color: #6b7280; margin-top: 4px;';
  wrapper.appendChild(statsEl);

  function updateStats() {
    statsEl.textContent = `完成: ${completed}/${total}${errors > 0 ? ` | 错误: ${errors}` : ''}`;
    if (total > 0) {
      bar.setProgress((completed / total) * 100);
    }
  }

  return {
    ...bar,

    setTotal(n) {
      total = n;
      completed = 0;
      errors = 0;
      updateStats();
    },

    incrementCompleted() {
      completed++;
      updateStats();
    },

    incrementErrors() {
      errors++;
      updateStats();
    },

    setCompleted(n) {
      completed = n;
      updateStats();
    },

    setErrors(n) {
      errors = n;
      updateStats();
    },

    reset() {
      total = 0;
      completed = 0;
      errors = 0;
      bar.reset();
      updateStats();
    },

    getStats() {
      return { total, completed, errors };
    }
  };
}

// 默认导出
export default {
  create: createProgressBar,
  createLabeled: createLabeledProgressBar,
  createFileProgress: createFileProgressBar
};
