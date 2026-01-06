// Dock Settings Modal Logic (legacy script)
// - 保持可被 <script> 直接加载
// - 暴露 window.DockSettingsModal 供 ESM wrapper / 其他脚本调用

(function DockSettingsModal(global) {
  'use strict';

  if (typeof global === 'undefined' || typeof document === 'undefined') return;

  function getElements() {
    const modal = document.getElementById('dock-settings-modal');
    if (!modal) return null;

    return {
      modal,
      openBtn: document.getElementById('settings-link'),
      closeBtn: document.getElementById('dock-settings-close-btn'),
      saveBtn: document.getElementById('dock-settings-save-btn'),
      cancelBtn: document.getElementById('dock-settings-cancel-btn'),
      checkboxes: modal.querySelectorAll('.checkbox-group input[type="checkbox"]')
    };
  }

  function updateTocModeRadioButtons() {
    const tocPopup = document.getElementById('toc-popup');
    if (!tocPopup) return;

    const activeTocModeBtn = tocPopup.querySelector('.toc-mode-btn.active');
    if (!activeTocModeBtn) return;

    const mode = activeTocModeBtn.dataset.mode;
    const radioBtn = document.getElementById(`toc-mode-${mode}`);
    if (radioBtn) radioBtn.checked = true;
  }

  function syncTocModeSettings() {
    const docId = global.docIdForLocalStorage || '';
    if (!docId) return;

    const savedTocMode = localStorage.getItem(`tocMode_${docId}`);
    if (!savedTocMode || !['both', 'ocr', 'translation'].includes(savedTocMode)) return;

    const radioBtn = document.getElementById(`toc-mode-${savedTocMode}`);
    if (radioBtn) radioBtn.checked = true;

    const tocPopup = document.getElementById('toc-popup');
    if (tocPopup) {
      const tocModeBtn = tocPopup.querySelector(`.toc-mode-btn[data-mode="${savedTocMode}"]`);
      if (tocModeBtn) tocModeBtn.click();
    }
  }

  function openDockSettingsModal() {
    const els = getElements();
    if (!els) return false;

    if (!global.DockLogic || typeof global.DockLogic.getCurrentDisplayConfig !== 'function') {
      if (typeof global.alert === 'function') global.alert('DockLogic 功能尚未准备好。');
      return false;
    }

    const currentConfig = global.DockLogic.getCurrentDisplayConfig();
    if (!currentConfig || typeof currentConfig !== 'object') {
      if (typeof global.alert === 'function') global.alert('无法获取当前的 Dock 显示配置。');
      return false;
    }

    els.checkboxes.forEach((checkbox) => {
      const key = checkbox.dataset.configKey;
      if (Object.prototype.hasOwnProperty.call(currentConfig, key)) {
        checkbox.checked = !!currentConfig[key];
      }
    });

    updateTocModeRadioButtons();
    els.modal.classList.add('visible');
    return true;
  }

  function closeDockSettingsModal() {
    const els = getElements();
    if (!els) return false;
    els.modal.classList.remove('visible');
    return true;
  }

  function saveDockSettings() {
    const els = getElements();
    if (!els) return false;

    if (!global.DockLogic || typeof global.DockLogic.updateDisplayConfig !== 'function') {
      if (typeof global.alert === 'function') global.alert('DockLogic 功能尚未准备好。');
      return false;
    }

    const newConfig = {};
    els.checkboxes.forEach((checkbox) => {
      newConfig[checkbox.dataset.configKey] = !!checkbox.checked;
    });
    global.DockLogic.updateDisplayConfig(newConfig);

    // 保存 TOC 模式设置
    const selectedTocMode = document.querySelector('input[name="toc-mode"]:checked');
    if (selectedTocMode) {
      const tocMode = selectedTocMode.value;
      const tocPopup = document.getElementById('toc-popup');
      if (tocPopup) {
        const tocModeBtn = tocPopup.querySelector(`.toc-mode-btn[data-mode="${tocMode}"]`);
        if (tocModeBtn) tocModeBtn.click();
      }

      const docId = global.docIdForLocalStorage || '';
      if (docId) localStorage.setItem(`tocMode_${docId}`, tocMode);
    }

    closeDockSettingsModal();
    return true;
  }

  function initDockSettingsModal() {
    const els = getElements();
    if (!els) return false;

    if (els.modal.dataset.dockSettingsModalInitialized === 'true') return true;
    els.modal.dataset.dockSettingsModalInitialized = 'true';

    if (els.openBtn) {
      els.openBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openDockSettingsModal();
      });
    }

    if (els.closeBtn) els.closeBtn.addEventListener('click', closeDockSettingsModal);
    if (els.saveBtn) els.saveBtn.addEventListener('click', saveDockSettings);
    if (els.cancelBtn) els.cancelBtn.addEventListener('click', closeDockSettingsModal);

    els.modal.addEventListener('click', (event) => {
      if (event.target === els.modal) closeDockSettingsModal();
    });

    return true;
  }

  // 暴露到 window
  global.DockSettingsModal = {
    init: initDockSettingsModal,
    open: openDockSettingsModal,
    close: closeDockSettingsModal,
    save: saveDockSettings,
    syncTocModeSettings,
    updateTocModeRadioButtons
  };

  // 自动初始化（浏览器环境）
  const rs = document.readyState;
  if (rs === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initDockSettingsModal();
      syncTocModeSettings();
    });
  } else if (typeof rs === 'string') {
    initDockSettingsModal();
    syncTocModeSettings();
  } else {
    // 测试/非浏览器 DOM：不自动初始化
  }
})(window);

