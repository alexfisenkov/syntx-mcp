import assert from "node:assert/strict";
import test from "node:test";
import { isCanonicalBase64 } from "../src/application/canonical-base64.js";

test("checks large canonical Base64 in linear time within the explicit byte-derived bound", () => {
  const fourMiBImageBase64 = "A".repeat(5_261_296);
  assert.equal(isCanonicalBase64(fourMiBImageBase64, Math.ceil((32 * 1024 * 1024) / 3) * 4), true);
  assert.equal(isCanonicalBase64(fourMiBImageBase64, 5_261_292), false);
});

test("rejects malformed padding and nonzero unused trailing bits", () => {
  for (const value of ["A===", "AA=A", "AA==A", "AB==", "AAB=", "AA==\n", "AA-_", "AAA"]) {
    assert.equal(isCanonicalBase64(value, 64), false, value);
  }
  for (const value of ["AAAA", "AA==", "AAA="]) assert.equal(isCanonicalBase64(value, 64), true, value);
});
