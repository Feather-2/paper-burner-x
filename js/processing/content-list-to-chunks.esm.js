import './content-list-to-chunks.js';

const root = globalThis;

export const generateChunksFromContentList = root.generateChunksFromContentList;
export const generateChunksFromFullText = root.generateChunksFromFullText;

if (root.window) {
  if (!root.window.generateChunksFromContentList && root.generateChunksFromContentList) {
    root.window.generateChunksFromContentList = root.generateChunksFromContentList;
  }
  if (!root.window.generateChunksFromFullText && root.generateChunksFromFullText) {
    root.window.generateChunksFromFullText = root.generateChunksFromFullText;
  }
}

export default {
  generateChunksFromContentList,
  generateChunksFromFullText
};

