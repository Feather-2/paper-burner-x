/**
 * 手动修复历史记录搜索防抖优化
 */

const fs = require('fs');
const path = require('path');

const historyJsPath = path.join(__dirname, '../js/history/history.js');
let content = fs.readFileSync(historyJsPath, 'utf8');

// 检查是否已经应用
if (content.includes('debouncedRenderHistoryList')) {
    console.log('✅ 防抖优化已存在');
    process.exit(0);
}

// 在 historySearchInput 定义后添加防抖函数
const lines = content.split('\n');
const newLines = [];
let inserted = false;

for (let i = 0; i < lines.length; i++) {
    newLines.push(lines[i]);

    // 在 "const historyFolderSelectMobile" 这行后插入
    if (!inserted && lines[i].includes('const historyFolderSelectMobile')) {
        newLines.push('');
        newLines.push('    // 性能优化：防抖函数（减少频繁的渲染调用）');
        newLines.push('    function debounce(fn, delay) {');
        newLines.push('        let timer = null;');
        newLines.push('        return function debounced(...args) {');
        newLines.push('            const context = this;');
        newLines.push('            if (timer) clearTimeout(timer);');
        newLines.push('            timer = setTimeout(() => {');
        newLines.push('                timer = null;');
        newLines.push('                fn.apply(context, args);');
        newLines.push('            }, delay);');
        newLines.push('        };');
        newLines.push('    }');
        newLines.push('');
        newLines.push('    // 创建防抖版本的渲染函数（300ms 延迟）');
        newLines.push('    const debouncedRenderHistoryList = debounce(function() {');
        newLines.push('        renderHistoryList();');
        newLines.push('    }, 300);');
        inserted = true;
    }

    // 替换 renderHistoryList() 为 debouncedRenderHistoryList()
    if (inserted && lines[i].includes('historyUIState.searchQuery = event.target.value') && i + 1 < lines.length) {
        // 检查下一行是否是 renderHistoryList();
        if (lines[i + 1].trim() === 'renderHistoryList();') {
            newLines.push(lines[i + 1].replace('renderHistoryList();', 'debouncedRenderHistoryList();  // 使用防抖版本，减少渲染次数'));
            i++; // 跳过下一行，因为我们已经处理了
        }
    }
}

const newContent = newLines.join('\n');
fs.writeFileSync(historyJsPath, newContent, 'utf8');

console.log('✅ 历史记录搜索防抖优化已应用');
