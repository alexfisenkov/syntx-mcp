import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseOwnerVideo2AudioUploadEnvelope } from "../src/application/owner-video2audio-upload-diagnostic.js";

test("diagnoses the currently expected envelope without turning diagnostics into an admitted receipt", () => {
  const result = diagnoseOwnerVideo2AudioUploadEnvelope({ total: 1, successful: 1, failed: 0, duplicates: 0,
    files: [{ status: "success", content_type: "video/mp4", size: 562_903, duration: 5.64,
      filename: "private-name.mp4", url: "https://r2.syntx.ai/private/path", hash: "private-hash", uuid: "private-id" }] }, 200);
  assert.equal(result.http_status_class, "HTTP_2XX");
  assert.deepEqual(result.outer_keys, ["files", "total", "successful", "failed", "duplicates"]);
  assert.deepEqual(result.counters, {
    total: { kind: "INTEGER", value: 1 }, successful: { kind: "INTEGER", value: 1 },
    failed: { kind: "INTEGER", value: 0 }, duplicates: { kind: "INTEGER", value: 0 }
  });
  assert.equal(result.files.status_counts.success, 1);
  assert.deepEqual(result.files.samples[0], {
    keys: ["filename", "url", "status", "content_type", "size", "duration"], status: "success",
    content_type: "video/mp4", mime_type: "MISSING", size: { kind: "INTEGER", value: 562_903 },
    duration_source: "DURATION_NUMBER", url: "URL_STRING_PRESENT"
  });
  assert.equal(JSON.stringify(result).includes("private-name"), false);
  assert.equal(JSON.stringify(result).includes("r2.syntx.ai"), false);
  assert.equal(JSON.stringify(result).includes("private-hash"), false);
  assert.equal(JSON.stringify(result).includes("private-id"), false);
  assert.equal("video_original_handle" in result, false);
});

test("distinguishes failed, duplicate, and malformed file status shapes while omitting arbitrary keys", () => {
  const result = diagnoseOwnerVideo2AudioUploadEnvelope({ total: "1", successful: 0, failed: 1, duplicates: 0,
    files: [{ status: "error", mime_type: "text/private", content_type: "application/json", size: -1, duration: "private" },
      { status: "duplicate", url: 42 }, { url: "https://secret.invalid/p" }, { status: "secret-status", secret_key: "never-return" }] }, 422);
  assert.equal(result.http_status_class, "HTTP_4XX");
  assert.equal(result.counters.total.kind, "OTHER");
  assert.deepEqual(result.files.status_counts, { success: 0, error: 1, duplicate: 1, other: 1, missing: 1 });
  assert.equal(result.files.samples[0]?.content_type, "OTHER");
  assert.equal(result.files.samples[0]?.mime_type, "OTHER");
  assert.equal(result.files.samples[0]?.size.kind, "OTHER");
  assert.equal(result.files.samples[0]?.duration_source, "DURATION_OTHER");
  const serialized = JSON.stringify(result);
  for (const value of ["text/private", "application/json", "secret-status", "secret_key", "never-return", "secret.invalid"]) {
    assert.equal(serialized.includes(value), false);
  }
});

test("bounds counts and samples and makes absent response evidence explicit", () => {
  const missing = diagnoseOwnerVideo2AudioUploadEnvelope(undefined);
  assert.equal(missing.body_kind, "UNSUPPORTED");
  assert.equal(missing.http_status_class, "NOT_CAPTURED");
  assert.equal(missing.files.kind, "MISSING");
  assert.equal(missing.counters.total.kind, "MISSING");

  const oversized = diagnoseOwnerVideo2AudioUploadEnvelope({ total: 1_000_001, files: Array.from({ length: 7 }, () => ({})) }, 503);
  assert.equal(oversized.http_status_class, "HTTP_5XX");
  assert.equal(oversized.counters.total.value, 10_000);
  assert.equal(oversized.files.count, 7);
  assert.equal(oversized.files.samples.length, 3);
  assert.equal(oversized.files.status_counts.missing, 7);
});

test("reports HTTP classes, body kinds, and duration-field provenance only", () => {
  assert.equal(diagnoseOwnerVideo2AudioUploadEnvelope([], 302).http_status_class, "HTTP_3XX");
  assert.equal(diagnoseOwnerVideo2AudioUploadEnvelope("private body", 418).body_kind, "STRING");
  assert.equal(diagnoseOwnerVideo2AudioUploadEnvelope({ files: [{ duration: null }] }, 204).files.samples[0]?.duration_source,
    "DURATION_OTHER");
  assert.equal(diagnoseOwnerVideo2AudioUploadEnvelope({ files: [{ duration: 5.64 }] }, 204).files.samples[0]?.duration_source,
    "DURATION_NUMBER");
});

test("does not execute accessors or inspect proxy-backed diagnostic inputs", () => {
  let getterCalls = 0, proxyCalls = 0;
  const accessor = Object.defineProperty({}, "files", { enumerable: true, get() { getterCalls += 1; return []; } });
  const proxy = new Proxy({}, { getPrototypeOf() { proxyCalls += 1; throw new Error("must not inspect proxy"); } });
  assert.equal(diagnoseOwnerVideo2AudioUploadEnvelope(accessor).files.kind, "OTHER");
  assert.equal(diagnoseOwnerVideo2AudioUploadEnvelope(proxy).body_kind, "UNSUPPORTED");
  assert.equal(getterCalls, 0);
  assert.equal(proxyCalls, 0);
});

test("does not invoke array index accessors or an overridden slice method", () => {
  let getterCalls = 0, methodCalls = 0;
  const files: unknown[] = [];
  Object.defineProperty(files, "0", { enumerable: true, get() { getterCalls++; throw new Error("must not read getter"); } });
  Object.defineProperty(files, "slice", { value() { methodCalls++; throw new Error("must not call overridden method"); } });
  const result = diagnoseOwnerVideo2AudioUploadEnvelope({ files }, 200);
  assert.equal(result.files.count, 1);
  assert.equal(result.files.samples[0]?.status, "missing");
  assert.equal(getterCalls, 0);
  assert.equal(methodCalls, 0);
});
