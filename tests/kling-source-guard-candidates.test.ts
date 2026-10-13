import assert from "node:assert/strict";
import test from "node:test";
import { analyzeKlingSourceGuardAst } from "../tools/kling-source-guard-candidates.js";

test("Kling AST evidence is a structural, position-free tree for the guard function", () => {
  const source = `const normalize = (x) => { const ids = ["kling_elements", "kling_image2video", "kling_keyframes", "kling_motion_control", "kling_o1_image2video", "kling_o1_text2video", "kling_o1_video2video", "kling_text2video"]; const fields = ["version", "mode", "gen_type", "video_duration", "standart", "hd", "mcv", "multi_shots", "camera_movement"]; if (x.model_type === "kling_o1_video2video") { x.version = undefined; } return [x, ids, fields]; }; const validate = (x) => (x.model_type === "kling_o1_video2video" || x.model_type === "kling_o1_image2video") && x.video_duration >= 3;`;
  const result = analyzeKlingSourceGuardAst(source);
  assert.equal(result.parse_diagnostics, 0);
  assert.equal(JSON.stringify(result.normalizer_ast).length > 0, true);
  assert.equal(JSON.stringify(result.normalizer_ast).includes("kling_o1_video2video"), true);
  assert.equal(JSON.stringify(result.normalizer_ast).includes("version"), true);
  assert.equal(JSON.stringify(result.normalizer_ast).includes("kling_elements"), true);
  assert.equal("start" in result, false);
});
