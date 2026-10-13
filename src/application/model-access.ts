import type {
  GetModelInfoRequest,
  SyntxCostParameter,
  SyntxHttpClient
} from "../adapter/syntx/http-client.js";
import { isSyntxModelInfoCallerParameterKey } from "../adapter/syntx/http-client.js";
import type { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";

export interface GetModelAccessRequest {
  model_id: string;
  cost_parameters?: Readonly<Record<string, SyntxCostParameter>> | undefined;
}

export interface ModelAccessResult {
  catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT";
  catalog_version: string;
  model_id: string;
  ai_name: string;
  model_type: string;
  account_read_live: true;
  parameter_keys: string[];
  parameters_redacted: true;
  access: boolean | null;
  cost: number | null;
  discount_cost: number | null;
  free_remaining_generations: number | null;
  limit: number | null;
  show_warning: boolean | null;
  observed_at: string;
}

export class ModelAccessError extends Error {
  constructor(
    readonly code: "MODEL_INACTIVE" | "INVALID_COST_PARAMETERS",
    message: string
  ) {
    super(message);
    this.name = "ModelAccessError";
  }
}

/**
 * Binds a public catalog record to the account-scoped read-only model-info API.
 * It never treats public settings as a runtime generation schema.
 */
export class ModelAccessService {
  readonly #catalog: DiscoveryCatalogRepository;
  readonly #client: SyntxHttpClient;
  readonly #now: () => number;

  constructor(
    catalog: DiscoveryCatalogRepository,
    client: SyntxHttpClient,
    now: () => number = Date.now
  ) {
    this.#catalog = catalog;
    this.#client = client;
    this.#now = now;
  }

  async getModelAccess(
    request: GetModelAccessRequest,
    signal?: AbortSignal
  ): Promise<ModelAccessResult> {
    const model = this.#catalog.getModel(request.model_id);
    if (!model.active) {
      throw new ModelAccessError(
        "MODEL_INACTIVE",
        "The selected public catalog model is inactive."
      );
    }

    const costParameters = request.cost_parameters ?? {};
    const parameterKeys = Object.keys(costParameters).sort();
    const allowed = new Set(
      (model.settings?.get_cost_params ?? []).filter(
        isSyntxModelInfoCallerParameterKey
      )
    );
    if (parameterKeys.some((key) => !allowed.has(key))) {
      throw new ModelAccessError(
        "INVALID_COST_PARAMETERS",
        "Cost parameters are not allowlisted by the selected catalog record."
      );
    }

    const upstreamRequest: GetModelInfoRequest = {
      ai_name: model.ai_name,
      model_type: model.upstream_id,
      cost_parameters: costParameters
    };
    const info = await this.#client.getModelInfo(upstreamRequest, signal);
    return {
      catalog_kind: this.#catalog.catalog_kind,
      catalog_version: `${this.#catalog.fetched_at}.${this.#catalog.source_hashes.models.slice(7, 19)}`,
      model_id: model.id,
      ai_name: model.ai_name,
      model_type: model.upstream_id,
      account_read_live: true,
      parameter_keys: parameterKeys,
      parameters_redacted: true,
      ...info,
      observed_at: new Date(this.#now()).toISOString()
    };
  }
}
