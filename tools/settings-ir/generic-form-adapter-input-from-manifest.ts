// Derives the non-source fields of
// BuildGenericFormParserCanaryCompilerOutputInput (build-generic-form-parser-canary.ts)
// from one form_id's entry in a census manifest
// (catalog/runtime/v2/normalized-settings-parser-census-manifest.json). This
// is one part of DEBT-012's missing manifest-verification step (critic-risk
// finding on the generic adapter, see D-037/D-038 in docs/проект/решения.md):
// the adapter itself deliberately does not know about the census manifest,
// so something has to translate a manifest form entry into the adapter's
// input shape before the adapter is ever called on a real form.
//
// What this closes: form_id/ai_name/model_ids/auxiliary_source_ref_ids
// lookup, and full manifest schema re-validation (the manifest is re-parsed
// here, not trusted by TypeScript type alone — see FAIL_CLOSED_INPUT below).
// Root-source-identity structural relationships (role, kind, disposition,
// path, self-referential id) are NOT re-checked in this file: they are
// already enforced by normalizedSettingsParserCensusManifestSchema's own
// superRefine (validateFormRelationships, normalized-settings-parser-census-manifest.ts:1037),
// which the re-parse below runs unconditionally — any manifest whose root
// source identity violates one of those relationships already fails
// CENSUS_MANIFEST_INVALID before this file's own form lookup runs.
// Verified empirically, not just by reading: tampering role, form_id,
// source_kind, disposition, source_path, or the source's own
// self-referential id each independently made
// normalizedSettingsParserCensusManifestSchema.safeParse() fail on the real
// committed manifest. Duplicating those checks here would be untestable dead
// code, not defense in depth.
//
// What this does NOT close (still open after this file):
// - DEBT-026: the returned expectedAiName/SCOPE is not cross-checked against
//   catalog/v1/official-public-api.json.
// - Fetching or hashing `source` at all. The returned `adapterInput.sourceRef`
//   is the manifest's PINNED/DECLARED expectation, not an observed fetch
//   result. Before ever calling the adapter, the caller MUST separately fetch
//   the source (e.g. fetchPinnedSettingsFormSourceMaterial in
//   pinned-settings-source-loader.ts) and verify field-by-field that the
//   fetch's javascript/source-map/content hashes equal
//   adapterInput.sourceRef's — not just the content hash, which is all the
//   adapter itself re-checks (assertSourceRelationship only compares
//   source_content_sha256 against the bytes it was actually given). Skipping
//   that comparison would let a re-bundled vendor file with an unchanged
//   settings source pass silently.
// - Any network call needs --confirm-source-fetch (D-035); check
//   adapterInput.auxiliarySourceRefIds.length === 0 BEFORE fetching, since
//   the adapter rejects non-empty auxiliary refs (13/39 forms) with
//   AUXILIARY_SOURCE_REFS_NOT_SUPPORTED anyway, and that check should not
//   cost a gated network round trip to discover.
// - A generic result artifact schema, or wiring into any CLI/script/npm
//   command. Reachable today only from this module's own tests — no real
//   catalog form has ever been compiled end-to-end through this path.
// - Zero-model forms (banana-inpaint, seedance-editor, seedream-editor):
//   rejected with FORM_HAS_NO_MODELS. See DEBT-030,
//   docs/проект/незакрыто.md — there is no accepted design yet for what a
//   form-level fact without a model to attribute it to should mean.
import {
  normalizedSettingsParserCensusManifestSchema,
  type NormalizedSettingsParserCensusManifest
} from "../../src/catalog/normalized-settings-parser-census-manifest.js";
import type { BuildGenericFormParserCanaryCompilerOutputInput } from "./build-generic-form-parser-canary.js";

export type GenericFormAdapterManifestDeriveErrorCode =
  | "CENSUS_MANIFEST_INVALID"
  | "FORM_NOT_FOUND"
  | "FORM_HAS_NO_MODELS"
  // Unreachable for any manifest that passed the schema re-parse above (see
  // header comment) — kept only because Array.prototype.find's return type
  // is T | undefined and this function must narrow it before use, not
  // because a schema-valid manifest can actually produce it.
  | "ROOT_SOURCE_IDENTITY_MISSING";

export class GenericFormAdapterManifestDeriveError extends Error {
  constructor(readonly code: GenericFormAdapterManifestDeriveErrorCode) {
    super(
      "SYNTX census manifest form entry could not be safely mapped to a generic adapter input."
    );
    this.name = "GenericFormAdapterManifestDeriveError";
  }
}

export interface GenericFormAdapterManifestDerivedInput {
  readonly rootSourceRefId: string;
  // For future C1b scope/cohort binding only — not passed to the adapter.
  // Exactly the fields build-generic-form-parser-canary.ts's parseBuildInput
  // requires via hasExactKeys; spread this object plus `source`, nothing
  // else — an extra sibling key (this interface's own rootSourceRefId
  // included) makes the adapter reject with PARSER_OUTPUT_INVALID before any
  // hashing happens, which is why it is not flattened into this same object.
  readonly adapterInput: Omit<
    BuildGenericFormParserCanaryCompilerOutputInput,
    "source"
  >;
}

/**
 * FAIL_CLOSED_INPUT: `censusManifest` is re-parsed against the full Zod
 * schema here regardless of its declared TypeScript type — the same
 * defense-in-depth already used for this exact object elsewhere (see
 * validateFullLocalPreflight in source-backed-result-toolchain.ts, which
 * re-parses its own already-typed censusManifest input). A caller that
 * bypasses loadNormalizedSettingsParserCensusManifest (e.g. a raw
 * JSON.parse of an untrusted file) gets CENSUS_MANIFEST_INVALID here instead
 * of quietly propagating unverified fields. This re-parse does not repeat
 * assertNormalizedSettingsParserCensusManifestMatchesSources's heavier
 * cross-check against publicCatalog/inventory — callers still need that, via
 * loadNormalizedSettingsParserCensusManifest, for the manifest to be trusted
 * beyond its own internal shape.
 */
export function deriveGenericFormAdapterInputFromManifest(
  censusManifest: unknown,
  formId: string
): GenericFormAdapterManifestDerivedInput {
  const parsed = normalizedSettingsParserCensusManifestSchema.safeParse(
    censusManifest
  );
  if (!parsed.success) {
    throw new GenericFormAdapterManifestDeriveError("CENSUS_MANIFEST_INVALID");
  }
  const manifest: NormalizedSettingsParserCensusManifest = parsed.data;

  const form = manifest.forms.find((entry) => entry.form_id === formId);
  if (form === undefined) {
    throw new GenericFormAdapterManifestDeriveError("FORM_NOT_FOUND");
  }
  if (form.model_ids.length === 0) {
    throw new GenericFormAdapterManifestDeriveError("FORM_HAS_NO_MODELS");
  }
  const root = manifest.source_identities.find(
    (identity) => identity.source_ref_id === form.root_source_ref_id
  );
  if (root === undefined) {
    throw new GenericFormAdapterManifestDeriveError("ROOT_SOURCE_IDENTITY_MISSING");
  }

  return {
    rootSourceRefId: form.root_source_ref_id,
    adapterInput: {
      sourceRef: {
        provider_javascript_sha256: root.module_javascript_sha256,
        provider_source_map_sha256: root.module_source_map_sha256,
        source_index: root.source_index,
        source_path: root.source_path,
        source_content_sha256: root.source_content_sha256
      },
      formId,
      expectedAiName: form.ai_name,
      modelIds: [...form.model_ids],
      auxiliarySourceRefIds: [...form.auxiliary_source_ref_ids]
    }
  };
}
