/**
 * @file js/annotations/crud.js
 * @description 批注系统 CRUD 操作
 */

import { _page_generateUUID } from './utils.js';

/**
 * 通用函数：检查指定目标是否已被高亮。
 * @param {string} [annotationId=null] - 可选的批注ID。
 * @param {string} contentIdentifier - 当前内容的标识符 ('ocr' 或 'translation')。
 * @param {string} [targetIdentifier=null] - 目标元素的标识符 (blockIndex 或 subBlockId)。
 * @param {'blockIndex'|'subBlockId'} identifierType - 标识符的类型。
 * @returns {boolean} 是否已高亮。
 */
export function checkIfTargetIsHighlighted(annotationId = null, contentIdentifier, targetIdentifier = null, identifierType) {
    // console.log(`[checkIfTargetIsHighlighted] ID: ${annotationId}, ContentID: ${contentIdentifier}, TargetID: ${targetIdentifier}, Type: ${identifierType}`);
    if (typeof window === 'undefined' || !window.data || !window.data.annotations) {
        return false;
    }

    let annotation;
    if (annotationId) {
        // ID 优先匹配
        annotation = window.data.annotations.find(ann =>
            ann.targetType === contentIdentifier && ann.id === annotationId
        );
    } else if (targetIdentifier !== null && identifierType) {
        // 通过目标标识符查找，与removeAnnotationFromTarget保持一致的匹配逻辑
        const targetIdStr = String(targetIdentifier).trim();

        annotation = window.data.annotations.find(ann => {
            // 确保基本条件匹配
            if (ann.targetType !== contentIdentifier) return false;
            if (!ann.target || !Array.isArray(ann.target.selector) || !ann.target.selector[0]) return false;

            // 获取选择器中的标识符，确保转换为字符串进行比较
            const selectorId = ann.target.selector[0][identifierType];
            if (selectorId === undefined) return false;

            const selectorIdStr = String(selectorId).trim();

            // 使用与removeAnnotationFromTarget相同的比较逻辑
            return selectorIdStr === targetIdStr || Math.abs(Number(selectorIdStr) - Number(targetIdStr)) < 0.001;
        });
    }

    // console.log('[checkIfTargetIsHighlighted] 找到的批注:', annotation, '结果:', !!annotation);
    return !!annotation;
}

/**
 * 通用函数：检查指定目标是否已有批注内容。
 * @param {string} [annotationId=null] - 可选的批注ID。
 * @param {string} contentIdentifier - 当前内容的标识符 ('ocr' 或 'translation')。
 * @param {string} [targetIdentifier=null] - 目标元素的标识符 (blockIndex 或 subBlockId)。
 * @param {'blockIndex'|'subBlockId'} identifierType - 标识符的类型。
 * @returns {boolean} 是否已有批注内容。
 */
export function checkIfTargetHasNote(annotationId = null, contentIdentifier, targetIdentifier = null, identifierType) {
    // console.log(`[checkIfTargetHasNote] ID: ${annotationId}, ContentID: ${contentIdentifier}, TargetID: ${targetIdentifier}, Type: ${identifierType}`);
    if (typeof window === 'undefined' || !window.data || !window.data.annotations) return false;

    let annotation;
    if (annotationId) {
        // ID 优先匹配
        annotation = window.data.annotations.find(ann =>
            ann.targetType === contentIdentifier &&
            ann.id === annotationId &&
            ann.body && ann.body.length > 0 && ann.body[0].value && ann.body[0].value.trim() !== ''
        );
    } else if (targetIdentifier !== null && identifierType) {
        // 通过目标标识符查找，与其他函数保持一致的匹配逻辑
        const targetIdStr = String(targetIdentifier).trim();

        annotation = window.data.annotations.find(ann => {
            // 确保基本条件匹配
            if (ann.targetType !== contentIdentifier) return false;
            if (!ann.target || !Array.isArray(ann.target.selector) || !ann.target.selector[0]) return false;

            // 获取选择器中的标识符，确保转换为字符串进行比较
            const selectorId = ann.target.selector[0][identifierType];
            if (selectorId === undefined) return false;

            const selectorIdStr = String(selectorId).trim();

            // 使用与其他函数相同的比较逻辑
            const idMatch = selectorIdStr === targetIdStr || Math.abs(Number(selectorIdStr) - Number(targetIdStr)) < 0.001;

            // 还需要检查是否有批注内容
            return idMatch && ann.body && ann.body.length > 0 && ann.body[0].value && ann.body[0].value.trim() !== '';
        });
    }

    // console.log('[checkIfTargetHasNote] 找到的批注:', annotation, '结果:', !!annotation);
    return !!annotation;
}

/**
 * 通用函数：从数据库中移除指定目标的批注。
 * @param {string} docId - 文档ID。
 * @param {string} [annotationId=null] - 可选的批注ID。
 * @param {string} [targetIdentifier=null] - 目标元素的标识符 (blockIndex 或 subBlockId)。
 * @param {string} contentIdentifier - 内容标识符。
 * @param {'blockIndex'|'subBlockId'} identifierType - 标识符的类型。
 */
export async function removeAnnotationFromTarget(docId, annotationId = null, targetIdentifier = null, contentIdentifier, identifierType) {
    if (!window.data.annotations) {
        console.warn(`[批注逻辑] removeAnnotationFromTarget: window.data.annotations 未定义。`);
        return;
    }
    if (!annotationId && targetIdentifier === null) {
        console.error(`[批注逻辑] removeAnnotationFromTarget: 需要 annotationId 或 targetIdentifier。`);
        throw new Error('未指定要删除的批注 (无ID或目标标识符)。');
    }

    // 增强日志：记录所有相关参数
    console.log(`[批注逻辑] removeAnnotationFromTarget 参数: docId=${docId}, annotationId=${annotationId}, targetIdentifier=${targetIdentifier}, contentIdentifier=${contentIdentifier}, identifierType=${identifierType}`);

    // 记录当前所有批注的数量和类型
    if (window.data.annotations) {
        console.log(`[批注逻辑] 当前批注总数: ${window.data.annotations.length}`);
        const typeCounts = {};
        window.data.annotations.forEach(ann => {
            const type = ann.targetType || 'unknown';
            typeCounts[type] = (typeCounts[type] || 0) + 1;
        });
        console.log(`[批注逻辑] 批注类型统计:`, typeCounts);
    }

    let annotationsToRemove = [];
    if (annotationId) {
        // 通过ID查找批注
        annotationsToRemove = window.data.annotations.filter(ann => ann.id === annotationId && ann.targetType === contentIdentifier);
        console.log(`[批注逻辑] 通过ID查找批注: ${annotationsToRemove.length}个匹配`);
    } else if (targetIdentifier !== null && identifierType) {
        // 通过目标标识符查找批注，增强类型比较
        const targetIdStr = String(targetIdentifier).trim();

        annotationsToRemove = window.data.annotations.filter(ann => {
            // 确保基本条件匹配
            if (ann.targetType !== contentIdentifier) return false;
            if (!ann.target || !Array.isArray(ann.target.selector) || !ann.target.selector[0]) return false;

            // 获取选择器中的标识符，确保转换为字符串进行比较
            const selectorId = ann.target.selector[0][identifierType];
            if (selectorId === undefined) return false;

            const selectorIdStr = String(selectorId).trim();

            // 记录详细的比较信息以便调试
            const isMatch = selectorIdStr === targetIdStr;
            if (selectorIdStr === targetIdStr || Math.abs(Number(selectorIdStr) - Number(targetIdStr)) < 0.001) {
                console.log(`[批注逻辑] 找到匹配: ${selectorIdStr} == ${targetIdStr} (${identifierType})`);
                return true;
            }
            return false;
        });

        console.log(`[批注逻辑] 通过${identifierType}查找批注: ${annotationsToRemove.length}个匹配 (目标值: ${targetIdStr})`);

        // 如果没有找到匹配，记录所有可能的值以便调试
        if (annotationsToRemove.length === 0) {
            const allValues = window.data.annotations
                .filter(ann => ann.targetType === contentIdentifier && ann.target && ann.target.selector && ann.target.selector[0])
                .map(ann => {
                    const val = ann.target.selector[0][identifierType];
                    return val !== undefined ? String(val) : 'undefined';
                });
            console.log(`[批注逻辑] 当前所有${identifierType}值:`, allValues);
        }
    }

    if (annotationsToRemove.length === 0) {
        console.warn(`[批注逻辑] removeAnnotationFromTarget: 未找到要删除的批注。 ID: ${annotationId}, TargetID: ${targetIdentifier}, Type: ${identifierType}`);
        return;
    }

    console.log(`[批注逻辑] 将删除${annotationsToRemove.length}个批注:`, annotationsToRemove);

    for (const annotation of annotationsToRemove) {
        try {
            await deleteAnnotationFromDB(annotation.id);
            const index = window.data.annotations.findIndex(ann => ann.id === annotation.id);
            if (index > -1) {
                window.data.annotations.splice(index, 1);
                console.log(`[批注逻辑] 成功从内存中删除批注 ID: ${annotation.id}`);
            } else {
                console.warn(`[批注逻辑] 无法从内存中删除批注 ID: ${annotation.id} (未找到索引)`);
            }
        } catch (error) {
            console.error(`[批注逻辑] removeAnnotationFromTarget: 删除批注失败:`, error);
            throw error;
        }
    }
}

/**
 * 通用函数：为现有的已高亮目标添加或更新批注内容。
 * @param {string} noteText - 批注内容。
 * @param {string} docId - 文档ID。
 * @param {string} [annotationId=null] - 可选的批注ID。
 * @param {string} [targetIdentifier=null] - 目标元素的标识符 (blockIndex 或 subBlockId)。
 * @param {string} contentIdentifier - 内容标识符。
 * @param {'blockIndex'|'subBlockId'} identifierType - 标识符的类型。
 */
export async function addNoteToAnnotation(noteText, docId, annotationId = null, targetIdentifier = null, contentIdentifier, identifierType) {
    if (!window.data.annotations) {
        throw new Error('没有找到批注数据');
    }
    if (!annotationId && targetIdentifier === null) {
        console.error(`[批注逻辑] addNoteToAnnotation: 需要 annotationId 或 targetIdentifier。`);
        throw new Error('未指定要添加批注的目标 (无ID或目标标识符)。');
    }

    // 增强日志：记录所有相关参数
    console.log(`[批注逻辑] addNoteToAnnotation 参数: docId=${docId}, annotationId=${annotationId}, targetIdentifier=${targetIdentifier}, contentIdentifier=${contentIdentifier}, identifierType=${identifierType}`);

    let existingAnnotation;
    if (annotationId) {
        // 通过ID查找批注
        existingAnnotation = window.data.annotations.find(ann =>
            ann.id === annotationId &&
            ann.targetType === contentIdentifier &&
            (ann.motivation === 'highlighting' || ann.motivation === 'commenting')
        );
        console.log(`[批注逻辑] 通过ID查找批注进行添加/更新批注: ${existingAnnotation ? '找到' : '未找到'}`);
    } else if (targetIdentifier !== null && identifierType) {
        // 通过目标标识符查找批注，使用与其他函数一致的匹配逻辑
        const targetIdStr = String(targetIdentifier).trim();

        existingAnnotation = window.data.annotations.find(ann => {
            // 确保基本条件匹配
            if (ann.targetType !== contentIdentifier) return false;
            if (!ann.target || !Array.isArray(ann.target.selector) || !ann.target.selector[0]) return false;
            if (!(ann.motivation === 'highlighting' || ann.motivation === 'commenting')) return false;

            // 获取选择器中的标识符，确保转换为字符串进行比较
            const selectorId = ann.target.selector[0][identifierType];
            if (selectorId === undefined) return false;

            const selectorIdStr = String(selectorId).trim();

            // 使用与其他函数相同的比较逻辑
            return selectorIdStr === targetIdStr || Math.abs(Number(selectorIdStr) - Number(targetIdStr)) < 0.001;
        });

        console.log(`[批注逻辑] 通过${identifierType}查找批注进行添加/更新批注: ${existingAnnotation ? '找到' : '未找到'} (目标值: ${targetIdStr})`);
    }

    if (!existingAnnotation) {
        console.warn(`[批注逻辑] addNoteToAnnotation: 未找到对应的高亮批注。 ID: ${annotationId}, TargetID: ${targetIdentifier}, Type: ${identifierType}`);
        throw new Error('未找到对应的高亮批注进行批注操作');
    }

    existingAnnotation.body = [{
        type: 'TextualBody',
        value: noteText,
        format: 'text/plain',
        purpose: 'commenting'
    }];
    existingAnnotation.modified = new Date().toISOString();
    existingAnnotation.motivation = 'commenting';

    try {
        await updateAnnotationInDB(existingAnnotation);
        console.log(`[批注逻辑] 成功更新批注 ID: ${existingAnnotation.id}`);
        // 新增：批注内容变动后立即刷新目标元素的title/class
        let targetElement = null;
        if (identifierType === 'subBlockId') {
            const containerId = contentIdentifier + '-content-wrapper';
            const container = document.getElementById(containerId);
            if (container) {
                targetElement = container.querySelector('.sub-block[data-sub-block-id="' + (existingAnnotation.target.selector[0].subBlockId || targetIdentifier) + '"]');
            }
        } else if (identifierType === 'blockIndex') {
            const containerId = contentIdentifier + '-content-wrapper';
            const container = document.getElementById(containerId);
            if (container) {
                targetElement = container.querySelector('[data-block-index="' + (existingAnnotation.target.selector[0].blockIndex || targetIdentifier) + '"]');
            }
        }
        if (targetElement && window.highlightBlockOrSubBlock) {
            window.highlightBlockOrSubBlock(targetElement, existingAnnotation, contentIdentifier, targetIdentifier, identifierType === 'subBlockId' ? 'subBlock' : 'block');
        }
    } catch (error) {
        console.error(`[批注逻辑] addNoteToAnnotation: 更新批注失败:`, error);
        throw error;
    }
}

/**
 * 创建或更新子块标注
 * @param {string} docId - 文档ID
 * @param {string} subBlockId - 子块ID
 * @param {string} contentIdentifier - 内容标识符
 * @param {string} color - 高亮颜色
 * @param {string} note - 批注内容
 * @param {string} groupId - 组ID（跨子块标注）
 */
export async function createOrUpdateSubBlockAnnotation(docId, subBlockId, contentIdentifier, color, note = '', groupId = null) {
    // 查找现有标注
    const existingAnnotation = window.data.annotations.find(ann =>
        ann.targetType === contentIdentifier &&
        ann.target && ann.target.selector && ann.target.selector[0] &&
        ann.target.selector[0].subBlockId === subBlockId
    );

    if (existingAnnotation) {
        // 更新现有标注
        existingAnnotation.highlightColor = color;
        existingAnnotation.modified = new Date().toISOString();
        if (groupId) existingAnnotation.groupId = groupId;
        if (note) {
            existingAnnotation.body = [{
                type: 'TextualBody',
                value: note,
                format: 'text/plain',
                purpose: 'commenting'
            }];
            existingAnnotation.motivation = 'commenting';
        } else if (!existingAnnotation.body || existingAnnotation.body.length === 0) {
            existingAnnotation.motivation = 'highlighting';
        }

        await updateAnnotationInDB(existingAnnotation);
    } else {
        // 创建新标注
        const newAnnotation = {
            '@context': 'http://www.w3.org/ns/anno.jsonld',
            id: 'urn:uuid:' + _page_generateUUID(),
            type: 'Annotation',
            motivation: note ? 'commenting' : 'highlighting',
            created: new Date().toISOString(),
            docId: docId,
            targetType: contentIdentifier,
            highlightColor: color,
            target: {
                source: docId,
                selector: [{
                    type: 'SubBlockSelector',
                    subBlockId: subBlockId
                }]
            },
            body: note ? [{
                type: 'TextualBody',
                value: note,
                format: 'text/plain',
                purpose: 'commenting'
            }] : []
        };

        if (groupId) newAnnotation.groupId = groupId;

        // 设置 exact 字段
        const subBlockElement = document.querySelector(`[data-sub-block-id="${subBlockId}"]`);
        if (subBlockElement) {
            newAnnotation.target.selector[0].exact = subBlockElement.textContent.trim();
        }

        await saveAnnotationToDB(newAnnotation);
        if (!window.data.annotations) window.data.annotations = [];
        window.data.annotations.push(newAnnotation);
    }
}
