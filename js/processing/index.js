import { ensureProcessingDeps } from './processing_deps.esm.js';

import MarkdownProcessorEnhanced from './markdown_processor_enhanced.esm.js';
import createAnnotationPluginAST from './annotation_plugin_ast.esm.js';
import MarkdownProcessorAST from './markdown_processor_ast.esm.js';
import MarkdownIntegration from './markdown_processor_integration.esm.js';
import MarkdownTextFix from './markdown_text_fix.esm.js';
import MarkdownProcessor, {
  legacy as markdownLegacy,
  renderWithKatexFailback,
  safeMarkdown
} from './markdown_processor.esm.js';

import ReferenceDetector, {
  detectReferenceSection,
  parseReferenceEntries,
  isReferenceSectionTitle,
  isLikelyReferenceEntry,
  analyzeReferenceFormats,
  getRecommendedFormat
} from './reference-detector.esm.js';
import ReferenceExtractor from './reference-extractor.esm.js';
import DOIResolver from './reference-doi-resolver.esm.js';
import ReferenceAIProcessor from './reference-ai-processor.esm.js';
import ReferenceIndexer, { ReferenceIndexer as ReferenceIndexerClass } from './reference-indexer.esm.js';

import FormulaPostProcessor from './formula_post_processor.esm.js';
import FormulaPostProcessorAsync from './formula_post_processor_async.esm.js';

import SubBlockSegmenter from './sub_block_segmenter.esm.js';
import ContentListToChunks, {
  generateChunksFromContentList,
  generateChunksFromFullText
} from './content-list-to-chunks.esm.js';

import ReActEngine from './react_engine.esm.js';

export function initializeProcessingGlobals(targetWindow = (globalThis.window ??= {})) {
  const deps = ensureProcessingDeps(globalThis);

  if (targetWindow !== globalThis.window) {
    if (!targetWindow.marked) targetWindow.marked = deps.marked;
    if (!targetWindow.katex) targetWindow.katex = deps.katex;
    if (!targetWindow.markdownit) targetWindow.markdownit = deps.markdownit;
    if (!targetWindow.DOMPurify) targetWindow.DOMPurify = deps.DOMPurify;
  }

  if (MarkdownProcessor && !targetWindow.MarkdownProcessor) targetWindow.MarkdownProcessor = MarkdownProcessor;
  if (MarkdownProcessorEnhanced && !targetWindow.MarkdownProcessorEnhanced) {
    targetWindow.MarkdownProcessorEnhanced = MarkdownProcessorEnhanced;
  }
  if (MarkdownProcessorAST && !targetWindow.MarkdownProcessorAST) targetWindow.MarkdownProcessorAST = MarkdownProcessorAST;
  if (MarkdownIntegration && !targetWindow.MarkdownIntegration) targetWindow.MarkdownIntegration = MarkdownIntegration;
  if (MarkdownTextFix && !targetWindow.MarkdownTextFix) targetWindow.MarkdownTextFix = MarkdownTextFix;
  if (ReferenceDetector && !targetWindow.ReferenceDetector) targetWindow.ReferenceDetector = ReferenceDetector;
  if (ReferenceExtractor && !targetWindow.ReferenceExtractor) targetWindow.ReferenceExtractor = ReferenceExtractor;
  if (ReferenceIndexer && !targetWindow.ReferenceIndexer) targetWindow.ReferenceIndexer = ReferenceIndexer;
  if (DOIResolver && !targetWindow.DOIResolver) targetWindow.DOIResolver = DOIResolver;
  if (ReferenceAIProcessor && !targetWindow.ReferenceAIProcessor) targetWindow.ReferenceAIProcessor = ReferenceAIProcessor;
  if (FormulaPostProcessor && !targetWindow.FormulaPostProcessor) targetWindow.FormulaPostProcessor = FormulaPostProcessor;
  if (FormulaPostProcessorAsync && !targetWindow.FormulaPostProcessorAsync) {
    targetWindow.FormulaPostProcessorAsync = FormulaPostProcessorAsync;
  }
  if (SubBlockSegmenter && !targetWindow.SubBlockSegmenter) targetWindow.SubBlockSegmenter = SubBlockSegmenter;
  if (ContentListToChunks && !targetWindow.ContentListToChunks) targetWindow.ContentListToChunks = ContentListToChunks;
  if (createAnnotationPluginAST && !targetWindow.createAnnotationPluginAST) {
    targetWindow.createAnnotationPluginAST = createAnnotationPluginAST;
  }
  if (ReActEngine && !targetWindow.ReActEngine) targetWindow.ReActEngine = ReActEngine;

  const processingFacade = targetWindow.Processing || {};

  processingFacade.markdown = {
    safeMarkdown: MarkdownProcessor?.safeMarkdown,
    renderWithKatexFailback: MarkdownProcessor?.renderWithKatexFailback,
    legacy: markdownLegacy,
    enhanced: MarkdownProcessorEnhanced,
    ast: MarkdownProcessorAST,
    integration: MarkdownIntegration,
    textFix: MarkdownTextFix,
    annotationPlugin: createAnnotationPluginAST
  };

  processingFacade.reference = {
    detectReferenceSection: ReferenceDetector?.detectReferenceSection,
    parseReferenceEntries: ReferenceDetector?.parseReferenceEntries,
    isReferenceSectionTitle: ReferenceDetector?.isReferenceSectionTitle,
    isLikelyReferenceEntry: ReferenceDetector?.isLikelyReferenceEntry,
    analyzeReferenceFormats: ReferenceDetector?.analyzeReferenceFormats,
    getRecommendedFormat: ReferenceDetector?.getRecommendedFormat,
    extractor: ReferenceExtractor,
    indexer: ReferenceIndexer,
    indexerClass: ReferenceIndexerClass,
    doi: DOIResolver,
    ai: ReferenceAIProcessor
  };

  processingFacade.formula = {
    postProcessor: FormulaPostProcessor,
    async: FormulaPostProcessorAsync
  };

  processingFacade.chunks = {
    ...ContentListToChunks,
    generateChunksFromContentList,
    generateChunksFromFullText
  };

  processingFacade.subBlock = SubBlockSegmenter;
  processingFacade.engine = { ReActEngine };

  processingFacade.deps = {
    marked: targetWindow.marked,
    katex: targetWindow.katex,
    markdownit: targetWindow.markdownit,
    DOMPurify: targetWindow.DOMPurify
  };

  processingFacade.version = '1.0.0';

  targetWindow.Processing = processingFacade;
  return processingFacade;
}

export {
  ensureProcessingDeps,
  MarkdownProcessor,
  MarkdownProcessorAST,
  MarkdownProcessorEnhanced,
  MarkdownIntegration,
  MarkdownTextFix,
  ReferenceDetector,
  ReferenceExtractor,
  ReferenceIndexer,
  ReferenceIndexerClass,
  DOIResolver,
  ReferenceAIProcessor,
  FormulaPostProcessor,
  FormulaPostProcessorAsync,
  SubBlockSegmenter,
  ContentListToChunks,
  createAnnotationPluginAST,
  ReActEngine
};

export {
  safeMarkdown,
  renderWithKatexFailback,
  markdownLegacy,
  detectReferenceSection,
  parseReferenceEntries,
  isReferenceSectionTitle,
  isLikelyReferenceEntry,
  analyzeReferenceFormats,
  getRecommendedFormat,
  generateChunksFromContentList,
  generateChunksFromFullText
};

export default {
  initializeProcessingGlobals,
  markdown: MarkdownProcessor,
  reference: ReferenceDetector,
  deps: ensureProcessingDeps(globalThis)
};
