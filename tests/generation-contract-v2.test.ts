import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createGenerationContractRegistryV2,
  parseGenerationContractRegistryV2,
  serializeGenerationContractRegistryV2,
  type GenerationContractV2Input,
  type GenerationContractRegistryV2Input
} from "../src/domain/generation-contract-v2.js";
import {
  GenerationContractValidationErrorV2,
  validateGenerationParametersV2
} from "../src/application/generation-contract-validator-v2.js";

const SOURCE_HASH = `sha256:${"a".repeat(64)}`;
const SETTINGS_HASH = `sha256:${"b".repeat(64)}`;

function contract(overrides: Partial<GenerationContractV2Input> = {}): GenerationContractV2Input {
  return {
    variant_id: "default",
    model_id: "image-model-a",
    operation_id: "generate-image",
    modality: "image",
    route: "design",
    ai_name: "provider-a",
    model_type: "image-model-a",
    status: "static_partial",
    provenance: {
      settings_source_sha256: SETTINGS_HASH,
      references: [
        { kind: "public_catalog", reference: "v2-test-model", sha256: SOURCE_HASH },
        { kind: "frontend_static", reference: "v2-test-form", sha256: SETTINGS_HASH }
      ]
    },
    parameters: {
      type: "object",
      additional_properties: false,
      required: ["prompt"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: 100 }
      },
      conditions: [],
      conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image",
      input_kind: "prompt",
      prompt_field: "prompt",
      settings_fields: {},
      fixed_settings: {},
      media_reference_fields: {}
    },
    output: { decoder_profile: "image-v2-test", mime_types: ["image/jpeg"] },
    limits: { max_parameters: 16, max_value_depth: 4, max_serialized_bytes: 4096, max_normalized_nodes: 20_000 },
    ...overrides
  };
}

function registryInput(contracts: GenerationContractV2Input[] = [contract()]): GenerationContractRegistryV2Input {
  return {
    schema_version: "2.0.0",
    catalog_version: "2026-10-09T00:00:00.000Z.aaaaaaaaaaaa",
    source_hashes: { ai: SOURCE_HASH, llm_models: SOURCE_HASH, models: SOURCE_HASH },
    contracts
  };
}

function validate(input: unknown, contractInput: GenerationContractV2Input = contract()) {
  const registry = createGenerationContractRegistryV2(registryInput([contractInput]));
  return validateGenerationParametersV2(registry.contracts[0]!, input);
}

test("schema v2 preserves separate same-model operation variants in a content-addressed registry", () => {
  const first = contract({ variant_id: "1k-square", wire: {
    dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
    settings_fields: { quality: "quality" }, fixed_settings: { image_size: "1K" }, media_reference_fields: {}
  }, parameters: {
    type: "object", additional_properties: false, required: ["prompt"],
    properties: { prompt: { type: "string", min_length: 1, max_length: 100 }, quality: { type: "string", enum: ["1K"] } },
    conditions: [], conditional_enums: []
  } });
  const second = contract({ variant_id: "2k-wide", wire: {
    dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
    settings_fields: { quality: "quality" }, fixed_settings: { image_size: "2K", aspect_ratio: "16:9" }, media_reference_fields: {}
  }, parameters: {
    type: "object", additional_properties: false, required: ["prompt"],
    properties: { prompt: { type: "string", min_length: 1, max_length: 100 }, quality: { type: "string", enum: ["2K"] } },
    conditions: [], conditional_enums: []
  } });
  const registry = createGenerationContractRegistryV2(registryInput([first, second]));
  assert.equal(registry.schema_version, "2.0.0");
  assert.deepEqual(registry.contracts.map((item: { variant_id: string }) => item.variant_id), ["1k-square", "2k-wide"]);
  assert.match(registry.registry_sha256, /^sha256:[a-f0-9]{64}$/u);

  const serialized = serializeGenerationContractRegistryV2(registry);
  const expectedSha = `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`;
  assert.deepEqual(parseGenerationContractRegistryV2(serialized, expectedSha), registry);
  assert.throws(() => createGenerationContractRegistryV2(registryInput([first, { ...second, variant_id: first.variant_id }])));
  assert.throws(() => parseGenerationContractRegistryV2(serialized, `sha256:${"0".repeat(64)}`));
});

test("nullable values distinguish explicit null from omission and support a null default", () => {
  const spec = contract({
    parameters: {
      type: "object",
      additional_properties: false,
      required: ["prompt"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: 100 },
        aspect_ratio: { type: "string", nullable: true, enum: [null, "1:1"] },
        strict_choice: { type: "string", nullable: true, enum: ["square"] },
        auto_mode: { type: "boolean", nullable: true, default: null }
      },
      conditions: [],
      conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { aspect_ratio: "aspect_ratio", strict_choice: "strict_choice", auto_mode: "auto_mode" }, fixed_settings: {}, media_reference_fields: {}
    }
  });
  assert.deepEqual(validate({ prompt: "hello", aspect_ratio: null }, spec), {
    prompt: "hello", aspect_ratio: null, auto_mode: null
  });
  assert.deepEqual(validate({ prompt: "hello" }, spec), { prompt: "hello", auto_mode: null });
  assert.throws(() => validate({ prompt: "hello", aspect_ratio: "9:16" }, spec), GenerationContractValidationErrorV2);
  assert.throws(() => validate({ prompt: "hello", strict_choice: null }, spec), GenerationContractValidationErrorV2);
  assert.throws(() => validate({ prompt: "hello", auto_mode: "false", aspect_ratio: null }, spec), GenerationContractValidationErrorV2);
});

test("recursive nested motion arrays normalize defaults and enforce child schemas and numeric steps", () => {
  const spec = contract({
    parameters: {
      type: "object",
      additional_properties: false,
      required: ["prompt", "motions"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: 100 },
        motions: {
          type: "array",
          min_items: 1,
          max_items: 3,
          items: {
            type: "object",
            additional_properties: false,
            required: ["strength"],
            properties: {
              strength: { type: "number", minimum: 0, maximum: 1, step: 0.01 },
              enabled: { type: "boolean", default: false }
            }
          }
        }
      },
      conditions: [],
      conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { motions: "motions" }, fixed_settings: {}, media_reference_fields: {}
    }
  });
  assert.deepEqual(validate({ prompt: "hello", motions: [{ strength: 0.51 }] }, spec), {
    prompt: "hello", motions: [{ strength: 0.51, enabled: false }]
  });
  assert.throws(() => validate({ prompt: "hello", motions: [{ strength: 0.515 }] }, spec), GenerationContractValidationErrorV2);
  assert.throws(() => validate({ prompt: "hello", motions: [{ strength: 0.5, internal_url: "https://example.invalid/x" }] }, spec), GenerationContractValidationErrorV2);
});

test("conditional enum branches select a bounded value set from the discriminator", () => {
  const spec = contract({
    operation_id: "generate-video",
    parameters: {
      type: "object", additional_properties: false, required: ["prompt", "mode", "resolution"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: 100 },
        mode: { type: "string", enum: ["mini", "pro"] },
        resolution: { type: "string" }
      },
      conditions: [],
      conditional_enums: [{
        field: "resolution",
        cases: [
          { when: { field: "mode", equals: "mini" }, allowed_values: ["720p"] },
          { when: { field: "mode", equals: "pro" }, allowed_values: ["1080p", "2K"] }
        ]
      }]
    },
    wire: {
      dispatch_action: "generate-video", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { mode: "mode", resolution: "resolution" }, fixed_settings: {}, media_reference_fields: {}
    },
    modality: "video",
    route: "video",
    output: { decoder_profile: "video-v2-test", mime_types: ["video/mp4"] }
  });
  assert.deepEqual(validate({ prompt: "hello", mode: "mini", resolution: "720p" }, spec), {
    prompt: "hello", mode: "mini", resolution: "720p"
  });
  assert.throws(() => validate({ prompt: "hello", mode: "mini", resolution: "1080p" }, spec), GenerationContractValidationErrorV2);
});

test("media-only upscale schemas accept opaque upload ids but never URLs and cannot claim execution", () => {
  const spec = contract({
    variant_id: "source-only",
    operation_id: "upscale-image",
    status: "static_partial",
    parameters: {
      type: "object", additional_properties: false, required: ["source"],
      properties: {
        source: { type: "media_reference", modality: "image", source: "uploaded_file_id" }
      },
      conditions: [],
      conditional_enums: []
    },
    wire: {
      dispatch_action: "upscale-image",
      input_kind: "media_only",
      prompt_field: null,
      settings_fields: {},
      fixed_settings: {},
      media_reference_fields: { source: "image" }
    }
  });
  assert.deepEqual(validate({ source: "upload_opaque_123" }, spec), { source: "upload_opaque_123" });
  assert.throws(() => validate({ source: "https://r2.syntx.ai/file.png" }, spec), GenerationContractValidationErrorV2);
  assert.throws(() => createGenerationContractRegistryV2(registryInput([{
    ...spec,
    status: "live_verified",
    provenance: {
      settings_source_sha256: SETTINGS_HASH,
      references: [
        { kind: "public_catalog", reference: "v2-test-model", sha256: SOURCE_HASH },
        { kind: "frontend_static", reference: "v2-test-form", sha256: SETTINGS_HASH },
        { kind: "manual_review", reference: "test-reviewed-action" },
        { kind: "live_owner", reference: "but no route is implemented", sha256: SETTINGS_HASH }
      ],
      reviewed_at: "2026-10-09T00:00:00.000Z",
      live_observed_at: "2026-10-09T00:00:00.000Z"
    }
  }])));
});

test("schema parsing and parameter validation reject accessors, proxies, cycles, and unbounded shapes", () => {
  const spec = contract();
  let getterCalls = 0;
  const accessorInput = Object.defineProperty({}, "prompt", {
    enumerable: true,
    get() { getterCalls += 1; return "secret"; }
  });
  assert.throws(() => validate(accessorInput, spec), GenerationContractValidationErrorV2);
  assert.equal(getterCalls, 0);
  assert.throws(() => validate(new Proxy({ prompt: "hello" }, {}), spec), GenerationContractValidationErrorV2);

  const cyclic = { prompt: "hello" } as Record<string, unknown>;
  cyclic.self = cyclic;
  assert.throws(() => validate(cyclic, spec), GenerationContractValidationErrorV2);

  const cyclicSchema = contract() as GenerationContractV2Input & { self?: unknown };
  cyclicSchema.self = cyclicSchema;
  assert.throws(() => createGenerationContractRegistryV2(registryInput([cyclicSchema])));
});

test("post-default parameter count and serialized-byte limits are enforced", () => {
  const manyDefaults = contract({
    parameters: {
      type: "object", additional_properties: false, required: ["prompt"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: 100 },
        mode: { type: "string", default: "automatic" }
      },
      conditions: [], conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { mode: "mode" }, fixed_settings: {}, media_reference_fields: {}
    },
    limits: { max_parameters: 1, max_value_depth: 4, max_serialized_bytes: 4096, max_normalized_nodes: 20_000 }
  });
  assert.throws(() => validate({ prompt: "x" }, manyDefaults), (error: unknown) =>
    error instanceof GenerationContractValidationErrorV2 && error.code === "INPUT_LIMIT_EXCEEDED");

  const largeDefault = contract({
    parameters: {
      type: "object", additional_properties: false, required: ["prompt"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: 100 },
        caption: { type: "string", max_length: 120, default: "x".repeat(120) }
      },
      conditions: [], conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { caption: "caption" }, fixed_settings: {}, media_reference_fields: {}
    },
    limits: { max_parameters: 16, max_value_depth: 4, max_serialized_bytes: 128, max_normalized_nodes: 20_000 }
  });
  assert.throws(() => validate({ prompt: "x" }, largeDefault), (error: unknown) =>
    error instanceof GenerationContractValidationErrorV2 && error.code === "INPUT_LIMIT_EXCEEDED");
});

test("schema node depth and condition values must fit their declared field schemas", () => {
  const tooDeep = contract({
    limits: { max_parameters: 16, max_value_depth: 1, max_serialized_bytes: 4096, max_normalized_nodes: 20_000 },
    parameters: {
      type: "object", additional_properties: false, required: ["prompt", "nested"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: 100 },
        nested: { type: "array", items: { type: "object", additional_properties: false, required: [], properties: {} } }
      },
      conditions: [], conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { nested: "nested" }, fixed_settings: {}, media_reference_fields: {}
    }
  });
  assert.throws(() => createGenerationContractRegistryV2(registryInput([tooDeep])));

  const impossibleCondition = contract({
    parameters: {
      type: "object", additional_properties: false, required: ["prompt", "mode"],
      properties: { prompt: { type: "string", min_length: 1, max_length: 100 }, mode: { type: "string", enum: ["fast"] } },
      conditions: [{ when: { field: "mode", equals: "turbo" }, require: ["prompt"] }],
      conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { mode: "mode" }, fixed_settings: {}, media_reference_fields: {}
    }
  });
  assert.throws(() => createGenerationContractRegistryV2(registryInput([impossibleCondition])));
});

test("nullable enum defaults must explicitly contain null at every recursive level", () => {
  const invalidArrayDefault = contract({
    parameters: {
      type: "object", additional_properties: false, required: ["prompt", "items"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: 100 },
        items: { type: "array", default: [null], items: { type: "string", nullable: true, enum: ["ok"] } }
      },
      conditions: [], conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { items: "items" }, fixed_settings: {}, media_reference_fields: {}
    }
  });
  assert.throws(() => createGenerationContractRegistryV2(registryInput([invalidArrayDefault])));

  const invalidObjectDefault = contract({
    parameters: {
      type: "object", additional_properties: false, required: ["prompt", "config"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: 100 },
        config: {
          type: "object", additional_properties: false, required: ["quality"],
          properties: { quality: { type: "string", nullable: true, enum: ["high"], default: null } },
          default: {}
        }
      },
      conditions: [], conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { config: "config" }, fixed_settings: {}, media_reference_fields: {}
    }
  });
  assert.throws(() => createGenerationContractRegistryV2(registryInput([invalidObjectDefault])));
});

test("normalization stops at an explicit node budget before expanding recursive defaults", () => {
  const leaf = { type: "object" as const, additional_properties: false as const, required: [] as string[], properties: {} };
  const levelTwo = { type: "array" as const, max_items: 256, default: Array.from({ length: 256 }, () => ({})), items: leaf };
  const levelOne = {
    type: "array" as const, max_items: 256,
    default: Array.from({ length: 256 }, () => ({})),
    items: {
      type: "object" as const, additional_properties: false as const, required: ["children"],
      properties: { children: levelTwo }
    }
  };
  const spec = contract({
    parameters: {
      type: "object", additional_properties: false, required: ["prompt", "tree"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: 100 },
        tree: {
          type: "array", max_items: 256, default: [{}],
          items: {
            type: "object", additional_properties: false, required: ["children"],
            properties: { children: levelOne }
          }
        }
      },
      conditions: [], conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image", input_kind: "prompt", prompt_field: "prompt",
      settings_fields: { tree: "tree" }, fixed_settings: {}, media_reference_fields: {}
    },
    limits: { max_parameters: 16, max_value_depth: 8, max_serialized_bytes: 4096, max_normalized_nodes: 32 }
  });
  assert.throws(() => validate({ prompt: "x" }, spec), (error: unknown) =>
    error instanceof GenerationContractValidationErrorV2 && error.code === "INPUT_LIMIT_EXCEEDED");
});

test("output MIME types must match the contract modality", () => {
  assert.throws(() => createGenerationContractRegistryV2(registryInput([contract({
    output: { decoder_profile: "wrong-modality", mime_types: ["video/mp4"] }
  })])));
});

test("media-reference contracts cannot claim reviewed or live executable status without a resolver", () => {
  const mediaContract = contract({
    status: "live_verified",
    parameters: {
      type: "object", additional_properties: false, required: ["prompt", "reference"],
      properties: {
        prompt: { type: "string", min_length: 1, max_length: 100 },
        reference: { type: "media_reference", modality: "image", source: "uploaded_file_id" }
      },
      conditions: [], conditional_enums: []
    },
    wire: {
      dispatch_action: "generate-image", input_kind: "prompt_and_media", prompt_field: "prompt",
      settings_fields: {}, fixed_settings: {}, media_reference_fields: { reference: "image" }
    },
    provenance: {
      settings_source_sha256: SETTINGS_HASH,
      references: [
        { kind: "public_catalog", reference: "v2-test-model", sha256: SOURCE_HASH },
        { kind: "official_contract", reference: "observed-generation-tuple", sha256: SETTINGS_HASH },
        { kind: "manual_review", reference: "approved-test" },
        { kind: "live_owner", reference: "generation-observation", sha256: SETTINGS_HASH }
      ],
      reviewed_at: "2026-10-09T00:00:00.000Z",
      live_observed_at: "2026-10-09T00:00:00.000Z"
    }
  });
  assert.throws(() => createGenerationContractRegistryV2(registryInput([mediaContract])));
});
