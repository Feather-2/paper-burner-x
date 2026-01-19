function toMs(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

/**
 * Extract logical sequence number from event record.
 * Supports: seq, sequence, seqNo, order, index (in priority order).
 * Returns null if no valid sequence number found.
 */
function extractSeq(record) {
  if (!record || typeof record !== "object") return null;
  const candidates = [record.seq, record.sequence, record.seqNo, record.order, record.index, record.meta?.seq];
  for (const v of candidates) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function clampIndex(index, length) {
  if (!Number.isFinite(index)) return 0;
  if (index < 0) return 0;
  if (index >= length) return Math.max(0, length - 1);
  return Math.floor(index);
}

function normalizeSpeed(speed) {
  const value = Number(speed);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return value;
}

/**
 * @typedef {Record<string, unknown>} ReplayEvent
 */

export class RunReplayController {
  /**
   * @param {object} [param0]
   * @param {{ getEvents: (runId: string) => (Promise<Array<ReplayEvent>>|Array<ReplayEvent>) }} [param0.runStore]
   * @param {{ _dispatch?: (record: ReplayEvent) => void, emit?: (name: string, record: ReplayEvent) => void }} [param0.eventBus]
   * @param {number} [param0.speed]
   * @param {number} [param0.maxDelayMs]
   */
  constructor({ runStore, eventBus, speed = 1, maxDelayMs = 1200 } = {}) {
    if (!runStore || typeof runStore.getEvents !== "function") {
      throw new TypeError("RunReplayController(runStore): runStore.getEvents must be a function");
    }
    if (!eventBus || (typeof eventBus._dispatch !== "function" && typeof eventBus.emit !== "function")) {
      throw new TypeError("RunReplayController(eventBus): eventBus must implement emit or _dispatch");
    }
    this.runStore = runStore;
    this.eventBus = eventBus;
    this.speed = normalizeSpeed(speed);
    this.maxDelayMs = Number.isFinite(Number(maxDelayMs)) ? Math.max(0, Number(maxDelayMs)) : 1200;

    this._events = [];
    this._cursor = 0;
    this._elapsedMs = 0;
    this._status = "idle";
    this._timer = null;
    this._runId = null;
  }

  /**
   * @typedef {object} ReplayState
   * @property {string|null} runId - 当前加载的 run ID
   * @property {"idle"|"playing"|"paused"|"completed"} status - 回放状态
   * @property {number} speed - 回放速度倍率
   * @property {number} maxDelayMs - 最大延迟 (ms)
   * @property {number} cursor - 当前事件索引
   * @property {number} total - 总事件数
   * @property {number} elapsedMs - 已播放时间 (ms)
   */

  /**
   * 获取当前回放状态
   * @returns {ReplayState}
   */
  get state() {
    return {
      runId: this._runId,
      status: this._status,
      speed: this.speed,
      maxDelayMs: this.maxDelayMs,
      cursor: this._cursor,
      total: this._events.length,
      elapsedMs: this._elapsedMs,
    };
  }

  /**
   * @param {string} runId
   * @param {object} [param1]
   * @param {Array<ReplayEvent>=} param1.events
   * @returns {Promise<RunReplayController>}
   */
  async load(runId, { events } = {}) {
    if (!runId || typeof runId !== "string") {
      throw new TypeError("RunReplayController.load(runId): runId must be a string");
    }
    const list = Array.isArray(events) ? events : await this.runStore.getEvents(runId);
    const normalized = Array.isArray(list) ? list.map((evt, index) => ({
      record: evt,
      seq: extractSeq(evt),       // Logical sequence (preferred for ordering)
      tsMs: toMs(evt?.ts, index), // Physical timestamp (fallback)
      insertOrder: index,         // Original insertion order (final fallback)
    })) : [];

    // Sort priority: seq (logical) > ts (physical) > insertOrder (original)
    // This ensures causality even if physical clocks drift (NTP sync, timezone change).
    normalized.sort((a, b) => {
      // If both have sequence numbers, use them
      if (a.seq !== null && b.seq !== null) {
        const seqDiff = a.seq - b.seq;
        if (seqDiff !== 0) return seqDiff;
      }
      // Fall back to physical timestamp
      const tsDiff = a.tsMs - b.tsMs;
      if (tsDiff !== 0) return tsDiff;
      // Final fallback: original insertion order
      return a.insertOrder - b.insertOrder;
    });

    const baseTs = normalized.length ? normalized[0].tsMs : Date.now();
    this._events = normalized.map((item) => ({
      record: item.record,
      offsetMs: Math.max(0, item.tsMs - baseTs),
    }));
    this._runId = runId;
    this._cursor = 0;
    this._elapsedMs = 0;
    this._status = "idle";
    return this;
  }

  /**
   * 设置回放速度
   * @param {number} speed - 速度倍率 (>0)
   * @returns {void}
   */
  setSpeed(speed) {
    this.speed = normalizeSpeed(speed);
  }

  /**
   * 开始回放
   * @param {object} [param0]
   * @param {number=} param0.fromIndex - 起始事件索引
   * @param {number=} param0.speed - 回放速度
   * @returns {void}
   */
  play({ fromIndex, speed } = {}) {
    if (Number.isFinite(speed)) this.setSpeed(speed);
    if (Number.isFinite(fromIndex)) {
      this._cursor = clampIndex(fromIndex, this._events.length);
      this._elapsedMs = this._cursor > 0 ? this._events[this._cursor - 1].offsetMs : 0;
    }
    if (this._status === "playing") return;
    this._status = "playing";
    this._scheduleNext();
  }

  /**
   * 暂停回放
   * @returns {void}
   */
  pause() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._status === "playing") this._status = "paused";
  }

  /**
   * 停止回放并重置
   * @returns {void}
   */
  stop() {
    this.pause();
    this._cursor = 0;
    this._elapsedMs = 0;
    this._status = "idle";
  }

  /**
   * 跳转到指定位置
   * @param {object} [param0]
   * @param {number=} param0.index - 目标事件索引
   * @param {number=} param0.offsetMs - 目标时间偏移 (ms)
   * @returns {void}
   */
  seek({ index, offsetMs } = {}) {
    if (Number.isFinite(index)) {
      this._cursor = clampIndex(index, this._events.length);
      this._elapsedMs = this._cursor > 0 ? this._events[this._cursor - 1].offsetMs : 0;
      return;
    }
    if (Number.isFinite(offsetMs)) {
      const target = Math.max(0, Number(offsetMs));
      const nextIndex = this._events.findIndex((evt) => evt.offsetMs >= target);
      this._cursor = nextIndex === -1 ? this._events.length : nextIndex;
      this._elapsedMs = target;
    }
  }

  /**
   * 单步播放下一个事件
   * @returns {void}
   */
  step() {
    if (this._cursor >= this._events.length) return;
    const next = this._events[this._cursor];
    this._emitRecord(next.record);
    this._elapsedMs = next.offsetMs;
    this._cursor += 1;
  }

  _scheduleNext() {
    if (this._status !== "playing") return;
    if (this._cursor >= this._events.length) {
      this._status = "completed";
      return;
    }
    const next = this._events[this._cursor];
    const gapMs = Math.max(0, next.offsetMs - this._elapsedMs);
    const delayMs = this.maxDelayMs
      ? Math.min(gapMs / this.speed, this.maxDelayMs)
      : gapMs / this.speed;

    this._timer = setTimeout(() => {
      this._timer = null;
      if (this._status !== "playing") return;
      this._emitRecord(next.record);
      this._elapsedMs = next.offsetMs;
      this._cursor += 1;
      this._scheduleNext();
    }, Math.max(0, delayMs));
  }

  _emitRecord(record) {
    if (!record || typeof record !== "object") return;
    const eventName = record.name;
    if (!eventName || typeof eventName !== "string") return;

    const meta = record.meta && typeof record.meta === "object" ? record.meta : {};
    const replayRecord = { ...record, meta: { ...meta, replay: true } };

    if (typeof this.eventBus._dispatch === "function") {
      this.eventBus._dispatch(replayRecord);
    } else if (typeof this.eventBus.emit === "function") {
      this.eventBus.emit(eventName, replayRecord);
    }
  }
}
