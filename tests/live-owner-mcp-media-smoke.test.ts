import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import test from "node:test";

const scriptPath = resolve("scripts/live-owner-mcp-media-smoke.mjs");

test("live MCP media smoke accepts only exact confirmed image/video profiles", async () => {
  const module = await import(pathToFileURL(scriptPath).href) as {
    parseLiveOwnerMcpMediaSmokeArgs(argv: readonly string[]): { kind: "image" | "video"; modelId: string } | null;
  };
  const confirm = "--confirm-live-owner-mcp-media-smoke";
  assert.deepEqual(module.parseLiveOwnerMcpMediaSmokeArgs([
    confirm, "--kind", "image", "--model", "banana-2.1", "--handoff-json"
  ]), { kind: "image", modelId: "banana-2.1" });
  assert.deepEqual(module.parseLiveOwnerMcpMediaSmokeArgs([
    confirm, "--kind", "video", "--model", "seedance_pro-fast", "--handoff-json"
  ]), { kind: "video", modelId: "seedance_pro-fast" });
  for (const argv of [
    [],
    ["--kind", "image", "--model", "banana-2.1", "--handoff-json"],
    ["--confirm-live-owner-mcp-media-smoke", "--kind", "image", "--model", "banana", "--handoff-json"],
    [confirm, "--kind", "video", "--model", "banana-2.1", "--handoff-json"],
    [confirm, "--kind", "image", "--model", "seedance_pro-fast", "--handoff-json"],
    [confirm, "--kind", "audio", "--model", "banana-2.1", "--handoff-json"],
    [confirm, "--kind", "image", "--model", "banana-2.1"],
    [confirm, "--kind", "image", "--model", "banana-2.1", "--handoff-json", "extra"]
  ]) {
    assert.equal(module.parseLiveOwnerMcpMediaSmokeArgs(argv), null, JSON.stringify(argv));
  }
});

test("CLI guard refuses without the exact confirmation before any MCP setup", () => {
  const child = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 5_000,
    env: { PATH: process.env.PATH ?? "" }
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 2);
  assert.equal(child.stdout, "");
  assert.match(child.stderr, /Refusing/u);
});

test("active harness requires account-status MCP tool and calls begin/check/status/generate/unlink in order", async () => {
  const module = await import(pathToFileURL(scriptPath).href) as {
    parseLiveOwnerMcpMediaSmokeArgs(argv: readonly string[]): { kind: "image" | "video"; modelId: string } | null;
    runLiveOwnerMcpMediaSmoke(
      config: { kind: "image" | "video"; modelId: string },
      io: { stdin: PassThrough; stdout: { write(value: string): void } },
      dependencies: Record<string, unknown>
    ): Promise<{ status: string; artifact_count: number; mime_types: string[]; local_cleanup_status: "REVOKED" | "UNKNOWN" | "NOT_ATTEMPTED" }>;
    buildSafeLiveOwnerMcpMediaSmokeReport(result: Record<string, unknown>): Record<string, unknown>;
  };
  const imageConfig = module.parseLiveOwnerMcpMediaSmokeArgs([
    "--confirm-live-owner-mcp-media-smoke", "--kind", "image", "--model", "banana-2.1", "--handoff-json"
  ]);
  const videoConfig = module.parseLiveOwnerMcpMediaSmokeArgs([
    "--confirm-live-owner-mcp-media-smoke", "--kind", "video", "--model", "seedance_pro-fast", "--handoff-json"
  ]);
  assert.ok(imageConfig);
  assert.ok(videoConfig);
  const events: string[] = [];
  const toolCalls: string[] = [];
  const generationArguments: Array<Record<string, unknown>> = [];
  const stdin = new PassThrough();
  const stdoutLines: string[] = [];
  const runtimeOptions: Record<string, unknown>[] = [];
  const serverOptions: Record<string, unknown>[] = [];
  let unlinkBehavior: "revoked" | "error" | "throw" = "revoked";
  let generationBehavior: "success" | "failure" = "success";
  let beginBehavior: "success" | "failure" = "success";
  let unlinkCalls = 0;
  let tools = [
    "syntx_begin_login", "syntx_check_login", "syntx_unlink",
    "syntx_get_account_status", "syntx_owner_generate_image", "syntx_owner_generate_video"
  ];
  class FakeClient {
    async connect() { events.push("client_connect"); }
    async listTools() { events.push("list_tools"); return { tools: tools.map((name) => ({ name })) }; }
    async callTool(request: { name: string; arguments?: Record<string, unknown> }) {
      toolCalls.push(request.name);
      events.push(`tool:${request.name}`);
      if (request.name === "syntx_begin_login" && beginBehavior === "failure") {
        return { isError: true, content: [{ type: "text", text: "safe auth failure" }] };
      }
      if (request.name === "syntx_begin_login") return {
        structuredContent: { attempt_id: "link_fake_attempt_000000000000001" },
        content: [{ type: "resource_link", uri: "https://t.me/syntxaibot?start=auth_00000000-0000-4000-8000-000000000000" }]
      };
      if (request.name === "syntx_check_login") return { structuredContent: { linked: true, status: "LINKED" }, content: [] };
      if (request.name === "syntx_get_account_status") return {
        structuredContent: { subscription: { active: true, plan_type: "UltraElite" }, balance: { available: "123" } }, content: []
      };
      if (request.name === "syntx_owner_generate_image") {
        generationArguments.push(request.arguments ?? {});
        if (generationBehavior === "failure") return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: { code: "GENERATION_FAILED", message: "safe failure" } }) }]
        };
        return { structuredContent: { images: [{ url: "https://cdn.example.test/private-result.jpg", mime_type: "image/jpeg" }] }, content: [] };
      }
      if (request.name === "syntx_owner_generate_video") {
        generationArguments.push(request.arguments ?? {});
        if (generationBehavior === "failure") return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify({ error: { code: "GENERATION_FAILED", message: "safe failure" } }) }]
        };
        return { structuredContent: { videos: [{ url: "https://cdn.example.test/private-result.mp4", mime_type: "video/mp4" }] }, content: [] };
      }
      if (request.name === "syntx_unlink") {
        unlinkCalls += 1;
        if (unlinkBehavior === "throw") throw new Error("safe unlink failure");
        if (unlinkBehavior === "error") return { isError: true, content: [{ type: "text", text: "safe unlink failure" }] };
        return { structuredContent: { status: "REVOKED" }, content: [] };
      }
      throw new Error("unexpected MCP tool call");
    }
    async close() { events.push("client_close"); }
  }
  const io = {
    stdin,
    stdout: {
      write(value: string) {
        stdoutLines.push(value);
        if (JSON.parse(value).event === "BEGIN") setTimeout(() => stdin.write('{"action":"handoff_sent"}\n'), 0);
      }
    }
  };
  const dependencies = {
    Client: FakeClient,
    InMemoryTransport: { createLinkedPair: () => [{}, {}] },
    createObservedOwnerRuntime(options: Record<string, unknown>) {
      runtimeOptions.push(options);
      return { application: {}, serverOptions: { accountStatus: { resolveClient: () => ({}) } } };
    },
    createMcpServer(_application: unknown, options: Record<string, unknown>) {
      serverOptions.push(options);
      return {
        async connect() { events.push("server_connect"); },
        async close() { events.push("server_close"); }
      };
    }
  };
  const result = await module.runLiveOwnerMcpMediaSmoke(imageConfig, io, dependencies);
  assert.equal(runtimeOptions[0]?.accountStatusEnabled, true);
  assert.equal(runtimeOptions[0]?.generateImageEnabled, true);
  assert.equal(runtimeOptions[0]?.generateVideoEnabled, false);
  assert.ok(serverOptions[0]?.accountStatus);
  assert.deepEqual(events, [
    "server_connect", "client_connect", "list_tools",
    "tool:syntx_begin_login", "tool:syntx_check_login", "tool:syntx_get_account_status",
    "tool:syntx_owner_generate_image", "tool:syntx_unlink", "client_close", "server_close"
  ]);
  assert.deepEqual(toolCalls, [
    "syntx_begin_login", "syntx_check_login", "syntx_get_account_status",
    "syntx_owner_generate_image", "syntx_unlink"
  ]);
  const beginEvent = JSON.parse(stdoutLines[0] ?? "null");
  assert.equal(beginEvent.event, "BEGIN");
  assert.equal(beginEvent.handoff_uri, "https://t.me/syntxaibot?start=auth_00000000-0000-4000-8000-000000000000");
  assert.equal(generationArguments[0]?.model_id, "banana-2.1");
  assert.equal(generationArguments[0]?.copies, 1);
  assert.equal(generationArguments[0]?.aspect_ratio, "1:1");
  assert.equal(result.status, "PASS");
  assert.equal(result.local_cleanup_status, "REVOKED");
  assert.equal(result.artifact_count, 1);
  assert.deepEqual(result.mime_types, ["image/jpeg"]);
  assert.deepEqual(module.buildSafeLiveOwnerMcpMediaSmokeReport(result), {
    status: "PASS", artifact_count: 1, mime_types: ["image/jpeg"], local_cleanup_status: "REVOKED"
  });
  const stdout = stdoutLines.join("");
  assert.equal(stdout.includes("private-result.jpg"), false);
  assert.equal(stdout.includes("UltraElite"), false);
  assert.equal(stdout.includes("123"), false);

  events.length = 0;
  toolCalls.length = 0;
  generationArguments.length = 0;
  stdoutLines.length = 0;
  const videoStdin = new PassThrough();
  const videoResult = await module.runLiveOwnerMcpMediaSmoke(videoConfig, {
    stdin: videoStdin,
    stdout: {
      write(value: string) {
        stdoutLines.push(value);
        if (JSON.parse(value).event === "BEGIN") setTimeout(() => videoStdin.write('{"action":"handoff_sent"}\n'), 0);
      }
    }
  }, dependencies);
  assert.equal(runtimeOptions[1]?.accountStatusEnabled, true);
  assert.equal(runtimeOptions[1]?.generateImageEnabled, false);
  assert.equal(runtimeOptions[1]?.generateVideoEnabled, true);
  assert.deepEqual(events, [
    "server_connect", "client_connect", "list_tools",
    "tool:syntx_begin_login", "tool:syntx_check_login", "tool:syntx_get_account_status",
    "tool:syntx_owner_generate_video", "tool:syntx_unlink", "client_close", "server_close"
  ]);
  assert.deepEqual(toolCalls, [
    "syntx_begin_login", "syntx_check_login", "syntx_get_account_status",
    "syntx_owner_generate_video", "syntx_unlink"
  ]);
  assert.equal(generationArguments[0]?.model_id, "seedance_pro-fast");
  assert.equal(generationArguments[0]?.copies, 1);
  assert.equal(videoResult.status, "PASS");
  assert.equal(videoResult.local_cleanup_status, "REVOKED");
  assert.equal(videoResult.artifact_count, 1);
  assert.deepEqual(videoResult.mime_types, ["video/mp4"]);
  assert.equal(stdoutLines.join("").includes("private-result.mp4"), false);

  unlinkBehavior = "error";
  toolCalls.length = 0;
  stdoutLines.length = 0;
  const unknownCleanupStdin = new PassThrough();
  const unknownCleanupResult = await module.runLiveOwnerMcpMediaSmoke(imageConfig, {
    stdin: unknownCleanupStdin,
    stdout: { write(value: string) { stdoutLines.push(value); if (JSON.parse(value).event === "BEGIN") setTimeout(() => unknownCleanupStdin.write('{"action":"handoff_sent"}\n'), 0); } }
  }, dependencies);
  assert.equal(unknownCleanupResult.status, "PASS");
  assert.equal(unknownCleanupResult.local_cleanup_status, "UNKNOWN");
  assert.deepEqual(module.buildSafeLiveOwnerMcpMediaSmokeReport(unknownCleanupResult), {
    status: "PASS", artifact_count: 1, mime_types: ["image/jpeg"], local_cleanup_status: "UNKNOWN"
  });

  unlinkBehavior = "throw";
  generationBehavior = "failure";
  toolCalls.length = 0;
  stdoutLines.length = 0;
  const failedGenerationStdin = new PassThrough();
  const failedGenerationResult = await module.runLiveOwnerMcpMediaSmoke(videoConfig, {
    stdin: failedGenerationStdin,
    stdout: { write(value: string) { stdoutLines.push(value); if (JSON.parse(value).event === "BEGIN") setTimeout(() => failedGenerationStdin.write('{"action":"handoff_sent"}\n'), 0); } }
  }, dependencies);
  assert.equal(failedGenerationResult.status, "GENERATION_FAILED");
  assert.equal(failedGenerationResult.local_cleanup_status, "UNKNOWN", "cleanup failure must not mask generation failure");
  assert.deepEqual(module.buildSafeLiveOwnerMcpMediaSmokeReport(failedGenerationResult), {
    status: "GENERATION_FAILED", artifact_count: 0, mime_types: [], local_cleanup_status: "UNKNOWN"
  });

  beginBehavior = "failure";
  generationBehavior = "success";
  toolCalls.length = 0;
  unlinkCalls = 0;
  stdoutLines.length = 0;
  const authFailureStdin = new PassThrough();
  const authFailureResult = await module.runLiveOwnerMcpMediaSmoke(imageConfig, {
    stdin: authFailureStdin,
    stdout: { write(value: string) { stdoutLines.push(value); } }
  }, dependencies);
  assert.equal(authFailureResult.status, "HANDOFF_FAILED");
  assert.equal(authFailureResult.local_cleanup_status, "NOT_ATTEMPTED");
  assert.deepEqual(module.buildSafeLiveOwnerMcpMediaSmokeReport(authFailureResult), {
    status: "HANDOFF_FAILED", artifact_count: 0, mime_types: [], local_cleanup_status: "NOT_ATTEMPTED"
  });
  assert.equal(unlinkCalls, 0);

  toolCalls.length = 0;
  tools = tools.filter((name) => name !== "syntx_get_account_status");
  const missingToolStdin = new PassThrough();
  const missingToolOutput: string[] = [];
  const missingToolResult = await module.runLiveOwnerMcpMediaSmoke(imageConfig, {
    stdin: missingToolStdin,
    stdout: { write(value: string) { missingToolOutput.push(value); } }
  }, dependencies);
  assert.equal(missingToolResult.status, "MCP_TOOLS_MISSING");
  assert.deepEqual(missingToolOutput, [], "the handoff must not start before the account-status tool is confirmed registered");
  assert.equal(toolCalls.length, 0, "no auth or generation tool may run after the required tool is missing");
});
