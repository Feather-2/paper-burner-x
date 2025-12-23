/**
 * UI V2 entry
 */

import { createViewRouter } from './core/view-router.js';
import { getStateStore, ViewType } from './core/state-store.js';
import { getUIEventBus } from './core/event-bus.js';
import { getPptGeneratorAdapter } from './adapters/agent-adapter.js';
import { createModalManager } from './modals/modal-manager.js';
import UploadView from './views/upload-view.js';
import BriefingView from './views/briefing-view.js';
import ResearchView from './views/research-view.js';
import DeepsearchReviewView from './views/deepsearch-review-view.js';
import QuestioningView from './views/questioning-view.js';
import ScriptReviewView from './views/script-review-view.js';
import OutlineReviewView from './views/outline-review-view.js';
import PageLayoutView from './views/page-layout-view.js';
import DesignPreferencesView from './views/design-preferences-view.js';
import DesignerView from './views/designer-view.js';
import FailedView from './views/failed-view.js';

export function startPptUiV2({ container = '#pptPreviewArea', generator } = {}) {
  if (typeof window !== 'undefined' && window.PPTUIV2?.instance) {
    const existing = window.PPTUIV2.instance;
    existing.adapter?.setGenerator?.(generator);
    existing.modalManager?.setGenerator?.(generator);
    existing.modalManager?.patchGenerator?.(generator);
    existing.adapter?.syncFromGenerator?.();
    return existing;
  }

  const stateStore = getStateStore();
  const eventBus = getUIEventBus();
  const adapter = getPptGeneratorAdapter({ generator });
  const modalManager = createModalManager({ adapter, eventBus, stateStore, generator });
  modalManager.patchGenerator(generator);

  adapter?.syncFromGenerator?.();

  const router = createViewRouter({ stateStore });
  router
    .register(ViewType.UPLOAD, UploadView)
    .register(ViewType.BRIEFING, BriefingView)
    .register(ViewType.DEEPSEARCH_PREMIUM, ResearchView)
    .register(ViewType.DEEPSEARCH_REVIEW, DeepsearchReviewView)
    .register(ViewType.QUESTIONING, QuestioningView)
    .register(ViewType.SCRIPT_REVIEW, ScriptReviewView)
    .register(ViewType.OUTLINE_REVIEW, OutlineReviewView)
    .register(ViewType.PAGE_LAYOUT, PageLayoutView)
    .register(ViewType.DESIGN_PREFERENCES, DesignPreferencesView)
    .register(ViewType.DESIGNER, DesignerView)
    .register(ViewType.FAILED, FailedView)
    .mount(container);

  const instance = { router, stateStore, eventBus, adapter, modalManager };
  if (typeof window !== 'undefined') {
    window.PPTUIV2 = Object.assign(window.PPTUIV2 || {}, {
      instance
    });
  }

  return instance;
}

if (typeof window !== 'undefined') {
  window.PPTUIV2 = Object.assign(window.PPTUIV2 || {}, {
    startPptUiV2
  });
}
