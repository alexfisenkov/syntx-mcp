import type { KlingMotionControlPresetGap } from "./kling-motion-control-presets-decoder.js";

export interface OwnerKlingMotionControlPresetEntryContext {
  readonly status: "native_preset_entry";
}

export interface OwnerKlingMotionControlPresetLibraryContext {
  readonly status: "native_preset_library";
}

export interface OwnerKlingMotionControlPresetEntry {
  readonly index: number;
  readonly name: string;
  readonly availability: Readonly<{ audio: boolean; noaudio: boolean }>;
  readonly context: OwnerKlingMotionControlPresetEntryContext;
}

export interface OwnerKlingMotionControlPresetLibrary {
  readonly source_shape: "SOURCE_OBSERVED_RESPONSE_SHAPE_ONLY";
  readonly url_policy: "R2_UPLOAD_ORIGIN_ONLY_LOCAL_UNVERIFIED_FOR_PRESET_LIBRARY";
  readonly context: OwnerKlingMotionControlPresetLibraryContext;
  readonly entries: readonly OwnerKlingMotionControlPresetEntry[];
  readonly gaps: readonly KlingMotionControlPresetGap[];
}
