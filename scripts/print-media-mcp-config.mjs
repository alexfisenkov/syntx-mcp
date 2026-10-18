#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { types } from "node:util";

export const SYNTX_MEDIA_MCP_BIN = "syntx-mcp-media-config";
export const PAID_TOOLS_CONFIRMATION_FLAG = "--confirm-enable-paid-tools";
export const INCLUDE_KLING4_FLAG = "--include-kling4";
export const INCLUDE_WAN27_VIDEOEDIT_FLAG = "--include-wan27-videoedit";
export const INCLUDE_SEEDANCE_EDITOR_FLAG = "--include-seedance-editor";

const ENABLED_FLAGS = Object.freeze([
  "SYNTX_OWNER_ACCOUNT_STATUS",
  "SYNTX_OWNER_CLARITY_UPSCALE",
  "SYNTX_OWNER_MAGNIFIC_UPSCALE",
  "SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES",
  "SYNTX_OWNER_WAN_IMAGE_REFERENCES",
  "SYNTX_OWNER_STANDARD_IMAGE_REFERENCES",
  "SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES",
  "SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES",
  "SYNTX_OWNER_SEEDREAM_EDITOR_IMAGE_REFERENCES",
  "SYNTX_OWNER_FLUX_IMAGE_REFERENCES",
  "SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES",
  "SYNTX_OWNER_GROK_T2I_IMAGE_REFERENCES",
  "SYNTX_OWNER_UNI_IMAGE_REFERENCES",
  "SYNTX_OWNER_SOUL_IMAGE_REFERENCES",
  "SYNTX_OWNER_WAN_T2I_IMAGE",
  "SYNTX_OWNER_BANANA_INPAINT_IMAGE_REFERENCES",
  "SYNTX_OWNER_WAN_T2V_VIDEOS",
  "SYNTX_OWNER_WAN30_FIRST_LAST_VIDEOS",
  "SYNTX_OWNER_WAN30_REFERENCE_VIDEOS",
  "SYNTX_OWNER_WAN30_OMNI_VIDEOS",
  "SYNTX_OWNER_WAN30_EDIT_VIDEOS",
  "SYNTX_OWNER_ELEVENLABS_TTS",
  "SYNTX_OWNER_ELEVENLABS_DIALOGUE",
  "SYNTX_OWNER_ELEVENLABS_STS",
  "SYNTX_OWNER_SUNO_GENERATION",
  "SYNTX_OWNER_LUMA_T2V",
  "SYNTX_OWNER_HAILUO01_T2V",
  "SYNTX_OWNER_HAILUO01_DIRECTOR_T2V",
  "SYNTX_OWNER_HAILUO23_T2V",
  "SYNTX_OWNER_HAILUO02_T2V",
  "SYNTX_OWNER_SEEDANCE20_T2V",
  "SYNTX_OWNER_VIDEO2AUDIO",
  "SYNTX_OWNER_KLING_T2V",
  "SYNTX_OWNER_KLING_I2V",
  "SYNTX_OWNER_HAILUO02_I2V",
  "SYNTX_OWNER_VEO_T2V",
  "SYNTX_OWNER_VEO_OMNI_T2V",
  "SYNTX_OWNER_VEO_OMNI_REFERENCES",
  "SYNTX_OWNER_GROK_T2V",
  "SYNTX_OWNER_GROK_V2V",
  "SYNTX_OWNER_HAILUO_LIVE_T2V",
  "SYNTX_OWNER_TOPAZ_ASTRA",
  "SYNTX_OWNER_TOPAZ_ENHANCE",
  "SYNTX_OWNER_FLUX3_VIDEOS",
  "SYNTX_OWNER_WAN27_R2V",
  "SYNTX_OWNER_WAN26_I2V",
  "SYNTX_OWNER_WAN26_R2V",
  "SYNTX_OWNER_WAN25_I2V_PREVIEW",
  "SYNTX_OWNER_KLING_KEYFRAMES",
  "SYNTX_OWNER_KLING_MOTION_CONTROL"
]);

const DISABLED_FLAGS = Object.freeze([
  "SYNTX_OWNER_IMAGE_REFERENCES",
  "SYNTX_OWNER_GROK_IMAGE_REFERENCES",
  "SYNTX_OWNER_UPLOADED_FILES",
  "SYNTX_OWNER_UPLOAD_FILE",
  "SYNTX_OWNER_RECONCILE_UPLOADED_FILE",
  "SYNTX_OWNER_GENERATE_IMAGE",
  "SYNTX_OWNER_GENERATE_VIDEO",
  "SYNTX_OWNER_GENERATE_CONTRACT_MEDIA",
  "SYNTX_OWNER_DURABLE_GENERATION",
  "SYNTX_OWNER_SOUL_CATALOG_SHAPE",
  "SYNTX_OWNER_SOUL_STYLE_OPTIONS"
]);

const HELP_TEXT = [
  "Print a local stdio MCP configuration for the existing owner media tools.",
  "",
  "Usage:",
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_KLING4_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_WAN27_VIDEOEDIT_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_SEEDANCE_EDITOR_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_KLING4_FLAG} ${INCLUDE_WAN27_VIDEOEDIT_FLAG}`,
  "  node scripts/print-media-mcp-config.mjs --help",
  "",
  "Without the exact confirmation flag, no configuration is emitted. Kling 4, WAN 2.7 Video Edit, and Seedance Editor are omitted unless their independent include flag is selected.",
  `Kling 4 is omitted by default; select its independent owner-stdio group with ${INCLUDE_KLING4_FLAG}. When selected, replace SYNTX_OWNER_KLING4_FFPROBE_PATH with an absolute trusted ffprobe executable path; SYNTX_OWNER_KLING4_MAX_VIDEO_FILE_BYTES defaults to 67108864 (64 MiB), configurable from 1 through 314572800 (300 MiB). The 30 MiB image source limit is separate.`,
  `WAN 2.7 Video Edit is omitted by default; select its independent owner-stdio group with ${INCLUDE_WAN27_VIDEOEDIT_FLAG}. When selected, replace SYNTX_OWNER_WAN27_VIDEOEDIT_FFPROBE_PATH with an absolute trusted ffprobe executable path; SYNTX_OWNER_WAN27_VIDEOEDIT_MAX_VIDEO_FILE_BYTES defaults to 67108864 (64 MiB), with a 100 MiB source ceiling. Its local image cap is 20 MiB; width and height are each limited to 240–4096. It requires an already-trimmed 2–10 second video; no implicit crop is performed and there is no enforceable provider cost cap. Startup only registers explicitly callable paid tools; it does not upload or generate automatically.`,
  `Seedance Editor is EXPERIMENTAL and omitted by default; select its independent owner-stdio group with ${INCLUDE_SEEDANCE_EDITOR_FLAG}. Live provider E2E is unconfirmed. The local input is one MP4/MOV video, 4–30 seconds, with a 64 MiB default and 100 MiB ceiling. Replace SYNTX_OWNER_SEEDANCE_EDITOR_FFPROBE_PATH with an absolute path to a trusted ffprobe executable. Startup does not upload, probe, or generate; paid actions are explicitly called and there is no enforceable provider cost cap.`,
  "This command does not edit client settings, read credentials, log in, or call the network.",
  "The confirmed owner-stdio config enables Kling I2V with SYNTX_OWNER_KLING_I2V=1 and Hailuo-02 I2V with SYNTX_OWNER_HAILUO02_I2V=1.",
  "The confirmed owner-stdio config enables WAN 2.7 R2V with SYNTX_OWNER_WAN27_R2V=1; replace SYNTX_OWNER_WAN27_R2V_FFPROBE_PATH and SYNTX_OWNER_WAN27_R2V_FFMPEG_PATH placeholders with absolute trusted executable paths.",
  "The confirmed owner-stdio config enables the exact WAN 2.5 I2V preview image-only tool group with SYNTX_OWNER_WAN25_I2V_PREVIEW=1; optional input audio is not enabled in this slice and no ffprobe path is required.",
  "The confirmed owner-stdio config enables Kling Keyframes with SYNTX_OWNER_KLING_KEYFRAMES=1. This only registers the explicitly callable paid tools; it does not start generation.",
  "The confirmed owner-stdio config enables Kling Motion Control with SYNTX_OWNER_KLING_MOTION_CONTROL=1. Replace SYNTX_OWNER_KLING_MOTION_CONTROL_FFPROBE_PATH with the absolute path to a trusted ffprobe executable.",
  "Motion Control generation tools are explicitly called and may incur provider charges; startup does not generate automatically. No enforceable cost cap is provided.",
  "WAN 3.0 First/Last Frame is enabled by SYNTX_OWNER_WAN30_FIRST_LAST_VIDEOS=1; the initial local profile supports two frames and Basic/480P/2s only. Registering tools does not upload or generate automatically.",
  "WAN 3.0 Reference is enabled by SYNTX_OWNER_WAN30_REFERENCE_VIDEOS=1; this local slice accepts one PNG/JPEG image and the single observed Basic/16:9/480P/2s tuple. Registering tools does not upload or generate automatically.",
  "WAN 3.0 Omni is enabled by SYNTX_OWNER_WAN30_OMNI_VIDEOS=1; this local slice accepts one PNG/JPEG image and the single observed Basic/16:9/480P/2s tuple. Registering tools does not upload or generate automatically.",
  "WAN 3.0 Edit is enabled by SYNTX_OWNER_WAN30_EDIT_VIDEOS=1; replace SYNTX_OWNER_WAN30_EDIT_FFPROBE_PATH with an absolute path to a trusted ffprobe executable. This local slice accepts only one observed owner-upload MP4 case and the Basic/16:9/480P/2s tuple. ffprobe runs only when the upload tool is explicitly called; startup does not upload, probe, or generate.",
  "ElevenLabs STS operator placeholders must be replaced with an absolute ffprobe path and an explicit uploaded or hidden destination.",
  "Topaz Astra operator placeholders must be replaced with an absolute ffprobe path and an explicit uploaded or hidden destination.",
  "Topaz Enhance is enabled by SYNTX_OWNER_TOPAZ_ENHANCE=1; replace its ffprobe path and upload destination placeholders. The local probe accepts MP4 only, while public metadata also lists WebM and QuickTime. Tools run only when explicitly called; startup does not upload or generate. Paid generation has no enforceable cost cap.",
  "Flux3 owner video tools are enabled by SYNTX_OWNER_FLUX3_VIDEOS=1; replace the trusted absolute ffprobe path and upload destination placeholders. I2V accepts one to ten local image references; V2V accepts one local MP4 reference. Startup does not probe, upload, or generate.",
  "Grok V2V is enabled by SYNTX_OWNER_GROK_V2V=1; replace its trusted absolute ffprobe path and upload destination placeholders. It accepts one MP4 or QuickTime original of 1–8.7 seconds; duration and resolution are inferred locally. Paid generation is explicitly invoked; startup does not generate and no enforceable cost cap is provided.",
  "Veo Omni image/video reference tools are enabled separately by SYNTX_OWNER_VEO_OMNI_REFERENCES=1; replace SYNTX_OWNER_VEO_OMNI_REFERENCES_FFPROBE_PATH with an absolute path to a trusted ffprobe executable. SYNTX_OWNER_VEO_OMNI_REFERENCES_MAX_FILE_BYTES defaults to 67108864 (64 MiB); the trusted operator may set a positive integer up to 1048576000 (1 GB). Startup does not probe, upload, or generate. This group is independent of SYNTX_OWNER_VEO_OMNI_T2V and has no enforceable provider cost cap.",
  "The emitted tools can perform paid generation only when explicitly called by the client."
].join("\n") + "\n";

export class MediaMcpConfigCliError extends Error {
  constructor() {
    super("MEDIA_MCP_CONFIG_ARGUMENTS_INVALID");
    this.name = "MediaMcpConfigCliError";
    this.code = "MEDIA_MCP_CONFIG_ARGUMENTS_INVALID";
  }
}

export function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== "string")) {
    throw new MediaMcpConfigCliError();
  }
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--help")) {
    return Object.freeze({ kind: "help" });
  }
  if (argv.includes("--help") || argv[0] !== PAID_TOOLS_CONFIRMATION_FLAG) throw new MediaMcpConfigCliError();
  const seen = new Set();
  let confirmed = false;
  let includeKling4 = false;
  let includeWan27VideoEdit = false;
  let includeSeedanceEditor = false;
  for (const argument of argv) {
    if (seen.has(argument)) throw new MediaMcpConfigCliError();
    seen.add(argument);
    if (argument === PAID_TOOLS_CONFIRMATION_FLAG) confirmed = true;
    else if (argument === INCLUDE_KLING4_FLAG) includeKling4 = true;
    else if (argument === INCLUDE_WAN27_VIDEOEDIT_FLAG) includeWan27VideoEdit = true;
    else if (argument === INCLUDE_SEEDANCE_EDITOR_FLAG) includeSeedanceEditor = true;
    else throw new MediaMcpConfigCliError();
  }
  if (!confirmed) throw new MediaMcpConfigCliError();
  return Object.freeze({ kind: "emit", ...(includeKling4 ? { includeKling4: true } : {}),
    ...(includeWan27VideoEdit ? { includeWan27VideoEdit: true } : {}),
    ...(includeSeedanceEditor ? { includeSeedanceEditor: true } : {}) });
}

export function buildMediaMcpConfig(entryUrl, nodeExecutable, options = undefined) {
  if (typeof entryUrl !== "string" || typeof nodeExecutable !== "string" || !isAbsolute(nodeExecutable)) {
    throw new MediaMcpConfigCliError();
  }
  const selection = readOptionalSelections(options);

  let scriptPath;
  try {
    const parsedUrl = new URL(entryUrl);
    if (parsedUrl.protocol !== "file:") throw new Error("invalid URL protocol");
    scriptPath = fileURLToPath(parsedUrl);
  } catch {
    throw new MediaMcpConfigCliError();
  }

  const packageRoot = resolve(dirname(scriptPath), "..");
  const ownerStdioEntrypoint = resolve(packageRoot, "dist", "src", "transports", "stdio-owner.js");
  const env = Object.fromEntries([
    ...ENABLED_FLAGS.map((flag) => [flag, "1"]),
    ...DISABLED_FLAGS.map((flag) => [flag, "0"]),
    ["SYNTX_OWNER_ELEVENLABS_STS_FFPROBE_PATH", "<absolute path to ffprobe>"],
    ["SYNTX_OWNER_ELEVENLABS_STS_UPLOAD_DESTINATION", "<uploaded|hidden>"],
    ["SYNTX_OWNER_TOPAZ_ASTRA_FFPROBE_PATH", "<absolute path to ffprobe>"],
    ["SYNTX_OWNER_TOPAZ_ASTRA_UPLOAD_DESTINATION", "<uploaded|hidden>"],
    ["SYNTX_OWNER_TOPAZ_ENHANCE_FFPROBE_PATH", "<absolute path to trusted ffprobe executable>"],
    ["SYNTX_OWNER_TOPAZ_ENHANCE_UPLOAD_DESTINATION", "<uploaded|hidden>"],
    ["SYNTX_OWNER_FLUX3_FFPROBE_PATH", "<absolute path to trusted ffprobe executable>"],
    ["SYNTX_OWNER_FLUX3_UPLOAD_DESTINATION", "<uploaded|hidden>"],
    ["SYNTX_OWNER_GROK_V2V_FFPROBE_PATH", "<absolute path to trusted ffprobe executable>"],
    ["SYNTX_OWNER_GROK_V2V_UPLOAD_DESTINATION", "<uploaded|hidden>"],
    ["SYNTX_OWNER_WAN27_R2V_FFPROBE_PATH", "<absolute path to ffprobe>"],
    ["SYNTX_OWNER_WAN27_R2V_FFMPEG_PATH", "<absolute path to ffmpeg>"],
    ["SYNTX_OWNER_WAN26_I2V_FFPROBE_PATH", "<absolute path to trusted ffprobe executable>"],
    ["SYNTX_OWNER_WAN26_R2V_FFPROBE_PATH", "<absolute path to trusted ffprobe executable>"],
    ["SYNTX_OWNER_WAN26_R2V_FFMPEG_PATH", "<absolute path to trusted ffmpeg executable>"],
    ["SYNTX_OWNER_WAN30_EDIT_FFPROBE_PATH", "<absolute path to trusted ffprobe executable>"],
    ["SYNTX_OWNER_KLING_MOTION_CONTROL_FFPROBE_PATH", "<absolute path to trusted ffprobe executable>"],
    ["SYNTX_OWNER_VEO_OMNI_REFERENCES_FFPROBE_PATH", "<absolute path to trusted ffprobe executable>"],
    ["SYNTX_OWNER_VEO_OMNI_REFERENCES_MAX_FILE_BYTES", "67108864"]
  ]);
  if (selection.includeKling4) {
    env.SYNTX_OWNER_KLING4 = "1";
    env.SYNTX_OWNER_KLING4_FFPROBE_PATH = "<absolute path to trusted ffprobe executable>";
    env.SYNTX_OWNER_KLING4_MAX_VIDEO_FILE_BYTES = "67108864";
  }
  if (selection.includeWan27VideoEdit) {
    env.SYNTX_OWNER_WAN27_VIDEOEDIT = "1";
    env.SYNTX_OWNER_WAN27_VIDEOEDIT_FFPROBE_PATH = "<absolute path to trusted ffprobe executable>";
    env.SYNTX_OWNER_WAN27_VIDEOEDIT_MAX_VIDEO_FILE_BYTES = "67108864";
  }
  if (selection.includeSeedanceEditor) {
    env.SYNTX_OWNER_SEEDANCE_EDITOR = "1";
    env.SYNTX_OWNER_SEEDANCE_EDITOR_FFPROBE_PATH = "<absolute path to trusted ffprobe executable>";
    env.SYNTX_OWNER_SEEDANCE_EDITOR_MAX_VIDEO_FILE_BYTES = "67108864";
  }

  return Object.freeze({
    mcpServers: Object.freeze({
      syntx: Object.freeze({
        command: nodeExecutable,
        args: Object.freeze([ownerStdioEntrypoint]),
        env: Object.freeze(env)
      })
    })
  });
}

export async function main(argv, options = {}) {
  const writeStdout = options.writeStdout ?? ((text) => process.stdout.write(text));
  const writeStderr = options.writeStderr ?? ((text) => process.stderr.write(text));
  try {
    const parsed = parseArguments(argv);
    if (parsed.kind === "help") {
      writeStdout(HELP_TEXT);
      return 0;
    }
    const selection = {
      ...(parsed.includeKling4 === true ? { includeKling4: true } : {}),
      ...(parsed.includeWan27VideoEdit === true ? { includeWan27VideoEdit: true } : {}),
      ...(parsed.includeSeedanceEditor === true ? { includeSeedanceEditor: true } : {})
    };
    const config = buildMediaMcpConfig(options.entryUrl ?? import.meta.url, options.nodeExecutable ?? process.execPath,
      Object.keys(selection).length === 0 ? undefined : selection);
    writeStdout(`${JSON.stringify(config, null, 2)}\n`);
    return 0;
  } catch {
    writeStderr("MEDIA_MCP_CONFIG_ARGUMENTS_INVALID\n");
    return 2;
  }
}

function readOptionalSelections(value) {
  if (value === undefined) return Object.freeze({ includeKling4: false, includeWan27VideoEdit: false, includeSeedanceEditor: false });
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length < 1 || keys.length > 3 || keys.some((key) =>
      key !== "includeKling4" && key !== "includeWan27VideoEdit" && key !== "includeSeedanceEditor")) throw new Error();
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true || typeof descriptor.value !== "boolean") throw new Error();
    }
    return Object.freeze({ includeKling4: descriptors.includeKling4?.value ?? false,
      includeWan27VideoEdit: descriptors.includeWan27VideoEdit?.value ?? false,
      includeSeedanceEditor: descriptors.includeSeedanceEditor?.value ?? false });
  } catch {
    throw new MediaMcpConfigCliError();
  }
}

const entry = process.argv[1];
if (entry !== undefined) {
  try {
    if (realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(entry))) {
      process.exitCode = await main(process.argv.slice(2));
    }
  } catch {
    process.exitCode = 2;
  }
}
