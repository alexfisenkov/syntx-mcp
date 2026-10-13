import { createHash } from "node:crypto";
import { canonicalJson } from "../application/generation-request.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import {
  generationPrincipalKey,
  sameGenerationPrincipal,
  snapshotGenerationPrincipal
} from "../domain/generation-principal.js";
import type {
  ApprovalReference,
  GenerationEstimate,
  UpstreamGenerationEstimate
} from "../domain/types.js";
import { ApplicationError } from "../errors.js";

export interface ConsumeGenerationConfirmationInput {
  principal: Readonly<GenerationPrincipalRef>;
  confirmation_id: string;
  request_hash: string;
}

export interface ConsumeCancellationConfirmationInput {
  principal: Readonly<GenerationPrincipalRef>;
  confirmation_id: string;
  job_id: string;
}

export interface ConsumedGenerationConfirmation {
  purpose: "start_generation";
  confirmation_id: string;
  estimate_id: string;
  request_hash: string;
  approved_max_cost_tokens: number;
  expires_at: string;
  consumed_at: string;
}

export interface ConsumedCancellationConfirmation {
  purpose: "cancel_job";
  confirmation_id: string;
  job_id: string;
  expires_at: string;
  consumed_at: string;
}

/**
 * Authenticated approvals are created outside MCP. No MCP method in this
 * project can mint or seed either generation or cancellation confirmations.
 */
export interface ConfirmationStore {
  describeGenerationApproval(
    principal: Readonly<GenerationPrincipalRef>,
    estimate: UpstreamGenerationEstimate
  ): ApprovalReference;
  consumeGeneration(
    input: ConsumeGenerationConfirmationInput
  ): Promise<ConsumedGenerationConfirmation>;
  consumeCancellation(
    input: ConsumeCancellationConfirmationInput
  ): Promise<ConsumedCancellationConfirmation>;
}

/** Production-safe default until a real authenticated approval service exists. */
export class DenyAllConfirmationStore implements ConfirmationStore {
  describeGenerationApproval(
    principal: Readonly<GenerationPrincipalRef>,
    estimate: UpstreamGenerationEstimate
  ): ApprovalReference {
    const bindingHash = generationBindingHash(principal, estimate);
    return {
      purpose: "start_generation",
      status: "unavailable",
      reference: `urn:syntx-mcp:approval-unavailable:${bindingHash.slice(7)}`,
      approval_url: null,
      binding_hash: bindingHash,
      message:
        "No authenticated approval service is configured; MCP cannot create a confirmation."
    };
  }

  consumeGeneration(
    _input: ConsumeGenerationConfirmationInput
  ): Promise<ConsumedGenerationConfirmation> {
    return Promise.reject(noApprovalStoreError());
  }

  consumeCancellation(
    _input: ConsumeCancellationConfirmationInput
  ): Promise<ConsumedCancellationConfirmation> {
    return Promise.reject(noApprovalStoreError());
  }
}

interface StoredTestGenerationConfirmation {
  purpose: "start_generation";
  principal: Readonly<GenerationPrincipalRef>;
  confirmation_id: string;
  estimate_id: string;
  request_hash: string;
  approved_max_cost_tokens: number;
  expires_at: string;
  consumed_at: string | null;
}

interface StoredTestCancellationConfirmation {
  purpose: "cancel_job";
  principal: Readonly<GenerationPrincipalRef>;
  confirmation_id: string;
  job_id: string;
  expires_at: string;
  consumed_at: string | null;
}

type StoredTestConfirmation =
  | StoredTestGenerationConfirmation
  | StoredTestCancellationConfirmation;

/**
 * Test/dev-only in-memory approval store. Tests must seed it explicitly; the
 * default application factory never constructs this class.
 */
export class InMemoryTestConfirmationStore implements ConfirmationStore {
  private readonly confirmations = new Map<string, StoredTestConfirmation>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  describeGenerationApproval(
    principal: Readonly<GenerationPrincipalRef>,
    estimate: UpstreamGenerationEstimate
  ): ApprovalReference {
    const bindingHash = generationBindingHash(principal, estimate);
    return {
      purpose: "start_generation",
      status: "test_only",
      reference: `urn:syntx-mcp:test-approval:${bindingHash.slice(7)}`,
      approval_url: null,
      binding_hash: bindingHash,
      message:
        "Test-only approval reference; a test harness must seed confirmation evidence out of band."
    };
  }

  seedFromEstimate(input: {
    principal: Readonly<GenerationPrincipalRef>;
    confirmation_id: string;
    estimate: GenerationEstimate;
  }): void {
    const maximum = input.estimate.cost.maximum;
    if (!Number.isFinite(maximum) || maximum < 0) {
      throw new Error("A finite maximum token cost is required for approval.");
    }
    const principal = snapshotGenerationPrincipal(input.principal);
    this.confirmations.set(confirmationKey(principal, input.confirmation_id), {
      purpose: "start_generation",
      principal,
      confirmation_id: input.confirmation_id,
      estimate_id: input.estimate.estimate_id,
      request_hash: input.estimate.request_hash,
      approved_max_cost_tokens: maximum,
      expires_at: input.estimate.expires_at,
      consumed_at: null
    });
  }

  seedCancellation(input: {
    principal: Readonly<GenerationPrincipalRef>;
    confirmation_id: string;
    job_id: string;
    expires_at: string;
  }): void {
    const principal = snapshotGenerationPrincipal(input.principal);
    this.confirmations.set(confirmationKey(principal, input.confirmation_id), {
      purpose: "cancel_job",
      principal,
      confirmation_id: input.confirmation_id,
      job_id: input.job_id,
      expires_at: input.expires_at,
      consumed_at: null
    });
  }

  async consumeGeneration(
    input: ConsumeGenerationConfirmationInput
  ): Promise<ConsumedGenerationConfirmation> {
    const stored = this.requireConfirmation(
      input.confirmation_id,
      input.principal,
      "start_generation"
    );
    if (stored.request_hash !== input.request_hash) {
      throw new ApplicationError(
        "CONFIRMATION_MISMATCH",
        "The generation confirmation does not match the requested model and parameters."
      );
    }
    const consumedAt = this.consumeOnce(stored);
    return {
      purpose: "start_generation",
      confirmation_id: stored.confirmation_id,
      estimate_id: stored.estimate_id,
      request_hash: stored.request_hash,
      approved_max_cost_tokens: stored.approved_max_cost_tokens,
      expires_at: stored.expires_at,
      consumed_at: consumedAt
    };
  }

  async consumeCancellation(
    input: ConsumeCancellationConfirmationInput
  ): Promise<ConsumedCancellationConfirmation> {
    const stored = this.requireConfirmation(
      input.confirmation_id,
      input.principal,
      "cancel_job"
    );
    if (stored.job_id !== input.job_id) {
      throw new ApplicationError(
        "CONFIRMATION_MISMATCH",
        "The cancellation confirmation does not match the requested job."
      );
    }
    const consumedAt = this.consumeOnce(stored);
    return {
      purpose: "cancel_job",
      confirmation_id: stored.confirmation_id,
      job_id: stored.job_id,
      expires_at: stored.expires_at,
      consumed_at: consumedAt
    };
  }

  private requireConfirmation<Purpose extends StoredTestConfirmation["purpose"]>(
    confirmationId: string,
    principal: Readonly<GenerationPrincipalRef>,
    purpose: Purpose
  ): Extract<StoredTestConfirmation, { purpose: Purpose }> {
    const snapshot = snapshotGenerationPrincipal(principal);
    const stored = this.confirmations.get(confirmationKey(snapshot, confirmationId));
    if (!stored || !sameGenerationPrincipal(stored.principal, snapshot)) {
      throw new ApplicationError(
        "CONFIRMATION_REQUIRED",
        "A valid authenticated confirmation is required."
      );
    }
    if (stored.purpose !== purpose) {
      throw new ApplicationError(
        "CONFIRMATION_MISMATCH",
        `The confirmation purpose is ${stored.purpose}, not ${purpose}.`
      );
    }
    return stored as Extract<StoredTestConfirmation, { purpose: Purpose }>;
  }

  private consumeOnce(stored: StoredTestConfirmation): string {
    if (stored.consumed_at !== null) {
      throw new ApplicationError(
        "CONFIRMATION_ALREADY_USED",
        "The confirmation has already been consumed."
      );
    }
    const expiresAt = Date.parse(stored.expires_at);
    const now = this.now().getTime();
    if (
      !Number.isFinite(expiresAt) ||
      !Number.isFinite(now) ||
      expiresAt <= now
    ) {
      throw new ApplicationError(
        "CONFIRMATION_EXPIRED",
        "The confirmation has expired; obtain fresh approval evidence."
      );
    }
    const consumedAt = new Date(now).toISOString();
    stored.consumed_at = consumedAt;
    return consumedAt;
  }
}

function generationBindingHash(
  principal: Readonly<GenerationPrincipalRef>,
  estimate: UpstreamGenerationEstimate
): string {
  return `sha256:${createHash("sha256")
    .update(
      canonicalJson({
        purpose: "start_generation",
        principal: snapshotGenerationPrincipal(principal),
        estimate_id: estimate.estimate_id,
        request_hash: estimate.request_hash,
        normalized_parameters: estimate.normalized_parameters,
        max_cost_tokens: estimate.cost.maximum,
        expires_at: estimate.expires_at
      })
    )
    .digest("hex")}`;
}

function confirmationKey(
  principal: Readonly<GenerationPrincipalRef>,
  confirmationId: string
): string {
  return JSON.stringify([generationPrincipalKey(principal), confirmationId]);
}

function noApprovalStoreError(): ApplicationError {
  return new ApplicationError(
    "CONFIRMATION_REQUIRED",
    "No authenticated, out-of-band approval store is configured."
  );
}
