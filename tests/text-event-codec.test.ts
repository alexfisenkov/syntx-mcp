import assert from "node:assert/strict";
import test from "node:test";
import { createTextEventCodec } from "../src/adapter/syntx/text-event-codec.js";

test("frames fragmented UTF-8 text and CRLF data lines", () => {
  const codec = createTextEventCodec();
  const bytes = new TextEncoder().encode("data: {\"type\":\"content\",\"content\":\"Привет 🌍\"}\r\n");
  for (const byte of bytes) codec.feed(Uint8Array.of(byte));
  codec.end();
  assert.equal(codec.snapshot().text, "Привет 🌍");
  assert.equal(codec.snapshot().terminal, "unknown");
});

test("ignores valid JSON values and unsupported event types without exposing fields", () => {
  const codec = createTextEventCodec();
  codec.feed(new TextEncoder().encode([
    "data: null\n",
    "data: {\"type\":\"reasoning\",\"content\":\"hidden\",\"secret\":\"private\"}\n",
    "data: {\"type\":\"image_added\",\"image_url\":\"https://private.invalid/image\"}\n"
  ].join("")));
  const snapshot = codec.snapshot();
  assert.equal(snapshot.text, "");
  assert.equal(snapshot.terminal, "open");
  assert.equal(JSON.stringify(snapshot).includes("private.invalid"), false);
  assert.equal(JSON.stringify(snapshot).includes("hidden"), false);
});

test("normalizes choices delta, deduplicates UUIDs, and completes only on stop", () => {
  const codec = createTextEventCodec();
  codec.feed(new TextEncoder().encode([
    'data: {"choices":[{"delta":{"type":"content","content":"A","message_uuid":"m1"}}]}\n',
    'data: {"type":"chunk","content":"duplicate","message_uuid":"m1"}\n',
    'data: {"type":"content","choices":[{"delta":{"content":"B"},"finish_reason":"length"}]}\n',
    'data: {"choices":[{"delta":{"content":"C"},"finish_reason":"stop"}]}\n',
    'data: {"type":"complete","content":"must not append"}\n'
  ].join("")));
  const snapshot = codec.snapshot();
  assert.equal(snapshot.text, "AB");
  assert.equal(snapshot.terminal, "complete");
  assert.equal(snapshot.eventCount, 4);
});

test("distinguishes DONE, incomplete EOF, cancellation, and generic upstream error", () => {
  const done = createTextEventCodec();
  done.feed(new TextEncoder().encode("data: [DONE]\n"));
  done.feed(new TextEncoder().encode('data: {"type":"complete"}\n'));
  done.end();
  assert.equal(done.snapshot().terminal, "done");

  const eof = createTextEventCodec();
  eof.feed(new TextEncoder().encode([
    'data: {"type":"content","content":"partial"}\n',
    'data: {"type":"complete"}'
  ].join("")));
  eof.end();
  assert.equal(eof.snapshot().terminal, "unknown");
  assert.equal(eof.snapshot().text, "partial");

  const actualComplete = createTextEventCodec();
  actualComplete.feed(new TextEncoder().encode('data: {"type":"complete"}\n'));
  actualComplete.end();
  assert.equal(actualComplete.snapshot().terminal, "complete");

  for (const [type, expected, failureCode] of [
    ["cancelled", "cancelled", null],
    ["error", "error", "UPSTREAM_ERROR"]
  ] as const) {
    const codec = createTextEventCodec();
    codec.feed(new TextEncoder().encode(`data: {"type":"${type}","message":"secret"}\n`));
    codec.feed(new TextEncoder().encode("data: [DONE]\n"));
    codec.feed(new TextEncoder().encode('data: {"type":"complete"}\n'));
    codec.end();
    const snapshot = codec.snapshot();
    assert.equal(snapshot.terminal, expected);
    assert.equal(snapshot.failureCode, failureCode);
    assert.equal(JSON.stringify(snapshot).includes("secret"), false);
  }
});

test("fails closed on malformed independent data lines and invalid UTF-8", () => {
  const malformed = createTextEventCodec();
  malformed.feed(new TextEncoder().encode([
    'data: {"type":"content",\n',
    'data: "content":"secret"}\n'
  ].join("")));
  assert.equal(malformed.snapshot().terminal, "error");
  assert.equal(malformed.snapshot().failureCode, "INVALID_EVENT");
  assert.equal(JSON.stringify(malformed.snapshot()).includes("secret"), false);

  const invalidUtf8 = createTextEventCodec();
  invalidUtf8.feed(Uint8Array.of(0xff));
  invalidUtf8.feed(new TextEncoder().encode('data: {"type":"complete"}\n'));
  invalidUtf8.end();
  assert.equal(invalidUtf8.snapshot().terminal, "error");
  assert.equal(invalidUtf8.snapshot().failureCode, "INVALID_UTF8");

  for (const nested of [
    `${'{"value":'.repeat(34)}0${"}".repeat(34)}`,
    '{"type":"content","__proto__":{"polluted":true}}'
  ]) {
    const unsafe = createTextEventCodec();
    unsafe.feed(new TextEncoder().encode(`data: ${nested}\n`));
    assert.equal(unsafe.snapshot().failureCode, "INVALID_EVENT");
    assert.equal(JSON.stringify(unsafe.snapshot()).includes("polluted"), false);
  }
});

test("enforces frame, total byte, text, and event bounds", () => {
  const oversizedFrame = createTextEventCodec();
  oversizedFrame.feed(new TextEncoder().encode(`data: {"type":"content","content":"${"x".repeat(64 * 1024)}"}\n`));
  assert.equal(oversizedFrame.snapshot().failureCode, "RESOURCE_LIMIT");

  const oversizedStream = createTextEventCodec();
  oversizedStream.feed(new Uint8Array(2 * 1024 * 1024 + 1));
  assert.equal(oversizedStream.snapshot().failureCode, "RESOURCE_LIMIT");

  const oversizedSuffix = createTextEventCodec();
  oversizedSuffix.feed(new TextEncoder().encode(`data: ${"x".repeat(64 * 1024)}`));
  oversizedSuffix.end();
  assert.equal(oversizedSuffix.snapshot().failureCode, "RESOURCE_LIMIT");

  const oversizedText = createTextEventCodec();
  const piece = "x".repeat(60_000);
  for (let index = 0; index < 18; index += 1) {
    oversizedText.feed(new TextEncoder().encode(`data: {"type":"content","content":"${piece}"}\n`));
    if (oversizedText.snapshot().terminal === "error") break;
  }
  assert.equal(oversizedText.snapshot().failureCode, "RESOURCE_LIMIT");
  assert.ok(new TextEncoder().encode(oversizedText.snapshot().text).byteLength <= 1024 * 1024);

  const tooManyEvents = createTextEventCodec();
  tooManyEvents.feed(new TextEncoder().encode("data: {}\n".repeat(4097)));
  assert.equal(tooManyEvents.snapshot().failureCode, "RESOURCE_LIMIT");
});
