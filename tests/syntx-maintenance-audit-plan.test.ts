import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSyntxPublicCatalogSnapshot,
  type SyntxPublicCatalogSnapshot
} from "../src/catalog/syntx-public-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import {
  buildSyntxMaintenanceAuditPlan
} from "../src/application/syntx-maintenance-audit-plan.js";

function makeSnapshot(
  models: readonly Record<string, unknown>[],
  fetchedAt = "2026-10-10T00:00:00.000Z"
): SyntxPublicCatalogSnapshot {
  const aiRows = new Map<string, string>();
  const modelRows = models.map((entry) => {
    const { scope = "unknown", ...modelEntry } = entry;
    aiRows.set(String(modelEntry.ai_name), String(scope));
    return modelEntry;
  });
  return buildSyntxPublicCatalogSnapshot({
    aiPayload: [...aiRows].map(([value, scope]) => ({
      active: true, description: null, label: value, scope, value
    })),
    modelsPayload: modelRows,
    llmModelsPayload: {
      count: 1,
      models: [{
        ai_name: "demo", available_subscriptions: ["pro"], capabilities: {
          deep_research: false, files: false, images: false, planning: false,
          streaming: false, system_message: false, thinking: false, web_explorer: false
        }, context_window: 1000, default_max_tokens: 100, description: null,
        enabled: true, free_from_sub: null, icon: null, id: "llm-demo", is_free: false,
        label: "LLM demo", max_images_count: 0, min_subscription: "pro",
        performance_level: 1, supported_tools: []
      }]
    },
    fetchedAt
  });
}

function model(value: string, options: { scope?: string; media?: string[]; type?: string } = {}) {
  return {
    active: true, ai_name: value, default: false, description: null,
    features: {
      files_generation: false, files_processing: false,
      image_generation: false, image_processing: false, search: false
    },
    label: value,
    settings: options.media === undefined ? null : { allowed_media_types: options.media },
    type: options.type ?? null,
    value,
    scope: options.scope ?? "unknown"
  };
}

test("audit plan keeps the full candidate census, uses catalog metadata, and separates removals", () => {
  const baseline = makeSnapshot([model("removed-image", { scope: "image" })]);
  const candidate = makeSnapshot([
    model("candidate-image", { scope: "image", media: ["videos"] }),
    model("candidate-video", { scope: "video", media: ["images"] }),
    model("candidate-audio", { scope: "audio" }),
    model("candidate-other", { scope: "other" }),
    model("candidate-text", { scope: "text" }),
    model("candidate-unknown")
  ]);

  const plan = buildSyntxMaintenanceAuditPlan({
    baseline_public: baseline,
    candidate_public: candidate
  });

  assert.deepEqual(plan.census.models.map(({ model_id, modality }) => [model_id, modality]), [
    ["candidate-image", "image"],
    ["candidate-video", "video"],
    ["candidate-audio", "audio"],
    ["candidate-other", "other"],
    ["candidate-text", "text"],
    ["candidate-unknown", "unknown"]
  ]);
  assert.deepEqual(plan.census.removed_model_ids, ["removed-image"]);
  assert.equal(plan.census.models.length, candidate.models.length);
  assert.deepEqual(plan.affected_queue.model_ids, ["candidate-image", "candidate-video", "candidate-audio", "candidate-other", "candidate-text", "candidate-unknown"]);
  assert.equal(plan.census.models.find((row) => row.model_id === "candidate-text")?.mandatory_gate, false);
  assert.equal(plan.census.models.find((row) => row.model_id === "candidate-unknown")?.mandatory_gate, true);
  assert.equal(plan.coverage.account_access, "NOT_CHECKED");
  assert.equal(plan.checkpoint_template.observations.length, 0);
  assert.equal(JSON.stringify(plan).includes("description"), false);
});

test("checkpoint rejects account-plan status and never evaluates accessors", () => {
  const snapshot = makeSnapshot([model("image-a", { scope: "image" })]);
  const plan = buildSyntxMaintenanceAuditPlan({ baseline_public: snapshot, candidate_public: snapshot });
  const blocked = {
    ...plan.checkpoint_template,
    observations: [{ model_id: "image-a", obligation: "controls", status: "BLOCKED_BY_PLAN" }]
  };
  assert.throws(() => buildSyntxMaintenanceAuditPlan({
    baseline_public: snapshot, candidate_public: snapshot, checkpoint: blocked
  }), { code: "UNSAFE_CHECKPOINT" });
  for (const observation of [
    { model_id: "foreign-model", obligation: "controls", status: "OBSERVED" },
    { model_id: "image-a", obligation: "account_access", status: "OBSERVED" }
  ]) {
    assert.throws(() => buildSyntxMaintenanceAuditPlan({
      baseline_public: snapshot,
      candidate_public: snapshot,
      checkpoint: { ...plan.checkpoint_template, observations: [observation] }
    }), { code: "UNSAFE_CHECKPOINT" });
  }

  let getterReads = 0;
  const hostile = Object.create(null);
  Object.defineProperties(hostile, {
    schema_version: { value: "1.0.0", enumerable: true },
    source_identity: { get() { getterReads += 1; throw new Error("private checkpoint data"); }, enumerable: true },
    observations: { value: [], enumerable: true }
  });
  assert.throws(() => buildSyntxMaintenanceAuditPlan({
    baseline_public: snapshot, candidate_public: snapshot, checkpoint: hostile
  }), { code: "UNSAFE_CHECKPOINT" });
  const proxyCheckpoint = new Proxy({}, { get() { getterReads += 1; throw new Error("proxy trap"); } });
  assert.throws(() => buildSyntxMaintenanceAuditPlan({
    baseline_public: snapshot, candidate_public: snapshot, checkpoint: proxyCheckpoint
  }), { code: "UNSAFE_CHECKPOINT" });
  assert.equal(getterReads, 0);
});

test("current archived catalog modality comes from AI scope, not input media types", () => {
  const snapshot = loadPublicCatalogVersion(
    "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json"
  );
  const plan = buildSyntxMaintenanceAuditPlan({ baseline_public: snapshot, candidate_public: snapshot });
  const byId = new Map(plan.census.models.map((entry) => [entry.model_id, entry]));

  assert.equal(byId.get("gpt-image-2")?.modality, "image");
  assert.equal(byId.get("seedance_pro")?.modality, "video");
  assert.equal(byId.get("eleven_v3")?.modality, "audio");
  assert.equal(plan.census.total_models, snapshot.models.length);
  assert.deepEqual(plan.affected_queue.model_ids, []);
  assert.equal(plan.impact.mapping_partial, true);

  const settingsVersion = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
  const settings = loadMaplessSettingsInventoryVersion(settingsVersion);
  const withSettings = buildSyntxMaintenanceAuditPlan({
    baseline_public: snapshot,
    candidate_public: snapshot,
    baseline_settings: settings,
    candidate_settings: settings
  });
  assert.equal(withSettings.source_identity.settings_version, settingsVersion);
  assert.equal(withSettings.source_identity.settings_hash?.length, "sha256:".length + 64);
});

test("resume is source-bound and resets stale observations while leaving new models untouched", () => {
  const baseline = makeSnapshot([model("stable", { scope: "image" }), model("changed", { scope: "video" })]);
  const baselinePlan = buildSyntxMaintenanceAuditPlan({ baseline_public: baseline, candidate_public: baseline });
  const checkpoint = {
    ...baselinePlan.checkpoint_template,
    observations: [
      { model_id: "stable", obligation: "controls", status: "OBSERVED" },
      { model_id: "changed", obligation: "controls", status: "UNSUPPORTED" }
    ]
  } as const;
  const exact = buildSyntxMaintenanceAuditPlan({
    baseline_public: baseline, candidate_public: baseline, checkpoint
  });
  assert.equal(exact.checkpoint_resume.status, "EXACT_SOURCE");
  assert.equal(exact.census.models.find((row) => row.model_id === "stable")?.obligations[0]?.status, "OBSERVED");
  const metadataOnly = makeSnapshot(
    [model("stable", { scope: "image" }), model("changed", { scope: "video" })],
    "2026-10-11T00:00:00.000Z"
  );
  const carried = buildSyntxMaintenanceAuditPlan({
    baseline_public: baseline, candidate_public: metadataOnly, checkpoint
  });
  assert.equal(carried.checkpoint_resume.status, "CARRIED_UNAFFECTED");
  assert.deepEqual(carried.census.models.find((row) => row.model_id === "stable")?.obligations[0], {
    id: "controls", status: "OBSERVED"
  });

  const changedSnapshot = makeSnapshot([
    model("stable", { scope: "image" }),
    { ...model("changed", { scope: "video" }), label: "Changed source label" },
    model("new-model", { scope: "audio" })
  ]);
  const stale = buildSyntxMaintenanceAuditPlan({
    baseline_public: baseline, candidate_public: changedSnapshot, checkpoint
  });
  assert.equal(stale.checkpoint_resume.status, "SOURCE_CHANGED_RESET");
  assert.deepEqual(stale.checkpoint_resume.stale_model_ids, ["changed", "stable"]);
  assert.equal(stale.census.models.find((row) => row.model_id === "new-model")?.obligations[0]?.status, "NOT_VISITED");
  assert.throws(() => buildSyntxMaintenanceAuditPlan({
    baseline_public: changedSnapshot, candidate_public: changedSnapshot, checkpoint
  }), { code: "CHECKPOINT_SOURCE_MISMATCH" });
});
