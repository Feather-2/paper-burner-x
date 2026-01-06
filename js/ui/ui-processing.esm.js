import './ui-processing.js';

const w = globalThis.window;

export default {
  updateFileListUI: w?.updateFileListUI,
  updateProcessButtonState: w?.updateProcessButtonState,
  showResultsSection: w?.showResultsSection,
  showProgressSection: w?.showProgressSection,
  updateConcurrentProgress: w?.updateConcurrentProgress,
  updateOverallProgress: w?.updateOverallProgress,
  updateProgress: w?.updateProgress,
  addProgressLog: w?.addProgressLog
};

