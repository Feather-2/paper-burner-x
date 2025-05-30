window.renderWithKatexStreaming = function(md) {
  const codeBlocks = [];
  let codeBlockCounter = 0;
  md = md.replace(/```([\s\S]+?)```/g, function(match) {
    const placeholder = `__CODE_BLOCK_${codeBlockCounter}__`;
    codeBlocks[codeBlockCounter] = match;
    codeBlockCounter++;
    return placeholder;
  });
  md = md.replace(/`([^`]+?)`/g, function(match) {
    const placeholder = `__CODE_BLOCK_${codeBlockCounter}__`;
    codeBlocks[codeBlockCounter] = match;
    codeBlockCounter++;
    return placeholder;
  });
  md = md.replace(/\$\$([\s\S]+?)\$\$/g, function(_, tex) {
    try {
      return '<div class="katex-block">' + katex.renderToString(tex, { displayMode: true }) + '</div>';
    } catch (e) {
      return '<pre>' + tex + '</pre>';
    }
  });
  md = md.replace(/\\\[([\s\S]+?)\\\]/g, function(_, tex) {
    try {
      return '<div class="katex-block">' + katex.renderToString(tex, { displayMode: true }) + '</div>';
    } catch (e) {
      return '<pre>' + tex + '</pre>';
    }
  });
  md = md.replace(/\$([^\$]+?)\$/g, function(_, tex) {
    try {
      return '<span class="katex-inline">' + katex.renderToString(tex, { displayMode: false }) + '</span>';
    } catch (e) {
      return '<code>' + tex + '</code>';
    }
  });
  md = md.replace(/\\\(([^)]+?)\\\)/g, function(_, tex) {
    try {
      return '<span class="katex-inline">' + katex.renderToString(tex, { displayMode: false }) + '</span>';
    } catch (e) {
      return '<code>' + tex + '</code>';
    }
  });
  for (let i = 0; i < codeBlockCounter; i++) {
    md = md.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
  }
  return marked.parse(md);
};