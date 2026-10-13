import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GenerationContractExecutorV2, GenerationContractExecutionErrorV2 } from "../src/adapter/syntx/generation-contract-executor-v2.js";
import type { GenerationContractCatalogModel, GenerationContractCatalogPort } from "../src/adapter/syntx/generation-contract-executor.js";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { archiveExactBananaProofV2, buildExactBananaProofV2, type BananaExactTerminalEvidenceV2 } from "../tools/build-exact-banana-proof-v2.js";

const PARENT_VERSION = "sha256-650fe8e62c95298d81b8134d3f583b0acfbe55fe147ec2c828d95f941f7236ef.json";
const LIVE_VERSION = "sha256-394f8824e70dc4d3941b9f88dab7a57a49c34b6cc104bba1f16b43d7bcf3a2fb.json";
const PROOF_PATH = "catalog/runtime/v22/sha256-d456f871fb206e2ed2da417c321d01d69b7e00998a5513e1e4bba72f1bef8bb0.json";
const CATALOG_DIRECTORY = `${process.cwd()}/catalog`;
const sha = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function makeCatalog(): GenerationContractCatalogPort {
  const snapshot = loadPublicCatalogVersion("sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json", CATALOG_DIRECTORY);
  return {
    getModel(modelId: string): GenerationContractCatalogModel {
      const model = snapshot.models.find((entry) => entry.value === modelId);
      if (!model) throw new Error("Unknown fixture model.");
      return {
        id: model.value,
        upstream_id: model.value,
        ai_name: model.ai_name,
        active: model.active,
        operations: [{ id: "generate-image", output_modality: "image" }],
        fetched_at: snapshot.fetched_at,
        source_hashes: {
          ai: snapshot.sources.ai.canonical_sha256,
          llm_models: snapshot.sources.llm_models.canonical_sha256,
          models: snapshot.sources.models.canonical_sha256
        }
      };
    }
  };
}

function fakeTerminalProof(registrySha: string, schemaSha: string): BananaExactTerminalEvidenceV2 {
  return {
    schema_version: "1.0.0",
    artifact_kind: "OWNER_EXACT_CONFIGURABLE_BANANA_PROBE_V1",
    runtime_usable: false,
    outcome: "PASS_EXACT_RESULT_ONLY",
    parent_registry_version: PARENT_VERSION,
    parent_registry_sha256: registrySha,
    tested_variant_id: "banana-ui-reviewed-banana-2.1",
    tested_schema_sha256: schemaSha,
    request_fingerprint_sha256: sha("synthetic request fingerprint"),
    model_id: "banana-2.1",
    operation_id: "generate-image",
    settings: {
      model_type: "banana-2.1",
      aspect_ratio: "16:9",
      image_size: "2K",
      thinking_level: "medium",
      n: 1,
      file_urls: []
    },
    attempt_started_at_exact: null,
    attempt_started_at_lower_bound: "2026-10-09T00:59:00.000Z",
    observed_at: "2026-10-09T01:00:00.000Z",
    actual_upstream_call: true,
    dispatch_count: 1,
    retry_count: 0,
    artifact_count: 1,
    mime_types: ["image/jpeg"],
    safe_artifact_summary_sha256: sha("synthetic safe summary"),
    media_content_sha256: null,
    playback_verified: false,
    code_hashes: [
      { source: "scripts/live-owner-reviewed-contract-probe.mjs", sha256: sha("synthetic probe code") },
      { source: "src/adapter/syntx/owner-contract-media.ts", sha256: sha("synthetic media service code") }
    ],
    pre_probe_history: [{
      status: "HANDOFF_NOT_CONFIRMED",
      observed_at: null,
      wait_timeout_seconds: 45,
      local_unlink_status: "REVOKED_READBACK_CONFIRMED",
      child_exit_code: 1,
      actual_upstream_call: false
    }],
    cleanup: {
      observed_at: "2026-10-09T01:02:00.000Z",
      local_unlink_status: "REVOKED_READBACK_CONFIRMED",
      process_exit_code: 0
    }
  };
}

test("exact proof builder appends only one Banana 2.1 2K/medium/16:9 profile in memory", () => {
  const current = loadGenerationContractRegistryV2(PARENT_VERSION, CATALOG_DIRECTORY);
  const flexible = current.contracts.find((contract) => contract.variant_id === "banana-ui-reviewed-banana-2.1");
  assert.ok(flexible);
  const result = buildExactBananaProofV2(current, fakeTerminalProof(current.registry_sha256, flexible.schema_hash), "2026-10-09T01:03:00.000Z");
  assert.equal(result.added_variant_id, "banana21-image-2k-medium-landscape");
  assert.equal(result.registry.contracts.length, 39);
  for (const old of current.contracts) assert.deepEqual(result.registry.contracts.find((item) => item.variant_id === old.variant_id), old);
  assert.equal(result.registry.contracts.filter((item) => item.status === "live_verified").length, 5);
  assert.equal(result.registry.contracts.filter((item) => item.status === "reviewed").length, 34);
  const flexAfter = result.registry.contracts.find((contract) => contract.variant_id === flexible.variant_id);
  assert.equal(flexAfter?.status, "reviewed");
  const exact = result.registry.contracts.find((contract) => contract.variant_id === result.added_variant_id);
  assert.ok(exact);
  assert.equal(exact.status, "live_verified");
  assert.deepEqual(exact.parameters.required, ["prompt"]);
  assert.deepEqual(exact.parameters.properties, { prompt: { type: "string", min_length: 1 } });
  assert.deepEqual(exact.wire.fixed_settings, {
    aspect_ratio: "16:9", image_size: "2K", thinking_level: "medium", n: 1, file_urls: []
  });
  assert.deepEqual(exact.output.mime_types, ["image/jpeg"]);
  assert.equal(exact.provenance.live_observed_at, "2026-10-09T01:00:00.000Z");
  assert.equal(result.proof_reference.startsWith("catalog/runtime/v22/sha256-"), true);
  assert.match(result.proof_sha256, /^sha256:[a-f0-9]{64}$/u);

  const snapshot = loadPublicCatalogVersion("sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json", CATALOG_DIRECTORY);
  const executor = new GenerationContractExecutorV2(result.registry, makeCatalog());
  const prepared = executor.prepare({
    model_id: "banana-2.1", operation_id: "generate-image", variant_id: result.added_variant_id,
    catalog_version: `${snapshot.fetched_at}.${snapshot.sources.models.canonical_sha256.slice(7, 19)}`,
    parameters: { prompt: "synthetic test only" }
  });
  assert.deepEqual(prepared.settings, {
    model_type: "banana-2.1", aspect_ratio: "16:9", image_size: "2K", thinking_level: "medium", n: 1, file_urls: []
  });
  for (const parameters of [
    { prompt: "synthetic test only", image_size: "1K" },
    { prompt: "synthetic test only", aspect_ratio: "1:1" },
    { prompt: "synthetic test only", thinking_level: "minimal" },
    { prompt: "synthetic test only", model_type: "banana3" }
  ]) {
    assert.throws(() => executor.prepare({
      model_id: "banana-2.1", operation_id: "generate-image", variant_id: result.added_variant_id,
      catalog_version: `${snapshot.fetched_at}.${snapshot.sources.models.canonical_sha256.slice(7, 19)}`, parameters
    }), (error: unknown) => error instanceof GenerationContractExecutionErrorV2 && error.code === "GENERATION_CONTRACT_VALIDATION_FAILED");
  }
});

test("exact proof builder rejects altered tuple, uncertain outcome, retry, and unconfirmed cleanup", () => {
  const current = loadGenerationContractRegistryV2(PARENT_VERSION, CATALOG_DIRECTORY);
  const flexible = current.contracts.find((contract) => contract.variant_id === "banana-ui-reviewed-banana-2.1");
  assert.ok(flexible);
  const valid = fakeTerminalProof(current.registry_sha256, flexible.schema_hash);
  const invalidCases: unknown[] = [
    { ...valid, settings: { ...valid.settings, image_size: "1K" } },
    { ...valid, settings: { ...valid.settings, aspect_ratio: "1:1" } },
    { ...valid, settings: { ...valid.settings, extra: "unexpected" } },
    { ...valid, outcome: "OUTCOME_UNKNOWN" },
    { ...valid, attempt_started_at_lower_bound: "2026-10-09T01:01:00.000Z" },
    { ...valid, dispatch_count: 2 },
    { ...valid, retry_count: 1 },
    { ...valid, mime_types: ["image/png"] },
    { ...valid, media_content_sha256: sha("unapproved media bytes") },
    { ...valid, tested_schema_sha256: sha("different tested schema") },
    { ...valid, parent_registry_sha256: sha("different parent registry") },
    { ...valid, raw_prompt: "must not be persisted" },
    { ...valid, cleanup: { ...valid.cleanup, local_unlink_status: "UNKNOWN" } }
  ];
  for (const invalid of invalidCases) {
    assert.throws(() => buildExactBananaProofV2(current, invalid as BananaExactTerminalEvidenceV2, "2026-10-09T01:03:00.000Z"));
  }
});

test("proof and registry archives are create-once and hash-verifiable in an isolated directory", async (t) => {
  const current = loadGenerationContractRegistryV2(PARENT_VERSION, CATALOG_DIRECTORY);
  const flexible = current.contracts.find((contract) => contract.variant_id === "banana-ui-reviewed-banana-2.1");
  assert.ok(flexible);
  const built = buildExactBananaProofV2(current, fakeTerminalProof(current.registry_sha256, flexible.schema_hash), "2026-10-09T01:03:00.000Z");
  const tempRoot = mkdtempSync(join(tmpdir(), "syntx-exact-banana-proof-v2-"));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  await assert.rejects(
    () => archiveExactBananaProofV2({ ...built, proof_json: `${built.proof_json} ` }, tempRoot),
    /EXACT_BANANA_PROOF_ARCHIVE_BINDING_INVALID/u
  );
  const first = await archiveExactBananaProofV2(built, tempRoot);
  const second = await archiveExactBananaProofV2(built, tempRoot);
  assert.equal(first.proof_status, "created");
  assert.equal(second.proof_status, "existing");
  assert.equal(first.registry_status, "created");
  assert.equal(second.registry_status, "existing");
  assert.equal(first.registry_version, second.registry_version);
  const proofPath = join(tempRoot, built.proof_reference.replace(/^catalog\//u, ""));
  const proofBytes = readFileSync(proofPath);
  assert.equal(sha(proofBytes.toString("utf8")), built.proof_sha256);
  const archived = loadGenerationContractRegistryV2(first.registry_version, tempRoot);
  assert.equal(archived.registry_sha256, built.registry.registry_sha256);
  assert.equal(archived.contracts.find((contract) => contract.variant_id === built.added_variant_id)?.schema_hash,
    built.registry.contracts.find((contract) => contract.variant_id === built.added_variant_id)?.schema_hash);
});

test("actual owner proof read-back is exact, hash-pinned, and scoped to one tuple", () => {
  const parent = loadGenerationContractRegistryV2(PARENT_VERSION, CATALOG_DIRECTORY);
  const archived = loadGenerationContractRegistryV2(LIVE_VERSION, CATALOG_DIRECTORY);
  const proofBytes = readFileSync(join(process.cwd(), PROOF_PATH));
  const proof = JSON.parse(proofBytes.toString("utf8")) as Record<string, unknown>;
  assert.equal(sha(proofBytes.toString("utf8")), "sha256:d456f871fb206e2ed2da417c321d01d69b7e00998a5513e1e4bba72f1bef8bb0");
  assert.equal(archived.contracts.length, 39);
  assert.equal(archived.contracts.filter((contract) => contract.status === "live_verified").length, 5);
  assert.equal(archived.contracts.filter((contract) => contract.status === "reviewed").length, 34);
  for (const old of parent.contracts) assert.deepEqual(archived.contracts.find((contract) => contract.variant_id === old.variant_id), old);
  const exact = archived.contracts.find((contract) => contract.variant_id === "banana21-image-2k-medium-landscape");
  assert.ok(exact);
  assert.equal(exact.schema_hash, "sha256:e2f00f3f65bd98fe6c9e081b4bcde4646289ea352dc4d7d005068627907ab222");
  assert.equal(archived.contracts.find((contract) => contract.variant_id === "banana-ui-reviewed-banana-2.1")?.status, "reviewed");
  const request = proof.tested_request as Record<string, unknown>;
  const observation = proof.observation as Record<string, unknown>;
  const timing = proof.timing as Record<string, unknown>;
  assert.equal(request.schema_sha256, "sha256:978ac3e57d759fce06e8ef1013e7e3300aaaff654e81ac0a719e9e7fbfe9103a");
  assert.equal(request.request_fingerprint_sha256, "sha256:aebb502fdcc1ab50aa34537e5ec64b5bc65f425a29ddfe936283a739f273bfb4");
  assert.equal(observation.outcome, "PASS_EXACT_RESULT_ONLY");
  assert.equal(observation.retry_count, 0);
  assert.deepEqual(observation.mime_types, ["image/jpeg"]);
  assert.equal(observation.safe_artifact_summary_sha256, "sha256:41b0555b4d292a9035918d5525e48928ca5a1dce7d54453f6da3f129edb4e0e0");
  assert.equal(observation.media_content_sha256, null);
  assert.equal(observation.playback_verified, false);
  assert.equal(timing.attempt_started_at_exact, null);
  assert.equal(timing.attempt_started_at_lower_bound, "2026-10-08T22:49:36Z");
  assert.equal(Object.hasOwn(request, "prompt"), false, "proof must not persist prompt values");
  assert.equal(request.prompt_recorded, false);
});
