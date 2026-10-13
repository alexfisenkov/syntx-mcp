import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer } from "../src/mcp/server.js";

test("default MCP server lists and executes offline version discovery", async () => {
  const server: McpServer = createMcpServer(createDefaultApplication());
  const client = new Client({ name: "maintenance-tools-red-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    const versions = await client.callTool({ name: "syntx_list_update_versions", arguments: {
      source_kind: "public", offset: 0, limit: 1
    } });
    const nextVersions = await client.callTool({ name: "syntx_list_update_versions", arguments: {
      source_kind: "public", offset: 1, limit: 1
    } });
    const settingsVersions = await client.callTool({ name: "syntx_list_update_versions", arguments: {
      source_kind: "settings", offset: 0, limit: 100
    } });
    assert.ok(names.includes("syntx_list_update_versions"), "version discovery tool is registered");
    assert.notEqual(versions.isError, true, JSON.stringify(versions));
    const versionOutput = versions.structuredContent as Record<string, unknown>;
    assert.equal(versionOutput.network_access, false);
    assert.equal(versionOutput.archive_writes, false);
    const firstPage = versions.structuredContent as { total: number; items: readonly unknown[]; next_offset: number | null };
    const secondPage = nextVersions.structuredContent as { total: number; items: readonly unknown[]; next_offset: number | null };
    assert.equal(firstPage.items.length, 1);
    assert.equal(firstPage.next_offset, 1);
    assert.equal(secondPage.total, firstPage.total);
    assert.equal(secondPage.items.length, 1);
    assert.equal(secondPage.next_offset, 2);
    const settingsPage = settingsVersions.structuredContent as { total: number; items: readonly Record<string, unknown>[]; next_offset: number | null };
    assert.equal(settingsPage.next_offset, null);
    const knownPair = settingsPage.items.find((item) => item.version === "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json");
    assert.equal(knownPair?.paired_public_version, "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json");
    assert.equal(knownPair?.paired_public_archive_available, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("offline plan tool returns bounded paired-source model and control pages with global counts", async () => {
  const server: McpServer = createMcpServer(createDefaultApplication());
  const client = new Client({ name: "maintenance-plan-red-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    const result = await client.callTool({ name: "syntx_plan_mcp_update", arguments: {
      baseline_public_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      candidate_public_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      baseline_settings_version: "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json",
      candidate_settings_version: "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json",
      model_page: { offset: 0, limit: 2 },
      removed_page: { offset: 0, limit: 2 },
      control_page: { offset: 0, limit: 2 }
    } }) as CallToolResult;
    assert.ok(names.includes("syntx_plan_mcp_update"), "offline plan tool is registered");
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const output = result.structuredContent as Record<string, unknown>;
    assert.equal(output.operation, "MCP_MAINTENANCE_PLAN");
    assert.equal(output.automatic_runtime_promotion, false);
    assert.equal(output.paid_operations, false);
    assert.equal(output.network_access, false);
    assert.equal(output.archive_writes, false);
    const summary = output.plan_summary as Record<string, unknown>;
    assert.equal(summary.census_model_count, 200);
    assert.deepEqual(summary.coverage, {
      public_control_observations: "USER_DECLARED_ONLY",
      conditional_visibility: "NOT_EVALUATED",
      account_access: "NOT_CHECKED",
      rendered_ui: "NOT_CHECKED",
      provider_acceptance: "NOT_CHECKED"
    });
    const modelPage = output.model_page as { total: number; items: readonly unknown[]; next_offset: number | null };
    assert.equal(modelPage.total, 200);
    assert.equal(modelPage.items.length, 2);
    assert.equal(modelPage.next_offset, 2);
    const controlWalk = output.control_walk as { total_controls: number; page: { total: number; items: readonly Record<string, unknown>[]; next_offset: number | null } };
    assert.ok(controlWalk.total_controls > 0);
    assert.equal(controlWalk.page.total, controlWalk.total_controls);
    assert.equal(controlWalk.page.items.length, 2);
    assert.equal(controlWalk.page.next_offset, 2);
    assert.ok(controlWalk.page.items.every((item) => !Object.hasOwn(item, "value")));
    const nextResult = await client.callTool({ name: "syntx_plan_mcp_update", arguments: {
      baseline_public_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      candidate_public_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      baseline_settings_version: "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json",
      candidate_settings_version: "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json",
      model_page: { offset: 2, limit: 2 },
      removed_page: { offset: 0, limit: 2 },
      control_page: { offset: 0, limit: 2, model_ids: ["banana-2.1"] }
    } });
    assert.notEqual(nextResult.isError, true, JSON.stringify(nextResult));
    const nextOutput = nextResult.structuredContent as Record<string, unknown>;
    const nextModelPage = nextOutput.model_page as { total: number; items: readonly unknown[]; next_offset: number | null };
    assert.equal(nextModelPage.total, modelPage.total);
    assert.equal(nextModelPage.items.length, 2);
    assert.equal(nextModelPage.next_offset, 4);
    const selectedControls = (nextOutput.control_walk as { page: { total: number; items: readonly { model_id: string }[]; next_offset: number | null } }).page;
    assert.ok(selectedControls.total > 0);
    assert.ok(selectedControls.items.every((item) => item.model_id === "banana-2.1"));
    assert.equal(selectedControls.next_offset, 2);
  } finally {
    await client.close();
    await server.close();
  }
});

test("offline plan tool returns a fixed redacted error for an unpaired settings version", async () => {
  const server: McpServer = createMcpServer(createDefaultApplication());
  const client = new Client({ name: "maintenance-unpaired-settings-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const suppliedVersion = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: "syntx_plan_mcp_update", arguments: {
      baseline_public_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      candidate_public_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      baseline_settings_version: suppliedVersion,
      model_page: { offset: 0, limit: 1 },
      removed_page: { offset: 0, limit: 1 }
    } }) as CallToolResult;
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    assert.equal(JSON.stringify(result).includes(suppliedVersion), false);
    const error = JSON.parse(result.content[0] && "text" in result.content[0] ? result.content[0].text : "{}");
    assert.equal(error.error.code, "MCP_MAINTENANCE_INPUT_INVALID");
  } finally {
    await client.close();
    await server.close();
  }
});

test("offline plan tool rejects mismatched settings bindings with a fixed path-free code", async () => {
  const server: McpServer = createMcpServer(createDefaultApplication());
  const client = new Client({ name: "maintenance-settings-binding-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: "syntx_plan_mcp_update", arguments: {
      baseline_public_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      candidate_public_version: "sha256-c6fdcc522def8f6f4ef2c172d23822164f0124b29bb5fe86e2b5dce5c54b9fbc.json",
      baseline_settings_version: "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json",
      candidate_settings_version: "sha256-87e96b78b145338af1a666c92ab8a9811f46eb82b8f377331a103b0b409aec38.json",
      model_page: { offset: 0, limit: 1 },
      removed_page: { offset: 0, limit: 1 }
    } }) as CallToolResult;
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    const error = JSON.parse(result.content[0] && "text" in result.content[0] ? result.content[0].text : "{}");
    assert.equal(error.error.code, "MCP_MAINTENANCE_SETTINGS_PAIR_MISMATCH");
    assert.equal(JSON.stringify(result).includes("/Users/"), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("offline maintenance input guards reject paths and private checkpoint fields without echo", async () => {
  const server: McpServer = createMcpServer(createDefaultApplication());
  const client = new Client({ name: "maintenance-input-guards-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const base = {
    candidate_public_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    model_page: { offset: 0, limit: 1 },
    removed_page: { offset: 0, limit: 1 }
  };
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const traversal = await client.callTool({ name: "syntx_plan_mcp_update", arguments: {
      ...base, baseline_public_version: "../../private/path-sentinel.json"
    } }) as CallToolResult;
    assert.equal(traversal.isError, true);
    assert.equal(JSON.stringify(traversal).includes("path-sentinel"), false);

    const privateField = await client.callTool({ name: "syntx_plan_mcp_update", arguments: {
      ...base,
      baseline_public_version: base.candidate_public_version,
      model_checkpoint: {
        schema_version: "1.0.0",
        source_identity: { public_version: base.candidate_public_version, public_hash: "sha256:e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989", settings_version: null, settings_hash: null },
        observations: [],
        private_account_field: "ACCOUNT_SECRET_SENTINEL"
      }
    } }) as CallToolResult;
    assert.equal(privateField.isError, true);
    assert.equal(JSON.stringify(privateField).includes("ACCOUNT_SECRET_SENTINEL"), false);

    const oversizedPage = await client.callTool({ name: "syntx_list_update_versions", arguments: {
      source_kind: "public", offset: 0, limit: 101
    } }) as CallToolResult;
    assert.equal(oversizedPage.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("offline plan tool rejects combined checkpoint observations above four thousand with a fixed code", async () => {
  const server: McpServer = createMcpServer(createDefaultApplication());
  const client = new Client({ name: "maintenance-checkpoint-cap-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const sourceIdentity = {
    public_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    public_hash: "sha256:e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989",
    settings_version: "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json",
    settings_hash: "sha256:00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61"
  };
  const modelCheckpoint = {
    schema_version: "1.0.0",
    source_identity: sourceIdentity,
    observations: Array.from({ length: 2_001 }, (_, index) => ({
      model_id: `m${index}`,
      obligation: "controls",
      status: "OBSERVED"
    }))
  };
  const controlCheckpoint = {
    schema_version: "1.0.0",
    source_identity: sourceIdentity,
    observations: Array.from({ length: 2_000 }, (_, index) => ({
      control_id: `ctl_${index.toString(16).padStart(32, "0")}`,
      fingerprint: `sha256:${"0".repeat(64)}`,
      status: "UNSUPPORTED"
    }))
  };
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: "syntx_plan_mcp_update", arguments: {
      baseline_public_version: sourceIdentity.public_version,
      candidate_public_version: sourceIdentity.public_version,
      baseline_settings_version: sourceIdentity.settings_version,
      candidate_settings_version: sourceIdentity.settings_version,
      model_checkpoint: modelCheckpoint,
      control_checkpoint: controlCheckpoint,
      model_page: { offset: 0, limit: 1 },
      removed_page: { offset: 0, limit: 1 },
      control_page: { offset: 0, limit: 1 }
    } }) as CallToolResult;
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    const error = JSON.parse(result.content[0] && "text" in result.content[0] ? result.content[0].text : "{}");
    assert.equal(error.error.code, "MCP_MAINTENANCE_CHECKPOINT_INVALID");
    assert.equal(JSON.stringify(result).includes("m2000"), false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("maintenance MCP calls perform no fetch and leave packaged archive files unchanged", async () => {
  const server: McpServer = createMcpServer(createDefaultApplication());
  const client = new Client({ name: "maintenance-read-only-proof-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  const archiveRoot = findPackagedCatalogRoot();
  const archivesBefore = snapshotArchives(archiveRoot);
  try {
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("maintenance tools must stay offline");
    }) as typeof fetch;
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await client.callTool({ name: "syntx_list_update_versions", arguments: { source_kind: "public", offset: 0, limit: 1 } });
    await client.callTool({ name: "syntx_plan_mcp_update", arguments: {
      baseline_public_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      candidate_public_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      model_page: { offset: 0, limit: 1 },
      removed_page: { offset: 0, limit: 1 }
    } });
  } finally {
    globalThis.fetch = originalFetch;
    await client.close();
    await server.close();
  }
  assert.equal(fetchCalls, 0);
  assert.deepEqual(snapshotArchives(archiveRoot), archivesBefore);
});

function findPackagedCatalogRoot(): string {
  const candidates = [new URL("../catalog/", import.meta.url), new URL("../../catalog/", import.meta.url)];
  const found = candidates.find((url) => {
    try { return readdirSync(fileURLToPath(new URL("public/", url))).length >= 0; }
    catch { return false; }
  });
  assert.ok(found);
  return fileURLToPath(found);
}

function snapshotArchives(root: string): readonly unknown[] {
  return ["public", "settings/v2"].map((relativeDirectory) => {
    const path = join(root, relativeDirectory);
    return readdirSync(path).sort().map((name) => {
      const stats = statSync(join(path, name));
      return [name, stats.size, stats.mtimeMs];
    });
  });
}

test("offline plan tool resumes exact control observations, marks source drift stale, and rejects foreign checkpoints", async () => {
  const server: McpServer = createMcpServer(createDefaultApplication());
  const client = new Client({ name: "maintenance-checkpoint-resume-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const base = {
    baseline_public_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    candidate_public_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    baseline_settings_version: "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json",
    candidate_settings_version: "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json",
    model_page: { offset: 0, limit: 1 },
    removed_page: { offset: 0, limit: 1 },
    control_page: { offset: 0, limit: 10, model_ids: ["banana-2.1"] }
  };
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const initial = await client.callTool({ name: "syntx_plan_mcp_update", arguments: base }) as CallToolResult;
    const initialOutput = initial.structuredContent as Record<string, unknown>;
    const initialWalk = initialOutput.control_walk as {
      checkpoint_template: { source_identity: Record<string, unknown> };
      page: { items: readonly { control_id: string; fingerprint: string; model_id: string }[] };
    };
    const control = initialWalk.page.items[0]!;
    assert.equal(control.model_id, "banana-2.1");
    const checkpoint = {
      schema_version: "1.0.0",
      source_identity: initialWalk.checkpoint_template.source_identity,
      observations: [{ control_id: control.control_id, fingerprint: control.fingerprint, status: "OBSERVED" }]
    };

    const exact = await client.callTool({ name: "syntx_plan_mcp_update", arguments: { ...base, control_checkpoint: checkpoint } }) as CallToolResult;
    assert.notEqual(exact.isError, true, JSON.stringify(exact));
    const exactOutput = exact.structuredContent as Record<string, unknown>;
    const exactWalk = exactOutput.control_walk as { checkpoint_resume: { status: string; carried_observation_count: number }; page: { items: readonly { control_id: string; status: string }[] } };
    assert.equal(exactWalk.checkpoint_resume.status, "EXACT_SOURCE");
    assert.equal(exactWalk.checkpoint_resume.carried_observation_count, 1);
    assert.equal(exactWalk.page.items.find((item) => item.control_id === control.control_id)?.status, "OBSERVED");

    const drifted = await client.callTool({ name: "syntx_plan_mcp_update", arguments: {
      ...base,
      candidate_settings_version: "sha256-87e96b78b145338af1a666c92ab8a9811f46eb82b8f377331a103b0b409aec38.json",
      control_checkpoint: checkpoint
    } }) as CallToolResult;
    assert.notEqual(drifted.isError, true, JSON.stringify(drifted));
    const driftedWalk = (drifted.structuredContent as Record<string, unknown>).control_walk as {
      checkpoint_resume: { status: string; stale_control_count: number };
      page: { items: readonly { control_id: string; status: string }[] };
    };
    assert.equal(driftedWalk.checkpoint_resume.status, "SOURCE_CHANGED_RESET");
    assert.equal(driftedWalk.checkpoint_resume.stale_control_count, 1);
    assert.equal(driftedWalk.page.items.find((item) => item.control_id === control.control_id)?.status, "STALE");

    const foreignCheckpoint = { ...checkpoint, source_identity: {
      ...checkpoint.source_identity,
      public_version: "sha256-c6fdcc522def8f6f4ef2c172d23822164f0124b29bb5fe86e2b5dce5c54b9fbc.json",
      public_hash: "sha256:c6fdcc522def8f6f4ef2c172d23822164f0124b29bb5fe86e2b5dce5c54b9fbc",
      settings_version: null,
      settings_hash: null
    } };
    const foreign = await client.callTool({ name: "syntx_plan_mcp_update", arguments: { ...base, control_checkpoint: foreignCheckpoint } }) as CallToolResult;
    assert.equal(foreign.isError, true);
    assert.equal(JSON.stringify(foreign).includes(control.control_id), false);
    const foreignError = JSON.parse(foreign.content[0] && "text" in foreign.content[0] ? foreign.content[0].text : "{}");
    assert.equal(foreignError.error.code, "MCP_MAINTENANCE_CHECKPOINT_SOURCE_MISMATCH");
  } finally {
    await client.close();
    await server.close();
  }
});

test("offline plan tool resumes model checkpoints and invalidates them on public source drift", async () => {
  const server: McpServer = createMcpServer(createDefaultApplication());
  const client = new Client({ name: "maintenance-model-checkpoint-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const base = {
    baseline_public_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    candidate_public_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
    model_page: { offset: 0, limit: 2 },
    removed_page: { offset: 0, limit: 2 }
  };
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const initial = await client.callTool({ name: "syntx_plan_mcp_update", arguments: base }) as CallToolResult;
    const initialOutput = initial.structuredContent as Record<string, unknown>;
    const model = ((initialOutput.model_page as { items: readonly { model_id: string }[] }).items)[0]!;
    const template = initialOutput.model_checkpoint_template as { source_identity: Record<string, unknown> };
    const checkpoint = {
      schema_version: "1.0.0",
      source_identity: template.source_identity,
      observations: [{ model_id: model.model_id, obligation: "controls", status: "OBSERVED" }]
    };

    const exact = await client.callTool({ name: "syntx_plan_mcp_update", arguments: { ...base, model_checkpoint: checkpoint } }) as CallToolResult;
    assert.notEqual(exact.isError, true, JSON.stringify(exact));
    const exactOutput = exact.structuredContent as Record<string, unknown>;
    const exactSummary = (exactOutput.plan_summary as Record<string, unknown>).model_checkpoint_resume as { status: string; carried_observation_count: number };
    assert.equal(exactSummary.status, "EXACT_SOURCE");
    assert.equal(exactSummary.carried_observation_count, 1);
    const exactModel = ((exactOutput.model_page as { items: readonly { model_id: string; obligations: readonly { id: string; status: string }[] }[] }).items)
      .find((item) => item.model_id === model.model_id)!;
    assert.equal(exactModel.obligations.find((item) => item.id === "controls")?.status, "OBSERVED");

    const drift = await client.callTool({ name: "syntx_plan_mcp_update", arguments: {
      ...base,
      candidate_public_version: "sha256-c6fdcc522def8f6f4ef2c172d23822164f0124b29bb5fe86e2b5dce5c54b9fbc.json",
      model_checkpoint: checkpoint
    } }) as CallToolResult;
    assert.notEqual(drift.isError, true, JSON.stringify(drift));
    const driftOutput = drift.structuredContent as Record<string, unknown>;
    const driftSummary = (driftOutput.plan_summary as Record<string, unknown>).model_checkpoint_resume as { status: string; carried_observation_count: number; stale_model_count: number };
    assert.equal(driftSummary.status, "SOURCE_CHANGED_RESET");
    assert.equal(driftSummary.carried_observation_count, 0);
    assert.equal(driftSummary.stale_model_count, 1);
    const driftModel = ((driftOutput.model_page as { items: readonly { model_id: string; affected: boolean; checkpoint_stale: boolean; obligations: readonly { id: string; status: string }[] }[] }).items)
      .find((item) => item.model_id === model.model_id)!;
    assert.equal(driftModel.affected, true);
    assert.equal(driftModel.checkpoint_stale, true);
    assert.equal(driftModel.obligations.find((item) => item.id === "controls")?.status, "NOT_VISITED");
  } finally {
    await client.close();
    await server.close();
  }
});
