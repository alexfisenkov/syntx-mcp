import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import {
  buildKlingSourceGuardCandidatesV27,
  canonicalKlingCandidateJson,
  KLING_SOURCE_GUARD_V27_PUBLIC_VERSION,
  KLING_SOURCE_GUARD_V27_RESULT_JSON_SHA256,
  KLING_SOURCE_GUARD_V27_RESULT_MARKDOWN_SHA256,
  KLING_SOURCE_GUARD_V27_SETTINGS_VERSION,
  KLING_SOURCE_GUARD_V27_SOURCE_SHA256,
  parseKlingSourceGuardCandidatesV27Document
} from "../src/catalog/kling-source-guard-candidates-v27.js";
import { analyzeKlingSourceGuardAst, fetchKlingPinnedSourceOnce } from "../tools/kling-source-guard-candidates.js";

const inventory = loadMaplessSettingsInventoryVersion(KLING_SOURCE_GUARD_V27_SETTINGS_VERSION);

test("Kling source GET preflight rejects a changed pin before invoking fetch", async () => {
  let calls = 0;
  const changed = structuredClone(inventory);
  changed.forms.find((form) => form.form_id === "kling")!.javascript.bytes += 1;
  await assert.rejects(fetchKlingPinnedSourceOnce(changed, async () => {
    calls += 1;
    return new Response("unused");
  }), /KLING_SOURCE_PREFLIGHT_PIN_MISMATCH/u);
  assert.equal(calls, 0);
});

test("Kling source GET rejects a redirect with exactly one fetch invocation", async () => {
  let calls = 0;
  await assert.rejects(fetchKlingPinnedSourceOnce(inventory, async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: "https://syntx.ai/other.js" } });
  }), /KLING_SOURCE_REDIRECT_REJECTED/u);
  assert.equal(calls, 1);
});

test("Kling source GET enforces the response byte cap without a retry", async () => {
  let calls = 0;
  await assert.rejects(fetchKlingPinnedSourceOnce(inventory, async () => {
    calls += 1;
    return new Response(new Uint8Array(65_537), { status: 200, headers: { "content-length": "65537" } });
  }), /KLING_SOURCE_BODY_LIMIT_EXCEEDED/u);
  assert.equal(calls, 1);
});

test("synthetic Kling AST curator preserves the eight-model guard matrix and failed historical budget", () => {
  const source = `const normalize = (x) => { const ids = ["kling_elements", "kling_image2video", "kling_keyframes", "kling_motion_control", "kling_o1_image2video", "kling_o1_text2video", "kling_o1_video2video", "kling_text2video"]; const fields = ["version", "mode", "gen_type", "video_duration", "standart", "hd", "mcv", "multi_shots", "camera_movement"]; if (x.model_type === "kling_o1_video2video") { x.version = undefined; } return [x, ids, fields]; }; const validate = (x) => (x.model_type === "kling_o1_video2video" || x.model_type === "kling_o1_image2video") && x.video_duration >= 3;`;
  const evidence = analyzeKlingSourceGuardAst(source);
  const tree = { normalizer_ast: evidence.normalizer_ast, duration_validator_ast: evidence.duration_validator_ast };
  const treeSha = `sha256:${createHash("sha256").update(canonicalKlingCandidateJson(tree), "utf8").digest("hex")}`;
  const publicCatalog = loadPublicCatalogVersion(KLING_SOURCE_GUARD_V27_PUBLIC_VERSION);
  const artifact = buildKlingSourceGuardCandidatesV27({
    public_catalog: publicCatalog,
    settings_inventory: inventory,
    source_fact_tree: { ...evidence, source_bytes: 31_857, source_sha256: KLING_SOURCE_GUARD_V27_SOURCE_SHA256 },
    source_fact_tree_sha256: treeSha,
    provenance: { started_at: "2026-10-09T04:00:00.000Z", completed_at: "2026-10-09T04:00:01.000Z", response_date: null, status: 200, redirects: 0, retries: 0 },
    result_json_sha256: KLING_SOURCE_GUARD_V27_RESULT_JSON_SHA256,
    result_markdown_sha256: KLING_SOURCE_GUARD_V27_RESULT_MARKDOWN_SHA256
  });
  assert.equal(artifact.cohort.length, 8);
  assert.equal(artifact.runtime_usable, false);
  assert.equal(artifact.backend_acceptance, false);
  assert.equal(artifact.provenance.historical_read_boundary.limit_passed, false);
  assert.deepEqual(artifact.cohort.find((row) => row.model_id === "kling_o1_video2video")?.duration, {
    kind: "CONDITIONAL_SOURCE_GUARD_CANDIDATE",
    source_file_absent: { predicate: "UNKNOWN", accepted_values: [5, 10] },
    source_file_metadata_present: { predicate: "UNKNOWN", requested_duration: "ROUND_METADATA_DURATION" },
    source_file_metadata_absent: { predicate: "UNKNOWN", minimum: 3, maximum: 10 }
  });
  const encoded = Buffer.from(`${canonicalKlingCandidateJson(artifact)}\n`, "utf8");
  assert.deepEqual(parseKlingSourceGuardCandidatesV27Document(encoded), artifact);

  const withUnknownField = { ...artifact, injected_fact: true };
  assert.throws(() => parseKlingSourceGuardCandidatesV27Document(Buffer.from(JSON.stringify(withUnknownField))), /unrecognized_keys/u);
  const changedBranch = structuredClone(artifact);
  changedBranch.cohort.find((row) => row.model_id === "kling_motion_control")!.version.guard_values.reverse();
  assert.throws(() => parseKlingSourceGuardCandidatesV27Document(Buffer.from(JSON.stringify(changedBranch))), /KLING_CANDIDATE_BINDING_INVALID/u);
});
