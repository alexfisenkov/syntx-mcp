import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const scriptPath = resolve("scripts/live-owner-contract-media-smoke.mjs");
const confirmation = "--confirm-live-owner-contract-media-smoke";

async function loadSmokeModule() {
  return await import(pathToFileURL(scriptPath).href) as {
    parseLiveOwnerContractMediaSmokeArgs(argv: readonly string[]): {
      kind: "image" | "video"; modelId: string; operationId: string;
      schemaVersion: "1.0.0" | "2.0.0"; registryVersion: string; variantId?: string;
    } | null;
    runLiveOwnerContractMediaSmoke(
      config: unknown,
      io: { stdin: PassThrough; stdout: { write(value: string): void } },
      dependencies?: Record<string, unknown>,
      runtimeLoader?: () => Promise<Record<string, unknown>>
    ): Promise<Record<string, unknown>>;
    buildSafeLiveOwnerContractMediaSmokeReport(result: Record<string, unknown>): Record<string, unknown>;
  };
}

function createFakeHarness(options: {
  generation?: "success" | "throw"; unlink?: "revoked" | "error";
  schema?: "wrongVariant"; validation?: "invalid";
} = {}) {
  const events: string[] = [];
  const tools = [
    "syntx_begin_login", "syntx_check_login", "syntx_unlink", "syntx_get_account_status",
    "syntx_get_generation_schema", "syntx_validate_generation", "syntx_owner_generate_media"
  ];
  const toolCalls: Array<{ name: string; arguments: Record<string, unknown>; timeout: number | undefined }> = [];
  const transportOptions: Record<string, unknown>[] = [];
  const generationRequests: Array<Record<string, unknown>> = [];
  const stdin = new PassThrough();
  const stdoutLines: string[] = [];
  const dependencies = {
    Client: class FakeClient {
      async connect(transport: { start(): Promise<void> }) { await transport.start(); events.push("client_connect"); }
      async listTools(_params?: unknown, options?: { timeout?: number }) {
        events.push("list_tools");
        assert.ok((options?.timeout ?? 0) <= 5_500);
        return { tools: tools.map((name) => ({ name })) };
      }
      async callTool(request: { name: string; arguments?: Record<string, unknown> }, _schema?: unknown, requestOptions?: { timeout?: number }) {
        const args = request.arguments ?? {};
        events.push(`tool:${request.name}`);
        toolCalls.push({ name: request.name, arguments: args, timeout: requestOptions?.timeout });
        if (request.name === "syntx_begin_login") return {
          structuredContent: { attempt_id: "link_fake_attempt_000000000000001" },
          content: [{ type: "resource_link", uri: "https://t.me/syntxaibot?start=auth_00000000-0000-4000-8000-000000000000" }]
        };
        if (request.name === "syntx_check_login") return { structuredContent: { linked: true, status: "LINKED" }, content: [] };
        if (request.name === "syntx_get_account_status") return {
          structuredContent: { subscription: { active: true, plan_type: "OwnerTestPlan" }, balance: { available: "do-not-log" } }, content: []
        };
        if (request.name === "syntx_get_generation_schema") return {
          structuredContent: {
            model_id: args.model_id, operation_id: args.operation_id,
            schema_status: "live_verified", runtime_usable: false,
            ...(args.variant_id === undefined ? {} : {
              contract_schema_version: "2.0.0", variant_id: options.schema === "wrongVariant" ? "wrong-fixed-variant" : args.variant_id,
              parameter_schema_v2: { type: "object", additional_properties: false, required: ["prompt"], properties: { prompt: { type: "string" } }, conditions: [], conditional_enums: [] }
            })
          }, content: []
        };
        if (request.name === "syntx_validate_generation") return {
          structuredContent: {
            model_id: args.model_id, operation_id: args.operation_id,
            validation_status: options.validation === "invalid" ? "INVALID" : "VALID", parameters_redacted: true,
            ...(args.variant_id === undefined ? {} : { contract_schema_version: "2.0.0", variant_id: args.variant_id })
          }, content: []
        };
        if (request.name === "syntx_owner_generate_media") {
          generationRequests.push(args);
          if (options.generation === "throw") throw new Error("private synthetic transport failure");
          return { structuredContent: {
            model_id: args.model_id,
            operation_id: args.operation_id,
            artifacts: [{ mime_type: args.operation_id === "generate-image" ? "image/jpeg" : "video/mp4", url: "https://private.example.invalid/result" }]
          }, content: [] };
        }
        if (request.name === "syntx_unlink") return options.unlink === "error"
          ? { isError: true, content: [{ type: "text", text: "private cleanup failure" }] }
          : { structuredContent: { status: "REVOKED" }, content: [] };
        throw new Error("unexpected fake tool call");
      }
      async close() { events.push("client_close"); }
    },
    StdioClientTransport: class FakeStdioClientTransport {
      constructor(options: Record<string, unknown>) { transportOptions.push(options); }
      async start() { events.push("stdio_child_start"); }
      async close() { events.push("stdio_child_close"); }
    },
    wait: async () => undefined
  };
  const io = {
    stdin,
    stdout: {
      write(value: string) {
        stdoutLines.push(value);
        if (JSON.parse(value).event === "BEGIN") setTimeout(() => stdin.write('{"action":"handoff_sent"}\n'), 0);
      }
    }
  };
  return { dependencies, io, events, toolCalls, transportOptions, generationRequests, stdoutLines };
}

test("CLI and config guards accept only the exact confirmation and fixed image/video profiles", async () => {
  const module = await loadSmokeModule();
  const image = module.parseLiveOwnerContractMediaSmokeArgs([confirmation, "--kind", "image", "--handoff-json"]);
  const video = module.parseLiveOwnerContractMediaSmokeArgs([confirmation, "--kind", "video", "--handoff-json"]);
  assert.ok(image); assert.equal(image.kind, "image"); assert.equal(image.modelId, "banana-2.1");
  assert.equal(image.schemaVersion, "1.0.0");
  assert.ok(video); assert.equal(video.kind, "video"); assert.equal(video.modelId, "seedance_pro-fast");
  assert.equal(video.schemaVersion, "1.0.0");
  const imageV2 = module.parseLiveOwnerContractMediaSmokeArgs([
    confirmation, "--kind", "image", "--schema-version", "2.0.0", "--handoff-json"
  ]);
  const videoV2 = module.parseLiveOwnerContractMediaSmokeArgs([
    confirmation, "--kind", "video", "--schema-version", "2.0.0", "--handoff-json"
  ]);
  assert.ok(imageV2); assert.equal(imageV2.schemaVersion, "2.0.0");
  assert.equal(imageV2.registryVersion, "sha256-e3a109c3b52f4e1a46b37d5a6f54f311f7f12f99b36da667f85258d928dabffe.json");
  assert.equal(imageV2.variantId, "banana21-image-1k-minimal-square");
  assert.ok(videoV2); assert.equal(videoV2.schemaVersion, "2.0.0");
  assert.equal(videoV2.variantId, "seedance-pro-fast-video-720p-mini-16x9-5s-audio");
  for (const argv of [
    [], ["--kind", "image", "--handoff-json"], [confirmation, "--kind", "audio", "--handoff-json"],
    [confirmation, "--kind", "image", "--handoff-json", "extra"], [confirmation, "--kind", "video"],
    [confirmation, "--kind", "image", "--schema-version", "1.1.0", "--handoff-json"],
    [confirmation, "--kind", "image", "--schema-version", "2.0.0"],
    [confirmation, "--kind", "image", "--schema-version", "2.0.0", "--handoff-json", "extra"]
  ]) assert.equal(module.parseLiveOwnerContractMediaSmokeArgs(argv), null);

  const child = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(), encoding: "utf8", timeout: 5_000, env: { PATH: process.env.PATH ?? "" }
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 2);
  assert.equal(child.stdout, "");
  assert.match(child.stderr, /Refusing/u);
});

test("unvalidated config refuses before runtime loader or stdio-child setup", async () => {
  const module = await loadSmokeModule();
  let loaderCalls = 0;
  const io = { stdin: new PassThrough(), stdout: { write(_value: string) {} } };
  await assert.rejects(module.runLiveOwnerContractMediaSmoke({ kind: "image", modelId: "banana-2.1" }, io, undefined, async () => {
    loaderCalls += 1;
    throw new Error("must not load runtime");
  }));
  assert.equal(loaderCalls, 0);
});

test("stdio smoke checks entitlement/schema, dispatches exactly one generic request, redacts results and closes child", async () => {
  const module = await loadSmokeModule();
  const config = module.parseLiveOwnerContractMediaSmokeArgs([confirmation, "--kind", "image", "--handoff-json"]);
  assert.ok(config);
  const harness = createFakeHarness();
  const result = await module.runLiveOwnerContractMediaSmoke(config, harness.io, harness.dependencies);

  assert.deepEqual(harness.events, [
    "stdio_child_start", "client_connect", "list_tools", "tool:syntx_begin_login", "tool:syntx_check_login",
    "tool:syntx_get_account_status", "tool:syntx_get_generation_schema", "tool:syntx_validate_generation",
    "tool:syntx_owner_generate_media", "tool:syntx_unlink", "client_close", "stdio_child_close"
  ]);
  assert.equal(harness.generationRequests.length, 1);
  const request = harness.generationRequests[0]!;
  assert.equal(request.link_attempt_id, "link_fake_attempt_000000000000001");
  assert.equal(request.model_id, "banana-2.1");
  assert.equal(request.operation_id, "generate-image");
  assert.deepEqual(request.parameters, {
    prompt: "A minimal geometric still life of colored paper circles on a warm neutral tabletop, no text or people.",
    file_urls: []
  });
  const generationCall = harness.toolCalls.find((call) => call.name === "syntx_owner_generate_media");
  assert.equal(generationCall?.timeout, 190_000);
  const env = harness.transportOptions[0]?.env as Record<string, string>;
  assert.deepEqual(env, {
    SYNTX_OWNER_ACCOUNT_STATUS: "1",
    SYNTX_OWNER_GENERATE_CONTRACT_MEDIA: "1",
    SYNTX_GENERATION_CONTRACT_VERSION: "sha256-0a82b91685746f4aeec1b0ba4e24fccdc21532d4e3feac85969e55302b463d45.json"
  });
  assert.equal(harness.transportOptions[0]?.command, process.execPath);
  assert.deepEqual(harness.transportOptions[0]?.args, [resolve("dist/src/transports/stdio-owner.js")]);
  assert.equal(result.status, "PASS");
  assert.equal(result.artifact_count, 1);
  assert.deepEqual(result.mime_types, ["image/jpeg"]);
  assert.equal(result.local_cleanup_status, "REVOKED");
  const report = module.buildSafeLiveOwnerContractMediaSmokeReport(result);
  assert.deepEqual(report, { status: "PASS", artifact_count: 1, mime_types: ["image/jpeg"], local_cleanup_status: "REVOKED" });
  assert.equal(JSON.stringify(report).includes("private.example"), false);
  assert.equal(JSON.stringify(report).includes("OwnerTestPlan"), false);
  assert.equal(JSON.stringify(report).includes("geometric"), false);
  assert.equal(JSON.stringify(report).includes("link_fake_attempt"), false);
  assert.equal(JSON.stringify(report).includes("auth_00000000"), false);
});

test("video uses the exact fixed contract parameters and its longer single-call timeout", async () => {
  const module = await loadSmokeModule();
  const config = module.parseLiveOwnerContractMediaSmokeArgs([confirmation, "--kind", "video", "--handoff-json"]);
  assert.ok(config);
  const harness = createFakeHarness();
  const result = await module.runLiveOwnerContractMediaSmoke(config, harness.io, harness.dependencies);
  const request = harness.generationRequests[0]!;
  assert.equal(harness.generationRequests.length, 1);
  assert.equal(request.model_id, "seedance_pro-fast");
  assert.equal(request.operation_id, "generate-video");
  assert.deepEqual(request.parameters, {
    prompt: "A five-second geometric animation: three colored cubes slide slowly across a plain neutral background, no text or people."
  });
  assert.equal(harness.toolCalls.find((call) => call.name === "syntx_owner_generate_media")?.timeout, 420_000);
  assert.equal(result.status, "PASS");
  assert.equal(result.artifact_count, 1);
  assert.deepEqual(result.mime_types, ["video/mp4"]);
});

test("explicit v2 CLI selects only its pinned registry and exact variant through schema, validation, and one dispatch", async () => {
  const module = await loadSmokeModule();
  const config = module.parseLiveOwnerContractMediaSmokeArgs([
    confirmation, "--kind", "video", "--schema-version", "2.0.0", "--handoff-json"
  ]);
  assert.ok(config);
  const harness = createFakeHarness();
  const result = await module.runLiveOwnerContractMediaSmoke(config, harness.io, harness.dependencies);

  assert.equal(result.status, "PASS");
  assert.deepEqual(harness.toolCalls.filter((call) => call.name === "syntx_get_generation_schema").map((call) => call.arguments), [
    { model_id: "seedance_pro-fast", operation_id: "generate-video", variant_id: "seedance-pro-fast-video-720p-mini-16x9-5s-audio" }
  ]);
  assert.deepEqual(harness.toolCalls.filter((call) => call.name === "syntx_validate_generation").map((call) => call.arguments), [
    {
      model_id: "seedance_pro-fast", operation_id: "generate-video",
      variant_id: "seedance-pro-fast-video-720p-mini-16x9-5s-audio",
      parameters: {
        prompt: "A five-second geometric animation: three colored cubes slide slowly across a plain neutral background, no text or people."
      }
    }
  ]);
  assert.deepEqual(harness.generationRequests, [{
    link_attempt_id: "link_fake_attempt_000000000000001",
    model_id: "seedance_pro-fast",
    operation_id: "generate-video",
    variant_id: "seedance-pro-fast-video-720p-mini-16x9-5s-audio",
    parameters: {
      prompt: "A five-second geometric animation: three colored cubes slide slowly across a plain neutral background, no text or people."
    }
  }]);
  const env = harness.transportOptions[0]?.env as Record<string, string>;
  assert.equal(env.SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION, "2.0.0");
  assert.equal(env.SYNTX_GENERATION_CONTRACT_VERSION, "sha256-e3a109c3b52f4e1a46b37d5a6f54f311f7f12f99b36da667f85258d928dabffe.json");
  assert.equal(harness.toolCalls.filter((call) => call.name === "syntx_owner_generate_media").length, 1);
  assert.equal(result.local_cleanup_status, "REVOKED");
});

test("v2 image uses its exact variant and fixed input, then dispatches once with cleanup", async () => {
  const module = await loadSmokeModule();
  const config = module.parseLiveOwnerContractMediaSmokeArgs([
    confirmation, "--kind", "image", "--schema-version", "2.0.0", "--handoff-json"
  ]);
  assert.ok(config);
  const harness = createFakeHarness();
  const result = await module.runLiveOwnerContractMediaSmoke(config, harness.io, harness.dependencies);
  assert.equal(result.status, "PASS");
  assert.equal(result.local_cleanup_status, "REVOKED");
  assert.equal(harness.generationRequests.length, 1);
  assert.deepEqual(harness.generationRequests[0], {
    link_attempt_id: "link_fake_attempt_000000000000001",
    model_id: "banana-2.1",
    operation_id: "generate-image",
    variant_id: "banana21-image-1k-minimal-square",
    parameters: {
      prompt: "A minimal geometric still life of colored paper circles on a warm neutral tabletop, no text or people.",
      file_urls: []
    }
  });
  assert.deepEqual(result.mime_types, ["image/jpeg"]);
});

test("v2 smoke stops before validation and dispatch when the exact variant is not returned", async () => {
  const module = await loadSmokeModule();
  const config = module.parseLiveOwnerContractMediaSmokeArgs([
    confirmation, "--kind", "video", "--schema-version", "2.0.0", "--handoff-json"
  ]);
  assert.ok(config);
  const harness = createFakeHarness({ schema: "wrongVariant" });
  const result = await module.runLiveOwnerContractMediaSmoke(config, harness.io, harness.dependencies);
  assert.equal(result.status, "SCHEMA_NOT_LIVE_VERIFIED");
  assert.equal(harness.toolCalls.some((call) => call.name === "syntx_validate_generation"), false);
  assert.equal(harness.generationRequests.length, 0);
  assert.equal(result.local_cleanup_status, "REVOKED");
});

test("invalid local v2 validation prevents paid dispatch and still unlinks", async () => {
  const module = await loadSmokeModule();
  const config = module.parseLiveOwnerContractMediaSmokeArgs([
    confirmation, "--kind", "image", "--schema-version", "2.0.0", "--handoff-json"
  ]);
  assert.ok(config);
  const harness = createFakeHarness({ validation: "invalid" });
  const result = await module.runLiveOwnerContractMediaSmoke(config, harness.io, harness.dependencies);
  assert.equal(result.status, "LOCAL_VALIDATION_FAILED");
  assert.equal(harness.generationRequests.length, 0);
  assert.equal(harness.toolCalls.filter((call) => call.name === "syntx_unlink").length, 1);
  assert.equal(result.local_cleanup_status, "REVOKED");
});

test("unknown generation outcome is never retried and cleanup status is explicit", async () => {
  const module = await loadSmokeModule();
  const config = module.parseLiveOwnerContractMediaSmokeArgs([confirmation, "--kind", "video", "--handoff-json"]);
  assert.ok(config);
  const harness = createFakeHarness({ generation: "throw", unlink: "error" });
  const result = await module.runLiveOwnerContractMediaSmoke(config, harness.io, harness.dependencies);
  assert.equal(harness.generationRequests.length, 1);
  assert.equal(harness.toolCalls.filter((call) => call.name === "syntx_owner_generate_media").length, 1);
  assert.equal(harness.toolCalls.filter((call) => call.name === "syntx_unlink").length, 1);
  assert.equal(result.status, "OUTCOME_UNKNOWN");
  assert.equal(result.no_retry, true);
  assert.equal(result.local_cleanup_status, "UNKNOWN");
  assert.equal(harness.events.at(-2), "client_close");
  assert.equal(harness.events.at(-1), "stdio_child_close");
});
