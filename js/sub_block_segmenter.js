// js/sub_block_segmenter.js
(function SubBlockSegmenter(global) {
    /**
     * 将块级元素内容按标点分割成子块 (span.sub-block)。
     * @param {HTMLElement} blockElement - 要分割的块级元素 (如 p, h1-h6)。
     * @param {string|number} parentBlockIndex - 父块的索引。
     */
    function segmentBlockIntoSubBlocks(blockElement, parentBlockIndex) {
        let subBlockTrueCounter = 0; // Counter for non-empty sub-blocks
        const newChildNodesContainer = document.createDocumentFragment();
        let firstGeneratedSubBlockElement = null; // Store the first (potentially only) sub-block

        // Define delimiters: ONLY Chinese period
        // The regex captures the delimiter itself and any trailing whitespace.
        const delimiterRegex = /([。])(\s*)/g; // 只使用中文句号作为分隔符

        let currentSpanContentNodes = []; // Nodes for the current sub-block being built

        function flushCurrentSpan(isEndOfBlock = false) {
            if (currentSpanContentNodes.length > 0) {
                const tempSpan = document.createElement('span'); // Temporary span to check if it's empty
                currentSpanContentNodes.forEach(n => tempSpan.appendChild(n.cloneNode(true))); // Use cloned nodes for check

                if (tempSpan.textContent.trim() !== "" || (isEndOfBlock && tempSpan.innerHTML.trim() !== "")) { // Ensure span is not just whitespace or empty HTML
                    const span = document.createElement('span');
                    span.className = 'sub-block';
                    span.dataset.subBlockId = `${parentBlockIndex}.${subBlockTrueCounter}`; // Corrected template literal
                    currentSpanContentNodes.forEach(n => span.appendChild(n)); // Append original nodes
                    newChildNodesContainer.appendChild(span);

                    if (subBlockTrueCounter === 0) { // If this is the first non-empty sub-block
                        firstGeneratedSubBlockElement = span;
                    } else { // If we've already found one and now found another, it's not the only one
                        firstGeneratedSubBlockElement = null; // Invalidate, as there are multiple
                    }
                    subBlockTrueCounter++;
                }
                currentSpanContentNodes = [];
            }
        }

        function processNodesRecursive(nodes) {
            for (const node of nodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                    let text = node.textContent;
                    let lastIndex = 0;
                    let match;
                    if (text.trim() === '' && currentSpanContentNodes.length === 0) { // Skip leading pure whitespace text nodes if current span is empty
                        continue;
                    }
                    while ((match = delimiterRegex.exec(text)) !== null) {
                        // Add text before delimiter
                        if (match.index > lastIndex) {
                            currentSpanContentNodes.push(document.createTextNode(text.substring(lastIndex, match.index)));
                        }
                        // Add the delimiter itself
                        currentSpanContentNodes.push(document.createTextNode(match[1]));
                        // Add trailing space if captured
                        if (match[2]) {
                            currentSpanContentNodes.push(document.createTextNode(match[2]));
                        }
                        flushCurrentSpan(); // End of a sub-block
                        lastIndex = match.index + match[0].length;
                    }
                    // Add remaining text after the last delimiter
                    if (lastIndex < text.length) {
                        currentSpanContentNodes.push(document.createTextNode(text.substring(lastIndex)));
                    }
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    // For inline elements, clone them and add to current span content.
                    currentSpanContentNodes.push(node.cloneNode(true));
                } else {
                    // Other node types (comments, etc.), clone and add.
                    currentSpanContentNodes.push(node.cloneNode(true));
                }
            }
        }

        processNodesRecursive(Array.from(blockElement.childNodes));
        flushCurrentSpan(true); // Flush any remaining content, isEndOfBlock = true

        // Clear original content and append new sub-block spans
        blockElement.innerHTML = '';
        blockElement.appendChild(newChildNodesContainer);

        // After all processing, if firstGeneratedSubBlockElement is still set (i.e., subBlockTrueCounter ended at 1)
        if (firstGeneratedSubBlockElement && subBlockTrueCounter === 1) {
            firstGeneratedSubBlockElement.dataset.isOnlySubBlock = "true";
        }
    }

    // Expose public interface
    global.SubBlockSegmenter = {
        segment: segmentBlockIntoSubBlocks
    };

})(window);