import { ApplicationError } from "../errors.js";
import { hashGenerationRequest } from "../application/generation-request.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import {
  generationPrincipalKey,
  snapshotGenerationPrincipal
} from "../domain/generation-principal.js";
import type {
  Balance,
  GenerationJob,
  GenerationRequest,
  GenerationResult,
  Modality,
  UpstreamGenerationEstimate
} from "../domain/types.js";
import type {
  CancelJobContext,
  JobContext,
  ReconcileCancelContext,
  ReconcileStartContext,
  StartGenerationContext,
  UpstreamAdapter
} from "./upstream-adapter.js";

interface StoredMockJob {
  principal: Readonly<GenerationPrincipalRef>;
  job: GenerationJob;
  result: GenerationResult;
}

export interface MockAdapterOptions {
  failBeforeCommitOnce?: boolean;
  unknownAfterCommitOnce?: boolean;
  cancelUnknownAfterCommitOnce?: boolean;
  artifactDownloadUrl?: string | null;
  resultSummary?: string;
}

const MOCK_GENERATION_COST_TOKENS = 1;

/**
 * Deterministic, in-memory test/dev double. It never performs network I/O and is
 * never selected by the production/default factory.
 */
export class MockAdapter implements UpstreamAdapter {
  readonly isTestDouble = true;

  private sequence = 0;
  private readonly jobs = new Map<string, StoredMockJob>();
  private readonly idempotency = new Map<
    string,
    { fingerprint: string; job_id: string }
  >();
  private readonly cancellationIdempotency = new Map<
    string,
    { job_id: string }
  >();
  private failBeforeCommitOnce: boolean;
  private unknownAfterCommitOnce: boolean;
  private cancelUnknownAfterCommitOnce: boolean;
  private readonly artifactDownloadUrl: string | null;
  private readonly resultSummary: string;

  constructor(options: MockAdapterOptions = {}) {
    this.failBeforeCommitOnce = options.failBeforeCommitOnce ?? false;
    this.unknownAfterCommitOnce = options.unknownAfterCommitOnce ?? false;
    this.cancelUnknownAfterCommitOnce =
      options.cancelUnknownAfterCommitOnce ?? false;
    this.artifactDownloadUrl = options.artifactDownloadUrl ?? null;
    this.resultSummary =
      options.resultSummary ??
      "Mock generation completed without contacting an external service.";
  }

  async getBalance(_principal: Readonly<GenerationPrincipalRef>): Promise<Balance> {
    return {
      unit: "tokens",
      available: 1000,
      as_of: new Date().toISOString()
    };
  }

  async estimateGeneration(
    _principal: Readonly<GenerationPrincipalRef>,
    request: GenerationRequest
  ): Promise<UpstreamGenerationEstimate> {
    const requestHash = hashGenerationRequest(request);
    return {
      estimate_id: `estimate_mock_${requestHash.slice(-16)}`,
      request_hash: requestHash,
      model_id: request.model_id,
      operation_id: request.operation_id,
      catalog_version: request.catalog_version,
      normalized_parameters: request.parameters,
      parameters_valid: true,
      cost: {
        unit: "tokens",
        exact: MOCK_GENERATION_COST_TOKENS,
        minimum: MOCK_GENERATION_COST_TOKENS,
        maximum: MOCK_GENERATION_COST_TOKENS
      },
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      notes: ["Mock estimate for protocol tests; not an upstream price."]
    };
  }

  async startGeneration(
    context: StartGenerationContext,
    request: GenerationRequest
  ): Promise<GenerationJob> {
    const idempotencyId = scopedKey(context.principal, context.idempotency_key);
    const fingerprint = hashGenerationRequest(request);
    const existing = this.idempotency.get(idempotencyId);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new ApplicationError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key is already associated with different generation parameters."
        );
      }
      return this.requireStoredJob(context.principal, existing.job_id).job;
    }

    if (
      !Number.isFinite(context.approved_max_cost_tokens) ||
      context.approved_max_cost_tokens < MOCK_GENERATION_COST_TOKENS
    ) {
      throw new ApplicationError(
        "COST_CAP_EXCEEDED",
        "Mock generation cost exceeds the approved hard cap; no job was committed."
      );
    }

    if (this.failBeforeCommitOnce) {
      this.failBeforeCommitOnce = false;
      throw new ApplicationError(
        "UPSTREAM_START_FAILED",
        "Mock start failed before any job or idempotency record was committed."
      );
    }

    this.sequence += 1;
    const suffix = String(this.sequence).padStart(8, "0");
    const jobId = `job_mock_${suffix}`;
    const now = new Date().toISOString();
    const job: GenerationJob = {
      id: jobId,
      model_id: request.model_id,
      operation_id: request.operation_id,
      catalog_version: request.catalog_version,
      status: "queued",
      created_at: now,
      updated_at: now
    };
    const modality = inferOutputModality(request.model_id);
    const result: GenerationResult = {
      id: `result_mock_${suffix}`,
      job_id: jobId,
      model_id: request.model_id,
      operation_id: request.operation_id,
      catalog_version: request.catalog_version,
      completed_at: now,
      summary: this.resultSummary,
      artifacts: [
        {
          id: `artifact_mock_${suffix}`,
          kind: modality,
          mime_type: mimeTypeFor(modality),
          size_bytes: null,
          download_url: this.artifactDownloadUrl
        }
      ]
    };

    this.jobs.set(scopedKey(context.principal, jobId), {
      principal: snapshotGenerationPrincipal(context.principal),
      job,
      result
    });
    this.idempotency.set(idempotencyId, { fingerprint, job_id: jobId });
    if (this.unknownAfterCommitOnce) {
      this.unknownAfterCommitOnce = false;
      throw new ApplicationError(
        "UPSTREAM_OUTCOME_UNKNOWN",
        "Mock job was committed but the start response was lost; reconcile by idempotency key."
      );
    }
    return job;
  }

  async reconcileStart(
    context: ReconcileStartContext
  ): Promise<GenerationJob | null> {
    const idempotencyId = scopedKey(context.principal, context.idempotency_key);
    const existing = this.idempotency.get(idempotencyId);
    if (!existing) return null;
    if (existing.fingerprint !== context.request_hash) {
      throw new ApplicationError(
        "IDEMPOTENCY_CONFLICT",
        "The idempotency key is associated with a different committed request."
      );
    }
    return this.requireStoredJob(context.principal, existing.job_id).job;
  }

  async getJob(context: JobContext): Promise<GenerationJob> {
    const stored = this.requireStoredJob(context.principal, context.job_id);
    if (stored.job.status === "queued") {
      stored.job = updateStatus(stored.job, "running");
    } else if (stored.job.status === "running") {
      stored.job = updateStatus(stored.job, "succeeded");
      stored.result = {
        ...stored.result,
        completed_at: stored.job.updated_at
      };
    }
    return stored.job;
  }

  async cancelJob(context: CancelJobContext): Promise<GenerationJob> {
    const idempotencyId = scopedKey(context.principal, context.idempotency_key);
    const existing = this.cancellationIdempotency.get(idempotencyId);
    if (existing) {
      if (existing.job_id !== context.job_id) {
        throw new ApplicationError(
          "IDEMPOTENCY_CONFLICT",
          "The cancellation idempotency key is associated with a different job."
        );
      }
      return this.requireStoredJob(context.principal, existing.job_id).job;
    }

    const stored = this.requireStoredJob(context.principal, context.job_id);
    if (
      stored.job.status !== "canceled" &&
      stored.job.status !== "queued" &&
      stored.job.status !== "running"
    ) {
      throw new ApplicationError(
        "JOB_NOT_CANCELABLE",
        `Job ${context.job_id} cannot be canceled from status ${stored.job.status}.`
      );
    }
    if (stored.job.status !== "canceled") {
      stored.job = updateStatus(stored.job, "canceled");
    }
    this.cancellationIdempotency.set(idempotencyId, {
      job_id: context.job_id
    });
    if (this.cancelUnknownAfterCommitOnce) {
      this.cancelUnknownAfterCommitOnce = false;
      throw new ApplicationError(
        "UPSTREAM_OUTCOME_UNKNOWN",
        "Mock cancellation was committed but the response was lost; reconcile by idempotency key."
      );
    }
    return stored.job;
  }

  async reconcileCancel(
    context: ReconcileCancelContext
  ): Promise<GenerationJob | null> {
    const idempotencyId = scopedKey(context.principal, context.idempotency_key);
    const existing = this.cancellationIdempotency.get(idempotencyId);
    if (!existing) return null;
    if (existing.job_id !== context.job_id) {
      throw new ApplicationError(
        "IDEMPOTENCY_CONFLICT",
        "The cancellation idempotency key is associated with a different job."
      );
    }
    return this.requireStoredJob(context.principal, existing.job_id).job;
  }

  async getResult(context: JobContext): Promise<GenerationResult> {
    const stored = this.requireStoredJob(context.principal, context.job_id);
    if (stored.job.status !== "succeeded") {
      throw new ApplicationError(
        "JOB_NOT_READY",
        `Job ${context.job_id} has status ${stored.job.status}; a result is available only after success.`
      );
    }
    return stored.result;
  }

  private requireStoredJob(
    principal: Readonly<GenerationPrincipalRef>,
    jobId: string
  ): StoredMockJob {
    const stored = this.jobs.get(scopedKey(principal, jobId));
    if (!stored) {
      throw new ApplicationError(
        "JOB_NOT_FOUND",
        `Job ${jobId} was not found for the current principal.`
      );
    }
    return stored;
  }
}

function scopedKey(
  principal: Readonly<GenerationPrincipalRef>,
  value: string
): string {
  return JSON.stringify([generationPrincipalKey(principal), value]);
}

function updateStatus(
  job: GenerationJob,
  status: GenerationJob["status"]
): GenerationJob {
  return { ...job, status, updated_at: new Date().toISOString() };
}

function inferOutputModality(modelId: string): Modality {
  if (modelId.includes("veo")) return "video";
  if (modelId.includes("suno")) return "audio";
  return "image";
}

function mimeTypeFor(modality: Modality): string {
  switch (modality) {
    case "video":
      return "video/mp4";
    case "audio":
      return "audio/mpeg";
    case "image":
      return "image/png";
    case "text":
      return "text/plain";
  }
}
