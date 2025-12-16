(()=>{
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;
  NS.utils = NS.utils || {};
  Object.assign(NS.utils, {
    safe(value, fallback = '') {
        try {
            const v = value ?? fallback;
            return v == null ? '' : String(v);
        } catch {
            return String(fallback ?? '');
        }
    },

    formatTime(value) {
        try {
            if (value == null || value === '') return '';
            const d = value instanceof Date ? value : new Date(value);
            if (Number.isNaN(d.getTime())) return '';
            return d.toLocaleString();
        } catch {
            return '';
        }
    },

    q(selector, root = document) {
        return root?.querySelector?.(selector) || null;
    },

    qa(selector, root = document) {
        try {
            return Array.from(root?.querySelectorAll?.(selector) || []);
        } catch {
            return [];
        }
    },

    byId(id, root = document) {
        return root?.getElementById?.(id) || null;
    },

    createEl(tag, attrs = null, children = null) {
        const el = document.createElement(tag);
        if (attrs && typeof attrs === 'object') {
            for (const [k, v] of Object.entries(attrs)) {
                if (v == null) continue;
                if (k === 'class') el.className = String(v);
                else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
                else if (k in el) el[k] = v;
                else el.setAttribute(k, String(v));
            }
        }
        if (children != null) {
            const arr = Array.isArray(children) ? children : [children];
            for (const c of arr) {
                if (c == null) continue;
                el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
            }
        }
        return el;
    },

    _escapeHtml(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    },


    _escapeAttr(value) {
        return this._escapeHtml(value).replaceAll('\n', ' ').replaceAll('\r', ' ');
    },


    _getFileIcon(type) {
        const icons = {
            'history': 'solar:history-bold-duotone',
            'history-report': 'solar:notebook-bold-duotone',
            'history-source': 'solar:database-bold-duotone',
            'history-checkpoint': 'solar:folder-check-bold-duotone',
            'history-document': 'solar:document-text-bold-duotone',
            'url': 'solar:link-circle-bold-duotone',
            'pdf': 'solar:file-bold-duotone',
        };
        return icons[type] || 'solar:document-bold-duotone';
    },

  });

})();
