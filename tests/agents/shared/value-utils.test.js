const test = require("node:test");
const assert = require("node:assert/strict");

test("isPlainObject: basic shape checks", async () => {
  const { isPlainObject } = await import("../../../js/agents/shared/value-utils.js");

  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject(undefined), false);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(() => {}), false);
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject(Object.create(null)), true);
});

test("isPlainObject: excludes built-ins and custom prototypes", async () => {
  const { isPlainObject } = await import("../../../js/agents/shared/value-utils.js");

  class X {}

  assert.equal(isPlainObject(new Date()), false);
  assert.equal(isPlainObject(new Map()), false);
  assert.equal(isPlainObject(new Set()), false);
  assert.equal(isPlainObject(/re/), false);
  assert.equal(isPlainObject(new Error("x")), false);
  assert.equal(isPlainObject(new X()), false);
  assert.equal(isPlainObject(Object.create({ a: 1 })), false);
  assert.equal(isPlainObject(Object.create(Object.create(null))), false);
});

test("toNonEmptyString: nullish and empty values -> undefined", async () => {
  const { toNonEmptyString } = await import("../../../js/agents/shared/value-utils.js");

  assert.equal(toNonEmptyString(undefined), undefined);
  assert.equal(toNonEmptyString(null), undefined);
  assert.equal(toNonEmptyString(""), undefined);
  assert.equal(toNonEmptyString("   \t\n  "), undefined);
});

test("toNonEmptyString: trims and converts via String()", async () => {
  const { toNonEmptyString } = await import("../../../js/agents/shared/value-utils.js");

  assert.equal(toNonEmptyString("  hello  "), "hello");
  assert.equal(toNonEmptyString(0), "0");
  assert.equal(toNonEmptyString(false), "false");
  assert.equal(toNonEmptyString({ toString: () => "  ok  " }), "ok");
  assert.equal(toNonEmptyString("汉字"), "汉字");
});

test("safeNumber: accepts finite numbers and numeric strings", async () => {
  const { safeNumber } = await import("../../../js/agents/shared/value-utils.js");

  assert.equal(safeNumber(0), 0);
  assert.equal(safeNumber(-2.5), -2.5);
  assert.equal(safeNumber(3.1), 3.1);

  assert.equal(safeNumber("  42  "), 42);
  assert.equal(safeNumber("3.25"), 3.25);
  assert.equal(safeNumber("1e2"), 100);
});

test("safeNumber: rejects invalid, non-finite, and non-string non-number", async () => {
  const { safeNumber } = await import("../../../js/agents/shared/value-utils.js");

  assert.equal(safeNumber(NaN), null);
  assert.equal(safeNumber(Infinity), null);
  assert.equal(safeNumber(-Infinity), null);

  assert.equal(safeNumber(""), null);
  assert.equal(safeNumber("   "), null);
  assert.equal(safeNumber("nope"), null);
  assert.equal(safeNumber("1e309"), null);

  assert.equal(safeNumber(true), null);
  assert.equal(safeNumber({ valueOf: () => 2 }), null);
  assert.equal(safeNumber(null), null);
  assert.equal(safeNumber(undefined), null);
});

test("safeInt: floors finite numeric input and rejects invalid", async () => {
  const { safeInt } = await import("../../../js/agents/shared/value-utils.js");

  assert.equal(safeInt(2), 2);
  assert.equal(safeInt(2.9), 2);
  assert.equal(safeInt(-1.2), -2);
  assert.equal(safeInt(-0.1), -1);

  assert.equal(safeInt(" 3.9 "), 3);
  assert.equal(safeInt("0"), 0);

  assert.equal(safeInt(NaN), null);
  assert.equal(safeInt(Infinity), null);
  assert.equal(safeInt(""), null);
  assert.equal(safeInt("abc"), null);
  assert.equal(safeInt(null), null);
  assert.equal(safeInt(undefined), null);
});

