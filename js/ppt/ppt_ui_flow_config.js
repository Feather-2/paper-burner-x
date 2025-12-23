(() => {
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;

  const DEFAULT_UI_FLOW_CONFIG = {
    stateOrder: [
      'idle',
      'briefing',
      'reading',
      'scanning',
      'researching',
      'deepsearch_review',
      'questioning',
      'script_review',
      'scripting',
      'outline_review',
      'outline_planning',
      'page_layout',
      'design_preferences',
      'designer',
      'completed',
      'failed'
    ],
    deepsearchStepper: [
      { state: 'reading', label: '阅读' },
      { state: 'researching', label: '研究' },
      { state: 'script_review', label: '脚本' },
      { state: 'page_layout', label: '规划' },
      { state: 'designer', label: '设计' }
    ],
    viewMap: {
      idle: 'upload',
      briefing: 'briefing',
      deepsearch_review: 'deepsearch_review',
      script_review: 'script_review',
      questioning: 'questioning',
      outline_review: 'outline_review',
      page_layout: 'page_layout'
    },
    defaultView: 'deepsearch_premium',
    stateAliases: {}
  };

  const mergeConfig = (base, override) => {
    if (!override || typeof override !== 'object') return base;

    const next = { ...base, ...override };
    next.stateOrder = Array.isArray(override.stateOrder) && override.stateOrder.length
      ? override.stateOrder
      : base.stateOrder;
    next.deepsearchStepper = Array.isArray(override.deepsearchStepper) && override.deepsearchStepper.length
      ? override.deepsearchStepper
      : base.deepsearchStepper;
    next.viewMap = {
      ...base.viewMap,
      ...(override.viewMap && typeof override.viewMap === 'object' ? override.viewMap : {})
    };
    next.stateAliases = {
      ...base.stateAliases,
      ...(override.stateAliases && typeof override.stateAliases === 'object' ? override.stateAliases : {})
    };
    if (typeof override.defaultView !== 'string' || !override.defaultView) {
      next.defaultView = base.defaultView;
    }
    return next;
  };

  const getUiFlowConfig = () => mergeConfig(DEFAULT_UI_FLOW_CONFIG, NS.uiFlowConfig);

  const getAliasedState = (state) => {
    const config = getUiFlowConfig();
    const aliases = config.stateAliases && typeof config.stateAliases === 'object' ? config.stateAliases : {};
    return aliases[state] || state;
  };

  const getStateIndex = (state) => {
    const config = getUiFlowConfig();
    const order = Array.isArray(config.stateOrder) ? config.stateOrder : [];
    const effective = getAliasedState(state);
    return order.indexOf(effective);
  };

  const getViewKey = (state) => {
    const config = getUiFlowConfig();
    const viewMap = config.viewMap && typeof config.viewMap === 'object' ? config.viewMap : {};
    return viewMap[state] || config.defaultView || 'deepsearch_premium';
  };

  const getDeepsearchStepper = () => {
    const config = getUiFlowConfig();
    const steps = Array.isArray(config.deepsearchStepper) ? config.deepsearchStepper : [];
    return steps.map((step) => {
      if (step && typeof step === 'object') {
        return {
          state: typeof step.state === 'string' ? step.state : '',
          label: typeof step.label === 'string' ? step.label : (typeof step.state === 'string' ? step.state : '')
        };
      }
      if (typeof step === 'string') return { state: step, label: step };
      return { state: '', label: '' };
    }).filter((step) => step.state);
  };

  NS.defaultUiFlowConfig = DEFAULT_UI_FLOW_CONFIG;
  NS.getUiFlowConfig = getUiFlowConfig;
  NS.PPTFlowConfig = {
    getUiFlowConfig,
    getAliasedState,
    getStateIndex,
    getViewKey,
    getDeepsearchStepper
  };
})();
