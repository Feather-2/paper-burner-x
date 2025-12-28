/**
 * Deque - Efficient Double-Ended Queue
 * 
 * Provides O(1) performance for shift, unshift, push, and pop operations.
 * Especially useful for large event timelines or fixed-length logs.
 */
export class Deque {
    constructor(iterable = []) {
        this._items = {};
        this._front = 0;
        this._back = 0;

        for (const item of iterable) {
            this.push(item);
        }
    }

    push(value) {
        this._items[this._back] = value;
        this._back++;
    }

    pop() {
        if (this.isEmpty()) return undefined;
        this._back--;
        const value = this._items[this._back];
        delete this._items[this._back];
        return value;
    }

    shift() {
        if (this.isEmpty()) return undefined;
        const value = this._items[this._front];
        delete this._items[this._front];
        this._front++;
        return value;
    }

    unshift(value) {
        this._front--;
        this._items[this._front] = value;
    }

    peekFront() {
        return this._items[this._front];
    }

    peekBack() {
        return this._items[this._back - 1];
    }

    isEmpty() {
        return this.size === 0;
    }

    get size() {
        return this._back - this._front;
    }

    toArray() {
        const arr = [];
        for (let i = this._front; i < this._back; i++) {
            arr.push(this._items[i]);
        }
        return arr;
    }

    clear() {
        this._items = {};
        this._front = 0;
        this._back = 0;
    }

    [Symbol.iterator]() {
        let current = this._front;
        const back = this._back;
        const items = this._items;
        return {
            next() {
                if (current < back) {
                    return { value: items[current++], done: false };
                }
                return { done: true };
            }
        };
    }
}
