import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

const MODEL_ID = "wan_25_i2v_preview" as const;
const TOOL_NAMES = [
  "syntx_owner_get_wan25_i2v_preview_parameters",
  "syntx_owner_upload_wan25_i2v_preview_image",
  "syntx_owner_generate_wan25_i2v_preview_video",
  "syntx_owner_reconcile_wan25_i2v_preview_video",
  "syntx_owner_list_wan25_i2v_preview_recoveries",
  "syntx_owner_get_wan25_i2v_preview_result_page"
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function dataOf(result: unknown): Record<string, unknown> {
  if (!isRecord(result)) throw new Error("STDIO_TOOL_RESULT_INVALID");
  if (isRecord(result.structuredContent)) return result.structuredContent;
  if (!Array.isArray(result.content)) throw new Error("STDIO_TOOL_CONTENT_INVALID");
  const textItem = result.content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
  if (!isRecord(textItem) || typeof textItem.text !== "string") throw new Error("STDIO_TOOL_TEXT_CONTENT_MISSING");
  const value: unknown = JSON.parse(textItem.text);
  if (!isRecord(value)) throw new Error("STDIO_TOOL_PAYLOAD_INVALID");
  return value;
}
function toolData(result: unknown): Record<string, unknown> {
  if (!isRecord(result) || result.isError === true) throw new Error("STDIO_TOOL_CALL_FAILED");
  return dataOf(result);
}
function png384(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20);
  let crc = 0xffff_ffff;
  for (const byte of bytes.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffff_ffff) >>> 0, 29);
  return bytes;
}

test("stock MCP SDK drives the real owner-stdio WAN25 image-only flow through synthetic fetch", { timeout: 60_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "syntx-wan25-stdio-1691-"));
  const statePath = join(directory, "route-counts.json");
  const entrypoint = fileURLToPath(new URL("../src/transports/stdio-owner.js", import.meta.url));
  const preload = fileURLToPath(new URL("./wan25-stdio-fetch-preload-1691.js", import.meta.url));
  const env = {
    PATH: process.env.PATH ?? "",
    SYNTX_OWNER_WAN25_I2V_PREVIEW: "1",
    SYNTX_WAN25_1691_STATE_FILE: statePath
  };
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", preload, entrypoint],
    cwd: process.cwd(), env, stderr: "pipe" });
  const client = new Client({ name: "wan25-owner-stdio-1691", version: "1.0.0" }, { capabilities: {} });
  const imageBytes = png384();
  try {
    await client.connect(transport as unknown as Transport);
    const tools = (await client.listTools()).tools;
    const names = tools.map(({ name }) => name);
    assert.deepEqual(names.filter((name) => (TOOL_NAMES as readonly string[]).includes(name)).sort(), [...TOOL_NAMES].sort());
    assert.ok(names.includes("syntx_begin_login") && names.includes("syntx_check_login"));

    const begin = toolData(await client.callTool({ name: "syntx_begin_login", arguments: {} }));
    assert.equal(begin.status, "HANDOFF_ISSUED");
    assert.equal(typeof begin.attempt_id, "string");
    const attemptId = begin.attempt_id as string;
    const checked = toolData(await client.callTool({ name: "syntx_check_login", arguments: { attempt_id: attemptId } }));
    assert.equal(checked.status, "LINKED");
    assert.equal(checked.linked, true);

    const parameters = toolData(await client.callTool({ name: TOOL_NAMES[0], arguments: {} }));
    assert.equal(parameters.model_id, MODEL_ID);
    assert.equal(parameters.public_catalog_version, "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json");
    assert.equal(parameters.native_audio, false);
    assert.equal(parameters.audio_integration_status, "NATIVE_AUDIO_CONTEXT_NOT_AVAILABLE");
    assert.equal(parameters.input_audio_status, "OPTIONAL_UI_NOT_JOINED_TO_NATIVE_CONTEXT");
    assert.equal(parameters.provider_acceptance, "UNPROVEN");
    const uploaded = toolData(await client.callTool({ name: TOOL_NAMES[1], arguments: {
      link_attempt_id: attemptId, model_id: MODEL_ID, filename: "stdio-preview.png", mime_type: "image/png",
      content_base64: imageBytes.toString("base64")
    } }));
    assert.equal(uploaded.status, "uploaded");
    assert.equal(typeof uploaded.image_handle, "string");
    assert.equal(JSON.stringify(uploaded).includes("r2.syntx.ai"), false);

    const generated = toolData(await client.callTool({ name: TOOL_NAMES[2], arguments: {
      link_attempt_id: attemptId, model_id: MODEL_ID, image_handle: uploaded.image_handle, audio_handle: null,
      prompt: "A quiet preview scene under soft morning light.", resolution: "720P", aspect_ratio: "16:9",
      video_duration: 5, prompt_extend: false, seed: null
    } }));
    assert.equal(generated.status, "completed");
    assert.equal(generated.model_id, MODEL_ID);
    assert.equal(generated.provider_terminal_status, "UNPROVEN");
    assert.equal(generated.backend_acceptance, "UNPROVEN");
    assert.equal(generated.cost_cap_enforced, false);
    assert.equal(typeof generated.recovery_id, "string");
    const page = toolData(await client.callTool({ name: TOOL_NAMES[5], arguments: {
      link_attempt_id: attemptId, recovery_id: generated.recovery_id, offset: 0
    } }));
    assert.equal(Array.isArray(page.artifacts), true);
    assert.equal((page.artifacts as unknown[]).length, 1);
    assert.equal(page.provider_terminal_status, "UNPROVEN");
  } finally {
    imageBytes.fill(0);
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
  try {
    const counts = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
    assert.equal(counts.auth_start, 1);
    assert.equal(counts.auth_token, 1);
    assert.ok(typeof counts.balance === "number" && counts.balance >= 2);
    assert.ok(typeof counts.subscription === "number" && counts.subscription >= 2);
    assert.ok(typeof counts.quote === "number" && counts.quote >= 2);
    assert.equal(counts.upload, 1);
    assert.equal(counts.chat_create, 1);
    assert.equal(counts.generation, 1);
    assert.ok(typeof counts.history === "number" && counts.history >= 1);
    assert.ok(typeof counts.result === "number" && counts.result >= 1);
    assert.equal(counts.denied, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
