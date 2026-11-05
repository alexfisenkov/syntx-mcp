import { OWNER_KLING_MANUAL_DURATION_CURRENT_SOURCE } from "./owner-kling-duration-current-source.js";
/** Current model/version guards, distinct from historical native profile pins. */
export const OWNER_KLING_CURRENT_MANUAL_CONTROLS = Object.freeze({
  manual_duration_source: OWNER_KLING_MANUAL_DURATION_CURRENT_SOURCE,
  status: "FORM_SOURCE_REVIEWED", build: 1793890358,
  form_sha256: "sha256:4763d9a9e3bdb5ee1361363764576e58c31000c15a899f48a21cd4fe84e1b46a",
  slider_sha256: "sha256:77bef1b40ab7d4bce97d12e360b17961467f7315c0d83d6290a2f0ee1d37ee46",
  current_versions: Object.freeze({ t2v: ["2.5", "2.6", "3.0", "3.0-turbo"],
    i2v: ["2.5", "2.6", "3.0", "3.0-turbo"], keyframes: ["2.5", "2.6", "3.0"], elements: ["3.0"] }),
  temperature: Object.freeze({ minimum: 0, maximum: 1, slider_step: 0.1, manual_quantization: "NONE" }),
  legacy_camera_panel: Object.freeze({ version: "1.5", mode: "hd", current_selector_reachable: false }),
  o1_version: "OMITTED_BY_CURRENT_MODEL_WATCHER", provider_acceptance: "UNPROVEN"
});
