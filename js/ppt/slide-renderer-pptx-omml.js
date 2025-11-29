/**
 * PPTXSlideRenderer OMML (Office Math Markup Language) 相关方法
 * 用于在 PPTX 中嵌入原生可编辑的数学公式
 */

const PPTXSlideRendererOMML = {
    /**
     * 使用原生 OMML 公式渲染 PPTX
     */
    async renderWithOMML(slides, filename, mathConverter) {
        if (typeof PptxGenJS === 'undefined') {
            throw new Error('PptxGenJS 未加载');
        }
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip 未加载');
        }

        console.log('[PPTXSlideRenderer] Starting OMML render with', slides.length, 'slides');

        this.formulaRegistry = [];
        this.mathConverter = mathConverter;

        await Promise.all([
            this.preloadAllIcons(slides),
            this.preloadAllSvgs(slides),
        ]);

        const pres = new PptxGenJS();
        pres.layout = 'LAYOUT_16x9';
        pres.title = filename.replace('.pptx', '');
        pres.theme = { headFontFace: this.styles.fontFamily.pptx, bodyFontFace: this.styles.fontFamily.pptx };

        slides.forEach((slideData, index) => {
            this.currentSlideIndex = index;
            console.log(`[PPTXSlideRenderer] Rendering slide ${index + 1}/${slides.length}`);
            this.renderSlide(pres, slideData);
        });

        const pptxBlob = await pres.write({ outputType: 'blob' });

        if (this.formulaRegistry.length > 0) {
            console.log(`[PPTXSlideRenderer] Post-processing ${this.formulaRegistry.length} formulas...`);
            const processedBlob = await this._postProcessOMML(pptxBlob);
            this._downloadBlob(processedBlob, filename);
        } else {
            this._downloadBlob(pptxBlob, filename);
        }

        console.log('[PPTXSlideRenderer] OMML render complete');
    },

    async _postProcessOMML(pptxBlob) {
        const zip = await JSZip.loadAsync(pptxBlob);
        const parser = new DOMParser();
        const serializer = new XMLSerializer();

        const formulasBySlide = {};
        for (const formula of this.formulaRegistry) {
            const slideIdx = formula.slideIndex;
            if (!formulasBySlide[slideIdx]) formulasBySlide[slideIdx] = [];
            formulasBySlide[slideIdx].push(formula);
        }

        for (const [slideIdx, formulas] of Object.entries(formulasBySlide)) {
            const slidePath = `ppt/slides/slide${parseInt(slideIdx) + 1}.xml`;
            const slideXml = await zip.file(slidePath)?.async('string');
            if (!slideXml) continue;

            const doc = parser.parseFromString(slideXml, 'text/xml');
            
            const parseError = doc.querySelector('parsererror');
            if (parseError) {
                console.warn(`[OMML] XML parse error in slide ${parseInt(slideIdx) + 1}`);
                continue;
            }

            let modified = false;

            for (const formula of formulas) {
                const placeholder = `FORMULA_PLACEHOLDER_${formula.id}`;
                
                const textNode = this._findTextNodeByContent(doc, placeholder);
                if (!textNode) {
                    console.warn(`[OMML] Placeholder not found: ${placeholder}`);
                    continue;
                }

                const shape = this._findAncestor(textNode, 'sp');
                if (!shape) {
                    console.warn(`[OMML] Shape not found for formula ${formula.id}`);
                    continue;
                }

                const omml = this.mathConverter.latexToOMML(formula.latex);
                if (!omml) {
                    console.warn(`[OMML] Failed to convert: ${formula.latex}`);
                    continue;
                }

                const newShape = this._createOMMLShape(doc, shape, omml, formula);
                if (newShape) {
                    shape.parentNode.replaceChild(newShape, shape);
                    modified = true;
                    console.log(`[OMML] Replaced formula ${formula.id} in slide ${parseInt(slideIdx) + 1}`);
                }
            }

            if (modified) {
                const root = doc.documentElement;
                const NS_MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
                const NS_A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';
                const NS_M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
                
                if (!root.hasAttributeNS('http://www.w3.org/2000/xmlns/', 'mc')) {
                    root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:mc', NS_MC);
                }
                if (!root.hasAttributeNS('http://www.w3.org/2000/xmlns/', 'a14')) {
                    root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:a14', NS_A14);
                }
                if (!root.hasAttributeNS('http://www.w3.org/2000/xmlns/', 'm')) {
                    root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:m', NS_M);
                }
                
                const ignorable = root.getAttribute('mc:Ignorable') || '';
                if (!ignorable.includes('a14')) {
                    root.setAttribute('mc:Ignorable', (ignorable + ' a14').trim());
                }
                
                const newXml = serializer.serializeToString(doc);
                zip.file(slidePath, newXml);
            }
        }

        await this._ensureOMMLContentType(zip);

        return zip.generateAsync({ 
            type: 'blob', 
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' 
        });
    },

    _findTextNodeByContent(doc, content) {
        const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent && node.textContent.includes(content)) {
                return node;
            }
        }
        return null;
    },

    _findAncestor(node, localName) {
        let current = node.parentNode;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            if (current.localName === localName) {
                return current;
            }
            current = current.parentNode;
        }
        return null;
    },

    _createOMMLShape(doc, originalShape, omml, formula) {
        try {
            const newShape = originalShape.cloneNode(true);
            
            const txBody = newShape.getElementsByTagNameNS('*', 'txBody')[0];
            if (!txBody) return null;

            const paragraphs = txBody.getElementsByTagNameNS('*', 'p');
            while (paragraphs.length > 0) {
                paragraphs[0].parentNode.removeChild(paragraphs[0]);
            }

            const newParagraph = this._buildOMMLParagraphNode(doc, omml, formula);
            if (newParagraph) {
                txBody.appendChild(newParagraph);
            }

            return newShape;
        } catch (e) {
            console.error('[OMML] Error creating shape:', e);
            return null;
        }
    },

    _buildOMMLParagraphNode(doc, omml, formula) {
        const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
        const NS_A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';
        const NS_M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

        const color = (formula.color || '333333').replace('#', '').toUpperCase();
        const fontSize = (formula.fontSize || 18) * 100;

        const p = doc.createElementNS(NS_A, 'a:p');
        
        const pPr = doc.createElementNS(NS_A, 'a:pPr');
        pPr.setAttribute('algn', formula.align || 'ctr');
        
        const defRPr = doc.createElementNS(NS_A, 'a:defRPr');
        defRPr.setAttribute('sz', fontSize.toString());
        
        const solidFill = doc.createElementNS(NS_A, 'a:solidFill');
        const srgbClr = doc.createElementNS(NS_A, 'a:srgbClr');
        srgbClr.setAttribute('val', color);
        solidFill.appendChild(srgbClr);
        defRPr.appendChild(solidFill);
        
        const latin = doc.createElementNS(NS_A, 'a:latin');
        latin.setAttribute('typeface', 'Cambria Math');
        defRPr.appendChild(latin);
        
        pPr.appendChild(defRPr);
        p.appendChild(pPr);

        const a14m = doc.createElementNS(NS_A14, 'a14:m');
        
        const ommlDoc = new DOMParser().parseFromString(
            `<m:oMathPara xmlns:m="${NS_M}" xmlns:a="${NS_A}">
                <m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>
                ${omml}
            </m:oMathPara>`,
            'text/xml'
        );
        
        if (ommlDoc.querySelector('parsererror')) {
            console.warn('[OMML] Failed to parse OMML XML');
            return null;
        }

        const runs = ommlDoc.getElementsByTagNameNS(NS_M, 'r');
        for (const run of runs) {
            let rPr = run.getElementsByTagNameNS(NS_M, 'rPr')[0];
            if (!rPr) {
                rPr = ommlDoc.createElementNS(NS_M, 'm:rPr');
                run.insertBefore(rPr, run.firstChild);
            }
            
            let aRPr = rPr.getElementsByTagNameNS(NS_A, 'rPr')[0];
            if (!aRPr) {
                const aRPrDoc = new DOMParser().parseFromString(
                    `<a:rPr xmlns:a="${NS_A}" sz="${fontSize}">
                        <a:solidFill><a:srgbClr val="${color}"/></a:solidFill>
                        <a:latin typeface="Cambria Math"/>
                    </a:rPr>`,
                    'text/xml'
                );
                aRPr = ommlDoc.importNode(aRPrDoc.documentElement, true);
                rPr.appendChild(aRPr);
            }
        }

        const ommlNode = doc.importNode(ommlDoc.documentElement, true);
        a14m.appendChild(ommlNode);
        p.appendChild(a14m);

        return p;
    },

    async _ensureOMMLContentType(zip) {
        const contentTypesPath = '[Content_Types].xml';
        let contentTypesXml = await zip.file(contentTypesPath)?.async('string');
        if (!contentTypesXml) return;

        const parser = new DOMParser();
        const doc = parser.parseFromString(contentTypesXml, 'text/xml');
        
        const serializer = new XMLSerializer();
        zip.file(contentTypesPath, serializer.serializeToString(doc));
    },

    _downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PPTXSlideRendererOMML;
}
