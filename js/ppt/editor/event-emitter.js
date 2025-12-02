/**
 * 轻量级事件发射器
 * 用于模块间通信
 */
class EventEmitter {
    constructor() {
        this._events = new Map();
    }

    /**
     * 监听事件
     */
    on(event, listener) {
        if (!this._events.has(event)) {
            this._events.set(event, new Set());
        }
        this._events.get(event).add(listener);
        return () => this.off(event, listener);
    }

    /**
     * 单次监听
     */
    once(event, listener) {
        const wrapper = (...args) => {
            this.off(event, wrapper);
            listener(...args);
        };
        return this.on(event, wrapper);
    }

    /**
     * 取消监听
     */
    off(event, listener) {
        if (listener) {
            this._events.get(event)?.delete(listener);
        } else {
            this._events.delete(event);
        }
    }

    /**
     * 触发事件
     */
    emit(event, data) {
        const listeners = this._events.get(event);
        if (listeners) {
            listeners.forEach(listener => {
                try {
                    listener(data);
                } catch (e) {
                    console.error(`[EventEmitter] Error in listener for "${event}":`, e);
                }
            });
        }
    }

    /**
     * 清除所有监听
     */
    clear() {
        this._events.clear();
    }
}

window.EventEmitter = EventEmitter;
