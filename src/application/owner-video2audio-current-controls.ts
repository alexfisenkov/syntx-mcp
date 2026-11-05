/** Current public form facts; separate from the historical sealed upload/model-access profile. */
export const OWNER_VIDEO2AUDIO_CURRENT_CONTROLS = Object.freeze({
  public_catalog_version: "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json",
  settings_inventory_version: "sha256-4da7d12483291bb632aa21e0deb220142994fe061999d2f246318276964fa187.json",
  build_id: "1793890358",
  form_sha256: "sha256:24a75b336847f0c81d4a161b8b4b967e8cbe4d63f31662a80380b34280726943",
  random_seed_module_sha256: "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b",
  seed: Object.freeze({ minimum: 0, maximum: 2147483647, integer: true, explicit_zero: "ZERO_WIRE_PRESERVED_RANDOM_VIEW_ONLY", explicit_null: "RANDOM_NULL", omitted: "LEGACY_ZERO_COMPATIBILITY", ui_initializer: 0 }),
  negative_prompt: Object.freeze({ ui_control: "TEXTAREA", ui_maximum: "UNSPECIFIED", local_maximum_utf16: 5000, omitted: "LEGACY_EMPTY_STRING", ui_initializer: "" }),
  effective_saved_ui_defaults: "NOT_INFERRED_FROM_FORM_INITIALIZER",
  provider_acceptance: "UNPROVEN"
} as const);
export interface OwnerVideo2AudioCurrentControls { readonly seed: number | null; readonly negative_prompt: string; }
export class OwnerVideo2AudioCurrentControlsError extends Error {
  readonly code = "INVALID_CONTROLS";
  constructor() { super("Video2Audio controls are invalid."); this.name = "OwnerVideo2AudioCurrentControlsError"; }
}
/** Zero remains wire0. RandomSeed's switch emits null; its view predicate alone does not rewrite zero. */
export function normalizeOwnerVideo2AudioCurrentControls(seed: unknown, negativePrompt: unknown): OwnerVideo2AudioCurrentControls {
  if (seed !== undefined && seed !== null && (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0 || seed > OWNER_VIDEO2AUDIO_CURRENT_CONTROLS.seed.maximum)) invalid();
  const negative = negativePrompt === undefined ? "" : negativePrompt;
  if (typeof negative !== "string" || negative.length > 5000 || !wellFormed(negative) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(negative)) invalid();
  return Object.freeze({ seed: seed === undefined ? 0 : seed as number | null, negative_prompt: negative });
}
function invalid(): never { throw new OwnerVideo2AudioCurrentControlsError(); }
function wellFormed(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return false; }
    else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}
