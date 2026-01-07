/**
 * PPT Health Check Module
 * Implements a periodic system check (every 3 days)
 */
const PPTHealthCheck = {
    CHECK_INTERVAL: 3 * 24 * 60 * 60 * 1000, // 3 days in ms
    STORAGE_KEY: 'ppt_last_health_check',

    async checkAndShow(force = false) {
        const lastCheck = localStorage.getItem(this.STORAGE_KEY);
        const now = Date.now();

        if (force || !lastCheck || (now - parseInt(lastCheck)) > this.CHECK_INTERVAL) {
            return await this.performCheck(force);
        }
        return true;
    },

    async performCheck(force = false) {
        const results = {
            models: await this._checkModels(),
            mcp: await this._checkMCP()
        };

        const isFullyFunctional = results.models.lang.ready;
        
        // If not functional, we always show it if forced or if it's the 3-day window
        if (!isFullyFunctional || force || true) { 
            this._showHealthCard(results, !isFullyFunctional && force);
        }

        if (isFullyFunctional) {
            localStorage.setItem(this.STORAGE_KEY, Date.now().toString());
        }
        
        return isFullyFunctional;
    },

    async _checkModels() {
        const roles = ['lang', 'img', 'search'];
        const status = {};
        
        for (const role of roles) {
            const config = window.PPTModelConfigModal ? window.PPTModelConfigModal.loadConfig(role) : null;
            let modelName = config?.modelKey || '未配置';
            
            // 如果是自定义来源，尝试获取更可读的名字
            if (modelName.startsWith('custom_source_')) {
                const sources = window.PPTModelConfigModal?.getAllSources ? window.PPTModelConfigModal.getAllSources() : [];
                const source = sources.find(s => s.id === modelName);
                if (source) {
                    modelName = source.name || source.label || modelName;
                }
            }

            status[role] = {
                ready: !!(config && config.modelKey),
                name: modelName,
                fullKey: config?.modelKey
            };
        }
        return status;
    },

    async _checkMCP() {
        // Mock check for MCP services
        const mcpConfig = localStorage.getItem('mcp_nexus_config');
        return {
            gateway: !!mcpConfig,
            clients: window.mcp_clients_count || 0,
            active: true
        };
    },

    async quickApplyModel(fullKey) {
        if (!fullKey || !window.PPTModelConfigModal) return;
        
        const roles = ['lang', 'img', 'vision', 'search']; // 包含所有可能的角色
        for (const role of roles) {
            window.PPTModelConfig?.core?.saveConfig(role, { modelKey: fullKey });
        }
        
        // 同时更新角色优先级（如果是 Agent 模式需要）
        const roleCfg = window.PPTModelConfig?.roles?.normalizeRolePriorityConfig(
            window.PPTModelConfig?.core?.loadConfig('rolePriority')
        ) || {};
        
        const allRoles = ['analyst', 'designer', 'copywriter', 'reviewer']; // 核心 Agent 角色
        for (const rid of allRoles) {
            roleCfg[rid] = [fullKey]; // 将该模型设为各角色第一优先级
        }
        window.PPTModelConfig?.core?.saveConfig('rolePriority', roleCfg);

        // 刷新 UI
        await this.performCheck(true);
        if (window.PPTModelConfig?.core?.showSaveSuccess) {
            window.PPTModelConfig.core.showSaveSuccess('已一键应用到所有角色');
        }
    },

    _showHealthCard(results, isBlocking = false) {
        // Remove existing if any
        document.querySelector('.health-check-overlay')?.remove();

        const overlay = document.createElement('div');
        overlay.className = 'ppt-modal-overlay open health-check-overlay';
        overlay.style.zIndex = '2000';
        
        const langReady = results.models.lang.ready;
        const imgReady = results.models.img.ready;
        const mcpReady = results.mcp.gateway;
        const langModelKey = results.models.lang.fullKey;
        
        const isActuallyReady = langReady;

        overlay.innerHTML = `
            <div class="ppt-health-card-container animate-slide-up">
                <div class="ppt-health-card">
                    <div class="ppt-health-visual">
                        ${isActuallyReady ? `
                            <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="100" cy="100" r="80" fill="none" stroke="var(--ppt-primary-light)" stroke-width="2" stroke-dasharray="10 5" />
                                <circle cx="100" cy="100" r="60" fill="var(--ppt-primary-subtle)" opacity="0.5" />
                                <path d="M70 100 L90 120 L130 80" stroke="var(--ppt-primary)" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                        ` : `
                            <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="100" cy="100" r="80" fill="none" stroke="#fee2e2" stroke-width="2" stroke-dasharray="10 5" />
                                <circle cx="100" cy="100" r="60" fill="#fef2f2" />
                                <path d="M100 60 L100 110 M100 130 L100 135" stroke="#ef4444" stroke-width="8" fill="none" stroke-linecap="round" />
                            </svg>
                        `}
                    </div>
                    
                    <div class="ppt-health-content">
                        <h2>${isBlocking ? '创作准备就绪？' : '系统健康检查'}</h2>
                        <p class="subtitle">${isActuallyReady ? '您的 AI 创作环境表现良好' : '需要完成核心配置以开启创作'}</p>
                        
                        <div class="health-sections">
                            <div class="health-section ${langReady ? 'status-ok' : 'status-warn'}">
                                <div class="section-icon">
                                    <iconify-icon icon="${langReady ? 'carbon:checkmark-filled' : 'carbon:warning-filled'}"></iconify-icon>
                                </div>
                                <div class="section-info">
                                    <div style="display:flex; justify-content:space-between; align-items:center;">
                                        <h4>模型服务状态</h4>
                                        ${langReady ? `
                                            <button class="quick-apply-btn" onclick="window.PPTHealthCheck.quickApplyModel('${langModelKey}')" title="将此模型应用到所有角色">
                                                一键全同步
                                            </button>
                                        ` : ''}
                                    </div>
                                    <span>${langReady ? '语言模型已就绪' : '核心语言模型未配置'}</span>
                                    <small title="${results.models.lang.name}">${results.models.lang.name} / ${results.models.img.name}</small>
                                </div>
                            </div>

                            <div class="health-section ${mcpReady ? 'status-ok' : 'status-info'}">
                                <div class="section-icon">
                                    <iconify-icon icon="${mcpReady ? 'carbon:network-4' : 'carbon:Connect'}"></iconify-icon>
                                </div>
                                <div class="section-info">
                                    <h4>MCP 服务配置</h4>
                                    <span>${mcpReady ? 'Nexus Gateway 已连接' : '使用直接 HTTP 接入'}</span>
                                    <small>当前活跃 Client: ${results.mcp.clients}</small>
                                </div>
                            </div>
                        </div>

                        <div class="health-actions">
                            ${(isActuallyReady || !isBlocking) ? `
                                <button class="ppt-btn-primary" onclick="this.closest('.ppt-modal-overlay').remove()">
                                    确认并进入
                                </button>
                            ` : ''}
                            <button class="${isActuallyReady ? 'ppt-btn-ghost' : 'ppt-btn-primary'}" onclick="if(window.PPTModelConfigModal) window.PPTModelConfigModal.openModal(); ${isActuallyReady ? "this.closest('.ppt-modal-overlay').remove()" : ""}">
                                详细配置
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
    }
};

window.PPTHealthCheck = PPTHealthCheck;

// 监听模型配置变更事件，实时刷新健康检查卡片
if (typeof document !== 'undefined') {
    document.addEventListener('ppt-model-config-updated', () => {
        if (document.querySelector('.health-check-overlay')) {
            PPTHealthCheck.performCheck(false); // 重新检查并渲染，保持 force=false 避免干扰逻辑
        }
    });
}

// ESM 导出
export { PPTHealthCheck };
