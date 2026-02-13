/**
 * Punycode shim - Minimal implementation for browser environment
 * Provides basic encoding/decoding stubs
 */

export function encode(str) {
  return str;
}

export function decode(str) {
  return str;
}

export function toASCII(domain) {
  return domain;
}

export function toUnicode(domain) {
  return domain;
}

export default {
  encode,
  decode,
  toASCII,
  toUnicode,
};
