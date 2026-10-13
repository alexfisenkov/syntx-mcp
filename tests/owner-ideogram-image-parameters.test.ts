import assert from "node:assert/strict";
import test from "node:test";

const sourceModulePath = "../src/application/owner-ideogram-image-parameters.js";
const api = await import(sourceModulePath).catch(() => ({})) as Record<string, unknown>;

const normalize = api.normalizeOwnerIdeogramImageParameters as ((input: unknown) => any) | undefined;
const profile = api.getOwnerIdeogramImageParameterProfile as (() => any) | undefined;
const isParameterError = (error: unknown): boolean => error instanceof Error && error.name === "OwnerIdeogramImageParametersError" &&
  (error as Error & { code?: string }).code === "INVALID_PARAMETERS";
const ParameterError = isParameterError;

const BASE_RATIOS = ["1:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "10:16", "16:10", "CUSTOM"] as const;
const EXPANDED_RATIOS = ["1:1", "1:3", "1:2", "3:1", "2:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "10:16", "16:10"] as const;
const RESOLUTIONS_69 = [
  "512x1536", "576x1408", "576x1472", "576x1536", "640x1344", "640x1408", "640x1472", "640x1536",
  "704x1152", "704x1216", "704x1280", "704x1344", "704x1408", "704x1472", "736x1312", "768x1088",
  "768x1216", "768x1280", "768x1344", "800x1280", "832x960", "832x1024", "832x1088", "832x1152",
  "832x1216", "832x1248", "864x1152", "896x960", "896x1024", "896x1088", "896x1120", "896x1152",
  "960x832", "960x896", "960x1024", "960x1088", "1024x832", "1024x896", "1024x960", "1024x1024",
  "1088x768", "1088x832", "1088x896", "1088x960", "1120x896", "1152x704", "1152x832", "1152x864",
  "1152x896", "1216x704", "1216x768", "1216x832", "1248x832", "1280x704", "1280x768", "1280x800",
  "1312x736", "1344x640", "1344x704", "1344x768", "1408x576", "1408x640", "1408x704", "1472x576",
  "1472x640", "1472x704", "1536x512", "1536x576", "1536x640"
] as const;

function request(
  model_id: "ideogram" | "ideogram_40" | "ideogram_45",
  mode: "generate" | "remix" | "reframe" | "replace_background" | "character_reference" | "transparent" | "precise_edit",
  reference_count: number,
  mask_present: boolean,
  prompt: string | null,
  parameters: Record<string, unknown>
) {
  return { model_id, mode, reference_count, mask_present, prompt, parameters };
}

const contexts = [
  request("ideogram", "generate", 0, false, "portrait", { rendering_speed: "TURBO", num_images: 1, seed: null, aspect_ratio: "1:1", resolution: "1024x1024", magic_prompt: "AUTO" }),
  request("ideogram", "remix", 1, false, "remix", { rendering_speed: "QUALITY", num_images: 2, aspect_ratio: "16:9", resolution: "1216x704", image_weight: 50 }),
  request("ideogram", "reframe", 1, false, null, { rendering_speed: "DEFAULT", num_images: 1, resolution: "1536x640", style_type: "AUTO", style_preset: "cinematic" }),
  request("ideogram", "replace_background", 1, false, "replace background", { rendering_speed: "TURBO", num_images: 1, magic_prompt: "OFF", style_type: "GENERAL", style_preset: "clean" }),
  request("ideogram", "character_reference", 1, false, "character", { rendering_speed: "DEFAULT", num_images: 1, style_type: "FICTION", aspect_ratio: "3:2", resolution: "1024x1024" }),
  request("ideogram_40", "generate", 0, false, "generate", { rendering_speed: "QUALITY", num_images: 1, aspect_ratio: null, resolution: "2K", magic_prompt: "ON" }),
  request("ideogram_40", "transparent", 0, false, "transparent", { rendering_speed: "DEFAULT", num_images: 1, aspect_ratio: "1:1", resolution: "8K", magic_prompt: "AUTO" }),
  request("ideogram_45", "generate", 0, false, "generate", { rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:3", resolution: "2K", seed: null }),
  request("ideogram_45", "precise_edit", 1, true, "edit", { rendering_speed: "FLASH", num_images: 1, seed: null })
] as const;

test("source profile describes exactly nine model/mode contexts and keeps authority and cost unproven", () => {
  assert.equal(typeof profile, "function");
  const descriptor = profile!();
  assert.deepEqual(descriptor.contexts, [
    { model_id: "ideogram", mode: "generate" }, { model_id: "ideogram", mode: "remix" },
    { model_id: "ideogram", mode: "reframe" }, { model_id: "ideogram", mode: "replace_background" },
    { model_id: "ideogram", mode: "character_reference" }, { model_id: "ideogram_40", mode: "generate" },
    { model_id: "ideogram_40", mode: "transparent" }, { model_id: "ideogram_45", mode: "generate" },
    { model_id: "ideogram_45", mode: "precise_edit" }
  ]);
  assert.equal(descriptor.cost_input_mapping, "SOURCE_CALLBACK_FIELDS_MAPPED_PRICE_AND_BACKEND_UNPROVEN");
  assert.deepEqual(descriptor.reference_count.ideogram_45_precise_edit, {
    minimum: 1, maximum_unmasked_references: 5, maximum_masked_references: 4, maximum_upload_slots: 5, mask_optional: true, mask_takes_slot: true,
    reference_cap_confidence: "SOURCE_FORM_AND_PUBLIC_SETTINGS_METADATA_NOT_PROVIDER_ACCEPTANCE"
  });
  assert.deepEqual(descriptor.ratios.ideogram, BASE_RATIOS);
  assert.deepEqual(descriptor.ratios.ideogram_40_generate, [null, ...EXPANDED_RATIOS]);
  assert.deepEqual(descriptor.ratios.ideogram_40_transparent, EXPANDED_RATIOS);
  assert.deepEqual(descriptor.ratios.ideogram_45_generate, EXPANDED_RATIOS);
  assert.deepEqual(descriptor.resolutions.ideogram_40_generate, ["1K", "2K"]);
  assert.deepEqual(descriptor.resolutions.ideogram_40_transparent, ["1K", "2K", "4K", "8K"]);
  assert.deepEqual(descriptor.resolutions.ideogram_45_generate, ["1K", "2K"]);
  assert.equal(descriptor.resolutions.ideogram_generate_remix_character_reference_reframe.length, 69);
  assert.equal(descriptor.num_images.minimum, 1);
  assert.equal(descriptor.num_images.maximum, 8);
  assert.deepEqual(descriptor.speed_options.base_and_40, ["TURBO", "DEFAULT", "QUALITY"]);
  assert.deepEqual(descriptor.speed_options.ideogram_45, ["TURBO", "DEFAULT", "QUALITY", "FLASH"]);
  assert.deepEqual(descriptor.cost_declared_keys.ideogram_45, ["rendering_speed", "ref_count", "batch_size"]);
  assert.equal(descriptor.dispatch_allowed, false);
  assert.equal(descriptor.runtime_activation, false);
  assert.equal(descriptor.backend_acceptance, "UNPROVEN");
  assert.equal(descriptor.source_mapping_confidence, "STATIC_SOURCE_POLICY_NOT_RENDERED_UI_OR_PROVIDER_ACCEPTANCE");
});

test("all nine mode-specific literal contexts normalize without forced unsupported fields", () => {
  assert.equal(typeof normalize, "function");
  assert.equal(contexts.length, 9);
  for (const item of contexts) {
    let result!: ReturnType<NonNullable<typeof normalize>>;
    assert.doesNotThrow(() => { result = normalize!(item); }, `${item.model_id}/${item.mode}`);
    assert.equal(result.model_id, item.model_id);
    assert.equal(result.mode, item.mode);
    assert.equal(result.dispatch_allowed, false);
    assert.equal(result.runtime_activation, false);
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal("prompt" in result, false);
    assert.equal("file_urls" in result.source_json_mapping, false);
    assert.equal("n" in result.source_json_mapping, false);
  }
  assert.equal(normalize!(contexts[2]).prompt_policy, "disabled");
  assert.equal(normalize!(contexts[6]).source_json_mapping.mode, "transparent");
  assert.equal(normalize!(contexts[8]).source_json_mapping.mode, "precise_edit");
  assert.equal(normalize!(contexts[2]).source_json_mapping.reframe_mode, true);
  assert.equal(normalize!(contexts[3]).source_json_mapping.replace_background_mode, true);
  assert.equal(normalize!(contexts[4]).source_json_mapping.character_reference_mode, true);
});

test("cost projection follows source callbacks, omits undefined fields, and never treats mask as an image", () => {
  assert.deepEqual(normalize!(request("ideogram", "generate", 0, false, "p", {
    rendering_speed: "TURBO", num_images: 3, aspect_ratio: "1:1", resolution: "1024x1024"
  })).cost_inputs, { rendering_speed: "TURBO", batch_size: 3 });
  assert.deepEqual(normalize!(request("ideogram_40", "generate", 0, false, "p", {
    rendering_speed: "QUALITY", num_images: 2, aspect_ratio: null, resolution: "2K"
  })).cost_inputs, { rendering_speed: "QUALITY", resolution: "2K", batch_size: 2 });
  assert.deepEqual(normalize!(request("ideogram_40", "transparent", 0, false, "p", {
    rendering_speed: "DEFAULT", num_images: 1, aspect_ratio: "1:1", resolution: "4K"
  })).cost_inputs, { rendering_speed: "DEFAULT", mode: "transparent", resolution: "4K", batch_size: 1 });
  assert.deepEqual(normalize!(request("ideogram_45", "generate", 0, false, "p", {
    rendering_speed: "TURBO", num_images: 2, aspect_ratio: "1:1", resolution: "2K"
  })).cost_inputs, { rendering_speed: "TURBO", batch_size: 2 });
  assert.deepEqual(normalize!(request("ideogram_45", "precise_edit", 1, true, "p", {
    rendering_speed: "TURBO", num_images: 1
  })).cost_inputs, { rendering_speed: "TURBO", ref_count: 1, batch_size: 1 });
  assert.throws(() => normalize!(request("ideogram_45", "generate", 0, false, "p", {
    rendering_speed: "FLASH", num_images: 1, aspect_ratio: "1:1", resolution: "2K"
  })), ParameterError);
});

test("base source ratios including CUSTOM cross each literal 69-resolution list and Reframe keeps only resolution", () => {
  assert.equal(RESOLUTIONS_69.length, 69);
  for (const aspect_ratio of BASE_RATIOS) for (const resolution of RESOLUTIONS_69) {
    const result = normalize!(request("ideogram", "generate", 0, false, "prompt", {
      rendering_speed: "TURBO", num_images: 1, aspect_ratio, resolution
    }));
    if (aspect_ratio === "CUSTOM") assert.equal("aspect_ratio" in result.source_json_mapping, false);
    else assert.equal(result.source_json_mapping.aspect_ratio, aspect_ratio);
    assert.equal(result.source_json_mapping.resolution, resolution);
  }
  for (const resolution of RESOLUTIONS_69) {
    const result = normalize!(request("ideogram", "reframe", 1, false, null, { rendering_speed: "TURBO", num_images: 1, resolution }));
    assert.equal(result.source_json_mapping.resolution, resolution);
    assert.equal("aspect_ratio" in result.source_json_mapping, false);
  }
  for (const context of [
    request("ideogram", "remix", 1, false, "prompt", { rendering_speed: "TURBO", num_images: 1, image_weight: 50, aspect_ratio: "CUSTOM", resolution: "1024x1024" }),
    request("ideogram", "character_reference", 1, false, "prompt", { rendering_speed: "TURBO", num_images: 1, aspect_ratio: "CUSTOM", resolution: "1024x1024" })
  ]) {
    const result = normalize!(context);
    assert.equal("aspect_ratio" in result.source_json_mapping, false);
    assert.equal(result.source_json_mapping.resolution, "1024x1024");
  }
});

test("4.0 Generate and Transparent retain their distinct ratio/resolution cross products", () => {
  for (const aspect_ratio of [null, ...EXPANDED_RATIOS]) for (const resolution of ["1K", "2K"]) {
    const result = normalize!(request("ideogram_40", "generate", 0, false, "prompt", {
      rendering_speed: "TURBO", num_images: 1, aspect_ratio, resolution
    }));
    if (aspect_ratio === null) assert.equal("aspect_ratio" in result.source_json_mapping, false);
    else assert.equal(result.source_json_mapping.aspect_ratio, aspect_ratio);
  }
  for (const aspect_ratio of EXPANDED_RATIOS) for (const resolution of ["1K", "2K", "4K", "8K"]) {
    assert.equal(normalize!(request("ideogram_40", "transparent", 0, false, "prompt", {
      rendering_speed: "TURBO", num_images: 1, aspect_ratio, resolution
    })).source_json_mapping.resolution, resolution);
  }
});

test("4.5 Generate blocks only its 1K extreme ratios and FLASH depends on a declared image", () => {
  for (const aspect_ratio of EXPANDED_RATIOS) {
    assert.doesNotThrow(() => normalize!(request("ideogram_45", "generate", 0, false, "prompt", {
      rendering_speed: "TURBO", num_images: 1, aspect_ratio, resolution: "2K"
    })));
    const oneK = request("ideogram_45", "generate", 0, false, "prompt", {
      rendering_speed: "TURBO", num_images: 1, aspect_ratio, resolution: "1K"
    });
    if (aspect_ratio === "1:3" || aspect_ratio === "3:1") assert.throws(() => normalize!(oneK), ParameterError);
    else assert.doesNotThrow(() => normalize!(oneK));
  }
  assert.throws(() => normalize!(request("ideogram_45", "generate", 0, false, "prompt", {
    rendering_speed: "FLASH", num_images: 1, aspect_ratio: "1:1", resolution: "2K"
  })), ParameterError);
  assert.doesNotThrow(() => normalize!(request("ideogram_45", "generate", 1, false, "prompt", {
    rendering_speed: "FLASH", num_images: 1, aspect_ratio: "1:1", resolution: "2K"
  })));
});

test("image counts, mask slot, output count, and seed bounds are validated as intent only", () => {
  const withCount = (base: typeof contexts[number], reference_count: number, mask_present = base.mask_present) => ({ ...base, reference_count, mask_present });
  for (const count of [0, 2, 3, 4, 5]) assert.doesNotThrow(() => normalize!(withCount(contexts[0], count)));
  assert.throws(() => normalize!(withCount(contexts[0], 1)), ParameterError);
  for (const index of [1, 2, 3, 4]) assert.doesNotThrow(() => normalize!(withCount(contexts[index]!, 1)), `${contexts[index]!.model_id}/${contexts[index]!.mode}`);
  for (const bad of [0, 2]) assert.throws(() => normalize!(withCount(contexts[1], bad)), ParameterError);
  for (const count of [0, 1]) assert.doesNotThrow(() => normalize!(request("ideogram_40", "generate", count, false, "generate", {
    rendering_speed: "QUALITY", num_images: 1, aspect_ratio: null, resolution: "2K"
  })));
  for (const count of [1, 2, 3, 4, 5]) assert.doesNotThrow(() => normalize!(withCount(contexts[7], count)));
  for (const count of [1, 2, 3, 4]) assert.doesNotThrow(() => normalize!(withCount(contexts[8], count, true)));
  assert.throws(() => normalize!(withCount(contexts[8], 0, true)), ParameterError);
  assert.throws(() => normalize!(withCount(contexts[8], 5, true)), ParameterError);
  assert.doesNotThrow(() => normalize!(withCount(contexts[8], 1, false)));
  for (const num_images of [1, 8]) assert.doesNotThrow(() => normalize!(request("ideogram", "generate", 0, false, "p", {
    rendering_speed: "TURBO", num_images, aspect_ratio: "1:1", resolution: "1024x1024"
  })));
  for (const num_images of [0, 9, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => normalize!(request("ideogram", "generate", 0, false, "p", {
    rendering_speed: "TURBO", num_images, aspect_ratio: "1:1", resolution: "1024x1024"
  })), ParameterError);
  for (const seed of [null, 0, 2_147_483_647]) assert.doesNotThrow(() => normalize!(request("ideogram", "generate", 0, false, "p", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024", seed
  })));
  for (const seed of [-1, 2_147_483_648, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => normalize!(request("ideogram", "generate", 0, false, "p", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024", seed
  })), ParameterError);
});

test("Precise Edit applies the source-bound five-slot cap conditionally on mask presence", () => {
  const preciseEdit = (reference_count: number, mask_present: boolean) => request(
    "ideogram_45", "precise_edit", reference_count, mask_present, "edit", { rendering_speed: "TURBO", num_images: 1 }
  );

  const noMaskAtCapacity = normalize!(preciseEdit(5, false));
  assert.deepEqual(noMaskAtCapacity.reference_intent, {
    reference_count: 5, mask_present: false, ownership_bound: false, generation_permit: false
  });
  assert.equal(normalize!(preciseEdit(4, true)).reference_intent.mask_present, true);
  assert.throws(() => normalize!(preciseEdit(5, true)), ParameterError);
  assert.equal(normalize!(preciseEdit(1, false)).reference_intent.mask_present, false);
  assert.equal(normalize!(preciseEdit(4, true)).reference_intent.mask_present, true);
  assert.throws(() => normalize!(preciseEdit(5, true)), ParameterError);
});

test("4.0 image overlay omits null seed and rejects magic prompt or manual weight unless ratio is null", () => {
  const withImage = request("ideogram_40", "generate", 1, false, "prompt", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: null, resolution: "1K", seed: null
  });
  const normalized = normalize!(withImage);
  assert.equal("seed" in normalized.source_json_mapping, false);
  assert.equal("magic_prompt" in normalized.source_json_mapping, false);
  const manual = normalize!(request("ideogram_40", "generate", 1, false, "prompt", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: null, resolution: "1K", image_weight_auto: false, image_weight: 37
  }));
  assert.equal(manual.source_json_mapping.image_weight, 37);
  for (const image_weight of [1, 1.5, 100]) {
    const weighted = normalize!(request("ideogram_40", "generate", 1, false, "prompt", {
      rendering_speed: "TURBO", num_images: 1, aspect_ratio: null, resolution: "1K", image_weight_auto: false, image_weight
    }));
    assert.equal(weighted.source_json_mapping.image_weight, image_weight);
  }
  for (const image_weight of [0, 100.01, Number.NaN, Number.POSITIVE_INFINITY]) assert.throws(() => normalize!(request("ideogram_40", "generate", 1, false, "prompt", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: null, resolution: "1K", image_weight_auto: false, image_weight
  })), ParameterError);
  const automatic = normalize!(request("ideogram_40", "generate", 1, false, "prompt", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1K", image_weight_auto: true
  }));
  assert.equal("image_weight" in automatic.source_json_mapping, false);
  assert.throws(() => normalize!(request("ideogram_40", "generate", 1, false, "prompt", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1K", image_weight_auto: false, image_weight: 37
  })), ParameterError);
  assert.throws(() => normalize!(request("ideogram_40", "generate", 1, false, "prompt", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: null, resolution: "1K", magic_prompt: "AUTO"
  })), ParameterError);
  assert.throws(() => normalize!(request("ideogram_40", "generate", 1, false, "prompt", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: null, resolution: "1K", seed: 10
  })), ParameterError);
});

test("style and palette retain only supported mode-specific finite source-shaped values", () => {
  const preset = normalize!(request("ideogram", "generate", 0, false, "prompt", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024",
    style_type: "GENERAL", style_preset: "dynamic-source-name", color_palette: { kind: "preset", name: "dynamic-palette-name" }
  }));
  assert.deepEqual(preset.source_json_mapping.color_palette, { name: "dynamic-palette-name" });
  assert.equal("color_palette_mode" in preset.source_json_mapping, false);
  const custom = normalize!(request("ideogram", "remix", 1, false, "prompt", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024", image_weight: 50,
    color_palette: { kind: "custom", colors: [{ color_hex: "#aabbcc", color_weight: 0 }, { color_hex: "#445566", color_weight: 40.5 }] }
  }));
  assert.deepEqual(custom.source_json_mapping.color_palette, { members: [
    { color_hex: "#aabbcc", color_weight: 0 }, { color_hex: "#445566", color_weight: 40.5 }
  ] });
  assert.throws(() => normalize!(request("ideogram", "character_reference", 1, false, "prompt", {
    rendering_speed: "TURBO", num_images: 1, style_type: "GENERAL", aspect_ratio: "1:1", resolution: "1024x1024"
  })), ParameterError);
  assert.throws(() => normalize!(request("ideogram", "character_reference", 1, false, "prompt", {
    rendering_speed: "TURBO", num_images: 1, style_type: "DESIGN", aspect_ratio: "1:1", resolution: "1024x1024"
  })), ParameterError);
  assert.throws(() => normalize!(request("ideogram", "generate", 0, false, "prompt", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024", style_type: "FICTION"
  })), ParameterError);
  assert.throws(() => normalize!(request("ideogram", "generate", 1, false, "prompt", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024", style_type: "AUTO", style_preset: "x"
  })), ParameterError);
  assert.throws(() => normalize!(request("ideogram", "generate", 2, false, "prompt", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024", style_type: "REALISTIC", style_preset: "x"
  })), ParameterError);
  assert.throws(() => normalize!(request("ideogram", "reframe", 1, false, null, {
    rendering_speed: "TURBO", num_images: 1, resolution: "1024x1024", style_type: "AUTO"
  })), ParameterError);
  assert.throws(() => normalize!(request("ideogram", "reframe", 1, false, null, {
    rendering_speed: "TURBO", num_images: 1, resolution: "1024x1024", style_type: "REALISTIC", style_preset: "x"
  })), ParameterError);
  assert.doesNotThrow(() => normalize!(request("ideogram", "reframe", 1, false, null, {
    rendering_speed: "TURBO", num_images: 1, resolution: "1024x1024", style_type: "GENERAL", style_preset: "x"
  })));
  assert.throws(() => normalize!(request("ideogram", "generate", 0, false, "prompt", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024", color_palette: { kind: "custom", colors: [{ color_hex: "#112233", color_weight: Number.NaN }] }
  })), ParameterError);
});

test("parameter snapshots are detached and frozen without retaining the prompt or caller object", () => {
  const colors = [{ color_hex: "#123456", color_weight: 33 }];
  const candidate = request("ideogram", "remix", 1, false, "private prompt", {
    rendering_speed: "TURBO", num_images: 2, aspect_ratio: "1:1", resolution: "1024x1024", image_weight: 50,
    color_palette: { kind: "custom", colors }
  });
  const result = normalize!(candidate);
  colors[0]!.color_hex = "#ffffff";
  assert.deepEqual(result.source_json_mapping.color_palette, { members: [{ color_hex: "#123456", color_weight: 33 }] });
  assert.equal(Object.isFrozen(result.parameters), true);
  assert.equal(Object.isFrozen(result.parameters.color_palette), true);
  assert.equal(Object.isFrozen(result.source_json_mapping), true);
  assert.equal("prompt" in result, false);
});

test("prompt policy, invalid mutations, dangerous accessors, and forged ownership fields fail closed", () => {
  assert.throws(() => normalize!(request("ideogram", "generate", 0, false, "  ", { rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024" })), ParameterError);
  assert.throws(() => normalize!(request("ideogram", "reframe", 1, false, "must be disabled", { rendering_speed: "TURBO", num_images: 1, resolution: "1024x1024" })), ParameterError);
  const invalids = [
    request("ideogram_40", "transparent", 1, false, "p", { rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "4K" }),
    request("ideogram", "generate", 0, false, "p", { rendering_speed: "FLASH", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024" }),
    request("ideogram_45", "generate", 0, false, "p", { rendering_speed: "TURBO", num_images: 1, aspect_ratio: null, resolution: "1K" }),
    request("ideogram_45", "precise_edit", 1, true, "p", { rendering_speed: "TURBO", num_images: 1, aspect_ratio: null, resolution: "1K" }),
    request("ideogram", "generate", 0, true, "p", { rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024" }),
    request("ideogram", "reframe", 1, false, null, { rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024" }),
    request("ideogram", "generate", 0, false, "p", { rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024", file_urls: ["https://example.invalid/x"] }),
    { ...contexts[0], owner_reference: true },
    { ...contexts[0], provenance_verified: true },
    request("ideogram", "replace_background", 1, false, "p", { rendering_speed: "TURBO", num_images: 1, resolution: "1024x1024" })
  ];
  for (const candidate of invalids) assert.throws(() => normalize!(candidate), ParameterError);
  let getterReads = 0;
  const withGetter = { ...contexts[0], parameters: { ...contexts[0].parameters } };
  Object.defineProperty(withGetter.parameters, "seed", { enumerable: true, get() { getterReads += 1; return null; } });
  assert.throws(() => normalize!(withGetter), ParameterError);
  assert.equal(getterReads, 0);
  let proxyTraps = 0;
  const proxied = new Proxy(contexts[0], { ownKeys() { proxyTraps += 1; return Reflect.ownKeys(contexts[0]); } });
  assert.throws(() => normalize!(proxied), ParameterError);
  assert.equal(proxyTraps, 0);
  const sparse = new Array(1);
  assert.throws(() => normalize!(request("ideogram", "generate", 0, false, "p", {
    rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024", color_palette: { kind: "custom", colors: sparse }
  })), ParameterError);
});
