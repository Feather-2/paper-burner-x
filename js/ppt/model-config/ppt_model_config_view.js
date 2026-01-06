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
              <div class="pmc-title">模型配置中心</div>
              <div class="pmc-subtitle">快速指派不同任务的模型源，复用系统密钥</div>
            </div>
          </div>
          <button id="ppt-model-config-close" class="pmc-close-btn" title="关闭">
            <iconify-icon icon="carbon:close" width="24"></iconify-icon>
          </button>
        </div>

        <!-- Tab Navigation (Top Horizontal) -->
        <div class="pmc-tabs-nav">
          <button class="pmc-tab-btn active" data-tab="quick">
            <iconify-icon icon="carbon:flash-filled" width="16"></iconify-icon>
            快捷指派
          </button>
          <button class="pmc-tab-btn" data-tab="models">
            <iconify-icon icon="carbon:list" width="16"></iconify-icon>
            能力矩阵
          </button>
          <button class="pmc-tab-btn" data-tab="roles">
            <iconify-icon icon="carbon:user-role" width="16"></iconify-icon>
            角色权重
          </button>
          <button class="pmc-tab-btn" data-tab="advanced">
            <iconify-icon icon="carbon:settings" width="16"></iconify-icon>
            高级设置
          </button>
        </div>

        <!-- Scrollable Content Area -->
        <div class="pmc-scroll-content">
          <!-- Tab 0: 快捷指派 -->
          <div class="pmc-tab-panel active" data-panel="quick">
            <div class="p-6">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
                <!-- 文字模型 -->
                <div class="modern-card theme-blue">
                  <div class="card-header">
                    <div class="card-icon"><iconify-icon icon="carbon:text-annotation-toggle" width="22"></iconify-icon></div>
                    <div class="card-meta">
                      <h3>文字模型</h3>
                      <p>大纲、正文与润色</p>
                    </div>
                  </div>
                  <div class="card-content">
                    <div class="form-item">
                      <label>模型来源</label>
                      <select id="ppt-model-lang-select" class="modern-select"></select>
                    </div>
                    <div class="form-item">
                      <label>具体模型</label>
                      <div class="input-group">
                        <input id="ppt-model-lang-id-search" class="modern-input" placeholder="探测 ID">
                        <div id="ppt-model-lang-dropdown" class="pmc-dropdown"></div>
                        <button id="ppt-model-lang-refresh-models" class="icon-action" title="探测"><iconify-icon icon="carbon:ibm-watson-discovery"></iconify-icon></button>
                      </div>
                    </div>
                  </div>
                  <div class="card-footer">
                    <button id="ppt-model-lang-save" class="modern-btn-save">保存文字配置</button>
                  </div>
                </div>

                <!-- 配图模型 -->
                <div class="modern-card theme-purple">
                  <div class="card-header">
                    <div class="card-icon"><iconify-icon icon="carbon:image" width="22"></iconify-icon></div>
                    <div class="card-meta">
                      <h3>配图模型</h3>
                      <p>幻灯片插图生成</p>
                    </div>
                  </div>
                  <div class="card-content">
                    <div class="form-item">
                      <label>模型来源</label>
                      <select id="ppt-model-img-select" class="modern-select"></select>
                    </div>
                    <div class="form-item">
                      <label>具体模型</label>
                      <div class="input-group">
                        <input id="ppt-model-img-id-search" class="modern-input" placeholder="探测 ID">
                        <div id="ppt-model-img-dropdown" class="pmc-dropdown"></div>
                        <button id="ppt-model-img-refresh-models" class="icon-action" title="探测"><iconify-icon icon="carbon:ibm-watson-discovery"></iconify-icon></button>
                      </div>
                    </div>
                  </div>
                  <div class="card-footer">
                    <button id="ppt-model-img-save" class="modern-btn-save">保存配图配置</button>
                  </div>
                </div>

                <!-- 视觉模型 -->
                <div class="modern-card theme-emerald">
                  <div class="card-header">
                    <div class="card-icon"><iconify-icon icon="carbon:view" width="22"></iconify-icon></div>
                    <div class="card-meta">
                      <h3>视觉模型</h3>
                      <p>排版分析与参考图</p>
                    </div>
                  </div>
                  <div class="card-content">
                    <div class="form-item">
                      <label>模型来源</label>
                      <select id="ppt-model-vision-select" class="modern-select"></select>
                    </div>
                    <div class="form-item">
                      <label>具体模型</label>
                      <div class="input-group">
                        <input id="ppt-model-vision-id-search" class="modern-input" placeholder="探测 ID">
                        <div id="ppt-model-vision-dropdown" class="pmc-dropdown"></div>
                        <button id="ppt-model-vision-refresh-models" class="icon-action" title="探测"><iconify-icon icon="carbon:ibm-watson-discovery"></iconify-icon></button>
                      </div>
                    </div>
                  </div>
                  <div class="card-footer">
                    <button id="ppt-model-vision-save" class="modern-btn-save">保存视觉配置</button>
                  </div>
                </div>
              </div>

              <div class="modern-info-banner mt-6">
                <iconify-icon icon="carbon:information-filled" width="18"></iconify-icon>
                <span>系统会自动复用主界面的 API Key 配置，无需额外填写。</span>
              </div>
            </div>
          </div>

          <!-- Tab 1: 全部模型 -->
          <div class="pmc-tab-panel" data-panel="models">
            <div id="pmc-model-table-container"></div>
          </div>

          <!-- Tab 2: 角色配置 -->
          <div class="pmc-tab-panel" data-panel="roles">
            <div id="pmc-role-overview-container-tab" class="px-4 pt-4"></div>
          </div>

          <!-- Tab 3: 高级设置 -->
          <div class="pmc-tab-panel" data-panel="advanced">
            <!-- 内容由 tabs.js 渲染 -->
          </div>
        </div>

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
})(typeof window !== 'undefined' ? window : globalThis);
