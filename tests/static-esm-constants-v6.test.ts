import assert from "node:assert/strict";
import test from "node:test";
import {
  compileStaticEsmConstants,
  STATIC_ESM_CONSTANTS_LIMITS,
  StaticEsmConstantsError,
  type StaticEsmConstantsResult,
  type StaticEsmJsonValue
} from "../tools/settings-ir/v6/static-esm-constants.js";

function compile(source: string, localFunctionNames: readonly string[] = []): StaticEsmConstantsResult {
  return compileStaticEsmConstants({ source, sourcePath: "/synthetic/helper.ts", localFunctionNames });
}

function record(result: StaticEsmConstantsResult, name: string, scope = "module") {
  const item = result.records.find((entry) => entry.name === name && entry.scope === scope);
  assert.ok(item, `${scope}:${name} exists`);
  return item;
}

function value(result: StaticEsmConstantsResult, name: string, scope = "module"): StaticEsmJsonValue {
  const item = record(result, name, scope);
  assert.equal(item.status, "STATIC_VALUE", `${scope}:${name} is static`);
  if (item.status !== "STATIC_VALUE") throw new Error("unreachable");
  return item.value;
}

function blocker(result: StaticEsmConstantsResult, name: string, scope = "module"): string {
  const item = record(result, name, scope);
  assert.equal(item.status, "BLOCKED", `${scope}:${name} is blocked`);
  if (item.status !== "BLOCKED") throw new Error("unreachable");
  return item.blocker;
}

test("ESM v6 profile is deterministic, declaration-only, source-free and locator-bound", () => {
  const source = "// vendor body never emitted\nexport const MODEL = 'synthetic';\nconst hidden = 3;\nexport { hidden as visible };";
  const result = compile(source);
  assert.deepEqual(result, compile(source));
  assert.equal(result.profile, "STATIC_ESM_CONSTANTS_V1");
  assert.equal(result.proof_scope, "DECLARATION_INITIALIZERS_ONLY");
  assert.equal(result.runtime_usable, false);
  assert.equal(result.vendor_code_executed, false);
  assert.equal(result.source_persisted, false);
  assert.deepEqual(record(result, "MODEL").locator, { line: 2, column: 14 });
  assert.equal(record(result, "MODEL").exported, true);
  assert.equal(record(result, "hidden").exported, true);
  assert.equal(JSON.stringify(result).includes("vendor body never emitted"), false);
  assert.equal(JSON.stringify(result).includes("synthetic/helper.ts"), false);
});

test("ESM v6 extracts synthetic Hailuo maps, computed keys, aliases and file-size arithmetic", () => {
  const result = compile(`
export const MINIMAX_MODEL_NAME = "hailuo-minimax";
export const RESOLUTION = { "512p": "512p", "720p": "720p", "1080p": "1080p" };
export const DURATION = { "6s": 6, "10s": 10 };
export const MODEL = { "02": "hailuo-02", "3_0": "hailuo-3.0" };
export const FIXED_MODELS = [MODEL["02"]];
export const MODEL_RESOLUTIONS = { [MODEL["02"]]: [RESOLUTION["512p"], RESOLUTION["720p"]] };
export const RESOLUTION_DURATIONS = { [RESOLUTION["720p"]]: [DURATION["6s"], DURATION["10s"]] };
export const HAILUO_30 = MODEL["3_0"];
export const MAX_FILE_SIZE_30 = { images: 20 * 1024 * 1024, videos: 100 * 1024 * 1024 };
export const DURATION_30_MIN = 4;
export const IMAGE_MIN_ASPECT_RATIO_30 = 0.4;
export const isHailuo30 = (model) => model === HAILUO_30;
`);
  assert.deepEqual(value(result, "MODEL_RESOLUTIONS"), { "hailuo-02": ["512p", "720p"] });
  assert.deepEqual(value(result, "RESOLUTION_DURATIONS"), { "720p": [6, 10] });
  assert.equal(value(result, "HAILUO_30"), "hailuo-3.0");
  assert.deepEqual(value(result, "MAX_FILE_SIZE_30"), { images: 20_971_520, videos: 104_857_600 });
  assert.equal(value(result, "DURATION_30_MIN"), 4);
  assert.equal(value(result, "IMAGE_MIN_ASPECT_RATIO_30"), 0.4);
  assert.equal(blocker(result, "isHailuo30"), "FUNCTION_NOT_INTERPRETED");
});

test("ESM v6 extracts synthetic Luma module and explicitly selected direct-local config", () => {
  const result = compile(`
import { computed } from "vue";
import { useAiModelsStore } from "./store";
export const LUMA_AI_NAME = "luma_image";
export const LUMA_MODEL_CONFIG = {
  "uni-1": { fileCountLimit: 9, promptPolicy: "required", fileMentions: true },
  "uni-1.1-remove-background": { fileCountLimit: 1, promptPolicy: "optional", showSeed: false }
};
export function useLumaSettings() {
  const $aiModelsStore = useAiModelsStore();
  const defaultSettings = { model_type: $aiModelsStore.selected, aspect_ratio: "9:16", seed: null };
  const styleOptions = [{ label: "Auto", value: "auto" }, { label: "Manga", value: "manga" }];
  const settingsGroups = { format: ["aspect_ratio"], style: ["mode", "mref"], additional: ["invert_mask", "seed"] };
  const portraitRatios = ["9:16", "2:3", "1:2", "1:3"];
  const sectionsList = computed(() => settingsGroups);
  if (true) { const nested = "not included"; }
  function inner() { const nestedFunction = "not included"; }
  return { styleOptions, settingsGroups, portraitRatios, defaultSettings, sectionsList, inner };
}
function unselected() { const unrelated = "not included"; }
`, ["useLumaSettings"]);
  assert.equal((value(result, "LUMA_MODEL_CONFIG") as Record<string, Record<string, unknown>>)["uni-1"]?.fileCountLimit, 9);
  assert.deepEqual(value(result, "styleOptions", "useLumaSettings"), [{ label: "Auto", value: "auto" }, { label: "Manga", value: "manga" }]);
  assert.deepEqual(value(result, "settingsGroups", "useLumaSettings"), { format: ["aspect_ratio"], style: ["mode", "mref"], additional: ["invert_mask", "seed"] });
  assert.deepEqual(value(result, "portraitRatios", "useLumaSettings"), ["9:16", "2:3", "1:2", "1:3"]);
  assert.equal(record(result, "defaultSettings", "useLumaSettings").status, "BLOCKED");
  assert.equal("value" in record(result, "defaultSettings", "useLumaSettings"), false);
  assert.equal(record(result, "styleOptions", "useLumaSettings").exported, false);
  for (const name of ["nested", "nestedFunction", "unrelated"]) assert.equal(result.records.some((item) => item.name === name), false);
});

test("ESM v6 supports TS wrappers, shorthand, own array indices and JSON numeric semantics", () => {
  const result = compile(`
const x: number = 0x10;
const typed = ({ x, b: true, c: null, d: \`plain\` } as const);
const arr = [1, 2, 3];
const first = arr[0];
const length = arr.length;
const scalar = <number>(+3 * 4 - 2) / 5;
const huge = 9007199254740993;
const hugeHex = 0x20000000000001;
const maxSafe = 9007199254740991;
const negativeHuge = -9007199254740993;
const exactBeyondSafe = 10000000000000000;
const stringNumber = "4";
const negative = -4;
const fractional = 0.1 + 0.2;
`);
  assert.deepEqual(value(result, "typed"), { x: 16, b: true, c: null, d: "plain" });
  assert.equal(value(result, "first"), 1);
  assert.equal(value(result, "length"), 3);
  assert.equal(value(result, "scalar"), 2);
  assert.equal(blocker(result, "huge"), "NUMBER_NOT_JSON_EXACT");
  assert.equal(blocker(result, "hugeHex"), "NUMBER_NOT_JSON_EXACT");
  assert.equal(value(result, "maxSafe"), 9_007_199_254_740_991);
  assert.equal(blocker(result, "negativeHuge"), "NUMBER_NOT_JSON_EXACT");
  assert.equal(value(result, "exactBeyondSafe"), 10_000_000_000_000_000);
  assert.equal(value(result, "stringNumber"), "4");
  assert.equal(value(result, "negative"), -4);
  assert.equal(value(result, "fractional"), 0.1 + 0.2);
});

test("ESM v6 rejects prototype keys, duplicate keys, inherited access and getters", () => {
  const result = compile(`
const direct = { __proto__: null };
const computed = { ["constructor"]: 1 };
const quoted = { "prototype": 1 };
const duplicate = { 1: 2, "1": 3 };
const nested = { child: { ["__proto__"]: 3 } };
const getter = { get evil() { throw new Error("PRIVATE_GETTER_BODY"); } };
const method = { evil() {} };
const object = { safe: 1 };
const inherited = object.toString;
const prototype = object["__proto__"];
const missing = object.unknown;
const optional = object?.safe;
`);
  for (const name of ["direct", "computed", "quoted", "nested", "prototype"]) assert.equal(blocker(result, name), "PROTOTYPE_KEY_FORBIDDEN");
  assert.equal(blocker(result, "duplicate"), "DUPLICATE_PROPERTY");
  assert.equal(blocker(result, "inherited"), "OWN_PROPERTY_REQUIRED");
  assert.equal(blocker(result, "missing"), "OWN_PROPERTY_REQUIRED");
  assert.equal(blocker(result, "optional"), "OPTIONAL_ACCESS_NOT_INTERPRETED");
  assert.equal(blocker(result, "getter"), "OBJECT_PROPERTY_NOT_INTERPRETED");
  assert.equal(blocker(result, "method"), "OBJECT_PROPERTY_NOT_INTERPRETED");
  assert.equal(JSON.stringify(result).includes("PRIVATE_GETTER_BODY"), false);
  assert.equal(Object.hasOwn(Object.prototype, "safe"), false);
});

test("ESM v6 rejects unresolved, mutable, forward and circular references", () => {
  const result = compile(`
import { remote } from "./unknown";
let mutable = 1;
const imported = remote;
const changed = mutable;
const first = later;
const later = 1;
const self = self;
const cycleA = cycleB;
const cycleB = cycleA;
const duplicate = 1;
const duplicate = 2;
const { destructured } = remote;
const usingDestructured = destructured;
`);
  assert.equal(blocker(result, "imported"), "NON_STATIC_BINDING");
  assert.equal(blocker(result, "changed"), "NON_STATIC_BINDING");
  for (const name of ["first", "self", "cycleA", "cycleB"]) assert.equal(blocker(result, name), "USE_BEFORE_DEFINITION");
  assert.equal(blocker(result, "duplicate"), "AMBIGUOUS_BINDING");
  assert.equal(blocker(result, "destructured"), "DESTRUCTURING_NOT_INTERPRETED");
  assert.equal(blocker(result, "usingDestructured"), "NON_STATIC_BINDING");
});

test("ESM v6 respects parameters, hoisted locals, duplicate functions and function invocation uncertainty", () => {
  const result = compile(`
const shared = { value: 1 };
function selected(shared) {
  const parameterShadow = shared;
  const localShadow = hidden;
  if (false) { var hidden = 2; }
  const futureModule = afterFunction;
}
const afterFunction = 3;
function duplicateScope() { const x = 1; }
function duplicateScope() { const x = 2; }
function* generator() { const y = 3; }
`, ["selected", "duplicateScope", "generator"]);
  assert.equal(blocker(result, "parameterShadow", "selected"), "NON_STATIC_BINDING");
  assert.equal(blocker(result, "localShadow", "selected"), "NON_STATIC_BINDING");
  assert.equal(blocker(result, "futureModule", "selected"), "USE_BEFORE_DEFINITION");
  assert.equal(blocker(result, "x", "duplicateScope"), "AMBIGUOUS_OR_GENERATOR_SCOPE");
  assert.equal(blocker(result, "y", "generator"), "AMBIGUOUS_OR_GENERATOR_SCOPE");
});

test("ESM v6 mutation and escape protection propagates through aliases but retains literal facts", () => {
  for (const action of [
    "object.safe = 2;", "object.safe++;", "++object.safe;", "delete object.safe;",
    "object.safe += 1;", "external(object);", "object.method();", "Object.assign(object, {});",
    "for (object.safe of incoming) {}", "for (object.safe in incoming) {}",
    "const escaping = () => object;", "function escape() { return object; }",
    "const alias = object; alias.safe = 2;", "const alias = { object }; external(alias);",
    "let alias = object;", "eval('object.safe = 2');"
  ]) {
    const result = compile(`const object = { safe: 1 };\n${action}\nconst dependent = object.safe;`);
    assert.deepEqual(value(result, "object"), { safe: 1 }, action);
    assert.equal(blocker(result, "dependent"), "MUTATION_OR_ESCAPE_REFERENCE", action);
  }
});

test("ESM v6 harmless strict comparisons in exported functions do not poison constants", () => {
  const result = compile(`
export const MODEL = { current: "model-a" };
export function isCurrent(model) { return model === MODEL.current; }
export const different = (model) => model !== MODEL.current;
const derived = [MODEL.current];
`);
  assert.deepEqual(value(result, "derived"), ["model-a"]);
});

test("ESM v6 never evaluates calls, functions, dynamic defaults or executable syntax", () => {
  const result = compile(`
const called = (() => { globalThis.PRIVATE_SIDE_EFFECT = true; return 5; })();
const conditional = true ? 1 : 2;
const spread = [...[1, 2]];
const hole = [1,,3];
const objectSpread = { ...{ a: 1 } };
const template = \`value \${5}\`;
const big = 1n;
const regexp = /hello/;
const infinity = 1 / 0;
const nan = 0 / 0;
const negativeZero = -0;
const infiniteLiteral = 1e999;
const stringMath = "1" + "2";
const defaultSettings = { model_type: stores.model, seed: null };
`);
  for (const item of result.records) assert.equal(item.status, "BLOCKED", item.name);
  assert.equal(JSON.stringify(result).includes("PRIVATE_SIDE_EFFECT"), false);
  assert.equal(Object.hasOwn(globalThis, "PRIVATE_SIDE_EFFECT"), false);
  for (const name of ["infinity", "nan", "negativeZero", "infiniteLiteral"]) assert.equal(blocker(result, name), "NUMBER_NOT_JSON_EXACT");
});

test("ESM v6 rejects invalid inputs and syntax without emitting source diagnostics", () => {
  const expectCode = (run: () => unknown, code: string) => assert.throws(run, (error) => error instanceof StaticEsmConstantsError && error.code === code && error.message === code);
  expectCode(() => compile("const broken = ; // PRIVATE_SYNTAX_MARKER"), "INVALID_SOURCE");
  expectCode(() => compileStaticEsmConstants({ source: "", sourcePath: "" }), "INVALID_INPUT");
  expectCode(() => compileStaticEsmConstants({ source: "", sourcePath: "a\0b" }), "INVALID_INPUT");
  expectCode(() => compileStaticEsmConstants({ source: "", sourcePath: "x".repeat(4097) }), "INVALID_INPUT");
  for (const names of [["same", "same"], ["not a name"], ["module"], Array.from({ length: 17 }, (_, index) => `f${index}`)]) {
    expectCode(() => compile("", names), "INVALID_LOCAL_FUNCTIONS");
  }
  expectCode(() => compile("const wrongShape = () => { const local = 1; };", ["wrongShape"]), "LOCAL_FUNCTION_NOT_FOUND");
  expectCode(() => compile("", ["missing"]), "LOCAL_FUNCTION_NOT_FOUND");
});

test("ESM v6 enforces source, record, string, AST and lexical depth limits", () => {
  assert.throws(() => compile(" ".repeat(STATIC_ESM_CONSTANTS_LIMITS.sourceBytes + 1)), { code: "SOURCE_LIMIT" });
  assert.equal(compile(" ".repeat(STATIC_ESM_CONSTANTS_LIMITS.sourceBytes)).records.length, 0);
  assert.throws(() => compile(Array.from({ length: 513 }, (_, index) => `const a${index} = 1;`).join("\n")), { code: "RECORD_LIMIT" });
  assert.equal(compile(Array.from({ length: 512 }, (_, index) => `const a${index} = 1;`).join("\n")).records.length, 512);
  const long = "x".repeat(STATIC_ESM_CONSTANTS_LIMITS.stringBytes);
  assert.equal(value(compile(`const boundary = "${long}";`), "boundary"), long);
  assert.equal(blocker(compile(`const over = "${long}x";`), "over"), "STRING_LIMIT");
  assert.throws(() => compile(`const deep = ${"(".repeat(97)}1${")".repeat(97)};`), { code: "LEXICAL_DEPTH_LIMIT" });
  assert.throws(() => compile(`const run = ${"!".repeat(600)}true;`), { code: "LEXICAL_RUN_LIMIT" });
  assert.throws(() => compile(`const chain = x${".x".repeat(100)};`), { code: "AST_DEPTH_LIMIT" });
  assert.throws(() => compile(Array.from({ length: 11000 }, (_, index) => `a${index}:;`).join("\n")), (error) => error instanceof StaticEsmConstantsError && ["AST_NODE_LIMIT", "LEXICAL_TOKEN_LIMIT"].includes(error.code));
  assert.throws(() => compile("x => x;\n".repeat(6000)), { code: "AST_NODE_LIMIT" });
});

test("ESM v6 bounds amplified values, evaluation depth and total output without truncation", () => {
  const declarations = ["const a0 = [1, 1];"];
  for (let index = 1; index <= 15; index++) declarations.push(`const a${index} = [a${index - 1}, a${index - 1}];`);
  const result = compile(declarations.join("\n"));
  assert.equal(blocker(result, "a15"), "VALUE_LIMIT");
  const nested = compile(`const deep = ${"[".repeat(65)}1${"]".repeat(65)};`);
  assert.equal(blocker(nested, "deep"), "EVALUATION_DEPTH_LIMIT");
  const values = [`const base = "${"z".repeat(16_000)}";`];
  for (let index = 0; index < 100; index++) values.push(`const item${index} = base;`);
  assert.throws(() => compile(values.join("\n")), { code: "OUTPUT_LIMIT" });
  const steps = [`const base = [${Array.from({ length: 4000 }, () => "1").join(",")}];`, "const holder = { base };"];
  for (let index = 0; index < 60; index++) steps.push(`const measured${index} = holder.base;`);
  assert.throws(() => compile(steps.join("\n")), { code: "EVALUATION_STEP_LIMIT" });
});
