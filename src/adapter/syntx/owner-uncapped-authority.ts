import { ApplicationError } from "../../errors.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import type { GenerationRequest } from "../../domain/types.js";
import {
  generationContractRegistryV2Schema,
  type GenerationContractRegistryV2
} from "../../domain/generation-contract-v2.js";
import type { DiscoveryCatalogRepository } from "../../catalog/discovery-catalog.js";
import { GenerationContractExecutorV2 } from "./generation-contract-executor-v2.js";
import type { PreparedSyntxMediaRequest } from "./upstream-adapter.js";

declare const ownerUncappedBrand: unique symbol;

/** Opaque in-process authority; the brand is not serializable or MCP-mintable. */
export interface OwnerUncappedGenerationAuthority {
  readonly [ownerUncappedBrand]: true;
}

export interface OwnerUncappedAuthoritySelection {
  readonly model_id: string;
  readonly operation_id: string;
  readonly variant_id: string;
}

export interface CreateOwnerUncappedGenerationAuthorityInput {
  readonly principal: GenerationPrincipalRef;
  readonly registry: GenerationContractRegistryV2;
  readonly selectedCatalog: DiscoveryCatalogRepository;
  readonly model_id: string;
  readonly operation_id: string;
  readonly variant_id: string;
}

export interface OwnerUncappedGenerationBinding extends OwnerUncappedAuthoritySelection {
  readonly catalog_version: string;
  readonly registry_sha256: string;
  readonly schema_hash: string;
}

interface AuthorityRecord {
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly binding: Readonly<OwnerUncappedGenerationBinding>;
  readonly executor: GenerationContractExecutorV2;
}

const authorityRecords = new WeakMap<object, AuthorityRecord>();

/** Internal owner composition helper. Only an exact live-verified V2 tuple can mint authority. */
export function createOwnerUncappedGenerationAuthority(
  input: CreateOwnerUncappedGenerationAuthorityInput
): OwnerUncappedGenerationAuthority {
  const principal = snapshotGenerationPrincipal(input.principal);
  const registry = generationContractRegistryV2Schema.parse(input.registry);
  const selectedCatalog = input.selectedCatalog;
  const catalogVersion = `${selectedCatalog.fetched_at}.${selectedCatalog.source_hashes.models.slice(7, 19)}`;
  if (registry.catalog_version !== catalogVersion ||
      registry.source_hashes.ai !== selectedCatalog.source_hashes.ai ||
      registry.source_hashes.llm_models !== selectedCatalog.source_hashes.llm_models ||
      registry.source_hashes.models !== selectedCatalog.source_hashes.models) {
    throw authorityUnavailable();
  }
  const executor = new GenerationContractExecutorV2(registry, selectedCatalog);
  const contract = executor.getContract(input.model_id, input.operation_id, input.variant_id);
  if (contract === null || contract.status !== "live_verified" ||
      contract.wire.dispatch_action !== contract.operation_id) {
    throw authorityUnavailable();
  }
  const binding = Object.freeze({
    model_id: contract.model_id,
    operation_id: contract.operation_id,
    variant_id: contract.variant_id,
    catalog_version: registry.catalog_version,
    registry_sha256: registry.registry_sha256,
    schema_hash: contract.schema_hash
  });
  const capability = Object.freeze(Object.create(null)) as OwnerUncappedGenerationAuthority;
  authorityRecords.set(capability, Object.freeze({ principal, binding, executor }));
  return capability;
}

/** Return the trusted binding only to the adapter's pre-replay identity gate. */
export function getOwnerUncappedGenerationBinding(
  authority: OwnerUncappedGenerationAuthority,
  principal: GenerationPrincipalRef
): Readonly<OwnerUncappedGenerationBinding> {
  const record = lookupAuthority(authority, principal);
  return record.binding;
}

/** Prepare with the authority's exact V2 executor and variant; never accepts a caller-supplied variant. */
export function prepareOwnerUncappedGenerationRequest(
  authority: OwnerUncappedGenerationAuthority,
  principal: GenerationPrincipalRef,
  request: GenerationRequest
): PreparedSyntxMediaRequest {
  const record = lookupAuthority(authority, principal);
  const binding = record.binding;
  if (request.model_id !== binding.model_id || request.operation_id !== binding.operation_id ||
      request.catalog_version !== binding.catalog_version) {
    throw invalidBoundRequest();
  }
  try {
    const prepared = record.executor.prepare({
      model_id: request.model_id,
      operation_id: request.operation_id,
      catalog_version: request.catalog_version,
      variant_id: binding.variant_id,
      parameters: request.parameters
    });
    if (prepared.schema_hash !== binding.schema_hash ||
        prepared.contract_metadata.variant_id !== binding.variant_id) {
      throw invalidBoundRequest();
    }
    return Object.freeze({
      prompt: prepared.prompt,
      settings: prepared.settings,
      ai_name: prepared.ai_name,
      modality: prepared.modality,
      schema_hash: prepared.schema_hash
    });
  } catch {
    throw invalidBoundRequest();
  }
}

function lookupAuthority(
  authority: OwnerUncappedGenerationAuthority,
  principal: GenerationPrincipalRef
): AuthorityRecord {
  let record: AuthorityRecord | undefined;
  try {
    record = authority !== null && typeof authority === "object"
      ? authorityRecords.get(authority)
      : undefined;
  } catch { record = undefined; }
  if (record === undefined || !sameGenerationPrincipal(record.principal, snapshotGenerationPrincipal(principal))) {
    throw invalidBoundRequest();
  }
  return record;
}

function authorityUnavailable(): ApplicationError {
  return new ApplicationError(
    "GENERATION_CONTRACT_UNAVAILABLE",
    "The selected live owner generation contract is unavailable for this catalog."
  );
}

function invalidBoundRequest(): ApplicationError {
  return new ApplicationError(
    "INVALID_PARAMETERS",
    "The owner authority does not authorize this principal or generation request."
  );
}
