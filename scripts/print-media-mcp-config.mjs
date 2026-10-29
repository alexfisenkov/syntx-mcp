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
export const INCLUDE_RUNWAY_I2V_FLAG = "--include-runway-i2v";
export const INCLUDE_GROK_I2V_FLAG = "--include-grok-i2v";
export const INCLUDE_WAN25_T2V_PREVIEW_FLAG = "--include-wan25-t2v-preview";
export const INCLUDE_HIGGSFIELD_DOP_FLAG = "--include-higgsfield-dop";
export const INCLUDE_HAILUO_INITIAL_FLAG = "--include-hailuo-initial";
export const INCLUDE_HAPPY_HORSE_FLAG = "--include-happy-horse";
export const INCLUDE_WAN27_I2V_FLAG = "--include-wan27-i2v";
export const INCLUDE_SEEDANCE25_T2V_FLAG = "--include-seedance25-t2v";
export const INCLUDE_KLING_MEDIA_FLAG = "--include-kling-media";
export const INCLUDE_SWITCHX_VIDEO_FLAG = "--include-switchx-video";
export const INCLUDE_ACTTWO_FLAG = "--include-acttwo";
export const INCLUDE_HEYGEN4_FLAG = "--include-heygen4";
export const INCLUDE_EXISTING_VIDEO_RECOVERY_FLAG = "--include-existing-video-recovery";
export const INCLUDE_ALL_SUPPORTED_MEDIA_FLAG = "--include-all-supported-media";
export const INCLUDE_SELF_UPDATE_FLAG = "--include-self-update";

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
  "SYNTX_OWNER_SOUL_STYLE_OPTIONS",
  "SYNTX_OWNER_KLING_MEDIA", "SYNTX_OWNER_KLING_MEDIA_UPLOAD_DESTINATION", "SYNTX_OWNER_KLING_MEDIA_FFPROBE_PATH",
  "SYNTX_OWNER_SWITCHX_VIDEO", "SYNTX_OWNER_SWITCHX_VIDEO_UPLOAD_DESTINATION", "SYNTX_OWNER_SWITCHX_VIDEO_FFPROBE_PATH",
  "SYNTX_OWNER_ACTTWO", "SYNTX_OWNER_ACTTWO_UPLOAD_DESTINATION", "SYNTX_OWNER_ACTTWO_FFPROBE_PATH",
  "SYNTX_OWNER_HEYGEN4", "SYNTX_OWNER_HEYGEN4_FFPROBE_PATH", "SYNTX_OWNER_EXISTING_VIDEO_RECOVERY"
]);

const HELP_TEXT = [
  "Print a local stdio MCP configuration for the existing owner media tools.",
  "",
  "Usage:",
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_KLING4_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_WAN27_VIDEOEDIT_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_SEEDANCE_EDITOR_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_RUNWAY_I2V_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_GROK_I2V_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_WAN25_T2V_PREVIEW_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_HIGGSFIELD_DOP_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_HAILUO_INITIAL_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_HAPPY_HORSE_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_WAN27_I2V_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_SEEDANCE25_T2V_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_KLING_MEDIA_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_SWITCHX_VIDEO_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_ACTTWO_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_HEYGEN4_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_EXISTING_VIDEO_RECOVERY_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_ALL_SUPPORTED_MEDIA_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_ALL_SUPPORTED_MEDIA_FLAG} ${INCLUDE_SELF_UPDATE_FLAG}`,
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG} ${INCLUDE_KLING4_FLAG} ${INCLUDE_WAN27_VIDEOEDIT_FLAG}`,
  "  node scripts/print-media-mcp-config.mjs --help",
  "",
  "Without the exact confirmation flag, no configuration is emitted. Kling 4, WAN 2.7 Video Edit, Seedance Editor, Runway I2V, Grok I2V, WAN 2.5 T2V Preview, and Higgsfield DOP are omitted unless their independent include flag is selected.",
  `Runway I2V is EXPERIMENTAL and omitted by default; select ${INCLUDE_RUNWAY_I2V_FLAG}. The initial Gen-4/Turbo slice accepts one already-cropped PNG/JPEG/WebP image up to a local 10 MiB ceiling, six explicit aspect ratios, 5 or 10 seconds, and seed:null only. Startup does not upload or generate. There is no enforceable provider cost cap; live provider E2E is not implied by registration.`,
  `Grok I2V is EXPERIMENTAL and omitted by default; select ${INCLUDE_GROK_I2V_FLAG}. When selected, replace SYNTX_OWNER_GROK_I2V_UPLOAD_DESTINATION with exactly uploaded or hidden; no destination is inferred. grok_i2v uses the restricted local 16:9/6-or-10-second slice, a 5,000 UTF-16-unit prompt bound, and a 20 MiB local image ceiling. grok_15_i2v uses seven listed ratios, integer duration 1–15, a 2,000 UTF-16-unit prompt bound, and a 10 MiB local image ceiling. Both use 480p or 720p and expose no seed input. These limits are local/catalog-derived metadata, not provider acceptance. Startup does not upload or generate, and no enforceable provider cost cap is present.`,
  `WAN 2.5 T2V Preview is omitted by default; select ${INCLUDE_WAN25_T2V_PREVIEW_FLAG}. Its initial source-bound tuple uses model_id wan_25_t2v_preview, an explicit prompt, 480P/720P/1080P, the catalog-supported ratio matrix, duration 5 or 10, explicit prompt_extend, and seed:null. Optional audio is not enabled. Startup does not upload or generate; price/balance comparison is affordability evidence, not a provider cost cap. Source-only setup does not prove provider acceptance.`,
  `Higgsfield DOP is omitted by default; select ${INCLUDE_HIGGSFIELD_DOP_FLAG}. The initial source-bound tuple is dop-lite or dop-turbo, explicit prompt, enhance_prompt:false, motions:[], and one image. The generated environment includes SYNTX_OWNER_HIGGSFIELD_DOP_UPLOAD_DESTINATION as the explicit placeholder <uploaded|hidden>; replace it with one trusted operator choice. Image bounds are local resource ceilings, not provider limits; no aspect or crop is inferred. Startup does not upload or generate, and provider acceptance is untested.`,
  `Hailuo initial image workflows are omitted by default; select ${INCLUDE_HAILUO_INITIAL_FLAG}. Exact child IDs: hailuo-2.3-fast, hailuo-01-live-character and hailuo-3.0. Replace SYNTX_OWNER_HAILUO_INITIAL_UPLOAD_DESTINATION with an explicit trusted uploaded or hidden choice. The hailuo-minimax selector root is not a generation profile. Startup does not upload or generate.`,
  `Happy Horse initial image/video workflows are omitted by default; select ${INCLUDE_HAPPY_HORSE_FLAG}. Replace SYNTX_OWNER_HAPPY_HORSE_UPLOAD_DESTINATION and SYNTX_OWNER_HAPPY_HORSE_FFPROBE_PATH with trusted operator settings. Initial modes are one first-frame image, one reference image, or one locally measured edit video with no images. The local 30-second input guard is not the provider limit. Startup does not upload or generate.`,
  `WAN 2.7 I2V is omitted by default; select ${INCLUDE_WAN27_I2V_FLAG}. Replace SYNTX_OWNER_WAN27_I2V_UPLOAD_DESTINATION with uploaded or hidden. The initial slice is one first-frame image, 720P, 1:1, 5 seconds, prompt_extend:false, single shot, auto audio setting, seed:null, native_audio:false and basic rendering. Startup does not upload or generate.`,
  `Seedance 2.5 ordinary T2V is omitted by default; select ${INCLUDE_SEEDANCE25_T2V_FLAG}. The initial mini/720p/16:9/5-second tuple has generate_audio:true and no files. This is not Seedance Editor; startup does not generate, and a quote is not a provider cost cap.`,
  `ActTwo is omitted by default; select ${INCLUDE_ACTTWO_FLAG}. Replace SYNTX_OWNER_ACTTWO_UPLOAD_DESTINATION with uploaded or hidden and SYNTX_OWNER_ACTTWO_FFPROBE_PATH with an absolute trusted ffprobe executable path. Startup does not upload, probe, or generate.`,
  `HeyGen 4 is omitted by default; select ${INCLUDE_HEYGEN4_FLAG}. Replace SYNTX_OWNER_HEYGEN4_FFPROBE_PATH with an absolute trusted ffprobe executable path. It imports existing owner assets and exposes one bounded image-plus-audio generation slice; startup does not import or generate.`,
  `Existing-video recovery is omitted by default; select ${INCLUDE_EXISTING_VIDEO_RECOVERY_FLAG}. It registers one read-only tool for receipt-bound per-call targets. It performs no upload or generation.`,
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
  let includeRunwayI2v = false;
  let includeGrokI2v = false;
  let includeWan25T2vPreview = false;
  let includeHiggsfieldDop = false;
  let includeHailuoInitial = false;
  let includeHappyHorse = false;
  let includeWan27I2v = false;
  let includeSeedance25T2v = false;
  let includeKlingMedia = false;
  let includeSwitchxVideo = false;
  let includeActTwo = false;
  let includeHeygen4 = false;
  let includeExistingVideoRecovery = false;
  let includeAllSupportedMedia = false;
  let includeSelfUpdate = false;
  for (const argument of argv) {
    if (seen.has(argument)) throw new MediaMcpConfigCliError();
    seen.add(argument);
    if (argument === PAID_TOOLS_CONFIRMATION_FLAG) confirmed = true;
    else if (argument === INCLUDE_KLING4_FLAG) includeKling4 = true;
    else if (argument === INCLUDE_WAN27_VIDEOEDIT_FLAG) includeWan27VideoEdit = true;
    else if (argument === INCLUDE_SEEDANCE_EDITOR_FLAG) includeSeedanceEditor = true;
    else if (argument === INCLUDE_RUNWAY_I2V_FLAG) includeRunwayI2v = true;
    else if (argument === INCLUDE_GROK_I2V_FLAG) includeGrokI2v = true;
    else if (argument === INCLUDE_WAN25_T2V_PREVIEW_FLAG) includeWan25T2vPreview = true;
    else if (argument === INCLUDE_HIGGSFIELD_DOP_FLAG) includeHiggsfieldDop = true;
    else if (argument === INCLUDE_HAILUO_INITIAL_FLAG) includeHailuoInitial = true;
    else if (argument === INCLUDE_HAPPY_HORSE_FLAG) includeHappyHorse = true;
    else if (argument === INCLUDE_WAN27_I2V_FLAG) includeWan27I2v = true;
    else if (argument === INCLUDE_SEEDANCE25_T2V_FLAG) includeSeedance25T2v = true;
    else if (argument === INCLUDE_KLING_MEDIA_FLAG) includeKlingMedia = true;
    else if (argument === INCLUDE_SWITCHX_VIDEO_FLAG) includeSwitchxVideo = true;
    else if (argument === INCLUDE_ACTTWO_FLAG) includeActTwo = true;
    else if (argument === INCLUDE_HEYGEN4_FLAG) includeHeygen4 = true;
    else if (argument === INCLUDE_EXISTING_VIDEO_RECOVERY_FLAG) includeExistingVideoRecovery = true;
    else if (argument === INCLUDE_ALL_SUPPORTED_MEDIA_FLAG) includeAllSupportedMedia = true;
    else if (argument === INCLUDE_SELF_UPDATE_FLAG) includeSelfUpdate = true;
    else throw new MediaMcpConfigCliError();
  }
  if (!confirmed) throw new MediaMcpConfigCliError();
  if (includeAllSupportedMedia) {
    includeKling4 = includeWan27VideoEdit = includeSeedanceEditor = includeRunwayI2v = includeGrokI2v = true;
    includeWan25T2vPreview = includeHiggsfieldDop = includeHailuoInitial = includeHappyHorse = true;
    includeWan27I2v = includeSeedance25T2v = includeKlingMedia = includeSwitchxVideo = true;
    includeActTwo = includeHeygen4 = includeExistingVideoRecovery = true;
  }
  return Object.freeze({ kind: "emit", ...(includeAllSupportedMedia ? { includeAllSupportedMedia: true } : {}), ...(includeSelfUpdate ? { includeSelfUpdate: true } : {}), ...(includeKling4 ? { includeKling4: true } : {}),
    ...(includeWan27VideoEdit ? { includeWan27VideoEdit: true } : {}),
    ...(includeSeedanceEditor ? { includeSeedanceEditor: true } : {}),
    ...(includeRunwayI2v ? { includeRunwayI2v: true } : {}),
    ...(includeGrokI2v ? { includeGrokI2v: true } : {}),
    ...(includeWan25T2vPreview ? { includeWan25T2vPreview: true } : {}),
    ...(includeHiggsfieldDop ? { includeHiggsfieldDop: true } : {}),
    ...(includeHailuoInitial ? { includeHailuoInitial: true } : {}),
    ...(includeHappyHorse ? { includeHappyHorse: true } : {}),
    ...(includeWan27I2v ? { includeWan27I2v: true } : {}),
    ...(includeSeedance25T2v ? { includeSeedance25T2v: true } : {}),
    ...(includeKlingMedia ? { includeKlingMedia: true } : {}),
    ...(includeSwitchxVideo ? { includeSwitchxVideo: true } : {}),
    ...(includeActTwo ? { includeActTwo: true } : {}),
    ...(includeHeygen4 ? { includeHeygen4: true } : {}),
    ...(includeExistingVideoRecovery ? { includeExistingVideoRecovery: true } : {}) });
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
  const useFamilyBinaryPaths = selection.includeAllSupportedMedia !== true;
  const disabledFlags = useFamilyBinaryPaths ? DISABLED_FLAGS : DISABLED_FLAGS.filter((flag) => !/_(?:FFPROBE|FFMPEG)_PATH$/u.test(flag));
  const mediaPathDefaults = [
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
  ];
  const env = Object.fromEntries([
    ...ENABLED_FLAGS.map((flag) => [flag, "1"]),
    ...disabledFlags.map((flag) => [flag, "0"]),
    ...mediaPathDefaults.filter(([name]) => useFamilyBinaryPaths || !/_(?:FFPROBE|FFMPEG)_PATH$/u.test(name)),
    ["SYNTX_MEDIA_FFPROBE_PATH", "<absolute path to trusted ffprobe executable>"],
    ["SYNTX_MEDIA_FFMPEG_PATH", "<absolute path to trusted ffmpeg executable>"]
  ]);
  if (selection.includeSelfUpdate) env.SYNTX_SELF_UPDATE = "1";
  if (selection.includeAllSupportedMedia) {
    env.SYNTX_OWNER_MEDIA_PROFILE = "all-supported";
    env.SYNTX_OWNER_GENERATE_IMAGE = "1";
    env.SYNTX_OWNER_GENERATE_VIDEO = "1";
    env.SYNTX_OWNER_GROK_IMAGE_REFERENCES = "1";
    env.SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION = "sha256-87f53d7f198a6550038a59279948e10b251a4138509bf76c25c791c990d66299.json";
  }
  if (selection.includeKling4) {
    env.SYNTX_OWNER_KLING4 = "1";
    if (useFamilyBinaryPaths) env.SYNTX_OWNER_KLING4_FFPROBE_PATH = "<absolute path to trusted ffprobe executable>";
    env.SYNTX_OWNER_KLING4_MAX_VIDEO_FILE_BYTES = "67108864";
  }
  if (selection.includeWan27VideoEdit) {
    env.SYNTX_OWNER_WAN27_VIDEOEDIT = "1";
    if (useFamilyBinaryPaths) env.SYNTX_OWNER_WAN27_VIDEOEDIT_FFPROBE_PATH = "<absolute path to trusted ffprobe executable>";
    env.SYNTX_OWNER_WAN27_VIDEOEDIT_MAX_VIDEO_FILE_BYTES = "67108864";
  }
  if (selection.includeSeedanceEditor) {
    env.SYNTX_OWNER_SEEDANCE_EDITOR = "1";
    if (useFamilyBinaryPaths) env.SYNTX_OWNER_SEEDANCE_EDITOR_FFPROBE_PATH = "<absolute path to trusted ffprobe executable>";
    env.SYNTX_OWNER_SEEDANCE_EDITOR_MAX_VIDEO_FILE_BYTES = "67108864";
  }
  if (selection.includeRunwayI2v) env.SYNTX_OWNER_RUNWAY_I2V = "1";
  if (selection.includeGrokI2v) {
    env.SYNTX_OWNER_GROK_I2V = "1";
    env.SYNTX_OWNER_GROK_I2V_UPLOAD_DESTINATION = "<uploaded|hidden>";
  }
  if (selection.includeWan25T2vPreview) env.SYNTX_OWNER_WAN25_T2V_PREVIEW = "1";
  if (selection.includeHiggsfieldDop) {
    env.SYNTX_OWNER_HIGGSFIELD_DOP = "1";
    env.SYNTX_OWNER_HIGGSFIELD_DOP_UPLOAD_DESTINATION = "<uploaded|hidden>";
  }
  if (selection.includeHailuoInitial) {
    env.SYNTX_OWNER_HAILUO_INITIAL = "1";
    env.SYNTX_OWNER_HAILUO_INITIAL_UPLOAD_DESTINATION = "<uploaded|hidden>";
  }
  if (selection.includeHappyHorse) {
    env.SYNTX_OWNER_HAPPY_HORSE = "1";
    env.SYNTX_OWNER_HAPPY_HORSE_UPLOAD_DESTINATION = "<uploaded|hidden>";
    if (useFamilyBinaryPaths) env.SYNTX_OWNER_HAPPY_HORSE_FFPROBE_PATH = "<absolute path to trusted ffprobe executable>";
  }
  if (selection.includeWan27I2v) {
    env.SYNTX_OWNER_WAN27_I2V = "1";
    env.SYNTX_OWNER_WAN27_I2V_UPLOAD_DESTINATION = "<uploaded|hidden>";
  }
  if (selection.includeSeedance25T2v) env.SYNTX_OWNER_SEEDANCE25_T2V = "1";
  for (const [key, group] of [["includeKlingMedia", "KLING_MEDIA"], ["includeSwitchxVideo", "SWITCHX_VIDEO"]]) {
    if (selection[key]) {
      env[`SYNTX_OWNER_${group}`] = "1";
      env[`SYNTX_OWNER_${group}_UPLOAD_DESTINATION`] = "<uploaded|hidden>";
      if (useFamilyBinaryPaths) env[`SYNTX_OWNER_${group}_FFPROBE_PATH`] = "<absolute path to trusted ffprobe executable>";
    }
  }
  if (selection.includeActTwo) {
    env.SYNTX_OWNER_ACTTWO = "1";
    env.SYNTX_OWNER_ACTTWO_UPLOAD_DESTINATION = "<uploaded|hidden>";
    if (useFamilyBinaryPaths) env.SYNTX_OWNER_ACTTWO_FFPROBE_PATH = "<absolute path to trusted ffprobe executable>";
  }
  if (selection.includeHeygen4) {
    env.SYNTX_OWNER_HEYGEN4 = "1";
    if (useFamilyBinaryPaths) env.SYNTX_OWNER_HEYGEN4_FFPROBE_PATH = "<absolute path to trusted ffprobe executable>";
  }
  if (selection.includeExistingVideoRecovery) env.SYNTX_OWNER_EXISTING_VIDEO_RECOVERY = "1";

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
      ...(parsed.includeSeedanceEditor === true ? { includeSeedanceEditor: true } : {}),
      ...(parsed.includeRunwayI2v === true ? { includeRunwayI2v: true } : {}),
      ...(parsed.includeGrokI2v === true ? { includeGrokI2v: true } : {}),
      ...(parsed.includeWan25T2vPreview === true ? { includeWan25T2vPreview: true } : {}),
      ...(parsed.includeHiggsfieldDop === true ? { includeHiggsfieldDop: true } : {}),
      ...(parsed.includeHailuoInitial === true ? { includeHailuoInitial: true } : {}),
      ...(parsed.includeHappyHorse === true ? { includeHappyHorse: true } : {}),
      ...(parsed.includeWan27I2v === true ? { includeWan27I2v: true } : {}),
      ...(parsed.includeSeedance25T2v === true ? { includeSeedance25T2v: true } : {}),
      ...(parsed.includeKlingMedia === true ? { includeKlingMedia: true } : {}),
      ...(parsed.includeSwitchxVideo === true ? { includeSwitchxVideo: true } : {}),
      ...(parsed.includeActTwo === true ? { includeActTwo: true } : {}),
      ...(parsed.includeHeygen4 === true ? { includeHeygen4: true } : {}),
      ...(parsed.includeExistingVideoRecovery === true ? { includeExistingVideoRecovery: true } : {}),
      ...(parsed.includeAllSupportedMedia === true ? { includeAllSupportedMedia: true } : {}),
      ...(parsed.includeSelfUpdate === true ? { includeSelfUpdate: true } : {})
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
  if (value === undefined) return Object.freeze({ includeKling4: false, includeWan27VideoEdit: false, includeSeedanceEditor: false,
    includeRunwayI2v: false, includeGrokI2v: false, includeWan25T2vPreview: false, includeHiggsfieldDop: false, includeHailuoInitial: false, includeHappyHorse: false, includeWan27I2v: false, includeSeedance25T2v: false,
    includeKlingMedia: false, includeSwitchxVideo: false, includeActTwo: false, includeHeygen4: false, includeExistingVideoRecovery: false, includeSelfUpdate: false, includeAllSupportedMedia: false });
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length < 1 || keys.some((key) =>
      key !== "includeKling4" && key !== "includeWan27VideoEdit" && key !== "includeSeedanceEditor" &&
      key !== "includeRunwayI2v" && key !== "includeGrokI2v" && key !== "includeWan25T2vPreview" && key !== "includeHiggsfieldDop" && key !== "includeHailuoInitial" && key !== "includeHappyHorse" && key !== "includeWan27I2v" && key !== "includeSeedance25T2v" && key !== "includeKlingMedia" && key !== "includeSwitchxVideo" &&
      key !== "includeActTwo" && key !== "includeHeygen4" && key !== "includeExistingVideoRecovery" && key !== "includeSelfUpdate" && key !== "includeAllSupportedMedia")) throw new Error();
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true || typeof descriptor.value !== "boolean") throw new Error();
    }
    const includeAllSupportedMedia = descriptors.includeAllSupportedMedia?.value ?? false;
    return Object.freeze({ includeKling4: descriptors.includeKling4?.value ?? includeAllSupportedMedia,
      includeWan27VideoEdit: descriptors.includeWan27VideoEdit?.value ?? includeAllSupportedMedia,
      includeSeedanceEditor: descriptors.includeSeedanceEditor?.value ?? includeAllSupportedMedia,
      includeRunwayI2v: descriptors.includeRunwayI2v?.value ?? includeAllSupportedMedia,
      includeGrokI2v: descriptors.includeGrokI2v?.value ?? includeAllSupportedMedia,
      includeWan25T2vPreview: descriptors.includeWan25T2vPreview?.value ?? includeAllSupportedMedia,
      includeHiggsfieldDop: descriptors.includeHiggsfieldDop?.value ?? includeAllSupportedMedia,
      includeHailuoInitial: descriptors.includeHailuoInitial?.value ?? includeAllSupportedMedia,
      includeHappyHorse: descriptors.includeHappyHorse?.value ?? includeAllSupportedMedia,
      includeWan27I2v: descriptors.includeWan27I2v?.value ?? includeAllSupportedMedia,
      includeSeedance25T2v: descriptors.includeSeedance25T2v?.value ?? includeAllSupportedMedia,
      includeKlingMedia: descriptors.includeKlingMedia?.value ?? includeAllSupportedMedia, includeSwitchxVideo: descriptors.includeSwitchxVideo?.value ?? includeAllSupportedMedia,
      includeActTwo: descriptors.includeActTwo?.value ?? includeAllSupportedMedia, includeHeygen4: descriptors.includeHeygen4?.value ?? includeAllSupportedMedia,
      includeExistingVideoRecovery: descriptors.includeExistingVideoRecovery?.value ?? includeAllSupportedMedia,
      includeSelfUpdate: descriptors.includeSelfUpdate?.value ?? false,
      includeAllSupportedMedia });
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
