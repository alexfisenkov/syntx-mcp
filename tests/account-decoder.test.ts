import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeAccountBalance,
  decodeSubscription,
  SyntxAccountDecodeError
} from "../src/adapter/syntx/account-decoder.js";

test("balance preserves zero, signed decimal digits and unknown separately", () => {
  for (const balance of [undefined, null, ""]) {
    assert.deepEqual(decodeAccountBalance({ balance }), { available: null });
  }
  assert.deepEqual(decodeAccountBalance({}), { available: null });
  for (const [balance, available] of [
    [0, "0"], [-0, "0"], [-1.25, "-1.25"], [1e-7, "0.0000001"],
    [-1e-7, "-0.0000001"], [Number.MAX_SAFE_INTEGER, "9007199254740991"],
    ["+00012.345678901234567890", "+00012.345678901234567890"],
    ["-0.000", "-0.000"], ["900719925474099123456789", "900719925474099123456789"]
  ]) {
    assert.deepEqual(decodeAccountBalance({ balance }), { available });
  }
});

test("balance rejects unsafe precision, coercions, junk and unbounded values", () => {
  for (const balance of [
    true, false, {}, [], NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1,
    0.1234567890123456, 1e-200, " ", " 1", "1 ", "1e3", "0x10", ".5", "1.",
    "NaN", "Infinity", "12 tokens", "1\n", "9".repeat(129)
  ]) {
    assert.throws(() => decodeAccountBalance({ balance }), SyntxAccountDecodeError);
  }
  for (const raw of [null, undefined, [], "10", 10]) {
    assert.throws(() => decodeAccountBalance(raw), SyntxAccountDecodeError);
  }
});

test("subscription strips identity and historical plans, preserves false", () => {
  assert.deepEqual(decodeSubscription({
    active: false, type: "basic", end_date: null,
    email: "private@example.invalid", payment: { secret: "not-returned" },
    last_subscription: { active: true, type: "premium", end_date: "2099-01-01" }
  }), { active: false, plan_type: "basic", end_date: null, end_date_kind: null });
  assert.deepEqual(decodeSubscription({}), {
    active: null, plan_type: null, end_date: null, end_date_kind: null
  });
  for (const active of [0, 1, "true", "false", "", {}, []]) {
    assert.throws(() => decodeSubscription({ active }), SyntxAccountDecodeError);
  }
  for (const type of [false, 1, {}, "", "x".repeat(81), "tier\n", "https://invalid.example"] ) {
    assert.throws(() => decodeSubscription({ type }), SyntxAccountDecodeError);
  }
});

test("subscription date semantics retain timezone-free dates and offsets verbatim", () => {
  for (const [end_date, end_date_kind] of [
    ["2028-02-29", "DATE_ONLY"], ["2000-02-29", "DATE_ONLY"],
    ["2026-09-04T12:34:56", "LOCAL_DATETIME"],
    ["2026-09-04 12:34:56.123456789", "LOCAL_DATETIME"],
    ["2026-09-04T12:34:56Z", "OFFSET_DATETIME"],
    ["2026-09-04T12:34:56.123+03:00", "OFFSET_DATETIME"],
    ["2026-09-04T12:34:56-12:00", "OFFSET_DATETIME"],
    ["2026-09-04T12:34:56+14:00", "OFFSET_DATETIME"]
  ]) {
    const result = decodeSubscription({ active: true, end_date });
    assert.equal(result.end_date, end_date);
    assert.equal(result.end_date_kind, end_date_kind);
  }
});

test("subscription rejects impossible dates, timestamps without provenance and invalid offsets", () => {
  for (const end_date of [
    "", 1_788_480_000, {}, "0000-01-01", "1900-02-29", "2026-02-29", "2026-04-31",
    "2026-00-01", "2026-13-01", "2026-01-00", "2026-01-32", "04/09/2026",
    "2026-09-04Z", "2026-09-04T24:00:00Z", "2026-09-04T12:60:00Z",
    "2026-09-04T12:59:60Z", "2026-09-04T12:00:00+14:01",
    "2026-09-04T12:00:00-15:00", "2026-09-04T12:00:00+03:60",
    "2026-09-04T12:00:00-00:00",
    "2026-09-04T12:00:00+0300", "2026-09-04T12:00:00 GMT", "2026-09-04\n"
  ]) {
    assert.throws(() => decodeSubscription({ end_date }), SyntxAccountDecodeError);
  }
});

test("decoders do not execute property getters or inherit account fields", () => {
  let calls = 0;
  const raw = Object.defineProperty({}, "balance", { get() { calls += 1; return 12; } });
  assert.throws(() => decodeAccountBalance(raw), SyntxAccountDecodeError);
  const inherited = Object.create({ active: true }) as unknown;
  assert.throws(() => decodeSubscription(inherited), SyntxAccountDecodeError);
  assert.equal(calls, 0);
});
