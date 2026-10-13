import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import type {
  NormalizedSettingsBlocker,
  NormalizedSettingsParserCompilerOutput,
  NormalizedSettingsProjection,
  NormalizedStaticValue,
  StaticSettingsLocator as NormalizedLocator,
  StaticSettingsSourceRef
} from "../../src/catalog/normalized-settings-parser-canary.js";
import {
  compileStaticSettingsVueSfc,
  STATIC_SETTINGS_COMPILER_LIMITS,
  type StaticSettingsBindingResult,
  type StaticSettingsBlocker,
  type StaticSettingsBlockerCode,
  type StaticSettingsCompilerResult,
  type StaticSettingsConventionBinding,
  type StaticSettingsJsonValue,
  type StaticSettingsLocator
} from "./static-settings-compiler.js";

export const BANANA_PARSER_CANARY_MODEL_IDS = [
  "banana",
  "banana2",
  "banana3",
  "banana3_light"
] as const;

const BANANA_FORM_ID = "banana";
const BANANA_AI_NAME = "banana";
const BANANA_SCOPE = "image";
const BANANA_SOURCE_PATH =
  "/src/components/chat/forms/settings/banana.vue";
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SAFE_KEY_PATTERN = /^[A-Za-z0-9._-]{1,160}$/u;
const FORBIDDEN_STATIC_KEYS = new Set([
  "__proto__",
  "access_token",
  "authorization",
  "code",
  "constructor",
  "cookie",
  "map",
  "password",
  "private_key",
  "prototype",
  "raw",
  "raw_source",
  "refresh_token",
  "secret",
  "snippet",
  "source",
  "source_map",
  "sourcesContent",
  "token"
]);
const SECRET_LIKE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~-]{16,}/iu,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]/iu,
  /\b(?:ghp|github_pat|sk|xox[baprs])[-_][A-Za-z0-9_-]{16,}/u,
  /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/u
] as const;

type FormProjectionName =
  | "defaults"
  | "controls"
  | "conditional_rules"
  | "watch_rules"
  | "computed_rules"
  | "payload_projection";

type CompilerResultTuple = readonly [
  StaticSettingsCompilerResult,
  StaticSettingsCompilerResult,
  StaticSettingsCompilerResult,
  StaticSettingsCompilerResult
];

type StaticFact = Extract<
  NormalizedSettingsProjection,
  { status: "PROVEN" }
>["facts"][number];

export type BananaParserCanaryCompilerErrorCode =
  | "PARSER_OUTPUT_INVALID"
  | "SOURCE_RELATIONSHIP_INVALID";

export class BananaParserCanaryCompilerError extends Error {
  constructor(readonly code: BananaParserCanaryCompilerErrorCode) {
    super("SYNTX Banana settings source could not be adapted safely.");
    this.name = "BananaParserCanaryCompilerError";
  }
}

export interface BuildBananaParserCanaryCompilerOutputInput {
  source: string | Uint8Array;
  sourceRef: StaticSettingsSourceRef;
}

/**
 * Compiles one hash-pinned Banana SFC four times, once for each exact canary
 * model. The adapter never executes vendor code, resolves imports, emits code,
 * or persists the input source.
 */
export function buildBananaParserCanaryCompilerOutput(
  input: BuildBananaParserCanaryCompilerOutputInput
): NormalizedSettingsParserCompilerOutput {
  try {
    return buildBananaParserCanaryCompilerOutputUnchecked(input);
  } catch (error) {
    if (error instanceof BananaParserCanaryCompilerError) throw error;
    throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
  }
}

function buildBananaParserCanaryCompilerOutputUnchecked(
  inputValue: unknown
): NormalizedSettingsParserCompilerOutput {
  const input = parseBuildInput(inputValue);
  assertSourceRelationship(input.source, input.sourceRef);

  const results = BANANA_PARSER_CANARY_MODEL_IDS.map((modelId) =>
    compileStaticSettingsVueSfc({ source: input.source, modelId })
  ) as unknown as CompilerResultTuple;
  assertCompilerEnvelope(results, input.source, input.sourceRef);

  const blockers: NormalizedSettingsBlocker[] = [];
  const projections = {
    defaults: buildBindingProjection({
      results,
      sourceRef: input.sourceRef,
      target: "defaults",
      binding: "defaultSettings",
      blockerProjections: ["defaultSettings"],
      candidateBindings: ["defaultSettings"],
      blockers
    }),
    controls: buildBindingProjection({
      results,
      sourceRef: input.sourceRef,
      target: "controls",
      binding: "controls",
      blockerProjections: [
        "controls",
        "settingsGroups",
        "template_control_flow"
      ],
      candidateBindings: ["controls", "settingsGroups"],
      blockers,
      absenceProofAllowed: false
    }),
    conditional_rules: buildBindingProjection({
      results,
      sourceRef: input.sourceRef,
      target: "conditional_rules",
      binding: "conditionalRules",
      blockerProjections: ["conditionalRules", "template_control_flow"],
      candidateBindings: ["conditionalRules"],
      blockers,
      absenceProofAllowed: false
    }),
    watch_rules: buildDetectionProjection({
      results,
      sourceRef: input.sourceRef,
      target: "watch_rules",
      compilerProjection: "watch_rules",
      detection: "watch_calls",
      blockers
    }),
    computed_rules: buildDetectionProjection({
      results,
      sourceRef: input.sourceRef,
      target: "computed_rules",
      compilerProjection: "computed_rules",
      detection: "computed_calls",
      blockers
    }),
    payload_projection: { status: "BLOCKED" }
  } satisfies Record<FormProjectionName, NormalizedSettingsProjection>;

  blockers.push(
    {
      code: "BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED",
      projection: "payload_projection",
      locator: null
    },
    {
      code: "PAYLOAD_PROJECTION_UNVERIFIED",
      projection: "payload_projection",
      locator: null
    }
  );

  return {
    parser_profile: "STATIC_SETTINGS_V1",
    engine: {
      name: "typescript",
      version: ts.version,
      implementation_sha256: hashLoadedCompilerImplementation(),
      execution_mode: "SYNTAX_ONLY_NO_VENDOR_EXECUTION",
      type_checking: false,
      emit: false,
      import_resolution: false
    },
    forms: [
      {
        form_id: BANANA_FORM_ID,
        source_ref: input.sourceRef,
        projections,
        blockers: sortAndDedupeNormalizedBlockers(blockers)
      }
    ]
  };
}

function parseBuildInput(
  input: unknown
): BuildBananaParserCanaryCompilerOutputInput {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["source", "sourceRef"])) {
    throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
  }
  const source = input.source;
  if (typeof source === "string") {
    if (
      source.length > STATIC_SETTINGS_COMPILER_LIMITS.maxSourceBytes ||
      new TextEncoder().encode(source).byteLength >
        STATIC_SETTINGS_COMPILER_LIMITS.maxSourceBytes
    ) {
      throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
    }
  } else if (
    !(source instanceof Uint8Array) ||
    source.byteLength > STATIC_SETTINGS_COMPILER_LIMITS.maxSourceBytes
  ) {
    throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
  }

  const sourceRefValue = input.sourceRef;
  if (
    !isPlainRecord(sourceRefValue) ||
    !hasExactKeys(sourceRefValue, [
      "provider_javascript_sha256",
      "provider_source_map_sha256",
      "source_content_sha256",
      "source_index",
      "source_path"
    ]) ||
    typeof sourceRefValue.provider_javascript_sha256 !== "string" ||
    typeof sourceRefValue.provider_source_map_sha256 !== "string" ||
    typeof sourceRefValue.source_content_sha256 !== "string" ||
    typeof sourceRefValue.source_index !== "number" ||
    typeof sourceRefValue.source_path !== "string"
  ) {
    throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
  }
  return {
    source,
    sourceRef: {
      provider_javascript_sha256:
        sourceRefValue.provider_javascript_sha256,
      provider_source_map_sha256:
        sourceRefValue.provider_source_map_sha256,
      source_content_sha256: sourceRefValue.source_content_sha256,
      source_index: sourceRefValue.source_index,
      source_path: sourceRefValue.source_path
    }
  };
}

function hashLoadedCompilerImplementation(): string {
  try {
    const implementations = [
      ["adapter", readFileSync(new URL(import.meta.url))],
      [
        "static-compiler",
        readFileSync(new URL("./static-settings-compiler.js", import.meta.url))
      ]
    ] as const;
    const hash = createHash("sha256");
    for (const [name, bytes] of implementations) {
      hash.update(`${name}\u0000${bytes.byteLength}\u0000`, "utf8");
      hash.update(bytes);
    }
    return `sha256:${hash.digest("hex")}`;
  } catch {
    throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
  }
}

function assertSourceRelationship(
  source: string | Uint8Array,
  sourceRef: StaticSettingsSourceRef
): void {
  if (
    sourceRef.source_path !== BANANA_SOURCE_PATH ||
    !Number.isSafeInteger(sourceRef.source_index) ||
    sourceRef.source_index < 0 ||
    !SHA256_PATTERN.test(sourceRef.provider_javascript_sha256) ||
    !SHA256_PATTERN.test(sourceRef.provider_source_map_sha256) ||
    !SHA256_PATTERN.test(sourceRef.source_content_sha256) ||
    sha256Source(source) !== sourceRef.source_content_sha256
  ) {
    throw new BananaParserCanaryCompilerError("SOURCE_RELATIONSHIP_INVALID");
  }
}

function assertCompilerEnvelope(
  results: CompilerResultTuple,
  source: string | Uint8Array,
  sourceRef: StaticSettingsSourceRef
): void {
  const expectedBytes =
    typeof source === "string"
      ? new TextEncoder().encode(source).byteLength
      : source.byteLength;
  const firstMetrics = stableStringify(results[0].metrics);
  let scopeLocator: StaticSettingsLocator | undefined;
  let aiNameLocator: StaticSettingsLocator | undefined;

  for (const [index, result] of results.entries()) {
    if (
      result.schema_version !== "1.0.0" ||
      result.parser_profile !== "STATIC_SETTINGS_V1" ||
      result.model_id !== BANANA_PARSER_CANARY_MODEL_IDS[index] ||
      result.vendor_code_executed !== false ||
      result.source_persisted !== false ||
      result.metrics.source_bytes !== expectedBytes ||
      stableStringify(result.metrics) !== firstMetrics
    ) {
      throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
    }
    const observedScope = requireIdentityBinding(result, "SCOPE", BANANA_SCOPE);
    const observedAiName = requireIdentityBinding(
      result,
      "AI_NAME",
      BANANA_AI_NAME
    );
    scopeLocator ??= observedScope;
    aiNameLocator ??= observedAiName;
    if (
      stableStringify(scopeLocator) !== stableStringify(observedScope) ||
      stableStringify(aiNameLocator) !== stableStringify(observedAiName)
    ) {
      throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
    }
  }

  if (
    sourceRef.source_index < 0 ||
    scopeLocator === undefined ||
    aiNameLocator === undefined
  ) {
    throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
  }
}

function requireIdentityBinding(
  result: StaticSettingsCompilerResult,
  binding: "SCOPE" | "AI_NAME",
  expectedValue: string
): StaticSettingsLocator {
  const observed = result.bindings[binding];
  if (observed.status !== "PROVEN" || observed.value !== expectedValue) {
    throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
  }
  return observed.locator;
}

interface BuildBindingProjectionInput {
  results: CompilerResultTuple;
  sourceRef: StaticSettingsSourceRef;
  target: FormProjectionName;
  binding: StaticSettingsConventionBinding;
  blockerProjections: readonly StaticSettingsBlocker["projection"][];
  candidateBindings: readonly StaticSettingsConventionBinding[];
  blockers: NormalizedSettingsBlocker[];
  absenceProofAllowed?: boolean;
}

function buildBindingProjection(
  input: BuildBindingProjectionInput
): NormalizedSettingsProjection {
  assertBlockedBindingConsistency(input.results, input.binding);
  const relevantBlockers = collectMappedBlockers(
    input.results,
    input.sourceRef,
    input.target,
    input.blockerProjections
  );
  const allComplete = input.results.every(
    (result) => result.compilation_status === "COMPLETE"
  );
  const bindings = input.results.map((result) => result.bindings[input.binding]);
  const allProven = bindings.every(
    (binding): binding is Extract<StaticSettingsBindingResult, { status: "PROVEN" }> =>
      binding.status === "PROVEN"
  );
  const allAbsent = bindings.every((binding) => binding.status === "ABSENT_PROVEN");
  const firstBinding = bindings[0];

  if (
    allComplete &&
    relevantBlockers.length === 0 &&
    allProven &&
    firstBinding?.status === "PROVEN" &&
    allBindingsEqual(bindings)
  ) {
    return {
      status: "PROVEN",
      proof_scope: "STATIC_LITERAL_TREE_ONLY",
      facts: factsFromBinding(
        firstBinding.value,
        firstBinding.locator,
        input.sourceRef,
        input.target
      )
    };
  }
  if (
    allComplete &&
    relevantBlockers.length === 0 &&
    allAbsent &&
    input.absenceProofAllowed !== false
  ) {
    return {
      status: "ABSENT_PROVEN",
      proof_scope: "NO_RELEVANT_STATIC_CONSTRUCT_WITHIN_COMPILER_PROFILE"
    };
  }

  if (relevantBlockers.length === 0) {
    relevantBlockers.push(genericLocalBlocker(input.target, input.sourceRef));
  }
  input.blockers.push(...relevantBlockers);
  const candidates = intersectCandidateFacts(
    input.results,
    input.candidateBindings,
    input.sourceRef,
    input.target
  );
  return candidates.length === 0
    ? { status: "BLOCKED" }
    : {
        status: "BLOCKED",
        proof_scope: "STATIC_CANDIDATES_ONLY_NOT_RUNTIME_SEMANTICS",
        static_candidates: candidates
      };
}

interface BuildDetectionProjectionInput {
  results: CompilerResultTuple;
  sourceRef: StaticSettingsSourceRef;
  target: "computed_rules" | "watch_rules";
  compilerProjection: "computed_rules" | "watch_rules";
  detection: "computed_calls" | "watch_calls";
  blockers: NormalizedSettingsBlocker[];
}

function buildDetectionProjection(
  input: BuildDetectionProjectionInput
): NormalizedSettingsProjection {
  const mapped = collectMappedBlockers(
    input.results,
    input.sourceRef,
    input.target,
    [input.compilerProjection]
  );
  const allComplete = input.results.every(
    (result) => result.compilation_status === "COMPLETE"
  );
  const detectionsEmpty = input.results.every(
    (result) => result.detections[input.detection].length === 0
  );
  if (allComplete && detectionsEmpty && mapped.length === 0) {
    return {
      status: "ABSENT_PROVEN",
      proof_scope: "NO_RELEVANT_STATIC_CONSTRUCT_WITHIN_COMPILER_PROFILE"
    };
  }
  if (mapped.length === 0) {
    mapped.push(genericLocalBlocker(input.target, input.sourceRef));
  }
  input.blockers.push(...mapped);
  return { status: "BLOCKED" };
}

function assertBlockedBindingConsistency(
  results: CompilerResultTuple,
  binding: StaticSettingsConventionBinding
): void {
  for (const result of results) {
    const observed = result.bindings[binding];
    if (observed.status !== "BLOCKED") continue;
    for (const code of observed.blocker_codes) {
      if (
        !result.blockers.some(
          (blocker) => blocker.projection === binding && blocker.code === code
        )
      ) {
        throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
      }
    }
    if (
      observed.candidates !== undefined &&
      observed.candidates_locator === undefined
    ) {
      throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
    }
  }
}

function allBindingsEqual(
  bindings: readonly Extract<
    StaticSettingsBindingResult,
    { status: "PROVEN" }
  >[]
): boolean {
  const first = stableStringify(bindings[0]);
  return bindings.every((binding) => stableStringify(binding) === first);
}

function intersectCandidateFacts(
  results: CompilerResultTuple,
  bindings: readonly StaticSettingsConventionBinding[],
  sourceRef: StaticSettingsSourceRef,
  target: FormProjectionName
): StaticFact[] {
  const perResult = results.map((result) => {
    const facts: StaticFact[] = [];
    for (const bindingName of bindings) {
      const binding = result.bindings[bindingName];
      if (binding.status === "PROVEN") {
        facts.push(
          ...factsFromBinding(
            binding.value,
            binding.locator,
            sourceRef,
            target
          )
        );
      } else if (
        binding.status === "BLOCKED" &&
        binding.candidates !== undefined &&
        binding.candidates_locator !== undefined
      ) {
        facts.push(
          ...factsFromBinding(
            binding.candidates,
            binding.candidates_locator,
            sourceRef,
            target
          )
        );
      }
    }
    return new Map(
      sortAndDedupeFacts(facts).map((fact) => [staticFactIdentity(fact), fact])
    );
  });
  const first = perResult[0];
  if (first === undefined) {
    throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
  }
  return sortAndDedupeFacts(
    [...first.entries()]
      .filter(([key]) => perResult.slice(1).every((facts) => facts.has(key)))
      .map(([, fact]) => fact)
  );
}

function factsFromBinding(
  value: StaticSettingsJsonValue,
  locator: StaticSettingsLocator,
  sourceRef: StaticSettingsSourceRef,
  fallbackRoot: string
): StaticFact[] {
  const normalizedLocator = fullLocator(locator, sourceRef);
  const facts: StaticFact[] = [];
  flattenStaticValue(value, [], fallbackRoot, normalizedLocator, facts);
  if (facts.length === 0) {
    throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
  }
  return sortAndDedupeFacts(facts);
}

function flattenStaticValue(
  value: StaticSettingsJsonValue,
  path: string[],
  fallbackRoot: string,
  locator: NormalizedLocator,
  facts: StaticFact[]
): void {
  assertSafeStaticValue(value, path.length);
  if (isPlainStaticObject(value) && Object.keys(value).length > 0) {
    for (const key of Object.keys(value).sort(compareText)) {
      flattenStaticValue(value[key]!, [...path, key], fallbackRoot, locator, facts);
    }
    return;
  }
  facts.push({
    path: path.length === 0 ? [fallbackRoot] : path,
    value: canonicalizeStaticValue(value),
    locator
  });
}

function assertSafeStaticValue(
  value: StaticSettingsJsonValue,
  depth: number
): void {
  if (depth > 32) {
    throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
  }
  if (typeof value === "string") {
    if (
      value.length > 2_048 ||
      value.includes("\r") ||
      value.includes("\n") ||
      SECRET_LIKE_PATTERNS.some((pattern) => pattern.test(value))
    ) {
      throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
    }
    return;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
  }
  if (Array.isArray(value)) {
    if (value.length > 2_048) {
      throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
    }
    for (const item of value) assertSafeStaticValue(item, depth + 1);
    return;
  }
  if (isPlainStaticObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > 512) {
      throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
    }
    for (const key of keys) {
      if (
        !SAFE_KEY_PATTERN.test(key) ||
        FORBIDDEN_STATIC_KEYS.has(key)
      ) {
        throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
      }
      assertSafeStaticValue(value[key]!, depth + 1);
    }
  }
}

function canonicalizeStaticValue(
  value: StaticSettingsJsonValue
): NormalizedStaticValue {
  if (Array.isArray(value)) {
    return value.map(canonicalizeStaticValue);
  }
  if (isPlainStaticObject(value)) {
    const output: Record<string, NormalizedStaticValue> = {};
    for (const key of Object.keys(value).sort(compareText)) {
      Object.defineProperty(output, key, {
        value: canonicalizeStaticValue(value[key]!),
        enumerable: true,
        configurable: false,
        writable: false
      });
    }
    return output;
  }
  return value;
}

function isPlainStaticObject(
  value: StaticSettingsJsonValue
): value is { [key: string]: StaticSettingsJsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectMappedBlockers(
  results: CompilerResultTuple,
  sourceRef: StaticSettingsSourceRef,
  target: FormProjectionName,
  compilerProjections: readonly StaticSettingsBlocker["projection"][]
): NormalizedSettingsBlocker[] {
  const accepted = new Set(compilerProjections);
  const blockers = results.flatMap((result) =>
    result.blockers
      .filter((blocker) => accepted.has(blocker.projection))
      .map((blocker) => ({
        code: mapBlockerCode(blocker.code, target),
        projection: target,
        locator: fullLocator(blocker, sourceRef)
      }) satisfies NormalizedSettingsBlocker)
  );
  return sortAndDedupeNormalizedBlockers(blockers);
}

function mapBlockerCode(
  code: StaticSettingsBlockerCode,
  target: FormProjectionName
): Exclude<NormalizedSettingsBlocker, { locator: null }>["code"] {
  if (code === "CALL_EXPRESSION_NOT_INTERPRETED") return code;
  if (code === "DYNAMIC_MEMBER_ACCESS_NOT_INTERPRETED") return code;
  if (code === "COMPUTED_RULE_NOT_INTERPRETED") {
    return target === "computed_rules"
      ? code
      : "SOURCE_PATTERN_NOT_RECOGNIZED";
  }
  if (code === "WATCH_RULE_NOT_INTERPRETED") {
    return target === "watch_rules"
      ? code
      : "SOURCE_PATTERN_NOT_RECOGNIZED";
  }
  if (
    code === "TEMPLATE_CONTROL_FLOW_NOT_COMPILED" &&
    (target === "controls" || target === "conditional_rules")
  ) {
    return code;
  }
  return "SOURCE_PATTERN_NOT_RECOGNIZED";
}

function genericLocalBlocker(
  projection: FormProjectionName,
  sourceRef: StaticSettingsSourceRef
): NormalizedSettingsBlocker {
  return {
    code: "SOURCE_PATTERN_NOT_RECOGNIZED",
    projection,
    locator: {
      source_index: sourceRef.source_index,
      source_path: sourceRef.source_path,
      source_content_sha256: sourceRef.source_content_sha256,
      line: 1,
      column: 1,
      node_kind: "SourceFile"
    }
  };
}

function fullLocator(
  locator: StaticSettingsLocator,
  sourceRef: StaticSettingsSourceRef
): NormalizedLocator {
  if (
    !Number.isSafeInteger(locator.line) ||
    locator.line < 1 ||
    !Number.isSafeInteger(locator.column) ||
    locator.column < 1 ||
    !SAFE_KEY_PATTERN.test(locator.node_kind)
  ) {
    throw new BananaParserCanaryCompilerError("PARSER_OUTPUT_INVALID");
  }
  return {
    source_index: sourceRef.source_index,
    source_path: sourceRef.source_path,
    source_content_sha256: sourceRef.source_content_sha256,
    line: locator.line,
    column: locator.column,
    node_kind: locator.node_kind
  };
}

function sortAndDedupeFacts(facts: readonly StaticFact[]): StaticFact[] {
  const byIdentity = new Map<string, StaticFact>();
  for (const fact of facts) byIdentity.set(staticFactIdentity(fact), fact);
  return [...byIdentity.values()].sort((left, right) =>
    compareText(staticFactSortKey(left), staticFactSortKey(right))
  );
}

function staticFactIdentity(fact: StaticFact): string {
  return `${staticFactSortKey(fact)}\u0000${stableStringify(fact.value)}`;
}

function staticFactSortKey(fact: StaticFact): string {
  return [
    JSON.stringify(fact.path),
    fact.locator.line.toString().padStart(10, "0"),
    fact.locator.column.toString().padStart(10, "0")
  ].join("\u0000");
}

function sortAndDedupeNormalizedBlockers(
  blockers: readonly NormalizedSettingsBlocker[]
): NormalizedSettingsBlocker[] {
  const byKey = new Map<string, NormalizedSettingsBlocker>();
  for (const blocker of blockers) byKey.set(normalizedBlockerKey(blocker), blocker);
  return [...byKey.values()].sort((left, right) =>
    compareText(normalizedBlockerKey(left), normalizedBlockerKey(right))
  );
}

function normalizedBlockerKey(blocker: NormalizedSettingsBlocker): string {
  const locator = blocker.locator;
  return [
    blocker.projection,
    blocker.code,
    locator?.source_path ?? "",
    locator?.source_index.toString().padStart(10, "0") ?? "",
    locator?.line.toString().padStart(10, "0") ?? "",
    locator?.column.toString().padStart(10, "0") ?? "",
    locator?.node_kind ?? ""
  ].join("\u0000");
}

function sha256Source(source: string | Uint8Array): string {
  const hash = createHash("sha256");
  if (typeof source === "string") hash.update(source, "utf8");
  else hash.update(source);
  return `sha256:${hash.digest("hex")}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort(compareText);
  const expected = [...expectedKeys].sort(compareText);
  return stableStringify(actual) === stableStringify(expected);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
