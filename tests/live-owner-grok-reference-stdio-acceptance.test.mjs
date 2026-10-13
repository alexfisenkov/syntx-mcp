import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import test from "node:test";

const scriptPath = resolve("scripts/live-owner-grok-reference-stdio-acceptance.mjs");
const CASES = ["grok-i2i-one-1k-batch1", "grok-pro-one-1k-batch2", "grok-i2i-new-2k-batch1", "grok-i2i-prism-2k-batch1", "grok-i2i-sundial-1k-batch1", "grok-i2i-origami-2k-batch1"];
const PROMPTS = {
  [CASES[0]]: "Use the synthetic color reference as a loose guide for a small amber glass lantern on a mint-green table. One image, no text.",
  [CASES[1]]: "Use the synthetic color reference as a loose guide for a violet ceramic vase with one gold ring against a soft ivory studio wall. Return two images, no text.",
  [CASES[2]]: "Use the geometric reference loosely to create a small cobalt-blue stair-step sculpture on a rust-orange pedestal against a pale yellow wall. One image, no lettering.",
  [CASES[3]]: "Create a small iridescent triangular prism paperweight casting a blue-violet split shadow on a charcoal desk. Restrained studio still life, no text.",
  [CASES[4]]: "Create a small abstract orange sundial sculpture on a teal desk, with a clean geometric shadow. Restrained studio still life, no people or text.",
  [CASES[5]]: "Create a folded white origami paper plane resting diagonally on a violet desk, with crisp geometric edge shadows. Minimal studio still life, no people or text."
};
const EXPECTED_SET_SHA = "sha256:0c03ca4e7a2cc82fed71cc4d32b28d1efc0799ca5b48cda2eb85958228cf7cec";
const SAFE_UNKNOWN_DIAGNOSTIC = Object.freeze({
  phase: "POST_CALL_STARTED", echo_ack_known: false, history_get_eligible: false,
  history_get_performed: false, history_get_count: 0, history_get_count_capped: false,
  history_match: "NOT_RUN", result_get_performed: false, result_get_count: 0,
  result_get_count_capped: false, result_binding_known: false, upstream_error_code: "UPSTREAM_TIMEOUT"
});
let modulePromise;
let loadedModule;
const load = () => modulePromise ??= import(pathToFileURL(scriptPath).href).then((module) => { loadedModule = module; return module; });

test("CLI refuses before creating client unless exact fixed-case confirmation is supplied", () => {
  const child = spawnSync(process.execPath, [scriptPath], { cwd: process.cwd(), encoding: "utf8", timeout: 5_000,
    env: { PATH: process.env.PATH ?? "" } });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 2);
  assert.equal(child.stdout, "");
  assert.match(child.stderr, /Refusing Grok reference stdio operation/u);
});

test("only fixed owner cases parse; no caller-selected model, prompt, or settings", async () => {
  const module = await load();
  const prefix = ["--confirm-owner-grok-reference-stdio-acceptance", "--real", "--case"];
  for (const caseId of CASES) assert.ok(module.parseOwnerGrokReferenceStdioAcceptanceArgs([...prefix, caseId]));
  assert.equal(module.parseOwnerGrokReferenceStdioAcceptanceArgs([
    "--confirm-owner-grok-reference-access-diagnostic", "--real", "--case", module.OWNER_GROK_ACCESS_DIAGNOSTIC_CASE_ID
  ])?.mode, "READONLY_GROK_ACCESS_DIAGNOSTIC");
  for (const invalid of [[], ["--real", ...prefix.slice(1), CASES[0]], [...prefix, "other"],
    [...prefix, CASES[0], "--prompt", "arbitrary"], [...prefix, CASES[1], "--batch", "5"],
    [prefix[0], "--mock", prefix[2], CASES[0]],
    ["--confirm-owner-grok-reference-access-diagnostic", "--real", "--case", CASES[0]],
    ["--confirm-owner-grok-reference-access-diagnostic", "--real", "--case", "anything"]]) {
    assert.equal(module.parseOwnerGrokReferenceStdioAcceptanceArgs(invalid), null);
  }
});

test("safe unknown diagnostic parser admits only closed enums, bounded counts, and data fields", async () => {
  const module = await load();
  assert.deepEqual(module.parseOwnerGrokReferenceUnknownDiagnostic(SAFE_UNKNOWN_DIAGNOSTIC), SAFE_UNKNOWN_DIAGNOSTIC);
  for (const invalid of [
    { ...SAFE_UNKNOWN_DIAGNOSTIC, upstream_error_code: "RAW_PROVIDER_MESSAGE" },
    { ...SAFE_UNKNOWN_DIAGNOSTIC, history_get_count: 256 },
    { ...SAFE_UNKNOWN_DIAGNOSTIC, attempt_id: "link_private" },
    { ...SAFE_UNKNOWN_DIAGNOSTIC, phase: "RAW_SERVER_REPLY" }
  ]) assert.equal(module.parseOwnerGrokReferenceUnknownDiagnostic(invalid), null);
  const getter = { ...SAFE_UNKNOWN_DIAGNOSTIC };
  Object.defineProperty(getter, "echo_ack_known", { enumerable: true, get() { throw new Error("must not run"); } });
  assert.equal(module.parseOwnerGrokReferenceUnknownDiagnostic(getter), null);
});

test("origami 2k Grok case is fixed, source-bound, and pixel-distinct from every prior case", async () => {
  const module = await load();
  const caseId = "grok-i2i-origami-2k-batch1";
  const descriptor = module.OWNER_GROK_REFERENCE_CASES[caseId];
  assert.ok(descriptor, "the origami purpose must be in the fixed-case allowlist");
  assert.deepEqual({ case_id: descriptor.case_id, profile_id: descriptor.profile_id, schema_hash: descriptor.schema_hash,
    model_id: descriptor.model_id, reference_count: descriptor.reference_count, resolution: descriptor.resolution,
    batch_size: descriptor.batch_size, filename: descriptor.filename, prompt: descriptor.prompt }, {
    case_id: caseId, profile_id: "grok-i2i-reference-one-source-reviewed",
    schema_hash: "sha256:5e646fc7b23c8d52858065e2088168fc64f1dccde6d90e4b0afb9334ef47199e",
    model_id: "grok_i2i", reference_count: 1, resolution: "2k", batch_size: 1,
    filename: "owner-grok-reference-stdio-291-origami-2k.png", prompt: PROMPTS[caseId]
  });
  assert.equal(module.parseOwnerGrokReferenceStdioAcceptanceArgs([
    "--confirm-owner-grok-reference-stdio-acceptance", "--real", "--case", caseId, "--prompt", "injected"
  ]), null);
  const fixture = module.createOwnerGrokReferenceFixture(caseId);
  assert.deepEqual([fixture.width, fixture.height, fixture.mimeType], [512, 512, "image/png"]);
  for (const priorCaseId of CASES.slice(0, -1)) {
    const prior = module.OWNER_GROK_REFERENCE_CASES[priorCaseId];
    assert.notEqual(fixture.pixel_sha256, module.createOwnerGrokReferenceFixture(priorCaseId).pixel_sha256);
    assert.notEqual(descriptor.filename, prior.filename);
    assert.notEqual(descriptor.prompt, prior.prompt);
  }
  assert.equal(fixture.runtime_node_version, process.versions.node);
});

test("unknown recovery IPC includes the latest closed diagnostic without private values", async () => {
  const module = await load();
  const h = fakeHarness("grok-i2i-prism-2k-batch1", { unknownGeneration: true, finishRecovery: true });
  const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, "grok-i2i-prism-2k-batch1"), h.io, h.dependencies);
  assert.equal(result.status, "GENERATION_OUTCOME_UNKNOWN");
  const event = h.privateEvents.find((item) => item.event === "OUTCOME_UNKNOWN");
  assert.deepEqual(event.unknown_diagnostic, SAFE_UNKNOWN_DIAGNOSTIC);
  assert.deepEqual(Object.keys(event.unknown_diagnostic).sort(), Object.keys(SAFE_UNKNOWN_DIAGNOSTIC).sort());
  assert.equal(Object.values(event.unknown_diagnostic).every((value) =>
    value === null || ["string", "boolean", "number"].includes(typeof value)), true);
  const diagnosticText = JSON.stringify(event.unknown_diagnostic);
  for (const privateValue of [h.attemptId, h.referenceHandle, h.recoveryId, h.privateUrl, PROMPTS["grok-i2i-prism-2k-batch1"]]) {
    assert.equal(diagnosticText.includes(privateValue), false);
  }
});

test("origami unknown private IPC retains the safe diagnostic and one-shot bounds", async () => {
  const module = await load();
  const caseId = "grok-i2i-origami-2k-batch1";
  const h = fakeHarness(caseId, { unknownGeneration: true, finishRecovery: true });
  const expectedMetadata = module.buildOwnerGrokReferenceSafeIntentMetadata({ caseId,
    fixture: module.createOwnerGrokReferenceFixture(caseId), source: h.dependencies.loadGrokReferenceSource(),
    harnessSha256: `sha256:${createHash("sha256").update(readFileSync(scriptPath)).digest("hex")}` });
  const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, caseId), h.io, h.dependencies);
  assert.equal(result.status, "GENERATION_OUTCOME_UNKNOWN");
  assert.equal(result.requested_resolution, "2k");
  assert.equal(result.requested_batch_size, 1);
  assert.equal(result.upload_call_count, 1);
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.recovery_call_count, 0);
  assert.equal(result.retry_count, 0);
  const intent = h.privateEvents.find((item) => item.event === "UPLOAD_INTENT");
  assert.equal(intent.intent_fingerprint, expectedMetadata.actionFingerprint);
  const generation = h.toolArguments.find((entry) => entry.name === "syntx_owner_generate_grok_reference").arguments;
  assert.deepEqual(Object.keys(generation.parameters).sort(), ["batch_size", "prompt", "resolution"]);
  assert.deepEqual({ resolution: generation.parameters.resolution, batch_size: generation.parameters.batch_size,
    prompt: generation.parameters.prompt }, { resolution: "2k", batch_size: 1, prompt: PROMPTS[caseId] });
  const unknown = h.privateEvents.find((item) => item.event === "OUTCOME_UNKNOWN");
  assert.deepEqual(unknown.unknown_diagnostic, SAFE_UNKNOWN_DIAGNOSTIC);
  const diagnosticText = JSON.stringify(unknown.unknown_diagnostic);
  for (const privateValue of [h.attemptId, h.referenceHandle, h.recoveryId, h.privateUrl, PROMPTS[caseId]]) {
    assert.equal(diagnosticText.includes(privateValue), false);
  }
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(result.client_close_status, "CLOSED");
});

test("new 2k Grok I2I case is fixed and has input pixels distinct from both earlier I2I fixtures", async () => {
  const module = await load();
  const caseId = "grok-i2i-new-2k-batch1";
  const config = configFor(module, caseId);
  assert.ok(config, "the new purpose must be an explicitly fixed case");
  const descriptor = module.OWNER_GROK_REFERENCE_CASES[caseId];
  assert.deepEqual({ case_id: descriptor.case_id, profile_id: descriptor.profile_id, model_id: descriptor.model_id,
    resolution: descriptor.resolution, batch_size: descriptor.batch_size, filename: descriptor.filename }, {
    case_id: caseId, profile_id: "grok-i2i-reference-one-source-reviewed", model_id: "grok_i2i",
    resolution: "2k", batch_size: 1, filename: "owner-grok-reference-stdio-248-i2i-2k.png"
  });
  assert.equal(module.parseOwnerGrokReferenceStdioAcceptanceArgs([
    "--confirm-owner-grok-reference-stdio-acceptance", "--real", "--case", caseId, "--prompt", "injected"
  ]), null);
  const fixture = module.createOwnerGrokReferenceFixture(caseId);
  assert.deepEqual([fixture.width, fixture.height, fixture.mimeType], [512, 512, "image/png"]);
  assert.equal(fixture.pixel_sha256, "sha256:1020c7f671cc9380c1e883a044a81aa608198fb7e6f6ac5d8a4c064bb90ffc26");
  assert.notEqual(fixture.pixel_sha256, "sha256:ef2f748d070adc4c768d03daf11d3cb862737d4cd0bb7ee592ded91046f7f5f0");
  assert.notEqual(fixture.pixel_sha256, "sha256:239c42755a7854831c8c550bd3b99126722c317e414f6dd8458c19a1300023df");
  assert.equal(fixture.runtime_node_version, process.versions.node);
});

test("prism 2k Grok case is closed, exact, and pixel-distinct from every earlier source case", async () => {
  const module = await load();
  const caseId = "grok-i2i-prism-2k-batch1";
  const config = configFor(module, caseId);
  assert.ok(config, "the new prism purpose must be fixed in the live-case allowlist");
  const descriptor = module.OWNER_GROK_REFERENCE_CASES[caseId];
  assert.deepEqual({ profile_id: descriptor.profile_id, model_id: descriptor.model_id, schema_hash: descriptor.schema_hash,
    reference_count: descriptor.reference_count, resolution: descriptor.resolution, batch_size: descriptor.batch_size,
    filename: descriptor.filename }, {
    profile_id: "grok-i2i-reference-one-source-reviewed", model_id: "grok_i2i",
    schema_hash: "sha256:5e646fc7b23c8d52858065e2088168fc64f1dccde6d90e4b0afb9334ef47199e",
    reference_count: 1, resolution: "2k", batch_size: 1, filename: "owner-grok-reference-stdio-262-prism-2k.png"
  });
  assert.equal(module.parseOwnerGrokReferenceStdioAcceptanceArgs([
    "--confirm-owner-grok-reference-stdio-acceptance", "--real", "--case", caseId, "--prompt", "caller override"
  ]), null);
  const fixture = module.createOwnerGrokReferenceFixture(caseId);
  assert.deepEqual([fixture.width, fixture.height, fixture.mimeType], [512, 512, "image/png"]);
  for (const previousCaseId of CASES.slice(0, 3)) {
    assert.notEqual(fixture.pixel_sha256, module.createOwnerGrokReferenceFixture(previousCaseId).pixel_sha256);
    assert.notEqual(descriptor.prompt, module.OWNER_GROK_REFERENCE_CASES[previousCaseId].prompt);
    assert.notEqual(descriptor.filename, module.OWNER_GROK_REFERENCE_CASES[previousCaseId].filename);
  }
  assert.equal(fixture.runtime_node_version, process.versions.node);
});

test("sundial 1k Grok I2I case is fixed, pixel-distinct, and retains safe no-echo diagnostics", async () => {
  const module = await load();
  const caseId = "grok-i2i-sundial-1k-batch1";
  const descriptor = module.OWNER_GROK_REFERENCE_CASES[caseId];
  assert.ok(descriptor, "the new 1k purpose must be in the closed case allowlist");
  assert.deepEqual({ case_id: descriptor.case_id, profile_id: descriptor.profile_id, schema_hash: descriptor.schema_hash,
    model_id: descriptor.model_id, reference_count: descriptor.reference_count, resolution: descriptor.resolution,
    batch_size: descriptor.batch_size, filename: descriptor.filename, prompt: descriptor.prompt }, {
    case_id: caseId, profile_id: "grok-i2i-reference-one-source-reviewed",
    schema_hash: "sha256:5e646fc7b23c8d52858065e2088168fc64f1dccde6d90e4b0afb9334ef47199e",
    model_id: "grok_i2i", reference_count: 1, resolution: "1k", batch_size: 1,
    filename: "owner-grok-reference-stdio-279-sundial-1k.png",
    prompt: PROMPTS[caseId]
  });
  assert.deepEqual(module.parseOwnerGrokReferenceStdioAcceptanceArgs([
    "--confirm-owner-grok-reference-stdio-acceptance", "--real", "--case", caseId
  ])?.caseId, caseId);
  assert.equal(module.parseOwnerGrokReferenceStdioAcceptanceArgs([
    "--confirm-owner-grok-reference-stdio-acceptance", "--real", "--case", caseId, "--prompt", "injected"
  ]), null);

  const fixture = module.createOwnerGrokReferenceFixture(caseId);
  assert.deepEqual([fixture.width, fixture.height, fixture.mimeType], [512, 512, "image/png"]);
  for (const previousCase of CASES.filter((candidate) => candidate !== caseId)) {
    assert.notEqual(fixture.pixel_sha256, module.createOwnerGrokReferenceFixture(previousCase).pixel_sha256);
    assert.notEqual(descriptor.filename, module.OWNER_GROK_REFERENCE_CASES[previousCase].filename);
    assert.notEqual(descriptor.prompt, module.OWNER_GROK_REFERENCE_CASES[previousCase].prompt);
  }

  const syntheticNoEcho = fakeHarness(caseId, { unknownGeneration: true, finishRecovery: true });
  const expectedMetadata = module.buildOwnerGrokReferenceSafeIntentMetadata({ caseId, fixture,
    source: syntheticNoEcho.dependencies.loadGrokReferenceSource(),
    harnessSha256: `sha256:${createHash("sha256").update(readFileSync(scriptPath)).digest("hex")}` });
  const held = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, caseId), syntheticNoEcho.io, syntheticNoEcho.dependencies);
  assert.equal(held.status, "GENERATION_OUTCOME_UNKNOWN");
  assert.equal(held.requested_resolution, "1k");
  assert.equal(held.requested_batch_size, 1);
  assert.equal(held.upload_call_count, 1);
  assert.equal(held.generation_call_count, 1);
  assert.equal(held.recovery_call_count, 0);
  assert.equal(held.retry_count, 0);
  assert.deepEqual(held.unknown_diagnostic, SAFE_UNKNOWN_DIAGNOSTIC);
  assert.equal(held.unknown_diagnostic.phase, "POST_CALL_STARTED");
  assert.equal(held.unknown_diagnostic.echo_ack_known, false);
  assert.equal(held.unknown_diagnostic.history_get_eligible, false);
  assert.equal(held.unknown_diagnostic.history_get_performed, false);
  const uploadIntent = syntheticNoEcho.privateEvents.find((event) => event.event === "UPLOAD_INTENT");
  assert.equal(uploadIntent.intent_fingerprint, expectedMetadata.actionFingerprint);
  assert.equal(uploadIntent.requested_resolution, "1k");
  assert.equal(uploadIntent.requested_batch_size, 1);
  const generate = syntheticNoEcho.toolArguments.find((entry) => entry.name === "syntx_owner_generate_grok_reference").arguments;
  assert.deepEqual(Object.keys(generate.parameters).sort(), ["batch_size", "prompt", "resolution"]);
  assert.deepEqual({ resolution: generate.parameters.resolution, batch_size: generate.parameters.batch_size,
    prompt: generate.parameters.prompt }, { resolution: "1k", batch_size: 1, prompt: PROMPTS[caseId] });
  assert.equal(syntheticNoEcho.toolCalls.includes("syntx_owner_reconcile_grok_reference"), false);
  assert.equal(held.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(held.client_close_status, "CLOSED");
});

test("safe intent metadata helper exactly matches the 262 upload event fingerprint and complete receipt fields", async () => {
  const module = await load();
  const caseId = "grok-i2i-prism-2k-batch1";
  const descriptor = module.OWNER_GROK_REFERENCE_CASES[caseId];
  assert.equal(typeof module.buildOwnerGrokReferenceSafeIntentMetadata, "function");
  const fixture = module.createOwnerGrokReferenceFixture(caseId);
  const source = await module.loadOwnerGrokReferenceSource();
  const harnessSha256 = `sha256:${createHash("sha256").update(readFileSync(scriptPath)).digest("hex")}`;
  const metadata = module.buildOwnerGrokReferenceSafeIntentMetadata({ caseId, fixture, source, harnessSha256 });
  const expectedSafeBase = {
    case_id: caseId, profile_id: descriptor.profile_id, model_id: descriptor.model_id,
    profile_version: module.OWNER_GROK_REFERENCE_PROFILE_VERSION,
    profile_set_sha256: EXPECTED_SET_SHA, schema_hash: descriptor.schema_hash,
    catalog_version: source.catalog_version, source_fingerprint: source.source_fingerprint,
    fixture_sha256: fixture.sha256, fixture_width: 512, fixture_height: 512,
    fixture_pixel_sha256: fixture.pixel_sha256, fixture_byte_size: fixture.bytes.length,
    runtime_node_version: process.versions.node,
    prompt_sha256: `sha256:${createHash("sha256").update(descriptor.prompt).digest("hex")}`,
    harness_sha256: harnessSha256, requested_resolution: "2k", requested_batch_size: 1
  };
  assert.deepEqual(metadata.safeBase, expectedSafeBase);
  const expectedFingerprint = `sha256:${createHash("sha256").update(canonicalJsonForTest({
    ...expectedSafeBase, settings: { resolution: "2k", batch_size: 1 }, reference_count: 1
  })).digest("hex")}`;
  assert.equal(metadata.actionFingerprint, expectedFingerprint);
  assert.throws(() => module.buildOwnerGrokReferenceSafeIntentMetadata({ caseId,
    fixture: { ...fixture, filename: "caller-selected.png" }, source, harnessSha256 }), /SAFE_INTENT_METADATA_INVALID/u);
  assert.throws(() => module.buildOwnerGrokReferenceSafeIntentMetadata({ caseId, fixture, source,
    harnessSha256: "not-a-sha256" }), /SAFE_INTENT_METADATA_INVALID/u);

  const h = fakeHarness(caseId, { source });
  const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, caseId), h.io, h.dependencies);
  assert.equal(result.status, "PASS_FIXED_CASE_RESULT_ONLY");
  assert.equal(result.upload_call_count, 1);
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.retry_count, 0);
  assert.equal(result.actual_result_count, 1);
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(result.client_close_status, "CLOSED");
  const uploadIntent = h.privateEvents.find((event) => event.event === "UPLOAD_INTENT");
  assert.equal(uploadIntent.intent_fingerprint, expectedFingerprint);
  for (const [key, value] of Object.entries(expectedSafeBase)) assert.deepEqual(uploadIntent[key], value);
  assert.equal(result.intent_fingerprint, expectedFingerprint);
  const generation = h.toolArguments.find((entry) => entry.name === "syntx_owner_generate_grok_reference").arguments;
  assert.deepEqual(Object.keys(generation.parameters).sort(), ["batch_size", "prompt", "resolution"]);
  assert.equal(generation.parameters.resolution, "2k");
  assert.equal(generation.parameters.batch_size, 1);
  assert.equal(generation.parameters.prompt, descriptor.prompt);
  assert.equal("aspect_ratio" in generation.parameters, false);
});

test("new 2k I2I case keeps exact ACK-bound one-shot dispatch and GET-only recovery cleanup", async () => {
  const module = await load();
  const caseId = "grok-i2i-new-2k-batch1";
  const success = fakeHarness(caseId);
  const passed = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, caseId), success.io, success.dependencies);
  assert.equal(passed.status, "PASS_FIXED_CASE_RESULT_ONLY");
  assert.equal(passed.model_id, "grok_i2i");
  assert.equal(passed.requested_resolution, "2k");
  assert.equal(passed.requested_batch_size, 1);
  assert.equal(passed.actual_result_count, 1);
  assert.equal(passed.upload_call_count, 1);
  assert.equal(passed.generation_call_count, 1);
  assert.equal(passed.retry_count, 0);
  assert.equal(passed.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(passed.client_close_status, "CLOSED");
  assert.equal(passed.stdout_includes_private_data, false);
  const upload = success.toolArguments.find((entry) => entry.name === "syntx_upload_grok_image_reference").arguments;
  assert.equal(upload.filename, "owner-grok-reference-stdio-248-i2i-2k.png");
  assert.equal(upload.link_attempt_id, success.attemptId);
  assert.deepEqual(Object.keys(upload).sort(), ["content_base64", "filename", "link_attempt_id", "mime_type", "profile_id"]);
  assert.equal(Buffer.from(upload.content_base64, "base64").equals(module.createOwnerGrokReferenceFixture(caseId).bytes), true);
  const generation = success.toolArguments.find((entry) => entry.name === "syntx_owner_generate_grok_reference").arguments;
  assert.equal(generation.link_attempt_id, success.attemptId);
  assert.deepEqual(Object.keys(generation.parameters).sort(), ["batch_size", "prompt", "resolution"]);
  assert.equal(generation.parameters.resolution, "2k");
  assert.equal(generation.parameters.batch_size, 1);
  assert.equal(generation.parameters.prompt, module.OWNER_GROK_REFERENCE_CASES[caseId].prompt);
  assert.equal("aspect_ratio" in generation.parameters, false);
  for (const eventName of ["BEGIN", "UPLOAD_INTENT", "GENERATION_INTENT"]) {
    const event = success.privateEvents.find((item) => item.event === eventName);
    assert.equal(event.attempt_id, success.attemptId);
    assert.equal(event.requested_resolution, "2k");
    assert.match(event.intent_fingerprint, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(success.acknowledgedFingerprints.includes(event.intent_fingerprint), true);
  }

  const unknown = fakeHarness(caseId, { lostGenerationReply: true });
  const held = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, caseId), unknown.io, unknown.dependencies);
  assert.equal(held.status, "PASS_FIXED_CASE_RESULT_ONLY");
  assert.equal(held.upload_call_count, 1);
  assert.equal(held.generation_call_count, 1);
  assert.equal(held.recovery_discovery_call_count, 1);
  assert.equal(held.recovery_call_count, 1);
  assert.equal(held.retry_count, 0);
  assert.equal("unknown_diagnostic" in held, false);
  assert.equal(held.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(held.client_close_status, "CLOSED");
  assert.equal(unknown.toolCalls.filter((name) => name === "syntx_upload_grok_image_reference").length, 1);
  assert.equal(unknown.toolCalls.filter((name) => name === "syntx_owner_generate_grok_reference").length, 1);
  assert.equal(unknown.toolCalls.filter((name) => name === "syntx_owner_reconcile_grok_reference").length, 1);
});

test("new case refuses upload when the private ACK action does not match the fixed upload intent", async () => {
  const module = await load();
  const caseId = "grok-i2i-new-2k-batch1";
  for (const invalidAck of [
    { wrongAckEvent: "UPLOAD_INTENT" },
    { wrongAckAttemptEvent: "UPLOAD_INTENT" },
    { wrongAckFingerprintEvent: "UPLOAD_INTENT" }
  ]) {
    const wrongAck = fakeHarness(caseId, invalidAck);
    const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, caseId), wrongAck.io, wrongAck.dependencies);
    assert.equal(result.status, "UPLOAD_NOT_APPROVED");
    assert.equal(result.upload_call_count, 0);
    assert.equal(result.generation_call_count, 0);
    assert.equal(result.retry_count, 0);
    assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
    assert.equal(result.client_close_status, "CLOSED");
    assert.equal(wrongAck.toolCalls.includes("syntx_upload_grok_image_reference"), false);
    assert.equal(wrongAck.toolCalls.includes("syntx_owner_generate_grok_reference"), false);
  }
});

test("source harness accepts the actual Grok upload receipt emitted by native MCP over synthetic fetch", async () => {
  const module = await load();
  const caseId = "grok-i2i-new-2k-batch1";
  const descriptor = module.OWNER_GROK_REFERENCE_CASES[caseId];
  const [{ loadSelectedDiscoveryCatalog }, { loadOwnerGrokImageReferenceProfileSetV1 }, { OwnerGrokImageReferenceService },
    { registerSyntxOwnerGrokImageReferenceTools }, { SyntxChatHttpClient }] = await Promise.all([
    import("../dist/src/catalog/selected-discovery-catalog.js"),
    import("../dist/src/catalog/owner-grok-image-reference-profile-history.js"),
    import("../dist/src/application/owner-grok-image-reference-service.js"),
    import("../dist/src/mcp/owner-grok-image-reference-tools.js"),
    import("../dist/src/adapter/syntx/chat-http-client.js")
  ]);
  const selected = loadSelectedDiscoveryCatalog();
  const profileSet = loadOwnerGrokImageReferenceProfileSetV1(
    module.OWNER_GROK_REFERENCE_PROFILE_VERSION, selected.discoveryCatalog
  );
  const fixture = module.createOwnerGrokReferenceFixture(caseId);
  const attemptId = "link_fixture_grok_receipt_248_abcdefghijklmnop";
  const binding = Object.freeze({ tenant_id: "synthetic_owner_tenant", subject: "synthetic_owner_subject" });
  let revoked = false;
  const linkService = {
    async getStatus(_binding, id) {
      return { attempt_id: id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
        status: revoked ? "REVOKED" : "LINKED", expires_at: null, linked: !revoked };
    }
  };
  let freshSubscriptionCalls = 0;
  const fetchRequests = [];
  const syntheticFetch = async (input, init) => {
    fetchRequests.push({ url: new URL(input).href, method: init?.method, body: init?.body });
    assert.equal(fetchRequests.at(-1).url, "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init.body;
    assert.equal(form.get("destination"), "hidden");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "grok_i2i");
    assert.equal(Buffer.from(await form.get("files").arrayBuffer()).equals(fixture.bytes), true);
    return new Response(JSON.stringify({ files: [{ url: "https://r2.syntx.ai/synthetic/private-reference.png", file_id: "synthetic_file_id" }] }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  };
  const chatClient = new SyntxChatHttpClient({
    credentialBroker: { async useCredential(operation) { return operation("synthetic-only-credential"); } },
    fetchImpl: syntheticFetch
  });
  const service = new OwnerGrokImageReferenceService({
    profile_set: profileSet,
    binding,
    linkService,
    createChatClient: () => chatClient,
    now: () => 1_800_000_000_000,
    preflight: {
      async verifyFreshSubscription() {
        freshSubscriptionCalls += 1;
        if (freshSubscriptionCalls > 1) throw new Error("synthetic test stops before generation dispatch");
      },
      async verifyModelAccess() {},
      async authorizeCost() {}
    }
  });
  let actualServiceReceipt;
  const servicePort = {
    getSchema: (...args) => service.getSchema(...args),
    validate: (...args) => service.validate(...args),
    async upload(...args) {
      actualServiceReceipt = await service.upload(...args);
      return actualServiceReceipt;
    },
    generate: (...args) => service.generate(...args),
    reconcile: (...args) => service.reconcile(...args),
    listRecoveries: (...args) => service.listRecoveries(...args)
  };
  const server = new McpServer({ name: "grok-upload-receipt-source-test", version: "1.0.0" });
  registerSyntxOwnerGrokImageReferenceTools(server, { service: servicePort });
  const client = new Client({ name: "grok-upload-receipt-source-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  let publicUploadReceipt;
  let publicUploadErrorCode = null;
  const observedToolCalls = [];
  const coreToolNames = ["syntx_begin_login", "syntx_check_login", "syntx_unlink", "syntx_get_account_status"];
  const runnerOnlyToolNames = ["syntx_get_model_access"];
  const observedClient = {
    async listTools(...args) {
      const listed = await client.listTools(...args);
      return { ...listed, tools: [...listed.tools, ...coreToolNames, ...runnerOnlyToolNames].map((item) =>
        typeof item === "string" ? { name: item } : item) };
    },
    async callTool(...args) {
      const request = args[0] ?? {};
      const name = request.name;
      observedToolCalls.push(name ?? "UNKNOWN_TOOL");
      if (["syntx_get_grok_reference_schema", "syntx_validate_grok_reference", "syntx_upload_grok_image_reference"].includes(name)) {
        const response = await client.callTool(...args);
        if (name !== "syntx_upload_grok_image_reference") return response;
        publicUploadReceipt = response.structuredContent;
        try { publicUploadErrorCode = JSON.parse(response.content?.find((item) => item.type === "text")?.text ?? "{}").error?.code ?? null; }
        catch { publicUploadErrorCode = "UNPARSEABLE_SAFE_ERROR"; }
        return response;
      }
      if (name === "syntx_begin_login") return { content: [{ type: "resource_link", uri: "https://t.me/syntxaibot?start=synthetic" }],
        structuredContent: { attempt_id: attemptId } };
      if (name === "syntx_check_login") return { structuredContent: { attempt_id: attemptId,
        status: revoked ? "REVOKED" : "LINKED", linked: !revoked } };
      if (name === "syntx_get_account_status") return { structuredContent: { subscription: { active: true, plan_type: "PAID" } } };
      if (name === "syntx_get_model_access") return { structuredContent: { account_read_live: true, access: true, cost: 1, discount_cost: null } };
      if (name === "syntx_unlink") { revoked = true; return { structuredContent: { status: "REVOKED" } }; }
      if (name === "syntx_owner_generate_grok_reference") return errorResult("TEST_SYNTHETIC_GENERATION_STOPPED");
      throw new Error("UNEXPECTED_SYNTHETIC_TOOL");
    },
    close: () => client.close()
  };
  const actions = { BEGIN: "handoff_sent", UPLOAD_INTENT: "approve_upload", GENERATION_INTENT: "approve_generation" };
  try {
    const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, caseId),
      { stdout: { write() {} } }, {
        isSourceCheckout: () => true,
        loadGrokReferenceSource: () => module.loadOwnerGrokReferenceSource(),
        createOwnerClient: async () => ({ client: observedClient, async waitForExit() { return true; } }),
        sendPrivateIpc: async () => true,
        waitForPrivateAction: async (event, context) => ({ action: actions[event], ...context }),
        sleep: async () => {}, now: () => 1_800_000_000_000
      });
    assert.equal(publicUploadReceipt?.status, "accepted", JSON.stringify({ status: result.status,
      failure_stage: result.failure_stage, failure_code: result.failure_code,
      upload_count: result.upload_call_count, generation_count: result.generation_call_count,
      fetch_count: fetchRequests.length, upload_error_code: publicUploadErrorCode,
      actual_service_receipt: Boolean(actualServiceReceipt), tool_surface_exact: result.tool_surface_exact,
      begin_acknowledged: result.begin_acknowledged, observed_tool_calls: observedToolCalls }));
    assert.match(publicUploadReceipt.reference_handle, /^reference_[0-9a-f-]{36}$/u);
    assert.equal(publicUploadReceipt.mime_type, "image/png");
    assert.equal(publicUploadReceipt.mime_type_source, "request_declared");
    assert.equal(publicUploadReceipt.size, fixture.bytes.length);
    assert.equal(publicUploadReceipt.size_source, "request_bytes");
    assert.equal(publicUploadReceipt.profile_id, descriptor.profile_id);
    assert.equal(publicUploadReceipt.model_id, descriptor.model_id);
    assert.equal(publicUploadReceipt.expires_in_seconds, 900);
    assert.equal(publicUploadReceipt?.image?.sha256, createHash("sha256").update(fixture.bytes).digest("hex"));
    assert.equal(publicUploadReceipt?.image?.byte_length, fixture.bytes.length);
    assert.deepEqual([publicUploadReceipt.image.mime_type, publicUploadReceipt.image.width, publicUploadReceipt.image.height],
      ["image/png", fixture.width, fixture.height]);
    assert.equal(publicUploadReceipt.confidence_scope, "input_bytes_sniffed_and_dimensions_checked");
    assert.equal(result.failure_stage, "GENERATION");
    assert.equal(result.upload_call_count, 1);
    assert.equal(result.generation_call_count, 1);
    assert.equal(result.retry_count, 0);
    assert.equal(fetchRequests.length, 1);
    assert.equal(freshSubscriptionCalls, 1);
    assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
    assert.equal(result.client_close_status, "CLOSED");
  } finally {
    await service.close();
    await server.close();
  }
});

test("each case has distinct fixed 512x512 RGBA pixels; PNG bytes are recorded with the current Node runtime", async () => {
  const module = await load();
  const fixtures = CASES.map((caseId) => module.createOwnerGrokReferenceFixture(caseId));
  assert.deepEqual(fixtures.map(({ width, height }) => [width, height]), CASES.map(() => [512, 512]));
  assert.equal(new Set(fixtures.map(({ pixel_sha256 }) => pixel_sha256)).size, CASES.length);
  assert.equal(new Set(fixtures.map(({ filename }) => filename)).size, CASES.length);
  assert.notEqual(fixtures[0].sha256, fixtures[1].sha256);
  assert.notEqual(fixtures[2].pixel_sha256, fixtures[0].pixel_sha256);
  assert.notEqual(fixtures[2].pixel_sha256, fixtures[1].pixel_sha256);
  assert.notEqual(fixtures[2].filename, fixtures[0].filename);
  assert.notEqual(fixtures[2].filename, fixtures[1].filename);
  assert.notEqual(fixtures[3].pixel_sha256, fixtures[0].pixel_sha256);
  assert.notEqual(fixtures[3].pixel_sha256, fixtures[1].pixel_sha256);
  assert.notEqual(fixtures[3].pixel_sha256, fixtures[2].pixel_sha256);
  assert.notEqual(fixtures[3].filename, fixtures[0].filename);
  assert.notEqual(fixtures[3].filename, fixtures[1].filename);
  assert.notEqual(fixtures[3].filename, fixtures[2].filename);
  assert.equal(fixtures[0].pixel_sha256, "sha256:ef2f748d070adc4c768d03daf11d3cb862737d4cd0bb7ee592ded91046f7f5f0");
  assert.equal(fixtures[1].pixel_sha256, "sha256:239c42755a7854831c8c550bd3b99126722c317e414f6dd8458c19a1300023df");
  assert.equal(fixtures[0].runtime_node_version, process.versions.node);
  assert.equal(fixtures[1].runtime_node_version, process.versions.node);
  assert.equal(fixtures[2].runtime_node_version, process.versions.node);
  assert.equal(fixtures[3].runtime_node_version, process.versions.node);
  assert.equal(fixtures[4].runtime_node_version, process.versions.node);
  assert.equal(fixtures[5].runtime_node_version, process.versions.node);
  assert.notEqual(fixtures[0].filename, fixtures[1].filename);
  assert.notEqual(fixtures[0].sha256, "sha256:4a84ffadf1ba454f11ed10e15a12a637f55cbb81bb8535161ed5d90fceb7bc84");
  assert.notEqual(fixtures[1].sha256, "sha256:4a84ffadf1ba454f11ed10e15a12a637f55cbb81bb8535161ed5d90fceb7bc84");
  assert.notEqual(fixtures[2].sha256, "sha256:4a84ffadf1ba454f11ed10e15a12a637f55cbb81bb8535161ed5d90fceb7bc84");
  assert.notEqual(fixtures[3].sha256, "sha256:4a84ffadf1ba454f11ed10e15a12a637f55cbb81bb8535161ed5d90fceb7bc84");
  assert.equal(module.createOwnerGrokReferenceFixture(CASES[0]).sha256, fixtures[0].sha256);
  assert.equal(module.createOwnerGrokReferenceFixture(CASES[1]).pixel_sha256, fixtures[1].pixel_sha256);
  assert.equal(module.createOwnerGrokReferenceFixture(CASES[2]).pixel_sha256, fixtures[2].pixel_sha256);
  assert.equal(module.createOwnerGrokReferenceFixture(CASES[3]).pixel_sha256, fixtures[3].pixel_sha256);
  assert.equal(module.OWNER_GROK_REFERENCE_CASES[CASES[0]].prompt, PROMPTS[CASES[0]]);
  assert.equal(module.OWNER_GROK_REFERENCE_CASES[CASES[1]].prompt, PROMPTS[CASES[1]]);
  assert.equal(module.OWNER_GROK_REFERENCE_CASES[CASES[2]].prompt, PROMPTS[CASES[2]]);
  assert.equal(module.OWNER_GROK_REFERENCE_CASES[CASES[3]].prompt, PROMPTS[CASES[3]]);
  assert.equal(module.OWNER_GROK_REFERENCE_CASES[CASES[4]].prompt, PROMPTS[CASES[4]]);
  assert.equal(module.OWNER_GROK_REFERENCE_CASES[CASES[5]].prompt, PROMPTS[CASES[5]]);
  assert.ok(fixtures.every((fixture) => fixture.bytes.length > 0 && fixture.bytes.length < 7 * 1024 * 1024));
});

test("schema/source pin mismatch stops before account, upload, generation, or client mutation", async () => {
  const module = await load();
  const config = configFor(module, CASES[0]);
  const h = fakeHarness(CASES[0], { sourceMismatch: true });
  const result = await module.runOwnerGrokReferenceStdioAcceptance(config, h.io, h.dependencies);
  assert.equal(result.status, "PROFILE_SOURCE_PIN_MISMATCH");
  assert.equal(h.events.includes("client_open"), false);
  assert.equal(h.toolCalls.length, 0);
});

test("schema readback mismatch stops before BEGIN or any upload/generation", async () => {
  const module = await load();
  const h = fakeHarness(CASES[0], { schemaMismatch: true });
  const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, CASES[0]), h.io, h.dependencies);
  assert.equal(result.status, "PROFILE_SCHEMA_READBACK_MISMATCH");
  assert.ok(h.events.indexOf("schema") >= 0);
  assert.equal(h.events.includes("begin_login"), false);
  assert.equal(h.toolCalls.includes("syntx_upload_grok_image_reference"), false);
  assert.equal(h.toolCalls.includes("syntx_owner_generate_grok_reference"), false);
});

test("fixed I2I case validates source-bound schema before one upload/one post and cleans up", async () => {
  const module = await load();
  const h = fakeHarness(CASES[0]);
  const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, CASES[0]), h.io, h.dependencies);
  assert.equal(result.status, "PASS_FIXED_CASE_RESULT_ONLY");
  assert.equal(result.profile_id, module.OWNER_GROK_REFERENCE_CASES[CASES[0]].profile_id);
  assert.equal(result.model_id, "grok_i2i");
  assert.equal(result.requested_batch_size, 1);
  assert.equal(result.actual_result_count, 1);
  assert.equal(result.mime_confidence, "URL_EXTENSION_ONLY");
  assert.match(result.request_fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.match(result.intent_fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.match(result.begin_intent_fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.match(result.harness_sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.harness_sha256, `sha256:${createHash("sha256").update(readFileSync(scriptPath)).digest("hex")}`);
  assert.equal(result.upload_call_count, 1);
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.retry_count, 0);
  assert.equal(result.artifact_observation_count, 1);
  assert.deepEqual(h.observedArtifactLengths, [1]);
  assert.equal(result.artifacts[0].width, 777); // observed dimensions; no inferred exact 1k output size
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(result.client_close_status, "CLOSED");
  assert.equal(result.stdout_includes_private_data, false);
  const readOnlyEnd = Math.max(h.events.indexOf("schema"), h.events.indexOf("validate"));
  assert.ok(readOnlyEnd < h.events.indexOf("begin_login"));
  assert.equal(h.toolCalls.filter((name) => name === "syntx_upload_grok_image_reference").length, 1);
  assert.equal(h.toolCalls.filter((name) => name === "syntx_owner_generate_grok_reference").length, 1);
  const beginWait = h.events.indexOf("wait:BEGIN"), beginEmit = h.events.indexOf("emit:BEGIN");
  assert.ok(beginWait >= 0 && beginWait < beginEmit);
  const uploadArgs = h.toolArguments.find((entry) => entry.name === "syntx_upload_grok_image_reference").arguments;
  assert.equal(uploadArgs.link_attempt_id, h.attemptId);
  assert.equal("attemptId" in uploadArgs, false);
  assert.equal(uploadArgs.filename, "owner-grok-reference-stdio-229-i2i.png");
  const generationArgs = h.toolArguments.find((entry) => entry.name === "syntx_owner_generate_grok_reference").arguments;
  assert.equal(generationArgs.link_attempt_id, h.attemptId);
  assert.equal("attemptId" in generationArgs, false);
  assert.deepEqual(Object.keys(generationArgs.parameters).sort(), ["batch_size", "prompt", "resolution"]);
  assert.equal(generationArgs.parameters.resolution, "1k");
  assert.equal(generationArgs.parameters.batch_size, 1);
  assert.equal("aspect_ratio" in generationArgs.parameters, false);
  const beginEvent = h.privateEvents.find((event) => event.event === "BEGIN");
  const uploadEvent = h.privateEvents.find((event) => event.event === "UPLOAD_INTENT");
  const generationEvent = h.privateEvents.find((event) => event.event === "GENERATION_INTENT");
  assert.equal(beginEvent.intent_fingerprint, result.begin_intent_fingerprint);
  assert.equal(uploadEvent.intent_fingerprint, result.intent_fingerprint);
  assert.equal(generationEvent.intent_fingerprint, result.intent_fingerprint);
  assert.equal(h.acknowledgedFingerprints.includes(uploadEvent.intent_fingerprint), true);
  assert.equal(h.acknowledgedFingerprints.includes(generationEvent.intent_fingerprint), true);
  assert.equal(h.acknowledgedFingerprints.includes(beginEvent.intent_fingerprint), true);
  assert.equal(JSON.stringify(result).includes(h.attemptId), false);
  assert.equal(JSON.stringify(result).includes(h.referenceHandle), false);
  assert.equal(JSON.stringify(result).includes(h.privateUrl), false);
  assert.ok(h.events.indexOf("client_close") < h.events.indexOf("child_exit"));
});

test("fixed Pro case captures both returned artifacts and observes them one at a time", async () => {
  const module = await load();
  const h = fakeHarness(CASES[1]);
  const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, CASES[1]), h.io, h.dependencies);
  assert.equal(result.status, "PASS_FIXED_CASE_RESULT_ONLY");
  assert.equal(result.model_id, "grok_i2i_pro");
  assert.equal(result.requested_batch_size, 2);
  assert.equal(result.actual_result_count, 2);
  assert.match(result.request_fingerprint, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.artifact_observation_count, 2);
  assert.deepEqual(h.observedArtifactLengths, [1, 1]);
  assert.deepEqual(result.artifacts.map((item) => item.mime), ["image/png", "image/jpeg"]);
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.retry_count, 0);
  const generation = h.toolArguments.find((entry) => entry.name === "syntx_owner_generate_grok_reference").arguments;
  assert.equal(generation.link_attempt_id, h.attemptId);
  assert.equal(generation.profile_id, module.OWNER_GROK_REFERENCE_CASES[CASES[1]].profile_id);
  assert.equal(generation.parameters.batch_size, 2);
  assert.equal(generation.parameters.resolution, "1k");
  assert.equal("aspect_ratio" in generation.parameters, false);
});

test("source/request fingerprint drift and artifact MIME or dimensions mismatch cannot pass", async () => {
  const module = await load();
  for (const resultOverrides of [
    { profile_schema_hash: "sha256:wrong" },
    { profile_set_sha256: "sha256:wrong" },
    { request_fingerprint: "not-a-sha256" }
  ]) {
    const h = fakeHarness(CASES[0], { resultOverrides });
    const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, CASES[0]), h.io, h.dependencies);
    assert.equal(result.status, "GENERATION_RESULT_MISMATCH");
    assert.equal(result.artifact_observation_count, 0);
    assert.equal(result.request_fingerprint, null);
  }
  for (const observationFailure of ["mime", "zero_dimension"]) {
    const h = fakeHarness(CASES[0], { observationFailure });
    const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, CASES[0]), h.io, h.dependencies);
    assert.equal(result.status, "ARTIFACT_OBSERVATION_MISMATCH");
    assert.equal(result.actual_result_count, 1);
    assert.equal(result.artifact_observation_count, 1);
  }
});

test("unknown generation uses a returned recovery id without discovery and never repeats upload or generation", async () => {
  const module = await load();
  const h = fakeHarness(CASES[0], { unknownGeneration: true });
  const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, CASES[0]), h.io, h.dependencies);
  assert.equal(result.status, "PASS_FIXED_CASE_RESULT_ONLY");
  assert.equal(result.generation_call_count, 1);
  assert.equal("unknown_diagnostic" in result, false);
  assert.equal(result.recovery_discovery_call_count, 0);
  assert.equal(result.recovery_call_count, 1);
  assert.equal(result.retry_count, 0);
  assert.equal(h.toolCalls.filter((name) => name === "syntx_owner_generate_grok_reference").length, 1);
  assert.equal(h.toolCalls.filter((name) => name === "syntx_owner_reconcile_grok_reference").length, 1);
});

test("unresolved unknown summary preserves only the safe diagnostic when operator finishes", async () => {
  const module = await load();
  const caseId = "grok-i2i-prism-2k-batch1";
  const h = fakeHarness(caseId, { unknownGeneration: true, finishRecovery: true });
  const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, caseId), h.io, h.dependencies);
  assert.equal(result.status, "GENERATION_OUTCOME_UNKNOWN");
  assert.deepEqual(result.unknown_diagnostic, SAFE_UNKNOWN_DIAGNOSTIC);
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.recovery_call_count, 0);
  assert.equal(result.retry_count, 0);
  const text = JSON.stringify(result.unknown_diagnostic);
  assert.equal(text.includes(h.attemptId), false);
  assert.equal(text.includes(h.referenceHandle), false);
  assert.equal(text.includes(h.privateUrl), false);
});

test("lost generation reply permits only one unique fixed-profile list match, then GET-only reconcile", async () => {
  const module = await load();
  const unique = fakeHarness(CASES[1], { lostGenerationReply: true });
  const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, CASES[1]), unique.io, unique.dependencies);
  assert.equal(result.status, "PASS_FIXED_CASE_RESULT_ONLY");
  assert.equal(result.generation_call_count, 1);
  assert.equal(result.recovery_discovery_call_count, 1);
  assert.equal(result.recovery_call_count, 1);
  assert.equal(result.retry_count, 0);
  assert.equal(unique.toolCalls.filter((name) => name === "syntx_owner_generate_grok_reference").length, 1);
  assert.equal(unique.toolCalls.filter((name) => name === "syntx_owner_reconcile_grok_reference").length, 1);

  const ambiguous = fakeHarness(CASES[1], { lostGenerationReply: true, ambiguousRecovery: true });
  const held = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, CASES[1]), ambiguous.io, ambiguous.dependencies);
  assert.equal(held.status, "GENERATION_OUTCOME_UNKNOWN_UNRECOVERABLE");
  assert.equal(held.generation_call_count, 1);
  assert.equal(held.recovery_discovery_call_count, 1);
  assert.equal(held.recovery_call_count, 0);
  assert.equal(held.retry_count, 0);
  assert.equal(ambiguous.toolCalls.filter((name) => name === "syntx_owner_reconcile_grok_reference").length, 0);
  assert.equal(ambiguous.toolCalls.filter((name) => name === "syntx_owner_generate_grok_reference").length, 1);
});

test("waiter registration precedes BEGIN IPC; failed BEGIN acknowledgment causes no mutation and still closes", async () => {
  const module = await load();
  const h = fakeHarness(CASES[0], { noBeginAck: true });
  const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, CASES[0]), h.io, h.dependencies);
  assert.equal(result.status, "BEGIN_NOT_CONFIRMED");
  assert.equal(result.upload_call_count, 0);
  assert.equal(result.generation_call_count, 0);
  assert.equal(result.client_close_status, "CLOSED");
  assert.ok(h.events.indexOf("wait:BEGIN") < h.events.indexOf("emit:BEGIN"));
  assert.equal(h.toolCalls.includes("syntx_upload_grok_image_reference"), false);
  assert.equal(h.toolCalls.includes("syntx_owner_generate_grok_reference"), false);
});

test("failed cleanup is visible and never upgrades a result to clean PASS", async () => {
  const module = await load();
  const h = fakeHarness(CASES[0], { unlinkFailure: true });
  const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, CASES[0]), h.io, h.dependencies);
  assert.equal(result.status, "PASS_CLEANUP_UNCONFIRMED");
  assert.equal(result.local_unlink_status, "UNCONFIRMED");
  assert.equal(result.client_close_status, "CLOSED");
  assert.equal(result.generation_call_count, 1);
});

test("upload MCP failures preserve only the safe code/stage and never imply no provider effect", async () => {
  const module = await load();
  const h = fakeHarness(CASES[0], { uploadErrorCode: "REFERENCE_UPLOAD_OUTCOME_UNKNOWN" });
  const result = await module.runOwnerGrokReferenceStdioAcceptance(configFor(module, CASES[0]), h.io, h.dependencies);
  assert.equal(result.status, "UPLOAD_OUTCOME_UNKNOWN");
  assert.equal(result.failure_stage, "UPLOAD");
  assert.equal(result.failure_code, "REFERENCE_UPLOAD_OUTCOME_UNKNOWN");
  assert.equal(result.upload_call_count, 1);
  assert.equal(result.generation_call_count, 0);
  assert.equal(JSON.stringify(result).includes(h.privateUrl), false);
});

test("read-only diagnostic reads active subscription and model access for both exact Grok bindings", async () => {
  const module = await load();
  const h = fakeHarness(CASES[0]);
  const config = module.parseOwnerGrokReferenceStdioAcceptanceArgs([
    "--confirm-owner-grok-reference-access-diagnostic", "--real", "--case", module.OWNER_GROK_ACCESS_DIAGNOSTIC_CASE_ID
  ]);
  const result = await module.runOwnerGrokReferenceStdioAcceptance(config, h.io, h.dependencies);
  assert.equal(result.status, "PASS_READONLY_ACCESS_DIAGNOSTIC");
  assert.deepEqual(result.models.map((entry) => entry.model_id), ["grok_i2i", "grok_i2i", "grok_i2i_pro", "grok_i2i_pro"]);
  assert.deepEqual(result.models.map((entry) => entry.cost_parameters_mode), ["EMPTY", "EXPLICIT_BATCH", "EMPTY", "EXPLICIT_BATCH"]);
  assert.deepEqual(result.models.map((entry) => entry.allowed), [true, true, true, true]);
  assert.ok(result.models.every((entry) => entry.known_nonnull_cost === true && entry.unit_present === false &&
    entry.cost_status === "NONNULL_UNIT_UNSPECIFIED_NOT_REPORTED"));
  assert.deepEqual(result.read_counts, { schema: 2, validate: 2, account: 1, model_access: 4, upload: 0, generate: 0, create_chat: 0 });
  assert.deepEqual(result.mutation_calls, { upload: 0, generation: 0, create_chat: 0 });
  const accessCalls = h.toolArguments.filter((entry) => entry.name === "syntx_get_model_access");
  assert.deepEqual(accessCalls.map((entry) => entry.arguments.cost_parameters), [{}, { batch_size: 1 }, {}, { batch_size: 2 }]);
  assert.ok(accessCalls.every((entry) => entry.arguments.link_attempt_id === h.attemptId));
  assert.equal(JSON.stringify(result).includes("\"cost\":9"), false);
  assert.equal(h.toolCalls.some((name) => ["syntx_upload_grok_image_reference", "syntx_owner_generate_grok_reference"].includes(name)), false);
  assert.equal(JSON.stringify(result).includes("private-owner-account"), false);
  assert.equal(JSON.stringify(result).includes("987654"), false);
  assert.equal(result.local_unlink_status, "REVOKED_READBACK_CONFIRMED");
  assert.equal(result.client_close_status, "CLOSED");
});

test("read-only diagnostic reports binding mismatch and denied access without any mutation", async () => {
  const module = await load();
  const config = module.parseOwnerGrokReferenceStdioAcceptanceArgs([
    "--confirm-owner-grok-reference-access-diagnostic", "--real", "--case", module.OWNER_GROK_ACCESS_DIAGNOSTIC_CASE_ID
  ]);
  const mismatch = fakeHarness(CASES[0], { modelAccessBindingMismatch: true });
  const mismatchResult = await module.runOwnerGrokReferenceStdioAcceptance(config, mismatch.io, mismatch.dependencies);
  assert.equal(mismatchResult.status, "MODEL_ACCESS_READ_FAILED");
  assert.ok(mismatchResult.models.some((entry) => entry.status === "MODEL_BINDING_MISMATCH"));
  assert.equal(mismatch.toolCalls.some((name) => name === "syntx_owner_generate_grok_reference"), false);
  const denied = fakeHarness(CASES[0], { modelAccessDenied: true });
  const deniedResult = await module.runOwnerGrokReferenceStdioAcceptance(config, denied.io, denied.dependencies);
  assert.equal(deniedResult.status, "PASS_READONLY_ACCESS_DIAGNOSTIC");
  assert.deepEqual(deniedResult.models.map((entry) => entry.allowed), [false, false, false, false]);
  assert.equal(deniedResult.mutation_calls.upload + deniedResult.mutation_calls.generation + deniedResult.mutation_calls.create_chat, 0);
});

function configFor(module, caseId) {
  return module.parseOwnerGrokReferenceStdioAcceptanceArgs([
    "--confirm-owner-grok-reference-stdio-acceptance", "--real", "--case", caseId
  ]);
}

function fakeHarness(caseId, options = {}) {
  const moduleCase = {
    "grok-i2i-one-1k-batch1": { profile_id: "grok-i2i-reference-one-source-reviewed", schema_hash: "sha256:5e646fc7b23c8d52858065e2088168fc64f1dccde6d90e4b0afb9334ef47199e", model_id: "grok_i2i", batch_size: 1 },
    "grok-pro-one-1k-batch2": { profile_id: "grok-i2i-pro-reference-one-source-reviewed", schema_hash: "sha256:1e272333d2b7de276a433409a0e32a96fb984fb372495dabc4f08d5b788a7c5f", model_id: "grok_i2i_pro", batch_size: 2 },
    "grok-i2i-new-2k-batch1": { profile_id: "grok-i2i-reference-one-source-reviewed", schema_hash: "sha256:5e646fc7b23c8d52858065e2088168fc64f1dccde6d90e4b0afb9334ef47199e", model_id: "grok_i2i", batch_size: 1 },
    "grok-i2i-prism-2k-batch1": { profile_id: "grok-i2i-reference-one-source-reviewed", schema_hash: "sha256:5e646fc7b23c8d52858065e2088168fc64f1dccde6d90e4b0afb9334ef47199e", model_id: "grok_i2i", batch_size: 1 },
    "grok-i2i-sundial-1k-batch1": { profile_id: "grok-i2i-reference-one-source-reviewed", schema_hash: "sha256:5e646fc7b23c8d52858065e2088168fc64f1dccde6d90e4b0afb9334ef47199e", model_id: "grok_i2i", batch_size: 1 },
    "grok-i2i-origami-2k-batch1": { profile_id: "grok-i2i-reference-one-source-reviewed", schema_hash: "sha256:5e646fc7b23c8d52858065e2088168fc64f1dccde6d90e4b0afb9334ef47199e", model_id: "grok_i2i", batch_size: 1 }
  }[caseId];
  const events = [], toolCalls = [], toolArguments = [], privateEvents = [], observedArtifactLengths = [], acknowledgedFingerprints = [];
  const actionWaiters = new Map();
  const attemptId = "link_fake_grok_stdio_attempt_000000000001";
  const referenceHandle = "reference_00000000-0000-4000-8000-000000000229";
  const recoveryId = "recovery_00000000-0000-4000-8000-000000000229";
  const privateUrl = "https://r2.syntx.ai/private-result-229.png";
  const names = ["syntx_begin_login", "syntx_check_login", "syntx_unlink", "syntx_get_account_status", "syntx_get_model_access",
    "syntx_get_grok_reference_schema", "syntx_validate_grok_reference", "syntx_upload_grok_image_reference",
    "syntx_owner_generate_grok_reference", "syntx_owner_reconcile_grok_reference", "syntx_owner_list_grok_reference_recovery"];
  let revoked = false;
  const client = {
    async listTools() { events.push("list_tools"); return { tools: names.map((name) => ({ name })) }; },
    async callTool(request) {
      const name = request.name, args = request.arguments ?? {};
      toolCalls.push(name); toolArguments.push({ name, arguments: { ...args } });
      if (name === "syntx_get_grok_reference_schema") {
        events.push("schema");
        const result = schemaResult(caseForProfile(args.profile_id));
        if (options.schemaMismatch) result.schema_hash = "sha256:wrong";
        return { structuredContent: result };
      }
      if (name === "syntx_validate_grok_reference") { events.push("validate"); return { structuredContent: validateResult(caseForProfile(args.profile_id), args) }; }
      if (name === "syntx_begin_login") { events.push("begin_login"); return { structuredContent: { attempt_id: attemptId }, content: [{ type: "resource_link", uri: "https://t.me/syntxaibot?start=auth_229" }] }; }
      if (name === "syntx_check_login") return { structuredContent: { attempt_id: attemptId, status: revoked ? "REVOKED" : "LINKED", linked: !revoked } };
      if (name === "syntx_get_account_status") return { structuredContent: { account_id: "private-owner-account", balance: { available: "987654" }, subscription: { active: true, plan_type: "PAID" } } };
      if (name === "syntx_get_model_access") {
        const expectedBatch = args.model_id === "grok_i2i" ? 1 : 2;
        assert.ok(JSON.stringify(args.cost_parameters) === "{}" || JSON.stringify(args.cost_parameters) === JSON.stringify({ batch_size: expectedBatch }));
        const expectedKeys = Object.keys(args.cost_parameters).sort();
        if (options.modelAccessBindingMismatch && args.model_id === "grok_i2i_pro") {
          return { structuredContent: { account_read_live: true, model_id: args.model_id, model_type: "banana-2.1", ai_name: "grok_image",
          catalog_version: "2026-10-08T13:18:39.393Z.36e6960df354", parameter_keys: expectedKeys, parameters_redacted: true, access: true, cost: 9, discount_cost: 7 } };
        }
        return { structuredContent: { account_read_live: true, model_id: args.model_id, model_type: args.model_id, ai_name: "grok_image",
          catalog_version: "2026-10-08T13:18:39.393Z.36e6960df354", parameter_keys: expectedKeys, parameters_redacted: true,
          access: options.modelAccessDenied ? false : true, cost: 9, discount_cost: 7, free_remaining_generations: null,
          limit: null, show_warning: null, observed_at: "2026-10-10T00:00:00.000Z" } };
      }
      if (name === "syntx_upload_grok_image_reference") {
        if (options.uploadErrorCode) return errorResult(options.uploadErrorCode);
        assert.equal(args.link_attempt_id, attemptId);
        assert.equal("attemptId" in args, false);
        if (options.uploadUnknown) return errorResult("REFERENCE_UPLOAD_OUTCOME_UNKNOWN");
        const fixture = loadedModule.createOwnerGrokReferenceFixture(caseId);
        return { structuredContent: { status: "accepted", reference_handle: referenceHandle, profile_id: moduleCase.profile_id,
          model_id: moduleCase.model_id, mime_type: "image/png", mime_type_source: "request_declared", size: fixture.bytes.length,
          size_source: "request_bytes", expires_in_seconds: 900,
          image: { mime_type: "image/png", width: 512, height: 512,
            sha256: fixture.sha256.slice("sha256:".length), byte_length: fixture.bytes.length },
          confidence_scope: "input_bytes_sniffed_and_dimensions_checked" } };
      }
      if (name === "syntx_owner_generate_grok_reference") {
        assert.equal(args.link_attempt_id, attemptId);
        assert.equal("attemptId" in args, false);
        if (options.lostGenerationReply) throw new Error("transport closed");
        if (options.unknownGeneration) return errorResult("OUTCOME_UNKNOWN", recoveryId, SAFE_UNKNOWN_DIAGNOSTIC);
        return { structuredContent: resultResult(moduleCase, caseId, privateUrl, options.resultOverrides) };
      }
      if (name === "syntx_owner_list_grok_reference_recovery") {
        assert.equal(args.link_attempt_id, attemptId);
        assert.equal("attemptId" in args, false);
        const record = { recovery_id: recoveryId, profile_id: moduleCase.profile_id, model_id: moduleCase.model_id,
          created_at: "2026-10-09T00:00:00.000Z", requested_batch_size: moduleCase.batch_size,
          diagnostic: SAFE_UNKNOWN_DIAGNOSTIC };
        return { structuredContent: { recoveries: options.ambiguousRecovery ? [record, { ...record, recovery_id: "recovery_00000000-0000-4000-8000-000000000230" }] : [record] } };
      }
      if (name === "syntx_owner_reconcile_grok_reference") {
        assert.equal(args.link_attempt_id, attemptId);
        assert.equal("attemptId" in args, false);
        assert.equal(args.recovery_id, recoveryId);
        return { structuredContent: resultResult(moduleCase, caseId, privateUrl, options.resultOverrides) };
      }
      if (name === "syntx_unlink") {
        if (options.unlinkFailure) return errorResult("AUTH_LINK_INVALID_STATE");
        revoked = true; return { structuredContent: { status: "REVOKED" } };
      }
      throw new Error("UNEXPECTED_TOOL");
    },
    async close() { events.push("client_close"); }
  };
  const harness = {
    events, toolCalls, toolArguments, privateEvents, observedArtifactLengths, acknowledgedFingerprints, attemptId, referenceHandle, privateUrl,
    io: { stdout: { write(value) { events.push(`stdout:${value}`); } } },
    dependencies: {
      isSourceCheckout: () => true,
      loadGrokReferenceSource: () => {
        const profileSource = options.source ?? source();
        return options.sourceMismatch ? { ...profileSource, profile_set_sha256: "sha256:bad" } : profileSource;
      },
      createOwnerClient: async (childOptions) => {
        assert.equal(childOptions.command, process.execPath);
        assert.deepEqual(childOptions.args, [resolve("dist/src/transports/stdio-owner.js")]);
        assert.deepEqual(childOptions.env, {
          SYNTX_OWNER_GROK_IMAGE_REFERENCES: "1",
          SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION: "sha256-87f53d7f198a6550038a59279948e10b251a4138509bf76c25c791c990d66299.json",
          SYNTX_OWNER_ACCOUNT_STATUS: "1"
        });
        assert.equal("SYNTX_OWNER_IMAGE_REFERENCES" in childOptions.env, false);
        events.push("client_open");
        return { client, async waitForExit() { events.push("child_exit"); return true; } };
      },
      sendPrivateIpc: async (message) => {
        privateEvents.push(message); events.push(`emit:${message.event}`);
        const waiterEvent = message.event === "OUTCOME_UNKNOWN" ? "RECOVERY_ACTION" : message.event;
        const waiter = actionWaiters.get(waiterEvent);
        if (waiter) {
          actionWaiters.delete(waiterEvent);
          if (typeof message.intent_fingerprint === "string") acknowledgedFingerprints.push(message.intent_fingerprint);
          const action = waiterEvent === "BEGIN" ? "handoff_sent" : waiterEvent === "UPLOAD_INTENT" ? "approve_upload" :
            waiterEvent === "GENERATION_INTENT" ? "approve_generation" : "reconcile";
          const resolvedAction = options.finishRecovery === true && waiterEvent === "RECOVERY_ACTION" ? "finish" : options.wrongAckEvent === waiterEvent
            ? (waiterEvent === "UPLOAD_INTENT" ? "approve_generation" : "finish") : action;
          const ackAttemptId = options.wrongAckAttemptEvent === waiterEvent ? `${message.attempt_id}_foreign` : message.attempt_id;
          const ackFingerprint = options.wrongAckFingerprintEvent === waiterEvent
            ? "sha256:" + "d".repeat(64) : message.intent_fingerprint;
          waiter.resolve({ action: resolvedAction, attempt_id: ackAttemptId, recovery_id: message.recovery_id,
            intent_fingerprint: ackFingerprint });
        }
        return true;
      },
      waitForPrivateAction: (event, context) => {
        events.push(`wait:${event}`);
        if (event === "BEGIN" && options.noBeginAck) return null;
        return new Promise((resolveAction) => actionWaiters.set(event, { resolve: resolveAction, context }));
      },
      sleep: async () => undefined,
      now: () => 1_800_000_000_000,
      observeOwnedGrokImageArtifact: async ({ artifacts }) => {
        observedArtifactLengths.push(artifacts.length);
        const index = observedArtifactLengths.length;
        if (options.observationFailure === "mime") return { status: "OBSERVED", mime: "image/jpeg", declared_mime: artifacts[0].mime_type,
          byte_size: 2049, width: 777, height: 513, sha256: `sha256:${String(index).repeat(64)}` };
        if (options.observationFailure === "zero_dimension") return { status: "OBSERVED", mime: artifacts[0].mime_type,
          declared_mime: artifacts[0].mime_type, byte_size: 0, width: 0, height: 513, sha256: `sha256:${String(index).repeat(64)}` };
        return { status: "OBSERVED", mime: index === 1 ? "image/png" : "image/jpeg", declared_mime: artifacts[0].mime_type,
          response_mime_type: index === 1 ? "image/png" : "image/jpeg", byte_size: 2048 + index,
          width: index === 1 ? 777 : 1200, height: index === 1 ? 513 : 800, sha256: `sha256:${String(index).repeat(64)}` };
      }
    }
  };
  return harness;
}

function source() {
  return { version: "sha256-87f53d7f198a6550038a59279948e10b251a4138509bf76c25c791c990d66299.json",
    profile_set_sha256: EXPECTED_SET_SHA, catalog_version: "2026-10-08T13:18:39.393Z.36e6960df354",
    schema_hashes: { "grok-i2i-reference-one-source-reviewed": "sha256:5e646fc7b23c8d52858065e2088168fc64f1dccde6d90e4b0afb9334ef47199e",
      "grok-i2i-pro-reference-one-source-reviewed": "sha256:1e272333d2b7de276a433409a0e32a96fb984fb372495dabc4f08d5b788a7c5f" },
    source_fingerprint: `sha256:${"b".repeat(64)}` };
}
function caseForProfile(profileId) {
  const found = Object.values({
    one: { profile_id: "grok-i2i-reference-one-source-reviewed", schema_hash: "sha256:5e646fc7b23c8d52858065e2088168fc64f1dccde6d90e4b0afb9334ef47199e", model_id: "grok_i2i", batch_size: 1 },
    pro: { profile_id: "grok-i2i-pro-reference-one-source-reviewed", schema_hash: "sha256:1e272333d2b7de276a433409a0e32a96fb984fb372495dabc4f08d5b788a7c5f", model_id: "grok_i2i_pro", batch_size: 2 }
  }).find((item) => item.profile_id === profileId);
  assert.ok(found);
  return found;
}
function schemaResult(item) {
  return { profile_id: item.profile_id, schema_hash: item.schema_hash, profile_set_sha256: EXPECTED_SET_SHA,
    catalog_version: "2026-10-08T13:18:39.393Z.36e6960df354", model_id: item.model_id, variant_id: item.profile_id,
    operation_id: "generate-image", dispatch_allowed: false, backend_acceptance: "unproven",
    prompt: { required: true, min_length: 1, max_length: 5000 }, reference_count: { minimum: 1, maximum: 1 },
    resolution: { required: true, values: ["1k", "2k"] }, batch_size: { required: true, values: [1, 2, 3, 4, 5] },
    aspect_ratio: { required: false, values: [] }, fixed_settings: { n: 1 }, output_policy: { client_mime_allowlist: ["image/jpeg", "image/png"],
      provider_mime_behavior: "unproven", batch_result_count_relation: "unproven", maximum_returned_artifacts: 5 } };
}
function validateResult(item, args) {
  return { profile_id: item.profile_id, schema_hash: item.schema_hash, profile_set_sha256: EXPECTED_SET_SHA,
    catalog_version: "2026-10-08T13:18:39.393Z.36e6960df354", model_id: item.model_id, reference_count: args.reference_count,
    dispatch_allowed: false, backend_acceptance: "unproven", request: { prompt: args.parameters.prompt,
      settings: { n: 1, model_type: item.model_id, resolution: args.parameters.resolution, batch_size: args.parameters.batch_size } } };
}
function resultResult(item, caseId, privateUrl, overrides = {}) {
  return { status: "result_observed", backend_acceptance: "unproven", model_id: item.model_id,
    profile_schema_hash: item.schema_hash, profile_set_sha256: EXPECTED_SET_SHA,
    request_fingerprint: `sha256:${"c".repeat(64)}`,
    profile_id: item.profile_id, variant_id: item.profile_id, requested_batch_size: item.batch_size,
    actual_result_count: item.batch_size, batch_count_matches_requested: true, mime_confidence: "URL_EXTENSION_ONLY",
    artifacts: Array.from({ length: item.batch_size }, (_, index) => ({ url: index === 0 ? privateUrl : `https://r2.syntx.ai/private-result-${index + 2}.jpg`,
      mime_type: index === 0 ? "image/png" : "image/jpeg", mime_source: "URL_EXTENSION", message_object_id: `obj-private-${index + 1}` })),
    ...overrides };
}
function errorResult(code, recoveryId, diagnostic) {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code,
    ...(recoveryId ? { recovery_id: recoveryId } : {}), ...(diagnostic ? { diagnostic } : {}) } }) }] };
}

function canonicalJsonForTest(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonForTest).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJsonForTest(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
