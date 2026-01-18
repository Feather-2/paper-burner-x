/**
 * @file js/shared/adapters/deepsearch-adapter.js
 * @description DeepSearch UI 适配器 - 管理证据池、模拟数据流
 *
 * 从 js/ppt/ui-v2/adapters/deepsearch-adapter.js 迁移
 */

import { BaseAdapter } from './base-adapter.js';

/**
 * @typedef {Object} EvidenceItem
 * @property {string} source - 来源
 * @property {string} content - 内容
 */

/**
 * @typedef {Object} KnowledgeNode
 * @property {string} source - 来源
 * @property {string} content - 内容
 * @property {number} x - X 坐标
 * @property {number} y - Y 坐标
 */

/**
 * DeepSearch UI 适配器
 */
export class DeepSearchAdapter extends BaseAdapter {
  /**
   * @param {Object} eventBus - 事件总线
   * @param {Object} [options={}] - 配置选项
   */
  constructor(eventBus, options = {}) {
    super(eventBus, options);

    /** @type {EvidenceItem[]} */
    this._evidencePool = options.evidencePool || [
      { source: 'Gartner 第三季度', content: '第三季度财报确认增长指数为 24%...' },
      { source: 'SEC_备案_A2', content: '云原生安全支出同比增长 18%...' },
      { source: 'IEEE_S&P_24', content: '在 API 网关层发现新的攻击向量...' },
      { source: 'Forrester 研究', content: '通过集成的零信任架构保持领导者地位...' },
      { source: 'IDC 追踪器', content: '前五大供应商的市场份额出现合并趋势...' }
    ];

    /** @type {string[]} */
    this._phrases = options.phrases || [
      '正在根据 CP_024 证据块补全：主要市场参与者 A 在 Q3 实现了 24% 的溢价增长...',
      '正在验证数据一致性：对比 Source B 提供的 18.5% 预测模型...',
      '提取论点成功：云原生转型直接驱动了 2025 年 API 安全市场的翻倍...',
      '正在重写结论：由于地缘因素影响，供应链安全等级被提升至 P0 级别...',
      '校对引用来源：已关联至 Gartner 2024 年度安全技术报告...'
    ];

    this._phraseIdx = 0;
    this._timer = null;
    this._typingTimer = null;
  }

  /**
   * 启动数据流
   */
  start() {
    this._setState({ status: 'running' });

    // 定时生成知识节点
    this._timer = setInterval(() => {
      this.generateKnowledgeNode();
    }, 4000);

    // 初始延迟后生成第一个
    setTimeout(() => {
      this.generateKnowledgeNode();
      this._eventBus.emit('forge:notification', {
        message: '开始同步外部证据块...',
        icon: 'carbon:cloud-download'
      });
    }, 1000);

    // 模拟打字机更新
    this._typingTimer = setInterval(() => {
      this._phraseIdx = (this._phraseIdx + 1) % this._phrases.length;
      const phrase = this._phrases[this._phraseIdx];
      this._eventBus.emit('forge:typing-update', { phrase });

      if (this._phraseIdx === 2) {
        this._eventBus.emit('forge:notification', {
          message: '已识别出 2025 年关键增长趋势',
          icon: 'carbon:analytics'
        });
      }
    }, 6000);
  }

  /**
   * 停止数据流
   */
  stop() {
    if (this._timer) clearInterval(this._timer);
    if (this._typingTimer) clearInterval(this._typingTimer);
    this._timer = null;
    this._typingTimer = null;
    this._setState({ status: 'idle' });
  }

  /**
   * 生成知识节点
   * @returns {KnowledgeNode}
   */
  generateKnowledgeNode() {
    const data = this._evidencePool[Math.floor(Math.random() * this._evidencePool.length)];
    // 随机分布位置
    const side = Math.random() > 0.5 ? 'left' : 'right';
    const x = side === 'left' ? (Math.random() * 8 + 18) : (Math.random() * 8 + 74);
    const y = Math.random() * 70 + 15;

    const node = { ...data, x, y };
    this._eventBus.emit('forge:new-node', node);
    return node;
  }

  /**
   * 设置证据池
   * @param {EvidenceItem[]} pool
   */
  setEvidencePool(pool) {
    if (Array.isArray(pool)) {
      this._evidencePool = pool;
    }
  }

  /**
   * 设置短语列表
   * @param {string[]} phrases
   */
  setPhrases(phrases) {
    if (Array.isArray(phrases)) {
      this._phrases = phrases;
    }
  }

  /**
   * 销毁
   */
  dispose() {
    this.stop();
    super.dispose();
  }
}

export default DeepSearchAdapter;
