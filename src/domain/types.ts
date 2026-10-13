export const MODALITIES = ["text", "image", "video", "audio"] as const;

export type Modality = (typeof MODALITIES)[number];
export type CoverageStatus = "FULL" | "PARTIAL" | "OPEN" | "REMOVED";

export interface CatalogSource {
  url: string;
  kind: "public_documentation" | "official_contract" | "runtime_evidence";
  checked_at: string;
  coverage_status: CoverageStatus;
}

/** Evidence-preserving public-doc subset; never an authorized runtime schema. */
export interface PublicSampleParameterPropertySchema {
  type: "string";
  description: string;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  enum?: string[] | undefined;
}

/**
 * Deliberately narrow schema profile for the current public samples. Authorized
 * runtime schemas will require a separate typed profile for files, numbers,
 * booleans, arrays, defaults, and conditional constraints.
 */
export interface PublicSampleParametersSchema {
  $schema: "https://json-schema.org/draft/2020-12/schema";
  type: "object";
  additionalProperties: false;
  properties: Record<string, PublicSampleParameterPropertySchema>;
  required: string[];
}

export interface CatalogOperation {
  id: string;
  display_name: string;
  input_modalities: Modality[];
  output_modality: Modality;
  coverage_status: CoverageStatus;
  runtime_status: "UNVERIFIED";
  runtime_provenance_status: "UNKNOWN";
  cost_status: "UNKNOWN";
  plan_status: "UNKNOWN";
  parameters_schema_profile: "PUBLIC_SAMPLE_STRING_ONLY";
  schema_hash: string;
  parameters_schema: PublicSampleParametersSchema;
}

export interface CatalogModel {
  id: string;
  upstream_id: string | null;
  upstream_id_status: "UNKNOWN";
  display_name: string;
  family: string;
  modalities: Modality[];
  coverage_status: CoverageStatus;
  first_seen: string;
  last_seen: string;
  removed_at: string | null;
  source: CatalogSource;
  operations: CatalogOperation[];
}

export interface ModelCatalog {
  schema_version: string;
  catalog_version: string;
  catalog_kind: "PUBLIC_SAMPLE";
  runtime_usable: false;
  coverage_status: CoverageStatus;
  checked_at: string;
  models: CatalogModel[];
}

export interface GenerationRequest {
  model_id: string;
  operation_id: string;
  parameters: Record<string, unknown>;
  catalog_version: string;
}

export interface Balance {
  unit: "tokens";
  available: number;
  as_of: string;
}

export interface GenerationEstimate {
  estimate_id: string;
  request_hash: string;
  model_id: string;
  operation_id: string;
  catalog_version: string;
  /** Safe metadata only. Normalized values remain inside the approval binding. */
  parameter_keys: string[];
  parameters_redacted: true;
  parameters_valid: true;
  cost: {
    unit: "tokens";
    exact: number | null;
    minimum: number | null;
    maximum: number;
  };
  expires_at: string;
  notes: string[];
  approval: ApprovalReference;
}

export interface ApprovalReference {
  purpose: "start_generation";
  status: "unavailable" | "test_only" | "available";
  reference: string;
  approval_url: string | null;
  binding_hash: string;
  message: string;
}

/** Internal adapter/approval contract. Never serialize this type to an MCP client. */
export interface UpstreamGenerationEstimate {
  estimate_id: string;
  request_hash: string;
  model_id: string;
  operation_id: string;
  catalog_version: string;
  normalized_parameters: Record<string, unknown>;
  parameters_valid: true;
  cost: {
    unit: "tokens";
    exact: number | null;
    minimum: number | null;
    maximum: number;
  };
  expires_at: string;
  notes: string[];
}

export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled"
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface GenerationJob {
  id: string;
  model_id: string;
  operation_id: string;
  catalog_version: string;
  status: JobStatus;
  created_at: string;
  updated_at: string;
}

export interface GenerationArtifact {
  id: string;
  kind: Modality;
  mime_type: string;
  size_bytes: number | null;
  download_url: string | null;
}

export interface GenerationResult {
  id: string;
  job_id: string;
  model_id: string;
  operation_id: string;
  catalog_version: string;
  completed_at: string;
  summary: string;
  artifacts: GenerationArtifact[];
}
