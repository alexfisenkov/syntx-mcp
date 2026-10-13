import { createHash, randomUUID } from "node:crypto";
import { isProxy } from "node:util/types";
import { hashGenerationRequest } from "../../application/generation-request.js";
import { ApplicationError } from "../../errors.js";
import type {
  Balance,
  GenerationArtifact,
  GenerationJob,
  GenerationRequest,
  GenerationResult,
  JobStatus,
  Modality,
  UpstreamGenerationEstimate
} from "../../domain/types.js";
import { GenerationStateTransitionError, OWNER_UNCAPPED_APPROVED_MAX_COST } from "../../domain/generation-operation.js";
import { snapshotGenerationPrincipal, sameGenerationPrincipal } from "../../domain/generation-principal.js";
import type {
  GenerationPrincipalRef,
  GenerationOperationRecord,
  GenerationOperationState,
  ProviderGenerationReceipt
} from "../../domain/generation-operation.js";
import { GenerationTransactionStoreError } from "../../storage/generation-transaction-store.js";
import type {
  GenerationOperationOwnerRef,
  GenerationOperationTransitionInput,
  GenerationTransactionStore
} from "../../storage/generation-transaction-store.js";
import type {
  CancelJobContext,
  JobContext,
  ReconcileCancelContext,
  ReconcileStartContext,
  StartGenerationContext,
  UpstreamAdapter
} from "../upstream-adapter.js";
import {
  getOwnerUncappedGenerationBinding,
  prepareOwnerUncappedGenerationRequest,
  type OwnerUncappedGenerationAuthority
} from "./owner-uncapped-authority.js";
import { SyntxHttpError } from "./http-client.js";
import { SyntxCancellationSaga } from "./cancellation-saga.js";
import type {
  ChatMessageHistorySnapshot,
  MediaGenerationReceipt,
  RedactedMessageEnvelope,
  SafeArtifactMetadata,
  StartAudioRequest,
  StartImageRequest,
  StartVideoRequest
} from "./chat-http-client.js";

/**
 * The subset of SyntxChatHttpClient this adapter actually calls. Kept as an
 * interface (not the concrete class) so tests can inject a fake without
 * mocking fetch, and so this file never depends on chat-http-client.ts's
 * private HTTP plumbing.
 */
export interface SyntxGenerationChatClient {
  createChat(
    scope: "image" | "video" | "audio",
    title: string,
    signal?: AbortSignal
  ): Promise<{ chat_uuid: string }>;
  startImage(
    request: StartImageRequest,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt>;
  startVideo(
    request: StartVideoRequest,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt>;
  startAudio(
    request: StartAudioRequest,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt>;
  getMessage(
    chatUuid: string,
    messageId: string,
    signal?: AbortSignal
  ): Promise<RedactedMessageEnvelope>;
  listMessageCandidates?: ((
    chatUuid: string,
    ownerEchoMessageId: string,
    signal?: AbortSignal
  ) => Promise<ChatMessageHistorySnapshot>) | undefined;
  cancelMessage(
    chatUuid: string,
    messageId: string,
    signal?: AbortSignal
  ): Promise<{ chat_uuid: string; message_id: string; accepted: true }>;
}

const MEDIA_MODALITIES = ["image", "video", "audio"] as const;
type MediaModality = (typeof MEDIA_MODALITIES)[number];

/** Server-injected local contract; this is not runtime or backend attestation. */
export interface PreparedSyntxMediaRequest {
  readonly prompt: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly ai_name: string;
  readonly modality: MediaModality;
  readonly schema_hash: string;
}

export interface OwnerUncappedStartContext {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly idempotency_key: string;
  readonly authority: OwnerUncappedGenerationAuthority;
}

/** Separate owner-only port; generic UpstreamAdapter callers keep numeric-cap semantics. */
export interface OwnerUncappedGenerationAdapter extends UpstreamAdapter {
  startOwnerGeneration(context: OwnerUncappedStartContext, request: GenerationRequest): Promise<GenerationJob>;
}

/**
 * `applied: false` means a concurrent writer already changed this record
 * before the requested transition could land — `record` is the FRESH,
 * concurrently-written state, not the result of this call's own request.
 * Every safeTransition call site must decide what "not applied" means for
 * it specifically; there is no universally safe default.
 */
interface TransitionOutcome {
  applied: boolean;
  record: GenerationOperationRecord;
}

const NOT_RESEARCHED_MESSAGE =
  "No pinned, observed SYNTX endpoint exists for this capability yet; it cannot be safely called.";

/**
 * The legacy no-preparer path has no real per-operation parameters JSON
 * Schema (the still-open settings-IR catalog gap, DEBT-004/DEBT-012) and does
 * not validate `parameters` against one. Its schema_hash is a fixed placeholder,
 * not a hash of any real schema; GenerationTransactionStore only requires it
 * to look like a sha256 hex digest. An explicit prepareMediaRequest supplies
 * a separately validated local schema_hash, not this placeholder.
 */
const UNSCHEMATIZED_PLACEHOLDER_HASH = `sha256:${createHash("sha256")
  .update("syntx-upstream-adapter:no-real-parameters-schema-yet:v1")
  .digest("hex")}`;

/**
 * GenerationTransactionStore's hasSameImmutableBinding() compares
 * cost.observed_at, cost.expires_at, and dispatch_deadline byte-for-byte
 * between a retried startGeneration call and the durably stored record —
 * these fields exist to bind a SPECIFIC estimate/deadline, not to be
 * regenerated per call. Since this adapter has no real cost estimate
 * (estimateGeneration is not researched, see NOT_RESEARCHED_MESSAGE) and does
 * not yet enforce a dispatch deadline, using `this.now()` here would make a
 * legitimate retry (same idempotency_key, same request, called moments
 * later) collide with itself as IDEMPOTENCY_CONFLICT. A fixed sentinel keeps
 * repeated calls byte-identical; real values arrive with estimateGeneration
 * and deadline enforcement in a later step.
 */
const UNOBSERVED_TIMESTAMP_PLACEHOLDER = "1970-01-01T00:00:00.000Z";

export interface SyntxUpstreamAdapterOptions {
  transactionStore: GenerationTransactionStore;
  /** A composer may restrict this instance to one immutable server scope. */
  boundPrincipal?: GenerationPrincipalRef;
  resolveChatClient: (principal: GenerationPrincipalRef) => SyntxGenerationChatClient;
  /**
   * SYNTX's generation routes are keyed by `ai_name` (the AI family, e.g.
   * "banana"), not by GenerationRequest.model_id (a specific variant, e.g.
   * "banana2") — the same relationship census-manifest.ts's `ai_name` field
   * already records for the settings-IR catalog. Required, not defaulted:
   * an adapter constructed without a real mapping must not silently send
   * requests under a placeholder identifier. Should throw for an unknown
   * model_id rather than return a guess.
   *
   * critic-practice found that no such mapping existed anywhere in this
   * project (GenerationRequest.model_id comes from
   * catalog/v1/public-samples.json, e.g. "nano-banana-pro", while ai_name
   * lives in a DIFFERENT catalog — official-public-api.json /
   * discovery-catalog.ts, e.g. "banana" — the two id spaces do not
   * overlap; a naive heuristic like stripping trailing digits is not safe,
   * verified against real data: "veo_omni" and "banana3_light" both
   * produce the wrong ai_name under that heuristic). PARTIALLY RESOLVED
   * (DEBT-043, 2026-09-04): src/catalog/generation-ai-name-bridge.ts's
   * GenerationAiNameResolver — pass `(modelId) => resolver.resolve(modelId)`.
   * It resolves the FAMILY correctly and safely (hash-pinned, cross-
   * validated against modality, fails closed on drift) but NOT the specific
   * SYNTX model variant within that family (round-2 critic review, 3
   * independent critics: "banana" alone covers
   * banana/banana2/banana3/banana3_light, and which one SYNTX actually runs
   * for a bare ai_name with no variant signal is unobserved) — DEBT-048
   * tracks that separately. An explicitly injected static request preparer
   * bypasses this legacy resolver but does not enable live execution.
   * Do not wire this resolver in as if model_id fully
   * determines what actually generates; today only the family does.
   */
  resolveAiName: (modelId: string) => string;
  /**
   * SYNTX's generation route (image/video/audio, chosen via startImage/
   * startVideo/startAudio) is not derivable from GenerationRequest itself
   * — GenerationRequest carries no modality field, only model_id/
   * operation_id/parameters. An earlier version of this adapter guessed
   * modality by parsing a "." out of operation_id (e.g. "image.generate")
   * — critic-practice found this can never match the real catalog:
   * catalog/v1/public-samples.json's operation ids look like
   * "text-to-image"/"standard-text-to-music" (no dot), and the catalog's
   * own id schema (catalog.ts's idSchema) forbids a dot in an operation id
   * outright. CatalogOperation already carries output_modality — the
   * composer should resolve modality from the catalog record, not from
   * this adapter re-parsing a string it was never given enough
   * information to parse correctly. Must throw (not guess) for an
   * operation this adapter cannot map to image/video/audio. RESOLVED
   * (DEBT-043, 2026-09-04): src/catalog/generation-ai-name-bridge.ts's
   * resolveModalityFromCatalog(catalogRepository, request) — a thin,
   * already-tested wrapper over CatalogRepository.getOperation(...)
   * .output_modality, which already throws MODEL_NOT_FOUND/
   * OPERATION_NOT_FOUND rather than guessing.
   */
  resolveModality: (request: GenerationRequest) => Modality;
  /** Optional synchronous, server-owned preparer. Never obtained from caller input. */
  prepareMediaRequest?: (request: GenerationRequest) => PreparedSyntxMediaRequest;
  now?: () => Date;
  createOperationId?: () => string;
}

/**
 * First real UpstreamAdapter implementation. It is never constructed by
 * createDefaultApplication() (application/factory.ts) and must not be wired
 * into any default runtime composition — a separate, explicitly reviewed step
 * owns that decision. Covers image/video/audio generation only: text needs
 * file-reference handling that DEBT-010 (docs/проект/незакрыто.md) leaves
 * fail-closed, and getBalance/estimateGeneration have no pinned SYNTX
 * endpoint observed yet (DEBT-005) — all three throw a distinctly-coded,
 * honest "not researched" error rather than guessing.
 *
 * Mutation semantics (idempotency/reconciliation) are implemented against
 * the durable GenerationOperationRecord state machine
 * (src/domain/generation-operation.ts) but have never been exercised against
 * the real SYNTX backend — DEBT-006 stays open until a live-owner-gated smoke
 * test proves it. In particular the SYNTX message `status` vocabulary was
 * never pinned (chat-http-client.ts's schema accepts any safe token), so
 * mapMessageStatusToOperationState() below is a conservative best-effort
 * guess, not an observed contract.
 *
 * Whoever composes this class into a runtime MUST call
 * `transactionStore.recoverInterruptedOperations()` and
 * `transactionStore.recoverInterruptedCancelAttempts()` exactly once, after
 * acquiring exclusive ownership of the store and before serving any traffic
 * through this adapter. Without that call, a record left mid-saga by a prior
 * crash (state CHAT_CREATING/GENERATION_DISPATCHING — recoveredGenerationState()
 * in generation-operation.ts sweeps exactly these two, plus their
 * *_RECONCILING counterparts; CHAT_READY is a legitimate resting state, not
 * swept, and is not part of this problem) is never normalized to its
 * *_OUTCOME_UNKNOWN counterpart. The failure mode is silent, not a thrown
 * error: getJob keeps returning that record's own queued/running status
 * forever (toJobStatus has no way to tell a genuinely stuck record from one
 * still in flight), cancelJob throws the ordinary JOB_NOT_CANCELABLE (no
 * receipt.message_id yet, same as a record that is legitimately early),
 * and getResult throws the ordinary JOB_NOT_READY — none of them detect the
 * stall or trigger reconciliation. This class does not call
 * recoverInterruptedOperations() itself — the store's own contract requires
 * "exclusive startup ownership" context this class cannot verify.
 *
 * KNOWN PREREQUISITES BEFORE THIS ADAPTER CAN BE WIRED TO A REAL RUNTIME
 * (critic-practice and critic-skeptic both walked the composition path by
 * hand and found none of these named in one place — named here explicitly
 * so the next attempt does not have to rediscover them one at a time):
 *
 * 1. RESOLVED for image (DEBT-010, D-074, 2026-09-06): chat-http-client.ts's
 *    redactMessage() no longer hard-codes `artifacts: []` — it parses the
 *    real live response shape (message_object[], author_id === -1 marks
 *    the bot, completed boolean per object, r2.syntx.ai host allowlist —
 *    see docs/интеграция/наблюдение-banana-generation-2026-09-06.md).
 *    mapMessageStatusToOperationState()'s only path to SUCCEEDED requires a
 *    non-empty artifacts list, and this class's own machinery was never
 *    changed to get there — it simply now receives a real, non-empty input
 *    when a generation actually succeeds. This adapter itself, however, has
 *    STILL never been run against a real SYNTX backend end-to-end: the
 *    live verification that DEBT-010 needed was done through a separate,
 *    narrower direct tool (syntx_owner_generate_image,
 *    src/application/owner-generate-image.ts) that bypasses this class
 *    entirely — see prerequisite 2 below. This class's own state-machine correctness
 *    (concurrent writers on the same idempotency_key never both dispatch,
 *    every safeTransition() call site makes an explicit decision about what
 *    `applied: false` means for it specifically — most check it (the two
 *    driveStartSaga gates, and every applyOrThrow use), a few deliberately
 *    return the fresh record unconditionally where no local side effect
 *    precedes the call — a first version of this file did not decide this
 *    at all, and critic-code reproduced a
 *    real double-dispatch from that gap; fixed) has been checked by three
 *    critic-review rounds and 24 tests (round 3 also hardened both new
 *    regression tests against a false-green failure mode, and closed two
 *    smaller error-boundary leaks it found in safeTransition — see
 *    решения.md D-048), none of which touch a real
 *    network. Neither claim substitutes for the other: end-to-end
 *    completion still needs DEBT-010 resolved in a different file, and
 *    "checked by review and tests" is not the same as "proven against
 *    real concurrent load or a real SYNTX backend" (DEBT-006).
 * 2. ApplicationCore (application/core.ts) cannot reach this adapter at all
 *    yet: `assertTestOnlyExecution` only allows `executionProfile ===
 *    "TEST_ONLY_MOCK"` for start_generation/estimate_generation/cancel_job,
 *    and `createDefaultApplication()` pairs ComplianceBlockedAdapter with
 *    DenyAllConfirmationStore (whose consumeGeneration always rejects) —
 *    there is no third ExecutionProfile and no non-test, non-deny-all
 *    ConfirmationStore implementation anywhere in this project yet. Wiring
 *    this adapter in needs both, not just an adapter swap.
 * 3. PARTIALLY RESOLVED (DEBT-043, 2026-09-04): resolveAiName and
 *    resolveModality now have real implementations —
 *    src/catalog/generation-ai-name-bridge.ts's GenerationAiNameResolver (a
 *    small, hand-curated, hash-pinned overlay table, same pattern as
 *    RuntimeCapabilityCatalog, cross-validated against modality so a
 *    transposed entry cannot construct) and resolveModalityFromCatalog (a
 *    thin wrapper over the already-existing, already-tested
 *    CatalogRepository.getOperation().output_modality — fully resolved, no
 *    caveat). resolveAiName resolves the SYNTX family only, not the
 *    specific model variant within it — DEBT-048. The optional static
 *    prepareMediaRequest path binds a local candidate independently, without
 *    resolving live acceptance or enabling runtime. For the legacy path a
 *    composer still has to construct and pass them in — this class does not
 *    import or default to them itself, keeping this file's only dependency
 *    on the durable store and the SYNTX chat client.
 * 4. Cancellation now uses a separate durable one-shot attempt ledger (D-051).
 *    ACKNOWLEDGED records a HTTP ACK, not proof of generation CANCELED.
 *    Unknown outcomes block repeat POST even with another key. A production
 *    composer still needs authenticated approval issuance/consumption; this
 *    adapter records only its hash and cannot mint or verify that approval.
 * 5. A dispatch that reaches GENERATION_OUTCOME_UNKNOWN leaves its chat
 *    (chat_uuid is known at that point) permanently orphaned —
 *    SyntxGenerationChatClient deliberately does not expose deleteChat
 *    here (the chat may be the only remaining clue if generation did
 *    dispatch), but nothing cleans it up automatically either. A
 *    REJECTED_NO_COMMIT from a deterministic dispatch rejection (e.g. an
 *    unverified external reference in settings) orphans an empty,
 *    never-used chat the same way.
 * 6. Contexts carry a server-resolved tenant/subject/exact connection tuple.
 *    The internal linked-generation composer binds it to one link attempt;
 *    it is not wired into either default or owner runtime. Relinking does not
 *    migrate old jobs and the attempt is not a stable upstream account ID.
 * 7. DEBT-047 is partially resolved: the dispatching caller retains its
 *    paid receipt through bounded revision-conflict retries and records it
 *    atomically with PROVIDER_ACCEPTED, including after startup recovery.
 *    No paid POST is repeated. This does not recover a receipt lost with
 *    the process before persistence, undo a TERMINAL_UNRESOLVED winner, or
 *    guarantee persistence under continuing contention/storage failure.
 *    Exclusive startup recovery is still a runtime prerequisite.
 */
export class SyntxUpstreamAdapter implements OwnerUncappedGenerationAdapter {
  private readonly store: GenerationTransactionStore;
  private readonly boundPrincipal: Readonly<GenerationPrincipalRef> | undefined;
  private readonly resolveChatClient: (principal: GenerationPrincipalRef) => SyntxGenerationChatClient;
  private readonly resolveAiName: (modelId: string) => string;
  private readonly resolveModality: (request: GenerationRequest) => Modality;
  private readonly prepareMediaRequest: SyntxUpstreamAdapterOptions["prepareMediaRequest"];
  private readonly now: () => Date;
  private readonly createOperationId: () => string;
  private readonly cancellationSaga: SyntxCancellationSaga;

  constructor(options: SyntxUpstreamAdapterOptions) {
    this.store = options.transactionStore;
    this.boundPrincipal = options.boundPrincipal === undefined ? undefined : snapshotGenerationPrincipal(options.boundPrincipal);
    this.resolveChatClient = options.resolveChatClient;
    this.resolveAiName = options.resolveAiName;
    this.resolveModality = options.resolveModality;
    this.prepareMediaRequest = options.prepareMediaRequest;
    this.now = options.now ?? (() => new Date());
    this.createOperationId =
      options.createOperationId ?? (() => `generation_${randomUUID()}`);
    this.cancellationSaga = new SyntxCancellationSaga({
      store: this.store, resolveClient: this.resolveChatClient,
      now: this.now, toJob: toGenerationJob
    });
  }

  async getBalance(principal: GenerationPrincipalRef): Promise<Balance> {
    this.requirePrincipal(principal);
    return Promise.reject(
      new ApplicationError("UPSTREAM_CAPABILITY_NOT_RESEARCHED", NOT_RESEARCHED_MESSAGE, {
        operation: "get_balance"
      })
    );
  }

  async estimateGeneration(
    principal: GenerationPrincipalRef,
    _request: GenerationRequest
  ): Promise<UpstreamGenerationEstimate> {
    this.requirePrincipal(principal);
    return Promise.reject(
      new ApplicationError("UPSTREAM_CAPABILITY_NOT_RESEARCHED", NOT_RESEARCHED_MESSAGE, {
        operation: "estimate_generation"
      })
    );
  }

  async startGeneration(
    context: StartGenerationContext,
    request: GenerationRequest
  ): Promise<GenerationJob> {
    context = { ...context, principal: this.requirePrincipal(context.principal) };
    const snapshot = snapshotSyntxGenerationRequest(request);
    // All validated eagerly, before any network call or state transition:
    // a chat created for a request that turns out to have no valid prompt
    // or an unresolvable model_id would be an orphaned SYNTX side effect
    // nothing here ever cleans up. resolveAiName used to be called later,
    // inside dispatchGenerationStep, after the chat already existed and the
    // record had moved to GENERATION_DISPATCHING — if it threw there (an
    // unmapped model_id), the exception propagated uncaught and left the
    // record stuck in GENERATION_DISPATCHING, a state neither
    // reconcileInFlight nor toJobStatus recognizes (critic-code finding).
    requireValidApprovedMaxCost(context.approved_max_cost_tokens);
    const prepared = this.prepareRequest(snapshot);
    return this.startPreparedGeneration(
      context,
      snapshot,
      prepared,
      String(context.approved_max_cost_tokens)
    );
  }

  async startOwnerGeneration(
    context: OwnerUncappedStartContext,
    request: GenerationRequest
  ): Promise<GenerationJob> {
    const principal = this.requirePrincipal(context.principal);
    const snapshot = snapshotSyntxGenerationRequest(request);
    const binding = getOwnerUncappedGenerationBinding(context.authority, principal);
    if (snapshot.model_id !== binding.model_id || snapshot.operation_id !== binding.operation_id ||
        snapshot.catalog_version !== binding.catalog_version) {
      throw new ApplicationError("INVALID_PARAMETERS", "The owner authority does not authorize this generation request.");
    }
    const hash = hashGenerationRequest(snapshot);
    const owner = ownerRef(principal);
    const existing = this.store.getByIdempotencyKey(owner, context.idempotency_key);
    if (existing !== null) {
      if (!sameGenerationPrincipal(existing.principal, principal) || existing.request_hash !== hash ||
          existing.model_id !== binding.model_id || existing.operation_id !== binding.operation_id ||
          existing.catalog_version !== binding.catalog_version || existing.schema_hash !== binding.schema_hash ||
          existing.approved_max_cost !== OWNER_UNCAPPED_APPROVED_MAX_COST ||
          existing.cost.cap_enforcement !== "UNENFORCEABLE") {
        throw new ApplicationError("IDEMPOTENCY_CONFLICT", "The idempotency key is already bound to a different owner generation contract.");
      }
      if (existing.state === "TERMINAL_UNRESOLVED") throw unresolvedError(existing);
      if (isOutcomeUnknown(existing.state)) {
        throw new ApplicationError("UPSTREAM_OUTCOME_UNKNOWN", "The owner generation outcome is unknown; no automatic retry was performed.", {
          operation_id: existing.id,
          state: existing.state
        });
      }
      if (isTerminal(existing.state) || isAcceptedInFlight(existing.state)) return toGenerationJob(existing);
    }
    const prepared = prepareOwnerUncappedGenerationRequest(context.authority, principal, snapshot);
    return this.startPreparedGeneration(context, snapshot, prepared, OWNER_UNCAPPED_APPROVED_MAX_COST);
  }

  private async startPreparedGeneration(
    context: Pick<StartGenerationContext, "principal" | "idempotency_key">,
    snapshot: GenerationRequest,
    prepared: PreparedSyntxMediaRequest,
    approvedMaxCost: string
  ): Promise<GenerationJob> {
    const modality = prepared.modality;
    const owner = ownerRef(context.principal);
    const nowIso = this.now().toISOString();

    const candidate: GenerationOperationRecord = {
      id: this.createOperationId(),
      principal: context.principal,
      idempotency_key: context.idempotency_key,
      request_hash: hashGenerationRequest(snapshot),
      model_id: snapshot.model_id,
      operation_id: snapshot.operation_id,
      modality,
      catalog_version: snapshot.catalog_version,
      schema_hash: prepared.schema_hash,
      parameter_keys: Object.keys(snapshot.parameters).sort(),
      estimate_id: "estimate_unavailable",
      approved_max_cost: approvedMaxCost,
      // effective_cost and unit must be both null or both set (enforced by
      // GenerationTransactionStore) — neither is known at PREPARED time,
      // since estimateGeneration has no real SYNTX endpoint yet.
      //
      // Neither entry path has a cost quote or an upstream-enforced cap.
      // Generic requests keep their numeric value as audit-only metadata;
      // the trusted owner path records OWNER_UNCAPPED explicitly. Both are
      // honestly UNENFORCEABLE; neither is mislabeled as a hard/pre-dispatch cap.
      cost: {
        effective_cost: null,
        unit: null,
        observed_at: UNOBSERVED_TIMESTAMP_PLACEHOLDER,
        expires_at: UNOBSERVED_TIMESTAMP_PLACEHOLDER,
        cap_enforcement: "UNENFORCEABLE"
      },
      state: "PREPARED",
      receipt: null,
      result_message_id: null,
      failure_code: null,
      dispatch_deadline: UNOBSERVED_TIMESTAMP_PLACEHOLDER,
      next_poll_at: null,
      created_at: nowIso,
      updated_at: nowIso,
      revision: 0
    };

    let record: GenerationOperationRecord;
    try {
      record = this.store.createOrReplay(candidate).record;
    } catch (error) {
      // GenerationTransactionStore throws its own error type — re-thrown as
      // ApplicationError so every UpstreamAdapter caller only ever sees
      // this port's error type, never a raw storage-layer exception.
      if (error instanceof GenerationTransactionStoreError) {
        if (error.code === "IDEMPOTENCY_CONFLICT") {
          throw new ApplicationError(
            "IDEMPOTENCY_CONFLICT",
            "The idempotency key is already bound to a different generation request."
          );
        }
        if (error.code === "INVALID_RECORD") {
          // Most commonly a parameter key that fails the store's safe-key
          // pattern (e.g. non-Latin characters, or starting with a digit) —
          // a caller input problem, not an adapter or storage bug.
          throw new ApplicationError(
            "INVALID_PARAMETERS",
            "One or more generation parameters could not be durably recorded."
          );
        }
        throw new ApplicationError(
          "UPSTREAM_OUTCOME_UNKNOWN",
          "The durable operation record could not be created.",
          { store_error_code: error.code }
        );
      }
      // Never let a raw, unrecognized store-layer error (e.g. a node:sqlite
      // busy-timeout under sustained contention) leak past this port —
      // every UpstreamAdapter caller sees this port's error type only
      // (same reasoning as safeTransition's final catch branch below).
      throw new ApplicationError(
        "UPSTREAM_OUTCOME_UNKNOWN",
        "The durable operation store raised an unrecognized error while creating the operation record.",
        { cause: error instanceof Error ? { name: error.name, message: error.message } : String(error) }
      );
    }

    if (record.state === "TERMINAL_UNRESOLVED") {
      throw unresolvedError(record);
    }
    if (isTerminal(record.state)) {
      return toGenerationJob(record);
    }

    const chatClient = this.resolveChatClient(context.principal);
    record = await this.driveStartSaga(
      owner,
      record,
      chatClient,
      prepared
    );
    if (isOutcomeUnknown(record.state)) {
      // The saga could not confirm SYNTX's side within this call. Returning
      // a job here would let the caller believe the request definitely
      // reached SYNTX (or definitely didn't) — neither is true. This method
      // does not retry through reconcileInFlight itself — the caller is
      // expected to call reconcileStart with the same idempotency_key
      // before trying startGeneration again (ApplicationCore.
      // startConfirmedGeneration already does this); reconcileStart will
      // then either recover the real state, retry what is safe to retry,
      // or surface TERMINAL_UNRESOLVED explicitly.
      throw new ApplicationError(
        "UPSTREAM_OUTCOME_UNKNOWN",
        "SYNTX's acceptance of this request could not be confirmed; retry with the same idempotency key to reconcile before assuming success or failure.",
        { operation_id: record.id, state: record.state }
      );
    }
    if (record.state === "TERMINAL_UNRESOLVED") {
      throw unresolvedError(record);
    }
    return toGenerationJob(record);
  }

  async reconcileStart(
    context: ReconcileStartContext
  ): Promise<GenerationJob | null> {
    context = { ...context, principal: this.requirePrincipal(context.principal) };
    const owner = ownerRef(context.principal);
    const record = this.store.getByIdempotencyKey(owner, context.idempotency_key);
    if (record === null) return null;
    if (!sameGenerationPrincipal(record.principal, context.principal) || record.request_hash !== context.request_hash) {
      throw new ApplicationError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key is already bound to a different generation request."
      );
    }
    if (record.state === "TERMINAL_UNRESOLVED") {
      throw unresolvedError(record);
    }
    if (isTerminal(record.state) || isAcceptedInFlight(record.state)) {
      // Durable acceptance already resolves the start, even if generation
      // is unfinished. Replay before resolving auth or consuming approval.
      return toGenerationJob(record);
    }
    const chatClient = this.resolveChatClient(context.principal);
    const resolved = await this.reconcileInFlight(owner, record, chatClient);
    if (resolved.state === "TERMINAL_UNRESOLVED") {
      throw unresolvedError(resolved);
    }
    if (isTerminal(resolved.state) || isAcceptedInFlight(resolved.state)) {
      return toGenerationJob(resolved);
    }
    // Improved but not finished: the chat-creation retry in
    // reconcileInFlight can land on CHAT_READY, but reconcileStart has no
    // access to the original request's prompt/settings (never persisted,
    // only parameter_keys are) to also retry dispatch from here. Returning
    // null tells the caller (ApplicationCore.startConfirmedGeneration) this
    // was not resolved to a final answer — it must call startGeneration
    // again (with a fresh confirmation) to continue. The durable record is
    // already advanced, so that retry skips chat creation and goes
    // straight to dispatch instead of starting over.
    return null;
  }

  /**
   * Read-only polling. A known unknown mutation outcome is an explicit error,
   * not evidence that generation is running. Status inspection never retries
   * or reconciles it. Terminal unresolved operations remain "failed" jobs;
   * startGeneration/reconcileStart also surface their unresolved error.
   */
  async getJob(context: JobContext): Promise<GenerationJob> {
    context = { ...context, principal: this.requirePrincipal(context.principal) };
    const owner = ownerRef(context.principal);
    const record = this.requireRecord(context.principal, context.job_id);
    if (isOutcomeUnknown(record.state)) {
      throw new ApplicationError(
        "UPSTREAM_OUTCOME_UNKNOWN",
        "The operation outcome is unknown; reconcile the existing start before assuming acceptance or retrying.",
        { operation_id: record.id, state: record.state }
      );
    }
    if (isTerminal(record.state) || record.receipt?.message_id === null || record.receipt?.message_id === undefined) {
      // No provider message to poll yet (PREPARED/CHAT_CREATING/CHAT_READY/
      // *_RECONCILING, or a durable CHAT_READY parked
      // there by a successful reconcileStart retry that the caller has not
      // yet resumed with startGeneration) — a passive status check must
      // not crash trying to poll something that does not exist yet.
      // toJobStatus already gives a sensible status for every one of
      // these states.
      return toGenerationJob(record);
    }
    const chatClient = this.resolveChatClient(context.principal);
    const refreshed = await this.pollAndTransition(owner, record, chatClient);
    return toGenerationJob(refreshed);
  }

  async cancelJob(context: CancelJobContext): Promise<GenerationJob> {
    return this.cancellationSaga.cancel({ ...context, principal: this.requirePrincipal(context.principal) });
  }

  async reconcileCancel(
    context: ReconcileCancelContext
  ): Promise<GenerationJob | null> {
    return this.cancellationSaga.reconcile({ ...context, principal: this.requirePrincipal(context.principal) });
  }

  async getResult(context: JobContext): Promise<GenerationResult> {
    context = { ...context, principal: this.requirePrincipal(context.principal) };
    const record = this.requireRecord(context.principal, context.job_id);
    if (record.state !== "SUCCEEDED" || record.receipt === null) {
      throw new ApplicationError(
        "JOB_NOT_READY",
        `Job ${context.job_id} has state ${record.state}; a result is available only after SUCCEEDED.`
      );
    }
    const chatClient = this.resolveChatClient(context.principal);
    const message = await chatClient.getMessage(
      record.receipt.chat_uuid,
      record.result_message_id ?? requireMessageId(record.receipt)
    );
    if (message.artifacts.length === 0) {
      // The durable record says SUCCEEDED (it can only reach that state via
      // mapMessageStatusToOperationState, which itself requires a non-empty
      // artifacts list), but this fresh call came back empty. That is not a
      // successful zero-artifact result — it means the artifact reference
      // could not be confirmed right now (expired, chat-http-client.ts's
      // still-fail-closed result envelope per DEBT-010, or a genuine
      // upstream inconsistency). Reporting it as GenerationResult with an
      // empty artifacts array would silently look like a valid, empty
      // success — critic-code flagged this exact silent-corruption case.
      throw new ApplicationError(
        "UPSTREAM_OUTCOME_UNKNOWN",
        `Job ${context.job_id} is recorded as succeeded but no artifact could be confirmed on this attempt.`,
        { operation_id: record.id }
      );
    }
    return {
      id: `result_${record.id}`,
      job_id: record.id,
      model_id: record.model_id,
      operation_id: record.operation_id,
      catalog_version: record.catalog_version,
      completed_at: record.updated_at,
      summary: "SYNTX generation completed.",
      artifacts: mapArtifacts(message.artifacts, record.modality)
    };
  }

  private requirePrincipal(input: GenerationPrincipalRef): Readonly<GenerationPrincipalRef> {
    const principal = snapshotGenerationPrincipal(input);
    if (this.boundPrincipal && !sameGenerationPrincipal(this.boundPrincipal, principal)) {
      throw new ApplicationError("INVALID_PARAMETERS", "The generation principal does not match this server scope.");
    }
    return principal;
  }

  private requireMediaModality(request: GenerationRequest): MediaModality {
    const modality = this.resolveModality(request);
    if (!isMediaModality(modality)) {
      throw new ApplicationError(
        "UPSTREAM_CAPABILITY_NOT_RESEARCHED",
        "Only image, video, and audio generation are implemented; text generation needs the file-reference contract DEBT-010 leaves fail-closed.",
        { operation_id: request.operation_id, modality }
      );
    }
    return modality;
  }

  private prepareRequest(request: GenerationRequest): PreparedSyntxMediaRequest {
    if (this.prepareMediaRequest !== undefined) {
      try {
        // Exactly once, before PREPARED/client lookup. Copy the return as well:
        // the server callback may retain its own mutable result object.
        return snapshotPreparedMediaRequest(this.prepareMediaRequest(request));
      } catch {
        // Callback exceptions may contain prompts, URLs or credentials.
        throw invalidMediaPreparation();
      }
    }
    // Legacy resolvers retain their existing errors and semantics. Capture the
    // split once; the saga must never revisit caller parameters after an await.
    const modality = this.requireMediaModality(request);
    const { prompt, settings } = splitMediaParameters(request.parameters);
    return Object.freeze({
      prompt, settings, modality,
      ai_name: this.resolveAiName(request.model_id),
      schema_hash: UNSCHEMATIZED_PLACEHOLDER_HASH
    });
  }

  private requireRecord(
    principal: GenerationPrincipalRef,
    jobId: string
  ): GenerationOperationRecord {
    const record = this.store.getById(ownerRef(principal), jobId);
    if (record === null || !sameGenerationPrincipal(record.principal, principal)) {
      throw new ApplicationError("JOB_NOT_FOUND", "The requested job was not found.");
    }
    return record;
  }

  /**
   * Every state transition in this adapter goes through here instead of
   * calling `this.store.transition()` directly — GenerationTransactionStoreError
   * was leaking raw past the UpstreamAdapter port boundary (critic-code
   * finding). REVISION_CONFLICT specifically is not a real error: it means
   * a concurrent caller (another getJob/cancelJob poll on the same job)
   * already moved this record past the revision this call read — reading
   * the fresh record back and returning it is correct, not a failure.
   */
  /**
   * CRITICAL: `applied` is not optional to check. An earlier version of
   * this method silently returned the freshly-read record on
   * REVISION_CONFLICT as if the caller's own transition had gone through
   * — critic-code reproduced this concretely: two writers racing on the
   * same idempotency_key could both reach GENERATION_DISPATCHING and both
   * call the real, paid startImage/startVideo/startAudio, because the
   * losing writer's conflict was swallowed and driveStartSaga proceeded
   * to dispatch anyway using someone else's (concurrently advanced)
   * record. The exact same swallow could also silently drop an
   * already-accepted cancellation. Every call site below now makes an
   * explicit choice about what `applied: false` means for it — most inspect
   * `applied` before doing anything the record's new state would imply is
   * safe; a few deliberately skip the check and return the fresh record
   * unconditionally, because no local side effect precedes that specific
   * call (a concurrent writer's outcome is just as valid to report there as
   * this caller's own would have been) — see the comment at each call site
   * for which one it is and why.
   *
   * GenerationStateTransitionError (thrown by the store's own transition-
   * graph guard, a different exception type than
   * GenerationTransactionStoreError) is NOT treated like REVISION_CONFLICT.
   * The store checks revision BEFORE the transition graph
   * (sqlite-generation-transaction-store.ts's `transition()`: expected
   * revision is compared first, the graph guard runs only once that check
   * has already passed) — so this error can only ever fire when the record
   * is exactly in the state this caller read, with no concurrent writer in
   * between. It means this adapter itself requested a transition its own
   * state machine forbids: an adapter bug, not a race. Swallowing it as
   * "applied: false, someone else moved it" would silently hide that bug
   * behind a fabricated concurrent-writer story (critic-code, round 3) —
   * it is surfaced loudly instead.
   *
   * Any other, unrecognized error from the store (for example a raw
   * node:sqlite failure such as a busy-timeout under sustained contention)
   * is also never allowed to leak past this port raw — every
   * UpstreamAdapter caller sees this port's error type only.
   */
  private safeTransition(
    input: GenerationOperationTransitionInput
  ): TransitionOutcome {
    try {
      return { applied: true, record: this.store.transition(input) };
    } catch (error) {
      if (
        error instanceof GenerationTransactionStoreError &&
        error.code === "REVISION_CONFLICT"
      ) {
        return { applied: false, record: this.requireFreshRecord(input) };
      }
      if (error instanceof GenerationStateTransitionError) {
        throw new ApplicationError(
          "UPSTREAM_OUTCOME_UNKNOWN",
          "This adapter requested a state transition its own durable state machine forbids. This is an adapter bug, not a concurrent-writer conflict.",
          { operation_id: input.id, requested_to_state: input.to_state }
        );
      }
      if (error instanceof GenerationTransactionStoreError) {
        throw new ApplicationError(
          "UPSTREAM_OUTCOME_UNKNOWN",
          "The durable operation record could not be updated.",
          { store_error_code: error.code }
        );
      }
      throw new ApplicationError(
        "UPSTREAM_OUTCOME_UNKNOWN",
        "The durable operation store raised an unrecognized error while applying a transition.",
        {
          operation_id: input.id,
          cause: error instanceof Error ? { name: error.name, message: error.message } : String(error)
        }
      );
    }
  }

  private requireFreshRecord(
    input: GenerationOperationTransitionInput
  ): GenerationOperationRecord {
    const fresh = this.store.getById(input.owner, input.id);
    if (fresh === null) {
      throw new ApplicationError(
        "UPSTREAM_OUTCOME_UNKNOWN",
        "The durable operation record could not be re-read after a conflicting update."
      );
    }
    return fresh;
  }

  /**
   * For call sites recording the outcome of a network action that has
   * ALREADY happened (a chat was created, a generation was dispatched, a
   * cancellation was acknowledged) — there is no safe way to "not apply"
   * here: the caller has a real result it cannot durably drop or hand to
   * whichever concurrent writer won instead. Throwing surfaces the
   * inconsistency loudly (a human/reconciliation must look at it) rather
   * than silently discarding or misattributing a real side effect.
   */
  private applyOrThrow(outcome: TransitionOutcome): GenerationOperationRecord {
    if (!outcome.applied) {
      throw new ApplicationError(
        "UPSTREAM_OUTCOME_UNKNOWN",
        "A network action completed but its outcome could not be durably recorded because a concurrent update changed this operation first.",
        { operation_id: outcome.record.id }
      );
    }
    return outcome.record;
  }

  private async driveStartSaga(
    owner: GenerationOperationOwnerRef,
    record: GenerationOperationRecord,
    chatClient: SyntxGenerationChatClient,
    prepared: PreparedSyntxMediaRequest
  ): Promise<GenerationOperationRecord> {
    let current = record;
    if (current.state === "PREPARED") {
      const advance = this.safeTransition({
        owner,
        id: current.id,
        expected_revision: current.revision,
        to_state: "CHAT_CREATING",
        updated_at: this.now().toISOString()
      });
      if (!advance.applied) {
        // A concurrent writer already moved this record past PREPARED —
        // it is already being (or already was) handled. Calling
        // createChatStep here too would create a redundant chat for
        // nothing; returning the fresh record lets the caller see
        // whatever the other writer actually achieved.
        return advance.record;
      }
      current = await this.createChatStep(
        owner,
        advance.record,
        chatClient,
        prepared.modality,
        "CHAT_CREATE_OUTCOME_UNKNOWN",
        "REJECTED_NO_COMMIT"
      );
    }
    if (current.state === "CHAT_CREATE_OUTCOME_UNKNOWN" || isTerminal(current.state)) {
      return current;
    }
    if (current.state === "CHAT_READY") {
      const advance = this.safeTransition({
        owner,
        id: current.id,
        expected_revision: current.revision,
        to_state: "GENERATION_DISPATCHING",
        updated_at: this.now().toISOString()
      });
      if (!advance.applied) {
        // CRITICAL gate: a concurrent writer already moved this record
        // past CHAT_READY. Calling dispatchGenerationStep here too would
        // send a second real, paid startImage/startVideo/startAudio for
        // the same operation — this is the exact regression critic-code
        // reproduced when this check was missing. Must return without
        // dispatching.
        return advance.record;
      }
      current = await this.dispatchGenerationStep(
        owner,
        advance.record,
        chatClient,
        prepared
      );
    }
    return current;
  }

  /**
   * Shared by the initial attempt (from CHAT_CREATING) and the reconciliation
   * retry (from CHAT_RECONCILING) — ALLOWED_TRANSITIONS permits different
   * exits from each: CHAT_CREATING allows REJECTED_NO_COMMIT for a
   * deterministic rejection, but CHAT_RECONCILING does not (only
   * CHAT_READY/CHAT_CREATE_OUTCOME_UNKNOWN/TERMINAL_UNRESOLVED) — so the
   * caller supplies the correct target state for each failure kind instead
   * of this method guessing which context it runs in.
   */
  private async createChatStep(
    owner: GenerationOperationOwnerRef,
    record: GenerationOperationRecord,
    chatClient: SyntxGenerationChatClient,
    modality: MediaModality,
    onAmbiguousFailure: GenerationOperationState,
    onDeterministicFailure: GenerationOperationState
  ): Promise<GenerationOperationRecord> {
    let receipt: { chat_uuid: string };
    try {
      receipt = await chatClient.createChat(modality, chatTitleFor(record));
    } catch (error) {
      if (isDefinitelyNotCommitted(error)) {
        // SYNTX (or client-side validation ahead of it) rejected this
        // deterministically before any chat could exist — no network
        // side effect happened, so applyOrThrow's "a network action
        // completed but..." framing would be false here. If a concurrent
        // writer already moved this record (applied: false), its record
        // is simply the correct thing to return, not a reason to throw
        // (critic-code, round 3).
        return this.safeTransition({
          owner,
          id: record.id,
          expected_revision: record.revision,
          to_state: onDeterministicFailure,
          updated_at: this.now().toISOString(),
          failure_code: describeRejectionCode(error)
        }).record;
      }
      // Genuinely ambiguous (timeout/network/protocol error): the response
      // is lost, not necessarily the request. Automatic retry is
      // forbidden — the caller must reconcile (reconcileStart) before
      // trying again.
      return this.applyOrThrow(
        this.safeTransition({
          owner,
          id: record.id,
          expected_revision: record.revision,
          to_state: onAmbiguousFailure,
          updated_at: this.now().toISOString()
        })
      );
    }
    return this.applyOrThrow(
      this.safeTransition({
        owner,
        id: record.id,
        expected_revision: record.revision,
        to_state: "CHAT_READY",
        updated_at: this.now().toISOString(),
        receipt: {
          chat_uuid: receipt.chat_uuid,
          provider_job_id: null,
          message_id: null,
          message_object_id: null
        }
      })
    );
  }

  private async dispatchGenerationStep(
    owner: GenerationOperationOwnerRef,
    record: GenerationOperationRecord,
    chatClient: SyntxGenerationChatClient,
    prepared: PreparedSyntxMediaRequest
  ): Promise<GenerationOperationRecord> {
    const chatUuid = requireChatUuid(record.receipt);
    let receipt: MediaGenerationReceipt;
    try {
      receipt = await this.startMedia(
        chatClient,
        prepared.modality,
        chatUuid,
        prepared.ai_name,
        prepared.prompt,
        prepared.settings
      );
    } catch (error) {
      if (isDefinitelyNotCommitted(error)) {
        // Chat exists, but this specific dispatch was deterministically
        // rejected (e.g. an unverified external reference URL in
        // settings) — no generation was ever queued. The chat itself is
        // now orphaned (empty, never used) — chatClient does not expose
        // deleteChat on this narrow interface, so it is left for manual
        // or future automated cleanup, not silently pretended away.
        // No network side effect happened for THIS dispatch attempt, so
        // (as in createChatStep's matching branch) a concurrent writer's
        // record is simply returned, not treated as a throw-worthy loss
        // (critic-code, round 3).
        return this.safeTransition({
          owner,
          id: record.id,
          expected_revision: record.revision,
          to_state: "REJECTED_NO_COMMIT",
          updated_at: this.now().toISOString(),
          failure_code: describeRejectionCode(error)
        }).record;
      }
      // Same ambiguity as chat creation: the dispatch may have reached
      // SYNTX. No automatic retry — reconcileStart must resolve this.
      return this.applyOrThrow(
        this.safeTransition({
          owner,
          id: record.id,
          expected_revision: record.revision,
          to_state: "GENERATION_OUTCOME_UNKNOWN",
          updated_at: this.now().toISOString()
        })
      );
    }
    return this.persistAcceptedGeneration(owner, record, receipt);
  }

  /**
   * Only the caller holding the actual response from this operation's paid
   * POST enters here. Retrying a local CAS is not retrying that POST. Recovery
   * may have changed DISPATCHING to OUTCOME_UNKNOWN; acceptance and receipt
   * must commit together (the store forbids provider ids in unknown states).
   */
  private persistAcceptedGeneration(
    owner: GenerationOperationOwnerRef,
    dispatched: GenerationOperationRecord,
    receipt: MediaGenerationReceipt
  ): GenerationOperationRecord {
    let current = dispatched;
    // At most three local writes; a final read-back can recognize an
    // identical receipt already committed by a concurrent writer.
    for (let attempt = 0; attempt <= 3; attempt += 1) {
      if (
        typeof receipt.message_id !== "string" ||
        current.id !== dispatched.id ||
        current.principal.tenant_id !== dispatched.principal.tenant_id ||
        current.principal.subject_id !== dispatched.principal.subject_id ||
        current.principal.connection_id !== dispatched.principal.connection_id ||
        current.idempotency_key !== dispatched.idempotency_key ||
        current.request_hash !== dispatched.request_hash ||
        current.model_id !== dispatched.model_id ||
        current.operation_id !== dispatched.operation_id ||
        current.receipt?.chat_uuid !== dispatched.receipt?.chat_uuid ||
        receipt.chat_uuid !== dispatched.receipt?.chat_uuid
      ) {
        break;
      }
      if (
        current.state !== "TERMINAL_UNRESOLVED" &&
        current.receipt?.message_id === receipt.message_id
      ) {
        return current;
      }
      if (
        attempt === 3 ||
        (current.state !== "GENERATION_DISPATCHING" &&
          current.state !== "GENERATION_OUTCOME_UNKNOWN" &&
          current.state !== "GENERATION_RECONCILING")
      ) {
        break;
      }
      const outcome = this.safeTransition({
        owner,
        id: current.id,
        expected_revision: current.revision,
        to_state: "PROVIDER_ACCEPTED",
        updated_at: this.now().toISOString(),
        failure_code: null,
        receipt: {
          chat_uuid: receipt.chat_uuid,
          provider_job_id: null,
          message_id: receipt.message_id,
          message_object_id: null
        }
      });
      if (outcome.applied) return outcome.record;
      current = outcome.record;
    }
    throw new ApplicationError(
      "UPSTREAM_OUTCOME_UNKNOWN",
      "The provider receipt could not be durably attributed to this operation; no generation request was repeated.",
      { operation_id: dispatched.id }
    );
  }

  private startMedia(
    chatClient: SyntxGenerationChatClient,
    modality: MediaModality,
    chatUuid: string,
    aiName: string,
    prompt: string,
    settings: Readonly<Record<string, unknown>>
  ): Promise<MediaGenerationReceipt> {
    switch (modality) {
      case "image":
        return chatClient.startImage({
          ai_name: aiName,
          chat_uuid: chatUuid,
          prompt,
          settings
        });
      case "video":
        return chatClient.startVideo({
          ai_name: aiName,
          chat_id: chatUuid,
          prompt,
          settings
        });
      case "audio":
        return chatClient.startAudio({
          ai_name: aiName,
          chat_uuid: chatUuid,
          prompt,
          settings
        });
    }
  }

  private async reconcileInFlight(
    owner: GenerationOperationOwnerRef,
    record: GenerationOperationRecord,
    chatClient: SyntxGenerationChatClient
  ): Promise<GenerationOperationRecord> {
    if (record.state === "CHAT_CREATE_OUTCOME_UNKNOWN") {
      // No chat_uuid was ever durably recorded, so nothing can be polled to
      // confirm which outcome actually happened. But retrying the (free)
      // createChat call is still safe: generation dispatch only ever
      // happens later, from CHAT_READY, gated by optimistic concurrency on
      // expected_revision — a second createChat can at worst orphan one
      // extra empty chat, never double-dispatch a paid generation.
      // ALLOWED_TRANSITIONS was explicitly designed for this retry
      // (CHAT_CREATE_OUTCOME_UNKNOWN -> CHAT_RECONCILING -> CHAT_READY) —
      // critic-code found that path was never used, going straight to
      // TERMINAL_UNRESOLVED instead and burning the confirmation/
      // idempotency_key on every transient network blip during the
      // free chat-creation step. Fixed: attempt the retry once here.
      const reconciling = this.safeTransition({
        owner,
        id: record.id,
        expected_revision: record.revision,
        to_state: "CHAT_RECONCILING",
        updated_at: this.now().toISOString()
      });
      if (!reconciling.applied) {
        // Someone else is already reconciling (or otherwise modifying)
        // this same record — do not also retry createChat, which would
        // just orphan a second chat for no benefit.
        return reconciling.record;
      }
      return this.createChatStep(
        owner,
        reconciling.record,
        chatClient,
        // Safe: this adapter only ever creates a record after
        // requireMediaModality (startGeneration) has already narrowed
        // modality to image/video/audio — "text" never reaches a durable
        // record. record.modality's wider Modality type just reflects the
        // domain schema, not a real possibility here.
        record.modality as MediaModality,
        "CHAT_CREATE_OUTCOME_UNKNOWN",
        "TERMINAL_UNRESOLVED"
      );
    }
    if (record.state === "GENERATION_OUTCOME_UNKNOWN") {
      // The dispatch response was lost before any message_id was durably
      // recorded, and getMessage requires one. SYNTX's listInProgress
      // endpoint (chats/{chat_uuid}/inprogress) could in principle find a
      // candidate, but nothing observed so far correlates an in-progress
      // entry back to a specific dispatch attempt — matching by guesswork
      // risks confirming the wrong message. Deliberately not attempted here;
      // tracked as a possible future improvement, not silently assumed safe.
      // No network call happens in this branch — if a concurrent writer
      // beat this transition, returning its fresh record (rather than
      // throwing) is safe: nothing here needs to be recorded that was
      // not already durable.
      return this.safeTransition({
        owner,
        id: record.id,
        expected_revision: record.revision,
        to_state: "TERMINAL_UNRESOLVED",
        updated_at: this.now().toISOString(),
        failure_code: "GENERATION_DISPATCH_UNRECONCILABLE"
      }).record;
    }
    return record;
  }

  private async pollAndTransition(
    owner: GenerationOperationOwnerRef,
    record: GenerationOperationRecord,
    chatClient: SyntxGenerationChatClient
  ): Promise<GenerationOperationRecord> {
    const chatUuid = requireChatUuid(record.receipt);
    const messageId = record.result_message_id ?? requireMessageId(record.receipt);
    const message = await chatClient.getMessage(chatUuid, messageId);
    if (record.result_message_id == null && message.artifacts.length === 0) {
      if (!chatClient.listMessageCandidates) return record;
      let history: ChatMessageHistorySnapshot;
      try {
        history = await chatClient.listMessageCandidates(chatUuid, messageId);
      } catch {
        throw new ApplicationError(
          "UPSTREAM_OUTCOME_UNKNOWN",
          "The accepted generation result could not be uniquely identified from complete chat history.",
          { operation_id: record.id, reason_code: "RESULT_HISTORY_UNAVAILABLE" }
        );
      }
      const resultMessageId = findUniqueResultMessage(history, record);
      if (resultMessageId === null) {
        throw new ApplicationError(
          "UPSTREAM_OUTCOME_UNKNOWN",
          "The accepted generation result could not be uniquely identified from complete chat history.",
          { operation_id: record.id, reason_code: "RESULT_NOT_UNIQUELY_ATTRIBUTABLE" }
        );
      }
      let bound: GenerationOperationRecord | null;
      try {
        bound = this.store.bindResultMessage({
          owner,
          id: record.id,
          expected_revision: record.revision,
          result_message_id: resultMessageId,
          updated_at: this.now().toISOString()
        });
      } catch (error) {
        if (!(error instanceof GenerationTransactionStoreError) || error.code !== "REVISION_CONFLICT") throw error;
        bound = this.store.getById(owner, record.id);
      }
      if (bound === null || bound.result_message_id !== resultMessageId) return bound ?? record;
      record = bound;
      const botMessage = await chatClient.getMessage(chatUuid, resultMessageId);
      return this.transitionFromMessage(owner, record, botMessage);
    }
    return this.transitionFromMessage(owner, record, message);
  }

  private transitionFromMessage(
    owner: GenerationOperationOwnerRef,
    record: GenerationOperationRecord,
    message: RedactedMessageEnvelope
  ): GenerationOperationRecord {
    const nextState = mapMessageStatusToOperationState(message, record.state);
    if (nextState === record.state) {
      return record;
    }
    // Recording an observed status, not a local side effect — if a
    // concurrent writer already moved this record on, its fresh state is
    // exactly as valid to report back as this poll's own would have been.
    return this.safeTransition({
      owner,
      id: record.id,
      expected_revision: record.revision,
      to_state: nextState,
      updated_at: this.now().toISOString()
    }).record;
  }
}

function ownerRef(principal: GenerationPrincipalRef): GenerationOperationOwnerRef {
  return { tenant_id: principal.tenant_id, subject_id: principal.subject_id };
}

function isTerminal(state: GenerationOperationState): boolean {
  return (
    state === "SUCCEEDED" ||
    state === "FAILED" ||
    state === "CANCELED" ||
    state === "REJECTED_NO_COMMIT" ||
    state === "TERMINAL_UNRESOLVED"
  );
}

function isOutcomeUnknown(state: GenerationOperationState): boolean {
  return (
    state === "CHAT_CREATE_OUTCOME_UNKNOWN" ||
    state === "GENERATION_OUTCOME_UNKNOWN"
  );
}

function isAcceptedInFlight(state: GenerationOperationState): boolean {
  return state === "PROVIDER_ACCEPTED" || state === "QUEUED" || state === "RUNNING";
}

/**
 * Narrow, conservative allowlist (critic-code's exact recommendation, not
 * extended on my own judgment): these two SyntxHttpError codes are thrown
 * by chat-http-client.ts entirely client-side, before any network request
 * is sent (validateModelIdentifier/validateBoundedText/sanitizeSettings/
 * assertNoUnverifiedExternalReferences, or a credential broker that never
 * entered its callback). Nothing was sent, so nothing could have been
 * committed. AUTH_OR_ACCESS_DENIED (401/403) and UPSTREAM_RATE_LIMITED
 * (429) are also plausibly pre-business-logic rejections, but that is not
 * confirmed by observation — left classified as ambiguous rather than
 * guessed safe.
 */
function isDefinitelyNotCommitted(error: unknown): boolean {
  return (
    error instanceof SyntxHttpError &&
    (error.code === "INVALID_REQUEST" || error.code === "AUTH_REQUIRED")
  );
}

function describeRejectionCode(error: unknown): string {
  return error instanceof SyntxHttpError
    ? `SYNTX_REJECTED_${error.code}`
    : "SYNTX_REJECTED_UNKNOWN";
}

function isMediaModality(modality: Modality): modality is MediaModality {
  return (MEDIA_MODALITIES as readonly string[]).includes(modality);
}

function chatTitleFor(record: GenerationOperationRecord): string {
  return `mcp-generation-${record.id}`;
}

function requireChatUuid(receipt: ProviderGenerationReceipt | null): string {
  if (receipt === null) {
    throw new ApplicationError(
      "UPSTREAM_OUTCOME_UNKNOWN",
      "No chat has been durably recorded for this operation yet."
    );
  }
  return receipt.chat_uuid;
}

function requireMessageId(receipt: ProviderGenerationReceipt | null): string {
  const messageId = receipt?.message_id ?? null;
  if (messageId === null) {
    throw new ApplicationError(
      "UPSTREAM_OUTCOME_UNKNOWN",
      "No provider message has been durably recorded for this operation yet."
    );
  }
  return messageId;
}

/**
 * String(context.approved_max_cost_tokens) is what actually reaches the
 * durable record's approved_max_cost field, and GenerationTransactionStore
 * requires that to match DECIMAL_PATTERN (a non-negative integer or
 * decimal, no leading zero, no sign). Validating the same shape here first
 * turns a bad cap into a clearly-labeled ApplicationError instead of a
 * store-level GenerationTransactionStoreError("INVALID_RECORD") that this
 * adapter's createOrReplay catch block would otherwise report as
 * INVALID_PARAMETERS — technically true (the record could not be recorded)
 * but misleadingly worded, since the actual cause is the cap, not
 * request.parameters, and an operator chasing that message would look in
 * the wrong place.
 */
function requireValidApprovedMaxCost(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new ApplicationError(
      "COST_CAP_EXCEEDED",
      "approved_max_cost_tokens must be a non-negative finite number."
    );
  }
}

function splitMediaParameters(
  parameters: Record<string, unknown>
): { prompt: string; settings: Readonly<Record<string, unknown>> } {
  const { prompt, ...rest } = parameters;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new ApplicationError(
      "INVALID_PARAMETERS",
      "A non-empty string 'prompt' parameter is required for image, video, and audio generation."
    );
  }
  return { prompt, settings: Object.freeze(rest) };
}

/** Internal shared guard, deliberately not exported by the package entrypoint. */
export function snapshotSyntxGenerationRequest(input: unknown): GenerationRequest {
  const value = snapshotMediaJson(input);
  if (!isJsonRecord(value) ||
      !hasExactKeys(value, ["model_id", "operation_id", "catalog_version", "parameters"]) ||
      !isSafeBinding(value.model_id) || !isSafeBinding(value.operation_id) ||
      !isSafeBinding(value.catalog_version) || !isJsonRecord(value.parameters)) {
    throw invalidMediaPreparation();
  }
  return value as unknown as GenerationRequest;
}

function snapshotPreparedMediaRequest(input: unknown): PreparedSyntxMediaRequest {
  const value = snapshotMediaJson(input);
  if (!isJsonRecord(value) ||
      !hasExactKeys(value, ["prompt", "settings", "ai_name", "modality", "schema_hash"]) ||
      typeof value.prompt !== "string" || value.prompt.trim().length === 0 ||
      Buffer.byteLength(value.prompt, "utf8") > 128 * 1024 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.prompt) ||
      !isJsonRecord(value.settings) || typeof value.ai_name !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u.test(value.ai_name) ||
      typeof value.modality !== "string" ||
      !(MEDIA_MODALITIES as readonly string[]).includes(value.modality) ||
      typeof value.schema_hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.schema_hash)) {
    throw invalidMediaPreparation();
  }
  return value as unknown as PreparedSyntxMediaRequest;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeBinding(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:~+-]{0,199}$/u.test(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

/** Copy only bounded inert JSON data; never call getters, proxies or toJSON. */
function snapshotMediaJson(input: unknown): unknown {
  let nodes = 0;
  let bytes = 0;
  const active = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    if (++nodes > 4096 || depth > 10 || bytes > 256 * 1024) throw invalidMediaPreparation();
    if (value === null || typeof value === "boolean") { bytes += 5; return value; }
    if (typeof value === "string") {
      bytes += Buffer.byteLength(value, "utf8") + 2;
      if (bytes > 256 * 1024) throw invalidMediaPreparation();
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) { bytes += 32; return value; }
    if (typeof value !== "object" || value === null || isProxy(value) || active.has(value)) {
      throw invalidMediaPreparation();
    }
    const array = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype) &&
        (array || Object.getPrototypeOf(value) !== null)) throw invalidMediaPreparation();
    const keys = Reflect.ownKeys(value);
    const length = array ? Object.getOwnPropertyDescriptor(value, "length")?.value as number : 0;
    if (keys.length > 129 || (array && (length > 64 || keys.length !== length + 1))) {
      throw invalidMediaPreparation();
    }
    active.add(value);
    const result: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(key) ||
          ["__proto__", "prototype", "constructor"].includes(key) ||
          (array && (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) {
        throw invalidMediaPreparation();
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw invalidMediaPreparation();
      bytes += key.length + 4;
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true });
    }
    active.delete(value);
    if (bytes > 256 * 1024) throw invalidMediaPreparation();
    return Object.freeze(result);
  };
  return copy(input, 0);
}

function invalidMediaPreparation(): ApplicationError {
  return new ApplicationError("INVALID_PARAMETERS", "The media generation request could not be safely prepared.");
}

/**
 * SYNTX's message `status` vocabulary was never pinned by observation
 * (chat-http-client.ts accepts any safe token, no enum). An earlier version
 * of this function guessed FAILED/CANCELED from substrings like "fail" or
 * "cancel" — critic-risk and critic-code both flagged this as a severe,
 * silent-money-loss bug: FAILED/CANCELED are dead ends in
 * ALLOWED_TRANSITIONS (generation-operation.ts), so one false-positive
 * substring match (a real but unobserved token like "cancelable" or
 * "failover") on a still-running, already-paid-for generation would lose
 * it permanently — no transition leads back out. Fixed by removing all
 * guessed terminal-failure detection: the only paths this function can
 * produce are the ones ALLOWED_TRANSITIONS already permits from
 * PROVIDER_ACCEPTED/QUEUED/RUNNING (SUCCEEDED via artifacts, or the
 * monotonic PROVIDER_ACCEPTED -> QUEUED -> RUNNING progression) — it can
 * never suggest an invalid transition, by construction, not by a defensive
 * catch. A job SYNTX genuinely failed will poll as RUNNING forever rather
 * than being wrongly closed out — the safe failure mode until a real
 * status vocabulary and/or a dispatch_deadline-based timeout policy exist
 * (both future work, tracked as debt, not implemented here).
 */
function mapMessageStatusToOperationState(
  message: RedactedMessageEnvelope,
  currentState: GenerationOperationState
): GenerationOperationState {
  if (message.artifacts.length > 0) return "SUCCEEDED";
  if (message.status === "queued" && currentState === "PROVIDER_ACCEPTED") return "QUEUED";
  if (message.status === "running" && currentState !== "RUNNING") return "RUNNING";
  return currentState;
}

function findUniqueResultMessage(
  history: ChatMessageHistorySnapshot,
  record: GenerationOperationRecord
): string | null {
  const echoId = record.receipt?.message_id;
  if (
    !history.complete || history.page !== 1 || history.page_size !== 10 ||
    history.has_next || history.has_previous || history.total_count !== 2 ||
    history.total_pages !== 1 || history.messages.length !== 2 ||
    !/^\d+$/u.test(history.provider_chat_id) || echoId === null || echoId === undefined
  ) return null;
  if (history.messages.some((entry) => entry.provider_chat_id !== history.provider_chat_id)) return null;
  const ownerRows = history.messages.filter((entry) => entry.author_role === "owner" && entry.message_id === echoId);
  const botRows = history.messages.filter((entry) => entry.author_role === "bot");
  if (ownerRows.length !== 1 || botRows.length !== 1 || history.messages.some((entry) => entry.author_role === "other")) return null;
  const echo = ownerRows[0]!;
  const bot = botRows[0]!;
  if (bot.message_id === echo.message_id || echo.objects.length !== 1 || bot.objects.length !== 1) return null;
  const echoObject = echo.objects[0]!;
  const botObject = bot.objects[0]!;
  if (echoObject.object_type !== "text" || echoObject.model_type !== record.model_id) return null;
  if (botObject.object_type !== record.modality || botObject.model_type !== record.model_id) return null;
  return bot.message_id;
}

function toGenerationJob(record: GenerationOperationRecord): GenerationJob {
  return {
    id: record.id,
    model_id: record.model_id,
    operation_id: record.operation_id,
    catalog_version: record.catalog_version,
    status: toJobStatus(record.state),
    created_at: record.created_at,
    updated_at: record.updated_at
  };
}

function toJobStatus(state: GenerationOperationState): JobStatus {
  switch (state) {
    case "SUCCEEDED":
      return "succeeded";
    case "FAILED":
    case "REJECTED_NO_COMMIT":
    case "TERMINAL_UNRESOLVED":
      return "failed";
    case "CANCELED":
      return "canceled";
    case "QUEUED":
    case "PREPARED":
    case "CHAT_CREATING":
    case "CHAT_READY":
    case "PROVIDER_ACCEPTED":
      return "queued";
    default:
      return "running";
  }
}

function mapArtifacts(
  artifacts: readonly SafeArtifactMetadata[],
  modality: Modality
): GenerationArtifact[] {
  return artifacts.map((artifact, index) => ({
    id: `artifact_${index}`,
    kind: modality,
    mime_type: artifact.mime_type ?? "application/octet-stream",
    size_bytes: artifact.byte_size ?? null,
    download_url: artifact.url
  }));
}

function unresolvedError(record: GenerationOperationRecord): ApplicationError {
  return new ApplicationError(
    "UPSTREAM_OUTCOME_UNKNOWN",
    `Generation operation ${record.id} could not be reconciled with SYNTX and needs manual review.`,
    { operation_id: record.id, state: record.state }
  );
}
