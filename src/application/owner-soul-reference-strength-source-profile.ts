import { isProxy } from "node:util/types";

const SOURCE_SHA256 = Object.freeze({
  app_route: "6479e7e48c5a3348c7f642203e0438e7d4fa776997959df4dc505b39bb922ac1",
  soul_form: "2a7dfc8eb1b9555b507a74a8d47f55cdfa5f77969d42fb5095ec6a2b3b42fe3d",
  settings_helper: "7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6",
  image_route: "b6f38c018a956113a9205092d99b5eedecaaa682e301053c686779eeea2f8447",
  image_sender: "5c338a208de4fbcd69d220aaa4931977a31da3390b12768968469707c4f15b5e"
} as const);

/** The only reference_strength value pinned by the inspected Soul UI source. */
export const OWNER_SOUL_REFERENCE_STRENGTH_SOURCE_VALUE = 0.7 as const;
export type OwnerSoulReferenceStrengthProfileStatus =
  | "UNRESOLVED_UNCONTROLLED_WIRE_FIELD"
  | "EXPLICIT_SOURCE_FIXED_0_7_BACKEND_UNPROVEN";

const PROFILE = Object.freeze({
  profile_id: "owner-soul-reference-strength-source-profile-v1",
  model_id: "higgsfield-soul",
  build_id: "1791904852",
  initializer_value: OWNER_SOUL_REFERENCE_STRENGTH_SOURCE_VALUE,
  request_control: Object.freeze({
    mode: "OPTIONAL_EXPLICIT_FIXED_INITIALIZER_ONLY",
    allowed_values: Object.freeze([OWNER_SOUL_REFERENCE_STRENGTH_SOURCE_VALUE]),
    omitted_behavior: "KEEP_EXISTING_SETTINGS_PAYLOAD_UNCHANGED",
    provider_acceptance: "UNPROVEN"
  }),
  visible_control: false,
  sender_semantics: "ORDINARY_SETTINGS_SPREAD_CUSTOM_PAYLOAD_REPLACES_SETTINGS",
  source_sha256: SOURCE_SHA256,
  provider_acceptance: "UNPROVEN"
} as const);

export type OwnerSoulReferenceStrengthWireProjection =
  | Readonly<{ status: "INCLUDED"; source: "APP_STORE_SETTINGS" | "CUSTOM_PAYLOAD"; value: unknown }>
  | Readonly<{ status: "OMITTED"; reason: "CUSTOM_PAYLOAD_REPLACED_SETTINGS" | "ACTIVE_SETTINGS_FIELD_ABSENT" | "UNSAFE_SETTINGS_SHAPE" }>;

export function getOwnerSoulReferenceStrengthSourceProfile() {
  return PROFILE;
}

/**
 * Projects only the Soul reference_strength field through the observed image
 * sender branch. A truthy custom payload replaces app-store settings; it is
 * not merged. This describes source behavior and does not validate provider
 * acceptance or choose a generation value.
 */
export function projectOwnerSoulReferenceStrengthWireField(input: unknown): OwnerSoulReferenceStrengthWireProjection {
  const fields = readProjectionInput(input);
  if (!fields) return Object.freeze({ status: "OMITTED", reason: "UNSAFE_SETTINGS_SHAPE" });

  const useCustomPayload = Boolean(fields.custom_setting_payload);
  const activeSettings = useCustomPayload ? fields.custom_setting_payload : fields.app_store_settings;
  if (!isPlainRecord(activeSettings)) {
    return Object.freeze({ status: "OMITTED", reason: useCustomPayload ? "CUSTOM_PAYLOAD_REPLACED_SETTINGS" : "UNSAFE_SETTINGS_SHAPE" });
  }

  const descriptor = Object.getOwnPropertyDescriptor(activeSettings, "reference_strength");
  if (!descriptor || !("value" in descriptor) || descriptor.value === undefined) {
    return Object.freeze({ status: "OMITTED", reason: useCustomPayload
      ? "CUSTOM_PAYLOAD_REPLACED_SETTINGS" : "ACTIVE_SETTINGS_FIELD_ABSENT" });
  }
  return Object.freeze({ status: "INCLUDED", source: useCustomPayload ? "CUSTOM_PAYLOAD" : "APP_STORE_SETTINGS",
    value: descriptor.value });
}

interface ProjectionInput {
  readonly app_store_settings: unknown;
  readonly custom_setting_payload: unknown;
}

function readProjectionInput(value: unknown): ProjectionInput | null {
  if (!isPlainRecord(value)) return null;
  const appSettings = Object.getOwnPropertyDescriptor(value, "app_store_settings");
  const customPayload = Object.getOwnPropertyDescriptor(value, "custom_setting_payload");
  if (!appSettings || !("value" in appSettings) || !customPayload || !("value" in customPayload)) return null;
  return { app_store_settings: appSettings.value, custom_setting_payload: customPayload.value };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
