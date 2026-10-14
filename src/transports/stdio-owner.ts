#!/usr/bin/env node
import { createObservedOwnerRuntime, getObservedOwnerRuntimeStartupCleanup } from "../runtime/observed-owner-runtime.js";
import { loadSelectedGenerationContractRegistry } from "../catalog/generation-contract-history-v2.js";
import type { GenerationContractRegistry } from "../domain/generation-contract.js";
import type { GenerationContractRegistryV2 } from "../domain/generation-contract-v2.js";
import { createMcpServer } from "../mcp/server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Readable } from "node:stream";
import {
  createPrivateOwnerAuthProfileFromEnvironment,
  type PrivateOwnerAuthProfile
} from "../auth/private-owner-auth-profile.js";
import { isMainModule } from "./is-main.js";
import { runStdioServer } from "./stdio.js";
import { withOmittedAuthArguments } from "./omitted-auth-arguments.js";
import { createOwnerDurableSessionManager } from "../runtime/owner-durable-session-manager.js";
import { createOwnerDurableLiveContextFactory } from "../runtime/owner-durable-live-context-factory.js";
import { OwnerDurableLiveGenerationService } from "../application/owner-durable-live-generation-service.js";
import type { OwnerDurableSessionManager } from "../runtime/owner-durable-session-manager.js";
import { closeOwnerDurableSessionOnTransportEof } from "./owner-durable-stdio-lifecycle.js";
import { loadGenerationContractRegistryV2 } from "../catalog/generation-contract-history-v2.js";
import { loadSelectedDiscoveryCatalog } from "../catalog/selected-discovery-catalog.js";
import { getOwnerImageReferenceCandidateStoreBinding } from "../application/owner-image-reference-request-preparer.js";
import { loadOwnerGrokImageReferenceProfileSetV1 } from "../catalog/owner-grok-image-reference-profile-history.js";
import { isAbsolute } from "node:path";

const OWNER_IMAGE_REFERENCE_REGISTRY_VERSION =
  "sha256-0e5b7a6ab56a4fc5103c025690293297b49258c1c876d7a0a663ff7959099d39.json";

const DISABLED_FLAG_VALUES = new Set(["", "0"]);
const CONTRACT_VERSION_PATTERN = /^sha256-[a-f0-9]{64}\.json$/u;
const CONTRACT_SCHEMA_VERSIONS = new Set(["1.0.0", "2.0.0"]);

function readOwnerFlag(name: string): boolean {
  const value = process.env[name];
  if (value === undefined || DISABLED_FLAG_VALUES.has(value)) return false;
  if (value === "1") return true;
  throw new Error(`Invalid ${name} configuration.`);
}

/** Strict default-off gate for the local Clarity paid generation composition. */
export function readOwnerClarityUpscaleFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_CLARITY_UPSCALE configuration.");
}

/** Strict default-off gate for the local Magnific paid-generation composition. */
export function readOwnerMagnificUpscaleFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_MAGNIFIC_UPSCALE configuration.");
}

/** Strict default-off gate for the local reviewed Luma T2V contract tools. */
export function readOwnerLumaT2vFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_LUMA_T2V configuration.");
}

/** Strict default-off gate for the local sealed Hailuo-01 T2V profile. */
export function readOwnerHailuo01T2vFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_HAILUO01_T2V configuration.");
}

/** Strict default-off gate for the local sealed Hailuo-01 Director T2V profile. */
export function readOwnerHailuo01DirectorT2vFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_HAILUO01_DIRECTOR_T2V configuration.");
}

/** Strict default-off gate for the local sealed Hailuo-2.3 T2V profile. */
export function readOwnerHailuo23T2vFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_HAILUO23_T2V configuration.");
}

/** Strict default-off gate for local owner Video2Audio upload/generation/recovery tools. */
export function readOwnerVideo2AudioFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_VIDEO2AUDIO configuration.");
}

/** Strict default-off gate for the local Kontext image-reference generation composition. */
export function readOwnerKontextImageReferencesFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES configuration.");
}

/** Strict default-off gate for the local WAN image-reference generation composition. */
export function readOwnerWanImageReferencesFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_WAN_IMAGE_REFERENCES configuration.");
}

/** Strict default-off gate for the local Banana/GPT Image paid composition. */
export function readOwnerStandardImageReferencesFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_STANDARD_IMAGE_REFERENCES configuration.");
}

/** Strict default-off gate for the local Runway Frames paid image composition. */
export function readOwnerRunwayImageReferencesFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES configuration.");
}

/** Strict default-off gate for the local Seedream image-reference composition. */
export function readOwnerSeedreamImageReferencesFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES configuration.");
}

/** Strict default-off gate for the local Seedream Editor image-reference composition. */
export function readOwnerSeedreamEditorImageReferencesFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_SEEDREAM_EDITOR_IMAGE_REFERENCES configuration.");
}

/** Strict default-off gate for the pinned private WAN T2V generation composition. */
export function readOwnerWanT2vVideosFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_WAN_T2V_VIDEOS configuration.");
}

/** Strict default-off gate for the pinned private ElevenLabs TTS generation composition. */
export function readOwnerElevenLabsTtsFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_ELEVENLABS_TTS configuration.");
}

/** Strict default-off gate for private ElevenLabs STS tools. */
export function readOwnerElevenLabsStsFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_ELEVENLABS_STS configuration.");
}

/** Trusted local STS operator settings; both values are mandatory when enabled. */
export function readOwnerElevenLabsStsOperatorConfiguration(enabled: boolean, ffprobePath: string | undefined,
  destination: string | undefined): Readonly<{ ffprobePath: string; destination: "uploaded" | "hidden" }> | undefined {
  if (!enabled) return undefined;
  if (typeof ffprobePath !== "string" || ffprobePath.length === 0 || !isAbsolute(ffprobePath) ||
      (destination !== "uploaded" && destination !== "hidden")) {
    throw new Error("Invalid SYNTX_OWNER_ELEVENLABS_STS operator configuration.");
  }
  return Object.freeze({ ffprobePath, destination });
}

/** Strict default-off gate for the pinned private Suno generation composition. */
export function readOwnerSunoGenerationFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_SUNO_GENERATION configuration.");
}

/** Strict default-off gate for the local Flux image-reference composition. */
export function readOwnerFluxImageReferencesFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_FLUX_IMAGE_REFERENCES configuration.");
}

/** Strict default-off gate for the local Ideogram image-reference generation composition. */
export function readOwnerIdeogramImageReferencesFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES configuration.");
}

/** Strict default-off gate for the local full-four Grok T2I generation composition. */
export function readOwnerGrokT2iImageReferencesFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_GROK_T2I_IMAGE_REFERENCES configuration.");
}

/** Strict default-off gate for the local Uni image-reference generation composition. */
export function readOwnerUniImageReferencesFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_UNI_IMAGE_REFERENCES configuration.");
}

/** Strict default-off gate for the local Soul image-reference generation composition. */
export function readOwnerSoulImageReferencesFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_SOUL_IMAGE_REFERENCES configuration.");
}

/** Strict default-off gate for the local source-shaped WAN T2I generation tools. */
export function readOwnerWanT2iImageFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_WAN_T2I_IMAGE configuration.");
}

/** Strict default-off gate for the local Banana Inpaint upload/generation composition. */
export function readOwnerBananaInpaintImageReferencesFlag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value === "1") return true;
  throw new Error("Invalid SYNTX_OWNER_BANANA_INPAINT_IMAGE_REFERENCES configuration.");
}

function readOwnerSoulCatalogShapeMaxItems(enabled: boolean): 20 | 128 {
  const value = process.env.SYNTX_OWNER_SOUL_CATALOG_SHAPE_MAX_ITEMS;
  if (value === undefined) return 20;
  if (!enabled) throw new Error("SYNTX_OWNER_SOUL_CATALOG_SHAPE_MAX_ITEMS requires SYNTX_OWNER_SOUL_CATALOG_SHAPE=1.");
  if (value !== "128") throw new Error("SYNTX_OWNER_SOUL_CATALOG_SHAPE_MAX_ITEMS must be exactly 128.");
  return 128;
}

export async function runObservedOwnerStdioServer(input: Readable = process.stdin): Promise<void> {
  // "" or "0" (a plausible way to write "disabled" in a client config) are
  // treated as not set, same as undefined; anything else invalid fails the
  // whole server loudly rather than silently misconfiguring one tool.
  const ownerContractMediaEnabled = readOwnerFlag("SYNTX_OWNER_GENERATE_CONTRACT_MEDIA");
  const ownerDurableGenerationEnabled = readOwnerFlag("SYNTX_OWNER_DURABLE_GENERATION");
  const ownerImageReferencesEnabled = readOwnerFlag("SYNTX_OWNER_IMAGE_REFERENCES");
  const ownerGrokImageReferencesEnabled = readOwnerFlag("SYNTX_OWNER_GROK_IMAGE_REFERENCES");
  const ownerGrokT2iImageReferencesEnabled = readOwnerGrokT2iImageReferencesFlag(
    process.env.SYNTX_OWNER_GROK_T2I_IMAGE_REFERENCES
  );
  const ownerUniImageReferencesEnabled = readOwnerUniImageReferencesFlag(process.env.SYNTX_OWNER_UNI_IMAGE_REFERENCES);
  const ownerClarityUpscaleEnabled = readOwnerClarityUpscaleFlag(process.env.SYNTX_OWNER_CLARITY_UPSCALE);
  const ownerMagnificUpscaleEnabled = readOwnerMagnificUpscaleFlag(process.env.SYNTX_OWNER_MAGNIFIC_UPSCALE);
  const ownerKontextImageReferencesEnabled = readOwnerKontextImageReferencesFlag(
    process.env.SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES
  );
  const ownerWanImageReferencesEnabled = readOwnerWanImageReferencesFlag(
    process.env.SYNTX_OWNER_WAN_IMAGE_REFERENCES
  );
  const ownerStandardImageReferencesEnabled = readOwnerStandardImageReferencesFlag(
    process.env.SYNTX_OWNER_STANDARD_IMAGE_REFERENCES
  );
  const ownerRunwayImageReferencesEnabled = readOwnerRunwayImageReferencesFlag(
    process.env.SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES
  );
  const ownerSeedreamImageReferencesEnabled = readOwnerSeedreamImageReferencesFlag(
    process.env.SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES
  );
  const ownerSeedreamEditorImageReferencesEnabled = readOwnerSeedreamEditorImageReferencesFlag(
    process.env.SYNTX_OWNER_SEEDREAM_EDITOR_IMAGE_REFERENCES
  );
  const ownerWanT2vVideosEnabled = readOwnerWanT2vVideosFlag(process.env.SYNTX_OWNER_WAN_T2V_VIDEOS);
  const ownerElevenLabsTtsEnabled = readOwnerElevenLabsTtsFlag(process.env.SYNTX_OWNER_ELEVENLABS_TTS);
  const ownerElevenLabsDialogueEnabled = readOwnerFlag("SYNTX_OWNER_ELEVENLABS_DIALOGUE");
  const ownerElevenLabsStsEnabled = readOwnerElevenLabsStsFlag(process.env.SYNTX_OWNER_ELEVENLABS_STS);
  const ownerElevenLabsStsOperatorConfiguration = readOwnerElevenLabsStsOperatorConfiguration(
    ownerElevenLabsStsEnabled,
    process.env.SYNTX_OWNER_ELEVENLABS_STS_FFPROBE_PATH,
    process.env.SYNTX_OWNER_ELEVENLABS_STS_UPLOAD_DESTINATION
  );
  const ownerSunoGenerationEnabled = readOwnerSunoGenerationFlag(process.env.SYNTX_OWNER_SUNO_GENERATION);
  const ownerLumaT2vEnabled = readOwnerLumaT2vFlag(process.env.SYNTX_OWNER_LUMA_T2V);
  const ownerHailuo01T2vEnabled = readOwnerHailuo01T2vFlag(process.env.SYNTX_OWNER_HAILUO01_T2V);
  const ownerHailuo01DirectorT2vEnabled = readOwnerHailuo01DirectorT2vFlag(process.env.SYNTX_OWNER_HAILUO01_DIRECTOR_T2V);
  const ownerHailuo23T2vEnabled = readOwnerHailuo23T2vFlag(process.env.SYNTX_OWNER_HAILUO23_T2V);
  const ownerHailuo02T2vEnabled = readOwnerFlag("SYNTX_OWNER_HAILUO02_T2V");
  const ownerSeedance20T2vEnabled = readOwnerFlag("SYNTX_OWNER_SEEDANCE20_T2V");
  const ownerKlingT2vEnabled = readOwnerFlag("SYNTX_OWNER_KLING_T2V");
  const ownerKlingI2vEnabled = readOwnerFlag("SYNTX_OWNER_KLING_I2V");
  const ownerVeoT2vEnabled = readOwnerFlag("SYNTX_OWNER_VEO_T2V");
  const ownerGrokT2vEnabled = readOwnerFlag("SYNTX_OWNER_GROK_T2V");
  const ownerHailuoLiveT2vEnabled = readOwnerFlag("SYNTX_OWNER_HAILUO_LIVE_T2V");
  const ownerVideo2AudioEnabled = readOwnerVideo2AudioFlag(process.env.SYNTX_OWNER_VIDEO2AUDIO);
  const ownerFluxImageReferencesEnabled = readOwnerFluxImageReferencesFlag(
    process.env.SYNTX_OWNER_FLUX_IMAGE_REFERENCES
  );
  const ownerIdeogramImageReferencesEnabled = readOwnerIdeogramImageReferencesFlag(
    process.env.SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES
  );
  const ownerSoulCatalogShapeEnabled = readOwnerFlag("SYNTX_OWNER_SOUL_CATALOG_SHAPE");
  const ownerSoulCatalogShapeMaxItems = readOwnerSoulCatalogShapeMaxItems(ownerSoulCatalogShapeEnabled);
  const ownerSoulStyleOptionsEnabled = readOwnerFlag("SYNTX_OWNER_SOUL_STYLE_OPTIONS");
  const ownerSoulImageReferencesEnabled = readOwnerSoulImageReferencesFlag(process.env.SYNTX_OWNER_SOUL_IMAGE_REFERENCES);
  const ownerWanT2iImageEnabled = readOwnerWanT2iImageFlag(process.env.SYNTX_OWNER_WAN_T2I_IMAGE);
  const ownerBananaInpaintImageReferencesEnabled = readOwnerBananaInpaintImageReferencesFlag(
    process.env.SYNTX_OWNER_BANANA_INPAINT_IMAGE_REFERENCES
  );
  const accountStatusEnabled = readOwnerFlag("SYNTX_OWNER_ACCOUNT_STATUS");
  const uploadedFilesEnabled = readOwnerFlag("SYNTX_OWNER_UPLOADED_FILES");
  const uploadFileEnabled = readOwnerFlag("SYNTX_OWNER_UPLOAD_FILE");
  const reconcileUploadedFileEnabled = readOwnerFlag("SYNTX_OWNER_RECONCILE_UPLOADED_FILE");
  const generateImageEnabled = readOwnerFlag("SYNTX_OWNER_GENERATE_IMAGE");
  const generateVideoEnabled = readOwnerFlag("SYNTX_OWNER_GENERATE_VIDEO");
  if (ownerDurableGenerationEnabled &&
      (ownerContractMediaEnabled || generateImageEnabled || generateVideoEnabled || ownerImageReferencesEnabled ||
        ownerGrokImageReferencesEnabled || ownerGrokT2iImageReferencesEnabled || ownerUniImageReferencesEnabled || ownerClarityUpscaleEnabled || ownerMagnificUpscaleEnabled ||
        ownerKontextImageReferencesEnabled || ownerWanImageReferencesEnabled || ownerStandardImageReferencesEnabled ||
        ownerRunwayImageReferencesEnabled || ownerSeedreamImageReferencesEnabled || ownerSeedreamEditorImageReferencesEnabled ||
        ownerWanT2vVideosEnabled ||
        ownerElevenLabsTtsEnabled || ownerElevenLabsDialogueEnabled || ownerElevenLabsStsEnabled ||
        ownerSunoGenerationEnabled ||
        ownerLumaT2vEnabled ||
        ownerHailuo01T2vEnabled ||
        ownerHailuo01DirectorT2vEnabled ||
        ownerHailuo23T2vEnabled || ownerHailuo02T2vEnabled || ownerSeedance20T2vEnabled || ownerKlingT2vEnabled || ownerKlingI2vEnabled || ownerVeoT2vEnabled || ownerGrokT2vEnabled || ownerHailuoLiveT2vEnabled ||
        ownerVideo2AudioEnabled ||
        ownerFluxImageReferencesEnabled || ownerSoulImageReferencesEnabled ||
        ownerIdeogramImageReferencesEnabled || ownerWanT2iImageEnabled || ownerBananaInpaintImageReferencesEnabled)) {
    throw new Error("Durable owner generation cannot be combined with legacy paid generation tools.");
  }
  if (ownerImageReferencesEnabled) {
    const selected = loadSelectedDiscoveryCatalog();
    const referenceRegistry = loadGenerationContractRegistryV2(OWNER_IMAGE_REFERENCE_REGISTRY_VERSION);
    getOwnerImageReferenceCandidateStoreBinding(referenceRegistry, selected.discoveryCatalog);
  }
  const ownerGrokImageReferenceProfiles = ownerGrokImageReferencesEnabled
    ? loadPinnedOwnerGrokImageReferenceProfiles()
    : undefined;
  const durableRegistry = ownerDurableGenerationEnabled ? loadDurableGenerationRegistryV2() : null;
  const generationContractRegistry = ownerContractMediaEnabled
    ? loadPinnedGenerationContractRegistry()
    : undefined;
  const privateAuthProfile = createPrivateOwnerAuthProfileFromEnvironment();
  if (ownerDurableGenerationEnabled && privateAuthProfile === null) {
    throw new Error("Durable owner generation requires the existing private owner auth profile.");
  }
  let profileTransport: Transport | undefined;
  let closeProfile: (() => void) | undefined;
  let durableManager: OwnerDurableSessionManager | undefined;
  let durableManagerOwnsProfile = false;
  let closeDurableManager: (() => Promise<void>) | undefined;
  let closeOwnerImageReferences: (() => Promise<void>) | undefined;
  let runtime: ReturnType<typeof createObservedOwnerRuntime> | undefined;
  try {
    runtime = createObservedOwnerRuntime({
      accountStatusEnabled,
      uploadedFilesEnabled,
      uploadFileEnabled,
      reconcileUploadedFileEnabled,
      generateImageEnabled,
      generateVideoEnabled,
      ownerContractMediaEnabled,
      ownerImageReferencesEnabled,
      ownerGrokImageReferencesEnabled,
      ownerGrokT2iImageReferencesEnabled,
      ownerUniImageReferencesEnabled,
      ownerSoulCatalogShapeEnabled,
      ownerSoulCatalogShapeMaxItems,
      ownerSoulStyleOptionsEnabled,
      ownerSoulImageReferencesEnabled,
      ownerWanT2iImageEnabled,
      ownerClarityUpscaleEnabled,
      ownerMagnificUpscaleEnabled,
      ownerKontextImageReferencesEnabled,
      ownerWanImageReferencesEnabled,
      ownerStandardImageReferencesEnabled,
      ownerRunwayImageReferencesEnabled,
      ownerSeedreamImageReferencesEnabled,
      ownerSeedreamEditorImageReferencesEnabled,
      ownerWanT2vVideosEnabled,
      ownerElevenLabsTtsEnabled,
      ownerElevenLabsDialogueEnabled,
      ownerElevenLabsStsEnabled,
      ...(ownerElevenLabsStsOperatorConfiguration === undefined ? {} : {
        ownerElevenLabsStsFfprobePath: ownerElevenLabsStsOperatorConfiguration.ffprobePath,
        ownerElevenLabsStsUploadDestination: ownerElevenLabsStsOperatorConfiguration.destination
      }),
      ownerSunoGenerationEnabled,
      ownerLumaT2vEnabled,
      ownerHailuo01T2vEnabled,
      ownerHailuo01DirectorT2vEnabled,
      ownerHailuo23T2vEnabled,
      ownerHailuo02T2vEnabled,
      ownerSeedance20T2vEnabled,
      ownerKlingT2vEnabled,
      ownerKlingI2vEnabled,
      ownerVeoT2vEnabled,
      ownerGrokT2vEnabled,
      ownerHailuoLiveT2vEnabled,
      ownerVideo2AudioEnabled,
      ownerFluxImageReferencesEnabled,
      ownerIdeogramImageReferencesEnabled,
      ownerBananaInpaintImageReferencesEnabled,
      ...(ownerGrokImageReferenceProfiles === undefined ? {} : { ownerGrokImageReferenceProfiles }),
      ...(generationContractRegistry === undefined ? {} : { generationContractRegistry }),
      ...(privateAuthProfile === null ? {} : {
        authStore: privateAuthProfile.store,
        authBinding: privateAuthProfile.binding
      })
    });
    if (privateAuthProfile === null) {
      const referenceService = runtime.serverOptions.ownerImageReferences;
      const grokReferenceService = runtime.serverOptions.ownerGrokImageReferences;
      const grokT2iImageReferencesService = runtime.serverOptions.ownerGrokT2iImageReferences?.generationService;
      const uniImageReferencesService = runtime.serverOptions.ownerUniImageReferences?.generationService;
      const soulImageGenerationService = runtime.serverOptions.ownerSoulImageReferences?.generationService;
      const wanT2iImageGenerationService = runtime.serverOptions.ownerWanT2iImageReferences?.generationService;
      const soulShapeService = runtime.serverOptions.ownerSoulCatalogShape;
      const soulStyleOptionsService = soulImageGenerationService === undefined ? runtime.serverOptions.ownerSoulStyleOptions : undefined;
      const clarityUpscaleService = runtime.serverOptions.ownerClarityUpscale?.generationService;
      const magnificUpscaleService = runtime.serverOptions.ownerMagnificUpscale?.generationService;
      const kontextImageReferencesService = runtime.serverOptions.ownerKontextImageReferences?.generationService;
      const wanImageReferencesService = runtime.serverOptions.ownerWanImageReferences?.generationService;
      const standardImageReferencesService = runtime.serverOptions.ownerStandardImageReferences?.generationService;
      const runwayImageReferencesService = runtime.serverOptions.ownerRunwayImageReferences?.generationService;
      const seedreamImageReferencesService = runtime.serverOptions.ownerSeedreamImageReferences?.generationService;
      const seedreamEditorImageReferencesService = runtime.serverOptions.ownerSeedreamEditorImageReferences?.generationService;
      const wanT2vVideosService = runtime.serverOptions.ownerWanT2vVideos?.generationService;
      const elevenLabsTtsService = runtime.serverOptions.ownerElevenLabsTts?.generationService;
      const elevenLabsDialogueService = runtime.serverOptions.ownerElevenLabsDialogue?.generationService;
      const elevenLabsStsGenerationService = runtime.serverOptions.ownerElevenLabsSts?.generationService;
      const sunoGenerationService = runtime.serverOptions.ownerSunoGeneration?.generationService;
      const lumaT2vGenerationService = runtime.serverOptions.ownerLumaT2v?.generationService;
      const hailuo01T2vGenerationService = runtime.serverOptions.ownerHailuo01T2v?.generationService;
      const hailuo01DirectorT2vGenerationService = runtime.serverOptions.ownerHailuo01DirectorT2v?.generationService;
      const hailuo23T2vGenerationService = runtime.serverOptions.ownerHailuo23T2v?.generationService;
      const hailuo02T2vGenerationService = runtime.serverOptions.ownerHailuo02T2v?.generationService;
      const seedance20T2vGenerationService = runtime.serverOptions.ownerSeedance20T2v?.generationService;
      const klingT2vGenerationService = runtime.serverOptions.ownerKlingT2v?.generationService;
      const klingI2vGenerationService = runtime.serverOptions.ownerKlingI2v?.generationService;
      const veoT2vGenerationService = runtime.serverOptions.ownerVeoT2v?.generationService;
      const grokT2vGenerationService = runtime.serverOptions.ownerGrokT2v?.generationService;
      const hailuoLiveT2vGenerationService = runtime.serverOptions.ownerHailuoLiveT2v?.generationService;
      const video2AudioGenerationService = runtime.serverOptions.ownerVideo2Audio?.generationService;
      const fluxImageReferencesService = runtime.serverOptions.ownerFluxImageReferences?.generationService;
      const ideogramImageReferencesService = runtime.serverOptions.ownerIdeogramImageReferences?.generationService;
      const bananaInpaintImageGenerationService = runtime.serverOptions.ownerBananaInpaintImageReferences?.generationService;
      if (referenceService === undefined && grokReferenceService === undefined && grokT2iImageReferencesService === undefined && uniImageReferencesService === undefined &&
          soulImageGenerationService === undefined && soulShapeService === undefined && soulStyleOptionsService === undefined && clarityUpscaleService === undefined &&
          wanT2iImageGenerationService === undefined &&
          magnificUpscaleService === undefined && kontextImageReferencesService === undefined &&
          wanImageReferencesService === undefined && standardImageReferencesService === undefined &&
          runwayImageReferencesService === undefined && seedreamImageReferencesService === undefined &&
          seedreamEditorImageReferencesService === undefined &&
          wanT2vVideosService === undefined &&
          elevenLabsTtsService === undefined && elevenLabsDialogueService === undefined &&
          elevenLabsStsGenerationService === undefined &&
          sunoGenerationService === undefined &&
          lumaT2vGenerationService === undefined &&
          hailuo01T2vGenerationService === undefined &&
          hailuo01DirectorT2vGenerationService === undefined &&
          hailuo23T2vGenerationService === undefined && hailuo02T2vGenerationService === undefined && seedance20T2vGenerationService === undefined && klingT2vGenerationService === undefined && klingI2vGenerationService === undefined && veoT2vGenerationService === undefined && grokT2vGenerationService === undefined && hailuoLiveT2vGenerationService === undefined &&
          video2AudioGenerationService === undefined &&
          fluxImageReferencesService === undefined && ideogramImageReferencesService === undefined &&
          bananaInpaintImageGenerationService === undefined) {
        await runStdioServer(runtime.application, runtime.serverOptions);
        return;
      }
      const server = createMcpServer(runtime.application, runtime.serverOptions);
      profileTransport = withOmittedAuthArguments(new StdioServerTransport(input));
      closeOwnerImageReferences = closeOwnerReadServicesOnTransportEof(
        profileTransport,
        referenceService,
        grokReferenceService,
        soulShapeService,
        soulStyleOptionsService,
        undefined,
        input,
        clarityUpscaleService,
        magnificUpscaleService,
        kontextImageReferencesService,
        wanImageReferencesService,
        standardImageReferencesService,
        runwayImageReferencesService,
        seedreamImageReferencesService,
        fluxImageReferencesService,
        ideogramImageReferencesService,
        grokT2iImageReferencesService,
        uniImageReferencesService,
        soulImageGenerationService,
        soulImageGenerationService !== undefined || wanT2iImageGenerationService !== undefined ||
          bananaInpaintImageGenerationService !== undefined || seedreamEditorImageReferencesService !== undefined ||
          elevenLabsTtsService !== undefined || elevenLabsDialogueService !== undefined || sunoGenerationService !== undefined || lumaT2vGenerationService !== undefined ||
          hailuo01T2vGenerationService !== undefined || hailuo01DirectorT2vGenerationService !== undefined || hailuo23T2vGenerationService !== undefined || hailuo02T2vGenerationService !== undefined || seedance20T2vGenerationService !== undefined || klingT2vGenerationService !== undefined || klingI2vGenerationService !== undefined || veoT2vGenerationService !== undefined ||
          video2AudioGenerationService !== undefined,
        wanT2iImageGenerationService,
        bananaInpaintImageGenerationService,
        runtime.ownerSeedreamEditorImageReferencesLifecycle,
        runtime.ownerWanT2vVideosLifecycle,
        runtime.ownerElevenLabsTtsLifecycle,
        runtime.ownerSunoGenerationLifecycle,
        runtime.ownerLumaT2vLifecycle,
        runtime.ownerHailuo01T2vLifecycle,
        runtime.ownerHailuo01DirectorT2vLifecycle,
        runtime.ownerHailuo23T2vLifecycle,
        runtime.ownerVideo2AudioLifecycle,
        runtime.ownerHailuo02T2vLifecycle,
        runtime.ownerElevenLabsDialogueLifecycle,
        runtime.ownerElevenLabsStsLifecycle,
        runtime.ownerSeedance20T2vLifecycle,
        runtime.ownerKlingT2vLifecycle,
        runtime.ownerVeoT2vLifecycle,
        runtime.ownerGrokT2vLifecycle,
        runtime.ownerHailuoLiveT2vLifecycle,
        runtime.ownerKlingI2vLifecycle
      );
      await server.connect(profileTransport);
      return;
    }

    let serverOptions = runtime.serverOptions;
    if (ownerDurableGenerationEnabled) {
      const managerPromise = createOwnerDurableSessionManager({
        authProfile: privateAuthProfile,
        linkService: runtime.linkService,
        catalog: runtime.catalog,
        registry: durableRegistry,
        createContext: createOwnerDurableLiveContextFactory({ fetchImpl: globalThis.fetch })
      });
      durableManagerOwnsProfile = true;
      durableManager = await managerPromise;
      const durableService = new OwnerDurableLiveGenerationService(
        durableManager,
        durableRegistry,
        durableRegistry === null ? null : runtime.catalogVersion
      );
      serverOptions = {
        ...serverOptions,
        ...(durableRegistry === null ? {} : { generationContractRegistryV2: durableRegistry }),
        ownerDurableGeneration: durableService
      };
    }
    const server = createMcpServer(runtime.application, serverOptions);
    profileTransport = withOmittedAuthArguments(new StdioServerTransport(input));
    if (durableManager === undefined) {
      const referenceService = runtime.serverOptions.ownerImageReferences;
      const grokReferenceService = runtime.serverOptions.ownerGrokImageReferences;
      const grokT2iImageReferencesService = runtime.serverOptions.ownerGrokT2iImageReferences?.generationService;
      const uniImageReferencesService = runtime.serverOptions.ownerUniImageReferences?.generationService;
      const soulImageGenerationService = runtime.serverOptions.ownerSoulImageReferences?.generationService;
      const wanT2iImageGenerationService = runtime.serverOptions.ownerWanT2iImageReferences?.generationService;
      const soulShapeService = runtime.serverOptions.ownerSoulCatalogShape;
      const soulStyleOptionsService = soulImageGenerationService === undefined ? runtime.serverOptions.ownerSoulStyleOptions : undefined;
      const clarityUpscaleService = runtime.serverOptions.ownerClarityUpscale?.generationService;
      const magnificUpscaleService = runtime.serverOptions.ownerMagnificUpscale?.generationService;
      const kontextImageReferencesService = runtime.serverOptions.ownerKontextImageReferences?.generationService;
      const wanImageReferencesService = runtime.serverOptions.ownerWanImageReferences?.generationService;
      const standardImageReferencesService = runtime.serverOptions.ownerStandardImageReferences?.generationService;
      const runwayImageReferencesService = runtime.serverOptions.ownerRunwayImageReferences?.generationService;
      const seedreamImageReferencesService = runtime.serverOptions.ownerSeedreamImageReferences?.generationService;
      const seedreamEditorImageReferencesService = runtime.serverOptions.ownerSeedreamEditorImageReferences?.generationService;
      const wanT2vVideosService = runtime.serverOptions.ownerWanT2vVideos?.generationService;
      const elevenLabsTtsService = runtime.serverOptions.ownerElevenLabsTts?.generationService;
      const elevenLabsDialogueService = runtime.serverOptions.ownerElevenLabsDialogue?.generationService;
      const elevenLabsStsGenerationService = runtime.serverOptions.ownerElevenLabsSts?.generationService;
      const sunoGenerationService = runtime.serverOptions.ownerSunoGeneration?.generationService;
      const lumaT2vGenerationService = runtime.serverOptions.ownerLumaT2v?.generationService;
      const hailuo01T2vGenerationService = runtime.serverOptions.ownerHailuo01T2v?.generationService;
      const hailuo01DirectorT2vGenerationService = runtime.serverOptions.ownerHailuo01DirectorT2v?.generationService;
      const hailuo23T2vGenerationService = runtime.serverOptions.ownerHailuo23T2v?.generationService;
      const hailuo02T2vGenerationService = runtime.serverOptions.ownerHailuo02T2v?.generationService;
      const seedance20T2vGenerationService = runtime.serverOptions.ownerSeedance20T2v?.generationService;
      const klingT2vGenerationService = runtime.serverOptions.ownerKlingT2v?.generationService;
      const klingI2vGenerationService = runtime.serverOptions.ownerKlingI2v?.generationService;
      const veoT2vGenerationService = runtime.serverOptions.ownerVeoT2v?.generationService;
      const grokT2vGenerationService = runtime.serverOptions.ownerGrokT2v?.generationService;
      const hailuoLiveT2vGenerationService = runtime.serverOptions.ownerHailuoLiveT2v?.generationService;
      const video2AudioGenerationService = runtime.serverOptions.ownerVideo2Audio?.generationService;
      const fluxImageReferencesService = runtime.serverOptions.ownerFluxImageReferences?.generationService;
      const ideogramImageReferencesService = runtime.serverOptions.ownerIdeogramImageReferences?.generationService;
      const bananaInpaintImageGenerationService = runtime.serverOptions.ownerBananaInpaintImageReferences?.generationService;
      if (referenceService === undefined && grokReferenceService === undefined && grokT2iImageReferencesService === undefined && uniImageReferencesService === undefined &&
          soulImageGenerationService === undefined && soulShapeService === undefined && soulStyleOptionsService === undefined && clarityUpscaleService === undefined &&
          wanT2iImageGenerationService === undefined &&
          magnificUpscaleService === undefined && kontextImageReferencesService === undefined &&
          wanImageReferencesService === undefined && standardImageReferencesService === undefined &&
          runwayImageReferencesService === undefined && seedreamImageReferencesService === undefined &&
          seedreamEditorImageReferencesService === undefined &&
          wanT2vVideosService === undefined &&
          elevenLabsTtsService === undefined && elevenLabsDialogueService === undefined &&
          elevenLabsStsGenerationService === undefined &&
          sunoGenerationService === undefined &&
          lumaT2vGenerationService === undefined &&
          hailuo01T2vGenerationService === undefined &&
          hailuo01DirectorT2vGenerationService === undefined &&
          hailuo23T2vGenerationService === undefined && hailuo02T2vGenerationService === undefined && seedance20T2vGenerationService === undefined && klingT2vGenerationService === undefined && klingI2vGenerationService === undefined && veoT2vGenerationService === undefined && grokT2vGenerationService === undefined && hailuoLiveT2vGenerationService === undefined &&
          video2AudioGenerationService === undefined &&
          fluxImageReferencesService === undefined && ideogramImageReferencesService === undefined &&
          bananaInpaintImageGenerationService === undefined) {
        closeProfile = closePrivateOwnerAuthProfileOnTransportEof(profileTransport, privateAuthProfile, input);
      } else {
        closeOwnerImageReferences = closeOwnerReadServicesOnTransportEof(
          profileTransport,
          referenceService,
          grokReferenceService,
          soulShapeService,
          soulStyleOptionsService,
          () => privateAuthProfile.close(),
          input,
          clarityUpscaleService,
          magnificUpscaleService,
          kontextImageReferencesService,
          wanImageReferencesService,
          standardImageReferencesService,
          runwayImageReferencesService,
          seedreamImageReferencesService,
          fluxImageReferencesService,
          ideogramImageReferencesService,
          grokT2iImageReferencesService,
          uniImageReferencesService,
          soulImageGenerationService,
          soulImageGenerationService !== undefined || wanT2iImageGenerationService !== undefined ||
            bananaInpaintImageGenerationService !== undefined || seedreamEditorImageReferencesService !== undefined ||
            elevenLabsTtsService !== undefined || elevenLabsDialogueService !== undefined || sunoGenerationService !== undefined || lumaT2vGenerationService !== undefined ||
            hailuo01T2vGenerationService !== undefined || hailuo01DirectorT2vGenerationService !== undefined || hailuo23T2vGenerationService !== undefined || hailuo02T2vGenerationService !== undefined || seedance20T2vGenerationService !== undefined || klingT2vGenerationService !== undefined || klingI2vGenerationService !== undefined || veoT2vGenerationService !== undefined ||
          video2AudioGenerationService !== undefined,
          wanT2iImageGenerationService,
          bananaInpaintImageGenerationService,
          runtime.ownerSeedreamEditorImageReferencesLifecycle,
          runtime.ownerWanT2vVideosLifecycle,
          runtime.ownerElevenLabsTtsLifecycle,
          runtime.ownerSunoGenerationLifecycle,
          runtime.ownerLumaT2vLifecycle,
          runtime.ownerHailuo01T2vLifecycle,
          runtime.ownerHailuo01DirectorT2vLifecycle,
          runtime.ownerHailuo23T2vLifecycle,
          runtime.ownerVideo2AudioLifecycle,
          runtime.ownerHailuo02T2vLifecycle,
          runtime.ownerElevenLabsDialogueLifecycle,
          runtime.ownerElevenLabsStsLifecycle,
          runtime.ownerSeedance20T2vLifecycle,
          runtime.ownerKlingT2vLifecycle,
          runtime.ownerVeoT2vLifecycle,
          runtime.ownerGrokT2vLifecycle,
          runtime.ownerHailuoLiveT2vLifecycle,
          runtime.ownerKlingI2vLifecycle
        );
      }
    } else {
      closeDurableManager = closeOwnerDurableSessionOnTransportEof(
        profileTransport,
        async () => {
          const errors: unknown[] = [];
          try { await runtime?.serverOptions.ownerSoulCatalogShape?.close(); } catch (error) { errors.push(error); }
          try { await runtime?.serverOptions.ownerSoulStyleOptions?.close(); } catch (error) { errors.push(error); }
          try { await durableManager!.close(); } catch (error) { errors.push(error); }
          if (errors.length === 1) throw errors[0];
          if (errors.length > 1) throw new AggregateError(errors, "Owner Soul and durable services did not close cleanly.");
        },
        input
      );
    }
    await server.connect(profileTransport);
  } catch (error) {
    let cleanupError: unknown;
    const startupCleanup = getObservedOwnerRuntimeStartupCleanup(error);
    if (startupCleanup !== undefined) {
      try { await startupCleanup; } catch (closeError) { cleanupError = closeError; }
    }
    if (closeOwnerImageReferences !== undefined) {
      try { await closeOwnerImageReferences(); } catch (closeError) { cleanupError = closeError; }
    } else if (runtime !== undefined) {
      for (const service of [runtime.serverOptions.ownerImageReferences, runtime.serverOptions.ownerGrokImageReferences,
        runtime.serverOptions.ownerSoulImageReferences?.generationService,
        runtime.serverOptions.ownerGrokT2iImageReferences?.generationService,
        runtime.serverOptions.ownerWanT2iImageReferences?.generationService,
        runtime.serverOptions.ownerUniImageReferences?.generationService,
        runtime.serverOptions.ownerSoulCatalogShape,
        ...(runtime.serverOptions.ownerSoulImageReferences === undefined ? [runtime.serverOptions.ownerSoulStyleOptions] : []),
        runtime.serverOptions.ownerClarityUpscale?.generationService,
        runtime.serverOptions.ownerMagnificUpscale?.generationService,
        runtime.serverOptions.ownerKontextImageReferences?.generationService,
        runtime.serverOptions.ownerWanImageReferences?.generationService,
        runtime.serverOptions.ownerStandardImageReferences?.generationService,
        runtime.serverOptions.ownerRunwayImageReferences?.generationService,
        runtime.serverOptions.ownerSeedreamImageReferences?.generationService,
        runtime.ownerSeedreamEditorImageReferencesLifecycle,
        runtime.ownerWanT2vVideosLifecycle,
        runtime.ownerElevenLabsTtsLifecycle,
        runtime.ownerSunoGenerationLifecycle,
        runtime.ownerLumaT2vLifecycle,
        runtime.ownerHailuo01T2vLifecycle,
        runtime.ownerHailuo01DirectorT2vLifecycle,
        runtime.ownerHailuo23T2vLifecycle,
        runtime.ownerVideo2AudioLifecycle,
        runtime.ownerHailuo02T2vLifecycle,
        runtime.ownerElevenLabsDialogueLifecycle,
        runtime.ownerElevenLabsStsLifecycle,
        runtime.ownerSeedance20T2vLifecycle,
        runtime.ownerKlingT2vLifecycle,
        runtime.ownerVeoT2vLifecycle,
        runtime.ownerGrokT2vLifecycle,
        runtime.ownerHailuoLiveT2vLifecycle,
        runtime.ownerKlingI2vLifecycle,
        runtime.serverOptions.ownerFluxImageReferences?.generationService,
        runtime.serverOptions.ownerIdeogramImageReferences?.generationService,
        runtime.serverOptions.ownerBananaInpaintImageReferences?.generationService]) {
        if (service === undefined) continue;
        try { await service.close(); } catch (closeError) { cleanupError ??= closeError; }
      }
    }
    if (privateAuthProfile !== null) {
      if (profileTransport !== undefined) {
        try { await profileTransport.close(); } catch (closeError) { cleanupError = closeError; }
      }
      if (durableManager !== undefined) {
        try {
          if (closeDurableManager !== undefined) await closeDurableManager();
          else await durableManager.close();
        } catch (closeError) { cleanupError ??= closeError; }
      } else if (!durableManagerOwnsProfile && closeOwnerImageReferences === undefined) {
        if (closeProfile !== undefined) {
          try { closeProfile(); } catch (closeError) { cleanupError ??= closeError; }
        } else {
          try { privateAuthProfile.close(); } catch (closeError) { cleanupError ??= closeError; }
        }
      }
    }
    if (cleanupError !== undefined) {
      throw new AggregateError([error, cleanupError], "Owner stdio startup failed and cleanup was incomplete.");
    }
    throw error;
  }
}

/** Attach profile cleanup to stdio EOF without replacing the existing handler. */
export function closePrivateOwnerAuthProfileOnTransportEof(
  transport: Transport,
  profile: PrivateOwnerAuthProfile,
  input: Readable = process.stdin
): () => void {
  const originalOnClose = transport.onclose;
  let closeRequested = false;
  let originalCloseCalled = false;
  let profileCloseAttempted = false;
  let profileCloseError: unknown;
  const closeProfileOnce = (): void => {
    input.off("end", onInputEnd);
    if (profileCloseAttempted) {
      if (profileCloseError !== undefined) throw profileCloseError;
      return;
    }
    profileCloseAttempted = true;
    try { profile.close(); }
    catch (error) {
      profileCloseError = error;
      throw error;
    }
  };
  const onInputEnd = (): void => {
    if (closeRequested) return;
    closeRequested = true;
    void transport.close().catch(() => {
      process.exitCode = 1;
      try { closeProfileOnce(); } catch { process.exitCode = 1; }
    });
  };
  input.on("end", onInputEnd);
  transport.onclose = () => {
    try {
      if (!originalCloseCalled) {
        originalCloseCalled = true;
        originalOnClose?.();
      }
    }
    finally {
      try { closeProfileOnce(); }
      catch { process.exitCode = 1; }
    }
  };
  return closeProfileOnce;
}

/** Close request-scoped reference state before releasing the owner auth profile. */
export function closeOwnerImageReferenceServiceOnTransportEof(
  transport: Transport,
  service: { close(): Promise<void> },
  closeAfter?: () => void,
  input: Readable = process.stdin,
  closeAfterOnlyOnSuccessfulDrain = false
): () => Promise<void> {
  const originalOnClose = transport.onclose;
  let closePromise: Promise<void> | undefined;
  let closeRequested = false;
  let originalCloseCalled = false;
  const reportFailure = (): void => { process.exitCode = 1; };
  const closeOnce = (): Promise<void> => {
    input.off("end", onInputEnd);
    if (closePromise !== undefined) return closePromise;
    closePromise = Promise.resolve().then(async () => {
      let referenceCloseError: unknown;
      try { await service.close(); } catch (error) { referenceCloseError = error; }
      if (!closeAfterOnlyOnSuccessfulDrain || referenceCloseError === undefined) {
        try { closeAfter?.(); }
        catch (error) {
          if (referenceCloseError !== undefined) {
            throw new AggregateError([referenceCloseError, error], "Owner reference shutdown was incomplete.");
          }
          throw error;
        }
      }
      if (referenceCloseError !== undefined) throw referenceCloseError;
    });
    void closePromise.catch(reportFailure);
    return closePromise;
  };
  const onInputEnd = (): void => {
    if (closeRequested) return;
    closeRequested = true;
    void (async () => {
      try { await closeOnce(); } catch { reportFailure(); }
      try { await transport.close(); } catch { reportFailure(); }
    })().catch(reportFailure);
  };

  input.on("end", onInputEnd);
  transport.onclose = () => {
    try {
      if (!originalCloseCalled) {
        originalCloseCalled = true;
        originalOnClose?.();
      }
    } catch { reportFailure(); }
    void closeOnce().catch(reportFailure);
  };
  return closeOnce;
}

/** Close both opt-in reference services before releasing the owner auth profile. */
export function closeOwnerImageReferenceServicesOnTransportEof(
  transport: Transport,
  imageService: { close(): Promise<void> } | undefined,
  grokService: { close(): Promise<void> } | undefined,
  closeAfter?: () => void,
  input: Readable = process.stdin
): () => Promise<void> {
  if (imageService === undefined && grokService === undefined) {
    throw new Error("OWNER_REFERENCE_SERVICE_REQUIRED");
  }
  return closeOwnerImageReferenceServiceOnTransportEof(
    transport,
    {
      async close() {
        const errors: unknown[] = [];
        for (const service of [imageService, grokService]) {
          if (service === undefined) continue;
          try { await service.close(); } catch (error) { errors.push(error); }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, "Owner reference services did not close cleanly.");
      }
    },
    closeAfter,
    input
  );
}

/** Close all explicitly enabled owner read services before releasing auth. */
export function closeOwnerReadServicesOnTransportEof(
  transport: Transport,
  imageService: { close(): Promise<void> } | undefined,
  grokService: { close(): Promise<void> } | undefined,
  soulShapeService: { close(): Promise<void> } | undefined,
  soulStyleOptionsService: { close(): Promise<void> } | undefined,
  closeAfter?: () => void,
  input: Readable = process.stdin,
  clarityUpscaleService?: { close(): Promise<void> } | undefined,
  magnificUpscaleService?: { close(): Promise<void> } | undefined,
  kontextImageReferencesService?: { close(): Promise<void> } | undefined,
  wanImageReferencesService?: { close(): Promise<void> } | undefined,
  standardImageReferencesService?: { close(): Promise<void> } | undefined,
  runwayImageReferencesService?: { close(): Promise<void> } | undefined,
  seedreamImageReferencesService?: { close(): Promise<void> } | undefined,
  fluxImageReferencesService?: { close(): Promise<void> } | undefined,
  ideogramImageReferencesService?: { close(): Promise<void> } | undefined,
  grokT2iImageReferencesService?: { close(): Promise<void> } | undefined,
  uniImageReferencesService?: { close(): Promise<void> } | undefined,
  soulImageGenerationService?: { close(): Promise<void> } | undefined,
  retainAuthOnCloseFailure = false,
  wanT2iImageGenerationService?: { close(): Promise<void> } | undefined,
  bananaInpaintImageGenerationService?: { close(): Promise<void> } | undefined,
  seedreamEditorImageReferencesLifecycle?: { close(): Promise<void> } | undefined,
  wanT2vVideosLifecycle?: { close(): Promise<void> } | undefined,
  elevenLabsTtsLifecycle?: { close(): Promise<void> } | undefined,
  ownerSunoGenerationLifecycle?: { close(): Promise<void> } | undefined,
  ownerLumaT2vLifecycle?: { close(): Promise<void> } | undefined,
  ownerHailuo01T2vLifecycle?: { close(): Promise<void> } | undefined,
  ownerHailuo01DirectorT2vLifecycle?: { close(): Promise<void> } | undefined,
  ownerHailuo23T2vLifecycle?: { close(): Promise<void> } | undefined,
  ownerVideo2AudioLifecycle?: { close(): Promise<void> } | undefined,
  ownerHailuo02T2vLifecycle?: { close(): Promise<void> } | undefined,
  ownerElevenLabsDialogueLifecycle?: { close(): Promise<void> } | undefined,
  ownerElevenLabsStsLifecycle?: { close(): Promise<void> } | undefined,
  ownerSeedance20T2vLifecycle?: { close(): Promise<void> } | undefined,
  ownerKlingT2vLifecycle?: { close(): Promise<void> } | undefined,
  ownerVeoT2vLifecycle?: { close(): Promise<void> } | undefined,
  ownerGrokT2vLifecycle?: { close(): Promise<void> } | undefined,
  ownerHailuoLiveT2vLifecycle?: { close(): Promise<void> } | undefined,
  ownerKlingI2vLifecycle?: { close(): Promise<void> } | undefined
): () => Promise<void> {
  if (soulImageGenerationService === undefined && imageService === undefined && grokService === undefined && soulShapeService === undefined &&
      soulStyleOptionsService === undefined && clarityUpscaleService === undefined && magnificUpscaleService === undefined &&
      kontextImageReferencesService === undefined && wanImageReferencesService === undefined &&
      standardImageReferencesService === undefined && runwayImageReferencesService === undefined &&
      seedreamImageReferencesService === undefined && fluxImageReferencesService === undefined &&
      ideogramImageReferencesService === undefined && grokT2iImageReferencesService === undefined &&
      uniImageReferencesService === undefined && wanT2iImageGenerationService === undefined &&
      bananaInpaintImageGenerationService === undefined && seedreamEditorImageReferencesLifecycle === undefined &&
      wanT2vVideosLifecycle === undefined && elevenLabsTtsLifecycle === undefined && ownerSunoGenerationLifecycle === undefined &&
      ownerLumaT2vLifecycle === undefined && ownerHailuo01T2vLifecycle === undefined && ownerHailuo01DirectorT2vLifecycle === undefined &&
      ownerHailuo23T2vLifecycle === undefined && ownerVideo2AudioLifecycle === undefined && ownerHailuo02T2vLifecycle === undefined && ownerElevenLabsDialogueLifecycle === undefined && ownerElevenLabsStsLifecycle === undefined && ownerSeedance20T2vLifecycle === undefined && ownerKlingT2vLifecycle === undefined && ownerVeoT2vLifecycle === undefined && ownerGrokT2vLifecycle === undefined && ownerHailuoLiveT2vLifecycle === undefined && ownerKlingI2vLifecycle === undefined) {
    throw new Error("OWNER_READ_SERVICE_REQUIRED");
  }
  return closeOwnerImageReferenceServiceOnTransportEof(
    transport,
    {
      async close() {
        const errors: unknown[] = [];
        for (const service of [soulImageGenerationService, wanT2iImageGenerationService, bananaInpaintImageGenerationService,
          seedreamEditorImageReferencesLifecycle, wanT2vVideosLifecycle, elevenLabsTtsLifecycle, ownerSunoGenerationLifecycle,
          ownerLumaT2vLifecycle, ownerHailuo01T2vLifecycle,
          ownerHailuo01DirectorT2vLifecycle, ownerHailuo23T2vLifecycle, ownerVideo2AudioLifecycle, ownerHailuo02T2vLifecycle, ownerElevenLabsDialogueLifecycle, ownerElevenLabsStsLifecycle, ownerSeedance20T2vLifecycle, ownerKlingT2vLifecycle, ownerVeoT2vLifecycle, ownerGrokT2vLifecycle, ownerHailuoLiveT2vLifecycle, ownerKlingI2vLifecycle,
          imageService, grokService, soulShapeService, soulStyleOptionsService,
          clarityUpscaleService, magnificUpscaleService, kontextImageReferencesService, wanImageReferencesService,
          standardImageReferencesService, runwayImageReferencesService, seedreamImageReferencesService,
          fluxImageReferencesService, ideogramImageReferencesService, grokT2iImageReferencesService,
          uniImageReferencesService]) {
          if (service === undefined) continue;
          try { await service.close(); } catch (error) { errors.push(error); }
        }
        if (retainAuthOnCloseFailure && errors.length > 0) {
          if (errors.length === 1) throw errors[0];
          throw new AggregateError(errors, "Owner service drain failed; the authentication profile remains open.");
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new AggregateError(errors, "Owner read services did not close cleanly.");
      }
    },
    closeAfter,
    input,
    retainAuthOnCloseFailure
  );
}

function loadPinnedGenerationContractRegistry(): GenerationContractRegistry | GenerationContractRegistryV2 {
  const version = process.env.SYNTX_GENERATION_CONTRACT_VERSION;
  if (typeof version !== "string" || !CONTRACT_VERSION_PATTERN.test(version)) {
    throw new Error("A hash-pinned SYNTX_GENERATION_CONTRACT_VERSION is required for owner contract media.");
  }
  const schemaVersion = process.env.SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION ?? "1.0.0";
  if (!CONTRACT_SCHEMA_VERSIONS.has(schemaVersion)) {
    throw new Error("SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION must be exactly 1.0.0 or 2.0.0.");
  }
  return loadSelectedGenerationContractRegistry(version, schemaVersion);
}

function loadPinnedOwnerGrokImageReferenceProfiles() {
  const version = process.env.SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION;
  if (typeof version !== "string" || !CONTRACT_VERSION_PATTERN.test(version)) {
    throw new Error("A hash-pinned SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION is required when Grok image references are enabled.");
  }
  const selected = loadSelectedDiscoveryCatalog();
  return loadOwnerGrokImageReferenceProfileSetV1(version, selected.discoveryCatalog);
}

function loadDurableGenerationRegistryV2(): GenerationContractRegistryV2 | null {
  const version = process.env.SYNTX_GENERATION_CONTRACT_VERSION;
  const configuredSchemaVersion = process.env.SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION;
  if (version === undefined) {
    if (configuredSchemaVersion !== undefined) {
      throw new Error("A V2 hash-pinned SYNTX_GENERATION_CONTRACT_VERSION is required when a schema version is supplied.");
    }
    return null;
  }
  if (!CONTRACT_VERSION_PATTERN.test(version)) {
    throw new Error("A hash-pinned SYNTX_GENERATION_CONTRACT_VERSION is required for durable owner generation.");
  }
  if (configuredSchemaVersion !== undefined && configuredSchemaVersion !== "2.0.0") {
    throw new Error("Durable owner generation requires SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION 2.0.0.");
  }
  return loadSelectedGenerationContractRegistry(version, "2.0.0") as GenerationContractRegistryV2;
}

if (isMainModule(import.meta.url)) {
  runObservedOwnerStdioServer().catch(() => {
    console.error("Failed to start the local owner SYNTX MCP server.");
    process.exitCode = 1;
  });
}
