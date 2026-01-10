/**
 * @file js/boot/deps-loader.js
 * @description 依赖加载器 - Vite 打包所有依赖
 *
 * 开发时: Vite dev server 处理裸模块
 * 构建后: 依赖打包到 vendor-*.js，双击 HTML 即可运行
 */

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

// 暴露到全局（向后兼容旧代码）
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

  console.log('[DepsLoader] Dependencies initialized');
}

// ESM 导出
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
