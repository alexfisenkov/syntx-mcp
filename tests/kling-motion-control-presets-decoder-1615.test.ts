import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/adapter/syntx/kling-motion-control-presets-decoder.js", import.meta.url).href;
const moduleValue = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;

function decode(raw: unknown): Record<string, unknown> {
  assert.ok(moduleValue, "MISSING_KLING_MOTION_CONTROL_PRESETS_DECODER_MODULE");
  const decoder = moduleValue.decodeKlingMotionControlPresets as ((value: unknown) => Record<string, unknown>) | undefined;
  assert.equal(typeof decoder, "function", "MISSING_KLING_MOTION_CONTROL_PRESETS_DECODER");
  return decoder!(raw);
}

const audio = "https://r2.syntx.ai/motions/audio.mp4";
const noaudio = "https://r2.syntx.ai/motions/noaudio.mp4";

test("decodes actual response.data array variants as video references and freezes values", () => {
  const result = decode([
    { name: "Orbit · 旋转", audio, noaudio, preview: "https://r2.syntx.ai/motions/preview.mp4", top: "video" },
    { name: "Quiet", noaudio }
  ]);
  assert.equal(result.source_shape, "SOURCE_OBSERVED_RESPONSE_SHAPE_ONLY");
  const entries = result.entries as Array<Record<string, unknown>>;
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.availability), [{ audio: true, noaudio: true }, { audio: false, noaudio: true }]);
  assert.equal(entries[0]?.audio_url, audio);
  assert.equal(entries[0]?.preview_url, "https://r2.syntx.ai/motions/preview.mp4");
  assert.equal("duration" in (entries[0] ?? {}), false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(entries), true);
  assert.equal(Object.isFrozen(entries[0]), true);
  assert.equal(JSON.stringify(result).includes("top"), false);
});

test("rejects wrappers, sparse and non-plain records and never invokes accessors or proxies", () => {
  assert.throws(() => decode({ data: [{ name: "wrapped", audio }] }), /INVALID_KLING_MOTION_CONTROL_PRESETS_RESPONSE/u);
  const sparse = new Array(1);
  assert.throws(() => decode(sparse), /INVALID_KLING_MOTION_CONTROL_PRESETS_RESPONSE/u);
  assert.throws(() => decode([Object.create({ name: "inherited" })]), /INVALID_KLING_MOTION_CONTROL_PRESETS_RESPONSE/u);
  let invoked = false;
  const accessor = Object.defineProperty({ audio }, "name", { get() { invoked = true; return "unsafe"; }, enumerable: true });
  assert.throws(() => decode([accessor]), /INVALID_KLING_MOTION_CONTROL_PRESETS_RESPONSE/u);
  assert.equal(invoked, false);
  const proxy = new Proxy({ name: "proxy", audio }, { get() { invoked = true; throw new Error("trap"); } });
  assert.throws(() => decode([proxy]), /INVALID_KLING_MOTION_CONTROL_PRESETS_RESPONSE/u);
  assert.equal(invoked, false);
  const cyclic: Record<string, unknown> = { name: "cycle", audio };
  cyclic.extra = cyclic;
  assert.throws(() => decode([cyclic]), /INVALID_KLING_MOTION_CONTROL_PRESETS_RESPONSE/u);
});

test("drops unsafe or malformed optional URLs, rejects invalid required names, and never trusts duration", () => {
  const result = decode([
    { name: "Safe variant", audio: "http://127.0.0.1/a.mp4", noaudio, preview: "https://user:pass@r2.syntx.ai/p.mp4", duration: 9 },
    { name: "Bad only", audio: "https://example.com/a.mp4" }
  ]);
  const entries = result.entries as Array<Record<string, unknown>>;
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.audio_url, undefined);
  assert.equal(entries[0]?.noaudio_url, noaudio);
  assert.equal(entries[0]?.preview_url, undefined);
  assert.equal("duration" in (entries[0] ?? {}), false);
  assert.ok((result.gaps as Array<{ index: number; code: string }>).some((gap) => gap.index === 0 && gap.code === "VARIANT_URL_UNSAFE"));
  assert.ok((result.gaps as Array<{ index: number; code: string }>).some((gap) => gap.index === 1 && gap.code === "NO_SAFE_VARIANT"));
  assert.throws(() => decode([{ name: "\n", audio }]), /INVALID_KLING_MOTION_CONTROL_PRESETS_RESPONSE/u);
});

test("enforces record cap without truncation and reports value-free unknown-field gaps", () => {
  const records = Array.from({ length: 256 }, (_, index) => ({ name: `Preset ${index}`, noaudio, extra_sensitive: "not returned" }));
  const result = decode(records);
  assert.equal((result.entries as unknown[]).length, 256);
  assert.ok((result.gaps as Array<{ index: number; code: string }>).every((gap) => gap.code === "UNKNOWN_ENTRY_FIELD"));
  assert.equal(JSON.stringify(result).includes("not returned"), false);
  assert.throws(() => decode([...records, { name: "overflow", noaudio }]), /INVALID_KLING_MOTION_CONTROL_PRESETS_RESPONSE/u);
});
