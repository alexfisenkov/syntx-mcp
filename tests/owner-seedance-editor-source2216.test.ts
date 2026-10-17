import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerSeedanceEditorSourceProfile,
  normalizeOwnerSeedanceEditorParameters
} from "../src/application/owner-seedance-editor-parameters.js";
import { buildOwnerSeedanceEditorWire } from "../src/application/owner-seedance-editor-wire.js";

const SOURCE = Object.freeze({
  url: "https://r2.syntx.ai/seedance-editor/source.mp4",
  sha256: "a".repeat(64),
  duration_seconds: 4.25
});

function input(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    model_id: "seedance-2.5-editor",
    prompt: "Retain the subject and continue the movement.",
    resolution: "720p",
    ...overrides
  };
}

function withCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof Error && (error as Error & { code?: unknown }).code === code;
}

test("normalizes explicit Editor choices while keeping source defaults and execution authority separate", () => {
  const profile = getOwnerSeedanceEditorSourceProfile();
  assert.equal(profile.form_id, "seedance-editor");
  assert.equal(profile.scope, "tool_video_inpaint");
  assert.equal(profile.model_id, "seedance-2.5-editor");
  assert.equal(profile.model_type, "seedance-2.5");
  assert.equal(profile.ai_name, "seedance");
  assert.deepEqual(profile.form_initializer, {
    model_type: "seedance-2.5", mode: "edit", aspect_ratio: "adaptive",
    resolution: "720p", video_duration: 0, generate_audio: false
  });
  assert.deepEqual(profile.resolution_values, ["480p", "720p", "1080p"]);
  assert.deepEqual(profile.input_video_duration, { minimum_seconds: 4, maximum_seconds: "UNKNOWN" });
  assert.equal(profile.effective_defaults, "UNKNOWN");
  assert.equal(profile.cost_projection, "UNKNOWN");
  assert.equal(profile.dispatch_allowed, false);
  assert.equal(profile.runtime_usable, false);
  assert.equal(profile.backend_acceptance, "UNPROVEN");

  const normalized = normalizeOwnerSeedanceEditorParameters(input({ resolution: "1080p" }));
  assert.deepEqual(normalized.intent, {
    model_id: "seedance-2.5-editor",
    prompt: "Retain the subject and continue the movement.",
    resolution: "1080p"
  });
  assert.equal(normalized.dispatch_allowed, false);
  assert.equal(Object.isFrozen(normalized), true);
});

test("rejects unsupported Editor selections and malformed request records", () => {
  for (const resolution of ["360p", "1080P", "adaptive", undefined]) {
    assert.throws(() => normalizeOwnerSeedanceEditorParameters(input({ resolution })), withCode("INVALID_PARAMETERS"));
  }
  assert.throws(() => normalizeOwnerSeedanceEditorParameters(input({ model_id: "seedance-2.5" })), withCode("INVALID_PARAMETERS"));
  assert.throws(() => normalizeOwnerSeedanceEditorParameters(input({ prompt: "  " })), withCode("INVALID_PARAMETERS"));
  assert.throws(() => normalizeOwnerSeedanceEditorParameters(input({ prompt: "x".repeat(5_001) })), withCode("INVALID_PARAMETERS"));
  assert.throws(() => normalizeOwnerSeedanceEditorParameters(input({ file_urls: [] })), withCode("INVALID_PARAMETERS"));
  assert.throws(() => normalizeOwnerSeedanceEditorParameters(new Proxy(input(), {})), withCode("INVALID_PARAMETERS"));
  const accessor = input();
  Object.defineProperty(accessor, "prompt", { enumerable: true, get: () => "must not run" });
  assert.throws(() => normalizeOwnerSeedanceEditorParameters(accessor), withCode("INVALID_PARAMETERS"));
});

test("builds a source-only exact no-frame-reference wire from one captured video", () => {
  const candidate = buildOwnerSeedanceEditorWire(input(), SOURCE);
  assert.equal(candidate.model_id, "seedance-2.5-editor");
  assert.deepEqual(candidate.wire, {
    ai_name: "seedance",
    prompt: "Retain the subject and continue the movement.",
    settings: {
      n: 1,
      model_type: "seedance-2.5",
      mode: "edit",
      aspect_ratio: "adaptive",
      resolution: "720p",
      video_duration: 0,
      generate_audio: false,
      file_urls: [{ type: "video", url: SOURCE.url }]
    }
  });
  assert.deepEqual(candidate.source_input_duration_context, {
    seconds: 4.25,
    authority: "CAPTURED_SOURCE_METADATA_NOT_PROVIDER_RECEIPT"
  });
  assert.equal(candidate.cost_projection, "UNKNOWN");
  assert.equal(candidate.dispatch_allowed, false);
  assert.equal(candidate.backend_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(Object.isFrozen(candidate.wire), true);
  assert.equal(Object.isFrozen((candidate.wire as { settings: { file_urls: unknown[] } }).settings.file_urls), true);
  assert.equal(JSON.stringify(candidate).includes(SOURCE.sha256), false);
  assert.equal("reference_handle" in candidate, false);
  assert.match(String(candidate.intent_fingerprint), /^sha256:[a-f0-9]{64}$/u);
  assert.match(String(candidate.wire_fingerprint), /^sha256:[a-f0-9]{64}$/u);
});

test("rejects an unsafe source URL, invalid digest, or a clip shorter than the source minimum", () => {
  for (const source of [
    { ...SOURCE, url: "https://example.invalid/source.mp4" },
    { ...SOURCE, sha256: "not-a-digest" },
    { ...SOURCE, duration_seconds: 3.99 },
    { ...SOURCE, duration_seconds: Number.POSITIVE_INFINITY }
  ]) {
    assert.throws(() => buildOwnerSeedanceEditorWire(input(), source), withCode("INVALID_WIRE_CANDIDATE"));
  }
});
