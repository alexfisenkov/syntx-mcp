#!/usr/bin/env node
// Native OS acceptance, deliberately separate from provider-account acceptance.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMediaMcpConfig } from "./print-media-mcp-config.mjs";
import { createObservedOwnerRuntime } from "../dist/src/runtime/observed-owner-runtime.js";
import { createMcpServer } from "../dist/src/mcp/server.js";

const preflight = process.argv.slice(2).join(" ") === "--allow-non-windows-preflight";
assert.ok(process.argv.length === 2 || preflight, "unknown acceptance argument");
assert.ok(process.platform === "win32" || preflight, "actual Windows is required; local preflight must be explicit");
const root = fileURLToPath(new URL("..", import.meta.url));
const ffmpeg = realpathSync(process.env.SYNTX_MEDIA_FFMPEG_PATH ?? "");
const ffprobe = realpathSync(process.env.SYNTX_MEDIA_FFPROBE_PATH ?? "");
for (const binary of [ffmpeg, ffprobe]) {
  assert.ok(isAbsolute(binary));
  assert.notEqual(binary, realpathSync(process.execPath), "Node is not a codec executable");
}
const directory = mkdtempSync(join(realpathSync(tmpdir()), "syntx Windows приёмка 🎞 "));
const photo = join(directory, "фото референс 📷.jpg");
const video = join(directory, "видео референс 🎞.mp4");
const audio = join(directory, "аудио референс 🎵.wav");
const receipt = { platform: process.platform, node: process.version,
  windows_os_acceptance: process.platform === "win32" ? "PASS" : "NOT_RUN_LOCAL_PREFLIGHT_ONLY",
  provider_account_acceptance: "NOT_TESTED", real_user_credentials: false, media: [] };
const run = (binary, args, extra = {}) => execFileSync(binary, args,
  { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024, ...extra });
const mediaArgs = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y"];
function deadline(promise, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), 20_000);
  })]).finally(() => clearTimeout(timer));
}
function result(value) {
  assert.equal(value.isError, undefined, JSON.stringify(value));
  assert.ok(value.structuredContent);
  return value.structuredContent;
}

function checkWindowsTemporaryAcl() {
  if (process.platform !== "win32") return { status: "NOT_RUN_NON_WINDOWS", posix_bits_are_acl_evidence: false };
  const child = join(directory, "private inherited кодеки 🎞");
  mkdirSync(child, { mode: 0o700 });
  const file = join(child, "private inherited media.bin");
  writeFileSync(file, "synthetic privacy acceptance", { mode: 0o600, flag: "wx" });
  const script = `
$ErrorActionPreference = 'Stop'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$allowed = @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544')
$read = [System.Security.AccessControl.FileSystemRights]::ReadData
$paths = @($env:SYNTX_ACL_ROOT, $env:SYNTX_ACL_CHILD, $env:SYNTX_ACL_FILE)
foreach ($path in $paths) {
  $acl = Get-Acl -LiteralPath $path
  foreach ($rule in $acl.Access) {
    # InheritOnly ACEs do not grant access to this object. The generated child
    # directory and file are checked separately after inheritance is applied.
    if (($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
    $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($rule.AccessControlType -eq 'Allow' -and ($rule.FileSystemRights -band $read) -ne 0 -and $allowed -notcontains $sid) {
      throw 'WINDOWS_TEMP_FOREIGN_READ_ALLOW'
    }
  }
}
@{ status='PASS'; checked_paths=3; policy='CURRENT_USER_SYSTEM_ADMIN_ONLY_READ_ALLOW'; acl_mutated=$false } | ConvertTo-Json -Compress
`;
  // Read native DACLs; chmod/stat mode bits do not establish NTFS privacy.
  const shell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return JSON.parse(run(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", PATH: process.env.PATH ?? "",
      SYNTX_ACL_ROOT: directory, SYNTX_ACL_CHILD: child, SYNTX_ACL_FILE: file }
  }));
}

async function stdio() {
  const preload = join(directory, "offline guard.mjs");
  writeFileSync(preload, `import net from 'node:net';import http from 'node:http';import https from 'node:https';import tls from 'node:tls';
let calls=0;const block=()=>{calls++;throw new Error('WINDOWS_ACCEPTANCE_NETWORK_BLOCKED')};
globalThis.fetch=block;net.connect=block;net.createConnection=block;http.request=block;http.get=block;https.request=block;https.get=block;tls.connect=block;
process.on('exit',code=>process.stderr.write('WINDOWS_ACCEPTANCE_NETWORK='+calls+';EXIT='+code+'\\n'));
`);
  const config = buildMediaMcpConfig(new URL("./print-media-mcp-config.mjs", import.meta.url).href, process.execPath,
    { includeAllSupportedMedia: true, includeSelfUpdate: true, localImageRoots: [directory] }).mcpServers.syntx;
  // Never inherit user SYNTX configuration, credentials, NODE_OPTIONS or startup imports.
  const env = { ...config.env, PATH: process.env.PATH ?? "", HOME: directory, USERPROFILE: directory,
    ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" } : {}),
    SYNTX_MEDIA_FFMPEG_PATH: ffmpeg, SYNTX_MEDIA_FFPROBE_PATH: ffprobe, SYNTX_SELF_UPDATE_BOOTSTRAPPED: "1" };
  for (const key of Object.keys(env)) if (env[key] === "<uploaded|hidden>") env[key] = "uploaded";
  assert.equal(Object.values(env).some(value => String(value).startsWith("<")), false);
  assert.equal(Object.keys(env).some(key => /(?:AUTH_KEY|AUTH_PROFILE|TOKEN|BEARER)/iu.test(key)), false);
  const transport = new StdioClientTransport({ command: config.command,
    args: ["--import", pathToFileURL(preload).href, ...config.args], cwd: root, env, stderr: "pipe" });
  const client = new Client({ name: "windows-native-media-acceptance", version: "1" });
  let stderr = "";
  transport.stderr?.on("data", chunk => { stderr += chunk.toString(); });
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  transport.onclose = () => resolveClosed();
  try {
    await deadline(client.connect(transport), "stdio connect timeout");
    const names = new Set((await deadline(client.listTools(), "tools/list timeout")).tools.map(tool => tool.name));
    assert.ok(names.has("syntx_upload_standard_image_reference_file"));
    assert.ok(names.has("syntx_owner_upload_seedance_editor_frame"));
    const rows = [];
    for (const offset of [0, 100]) {
      const page = result(await deadline(client.callTool({ name: "syntx_get_media_coverage",
        arguments: { offset, limit: 100, include_inactive: true } }), "coverage timeout"));
      assert.equal(page.coverage_version, "6.0.0");
      assert.equal(page.total, 127);
      rows.push(...page.items);
    }
    const mapped = rows.filter(row => row.active && row.runtime_status === "CODE_MAPPED");
    assert.equal(mapped.length, 119);
    const gaps = mapped.flatMap(row => row.mcp_tool_names.filter(name => !names.has(name)).map(tool => ({ model: row.model_id, tool })));
    assert.deepEqual(gaps, [], "every mapped name must exist in the real full-profile tools/list");
    await deadline(client.close(), "stdio EOF timeout");
    await deadline(closed, "stdio child close timeout");
    assert.equal(transport.pid, null);
    assert.equal(stderr.trim(), "WINDOWS_ACCEPTANCE_NETWORK=0;EXIT=0");
    return { tools: names.size, active_mapped_rows: mapped.length, missing_route_bindings: gaps.length,
      network_calls: 0, auth_calls: 0, generation_calls: 0, eof_exit: 0, pid: transport.pid };
  } finally { await client.close().catch(() => {}); if (transport.pid !== null) await transport.close(); }
}

async function imageFlow() {
  const attempt = "link_windows_native_image_0123456789";
  const counts = { upload: 0, chat: 0, generation: 0, history: 0, detail: 0 };
  const outputUrl = "https://r2.syntx.ai/windows-native/result.jpg";
  const image = readFileSync(photo);
  // Native nominal candidate TTL uses wall time; do not freeze this runtime clock.
  const now = Date.now();
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.syntx.ai");
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "1000" });
    if (url.pathname === "/api/v1/user/subscription") return Response.json({ active: true, type: "PRO", end_date: "2099-12-31" });
    if (url.pathname === "/api/v2/get_model_info") return Response.json({ access: true, cost: 1,
      discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
    if (url.pathname === "/api/v1/chats/upload-files") {
      counts.upload++;
      const file = init.body.get("files");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), image);
      assert.equal(file.type, "image/jpeg");
      return Response.json({ files: [{ id: "native-image-upload", url: "https://r2.syntx.ai/windows-native/input.jpg",
        mime_type: "image/jpeg", size: file.size }] });
    }
    if (url.pathname === "/api/v1/chats") { counts.chat++; return Response.json({ uuid: "windows-native-image-chat" }); }
    if (url.pathname === "/api/v1/design/generate") {
      counts.generation++;
      const body = JSON.parse(init.body);
      assert.deepEqual(body.settings.file_urls, [{ type: "image", url: "https://r2.syntx.ai/windows-native/input.jpg" }]);
      assert.equal(body.settings.model_type, "banana-2.1");
      return Response.json({ id: "native-image-owner" });
    }
    if (url.pathname.endsWith("/messages")) {
      counts.history++;
      return Response.json({ messages: [
        { id: "native-image-owner", chat_id: 700, author_id: 12345, message_object: [
          { id: "native-input", message_id: "native-image-owner", object_type: "image", model_type: "banana-2.1" },
          { id: "native-text", message_id: "native-image-owner", object_type: "text", model_type: "banana-2.1" }] },
        { id: "native-image-bot", chat_id: 700, author_id: -1, message_object: [
          { id: "native-output", message_id: "native-image-bot", object_type: "image", model_type: "banana-2.1" }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname.endsWith("/inprogress")) return Response.json([]);
    if (url.pathname.endsWith("/native-image-bot")) {
      counts.detail++;
      return Response.json({ id: "native-image-bot", chat_id: 700, author_id: -1, message_object: [
        { id: "native-output", message_id: "native-image-bot", object_type: "image", model_type: "banana-2.1",
          completed: true, object_url: outputUrl }] });
    }
    throw new Error("Unexpected synthetic image route");
  };
  const runtime = createObservedOwnerRuntime({ ownerStandardImageReferencesEnabled: true,
    ownerLocalImageFilesEnabled: true, ownerLocalImageRoots: [directory], ownerLocalImageFfmpegPath: ffmpeg, fetchImpl, now: () => now });
  const store = runtime.authStore, binding = runtime.authBinding;
  await store.createAttempt({ attempt_id: attempt, binding, expires_at_ms: now + 86_400_000 });
  await store.beginHandoff(binding, attempt);
  await store.attachChallenge(binding, attempt, "synthetic-native-image-challenge");
  await store.beginPoll(binding, attempt);
  await store.markLinked(binding, attempt, { scheme: "Bearer", value: "synthetic-native-image-credential" });
  const server = createMcpServer(runtime.application, { ...runtime.serverOptions, ownerLocalImageFileTransport: "stdio" });
  const client = new Client({ name: "windows-native-image-mock", version: "1" });
  const [caller, host] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(host); await client.connect(caller);
    const uploaded = result(await client.callTool({ name: "syntx_upload_standard_image_reference_file", arguments: {
      link_attempt_id: attempt, variant: "banana-2.1", absolute_path: photo } }));
    const generated = result(await client.callTool({ name: "syntx_owner_generate_standard_image", arguments: {
      link_attempt_id: attempt, variant: "banana-2.1", reference_handles: [uploaded.receipt.reference_handle],
      parameters: { aspect_ratio: "1:1", image_size: "1K", thinking_level: "minimal" }, prompt: "Synthetic Windows media acceptance" } }));
    assert.equal(generated.status, "result_observed"); assert.equal(generated.artifact.url, outputUrl);
    assert.deepEqual(counts, { upload: 1, chat: 1, generation: 1, history: 1, detail: 1 });
    assert.deepEqual(readFileSync(photo), image, "local file upload must preserve the original");
    return { ...counts, transport: "SDK_IN_MEMORY", provider: "SYNTHETIC_NATIVE_HTTP_MOCK" };
  } finally {
    await client.close(); await server.close();
    await runtime.serverOptions.ownerStandardImageReferences.generationService.close();
    await runtime.authStore.close?.();
  }
}

try {
  receipt.temporary_acl = checkWindowsTemporaryAcl();
  receipt.ffmpeg = run(ffmpeg, ["-version"]).split(/\r?\n/u)[0];
  receipt.ffprobe = run(ffprobe, ["-version"]).split(/\r?\n/u)[0];
  run(ffmpeg, [...mediaArgs, "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=1", "-frames:v", "1", photo]);
  run(ffmpeg, [...mediaArgs, "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24", "-t", "4.25", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
  run(ffmpeg, [...mediaArgs, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=8000", "-t", "24", "-c:a", "pcm_s16le", audio]);
  for (const [kind, path, codec] of [["photo", photo, "mjpeg"], ["video", video, "h264"], ["audio", audio, "pcm_s16le"]]) {
    const probe = JSON.parse(run(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path]));
    assert.equal(probe.streams[0].codec_name, codec);
    run(ffmpeg, ["-nostdin", "-hide_banner", "-loglevel", "error", "-xerror", "-i", path, "-f", "null", "-"]);
    receipt.media.push({ kind, codec, bytes: readFileSync(path).length, probe: "PASS", full_decode: "PASS", unicode_path: true });
  }
  receipt.stdio = await stdio();
  receipt.image_flow = await imageFlow();
  const env = { PATH: process.env.PATH ?? "", HOME: directory, USERPROFILE: directory,
    TMPDIR: directory, TMP: directory, TEMP: directory,
    ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" } : {}),
    SYNTX_MEDIA_FFMPEG_PATH: ffmpeg, SYNTX_MEDIA_FFPROBE_PATH: ffprobe,
    SYNTX_EDITOR_NATIVE_FFPROBE_PATH: ffprobe, SYNTX_EDITOR_NATIVE_VIDEO_PATH: video, SYNTX_SUNO_TEST_FFPROBE: ffprobe,
    SYNTX_ACTTWO_TEST_FFMPEG: ffmpeg, SYNTX_ACTTWO_TEST_FFPROBE: ffprobe, SYNTX_HEYGEN4_TEST_FFPROBE: ffprobe,
    SYNTX_KLING_MEDIA_TEST_FFMPEG: ffmpeg, SYNTX_KLING_MEDIA_TEST_FFPROBE: ffprobe,
    SYNTX_VIDEO2AUDIO_TEST_FFMPEG: ffmpeg, SYNTX_VIDEO2AUDIO_TEST_FFPROBE: ffprobe,
    SYNTX_CURRENT_VIDEO_TEST_FFMPEG: ffmpeg, SYNTX_CURRENT_VIDEO_TEST_FFPROBE: ffprobe,
    SYNTX_ELEVENLABS_STS_TEST_FFMPEG: ffmpeg, SYNTX_ELEVENLABS_STS_TEST_FFPROBE: ffprobe };
  const selected = [
    ["local-media-native-permissions.test.js"],
    ["owner-seedance-editor-flow2230.test.js", "2230 real MCP SDK tools drive"],
    ["owner-suno-audio-reference.test.js", "genuine uploaded audio reaches"],
    ["standard-image-reference-preparation.test.js", "compresses high-entropy JPEG"],
    ["owner-local-image-file-service.test.js"], ["owner-local-image-file-tool.test.js"],
    ["owner-heygen4-absolute-path.test.js"],
    ["owner-actor-current-controls.test.js", "ActTwo current expression allows finite manual fractions"],
    ["owner-kling-media-sdk2350.test.js", "2350 MCP SDK performs exactly one source-typed flow"],
    ["owner-runway-i2v-flow2261.test.js", "^Current Gen4.5 I2V SDK preserves all five genuinely cropped PNG ratios"],
    ["owner-grok-i2v-flow2283.test.js", "^Current Grok I2V SDK preserves genuine portrait original geometry"],
    ["owner-video2audio-current-input-sdk.test.js", "^Video2Audio current SDK real31second MP4 WebM MOV and12MiB bytes"],
    ["owner-current-video-reference-trim.test.js"],
    ["owner-seedance-current-sdk.test.js"],
    ["owner-flux3-current-sdk.test.js"],
    ["owner-image-manual-current-sdk.test.js"],
    ["owner-current-video-generation-sdk.test.js", "^current Hailuo SDK genuinely probes mixed audio and video"],
    ["remote-owner-stdio-buffer.test.js"],
    ["../../tests/owner-acttwo-2355.test.mjs", "ActTwo genuinely probes1second and30second MP4s"],
    ["owner-elevenlabs-sts-wav-preparation.test.js", "^STS genuine5second and300second WAV full audio preparation"]
  ];
  for (const [suite, pattern] of selected) {
    const output = run(process.execPath, ["--test", "--test-reporter=tap", ...(pattern ? [`--test-name-pattern=${pattern}`] : []), `dist/tests/${suite}`], { env });
    process.stdout.write(output);
    assert.match(output, /# fail 0\r?\n/u); assert.match(output, /# skipped 0\r?\n/u);
  }
  receipt.selected_suites = selected.length;
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} finally { rmSync(directory, { recursive: true, force: true }); }
