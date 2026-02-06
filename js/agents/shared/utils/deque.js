/**
 * Deque - Efficient Double-Ended Queue
 * 
 * Provides O(1) performance for shift, unshift, push, and pop operations.
 * Especially useful for large event timelines or fixed-length logs.
 *
 * @template T
 */
export class Deque {
    /**
     * @param {Iterable<T>} [iterable]
     */
    constructor(iterable = []) {
        /** @type {Record<number, T>} */
        this._items = {};
        /** @type {number} */
        this._front = 0;
        /** @type {number} */
        this._back = 0;

        for (const item of iterable) {
            this.push(item);
        }
    }

    /**
     * @param {T} value
     * @returns {void}
     */
    push(value) {
        this._items[this._back] = value;
        this._back++;
    }

    /**
     * @returns {T | undefined}
     */
    pop() {
        if (this.isEmpty()) return undefined;
        this._back--;
        const value = this._items[this._back];
        delete this._items[this._back];
        if (this._front === this._back) { this._items = {}; this._front = 0; this._back = 0; }
        return value;
    }

    /**
     * @returns {T | undefined}
     */
    shift() {
        if (this.isEmpty()) return undefined;
        const value = this._items[this._front];
        delete this._items[this._front];
        this._front++;
        if (this._front === this._back) { this._items = {}; this._front = 0; this._back = 0; }
        return value;
    }

    /**
     * @param {T} value
     * @returns {void}
     */
    unshift(value) {
        this._front--;
        this._items[this._front] = value;
    }

    /**
     * @returns {T | undefined}
     */
    peekFront() {
        return this._items[this._front];
    }

    /**
     * @returns {T | undefined}
     */
    peekBack() {
        return this._items[this._back - 1];
    }

    /**
     * @returns {boolean}
     */
    isEmpty() {
        return this.size === 0;
    }

    /**
     * @returns {number}
     */
    get size() {
        return this._back - this._front;
    }

    /**
     * @returns {T[]}
     */
    toArray() {
        const arr = [];
        for (let i = this._front; i < this._back; i++) {
            arr.push(this._items[i]);
        }
        return arr;
    }

    /**
     * @returns {void}
     */
    clear() {
        this._items = {};
        this._front = 0;
        this._back = 0;
    }

    /**
     * @returns {Iterator<T>}
     */
    [Symbol.iterator]() {
        let current = this._front;
        const back = this._back;
        const items = this._items;
        return {
            next() {
                if (current < back) {
                    return { value: items[current++], done: false };
                }
                return { done: true, value: undefined };
            }
        };
    }
}
