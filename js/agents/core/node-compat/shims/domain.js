/**
 * domain shim - Domain module is deprecated but some packages still use it
 */

import { EventEmitter } from './events.js';

export class Domain extends EventEmitter {
  constructor() {
    super();
    this.members = [];
  }

  add(emitter) {
    this.members.push(emitter);
  }

  remove(emitter) {
    const index = this.members.indexOf(emitter);
    if (index !== -1) {
      this.members.splice(index, 1);
    }
  }

  bind(callback) {
    return callback;
  }

  intercept(callback) {
    return callback;
  }

  run(fn) {
    return fn();
  }

  dispose() {
    this.members = [];
  }

  enter() {}
  exit() {}
}

export function create() {
  return new Domain();
}

export let active = null;

export default {
  Domain,
  create,
  active,
};
