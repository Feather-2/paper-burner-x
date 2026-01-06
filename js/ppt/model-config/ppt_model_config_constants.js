/**
 * PPT 模型配置 - 常量表
 * IIFE module: window.PPTModelConfig.constants
 */
(function(global) {
  'use strict';

  global.PPTModelConfig = global.PPTModelConfig || {};
  const ns = global.PPTModelConfig;

  const CAPABILITY_TAGS = [
    { id: 'lang', name: '语言生成', icon: 'carbon:text-creation' },
    { id: 'vision', name: '视觉理解', icon: 'carbon:view' },
    { id: 'image', name: '图像生成', icon: 'carbon:image' },
    { id: 'audio', name: '音频处理', icon: 'carbon:microphone' }
  ];

  const ROLES = [
    // DeepSearch 角色
    { id: 'analyst', name: '分析师', desc: '扫描和理解文档', icon: 'carbon:analytics', group: 'deepsearch' },
    { id: 'planner', name: '规划师', desc: '研究规划和 Gap 识别', icon: 'carbon:plan', group: 'deepsearch' },
    { id: 'writer', name: '撰写者', desc: '内容生成和报告撰写', icon: 'carbon:edit', group: 'deepsearch' },
    { id: 'reviewer', name: '审阅者', desc: '质量检查和审阅', icon: 'carbon:checkmark-outline', group: 'deepsearch' },
    { id: 'vision', name: '视觉处理', desc: '图像理解和 OCR', icon: 'carbon:view', group: 'shared' },
    { id: 'worker', name: '通用执行', desc: '通用任务处理', icon: 'carbon:task', group: 'shared' },
    // Design 角色
    { id: 'design_tokens', name: '设计规范', desc: '提取设计系统 Tokens', icon: 'carbon:color-palette', group: 'design' },
    { id: 'design_layout', name: '布局排版', desc: '页面结构和元素布局', icon: 'carbon:grid', group: 'design' },
    { id: 'design_svg', name: 'SVG 绘制', desc: '矢量图形和图标生成', icon: 'carbon:svg', group: 'design' },
    { id: 'design_image', name: '图像生成', desc: 'AI 配图和素材生成', icon: 'carbon:image-search', group: 'design' },
    { id: 'design_review', name: '设计审阅', desc: '视觉质量检查和评审', icon: 'carbon:task-approved', group: 'design' }
  ];

  const ROLE_SHORT = {
    analyst: 'A', planner: 'P', writer: 'W', reviewer: 'R', vision: 'V', worker: 'K',
    design_tokens: 'T', design_layout: 'L', design_svg: 'S', design_image: 'I', design_review: 'Q'
  };

  const ROLE_DISPLAY_ORDER = [
    // Shared
    'worker', 'vision',
    // DeepSearch
    'analyst', 'planner', 'writer', 'reviewer',
    // Design
    'design_tokens', 'design_layout', 'design_svg', 'design_image', 'design_review'
  ];

  const ROLE_NAMES = {
    analyst: '分析师', planner: '规划师', writer: '撰写者', reviewer: '审阅者', vision: '视觉', worker: '通用',
    design_tokens: '规范', design_layout: '布局', design_svg: 'SVG', design_image: '配图', design_review: '审阅'
  };

  const ROLE_NAMES_TABLE = {
    analyst: '分析', planner: '规划', writer: '撰写', reviewer: '审阅', vision: '视觉', worker: '通用',
    design_tokens: '规范', design_layout: '布局', design_svg: 'SVG', design_image: '配图', design_review: '审阅'
  };

  const ROLE_GROUPS = {
    shared: { name: '通用', roles: ['worker', 'vision'] },
    deepsearch: { name: 'DeepSearch', roles: ['analyst', 'planner', 'writer', 'reviewer'] },
    design: { name: 'Design', roles: ['design_tokens', 'design_layout', 'design_svg', 'design_image', 'design_review'] }
  };

  const TRANSCRIPTION_PROVIDERS = [
    { id: 'groq', name: 'Groq (Whisper)', models: ['whisper-large-v3'] },
    { id: 'openai', name: 'OpenAI Whisper', models: ['whisper-1'] },
    { id: 'elevenlabs', name: 'ElevenLabs Scribe', models: ['scribe_v1'] },
    { id: 'openai-compatible', name: '兼容接口', models: [] }
  ];

  const SYNTHESIS_PROVIDERS = [
    { id: 'elevenlabs', name: 'ElevenLabs', models: ['eleven_turbo_v2_5', 'eleven_flash_v2_5'] },
    { id: 'openai', name: 'OpenAI TTS', models: ['tts-1', 'tts-1-hd'] }
  ];

  const COMMON_API_PROVIDERS = [
    { key: 'openai', name: 'OpenAI', endpoint: 'https://api.openai.com' },
    { key: 'anthropic', name: 'Anthropic', endpoint: 'https://api.anthropic.com' },
    { key: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com' },
    { key: 'groq', name: 'Groq', endpoint: 'https://api.groq.com/openai' },
    { key: 'mistral', name: 'Mistral', endpoint: 'https://api.mistral.ai' },
    { key: 'openrouter', name: 'OpenRouter', endpoint: 'https://openrouter.ai/api' },
    { key: 'together', name: 'Together AI', endpoint: 'https://api.together.xyz' },
    { key: 'gemini', name: 'Gemini (Google)', endpoint: 'https://generativelanguage.googleapis.com' },
    { key: 'tongyi', name: '通义百炼', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode' },
    { key: 'volcano', name: '火山引擎', endpoint: '' },
    { key: 'siliconflow', name: 'SiliconFlow', endpoint: 'https://api.siliconflow.cn' },
    { key: 'zhipu', name: '智谱 AI', endpoint: 'https://open.bigmodel.cn/api/paas' },
    { key: 'moonshot', name: 'Moonshot (Kimi)', endpoint: 'https://api.moonshot.cn' },
    { key: 'yi', name: '零一万物', endpoint: 'https://api.lingyiwanwu.com' },
    { key: 'baichuan', name: '百川智能', endpoint: 'https://api.baichuan-ai.com' }
  ];

  const MANUAL_MODEL_ID_PROVIDERS = {
    lang: ['volcano'], // 火山引擎模型 ID 需要手动填写
    img: [],
    vision: ['volcano']
  };

  ns.constants = ns.constants || {};
  Object.assign(ns.constants, {
    CAPABILITY_TAGS,
    ROLES,
    ROLE_SHORT,
    ROLE_DISPLAY_ORDER,
    ROLE_NAMES,
    ROLE_NAMES_TABLE,
    ROLE_GROUPS,
    TRANSCRIPTION_PROVIDERS,
    SYNTHESIS_PROVIDERS,
    COMMON_API_PROVIDERS,
    MANUAL_MODEL_ID_PROVIDERS
  });
})(typeof window !== 'undefined' ? window : globalThis);
