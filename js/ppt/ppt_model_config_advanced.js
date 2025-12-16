/**
 * PPT 模型配置 - 高级设置/统计
 * IIFE module: window.PPTModelConfig.advanced
 */
(function(global) {
  'use strict';

  global.PPTModelConfig = global.PPTModelConfig || {};
  const ns = global.PPTModelConfig;
  ns.advanced = ns.advanced || {};

  const IMAGE_GEN_STATS_KEY = 'pptImageGenStats';
  
  function loadImageGenStats() {
    try {
      const raw = localStorage.getItem(IMAGE_GEN_STATS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { count: 0, lastTime: null, history: [] };
  }
  
  function saveImageGenStats(stats) {
    localStorage.setItem(IMAGE_GEN_STATS_KEY, JSON.stringify(stats));
  }
  
  /**
   * 记录一次生图
   * @param {Object} options - { model, modelId, prompt, success }
   */
  function recordImageGeneration(options = {}) {
    const stats = loadImageGenStats();
    const now = Date.now();
    
    stats.count = (stats.count || 0) + 1;
    stats.lastTime = now;
    
    // 保留最近 100 条记录
    if (!Array.isArray(stats.history)) stats.history = [];
    stats.history.unshift({
      time: now,
      model: options.model || '',
      modelId: options.modelId || '',
      prompt: (options.prompt || '').substring(0, 100),
      success: options.success !== false
    });
    if (stats.history.length > 100) {
      stats.history = stats.history.slice(0, 100);
    }
    
    saveImageGenStats(stats);
    return stats;
  }
  
  function formatStatsDisplay(stats) {
    if (!stats || !stats.count) return '';
    
    const lastTimeStr = stats.lastTime 
      ? new Date(stats.lastTime).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '无';
    
    return `已生成 ${stats.count} 张图片 · 上次: ${lastTimeStr}`;
  }
  
  function updateStatsDisplay() {
    const el = document.getElementById('ppt-image-gen-stats');
    if (el) {
      el.textContent = formatStatsDisplay(loadImageGenStats());
    }
  }

  // ========== 高级设置 & 交互助手 ==========

  function toggleAdvancedSettings() {
      const panel = document.getElementById('pmc-image-settings-panel');
      const chevron = document.getElementById('pmc-settings-chevron');
      const btn = document.getElementById('ppt-image-processor-settings');
      
      if (!panel) return;
      const computedDisplay = window.getComputedStyle(panel).display;
      const isVisible = computedDisplay !== 'none';
      
      if (isVisible) {
          panel.style.display = 'none';
          if (chevron) chevron.setAttribute('icon', 'carbon:chevron-down');
          if (btn) btn.innerHTML = '<iconify-icon icon="carbon:chevron-down" width="16" id="pmc-settings-chevron"></iconify-icon> 展开图片处理设置';
      } else {
          panel.style.display = 'block';
          if (chevron) chevron.setAttribute('icon', 'carbon:chevron-up');
          if (btn) btn.innerHTML = '<iconify-icon icon="carbon:chevron-up" width="16" id="pmc-settings-chevron"></iconify-icon> 收起图片处理设置';
          
          // Smooth scroll to show the panel
          setTimeout(() => {
              panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 50);
      }
  }

  function bindImageSettingsEvents() {
      // Inputs
      const edgeSlider = document.getElementById('pmc-edge-threshold');
      const colorSlider = document.getElementById('pmc-color-tolerance');
      const presetSelect = document.getElementById('pmc-vectorize-preset');
      const ocrRadios = document.querySelectorAll('input[name="pmc-ocr-priority"]');

      if (edgeSlider) {
          edgeSlider.oninput = () => document.getElementById('pmc-edge-val').textContent = edgeSlider.value;
          edgeSlider.onchange = () => saveImageSettings();
      }
      if (colorSlider) {
          colorSlider.oninput = () => document.getElementById('pmc-color-val').textContent = colorSlider.value;
          colorSlider.onchange = () => saveImageSettings();
      }
      if (presetSelect) {
          presetSelect.onchange = () => saveImageSettings();
      }
      ocrRadios.forEach(r => r.onchange = () => saveImageSettings());
  }

  function loadImageSettings() {
      const config = (window.imageProcessor && window.imageProcessor.config) || (() => {
          try { return JSON.parse(localStorage.getItem('imageProcessorConfig')) || {}; } catch(e) { return {}; }
      })();
      
      // Defaults
      const ocrPriority = config.ocrPriority || 'mineru';
      const vectorizePreset = config.vectorizePreset || 'auto';
      const edgeThreshold = (config.bgRemover && config.bgRemover.edgeThreshold) || 30;
      const colorTolerance = (config.bgRemover && config.bgRemover.colorTolerance) || 25;

      // Set Values
      const radio = document.querySelector(`input[name="pmc-ocr-priority"][value="${ocrPriority}"]`);
      if (radio) radio.checked = true;

      const presetSel = document.getElementById('pmc-vectorize-preset');
      if (presetSel) presetSel.value = vectorizePreset;

      const edgeSlider = document.getElementById('pmc-edge-threshold');
      if (edgeSlider) { edgeSlider.value = edgeThreshold; document.getElementById('pmc-edge-val').textContent = edgeThreshold; }

      const colorSlider = document.getElementById('pmc-color-tolerance');
      if (colorSlider) { colorSlider.value = colorTolerance; document.getElementById('pmc-color-val').textContent = colorTolerance; }

      updateOcrStatus();
  }

  function saveImageSettings() {
      const ocrPriority = document.querySelector('input[name="pmc-ocr-priority"]:checked')?.value || 'mineru';
      const vectorizePreset = document.getElementById('pmc-vectorize-preset')?.value || 'auto';
      const edgeThreshold = parseInt(document.getElementById('pmc-edge-threshold')?.value || 30);
      const colorTolerance = parseInt(document.getElementById('pmc-color-tolerance')?.value || 25);

      const config = {
          ocrPriority,
          vectorizePreset,
          bgRemover: { edgeThreshold, colorTolerance }
      };

      // Save to ImageProcessor global instance if available
      if (window.imageProcessor && typeof window.imageProcessor.saveConfig === 'function') {
          window.imageProcessor.saveConfig(config);
      }
      // Save to LocalStorage
      localStorage.setItem('imageProcessorConfig', JSON.stringify(config));
  }

  function updateOcrStatus() {
      const el = document.getElementById('pmc-ocr-status');
      if (!el) return;

      if (!window.imageProcessor) {
          el.innerHTML = '<span style="color:#64748b">进入图片编辑器后可用</span>';
          return;
      }
      
      const avail = typeof window.imageProcessor.getOcrAvailability === 'function' 
          ? window.imageProcessor.getOcrAvailability() 
          : { mineru: false, vlm: false };

      const mStatus = avail.mineru ? '<span style="color:#10b981">● 可用</span>' : '<span style="color:#ef4444">● 未配置</span>';
      const vStatus = avail.vlm ? '<span style="color:#10b981">● 可用</span>' : '<span style="color:#ef4444">● 未配置</span>';

      el.innerHTML = `MinerU: ${mStatus} &nbsp;&nbsp; 视觉模型: ${vStatus}`;
  }

  Object.assign(ns.advanced, {
    toggleAdvancedSettings,
    bindImageSettingsEvents,
    loadImageSettings,
    saveImageSettings,
    updateOcrStatus,
    recordImageGeneration,
    loadImageGenStats,
    formatStatsDisplay,
    updateStatsDisplay
  });
})(typeof window !== 'undefined' ? window : this);
