import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerWanImageSourceParameters,
  normalizeOwnerWanImageParameters,
  OwnerWanImageParametersError
} from "../src/application/owner-wan-image-parameters.js";

const VARIANTS = [
  "wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"
] as const;

function input(
  variant: typeof VARIANTS[number],
  reference_count: number,
  parameters: Record<string, unknown> = {}
) {
  const ratios = variant === "wan_25_i2i_preview"
    ? ["1:1", "3:4", "4:3", "9:16", "16:9"]
    : variant === "wan_26_image"
      ? ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"]
      : ["1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
  const resolution = variant === "wan_25_i2i_preview" ? "720P" : variant === "wan_26_image" ? "1080P" : "2K";
  return {
    variant,
    reference_count,
    parameters: {
      aspect_ratio: ratios[0], resolution, batch_size: 1, prompt_extend: false, seed: null,
      color_palette: null,
      bbox_list: Array.from({ length: reference_count }, () => []),
      ...parameters
    }
  };
}

test("descriptor lists all exact WAN image variants and preserves the source evidence boundary", () => {
  const descriptor = getOwnerWanImageSourceParameters();
  assert.deepEqual(descriptor.variants, VARIANTS);
  assert.deepEqual(descriptor.controls.aspect_ratio.variants, {
    wan_25_i2i_preview: ["1:1", "3:4", "4:3", "9:16", "16:9"],
    wan_26_image: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
    wan_27_image: ["1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
    wan_27_image_pro: ["1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]
  });
  assert.deepEqual(descriptor.controls.resolution.variants, {
    wan_25_i2i_preview: ["720P"],
    wan_26_image: ["720P", "1080P"],
    wan_27_image: ["1K", "2K"],
    wan_27_image_pro: ["1K", "2K", "4K"]
  });
  assert.deepEqual(Object.keys(descriptor.controls), [
    "aspect_ratio", "resolution", "batch_size", "prompt_extend", "seed", "bbox_list", "color_palette"
  ]);
  assert.deepEqual(descriptor.reference_limits, {
    wan_25_i2i_preview: { minimum: 1, maximum: 3 },
    wan_26_image: { minimum: 1, maximum: 4 },
    wan_27_image: { minimum: 0, maximum: 9 },
    wan_27_image_pro: { minimum: 0, maximum: 9 }
  });
  assert.equal(descriptor.conditions.wan_27_image_pro_4k, "REJECT_WHEN_REFERENCE_COUNT_IS_NONZERO; NEVER_COERCE_TO_2K");
  assert.equal(descriptor.dispatch_allowed, false);
  assert.equal(descriptor.runtime_activation, false);
  assert.equal(descriptor.backend_acceptance, "UNPROVEN");
  assert.equal(descriptor.effective_defaults, "UNKNOWN");
  assert.deepEqual(descriptor.cost_boundary.declared_cost_metadata_keys, ["size", "batch_size"]);
  assert.deepEqual(descriptor.cost_boundary.effective_cost_input_keys, ["batch_size"]);
  assert.equal(descriptor.cost_boundary.size, "NO_CONTROLLED_VALUE; OMITTED_BY_SOURCE_SERIALIZER");
  assert.equal(Object.isFrozen(descriptor), true);
});

test("palette percentages must use canonical integer formatting without leading zeroes", () => {
  assert.throws(() => normalizeOwnerWanImageParameters(input("wan_27_image", 0, {
    color_palette: [
      { hex: "#112233", ratio: "01.00%" },
      { hex: "#445566", ratio: "49.00%" },
      { hex: "#778899", ratio: "50.00%" }
    ]
  })), OwnerWanImageParametersError);
});

test("all four exact variants accept their independent source ratio and resolution matrices with full explicit controls", () => {
  const cases = [
    { variant: "wan_25_i2i_preview", ratio: "16:9", resolution: "720P", reference_count: 3 },
    { variant: "wan_26_image", ratio: "21:9", resolution: "1080P", reference_count: 4 },
    { variant: "wan_27_image", ratio: "1:3", resolution: "1K", reference_count: 0 },
    { variant: "wan_27_image_pro", ratio: "5:4", resolution: "4K", reference_count: 0 }
  ] as const;
  for (const item of cases) {
    const result = normalizeOwnerWanImageParameters(input(item.variant, item.reference_count, {
      aspect_ratio: item.ratio,
      resolution: item.resolution,
      batch_size: 4,
      prompt_extend: true,
      seed: 2_147_483_647
    }));
    assert.equal(result.model_id, item.variant);
    assert.equal(result.parameters.aspect_ratio, item.ratio);
    assert.equal(result.parameters.resolution, item.resolution);
    assert.equal(result.parameters.batch_size, 4);
    assert.equal(result.parameters.prompt_extend, true);
    assert.equal(result.parameters.seed, 2_147_483_647);
    assert.equal(result.reference_count, item.reference_count);
    assert.deepEqual(result.cost_inputs, { batch_size: 4 });
    assert.equal(result.cost_input_confidence, "SOURCE_JOINED_BATCH_SIZE_ONLY");
    assert.equal(result.reference_binding.owned_references_bound, false);
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(result.dispatch_allowed, false);
    assert.equal(Object.isFrozen(result.parameters), true);
    assert.equal(Object.isFrozen(result.parameters.bbox_list), true);
  }
});

test("normalizer covers the complete independent ratio by resolution by batch cross-product", () => {
  const matrices = [
    {
      variant: "wan_25_i2i_preview", references: 1,
      ratios: ["1:1", "3:4", "4:3", "9:16", "16:9"], resolutions: ["720P"]
    },
    {
      variant: "wan_26_image", references: 1,
      ratios: ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"], resolutions: ["720P", "1080P"]
    },
    {
      variant: "wan_27_image", references: 0,
      ratios: ["1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], resolutions: ["1K", "2K"]
    },
    {
      variant: "wan_27_image_pro", references: 0,
      ratios: ["1:1", "1:2", "2:1", "1:3", "3:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"], resolutions: ["1K", "2K", "4K"]
    }
  ] as const;
  let caseCount = 0;
  for (const matrix of matrices) {
    for (const aspect_ratio of matrix.ratios) {
      for (const resolution of matrix.resolutions) {
        for (const batch_size of [1, 2, 3, 4] as const) {
          const result = normalizeOwnerWanImageParameters(input(matrix.variant, matrix.references, {
            aspect_ratio, resolution, batch_size
          }));
          assert.equal(result.parameters.aspect_ratio, aspect_ratio);
          assert.equal(result.parameters.resolution, resolution);
          assert.equal(result.parameters.batch_size, batch_size);
          caseCount += 1;
        }
      }
    }
  }
  assert.equal(caseCount, 364);
});

test("Pro 4K rejects references while bbox lists bind only to the explicit ordered reference count", () => {
  assert.throws(() => normalizeOwnerWanImageParameters(input("wan_27_image_pro", 1, {
    resolution: "4K", bbox_list: [[]]
  })), OwnerWanImageParametersError);

  const rectangle = [12, 24, 80, 96];
  const valid = normalizeOwnerWanImageParameters(input("wan_27_image", 2, {
    bbox_list: [[rectangle, [0, 0, 1, 1]], []]
  }));
  assert.deepEqual(valid.parameters.bbox_list, [[rectangle, [0, 0, 1, 1]], []]);
  assert.deepEqual(valid.reference_binding, {
    reference_count: 2,
    bbox_association: "ORDERED_INDEX_ONLY",
    owned_references_bound: false,
    browser_natural_dimensions_verified: false,
    container_geometry_equivalence: "UNPROVEN"
  });
  assert.equal(Object.isFrozen(valid.parameters.bbox_list[0]), true);
  assert.equal(Object.isFrozen(valid.parameters.bbox_list[0]![0]), true);
  const validPro = normalizeOwnerWanImageParameters(input("wan_27_image_pro", 1, {
    bbox_list: [[[10, 20, 30, 40]]],
    color_palette: [
      { hex: "#112233", ratio: "25.00%" },
      { hex: "#445566", ratio: "35.00%" },
      { hex: "#778899", ratio: "40.00%" }
    ]
  }));
  assert.deepEqual(validPro.parameters.bbox_list, [[[10, 20, 30, 40]]]);
  assert.equal(validPro.parameters.color_palette?.length, 3);

  for (const bad of [
    input("wan_27_image", 1, { bbox_list: [[], []] }),
    input("wan_27_image", 1, { bbox_list: [[[0, 0, 10, 10], [20, 20, 30, 30], [40, 40, 50, 50]]] }),
    input("wan_27_image", 1, { bbox_list: [[[0, 0, 0, 10]]] }),
    input("wan_27_image", 1, { bbox_list: [[[0, 0, 10.5, 10]]] }),
    input("wan_25_i2i_preview", 1, { bbox_list: [[[0, 0, 10, 10]]] })
  ]) assert.throws(() => normalizeOwnerWanImageParameters(bad), OwnerWanImageParametersError);
});

test("palette vectors preserve explicit canonical values and reject malformed or redistributed percentages", () => {
  const colors = [
    { hex: "#112233", ratio: "25.00%" },
    { hex: "#445566", ratio: "35.00%" },
    { hex: "#778899", ratio: "40.00%" }
  ];
  const result = normalizeOwnerWanImageParameters(input("wan_27_image_pro", 0, { color_palette: colors }));
  assert.deepEqual(result.parameters.color_palette, colors);
  assert.notEqual(result.parameters.color_palette, colors);
  assert.equal(Object.isFrozen(result.parameters.color_palette), true);
  assert.equal(Object.isFrozen(result.parameters.color_palette![0]), true);

  const tenWeights = [91, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const tenColors = tenWeights.map((weight, index) => ({
    hex: `#${(index + 1).toString(16).padStart(6, "0").toUpperCase()}`,
    ratio: `${weight}.00%`
  }));
  assert.deepEqual(
    normalizeOwnerWanImageParameters(input("wan_27_image_pro", 0, { color_palette: tenColors })).parameters.color_palette,
    tenColors
  );

  for (const badPalette of [
    [], colors.slice(0, 2), [
      { hex: "#112233", ratio: "90.00%" },
      ...Array.from({ length: 10 }, () => ({ hex: "#445566", ratio: "1.00%" }))
    ],
    [{ hex: "#112233", ratio: "33.33%" }, { hex: "#445566", ratio: "33.33%" }, { hex: "#778899", ratio: "33.34%" }],
    [{ hex: "#112233", ratio: "33.00%" }, { hex: "#445566", ratio: "33.00%" }, { hex: "#778899", ratio: "33.00%" }],
    [{ hex: "#aabbcc", ratio: "30.00%" }, { hex: "#445566", ratio: "30.00%" }, { hex: "#778899", ratio: "40.00%" }],
    [{ hex: "#11223", ratio: "30.00%" }, { hex: "#445566", ratio: "30.00%" }, { hex: "#778899", ratio: "40.00%" }]
  ]) {
    assert.throws(() => normalizeOwnerWanImageParameters(input("wan_27_image", 0, { color_palette: badPalette })),
      OwnerWanImageParametersError);
  }
  for (const variant of ["wan_25_i2i_preview", "wan_26_image"] as const) {
    assert.throws(() => normalizeOwnerWanImageParameters(input(variant, 1, {
      color_palette: colors
    })), OwnerWanImageParametersError);
  }
});

test("seed is explicit nullable bounded integer and every variant setting is exact, descriptor-safe data", () => {
  for (const variant of VARIANTS) {
    for (const seed of [null, 0, 2_147_483_647]) {
      assert.equal(normalizeOwnerWanImageParameters(input(variant, variant.startsWith("wan_25") ? 1 : variant.startsWith("wan_26") ? 1 : 0, {
        seed
      })).parameters.seed, seed);
    }
    for (const seed of [-1, 1.5, 2_147_483_648, Number.NaN, "1"]) {
      assert.throws(() => normalizeOwnerWanImageParameters(input(variant, variant.startsWith("wan_25") ? 1 : variant.startsWith("wan_26") ? 1 : 0, {
        seed
      })), OwnerWanImageParametersError);
    }
  }

  const getterState = input("wan_27_image", 0);
  let getterCalls = 0;
  Object.defineProperty(getterState.parameters, "seed", { enumerable: true, get() { getterCalls += 1; return null; } });
  assert.throws(() => normalizeOwnerWanImageParameters(getterState), OwnerWanImageParametersError);
  assert.equal(getterCalls, 0);
  assert.throws(() => normalizeOwnerWanImageParameters(new Proxy({}, {})), OwnerWanImageParametersError);

  for (const extra of [
    { n: 1 }, { model_type: "wan_image" }, { file_urls: [] }, { prompt: "caller prompt" }
  ]) {
    assert.throws(() => normalizeOwnerWanImageParameters(input("wan_27_image", 0, extra)), OwnerWanImageParametersError);
  }
  assert.throws(() => normalizeOwnerWanImageParameters(input("wan_25_i2i_preview", 1, { resolution: "1080P" })),
    OwnerWanImageParametersError);
});

test("reference count uses the exact variant minimum and maximum without importing neighboring model caps", () => {
  const boundaries = [
    ["wan_25_i2i_preview", 1, 3], ["wan_26_image", 1, 4],
    ["wan_27_image", 0, 9], ["wan_27_image_pro", 0, 9]
  ] as const;
  for (const [variant, minimum, maximum] of boundaries) {
    for (let count = minimum; count <= maximum; count += 1) {
      const rectangles = Array.from({ length: count }, (_, index) =>
        variant === "wan_27_image" || variant === "wan_27_image_pro"
          ? [[index, 0, index + 1, 1]]
          : []);
      const result = normalizeOwnerWanImageParameters(input(variant, count, { bbox_list: rectangles }));
      assert.equal(result.reference_count, count);
      assert.equal(result.parameters.bbox_list.length, count);
      for (let index = 0; index < count; index += 1) {
        assert.deepEqual(result.parameters.bbox_list[index], rectangles[index]);
      }
      if (variant === "wan_27_image" || variant === "wan_27_image_pro") {
        assert.deepEqual(result.parameters.bbox_list.map((entry) => entry.length), Array.from({ length: count }, () => 1));
      } else {
        assert.deepEqual(result.parameters.bbox_list.map((entry) => entry.length), Array.from({ length: count }, () => 0));
      }
    }
    for (const count of [minimum - 1, maximum + 1]) {
      assert.throws(() => normalizeOwnerWanImageParameters(input(variant, count)), OwnerWanImageParametersError);
    }
  }
  assert.equal(boundaries.reduce((total, [, minimum, maximum]) => total + maximum - minimum + 1, 0), 27);
});

test("nested arrays and records reject proxies, accessors, symbols, sparse slots, and foreign prototypes without reading getters", () => {
  const valid = input("wan_27_image", 1);
  const paletteProxy = new Proxy([{ hex: "#112233", ratio: "30.00%" }, { hex: "#445566", ratio: "30.00%" }, { hex: "#778899", ratio: "40.00%" }], {});
  assert.throws(() => normalizeOwnerWanImageParameters(input("wan_27_image", 0, { color_palette: paletteProxy })),
    OwnerWanImageParametersError);

  let coordinateGetterCalls = 0;
  const rectangle = [0, 0, 10, 10];
  Object.defineProperty(rectangle, "2", { enumerable: true, get() { coordinateGetterCalls += 1; return 10; } });
  assert.throws(() => normalizeOwnerWanImageParameters(input("wan_27_image", 1, { bbox_list: [[rectangle]] })),
    OwnerWanImageParametersError);
  assert.equal(coordinateGetterCalls, 0);

  const sparsePalette = new Array(3);
  sparsePalette[0] = { hex: "#112233", ratio: "30.00%" };
  sparsePalette[2] = { hex: "#778899", ratio: "40.00%" };
  assert.throws(() => normalizeOwnerWanImageParameters(input("wan_27_image", 0, { color_palette: sparsePalette })),
    OwnerWanImageParametersError);

  const inheritedColor = Object.assign(Object.create({ leaked: true }), { hex: "#112233", ratio: "30.00%" });
  assert.throws(() => normalizeOwnerWanImageParameters(input("wan_27_image", 0, {
    color_palette: [inheritedColor, { hex: "#445566", ratio: "30.00%" }, { hex: "#778899", ratio: "40.00%" }]
  })), OwnerWanImageParametersError);
  const symbolic = input("wan_27_image", 0);
  (symbolic.parameters as Record<string | symbol, unknown>)[Symbol("extra")] = true;
  assert.throws(() => normalizeOwnerWanImageParameters(symbolic), OwnerWanImageParametersError);

  const result = normalizeOwnerWanImageParameters(valid);
  (valid.parameters.bbox_list as number[][][])[0]!.push([1, 2, 3, 4]);
  assert.deepEqual(result.parameters.bbox_list, [[]]);
  assert.equal(Object.isFrozen(result.parameters.bbox_list), true);
});
