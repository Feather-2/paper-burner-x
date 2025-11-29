/**
 * PPTXSlideRenderer 工具方法
 * 包含: preload, formula, svg, OMML 相关的所有工具方法
 */

const PPTXSlideRendererUtils = {
    /**
     * 预加载图标为 Base64 图片
     */
    async preloadIcon(iconName, color = '333333') {
        if (!this.iconCache) this.iconCache = {};

        const iconKey = `${iconName}_${color}`;
        if (this.iconCache[iconKey]) return this.iconCache[iconKey];

        try {
            const [prefix, name] = iconName.split(':');
            const svgUrl = `https://api.iconify.design/${prefix}/${name}.svg?color=%23${color}`;

            const response = await fetch(svgUrl);
            if (!response.ok) throw new Error('Failed to fetch icon');

            const svgText = await response.text();
            const base64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
            this.iconCache[iconKey] = base64;

            return base64;
        } catch (e) {
            console.warn(`Failed to preload icon ${iconName}:`, e);
            return null;
        }
    },

    /**
     * 预加载所有幻灯片中的 SVG 图形
     */
    async preloadAllSvgs(slides) {
        if (!this.svgCache) this.svgCache = {};
        const svgPromises = [];

        const collectSvgs = (elements) => {
            if (!elements) return;
            elements.forEach(el => {
                if (el.type === 'svg' && el.content) {
                    svgPromises.push(this.preloadSvg(el));
                }
                if (el.children) {
                    collectSvgs(el.children);
                }
            });
        };

        slides.forEach(slide => {
            if (slide.type === 'freeform' && slide.elements) {
                collectSvgs(slide.elements);
            }
        });

        if (svgPromises.length > 0) {
            console.log(`[PPTXSlideRenderer] Preloading ${svgPromises.length} SVGs...`);
            await Promise.all(svgPromises);
            console.log('[PPTXSlideRenderer] SVGs preloaded');
        }
    },

    /**
     * 预加载单个 SVG 为 Base64 图片
     */
    async preloadSvg(el) {
        if (!el.content) return null;
        
        const key = this._hashString(el.content);
        if (this.svgCache[key]) return this.svgCache[key];

        try {
            const w = this._parseSizeToPixels(el.w, false) || 200;
            const h = this._parseSizeToPixels(el.h, true) || 200;
            
            console.log(`[preloadSvg] Converting SVG: ${w}x${h}px`);
            const dataUrl = await this.svgToBase64(el.content, w / 96, h / 96);
            if (dataUrl) {
                this.svgCache[key] = dataUrl;
                console.log(`[preloadSvg] SVG cached: ${key}`);
            } else {
                console.warn(`[preloadSvg] Failed to convert SVG: ${key}`);
            }
            return dataUrl;
        } catch (e) {
            console.warn('[preloadSvg] Failed:', e);
            return null;
        }
    },

    _hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return 'svg_' + Math.abs(hash).toString(16);
    },

    _parseSizeToPixels(value, isHeight = false) {
        if (!value) return null;
        const str = String(value).trim();
        if (str.endsWith('%')) {
            const base = isHeight ? 540 : 960;
            return (parseFloat(str) / 100) * base;
        } else if (str.endsWith('px')) {
            return parseFloat(str);
        } else if (str.endsWith('in')) {
            return parseFloat(str) * 96;
        }
        return parseFloat(str) || null;
    },

    /**
     * 预加载所有幻灯片中的图标
     */
    async preloadAllIcons(slides) {
        const iconPromises = [];

        const collectIcons = (elements) => {
            if (!elements) return;
            elements.forEach(el => {
                if (el.type === 'icon' && el.icon) {
                    const color = this.safeColor(el.color) || '333333';
                    iconPromises.push(this.preloadIcon(el.icon, color));
                }
                if (el.type === 'card' && el.icon) {
                    const color = this.safeColor(el.iconColor) || '333333';
                    iconPromises.push(this.preloadIcon(el.icon, color));
                }
                if (el.children) {
                    collectIcons(el.children);
                }
            });
        };

        slides.forEach(slide => {
            if (slide.type === 'freeform' && slide.elements) {
                collectIcons(slide.elements);
            }
        });

        if (iconPromises.length > 0) {
            console.log(`[PPTXSlideRenderer] Preloading ${iconPromises.length} icons...`);
            await Promise.all(iconPromises);
            console.log('[PPTXSlideRenderer] Icons preloaded');
        }
    },

    /**
     * 动态加载 html2canvas 库
     */
    async loadHtml2Canvas() {
        if (typeof html2canvas !== 'undefined') {
            return html2canvas;
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://gcore.jsdelivr.net/npm/html2canvas-pro@1.5.13/dist/html2canvas-pro.min.js';
            script.onload = () => {
                console.log('[PPTXSlideRenderer] html2canvas loaded');
                resolve(window.html2canvas);
            };
            script.onerror = () => {
                console.warn('[PPTXSlideRenderer] Failed to load html2canvas');
                reject(new Error('Failed to load html2canvas'));
            };
            document.head.appendChild(script);
        });
    },

    /**
     * 内联 KaTeX 样式以确保 html2canvas 正确渲染
     */
    inlineKatexStylesForExport(container) {
        const katexElements = container.querySelectorAll('.katex, .katex *');
        katexElements.forEach(el => {
            const computed = window.getComputedStyle(el);
            const critical = [
                'display', 'position',
                'font-size', 'line-height', 'font-family', 'font-weight', 'font-style',
                'margin', 'padding',
                'width', 'height', 'min-width', 'min-height',
                'top', 'bottom', 'left', 'right',
                'transform', 'color', 'border-bottom', 'border-color'
            ];

            const inlineStyles = [];

            const verticalAlign = computed.getPropertyValue('vertical-align');
            if (verticalAlign && verticalAlign.endsWith('em')) {
                const val = parseFloat(verticalAlign);
                if (!isNaN(val) && val !== 0) {
                    inlineStyles.push('position: relative');
                    inlineStyles.push(`top: ${-val * 1.5}em`);
                    inlineStyles.push('vertical-align: baseline');
                }
            } else if (verticalAlign) {
                inlineStyles.push(`vertical-align: ${verticalAlign}`);
            }

            critical.forEach(prop => {
                const value = computed.getPropertyValue(prop);
                if (value && value !== 'auto' && value !== 'normal' && value !== 'none' &&
                    value !== '0px' && value !== 'rgba(0, 0, 0, 0)') {
                    inlineStyles.push(`${prop}: ${value}`);
                }
            });

            if (inlineStyles.length > 0) {
                const existing = el.getAttribute('style') || '';
                el.setAttribute('style', existing + '; ' + inlineStyles.join('; '));
            }
        });

        const fracLines = container.querySelectorAll('.frac-line');
        fracLines.forEach(el => {
            el.style.borderBottom = '1px solid currentColor';
            el.style.width = '100%';
        });
    },

    /**
     * 将 KaTeX 公式渲染为 Base64 图片
     */
    async renderFormulaToImage(latex, options = {}) {
        const { fontSize = 24, color = '#333333', displayMode = true } = options;

        const cacheKey = `formula_${latex}_${fontSize}_${color}_${displayMode}`;
        if (!this.formulaCache) this.formulaCache = {};
        if (this.formulaCache[cacheKey]) {
            return this.formulaCache[cacheKey];
        }

        try {
            if (typeof katex === 'undefined') {
                console.warn('[PPTXSlideRenderer] KaTeX not available');
                return null;
            }

            await this.loadHtml2Canvas();

            const katexHtml = katex.renderToString(latex, {
                displayMode: false,
                throwOnError: false,
                output: 'html',
            });

            const container = document.createElement('div');
            container.style.cssText = `
                position: absolute;
                left: 0;
                top: 0;
                background: white;
                font-size: ${fontSize}px;
                color: ${color};
                display: inline-block;
                white-space: nowrap;
                padding: 8px;
                line-height: 1.2;
            `;
            container.innerHTML = katexHtml;
            document.body.appendChild(container);

            await new Promise(resolve => setTimeout(resolve, 300));

            const scale = 3;
            const canvas = await html2canvas(container, {
                scale: scale,
                backgroundColor: null,
                logging: false,
                useCORS: true,
                allowTaint: true,
            });

            document.body.removeChild(container);

            const dataUrl = canvas.toDataURL('image/png');

            const actualCanvasW = canvas.width / scale;
            const actualCanvasH = canvas.height / scale;

            const result = {
                data: dataUrl,
                width: actualCanvasW / this.styles.dimensions.pxPerInch,
                height: actualCanvasH / this.styles.dimensions.pxPerInch,
            };

            this.formulaCache[cacheKey] = result;
            console.log(`[PPTXSlideRenderer] Formula rendered: ${latex.substring(0, 30)}... canvas=${canvas.width}x${canvas.height}px, display=${actualCanvasW}x${actualCanvasH}px, inch=${result.width.toFixed(2)}x${result.height.toFixed(2)}`);

            return result;

        } catch (e) {
            console.warn('[PPTXSlideRenderer] Failed to render formula:', e);
            return null;
        }
    },

    /**
     * 内联 KaTeX 样式用于截图
     */
    inlineKatexStylesForCapture(container) {
        const processElement = (el) => {
            if (el.nodeType !== 1) return;

            const computed = window.getComputedStyle(el);
            const styles = [];

            const props = [
                'display', 'position', 'top', 'left', 'right', 'bottom',
                'width', 'min-width',
                'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
                'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
                'font-family', 'font-size', 'font-weight', 'font-style',
                'line-height', 'text-align', 'vertical-align',
                'color',
                'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
                'border-width', 'border-style', 'border-color',
                'transform', 'opacity',
                'box-sizing',
            ];

            props.forEach(prop => {
                const value = computed.getPropertyValue(prop);
                if (value && value !== 'none' && value !== 'auto' && value !== 'normal' &&
                    value !== '0px' && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') {
                    styles.push(`${prop}: ${value}`);
                }
            });

            const va = computed.getPropertyValue('vertical-align');
            if (va && va !== 'baseline') {
                if (va.endsWith('em')) {
                    const emVal = parseFloat(va);
                    const fontSizePx = parseFloat(computed.getPropertyValue('font-size'));
                    const pxVal = emVal * fontSizePx;
                    styles.push(`vertical-align: ${pxVal}px`);
                } else {
                    styles.push(`vertical-align: ${va}`);
                }
            }

            if (styles.length > 0) {
                el.style.cssText = styles.join('; ') + ';';
            }

            Array.from(el.children).forEach(processElement);
        };

        processElement(container);

        container.querySelectorAll('.frac-line').forEach(el => {
            const computed = window.getComputedStyle(el);
            el.style.borderBottomWidth = computed.borderBottomWidth || '1px';
            el.style.borderBottomStyle = 'solid';
            el.style.borderBottomColor = computed.color || 'currentColor';
            el.style.width = '100%';
            el.style.display = 'block';
        });

        container.querySelectorAll('.sqrt-line').forEach(el => {
            el.style.borderTopWidth = '1px';
            el.style.borderTopStyle = 'solid';
        });
    },

    /**
     * 预加载所有幻灯片中的公式为图片
     */
    async preloadAllFormulas(slides) {
        const formulaPromises = [];

        slides.forEach(slide => {
            if (slide.type === 'freeform' && slide.elements) {
                slide.elements.forEach(el => {
                    if (el.type === 'formula' && el.latex) {
                        formulaPromises.push(
                            this.renderFormulaToImage(el.latex, {
                                fontSize: el.font || 24,
                                color: el.color || '#333333',
                                displayMode: el.displayMode !== false,
                            })
                        );
                    }
                });
            }
        });

        if (formulaPromises.length > 0) {
            console.log(`[PPTXSlideRenderer] Preloading ${formulaPromises.length} formulas...`);
            await Promise.all(formulaPromises);
            console.log('[PPTXSlideRenderer] Formulas preloaded');
        }
    },

    /**
     * 将 SVG 内容转换为 Base64 图片
     */
    async svgToBase64(svgContent, width, height) {
        if (!svgContent) return null;

        try {
            const pxWidth = Math.round(width * 96);
            const pxHeight = Math.round(height * 96);
            
            let svg = svgContent.trim();
            if (!svg.toLowerCase().startsWith('<svg')) {
                svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pxWidth}" height="${pxHeight}" viewBox="0 0 ${pxWidth} ${pxHeight}">${svg}</svg>`;
            } else {
                svg = svg.replace(/<svg([^>]*)>/, (match, attrs) => {
                    if (!attrs.includes('xmlns=')) {
                        attrs = ` xmlns="http://www.w3.org/2000/svg"` + attrs;
                    }
                    attrs = attrs.replace(/\s*width\s*=\s*["'][^"']*["']/gi, '');
                    attrs = attrs.replace(/\s*height\s*=\s*["'][^"']*["']/gi, '');
                    attrs += ` width="${pxWidth}" height="${pxHeight}"`;
                    return `<svg${attrs}>`;
                });
            }

            const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);

            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const scale = 2;
                    canvas.width = pxWidth * scale;
                    canvas.height = pxHeight * scale;
                    const ctx = canvas.getContext('2d');
                    ctx.scale(scale, scale);
                    ctx.drawImage(img, 0, 0, pxWidth, pxHeight);
                    URL.revokeObjectURL(url);
                    resolve(canvas.toDataURL('image/png'));
                };
                img.onerror = (e) => {
                    console.warn('[svgToBase64] Image load error:', e);
                    URL.revokeObjectURL(url);
                    resolve(null);
                };
                img.src = url;
            });
        } catch (e) {
            console.warn('[svgToBase64] Failed:', e);
            return null;
        }
    },

    /**
     * LaTeX 转 Unicode 映射
     */
    latexToUnicode(latex) {
        if (!latex) return '';

        let result = latex;
        result = result.replace(/\\\\/g, '\\');

        const superscripts = {
            '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
            '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
            '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
            'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ', 'y': 'ʸ',
            'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ',
            'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'j': 'ʲ', 'k': 'ᵏ',
            'l': 'ˡ', 'm': 'ᵐ', 'o': 'ᵒ', 'p': 'ᵖ', 'r': 'ʳ',
            's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ', 'v': 'ᵛ', 'w': 'ʷ', 'z': 'ᶻ',
            'N': 'ᴺ', '/': 'ᐟ',
        };

        const subscripts = {
            '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
            '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
            '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
            'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ',
            'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'o': 'ₒ',
            'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ',
            'v': 'ᵥ', 'x': 'ₓ',
            'th': 'ₜₕ',
        };

        const toSuperscript = (str) => {
            return str.split('').map(c => superscripts[c] || c).join('');
        };

        const toSubscript = (str) => {
            return str.split('').map(c => subscripts[c] || c).join('');
        };

        const replacements = [
            [/\|([^|⟩\s{}]+)\\rangle/g, '|$1⟩'],
            [/\\langle([^|⟨\s{}]+)\|/g, '⟨$1|'],
            [/\\ket\{([^}]*)\}/g, '|$1⟩'],
            [/\\bra\{([^}]*)\}/g, '⟨$1|'],
            [/\\rangle/g, '⟩'],
            [/\\langle/g, '⟨'],
            [/\\vert/g, '|'],
            [/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)'],
            [/\\sqrt\[(\d+)\]\{([^}]*)\}/g, '∜($2)'],
            [/\\sqrt\{([^}]*)\}/g, '√($1)'],
            [/\\sqrt/g, '√'],
            [/\\alpha/g, 'α'], [/\\beta/g, 'β'], [/\\gamma/g, 'γ'], [/\\delta/g, 'δ'],
            [/\\epsilon/g, 'ε'], [/\\varepsilon/g, 'ε'], [/\\zeta/g, 'ζ'], [/\\eta/g, 'η'],
            [/\\theta/g, 'θ'], [/\\vartheta/g, 'ϑ'], [/\\iota/g, 'ι'], [/\\kappa/g, 'κ'],
            [/\\lambda/g, 'λ'], [/\\mu/g, 'μ'], [/\\nu/g, 'ν'], [/\\xi/g, 'ξ'],
            [/\\pi/g, 'π'], [/\\varpi/g, 'ϖ'], [/\\rho/g, 'ρ'], [/\\varrho/g, 'ϱ'],
            [/\\sigma/g, 'σ'], [/\\varsigma/g, 'ς'], [/\\tau/g, 'τ'], [/\\upsilon/g, 'υ'],
            [/\\phi/g, 'φ'], [/\\varphi/g, 'φ'], [/\\chi/g, 'χ'], [/\\psi/g, 'ψ'],
            [/\\omega/g, 'ω'],
            [/\\Gamma/g, 'Γ'], [/\\Delta/g, 'Δ'], [/\\Theta/g, 'Θ'], [/\\Lambda/g, 'Λ'],
            [/\\Xi/g, 'Ξ'], [/\\Pi/g, 'Π'], [/\\Sigma/g, 'Σ'], [/\\Upsilon/g, 'Υ'],
            [/\\Phi/g, 'Φ'], [/\\Psi/g, 'Ψ'], [/\\Omega/g, 'Ω'],
            [/\\infty/g, '∞'], [/\\pm/g, '±'], [/\\mp/g, '∓'],
            [/\\times/g, '×'], [/\\div/g, '÷'], [/\\cdot/g, '·'], [/\\ast/g, '∗'],
            [/\\star/g, '⋆'], [/\\circ/g, '∘'], [/\\bullet/g, '•'],
            [/\\oplus/g, '⊕'], [/\\otimes/g, '⊗'], [/\\odot/g, '⊙'],
            [/\\leq/g, '≤'], [/\\geq/g, '≥'], [/\\neq/g, '≠'], [/\\ne/g, '≠'],
            [/\\approx/g, '≈'], [/\\equiv/g, '≡'], [/\\sim/g, '∼'], [/\\simeq/g, '≃'],
            [/\\cong/g, '≅'], [/\\propto/g, '∝'], [/\\ll/g, '≪'], [/\\gg/g, '≫'],
            [/\\prec/g, '≺'], [/\\succ/g, '≻'], [/\\preceq/g, '⪯'], [/\\succeq/g, '⪰'],
            [/\\subset/g, '⊂'], [/\\supset/g, '⊃'], [/\\subseteq/g, '⊆'], [/\\supseteq/g, '⊇'],
            [/\\in/g, '∈'], [/\\notin/g, '∉'], [/\\ni/g, '∋'],
            [/\\cup/g, '∪'], [/\\cap/g, '∩'], [/\\setminus/g, '∖'],
            [/\\emptyset/g, '∅'], [/\\varnothing/g, '∅'],
            [/\\forall/g, '∀'], [/\\exists/g, '∃'], [/\\nexists/g, '∄'],
            [/\\land/g, '∧'], [/\\lor/g, '∨'], [/\\lnot/g, '¬'], [/\\neg/g, '¬'],
            [/\\implies/g, '⟹'], [/\\iff/g, '⟺'],
            [/\\nabla/g, '∇'], [/\\partial/g, '∂'],
            [/\\sum/g, '∑'], [/\\prod/g, '∏'], [/\\coprod/g, '∐'],
            [/\\int/g, '∫'], [/\\iint/g, '∬'], [/\\iiint/g, '∭'], [/\\oint/g, '∮'],
            [/\\rightarrow/g, '→'], [/\\leftarrow/g, '←'], [/\\leftrightarrow/g, '↔'],
            [/\\Rightarrow/g, '⇒'], [/\\Leftarrow/g, '⇐'], [/\\Leftrightarrow/g, '⇔'],
            [/\\uparrow/g, '↑'], [/\\downarrow/g, '↓'], [/\\updownarrow/g, '↕'],
            [/\\to/g, '→'], [/\\gets/g, '←'], [/\\mapsto/g, '↦'],
            [/\\longrightarrow/g, '⟶'], [/\\longleftarrow/g, '⟵'],
            [/\\left\(/g, '('], [/\\right\)/g, ')'],
            [/\\left\[/g, '['], [/\\right\]/g, ']'],
            [/\\left\{/g, '{'], [/\\right\}/g, '}'],
            [/\\left\|/g, '‖'], [/\\right\|/g, '‖'],
            [/\\left</g, '⟨'], [/\\right>/g, '⟩'],
            [/\\lfloor/g, '⌊'], [/\\rfloor/g, '⌋'],
            [/\\lceil/g, '⌈'], [/\\rceil/g, '⌉'],
            [/\\hbar/g, 'ℏ'], [/\\ell/g, 'ℓ'], [/\\wp/g, '℘'],
            [/\\Re/g, 'ℜ'], [/\\Im/g, 'ℑ'], [/\\aleph/g, 'ℵ'],
            [/\\prime/g, '′'], [/\\angle/g, '∠'], [/\\perp/g, '⊥'],
            [/\\parallel/g, '∥'], [/\\triangle/g, '△'],
            [/\\square/g, '□'], [/\\diamond/g, '◇'],
            [/\\text\{([^}]*)\}/g, '$1'],
            [/\\mathrm\{([^}]*)\}/g, '$1'],
            [/\\mathbf\{([^}]*)\}/g, '$1'],
            [/\\mathit\{([^}]*)\}/g, '$1'],
            [/\\log/g, 'log'], [/\\ln/g, 'ln'], [/\\lg/g, 'lg'],
            [/\\sin/g, 'sin'], [/\\cos/g, 'cos'], [/\\tan/g, 'tan'],
            [/\\cot/g, 'cot'], [/\\sec/g, 'sec'], [/\\csc/g, 'csc'],
            [/\\arcsin/g, 'arcsin'], [/\\arccos/g, 'arccos'], [/\\arctan/g, 'arctan'],
            [/\\sinh/g, 'sinh'], [/\\cosh/g, 'cosh'], [/\\tanh/g, 'tanh'],
            [/\\exp/g, 'exp'], [/\\lim/g, 'lim'], [/\\max/g, 'max'], [/\\min/g, 'min'],
            [/\\sup/g, 'sup'], [/\\inf/g, 'inf'], [/\\det/g, 'det'], [/\\dim/g, 'dim'],
            [/\\[a-zA-Z]+/g, ''],
        ];

        for (const [pattern, replacement] of replacements) {
            result = result.replace(pattern, replacement);
        }

        result = result.replace(/\^\{([^}]+)\}/g, (match, content) => toSuperscript(content));
        result = result.replace(/\^([0-9a-zA-Z+\-])/g, (match, char) => toSuperscript(char));

        result = result.replace(/_\{([^}]+)\}/g, (match, content) => toSubscript(content));
        result = result.replace(/_([0-9a-zA-Z+\-])/g, (match, char) => toSubscript(char));

        result = result.replace(/\{([^{}]*)\}/g, '$1');
        result = result.replace(/[{}]/g, '');

        result = result.replace(/\s+/g, ' ').trim();

        return result;
    },
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PPTXSlideRendererUtils;
}
