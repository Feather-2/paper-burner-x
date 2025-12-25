/**
 * PPT 模型配置 - 视图/模板
 * IIFE module: window.PPTModelConfig.view
 */
(function(global) {
  'use strict';

  global.PPTModelConfig = global.PPTModelConfig || {};
  const ns = global.PPTModelConfig;
  ns.view = ns.view || {};

  /**
   * 获取模态框主 HTML 模板
   * @returns {string}
   */
  function getModalTemplate() {
    return `
      <div id="ppt-model-config-overlay" class="pmc-overlay-bg"></div>
      <div class="pmc-modal-container">
        <!-- Header -->
        <div class="pmc-header">
          <div class="pmc-header-left">
            <div class="pmc-header-icon">
              <iconify-icon icon="carbon:settings-adjust" width="24"></iconify-icon>
            </div>
            <div>
              <div class="pmc-title">PPT 模型配置</div>
              <div class="pmc-subtitle">独立于翻译/聊天模型，专用于 PPT 文案与配图</div>
            </div>
          </div>
          <button id="ppt-model-config-close" class="pmc-close-btn" title="关闭">
            <iconify-icon icon="carbon:close" width="24"></iconify-icon>
          </button>
        </div>

        <!-- Tab Navigation -->
        <div class="pmc-tabs-nav">
          <button class="pmc-tab-btn active" data-tab="models">
            <iconify-icon icon="carbon:list" width="16"></iconify-icon>
            全部模型
          </button>
          <button class="pmc-tab-btn" data-tab="roles">
            <iconify-icon icon="carbon:user-role" width="16"></iconify-icon>
            角色分配
          </button>
          <button class="pmc-tab-btn" data-tab="advanced">
            <iconify-icon icon="carbon:settings" width="16"></iconify-icon>
            高级设置
          </button>
        </div>

        <!-- Scrollable Content -->
        <div class="pmc-scroll-content">
          <!-- Tab 1: 全部模型 -->
          <div class="pmc-tab-panel active" data-panel="models">
            <div id="pmc-model-table-container"></div>
          </div>

          <!-- Tab 2: 角色配置 -->
          <div class="pmc-tab-panel" data-panel="roles">
            <div id="pmc-role-overview-container-tab" class="px-4 pt-4"></div>
          </div>

          <!-- Tab 3: 高级设置 -->
          <div class="pmc-tab-panel" data-panel="advanced">
            <div class="p-4 space-y-6">
              <!-- 音频配置 -->
              <div id="pmc-audio-container"></div>
              
              <!-- 图片处理设置 (Image Processor) -->
              <div id="pmc-image-settings-panel" class="pmc-advanced-settings" style="display:block; border: 1px solid var(--pmc-border); border-radius: 12px; overflow: hidden; margin-top: 16px;">
                  <div class="pmc-advanced-header">
                      <iconify-icon icon="carbon:image-service" width="16"></iconify-icon>
                      图片智能处理参数
                  </div>
                  <div class="pmc-advanced-body">
                      <!-- Left Col -->
                      <div class="pmc-col" style="border:none; padding:0; background:transparent;">
                          <div class="pmc-form-group">
                              <label class="pmc-label">OCR 引擎优先级</label>
                              <div class="pmc-radio-group">
                                  <label class="pmc-radio-item">
                                      <input type="radio" name="pmc-ocr-priority" value="mineru">
                                      <span>MinerU 优先 <span class="pmc-hint-text">(精确 bbox)</span></span>
                                  </label>
                                  <label class="pmc-radio-item">
                                      <input type="radio" name="pmc-ocr-priority" value="vlm">
                                      <span>视觉模型优先 <span class="pmc-hint-text">(复杂排版)</span></span>
                                  </label>
                                  <label class="pmc-radio-item">
                                      <input type="radio" name="pmc-ocr-priority" value="auto">
                                      <span>自动选择</span>
                                  </label>
                              </div>
                              <div id="pmc-ocr-status" class="pmc-status-text"></div>
                          </div>
                      </div>
                      <!-- Right Col -->
                      <div class="pmc-col" style="border:none; padding:0; background:transparent;">
                          <div class="pmc-form-group">
                              <label class="pmc-label">矢量化预设</label>
                              <select id="pmc-vectorize-preset" class="pmc-select" style="width:100%;">
                                  <option value="auto" selected>自动推荐</option>
                                  <option value="logo">Logo / 图标</option>
                                  <option value="illustration">插画</option>
                                  <option value="lineart">线稿</option>
                                  <option value="photo">照片</option>
                                  <option value="simple">简化</option>
                              </select>
                          </div>
                          <div style="margin-top: 20px; display:flex; flex-direction:column; gap:16px;">
                              <div class="pmc-form-group">
                                  <label class="pmc-label">
                                      边缘阈值
                                      <span id="pmc-edge-val" class="pmc-value-badge">30</span>
                                  </label>
                                  <div style="display:flex; align-items:center; gap:10px;">
                                      <span style="font-size:11px; color:#94a3b8;">10</span>
                                      <input type="range" id="pmc-edge-threshold" min="10" max="100" value="30" class="pmc-range">
                                      <span style="font-size:11px; color:#94a3b8;">100</span>
                                  </div>
                              </div>
                              <div class="pmc-form-group">
                                  <label class="pmc-label">
                                      颜色容差
                                      <span id="pmc-color-val" class="pmc-value-badge">25</span>
                                  </label>
                                  <div style="display:flex; align-items:center; gap:10px;">
                                      <span style="font-size:11px; color:#94a3b8;">5</span>
                                      <input type="range" id="pmc-color-tolerance" min="5" max="50" value="25" class="pmc-range">
                                      <span style="font-size:11px; color:#94a3b8;">50</span>
                                  </div>
                              </div>
                          </div>
                      </div>
                  </div>
              </div>

              <!-- Concurrency Settings -->
              <div id="pmc-concurrency-settings-panel" class="pmc-advanced-settings" style="display:block; border: 1px solid var(--pmc-border); border-radius: 12px; overflow: hidden; margin-top: 16px;">
                  <div class="pmc-advanced-header">
                      <iconify-icon icon="carbon:meter" width="16"></iconify-icon>
                      Design Agent 并发设置
                  </div>
                  <div class="pmc-advanced-body">
                      <div class="pmc-col" style="border:none; padding:0; background:transparent;">
                          <div class="pmc-form-group">
                              <label class="pmc-label">批量大小 (batchSize)</label>
                              <input type="number" id="pmc-batch-size" class="pmc-input" min="1" style="width: 100%;">
                              <div class="pmc-hint-text">每批处理的幻灯片数量</div>
                          </div>
                          <div class="pmc-form-group" style="margin-top: 12px;">
                              <label class="pmc-label">批量并发 (batchConcurrency)</label>
                              <input type="number" id="pmc-batch-concurrency" class="pmc-input" min="1" style="width: 100%;">
                              <div class="pmc-hint-text">同时处理的批次数</div>
                          </div>
                      </div>
                      <div class="pmc-col" style="border:none; padding:0; background:transparent;">
                          <div class="pmc-form-group">
                              <label class="pmc-label">图片并发 (imageConcurrency)</label>
                              <input type="number" id="pmc-image-concurrency" class="pmc-input" min="1" style="width: 100%;">
                              <div class="pmc-hint-text">同时生成的图片数</div>
                          </div>
                          <div class="pmc-form-group" style="margin-top: 12px;">
                              <button id="pmc-save-concurrency" class="pmc-btn-save" style="width: 100%;">
                                  <iconify-icon icon="carbon:save" width="16"></iconify-icon>
                                  保存并发设置
                              </button>
                          </div>
                      </div>
                  </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer (Optional, can be hidden if tabs provide enough actions) -->
        <div class="pmc-footer">
          <div id="ppt-image-gen-stats" class="pmc-stats"></div>
          <div class="text-xs text-slate-400">设置将自动保存或点击对应保存按钮</div>
        </div>
      </div>
    `;
  }

  Object.assign(ns.view, {
    getModalTemplate
  });
})(typeof window !== 'undefined' ? window : this);
