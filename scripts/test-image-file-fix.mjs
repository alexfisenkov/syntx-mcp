#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const affectedSuites = [
  "canonical-base64.test.js",
  "owner-banana-inpaint-auxiliary-input-validator.test.js",
  "owner-elevenlabs-sts-tools-1457.test.js",
  "owner-flux-image-tools.test.js",
  "owner-flux3-video-generation-service-2018.test.js",
  "owner-grok-i2v-tools2284.test.js",
  "owner-grok-t2i-image-tools.test.js",
  "owner-grok-v2v-tools-2065.test.js",
  "owner-hailuo02-i2v-tools-1504.test.js",
  "owner-ideogram-image-input.test.js",
  "owner-image-reference-input-validator.test.js",
  "owner-kling-i2v-input-policy.test.js",
  "owner-kling-i2v-tools.test.js",
  "owner-kling-keyframes-generation-mcp-runtime-1596.test.js",
  "owner-kling-keyframes-generation-service-1595.test.js",
  "owner-kling-keyframes-image-policy-1573.test.js",
  "owner-kling-keyframes-input-mcp-runtime-1582.test.js",
  "owner-kling-keyframes-one-shot-policy-1590.test.js",
  "owner-kling-keyframes-reference-service-1581.test.js",
  "owner-kling-motion-control-generation-mcp-runtime-1631.test.js",
  "owner-kling-motion-control-generation-service-1628.test.js",
  "owner-kling-motion-control-image-policy-1607.test.js",
  "owner-kling-motion-control-preset-reference-service-1623.test.js",
  "owner-kling-motion-control-reference-service-1616.test.js",
  "owner-kling-motion-control-runtime-1630.test.js",
  "owner-kling4-tools-2146.test.js",
  "owner-kontext-image-tools.test.js",
  "owner-magnific-upscale-tools.test.js",
  "owner-runway-flux-image-input-validator.test.js",
  "owner-runway-i2v-tools2262.test.js",
  "owner-runway-image-tools.test.js",
  "owner-seedream-editor-image-tools.test.js",
  "owner-seedream-editor-original-validator.test.js",
  "owner-seedream-image-input-validator.test.js",
  "owner-seedream-image-tools.test.js",
  "owner-standard-image-aux-input-validator.test.js",
  "owner-standard-image-input-validator.test.js",
  "owner-standard-image-tools.test.js",
  "owner-topaz-astra-tools-1487.test.js",
  "owner-topaz-enhance-generation-service-1986.test.js",
  "owner-topaz-enhance-original-reference-service-1980.test.js",
  "owner-veo-omni-reference-tools-2112.test.js",
  "owner-video2audio-generation-service.test.js",
  "owner-video2audio-original-reference-service.test.js",
  "owner-video2audio-runtime-composition.test.js",
  "owner-wan-image-tools.test.js",
  "owner-wan25-i2v-image-policy-1677.test.js",
  "owner-wan25-i2v-preview-tools-1690.test.js",
  "owner-wan26-i2v-generation-mcp-runtime-1665.test.js",
  "owner-wan26-i2v-generation-service-1661.test.js",
  "owner-wan26-i2v-image-policy-1649.test.js",
  "owner-wan26-i2v-reference-service-1655.test.js",
  "owner-wan26-i2v-runtime-mcp-1663.test.js",
  "owner-wan26-r2v-image-policy-1725.test.js",
  "owner-wan26-r2v-runtime-1769.test.js",
  "owner-wan27-r2v-reference-service-1534.test.js",
  "owner-wan27-r2v-reference-upload-service-1557.test.js",
  "owner-wan27-videoedit-tools-2173.test.js",
  "owner-wan30-edit-generation-service.test.js",
  "owner-wan30-first-last-generation-service-1828.test.js",
  "owner-wan30-omni-generation-service.test.js",
  "owner-wan30-reference-generation-service.test.js",
  "upload-file-tool-v2.test.js"
];

const additionalSuites = [
  "chatgpt-image-file-resolver.test.js",
  "owner-standard-image-upload-service.test.js",
  "standard-image-reference-preparation.test.js",
  "owner-local-image-file-service.test.js",
  "owner-local-image-file-tool.test.js",
  "owner-standard-image-runtime-composition.test.js",
  "owner-wan30-zbase64-schema.test.js",
  "syntx-chat-http-client-standard-image-result.test.js",
  "image-artifact-content.test.js",
  "owner-generate-image-tool.test.js",
  "owner-banana-inpaint-image-tools.test.js",
  "owner-grok-image-reference-tools.test.js",
  "owner-ideogram-image-tools.test.js",
  "owner-seedream-editor-image-tools.test.js",
  "owner-soul-image-tools.test.js",
  "owner-uni-image-tools.test.js",
  "owner-wan-image-tools.test.js"
];

const uniqueSuites = [...new Set([...affectedSuites, ...additionalSuites])];
for (const [alias, sharedPath] of [
  ["SYNTX_MCV_TEST_FFMPEG", "SYNTX_MEDIA_FFMPEG_PATH"],
  ["SYNTX_MCV_TEST_FFPROBE", "SYNTX_MEDIA_FFPROBE_PATH"],
  ["SYNTX_WAN26_I2V_TEST_FFMPEG", "SYNTX_MEDIA_FFMPEG_PATH"],
  ["SYNTX_WAN26_I2V_TEST_FFPROBE", "SYNTX_MEDIA_FFPROBE_PATH"]
]) {
  if (process.env[alias] === undefined && process.env[sharedPath] !== undefined) {
    process.env[alias] = process.env[sharedPath];
  }
}

const run = (args) => spawnSync(process.execPath, args, { stdio: "inherit" });
const suiteResult = run(["--test", "--test-concurrency=1", ...uniqueSuites.map((name) => `dist/tests/${name}`)]);
if (suiteResult.error) throw suiteResult.error;
if (suiteResult.status !== 0) process.exit(suiteResult.status ?? 1);

for (const args of [
  ["--test", "--test-name-pattern=allowlisted media guides|exports only the exact committed", "tests/export-public-snapshot.test.mjs"],
  ["--test", "--test-name-pattern=public static-runtime scope accepts", "tests/public-source-package-manifest.test.mjs"],
  ["--test", "tests/print-media-mcp-config.test.mjs", "tests/print-chatgpt-tunnel-config.test.mjs"]
]) {
  const result = run(args);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
