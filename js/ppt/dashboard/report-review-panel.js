class ReportReviewPanel {
    constructor() {
        this.isOpen = false;
        this.versions = [];
        this.selectedVersionIndex = -1;
        this._rootId = 'pptReportReviewRoot';
        this._host = null;
        this._bound = false;
    }

    _hasDom() {
        return typeof document !== 'undefined' && !!document;
    }

    mount(hostEl) {
        if (!this._hasDom()) return;
        const host = hostEl && hostEl.appendChild ? hostEl : document.body;
        this._host = host;

        let root = document.getElementById(this._rootId);
        if (!root) {
            root = document.createElement('div');
            root.id = this._rootId;
            host.appendChild(root);
        }
        this._ensureEventsBound(root);
        this.render();
    }

    getNewCount() {
        return this.versions.filter(v => v && v.isNew).length;
    }

    // 添加新版本（实时追加，高亮提示但不强制查看）
    addVersion(markdown, label) {
        const md = typeof markdown === 'string' ? markdown : '';
        const nextIndex = this.versions.length + 1;
        this.versions.push({
            id: `v${nextIndex}`,
            markdown: md,
            label: typeof label === 'string' && label.trim() ? label.trim() : `版本 ${nextIndex}`,
            timestamp: Date.now(),
            isNew: true
        });

        this.updateBadge();
        if (this.isOpen) this.render();
    }

    toggle() {
        this.isOpen = !this.isOpen;
        this.render();
    }

    open() {
        this.isOpen = true;
        this.render();
    }

    close() {
        this.isOpen = false;
        this.render();
    }

    // 更新左下角按钮 badge（显示新版本数）
    updateBadge() {
        if (!this._hasDom()) return;
        const newCount = this.getNewCount();
        const btn = document.getElementById('reportReviewBtn');
        if (!btn) return;

        const badge = btn.querySelector('.badge');
        if (newCount > 0) {
            if (badge) {
                badge.textContent = String(newCount);
            } else {
                const span = document.createElement('span');
                span.className = 'badge';
                span.textContent = String(newCount);
                btn.appendChild(span);
            }
        } else if (badge) {
            badge.remove();
        }
    }

    _escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    formatTime(ts) {
        try {
            return new Date(ts).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        } catch {
            return '';
        }
    }

    // 渲染左下角按钮（固定）- 没有版本时不显示
    renderButton() {
        if (this.versions.length === 0) return '';
        const newCount = this.getNewCount();
        return `
            <button id="reportReviewBtn" class="ppt-report-review-btn" type="button" data-rr-action="toggle">
                <iconify-icon icon="carbon:document-view" width="18"></iconify-icon>
                <span>报告审阅</span>
                ${newCount > 0 ? `<span class="badge">${newCount}</span>` : ''}
            </button>
        `;
    }

    // 渲染浮动面板
    renderPanel() {
        if (!this.isOpen) return '';

        const hasVersions = this.versions.length > 0;
        const selectedIndex = this.selectedVersionIndex >= 0 ? this.selectedVersionIndex : (hasVersions ? this.versions.length - 1 : -1);
        const selectedVersion = selectedIndex >= 0 ? this.versions[selectedIndex] : null;
        const prevVersion = selectedIndex > 0 ? this.versions[selectedIndex - 1] : { markdown: '' };

        const sidebar = hasVersions
            ? this.versions.slice().reverse().map((v, i) => {
		                const idx = this.versions.length - 1 - i;
		                const isActive = idx === selectedIndex;
		                return `
		                    <div class="ppt-rr-version-item ${v.isNew ? 'new' : ''} ${isActive ? 'active' : ''}"
		                         data-rr-action="select-version" data-index="${parseInt(idx, 10) || 0}">
		                        <div class="ppt-rr-version-label">${this._escapeHtml(v.label)}</div>
		                        <div class="ppt-rr-version-time">${this._escapeHtml(this.formatTime(v.timestamp))}</div>
		                    </div>
		                `;
            }).join('')
            : `<div class="ppt-rr-empty">暂无版本</div>`;

        const diffHtml = selectedVersion
            ? this.renderDiff(prevVersion?.markdown || '', selectedVersion?.markdown || '')
            : `<div class="ppt-rr-empty">暂无内容</div>`;

        return `
            <div class="ppt-report-review-panel" role="dialog" aria-label="报告审阅">
                <div class="ppt-rr-header">
                    <div class="ppt-rr-title">报告版本历史</div>
                    <button class="ppt-rr-close" type="button" data-rr-action="toggle" aria-label="关闭">×</button>
                </div>
                <div class="ppt-rr-body">
                    <div class="ppt-rr-sidebar custom-scrollbar">
                        ${sidebar}
                    </div>
                    <div class="ppt-rr-diff custom-scrollbar">
                        ${diffHtml}
                    </div>
                </div>
                <div class="ppt-rr-footer">
                    <button class="ppt-btn ppt-btn-secondary" type="button" data-rr-action="toggle">关闭</button>
                    <button class="ppt-btn ppt-btn-primary" type="button" data-rr-action="confirm">确认并继续到设计</button>
                </div>
            </div>
        `;
    }

    _ensureEventsBound(root) {
        if (this._bound) return;
        if (!root) return;
        this._bound = true;

        root.addEventListener('click', (e) => {
            const actionEl = e.target?.closest?.('[data-rr-action]');
            if (!actionEl) return;
            const action = actionEl.dataset.rrAction;
            if (!action) return;

            const generator = globalThis.PPTGenerator || globalThis.window?.PPTGenerator;
            if (!generator) return;

            if (action === 'toggle') {
                e.preventDefault();
                generator.toggleReportReview?.();
                return;
            }
            if (action === 'confirm') {
                e.preventDefault();
                generator.confirmReport?.();
                return;
            }
            if (action === 'select-version') {
                e.preventDefault();
                const idx = Number(actionEl.dataset.index);
                if (Number.isFinite(idx)) generator.selectReportVersion?.(idx);
            }
        });
    }

    // Myers diff（行级）
    _myersDiff(aLines, bLines) {
        const N = aLines.length;
        const M = bLines.length;
        const max = N + M;
        const v = new Map();
        v.set(1, 0);
        const traces = [];

        for (let d = 0; d <= max; d++) {
            const vSnapshot = new Map();
            for (let k = -d; k <= d; k += 2) {
                const kPlus = v.get(k + 1);
                const kMinus = v.get(k - 1);

                let x;
                if (k === -d || (k !== d && (kMinus ?? -Infinity) < (kPlus ?? -Infinity))) {
                    x = kPlus ?? 0;
                } else {
                    x = (kMinus ?? 0) + 1;
                }
                let y = x - k;

                while (x < N && y < M && aLines[x] === bLines[y]) {
                    x += 1;
                    y += 1;
                }

                vSnapshot.set(k, x);
                if (x >= N && y >= M) {
                    traces.push(vSnapshot);
                    return traces;
                }
            }
            traces.push(vSnapshot);
            v.clear();
            for (const [k, x] of vSnapshot.entries()) v.set(k, x);
        }
        return traces;
    }

    _buildDiffOps(aLines, bLines) {
        const traces = this._myersDiff(aLines, bLines);
        let x = aLines.length;
        let y = bLines.length;
        const ops = [];

        for (let d = traces.length - 1; d >= 0; d--) {
            const v = traces[d];
            const k = x - y;
            let prevK;

            if (d === 0) {
                prevK = 0;
            } else if (k === -d || (k !== d && (v.get(k - 1) ?? -Infinity) < (v.get(k + 1) ?? -Infinity))) {
                prevK = k + 1;
            } else {
                prevK = k - 1;
            }

            const prevX = v.get(prevK) ?? 0;
            const prevY = prevX - prevK;

            while (x > prevX && y > prevY) {
                ops.push({ type: 'equal', line: aLines[x - 1] });
                x -= 1;
                y -= 1;
            }

            if (d === 0) break;

            if (x === prevX) {
                ops.push({ type: 'insert', line: bLines[y - 1] });
                y -= 1;
            } else {
                ops.push({ type: 'delete', line: aLines[x - 1] });
                x -= 1;
            }
        }

        return ops.reverse();
    }

    // 简单的行级 diff 渲染：绿色新增，红色删除
    renderDiff(oldText, newText) {
        const a = typeof oldText === 'string' ? oldText : '';
        const b = typeof newText === 'string' ? newText : '';
        const aLines = a.split('\n');
        const bLines = b.split('\n');

        const ops = this._buildDiffOps(aLines, bLines);
        const html = ops.map((op) => {
            const cls = op.type === 'insert' ? 'add' : op.type === 'delete' ? 'remove' : 'context';
            const prefix = op.type === 'insert' ? '+' : op.type === 'delete' ? '-' : ' ';
            return `<div class="ppt-rr-diff-line ${cls}"><span class="ppt-rr-diff-prefix">${this._escapeHtml(prefix)}</span><span class="ppt-rr-diff-text">${this._escapeHtml(op.line)}</span></div>`;
        }).join('');

        return `<div class="ppt-rr-diff-wrap">${html || '<div class="ppt-rr-empty">无差异</div>'}</div>`;
    }

    render() {
        if (!this._hasDom()) return;

        const host = this._host || document.body;
        if (!document.getElementById(this._rootId)) this.mount(host);

        const root = document.getElementById(this._rootId);
        if (!root) return;
        this._ensureEventsBound(root);
        root.innerHTML = `${this.renderButton()}${this.renderPanel()}`;
        this.updateBadge();
    }
}

if (typeof globalThis !== 'undefined') {
    globalThis.ReportReviewPanel = ReportReviewPanel;
}
