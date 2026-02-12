/**
 * diagnostics_channel shim - Diagnostics channel for packages like undici
 */

export class Channel {
  constructor(name) {
    this.name = name;
    this._subscribers = new Set();
  }

  get hasSubscribers() {
    return this._subscribers.size > 0;
  }

  publish(message) {
    for (const subscriber of this._subscribers) {
      try {
        subscriber(message, this.name);
      } catch (err) {
        console.error('Error in diagnostics channel subscriber:', err);
      }
    }
  }

  subscribe(onMessage) {
    this._subscribers.add(onMessage);
  }

  unsubscribe(onMessage) {
    return this._subscribers.delete(onMessage);
  }

  bindStore(_store, _transform) {}
  unbindStore(_store) { return false; }
}

const channels = new Map();

export function channel(name) {
  let ch = channels.get(name);
  if (!ch) {
    ch = new Channel(name);
    channels.set(name, ch);
  }
  return ch;
}

export function hasSubscribers(name) {
  const ch = channels.get(name);
  return ch ? ch.hasSubscribers : false;
}

export function subscribe(name, onMessage) {
  channel(name).subscribe(onMessage);
}

export function unsubscribe(name, onMessage) {
  const ch = channels.get(name);
  return ch ? ch.unsubscribe(onMessage) : false;
}

export class TracingChannel {
  constructor(nameOrChannels) {
    if (typeof nameOrChannels === 'string') {
      this.channels = {
        start: channel(`tracing:${nameOrChannels}:start`),
        end: channel(`tracing:${nameOrChannels}:end`),
        asyncStart: channel(`tracing:${nameOrChannels}:asyncStart`),
        asyncEnd: channel(`tracing:${nameOrChannels}:asyncEnd`),
        error: channel(`tracing:${nameOrChannels}:error`),
      };
    } else {
      this.channels = nameOrChannels;
    }
  }

  get hasSubscribers() {
    return Object.values(this.channels).some(ch => ch.hasSubscribers);
  }

  subscribe(handlers) {
    if (handlers.start) this.channels.start.subscribe(handlers.start);
    if (handlers.end) this.channels.end.subscribe(handlers.end);
    if (handlers.asyncStart) this.channels.asyncStart.subscribe(handlers.asyncStart);
    if (handlers.asyncEnd) this.channels.asyncEnd.subscribe(handlers.asyncEnd);
    if (handlers.error) this.channels.error.subscribe(handlers.error);
  }

  unsubscribe(handlers) {
    if (handlers.start) this.channels.start.unsubscribe(handlers.start);
    if (handlers.end) this.channels.end.unsubscribe(handlers.end);
    if (handlers.asyncStart) this.channels.asyncStart.unsubscribe(handlers.asyncStart);
    if (handlers.asyncEnd) this.channels.asyncEnd.unsubscribe(handlers.asyncEnd);
    if (handlers.error) this.channels.error.unsubscribe(handlers.error);
  }

  traceSync(fn, context, thisArg) {
    this.channels.start.publish(context);
    try {
      const result = fn.call(thisArg);
      this.channels.end.publish(context);
      return result;
    } catch (error) {
      this.channels.error.publish({ error, ...context });
      throw error;
    }
  }

  async tracePromise(fn, context, thisArg) {
    this.channels.start.publish(context);
    try {
      const result = await fn.call(thisArg);
      this.channels.asyncEnd.publish(context);
      return result;
    } catch (error) {
      this.channels.error.publish({ error, ...context });
      throw error;
    }
  }

  traceCallback(fn, _position, _context, _thisArg) {
    return fn;
  }
}

export function tracingChannel(name) {
  return new TracingChannel(name);
}

export default {
  channel,
  hasSubscribers,
  subscribe,
  unsubscribe,
  tracingChannel,
  Channel,
  TracingChannel,
};
