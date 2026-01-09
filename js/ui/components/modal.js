/**
 * @file js/ui/components/modal.js
 * @description 模态框组件 - ESM 模块化
 */

let modalStack = [];
let backdropEl = null;

/**
 * 确保背景遮罩存在
 */
function ensureBackdrop() {
  if (backdropEl && document.body.contains(backdropEl)) return backdropEl;

  backdropEl = document.createElement('div');
  backdropEl.className = 'modal-backdrop';
  backdropEl.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 9998;
    opacity: 0;
    transition: opacity 0.2s;
    display: none;
  `;

  backdropEl.addEventListener('click', (e) => {
    if (e.target === backdropEl && modalStack.length > 0) {
      const topModal = modalStack[modalStack.length - 1];
      if (topModal.closeOnBackdrop) {
        topModal.close();
      }
    }
  });

  document.body.appendChild(backdropEl);
  return backdropEl;
}

/**
 * 更新背景遮罩状态
 */
function updateBackdrop() {
  const backdrop = ensureBackdrop();
  if (modalStack.length > 0) {
    backdrop.style.display = 'block';
    requestAnimationFrame(() => {
      backdrop.style.opacity = '1';
    });
  } else {
    backdrop.style.opacity = '0';
    setTimeout(() => {
      if (modalStack.length === 0) {
        backdrop.style.display = 'none';
      }
    }, 200);
  }
}

/**
 * 创建模态框
 * @param {Object} options - 配置选项
 * @returns {Object} 模态框控制器
 */
export function createModal(options = {}) {
  const {
    title = '',
    content = '',
    footer = null,
    width = '500px',
    maxHeight = '80vh',
    closeOnBackdrop = true,
    closeOnEscape = true,
    showClose = true,
    className = '',
    onOpen = null,
    onClose = null
  } = options;

  // 创建模态框元素
  const modal = document.createElement('div');
  modal.className = `modal ${className}`.trim();
  modal.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0.9);
    background: white;
    border-radius: 12px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
    z-index: 9999;
    width: ${width};
    max-width: 90vw;
    max-height: ${maxHeight};
    display: flex;
    flex-direction: column;
    opacity: 0;
    transition: opacity 0.2s, transform 0.2s;
  `;

  // 标题栏
  const header = document.createElement('div');
  header.className = 'modal-header';
  header.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #e5e7eb;
  `;

  const titleEl = document.createElement('h3');
  titleEl.className = 'modal-title';
  titleEl.style.cssText = 'margin: 0; font-size: 18px; font-weight: 600;';
  titleEl.textContent = title;
  header.appendChild(titleEl);

  if (showClose) {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'modal-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.style.cssText = `
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      line-height: 1;
      color: #9ca3af;
    `;
    closeBtn.addEventListener('click', () => controller.close());
    header.appendChild(closeBtn);
  }

  modal.appendChild(header);

  // 内容区
  const body = document.createElement('div');
  body.className = 'modal-body';
  body.style.cssText = `
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  `;

  if (typeof content === 'string') {
    body.innerHTML = content;
  } else if (content instanceof HTMLElement) {
    body.appendChild(content);
  }

  modal.appendChild(body);

  // 底部
  if (footer) {
    const footerEl = document.createElement('div');
    footerEl.className = 'modal-footer';
    footerEl.style.cssText = `
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 16px 20px;
      border-top: 1px solid #e5e7eb;
    `;

    if (typeof footer === 'string') {
      footerEl.innerHTML = footer;
    } else if (footer instanceof HTMLElement) {
      footerEl.appendChild(footer);
    } else if (Array.isArray(footer)) {
      footer.forEach(btn => {
        const button = document.createElement('button');
        button.textContent = btn.text;
        button.className = btn.className || 'btn';
        button.style.cssText = btn.style || '';
        if (btn.onClick) {
          button.addEventListener('click', () => btn.onClick(controller));
        }
        footerEl.appendChild(button);
      });
    }

    modal.appendChild(footerEl);
  }

  // ESC 键处理
  function handleEscape(e) {
    if (e.key === 'Escape' && closeOnEscape && modalStack[modalStack.length - 1] === controller) {
      controller.close();
    }
  }

  const controller = {
    element: modal,
    closeOnBackdrop,

    open() {
      ensureBackdrop();
      document.body.appendChild(modal);
      modalStack.push(controller);
      updateBackdrop();

      requestAnimationFrame(() => {
        modal.style.opacity = '1';
        modal.style.transform = 'translate(-50%, -50%) scale(1)';
      });

      document.addEventListener('keydown', handleEscape);
      onOpen?.();
      return this;
    },

    close() {
      modal.style.opacity = '0';
      modal.style.transform = 'translate(-50%, -50%) scale(0.9)';

      setTimeout(() => {
        if (modal.parentNode) {
          modal.parentNode.removeChild(modal);
        }
        modalStack = modalStack.filter(m => m !== controller);
        updateBackdrop();
      }, 200);

      document.removeEventListener('keydown', handleEscape);
      onClose?.();
      return this;
    },

    setTitle(newTitle) {
      titleEl.textContent = newTitle;
      return this;
    },

    setContent(newContent) {
      if (typeof newContent === 'string') {
        body.innerHTML = newContent;
      } else if (newContent instanceof HTMLElement) {
        body.innerHTML = '';
        body.appendChild(newContent);
      }
      return this;
    },

    getBody() {
      return body;
    },

    getElement() {
      return modal;
    }
  };

  return controller;
}

/**
 * 确认对话框
 */
export function confirm(message, options = {}) {
  return new Promise((resolve) => {
    const modal = createModal({
      title: options.title || '确认',
      content: `<p>${message}</p>`,
      footer: [
        {
          text: options.cancelText || '取消',
          className: 'btn btn-secondary',
          onClick: (m) => {
            m.close();
            resolve(false);
          }
        },
        {
          text: options.confirmText || '确认',
          className: 'btn btn-primary',
          style: 'background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;',
          onClick: (m) => {
            m.close();
            resolve(true);
          }
        }
      ],
      ...options
    });
    modal.open();
  });
}

/**
 * 提示对话框
 */
export function alert(message, options = {}) {
  return new Promise((resolve) => {
    const modal = createModal({
      title: options.title || '提示',
      content: `<p>${message}</p>`,
      footer: [
        {
          text: options.buttonText || '确定',
          className: 'btn btn-primary',
          style: 'background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;',
          onClick: (m) => {
            m.close();
            resolve();
          }
        }
      ],
      ...options
    });
    modal.open();
  });
}

/**
 * 获取当前打开的模态框数量
 */
export function getOpenCount() {
  return modalStack.length;
}

/**
 * 关闭所有模态框
 */
export function closeAll() {
  [...modalStack].forEach(m => m.close());
}

// 默认导出
export default {
  create: createModal,
  confirm,
  alert,
  getOpenCount,
  closeAll
};
