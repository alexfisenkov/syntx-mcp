import assert from "node:assert/strict";
import test from "node:test";
import {
  compileStaticSettingsVueSfc,
  STATIC_SETTINGS_COMPILER_LIMITS,
  StaticSettingsCompilerError,
  type StaticSettingsBlockerCode,
  type StaticSettingsCompilerFatalCode,
  type StaticSettingsCompilerResult,
  type StaticSettingsConventionBinding,
  type StaticSettingsJsonValue
} from "../tools/settings-ir/static-settings-compiler.js";

const PRIVATE_MARKER = "PRIVATE_VENDOR_BODY_MUST_NOT_ESCAPE";
const encoder = new TextEncoder();

test("compiles canonical literals, earlier aliases, static lookup, and exact model branches", () => {
  const source = vueSfc(`
const base = { z: -2, a: [true, null, "ok"] } as const
const lookup = { defaults: base, groups: ["primary", "advanced"] }
const modelAlias = model_id
const selected = modelAlias === "banana" && !(modelAlias === "other")
const SCOPE = "IMAGE"
const AI_NAME = "banana"
const settingsGroups = lookup["groups"]
const defaultSettings = selected ? lookup.defaults : { disabled: true }
const controls = [{ type: "select", values: [1, 2] }]
const conditionalRules = model_id !== "banana2" || model_id === "banana"
`);

  const result = compile(source, "banana");
  assert.equal(result.compilation_status, "COMPLETE");
  assert.deepEqual(provenValue(result, "SCOPE"), "IMAGE");
  assert.deepEqual(provenValue(result, "AI_NAME"), "banana");
  assert.deepEqual(provenValue(result, "settingsGroups"), [
    "primary",
    "advanced"
  ]);
  assert.deepEqual(provenValue(result, "defaultSettings"), {
    a: [true, null, "ok"],
    z: -2
  });
  assert.deepEqual(provenValue(result, "controls"), [
    { type: "select", values: [1, 2] }
  ]);
  assert.deepEqual(provenValue(result, "conditionalRules"), true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.vendor_code_executed, false);
  assert.equal(result.source_persisted, false);
  assert.ok(result.metrics.ast_nodes > 0);
  assert.ok(result.metrics.max_ast_depth > 0);
  assert.ok(
    result.metrics.node_kinds.some(
      (entry) => entry.node_kind === "ConditionalExpression" && entry.count === 1
    )
  );
});

test("only earlier top-level const aliases are eligible", () => {
  const forward = compile(
    vueSfc(`
const defaultSettings = later
const later = { safe: true }
`)
  );
  assert.equal(forward.bindings.defaultSettings.status, "BLOCKED");
  assert.ok(hasBlocker(forward, "UNKNOWN_IDENTIFIER_NOT_INTERPRETED"));

  const mutable = compile(
    vueSfc(`
let mutablePreset = { safe: true }
const defaultSettings = mutablePreset
`)
  );
  assert.equal(mutable.bindings.defaultSettings.status, "BLOCKED");
  assert.ok(hasBlocker(mutable, "NON_CONST_BINDING_NOT_INTERPRETED"));

  const absent = compile(vueSfc(""));
  for (const binding of conventionBindings()) {
    assert.equal(absent.bindings[binding].status, "ABSENT_PROVEN");
  }

  const ambiguousAbsence = compile(
    vueSfc("const unrelated = { safe: true }")
  );
  for (const binding of conventionBindings()) {
    assert.equal(ambiguousAbsence.bindings[binding].status, "BLOCKED");
  }
  assert.ok(hasBlocker(ambiguousAbsence, "BINDING_ABSENCE_UNPROVEN"));
});

test("source, AST node, depth, and normalized output limits are inclusive", () => {
  const source = vueSfc("const SCOPE = 'IMAGE'");
  const baseline = compile(source);
  const sourceBytes = encoder.encode(source).byteLength;
  assert.doesNotThrow(() =>
    compileStaticSettingsVueSfc({
      source,
      modelId: "banana",
      limits: { maxSourceBytes: sourceBytes }
    })
  );
  assert.throws(
    () =>
      compileStaticSettingsVueSfc({
        source,
        modelId: "banana",
        limits: { maxSourceBytes: sourceBytes - 1 }
      }),
    fatal("SOURCE_TOO_LARGE")
  );

  assert.doesNotThrow(() =>
    compileStaticSettingsVueSfc({
      source,
      modelId: "banana",
      limits: { maxAstNodes: baseline.metrics.ast_nodes }
    })
  );
  assert.throws(
    () =>
      compileStaticSettingsVueSfc({
        source,
        modelId: "banana",
        limits: { maxAstNodes: baseline.metrics.ast_nodes - 1 }
      }),
    fatal("AST_NODE_LIMIT_EXCEEDED")
  );

  assert.doesNotThrow(() =>
    compileStaticSettingsVueSfc({
      source,
      modelId: "banana",
      limits: { maxAstDepth: baseline.metrics.max_ast_depth }
    })
  );
  assert.throws(
    () =>
      compileStaticSettingsVueSfc({
        source,
        modelId: "banana",
        limits: { maxAstDepth: baseline.metrics.max_ast_depth - 1 }
      }),
    fatal("AST_DEPTH_LIMIT_EXCEEDED")
  );

  const normalizedBytes = encoder.encode(JSON.stringify(baseline)).byteLength;
  assert.doesNotThrow(() =>
    compileStaticSettingsVueSfc({
      source,
      modelId: "banana",
      limits: { maxNormalizedBytes: normalizedBytes }
    })
  );
  assert.throws(
    () =>
      compileStaticSettingsVueSfc({
        source,
        modelId: "banana",
        limits: { maxNormalizedBytes: normalizedBytes - 1 }
      }),
    fatal("NORMALIZED_OUTPUT_TOO_LARGE")
  );
});

test("production source byte limit accepts the boundary and rejects boundary plus one", () => {
  const exact = sourceWithExactAsciiBytes(
    STATIC_SETTINGS_COMPILER_LIMITS.maxSourceBytes
  );
  assert.equal(
    encoder.encode(exact).byteLength,
    STATIC_SETTINGS_COMPILER_LIMITS.maxSourceBytes
  );
  assert.doesNotThrow(() => compile(exact));
  assert.throws(
    () => compile(`${exact} `),
    fatal("SOURCE_TOO_LARGE")
  );
});

test("object, array, and decoded string literal limits reject boundary plus one", () => {
  const objectAtLimit = Array.from(
    { length: STATIC_SETTINGS_COMPILER_LIMITS.maxObjectProperties },
    (_, index) => `k${index}:${index}`
  ).join(",");
  assert.doesNotThrow(() =>
    compile(vueSfc(`const defaultSettings = {${objectAtLimit}}`))
  );
  assert.throws(
    () =>
      compile(
        vueSfc(
          `const defaultSettings = {${objectAtLimit},overflow:true}`
        )
      ),
    fatal("OBJECT_PROPERTY_LIMIT_EXCEEDED")
  );

  const arrayAtLimit = Array.from(
    { length: STATIC_SETTINGS_COMPILER_LIMITS.maxArrayElements },
    (_, index) => String(index)
  ).join(",");
  assert.doesNotThrow(() =>
    compile(vueSfc(`const controls = [${arrayAtLimit}]`))
  );
  assert.throws(
    () => compile(vueSfc(`const controls = [${arrayAtLimit},0]`)),
    fatal("ARRAY_ELEMENT_LIMIT_EXCEEDED")
  );

  const stringAtLimit = "x".repeat(
    STATIC_SETTINGS_COMPILER_LIMITS.maxStringBytes
  );
  assert.doesNotThrow(() =>
    compile(vueSfc(`const SCOPE = "${stringAtLimit}"`))
  );
  assert.throws(
    () => compile(vueSfc(`const SCOPE = "${stringAtLimit}x"`)),
    fatal("STRING_BYTE_LIMIT_EXCEEDED")
  );
});

test("caller may only lower parser budgets", () => {
  const source = vueSfc("const SCOPE = 'IMAGE'");
  assert.throws(
    () =>
      compileStaticSettingsVueSfc({
        source,
        modelId: "banana",
        limits: {
          maxAstNodes: STATIC_SETTINGS_COMPILER_LIMITS.maxAstNodes + 1
        }
      }),
    fatal("LIMITS_INVALID")
  );
  assert.throws(
    () =>
      compileStaticSettingsVueSfc({
        source,
        modelId: "banana",
        limits: { maxAstNodes: 0 }
      }),
    fatal("LIMITS_INVALID")
  );
});

test("unsupported executable and dynamic nodes become safe stable blockers", () => {
  const cases: Array<{
    name: string;
    script: string;
    code: StaticSettingsBlockerCode;
  }> = [
    {
      name: "call",
      script: `const defaultSettings = make("${PRIVATE_MARKER}")`,
      code: "CALL_EXPRESSION_NOT_INTERPRETED"
    },
    {
      name: "new",
      script: `const defaultSettings = new Widget("${PRIVATE_MARKER}")`,
      code: "NEW_EXPRESSION_NOT_INTERPRETED"
    },
    {
      name: "function",
      script: `const defaultSettings = () => "${PRIVATE_MARKER}"`,
      code: "FUNCTION_NOT_INTERPRETED"
    },
    {
      name: "object spread",
      script: `const hidden = {value:"${PRIVATE_MARKER}"}; const defaultSettings = {...hidden}`,
      code: "SPREAD_NOT_INTERPRETED"
    },
    {
      name: "array spread",
      script: `const hidden = ["${PRIVATE_MARKER}"]; const controls = [...hidden]`,
      code: "SPREAD_NOT_INTERPRETED"
    },
    {
      name: "computed key",
      script: `const hidden = "${PRIVATE_MARKER}"; const defaultSettings = {[model_id]:hidden}`,
      code: "COMPUTED_KEY_NOT_INTERPRETED"
    },
    {
      name: "dynamic access",
      script: `const hidden = {banana:"${PRIVATE_MARKER}"}; const defaultSettings = hidden[model_id]`,
      code: "DYNAMIC_MEMBER_ACCESS_NOT_INTERPRETED"
    },
    {
      name: "mutation",
      script: `let hidden = "${PRIVATE_MARKER}"; hidden += "x"; const defaultSettings = {safe:true}`,
      code: "MUTATION_NOT_INTERPRETED"
    },
    {
      name: "non-const declaration",
      script: `let hidden = "${PRIVATE_MARKER}"; const defaultSettings = {safe:true}`,
      code: "NON_CONST_BINDING_NOT_INTERPRETED"
    },
    {
      name: "loop",
      script: `for (const hidden of ["${PRIVATE_MARKER}"]) {} const defaultSettings = {safe:true}`,
      code: "LOOP_NOT_INTERPRETED"
    },
    {
      name: "function declaration",
      script: `function hidden(){ return "${PRIVATE_MARKER}" } const defaultSettings = {safe:true}`,
      code: "FUNCTION_NOT_INTERPRETED"
    }
  ];

  for (const fixture of cases) {
    const result = compile(vueSfc(fixture.script));
    assert.equal(result.compilation_status, "PARTIAL", fixture.name);
    assert.ok(hasBlocker(result, fixture.code), fixture.name);
    assert.equal(JSON.stringify(result).includes(PRIVATE_MARKER), false, fixture.name);
    for (const blocker of result.blockers) {
      assert.ok(blocker.line > 0, fixture.name);
      assert.ok(blocker.column > 0, fixture.name);
      assert.ok(blocker.node_kind.length > 0, fixture.name);
    }
  }
});

test("dangerous and duplicate decoded object keys fail closed", () => {
  for (const keySource of [
    "__proto__",
    '"\\u005f\\u005fproto\\u005f\\u005f"',
    "prototype",
    "constructor"
  ]) {
    assert.throws(
      () =>
        compile(vueSfc(`const defaultSettings = {${keySource}: true}`)),
      fatal("OBJECT_KEY_FORBIDDEN")
    );
  }
  for (const properties of ['a:1,"a":2', '1:true,"1":false']) {
    assert.throws(
      () => compile(vueSfc(`const defaultSettings = {${properties}}`)),
      fatal("OBJECT_KEY_DUPLICATE")
    );
  }
});

test("strict SFC splitter rejects missing, duplicate, src, and unclosed roots", () => {
  const fixtures: Array<[string, StaticSettingsCompilerFatalCode]> = [
    ["<template><div/></template>", "SCRIPT_SETUP_MISSING"],
    ["<script>const x=1</script><template><div/></template>", "SCRIPT_BLOCK_FORBIDDEN"],
    [
      "<script setup>const x=1</script><script setup>const y=2</script><template><div/></template>",
      "SCRIPT_SETUP_DUPLICATE"
    ],
    [
      '<script setup src="./remote.ts"></script><template><div/></template>',
      "SCRIPT_SETUP_SRC_FORBIDDEN"
    ],
    [
      '<script setup async>const x=1</script><template><div/></template>',
      "SCRIPT_SETUP_ATTRIBUTES_INVALID"
    ],
    [
      '<script setup>const x=1</script><script>const y=2</script><template><div/></template>',
      "SCRIPT_BLOCK_FORBIDDEN"
    ],
    [
      '<script setup :src="remote">const x=1</script><template><div/></template>',
      "SCRIPT_SETUP_ATTRIBUTES_INVALID"
    ],
    [
      '<script setup lang="js">const x=1</script><template><div/></template>',
      "SCRIPT_SETUP_ATTRIBUTES_INVALID"
    ],
    [
      '<script setup lang="ts" lang="ts">const x=1</script><template><div/></template>',
      "SCRIPT_SETUP_ATTRIBUTES_INVALID"
    ],
    ["<script setup>const x=1<template><div/></template>", "SCRIPT_SETUP_UNCLOSED"],
    ["<script setup>const x=1</script>", "TEMPLATE_MISSING"],
    [
      "<script setup>const x=1</script><template><div/></template><template><p/></template>",
      "TEMPLATE_DUPLICATE"
    ],
    [
      '<script setup>const x=1</script><template src="./remote.html"></template>',
      "TEMPLATE_SRC_FORBIDDEN"
    ],
    [
      '<script setup>const x=1</script><template lang="pug">div</template>',
      "TEMPLATE_ATTRIBUTES_INVALID"
    ],
    [
      "<script setup>const x=1</script><template><template><div/></template>",
      "TEMPLATE_UNBALANCED"
    ],
    [
      "<script setup>const x=1</script><custom>hidden</custom><template><div/></template>",
      "SFC_STRUCTURE_INVALID"
    ],
    [
      "<script setup>const x=1</script><template><!-- unclosed</template>",
      "TEMPLATE_UNBALANCED"
    ],
    [
      "root text<script setup>const x=1</script><template><div/></template>",
      "SFC_STRUCTURE_INVALID"
    ]
  ];
  for (const [source, code] of fixtures) {
    assert.throws(() => compile(source), fatal(code), code);
  }

  for (const fakeClose of [
    "// </script>",
    "/* </script> */",
    "const text = '</script>'",
    "const text = `</script>`"
  ]) {
    assert.throws(
      () =>
        compile(
          `<script setup lang="ts">\nconst SCOPE="IMAGE"\n${fakeClose}\n<template><div /></template>`
        ),
      fatal("SCRIPT_SETUP_UNCLOSED")
    );
  }
});

test("balanced nested templates ignore comments and quoted mustache text", () => {
  const source = vueSfc(
    "const SCOPE = 'IMAGE'",
    `
<!-- <template v-if="decoy"> -->
<div>{{ "<template></template>" }}</div>
<template v-if="visible"><span /></template>
`
  );
  const result = compile(source);
  assert.equal(result.detections.template_v_if.length, 1);
  assert.ok(hasBlocker(result, "TEMPLATE_CONTROL_FLOW_NOT_COMPILED"));
  assert.equal(result.detections.template_v_if[0]?.node_kind, "VueVIfDirective");
});

test("invalid UTF-8, non-roundtripping strings, and TypeScript diagnostics expose fixed codes only", () => {
  const invalidUtf8 = new Uint8Array([0x3c, 0x80, 0x3e]);
  assert.throws(
    () =>
      compileStaticSettingsVueSfc({
        source: invalidUtf8,
        modelId: "banana"
      }),
    fatal("SOURCE_UTF8_INVALID")
  );
  assert.throws(
    () => compile(`${vueSfc("const x = 1")}\ud800`),
    fatal("SOURCE_UTF8_INVALID")
  );

  const malformed = vueSfc(`const defaultSettings = ; // ${PRIVATE_MARKER}`);
  try {
    compile(malformed);
    assert.fail("expected parser failure");
  } catch (error) {
    assert.ok(error instanceof StaticSettingsCompilerError);
    assert.equal(error.code, "TYPESCRIPT_PARSE_FAILED");
    assert.equal(error.message, "Static settings source could not be compiled safely.");
    assert.equal(JSON.stringify(error).includes(PRIVATE_MARKER), false);
    assert.equal(error.stack?.includes(PRIVATE_MARKER) ?? false, false);
  }
});

test("same source and model produce byte-stable normalized output", () => {
  const source = vueSfc(`
const SCOPE = "IMAGE"
const defaultSettings = model_id === "banana" ? {b:2,a:1} : {c:3}
`);
  const first = compile(source);
  const second = compile(source);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(provenValue(first, "defaultSettings"), { a: 1, b: 2 });
});

test("actual-like Banana fixture yields safe partial candidates and reactive locators", () => {
  const source = vueSfc(
    `
import { computed, watch } from "vue"
const SCOPE = "IMAGE"
const AI_NAME = "banana"
const baseDefaults = { count: 1, format: "square" }
const settingsGroups = [{ id: "main", fields: ["count", "format"] }]
const defaultSettings = model_id === "banana3"
  ? { aspect_ratio: "wide", image_size: "2K", seed: resolveSeed() }
  : { aspect_ratio: "square", image_size: "1K", seed: resolveSeed() }
const controls = computed(() => [{ id: "quality", enabled: true }])
const conditionalRules = model_id === "banana" ? [{ field: "format", visible: true }] : []
watch(model_id, () => {})
`,
    `
<section>
  <template v-if="showAdvanced"><div /></template>
</section>
`
  );
  const result = compile(source, "banana");

  assert.equal(result.compilation_status, "PARTIAL");
  assert.deepEqual(provenValue(result, "SCOPE"), "IMAGE");
  assert.deepEqual(provenValue(result, "AI_NAME"), "banana");
  assert.equal(result.bindings.defaultSettings.status, "BLOCKED");
  if (result.bindings.defaultSettings.status === "BLOCKED") {
    assert.deepEqual(result.bindings.defaultSettings.candidates, {
      aspect_ratio: "square",
      image_size: "1K"
    });
    assert.equal(
      result.bindings.defaultSettings.candidates_locator?.node_kind,
      "ObjectLiteralExpression"
    );
    assert.notDeepEqual(
      result.bindings.defaultSettings.candidates_locator,
      result.bindings.defaultSettings.locator
    );
  }
  assert.deepEqual(provenValue(result, "settingsGroups"), [
    { fields: ["count", "format"], id: "main" }
  ]);
  assert.deepEqual(provenValue(result, "conditionalRules"), [
    { field: "format", visible: true }
  ]);
  assert.equal(result.bindings.controls.status, "BLOCKED");
  assert.equal(result.detections.computed_calls.length, 1);
  assert.equal(result.detections.watch_calls.length, 1);
  assert.equal(result.detections.template_v_if.length, 1);
  for (const code of [
    "IMPORT_NOT_INTERPRETED",
    "COMPUTED_RULE_NOT_INTERPRETED",
    "WATCH_RULE_NOT_INTERPRETED",
    "TEMPLATE_CONTROL_FLOW_NOT_COMPILED"
  ] as const) {
    assert.ok(hasBlocker(result, code), code);
  }
  assert.equal(JSON.stringify(result).includes("import {"), false);
  assert.equal(JSON.stringify(result).includes("v-if="), false);
});

test("model id and ambiguous convention declarations fail closed", () => {
  assert.throws(
    () => compileStaticSettingsVueSfc({ source: vueSfc(""), modelId: "bad/id" }),
    fatal("MODEL_ID_INVALID")
  );
  assert.throws(
    () =>
      compile(
        vueSfc("const SCOPE='IMAGE'; const SCOPE='VIDEO'")
      ),
    fatal("DUPLICATE_CONVENTION_BINDING")
  );
  assert.throws(
    () =>
      compile(
        vueSfc(
          "const helper={safe:true}; const helper={safe:false}; const SCOPE='IMAGE'"
        )
      ),
    fatal("DUPLICATE_TOP_LEVEL_BINDING")
  );
  const shadowed = compile(
    vueSfc("const model_id='banana2'; const SCOPE='IMAGE'")
  );
  assert.ok(hasBlocker(shadowed, "MODEL_ID_SHADOWED"));
  assert.equal(shadowed.compilation_status, "PARTIAL");

  const namespaceShadow = compile(
    vueSfc(
      'namespace model_id {}\nconst defaultSettings = model_id === "banana" ? {choice:"A"} : {choice:"B"}'
    )
  );
  assert.equal(namespaceShadow.bindings.defaultSettings.status, "BLOCKED");
  assert.ok(hasBlocker(namespaceShadow, "MODEL_ID_SHADOWED"));
  assert.ok(hasBlocker(namespaceShadow, "UNSUPPORTED_SYNTAX_NOT_INTERPRETED"));
});

test("runtime argument shape and secret-like literals fail with fixed codes", () => {
  assert.throws(
    () =>
      compileStaticSettingsVueSfc(
        undefined as unknown as Parameters<
          typeof compileStaticSettingsVueSfc
        >[0]
      ),
    fatal("OPTIONS_INVALID")
  );
  assert.throws(
    () =>
      compileStaticSettingsVueSfc({
        source: vueSfc(""),
        modelId: undefined as unknown as string
      }),
    fatal("MODEL_ID_INVALID")
  );
  assert.throws(
    () =>
      compileStaticSettingsVueSfc({
        source: vueSfc(""),
        modelId: "banana",
        limits: null as unknown as Record<string, never>
      }),
    fatal("LIMITS_INVALID")
  );
  assert.throws(
    () => {
      const syntheticSecret = ["sk", "live", "1234567890abcdef"].join("_");
      compile(
        vueSfc(
          `const defaultSettings = { authorization: "${syntheticSecret}" }`
        )
      );
    },
    fatal("SECRET_LIKE_LITERAL_FORBIDDEN")
  );
});

function compile(
  source: string | Uint8Array,
  modelId = "banana"
): StaticSettingsCompilerResult {
  return compileStaticSettingsVueSfc({ source, modelId });
}

function vueSfc(script: string, template = "<div />"): string {
  return `<script setup lang="ts">\n${script}\n</script>\n<template>\n${template}\n</template>`;
}

function sourceWithExactAsciiBytes(bytes: number): string {
  const prefix = '<script setup lang="ts">\n/*';
  const suffix = '*/\nconst SCOPE="IMAGE"\n</script>\n<template><div /></template>';
  const padding = bytes - encoder.encode(prefix + suffix).byteLength;
  assert.ok(padding >= 0);
  return `${prefix}${"x".repeat(padding)}${suffix}`;
}

function fatal(code: StaticSettingsCompilerFatalCode) {
  return (error: unknown): boolean =>
    error instanceof StaticSettingsCompilerError &&
    error.code === code &&
    error.message === "Static settings source could not be compiled safely.";
}

function hasBlocker(
  result: StaticSettingsCompilerResult,
  code: StaticSettingsBlockerCode
): boolean {
  return result.blockers.some((blocker) => blocker.code === code);
}

function provenValue(
  result: StaticSettingsCompilerResult,
  binding: StaticSettingsConventionBinding
): StaticSettingsJsonValue {
  const projection = result.bindings[binding];
  assert.equal(projection.status, "PROVEN", binding);
  return projection.value;
}

function conventionBindings(): StaticSettingsConventionBinding[] {
  return [
    "SCOPE",
    "AI_NAME",
    "settingsGroups",
    "defaultSettings",
    "controls",
    "conditionalRules"
  ];
}
