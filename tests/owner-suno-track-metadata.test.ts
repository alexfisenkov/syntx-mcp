import assert from "node:assert/strict";
import test from "node:test";
import { readOwnerSunoTrackMetadata } from "../src/application/owner-suno-track-metadata.js";

function payload(overrides: Record<string, unknown> = {}) {
  return { clip_id: "synthetic-clip-id", task_id: "synthetic-task-id", ...overrides };
}

test("reader projects only the two observed identifier fields and freezes the result", () => {
  let unknownGetterReads = 0;
  const input = payload({
    extra_one: "synthetic-inert-value",
    extra_two: { nested: "synthetic-inert-value" },
    extra_three: undefined
  });
  Object.defineProperty(input, "extra_getter", {
    enumerable: true,
    get() { unknownGetterReads += 1; return "synthetic-inert-value"; }
  });

  const result = readOwnerSunoTrackMetadata(input);
  assert.deepEqual(result, { clip_id: "synthetic-clip-id", task_id: "synthetic-task-id" });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(unknownGetterReads, 0);
  assert.deepEqual(Object.keys(result!), ["clip_id", "task_id"]);
});

test("reader accepts bounded printable values without claiming a provider ID grammar", () => {
  const result = readOwnerSunoTrackMetadata(payload({
    clip_id: "x".repeat(256),
    task_id: "synthetic:task_id.v1"
  }));
  assert.equal(result?.clip_id.length, 256);
  assert.equal(result?.task_id, "synthetic:task_id.v1");
});

test("reader returns null for missing, empty, whitespace-padded, or oversized identifiers", () => {
  const invalid = [
    { task_id: "synthetic-task-id" },
    { clip_id: "", task_id: "synthetic-task-id" },
    { clip_id: " synthetic-clip-id", task_id: "synthetic-task-id" },
    { clip_id: "synthetic-clip-id", task_id: "x".repeat(257) }
  ];
  for (const value of invalid) assert.equal(readOwnerSunoTrackMetadata(value), null);
});

test("reader rejects control characters and malformed Unicode", () => {
  for (const value of ["synthetic\nclip", "synthetic\u2028clip", "bad\ud800"]) {
    assert.equal(readOwnerSunoTrackMetadata(payload({ clip_id: value })), null);
  }
});

test("reader rejects accessors on the two projected fields without invoking them", () => {
  let reads = 0;
  const input = payload();
  Object.defineProperty(input, "clip_id", {
    enumerable: true,
    get() { reads += 1; return "synthetic-clip-id"; }
  });
  assert.equal(readOwnerSunoTrackMetadata(input), null);
  assert.equal(reads, 0);
});

test("reader accepts inert extra own keys but does not copy prototype-magic data", () => {
  const input = Object.assign(Object.create(null) as Record<string, unknown>, payload());
  Object.defineProperty(input, "__proto__", { value: "synthetic-inert-value", enumerable: true });
  assert.deepEqual(readOwnerSunoTrackMetadata(input), {
    clip_id: "synthetic-clip-id",
    task_id: "synthetic-task-id"
  });
});

test("reader rejects custom prototypes, arrays, and proxies", () => {
  const customPrototype = Object.assign(Object.create({ inherited: true }) as Record<string, unknown>, payload());
  const proxied = new Proxy(payload(), {});
  for (const value of [customPrototype, [], proxied, null, "synthetic-payload"]) {
    assert.equal(readOwnerSunoTrackMetadata(value), null);
  }
});
