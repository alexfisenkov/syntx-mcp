import { createHash } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";
import type { AuthBinding } from "../auth/types.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import type { PerUserLinkService } from "../auth/link-service.js";
import type { SyntxSubscription } from "../adapter/syntx/account-decoder.js";
import { GenerationContractExecutorV2 } from "../adapter/syntx/generation-contract-executor-v2.js";
import type { SyntxCostParameter } from "../adapter/syntx/http-client.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import {
  createGenerationContractRegistryV2,
  serializeGenerationContractRegistryV2,
  type GenerationContractRegistryV2,
  type GenerationContractV2Input
} from "../domain/generation-contract-v2.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import type { ModelAccessResult } from "./model-access.js";
import { OwnerGenerationPreflightError } from "./owner-generation-preflight.js";
import {
  normalizeOwnerLumaT2vGenerationParameters,
  getOwnerLumaT2vGenerationParametersSource,
  type OwnerLumaT2vGenerationAspectRatio,
  type OwnerLumaT2vGenerationDuration,
  type OwnerLumaT2vGenerationQuality,
  type OwnerLumaT2vGenerationSourceContract
} from "./owner-luma-t2v-generation-parameters.js";
import {
  OwnerContractMediaError,
  OwnerContractMediaService,
  type OwnerContractMediaClient,
  type OwnerContractMediaContractContext,
  type OwnerContractMediaReadClient,
  type OwnerContractMediaResult
} from "./owner-contract-media.js";
import { OwnerContractMediaRecoveryStore } from "./owner-contract-media-recovery.js";
import {
  createOwnerReviewedContractCallPolicy,
  OwnerContractProbePolicyError,
  revalidateOwnerReviewedContractCall,
  type OwnerContractProbePolicyDiagnosticCode,
  type OwnerReviewedContractCallPolicy
} from "./owner-contract-probe-policy.js";

export const OWNER_LUMA_T2V_CONTRACT_VARIANT_ID = "luma-ray-3.14-t2v-source-reviewed-48" as const;
export const OWNER_LUMA_T2V_CONTRACT_REGISTRY_VERSION = "sha256-031f29ff827ae5487d4f088edbdfc3a2fc0d62d201eeb73d8bbaf854d3bd0a2b.json" as const;
const MODEL_ID = "ray-3.14" as const;
const OPERATION_ID = "generate-video" as const;
const MAX_RECOVERIES = 128;
const MAX_INTENTS = 128;
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const RECOVERY_ID_PATTERN = /^recovery_[0-9a-f-]{36}$/u;
const ATTEMPT_PATTERN = /^link_[A-Za-z0-9_-]{20,120}$/u;
const REGISTRY_VERSION_PATTERN = /^sha256-[a-f0-9]{64}\.json$/u;

export interface OwnerLumaT2vGenerationInput {
  readonly attemptId: string;
  readonly prompt: string;
  readonly quality: OwnerLumaT2vGenerationQuality;
  readonly aspect_ratio: OwnerLumaT2vGenerationAspectRatio;
  readonly video_duration: OwnerLumaT2vGenerationDuration;
}

export interface OwnerLumaT2vGenerationOutput extends OwnerContractMediaResult {
  readonly status: "reviewed";
  readonly confidence_scope: "exact_result_only";
  readonly variant_id: typeof OWNER_LUMA_T2V_CONTRACT_VARIANT_ID;
}

export interface OwnerLumaT2vRecoveryListItem {
  readonly recovery_id: string;
  readonly model_id: typeof MODEL_ID;
  readonly operation_id: typeof OPERATION_ID;
  readonly variant_id: typeof OWNER_LUMA_T2V_CONTRACT_VARIANT_ID;
  readonly created_at: string;
}

export type OwnerLumaT2vContractServiceErrorCode =
  | "INVALID_REQUEST"
  | "SERVICE_CLOSED"
  | "SERVICE_BUSY"
  | "INTENT_ALREADY_USED"
  | "PRINCIPAL_NOT_LINKED"
  | "SUBSCRIPTION_REQUIRED"
  | "SUBSCRIPTION_STATUS_UNVERIFIED"
  | "MODEL_ACCESS_UNAVAILABLE"
  | "RECOVERY_NOT_FOUND"
  | "OUTCOME_UNKNOWN";

export class OwnerLumaT2vContractServiceError extends Error {
  constructor(
    readonly code: OwnerLumaT2vContractServiceErrorCode,
    readonly recovery_id?: string,
    readonly diagnostic_code?: OwnerContractProbePolicyDiagnosticCode
  ) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The Luma request may have been dispatched; reconcile the same recovery handle and do not retry."
      : "The owner Luma T2V request could not be completed safely.");
    this.name = "OwnerLumaT2vContractServiceError";
  }
}

export interface OwnerLumaT2vContractServiceOptions {
  readonly registry: GenerationContractRegistryV2;
  readonly registryVersion: string;
  readonly catalog: DiscoveryCatalogRepository;
  readonly binding: AuthBinding;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
  readonly resolveSubscription: (attemptId: string, signal?: AbortSignal) => Promise<SyntxSubscription>;
  readonly resolveModelAccess: (
    attemptId: string,
    modelId: string,
    costParameters: Readonly<Record<string, SyntxCostParameter>>,
    signal?: AbortSignal
  ) => Promise<ModelAccessResult>;
  readonly resolveChatClient: (attemptId: string) => OwnerContractMediaClient;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly videoTimeoutMs?: number;
}

export function buildOwnerLumaT2vGenerationContractInput(input: {
  readonly catalog: DiscoveryCatalogRepository;
  readonly source?: OwnerLumaT2vGenerationSourceContract;
  readonly reviewedAt: string;
}): GenerationContractV2Input {
  const source = input.source ?? getOwnerLumaT2vGenerationParametersSource();
  const model = input.catalog.getModel(MODEL_ID);
  if (!Number.isFinite(Date.parse(input.reviewedAt)) || !model.active || model.ai_name !== "luma" ||
      model.upstream_id !== MODEL_ID || !model.operations.some((item) => item.id === OPERATION_ID && item.output_modality === "video")) {
    throw new Error("OWNER_LUMA_T2V_CONTRACT_SOURCE_UNAVAILABLE");
  }
  const formSha = source.source_pins.form_sha256;
  const senderSha = source.source_pins.sender_sha256;
  const sourceModelSha = input.catalog.source_hashes.models;
  const catalogVersion = `${input.catalog.fetched_at}.${sourceModelSha.slice(7, 19)}`;
  const properties = {
    prompt: { type: "string" as const, max_length: source.controls.prompt.source_max_length },
    quality: { type: "string" as const, enum: [...source.controls.quality.values] },
    aspect_ratio: { type: "string" as const, enum: [...source.controls.aspect_ratio.values] },
    video_duration: { type: "integer" as const, enum: [...source.controls.video_duration.values] }
  };
  return {
    variant_id: OWNER_LUMA_T2V_CONTRACT_VARIANT_ID,
    model_id: MODEL_ID,
    operation_id: OPERATION_ID,
    modality: "video",
    route: "video",
    ai_name: "luma",
    model_type: MODEL_ID,
    status: "reviewed",
    provenance: {
      settings_source_sha256: formSha,
      references: [
        { kind: "public_catalog", reference: `selected public model ray-3.14 in ${catalogVersion}`, sha256: sourceModelSha },
        { kind: "frontend_static", reference: `${source.source_pins.form_module} build ${source.source_pins.build_id}; Luma control values`, sha256: formSha },
        { kind: "frontend_static", reference: `${source.source_pins.sender_module} build ${source.source_pins.build_id}; generic video sender`, sha256: senderSha },
        { kind: "manual_review", reference: "Source-reviewed exact Luma T2V controls and V2 field mapping; pilot evidence remains separate." }
      ],
      reviewed_at: input.reviewedAt
    },
    parameters: {
      type: "object",
      additional_properties: false,
      required: ["prompt", "quality", "aspect_ratio", "video_duration"],
      properties,
      conditions: [],
      conditional_enums: []
    },
    wire: {
      dispatch_action: OPERATION_ID,
      input_kind: "prompt",
      prompt_field: "prompt",
      settings_fields: { quality: "quality", aspect_ratio: "aspect_ratio", video_duration: "video_duration" },
      fixed_settings: { gen_type: "text2video", file_urls: [] },
      media_reference_fields: {}
    },
    output: { decoder_profile: "luma-ray-3-14-video-v1", mime_types: ["video/mp4"] },
    limits: { max_parameters: 4, max_value_depth: 2, max_serialized_bytes: 16_384, max_normalized_nodes: 64 }
  };
}

/** Build the additive V2 archive input from the live selected catalog and source-reviewed UI controls. */
export function createOwnerLumaT2vGenerationRegistryInput(
  catalog: DiscoveryCatalogRepository,
  reviewedAt: string
): ReturnType<typeof createGenerationContractRegistryV2> {
  const contract = buildOwnerLumaT2vGenerationContractInput({ catalog, reviewedAt });
  return createGenerationContractRegistryV2({
    schema_version: "2.0.0",
    catalog_version: `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`,
    source_hashes: catalog.source_hashes,
    contracts: [contract]
  });
}

interface StoredRecovery {
  readonly recovery_id: string;
  readonly attempt_id: string;
  readonly created_at: string;
  readonly policy: OwnerReviewedContractCallPolicy;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly intent_key: string;
}

interface SemanticIntentClaim {
  readonly attempt_id: string;
  readonly created_at: number;
  state: "PREPARING" | "DISPATCH_POSSIBLE" | "RESULT_OBSERVED";
  recovery_id?: string;
}

export class OwnerLumaT2vContractService {
  readonly #options: OwnerLumaT2vContractServiceOptions;
  readonly #source: OwnerLumaT2vGenerationSourceContract;
  readonly #executor: GenerationContractExecutorV2;
  readonly #contract: OwnerContractMediaContractContext;
  readonly #recoveryStore: LumaT2vRecoveryStore;
  readonly #media: OwnerContractMediaService;
  readonly #recoveries = new Map<string, StoredRecovery>();
  readonly #intents = new Map<string, SemanticIntentClaim>();
  readonly #controllers = new Map<string, Set<AbortController>>();
  readonly #pending = new Set<Promise<unknown>>();
  readonly #pendingByAttempt = new Map<string, Set<Promise<unknown>>>();
  readonly #attemptEpochs = new Map<string, number>();
  readonly #invalidating = new Set<string>();
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(options: OwnerLumaT2vContractServiceOptions) {
    this.#options = options;
    this.#source = getOwnerLumaT2vGenerationParametersSource();
    if (options.registryVersion !== OWNER_LUMA_T2V_CONTRACT_REGISTRY_VERSION || !REGISTRY_VERSION_PATTERN.test(options.registryVersion) ||
        contentAddressedVersion(options.registry) !== options.registryVersion) {
      throw new Error("OWNER_LUMA_T2V_REGISTRY_VERSION_MISMATCH");
    }
    this.#executor = new GenerationContractExecutorV2(options.registry, options.catalog);
    this.#contract = contractContext(this.#executor, options.registryVersion, options.registry.catalog_version, options.catalog, this.#source);
    this.#recoveryStore = new LumaT2vRecoveryStore({ now: options.now ?? Date.now });
    this.#media = new OwnerContractMediaService({
      recoveryStore: this.#recoveryStore,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.wait === undefined ? {} : { wait: options.wait }),
      ...(options.videoTimeoutMs === undefined ? {} : { videoTimeoutMs: options.videoTimeoutMs })
    });
  }

  getParametersSource(): OwnerLumaT2vGenerationSourceContract { return this.#source; }

  getReviewedContract() {
    const contract = this.#executor.getContract(MODEL_ID, OPERATION_ID, OWNER_LUMA_T2V_CONTRACT_VARIANT_ID);
    if (contract === null) throw new OwnerLumaT2vContractServiceError("INVALID_REQUEST");
    return contract;
  }

  generate(input: OwnerLumaT2vGenerationInput | unknown, signal?: AbortSignal): Promise<OwnerLumaT2vGenerationOutput> {
    this.#assertOpen();
    const attemptId = readAttempt(input);
    if (this.#invalidating.has(attemptId)) throw new OwnerLumaT2vContractServiceError("PRINCIPAL_NOT_LINKED");
    const request = snapshotGenerationInput(input);
    const controller = new AbortController();
    const attemptControllers = this.#controllers.get(request.attemptId) ?? new Set<AbortController>();
    attemptControllers.add(controller);
    this.#controllers.set(request.attemptId, attemptControllers);
    const effectiveSignal = mergeSignals(signal, controller.signal);
    const epoch = this.#attemptEpochs.get(request.attemptId) ?? 0;
    const task = this.#generate(request, effectiveSignal, epoch).finally(() => {
      attemptControllers.delete(controller);
      if (attemptControllers.size === 0) this.#controllers.delete(request.attemptId);
      this.#untrack(task, request.attemptId);
    });
    this.#track(task, request.attemptId);
    return task;
  }

  reconcile(input: { readonly attemptId: string; readonly recovery_id: string } | unknown, signal?: AbortSignal): Promise<OwnerLumaT2vGenerationOutput> {
    this.#assertOpen();
    const request = snapshotRecoveryInput(input);
    if (this.#invalidating.has(request.attemptId)) throw new OwnerLumaT2vContractServiceError("PRINCIPAL_NOT_LINKED");
    return this.#run(request.attemptId, signal, (effectiveSignal) => this.#reconcile(request, effectiveSignal));
  }

  listRecoveries(attemptId: string, limit = 20): readonly OwnerLumaT2vRecoveryListItem[] {
    this.#assertOpen();
    if (!ATTEMPT_PATTERN.test(attemptId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
      throw new OwnerLumaT2vContractServiceError("INVALID_REQUEST");
    }
    return Object.freeze(this.#recoveryStore.list(attemptId, limit).map((item) => Object.freeze({
      recovery_id: item.recovery_id,
      model_id: MODEL_ID,
      operation_id: OPERATION_ID,
      variant_id: OWNER_LUMA_T2V_CONTRACT_VARIANT_ID,
      created_at: item.created_at
    })));
  }

  async invalidateAttempt(attemptId: string): Promise<void> {
    if (!ATTEMPT_PATTERN.test(attemptId)) return;
    this.#invalidating.add(attemptId);
    this.#attemptEpochs.set(attemptId, (this.#attemptEpochs.get(attemptId) ?? 0) + 1);
    for (const controller of this.#controllers.get(attemptId) ?? []) controller.abort();
    const pending = [...(this.#pendingByAttempt.get(attemptId) ?? [])];
    await Promise.allSettled(pending);
    while (true) {
      const records = this.#recoveryStore.list(attemptId, 20);
      if (records.length === 0) break;
      for (const record of records) {
        this.#recoveryStore.remove(record.recovery_id, attemptId);
        this.#recoveries.delete(record.recovery_id);
      }
    }
    for (const [key, claim] of this.#intents) {
      if (claim.attempt_id === attemptId && claim.state === "PREPARING") this.#intents.delete(key);
    }
    this.#invalidating.delete(attemptId);
    this.#pendingByAttempt.delete(attemptId);
    if (!this.#controllers.has(attemptId)) this.#attemptEpochs.delete(attemptId);
  }

  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    for (const controllers of this.#controllers.values()) for (const controller of controllers) controller.abort();
    this.#closing = (async () => {
      await Promise.allSettled([...this.#pending]);
      this.#recoveryStore.close();
      this.#recoveries.clear();
      this.#controllers.clear();
      this.#attemptEpochs.clear();
      this.#invalidating.clear();
      this.#pendingByAttempt.clear();
    })();
    return this.#closing;
  }

  async #generate(request: OwnerLumaT2vGenerationInput, signal: AbortSignal, epoch: number): Promise<OwnerLumaT2vGenerationOutput> {
    signal.throwIfAborted();
    if (!this.#recoveryStore.hasCapacity()) throw new OwnerLumaT2vContractServiceError("SERVICE_BUSY");
    const policy = createOwnerReviewedContractCallPolicy({
      registry: this.#options.registry,
      registryVersion: this.#options.registryVersion,
      executor: this.#executor,
      attemptId: request.attemptId,
      modelId: MODEL_ID,
      operationId: OPERATION_ID,
      variantId: OWNER_LUMA_T2V_CONTRACT_VARIANT_ID,
      parameters: {
        prompt: request.prompt,
        quality: request.quality,
        aspect_ratio: request.aspect_ratio,
        video_duration: request.video_duration
      },
      costParameters: Object.freeze({ quality: request.quality, video_duration: request.video_duration })
    });
    const prepared = this.#executor.prepare({
      model_id: MODEL_ID, operation_id: OPERATION_ID, catalog_version: this.#options.registry.catalog_version,
      variant_id: OWNER_LUMA_T2V_CONTRACT_VARIANT_ID,
      parameters: { prompt: request.prompt, quality: request.quality, aspect_ratio: request.aspect_ratio, video_duration: request.video_duration }
    });
    const preflightPrincipal = await this.#resolveCurrentPrincipal(request.attemptId, signal);
    const intentKey = semanticIntentKey(preflightPrincipal, request);
    this.#reserveIntent(intentKey, request.attemptId);
    let finalPrincipal: Readonly<GenerationPrincipalRef> | undefined;
    let preDispatchFailure: OwnerLumaT2vContractServiceError | undefined;
    const beforeChat = async (requestSignal: AbortSignal) => {
      try {
        const current = await this.#verifyEntitlement(policy, request.attemptId, requestSignal, preflightPrincipal);
        finalPrincipal = current;
      } catch (error) {
        preDispatchFailure = mapLumaError(error);
        throw error;
      }
    };
    const beforeDispatch = async (requestSignal: AbortSignal) => {
      try {
        const expected = finalPrincipal ?? preflightPrincipal;
        await this.#verifyEntitlement(policy, request.attemptId, requestSignal, expected);
        const claim = this.#intents.get(intentKey);
        if (!claim || claim.attempt_id !== request.attemptId || claim.state !== "PREPARING") {
          throw new OwnerLumaT2vContractServiceError("SERVICE_BUSY");
        }
        claim.state = "DISPATCH_POSSIBLE";
      } catch (error) {
        preDispatchFailure = mapLumaError(error);
        throw error;
      }
    };
    const currentClient = this.#options.resolveChatClient(request.attemptId);
    let mediaResult: OwnerContractMediaResult;
    try {
      mediaResult = await this.#media.generate({
        client: currentClient,
        attemptId: request.attemptId,
        contract: this.#contract,
        prepared,
        probePolicy: policy,
        beforeChat,
        beforeDispatch,
        signal
      });
      const claim = this.#intents.get(intentKey);
      if (claim) claim.state = "RESULT_OBSERVED";
      return resultFromMedia(mediaResult);
    } catch (error) {
      if (preDispatchFailure !== undefined) {
        this.#releasePreDispatchIntent(intentKey);
        throw preDispatchFailure;
      }
      if ((this.#attemptEpochs.get(request.attemptId) ?? 0) !== epoch) {
        this.#releasePreDispatchIntent(intentKey);
        throw new OwnerLumaT2vContractServiceError("PRINCIPAL_NOT_LINKED");
      }
      if (error instanceof OwnerContractMediaError && error.code === "OUTCOME_UNKNOWN" &&
          error.recoveryId !== undefined && RECOVERY_ID_PATTERN.test(error.recoveryId)) {
        const record = this.#recoveryStore.get(error.recoveryId, request.attemptId);
        if (record === undefined) {
          this.#releasePreDispatchIntent(intentKey);
          throw new OwnerLumaT2vContractServiceError("OUTCOME_UNKNOWN");
        }
        if (this.#recoveries.size >= MAX_RECOVERIES && !this.#recoveries.has(error.recoveryId)) {
          this.#releasePreDispatchIntent(intentKey);
          this.#recoveryStore.remove(error.recoveryId, request.attemptId);
          throw new OwnerLumaT2vContractServiceError("OUTCOME_UNKNOWN");
        }
        const principal = finalPrincipal ?? preflightPrincipal;
        this.#recoveries.set(error.recoveryId, Object.freeze({
          recovery_id: error.recoveryId, attempt_id: request.attemptId, created_at: record.created_at,
          policy, principal, intent_key: intentKey
        }));
        const claim = this.#intents.get(intentKey);
        if (claim) { claim.state = "DISPATCH_POSSIBLE"; claim.recovery_id = error.recoveryId; }
        throw new OwnerLumaT2vContractServiceError("OUTCOME_UNKNOWN", error.recoveryId);
      }
      this.#releasePreDispatchIntent(intentKey);
      throw mapLumaError(error);
    }
  }

  async #reconcile(request: { readonly attemptId: string; readonly recovery_id: string }, signal?: AbortSignal): Promise<OwnerLumaT2vGenerationOutput> {
    const stored = this.#recoveries.get(request.recovery_id);
    const record = this.#recoveryStore.get(request.recovery_id, request.attemptId);
    if (!stored || !record || stored.attempt_id !== request.attemptId ||
        stored.principal.connection_id !== request.attemptId) throw new OwnerLumaT2vContractServiceError("RECOVERY_NOT_FOUND");
    let revokedDuringRead = false;
    try {
      const current = await this.#resolveCurrentPrincipal(request.attemptId, signal);
      if (!sameGenerationPrincipal(current, stored.principal)) {
        this.#removeRecovery(request.recovery_id, request.attemptId);
        throw new OwnerLumaT2vContractServiceError("RECOVERY_NOT_FOUND");
      }
      const client = this.#options.resolveChatClient(request.attemptId);
      const checkPrincipal = async () => {
        let latest: Readonly<GenerationPrincipalRef>;
        try { latest = await this.#resolveCurrentPrincipal(request.attemptId, signal); }
        catch {
          revokedDuringRead = true;
          this.#removeRecovery(request.recovery_id, request.attemptId);
          throw new OwnerLumaT2vContractServiceError("RECOVERY_NOT_FOUND");
        }
        if (!sameGenerationPrincipal(latest, stored.principal)) {
          revokedDuringRead = true;
          this.#removeRecovery(request.recovery_id, request.attemptId);
          throw new OwnerLumaT2vContractServiceError("RECOVERY_NOT_FOUND");
        }
      };
      const readOnlyClient: OwnerContractMediaReadClient = Object.freeze({
        listInProgress: async (chatUuid: string, requestSignal?: AbortSignal) => {
          await checkPrincipal();
          const entries = await client.listInProgress(chatUuid, requestSignal);
          await checkPrincipal();
          return entries;
        },
        getMessage: async (chatUuid: string, messageId: string, requestSignal?: AbortSignal) => {
          await checkPrincipal();
          const message = await client.getMessage(chatUuid, messageId, requestSignal);
          await checkPrincipal();
          return message;
        },
        ...(client.listMessageCandidates === undefined ? {} : {
          listMessageCandidates: async (chatUuid: string, echoId: string, requestSignal?: AbortSignal) => {
            await checkPrincipal();
            const snapshot = await client.listMessageCandidates!(chatUuid, echoId, requestSignal);
            await checkPrincipal();
            return snapshot;
          }
        })
      });
      const result = await this.#media.reconcile({
        client: readOnlyClient, attemptId: request.attemptId, recoveryId: request.recovery_id,
        contract: this.#contract, probePolicy: stored.policy, ...(signal === undefined ? {} : { signal })
      });
      const claim = this.#intents.get(stored.intent_key);
      if (claim) claim.state = "RESULT_OBSERVED";
      this.#removeRecovery(request.recovery_id, request.attemptId);
      return resultFromMedia(result);
    } catch (error) {
      if (revokedDuringRead) {
        this.#removeRecovery(request.recovery_id, request.attemptId);
        throw new OwnerLumaT2vContractServiceError("RECOVERY_NOT_FOUND");
      }
      if (error instanceof OwnerLumaT2vContractServiceError) {
        if (error.code === "PRINCIPAL_NOT_LINKED" || revokedDuringRead) {
          this.#removeRecovery(request.recovery_id, request.attemptId);
          throw new OwnerLumaT2vContractServiceError("RECOVERY_NOT_FOUND");
        }
        throw error;
      }
      if (error instanceof OwnerContractMediaError && error.code === "RECOVERY_NOT_FOUND") {
        this.#removeRecovery(request.recovery_id, request.attemptId);
        throw new OwnerLumaT2vContractServiceError("RECOVERY_NOT_FOUND");
      }
      throw new OwnerLumaT2vContractServiceError("OUTCOME_UNKNOWN", request.recovery_id);
    }
  }

  async #verifyEntitlement(
    policy: OwnerReviewedContractCallPolicy,
    attemptId: string,
    signal: AbortSignal,
    expected: Readonly<GenerationPrincipalRef>
  ): Promise<Readonly<GenerationPrincipalRef>> {
    signal.throwIfAborted();
    const current = await this.#resolveCurrentPrincipal(attemptId, signal);
    if (!sameGenerationPrincipal(current, expected)) throw new OwnerLumaT2vContractServiceError("PRINCIPAL_NOT_LINKED");
    try {
      await revalidateOwnerReviewedContractCall(policy, attemptId, this.#options.resolveSubscription,
        this.#options.resolveModelAccess, signal);
    } catch (error) { throw mapLumaError(error); }
    const after = await this.#resolveCurrentPrincipal(attemptId, signal);
    if (!sameGenerationPrincipal(after, expected)) throw new OwnerLumaT2vContractServiceError("PRINCIPAL_NOT_LINKED");
    signal.throwIfAborted();
    return after;
  }

  async #resolveCurrentPrincipal(attemptId: string, signal?: AbortSignal): Promise<Readonly<GenerationPrincipalRef>> {
    signal?.throwIfAborted();
    if (!ATTEMPT_PATTERN.test(attemptId)) throw new OwnerLumaT2vContractServiceError("INVALID_REQUEST");
    let principal: Readonly<GenerationPrincipalRef>;
    try {
      principal = snapshotGenerationPrincipal(await resolveOwnerReferencePrincipal({
        binding: this.#options.binding, attemptId, linkService: this.#options.linkService
      }));
    }
    catch { throw new OwnerLumaT2vContractServiceError("PRINCIPAL_NOT_LINKED"); }
    if (principal.connection_id !== attemptId || principal.tenant_id !== this.#options.binding.tenant_id ||
        principal.subject_id !== this.#options.binding.subject) throw new OwnerLumaT2vContractServiceError("PRINCIPAL_NOT_LINKED");
    signal?.throwIfAborted();
    return principal;
  }

  #reserveIntent(key: string, attemptId: string): void {
    if (this.#intents.has(key)) throw new OwnerLumaT2vContractServiceError("INTENT_ALREADY_USED");
    if (this.#intents.size >= MAX_INTENTS) throw new OwnerLumaT2vContractServiceError("SERVICE_BUSY");
    this.#intents.set(key, { attempt_id: attemptId, created_at: readNow(this.#options.now), state: "PREPARING" });
  }

  #releasePreDispatchIntent(key: string): void {
    if (this.#intents.get(key)?.state === "PREPARING") this.#intents.delete(key);
  }

  #removeRecovery(recoveryId: string, attemptId: string): void {
    this.#recoveryStore.remove(recoveryId, attemptId);
    this.#recoveries.delete(recoveryId);
  }

  async #run<T>(attemptId: string, signal: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const controllers = this.#controllers.get(attemptId) ?? new Set<AbortController>();
    controllers.add(controller);
    this.#controllers.set(attemptId, controllers);
    const effectiveSignal = mergeSignals(signal, controller.signal);
    const task = operationWithSignal(() => operation(effectiveSignal), effectiveSignal).finally(() => {
      controllers.delete(controller);
      if (controllers.size === 0) this.#controllers.delete(attemptId);
      this.#untrack(task, attemptId);
    });
    this.#track(task, attemptId);
    return task;
  }

  #track(promise: Promise<unknown>, attemptId: string): void {
    this.#pending.add(promise);
    const byAttempt = this.#pendingByAttempt.get(attemptId) ?? new Set<Promise<unknown>>();
    byAttempt.add(promise);
    this.#pendingByAttempt.set(attemptId, byAttempt);
  }

  #untrack(promise: Promise<unknown>, attemptId: string): void {
    this.#pending.delete(promise);
    const byAttempt = this.#pendingByAttempt.get(attemptId);
    byAttempt?.delete(promise);
    if (byAttempt?.size === 0) this.#pendingByAttempt.delete(attemptId);
  }

  #assertOpen(): void {
    if (this.#closed) throw new OwnerLumaT2vContractServiceError("SERVICE_CLOSED");
  }
}

class LumaT2vRecoveryStore extends OwnerContractMediaRecoveryStore {
  constructor(options: { readonly now: () => number }) {
    super({ maxRecords: MAX_RECOVERIES, ttlMs: Number.MAX_SAFE_INTEGER, now: options.now });
  }

  override create(input: Parameters<OwnerContractMediaRecoveryStore["create"]>[0]) {
    if (this.size() >= MAX_RECOVERIES) throw new OwnerLumaT2vContractServiceError("SERVICE_BUSY");
    return super.create(input);
  }

  hasCapacity(): boolean { return this.size() < MAX_RECOVERIES; }
}

function contractContext(
  executor: GenerationContractExecutorV2,
  registryVersion: string,
  catalogVersion: string,
  catalog: DiscoveryCatalogRepository,
  source: OwnerLumaT2vGenerationSourceContract
): OwnerContractMediaContractContext {
  const contract = executor.getContract(MODEL_ID, OPERATION_ID, OWNER_LUMA_T2V_CONTRACT_VARIANT_ID);
  if (contract === null) throw new Error("OWNER_LUMA_T2V_REVIEWED_CONTRACT_MISSING");
  assertSourceReviewedContract(contract, source, catalog);
  return Object.freeze({
    model_id: contract.model_id, operation_id: OPERATION_ID, modality: "video", ai_name: "luma", model_type: MODEL_ID,
    variant_id: contract.variant_id, schema_hash: contract.schema_hash, status: "reviewed",
    mime_types: Object.freeze([...contract.output.mime_types]), registry_version: registryVersion,
    catalog_version: catalogVersion
  });
}

function assertSourceReviewedContract(
  contract: ReturnType<GenerationContractExecutorV2["getContract"]>,
  source: OwnerLumaT2vGenerationSourceContract,
  catalog: DiscoveryCatalogRepository
): asserts contract is NonNullable<typeof contract> {
  if (contract === null || contract.status !== "reviewed" || contract.variant_id !== OWNER_LUMA_T2V_CONTRACT_VARIANT_ID ||
      contract.provenance.live_observed_at !== undefined || !Number.isFinite(Date.parse(contract.provenance.reviewed_at ?? ""))) {
    throw new Error("OWNER_LUMA_T2V_REVIEWED_CONTRACT_MISMATCH");
  }
  const expected = buildOwnerLumaT2vGenerationContractInput({ catalog, source, reviewedAt: contract.provenance.reviewed_at! });
  const { schema_hash: _schemaHash, ...actual } = contract;
  if (!isDeepStrictEqual(actual, expected)) throw new Error("OWNER_LUMA_T2V_REVIEWED_CONTRACT_MISMATCH");
}

function contentAddressedVersion(registry: GenerationContractRegistryV2): string {
  return `sha256-${createHash("sha256").update(serializeGenerationContractRegistryV2(registry)).digest("hex")}.json`;
}

function semanticIntentKey(principal: Readonly<GenerationPrincipalRef>, request: OwnerLumaT2vGenerationInput): string {
  const intent = JSON.stringify([principal.tenant_id, principal.subject_id, MODEL_ID, OWNER_LUMA_T2V_CONTRACT_VARIANT_ID,
    request.prompt, request.quality, request.aspect_ratio, request.video_duration]);
  return createHash("sha256").update(intent).digest("hex");
}

function snapshotGenerationInput(value: unknown): OwnerLumaT2vGenerationInput {
  try {
    if (!isPlainRecord(value) || types.isProxy(value) ||
        Object.keys(value).sort().join("\u0000") !== ["attemptId", "aspect_ratio", "prompt", "quality", "video_duration"].sort().join("\u0000") ||
        typeof value.attemptId !== "string" || !ATTEMPT_PATTERN.test(value.attemptId)) {
      throw new OwnerLumaT2vContractServiceError("INVALID_REQUEST");
    }
    const normalized = normalizeOwnerLumaT2vGenerationParameters({
      model_id: MODEL_ID,
      mode: "text2video",
      prompt: value.prompt,
      quality: value.quality,
      aspect_ratio: value.aspect_ratio,
      video_duration: value.video_duration
    });
    if (PROMPT_CONTROL.test(normalized.intent.prompt)) throw new OwnerLumaT2vContractServiceError("INVALID_REQUEST");
    return Object.freeze({
      attemptId: value.attemptId,
      prompt: normalized.intent.prompt,
      quality: normalized.intent.quality,
      aspect_ratio: normalized.intent.aspect_ratio,
      video_duration: normalized.intent.video_duration
    });
  } catch (error) {
    if (error instanceof OwnerLumaT2vContractServiceError) throw error;
    throw new OwnerLumaT2vContractServiceError("INVALID_REQUEST");
  }
}

function snapshotRecoveryInput(value: unknown): { readonly attemptId: string; readonly recovery_id: string } {
  if (!isPlainRecord(value) || Object.keys(value).sort().join("\u0000") !== ["attemptId", "recovery_id"].sort().join("\u0000") ||
      typeof value.attemptId !== "string" || !ATTEMPT_PATTERN.test(value.attemptId) ||
      typeof value.recovery_id !== "string" || !RECOVERY_ID_PATTERN.test(value.recovery_id)) {
    throw new OwnerLumaT2vContractServiceError("INVALID_REQUEST");
  }
  return Object.freeze({ attemptId: value.attemptId, recovery_id: value.recovery_id });
}

function resultFromMedia(result: OwnerContractMediaResult): OwnerLumaT2vGenerationOutput {
  return Object.freeze({ status: "reviewed", confidence_scope: "exact_result_only", model_id: MODEL_ID,
    operation_id: OPERATION_ID, modality: "video", variant_id: OWNER_LUMA_T2V_CONTRACT_VARIANT_ID,
    artifacts: Object.freeze(result.artifacts.map((artifact) => Object.freeze({ ...artifact }))) });
}

function mapLumaError(error: unknown): OwnerLumaT2vContractServiceError {
  if (error instanceof OwnerLumaT2vContractServiceError) return error;
  if (error instanceof OwnerGenerationPreflightError) {
    return new OwnerLumaT2vContractServiceError(error.code === "SUBSCRIPTION_REQUIRED" ? "SUBSCRIPTION_REQUIRED" : "SUBSCRIPTION_STATUS_UNVERIFIED");
  }
  if (error instanceof OwnerContractProbePolicyError) {
    return new OwnerLumaT2vContractServiceError(error.code === "PROBE_MODEL_ACCESS_UNAVAILABLE" ? "MODEL_ACCESS_UNAVAILABLE" : "INVALID_REQUEST",
      undefined, error.diagnostic_code);
  }
  if (error instanceof OwnerContractMediaError) {
    if (error.code === "OUTCOME_UNKNOWN") return new OwnerLumaT2vContractServiceError("OUTCOME_UNKNOWN", error.recoveryId);
    if (error.code === "RECOVERY_NOT_FOUND") return new OwnerLumaT2vContractServiceError("RECOVERY_NOT_FOUND");
    if (error.code === "PRE_DISPATCH_FAILED") return new OwnerLumaT2vContractServiceError("INVALID_REQUEST");
  }
  return new OwnerLumaT2vContractServiceError("INVALID_REQUEST");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => typeof key === "string" &&
    Object.getOwnPropertyDescriptor(value, key)?.enumerable === true && "value" in Object.getOwnPropertyDescriptor(value, key)!);
}

function readAttempt(value: unknown): string {
  if (isPlainRecord(value) && typeof value.attemptId === "string" && ATTEMPT_PATTERN.test(value.attemptId)) return value.attemptId;
  return "";
}

function readNow(now: (() => number) | undefined): number {
  const value = now?.() ?? Date.now();
  if (!Number.isSafeInteger(value) || value < 0) throw new OwnerLumaT2vContractServiceError("INVALID_REQUEST");
  return value;
}

function mergeSignals(external: AbortSignal | undefined, internal: AbortSignal): AbortSignal {
  return external === undefined ? internal : AbortSignal.any([external, internal]);
}

function operationWithSignal<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return operation();
}
