/**
 * @file js/boot/deps-loader.js
 * @description 依赖加载器 - 在应用启动前初始化所有第三方依赖
 *
 * 生产构建时，这些依赖会被打包；开发时可选择使用 CDN。
 */

// 核心依赖（同步导入，会被打包）
import DOMPurify from 'dompurify';
import axios from 'axios';
import { Base64 } from 'js-base64';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { marked } from 'marked';
import markdownIt from 'markdown-it';
import katex from 'katex';
import anime from 'animejs';
import graphlib from 'graphlib';
import dagre from 'dagre';

// 暴露到全局（向后兼容）
if (typeof window !== 'undefined') {
  window.DOMPurify = DOMPurify;
  window.axios = axios;
  window.Base64 = Base64;
  window.saveAs = saveAs;
  window.JSZip = JSZip;
  window.marked = marked;
  window.markdownit = markdownIt;
  window.katex = katex;
  window.anime = anime;
  window.graphlib = graphlib;
  window.dagre = dagre;

  console.log('[DepsLoader] Core dependencies initialized');
}

// 导出供 ESM 使用
export {
  DOMPurify,
  axios,
  Base64,
  saveAs,
  JSZip,
  marked,
  markdownIt,
  katex,
  anime,
  graphlib,
  dagre
};

export default {
  DOMPurify,
  axios,
  Base64,
  saveAs,
  JSZip,
  marked,
  markdownIt,
  katex,
  anime,
  graphlib,
  dagre
};
