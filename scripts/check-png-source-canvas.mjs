import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const PLAYWRIGHT_OVERRIDE = process.env.SYNTX_PNG_PLAYWRIGHT_MODULE;
const CHROME_EXECUTABLE = process.env.SYNTX_PNG_CHROME_EXECUTABLE ??
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);
const inspectorModuleUrl = process.env.SYNTX_PNG_INSPECTOR_MODULE
  ? pathToFileURL(process.env.SYNTX_PNG_INSPECTOR_MODULE).href
  : new URL("../dist/src/application/owner-png-alpha-inspector.js", import.meta.url).href;
const { inspectOwnerPngSourceCanvasAlpha } = await import(inspectorModuleUrl);
const { chromium } = await loadPlaywright();
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = makeCrcTable();

function makeCrcTable() {
  return Array.from({ length: 256 }, (_, value) => {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb8_8320 : crc >>> 1;
    return crc >>> 0;
  });
}

function crc32(bytes) {
  let crc = 0xffff_ffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function png(width, height, bitDepth, colorType, scanlines, interlace = 0, beforeIdat = []) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = colorType;
  header[12] = interlace;
  return Buffer.concat([
    SIGNATURE,
    pngChunk("IHDR", header),
    ...beforeIdat.map(({ type, data }) => pngChunk(type, data)),
    pngChunk("IDAT", deflateSync(Buffer.from(scanlines))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function rgba8(width, height, transparentCoordinates = []) {
  const transparent = new Set(transparentCoordinates.map(([x, y]) => `${x},${y}`));
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0);
    for (let x = 0; x < width; x += 1) rows.push(20, 40, 60, transparent.has(`${x},${y}`) ? 0 : 255);
  }
  return png(width, height, 8, 6, rows);
}

function rgba16(alphas) {
  const row = [0];
  for (const alpha of alphas) row.push(0, 1, 0, 2, 0, 3, alpha >> 8, alpha & 0xff);
  return png(alphas.length, 1, 16, 6, row);
}

function grayscale8Transparency() {
  return png(1, 1, 8, 0, [0, 0x7f], 0, [{ type: "tRNS", data: Buffer.from([0, 0x7f]) }]);
}

function rgb8Transparency() {
  return png(1, 1, 8, 2, [0, 10, 20, 30], 0, [{ type: "tRNS", data: Buffer.from([0, 10, 0, 20, 0, 30]) }]);
}

function palette1Transparency() {
  return png(1, 1, 1, 3, [0, 0x80], 0, [
    { type: "PLTE", data: Buffer.from([0, 0, 0, 255, 255, 255]) },
    { type: "tRNS", data: Buffer.from([255, 0]) }
  ]);
}

function grayAlpha8() {
  return png(1, 1, 8, 4, [0, 90, 254]);
}

function adam7Rgba8() {
  const width = 5;
  const height = 5;
  const pixels = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => [
    20 + x, 40 + y, 60, x === 4 && y === 2 ? 0 : 255
  ]));
  const starts = [[0, 0], [4, 0], [0, 4], [2, 0], [0, 2], [1, 0], [0, 1]];
  const steps = [[8, 8], [8, 8], [4, 8], [4, 4], [2, 4], [2, 2], [1, 2]];
  const scanlines = [];
  for (let pass = 0; pass < starts.length; pass += 1) {
    const [xStart, yStart] = starts[pass];
    const [xStep, yStep] = steps[pass];
    for (let y = yStart; y < height; y += yStep) {
      scanlines.push(0);
      for (let x = xStart; x < width; x += xStep) scanlines.push(...pixels[y][x]);
    }
  }
  return png(width, height, 8, 6, scanlines, 1);
}

const fixtures = [
  { id: "rgba8-left-unsampled", bytes: rgba8(2_049, 1, [[0, 0]]), expected: { width: 1_024, height: 1, transparent: false } },
  { id: "rgba8-first-sampled", bytes: rgba8(2_049, 1, [[1, 0]]), expected: { width: 1_024, height: 1, transparent: true } },
  { id: "rgba8-last-sampled", bytes: rgba8(2_049, 1, [[2_047, 0]]), expected: { width: 1_024, height: 1, transparent: true } },
  { id: "rgba8-right-unsampled", bytes: rgba8(2_049, 1, [[2_048, 0]]), expected: { width: 1_024, height: 1, transparent: false } },
  { id: "rgba8-rounded-short-side", bytes: rgba8(2_049, 3, [[1, 0]]), expected: { width: 1_024, height: 1, transparent: false } },
  { id: "rgba8-short-side-center", bytes: rgba8(2_049, 3, [[1, 1]]), expected: { width: 1_024, height: 1, transparent: true } },
  { id: "rgba8-short-side-bottom", bytes: rgba8(2_049, 3, [[1, 2]]), expected: { width: 1_024, height: 1, transparent: false } },
  { id: "grayscale8-trns", bytes: grayscale8Transparency(), expected: { width: 1, height: 1, transparent: true } },
  { id: "truecolor8-trns", bytes: rgb8Transparency(), expected: { width: 1, height: 1, transparent: true } },
  { id: "palette1-trns", bytes: palette1Transparency(), expected: { width: 1, height: 1, transparent: true } },
  { id: "gray-alpha8", bytes: grayAlpha8(), expected: { width: 1, height: 1, transparent: true } },
  { id: "adam7-rgba8", bytes: adam7Rgba8(), expected: { width: 5, height: 5, transparent: true } },
  { id: "rgba16-alpha8-boundaries", bytes: rgba16([0xffff, 0xfffe, 0xff80, 0xfeff, 0x8080, 1, 0]), expected: { width: 7, height: 1, transparent: true, opaque_alpha8_count: 3 } }
];

async function loadPlaywright() {
  if (PLAYWRIGHT_OVERRIDE) return import(pathToFileURL(PLAYWRIGHT_OVERRIDE).href);
  try {
    return await import("playwright");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    const bundledEntry = join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs");
    return import(pathToFileURL(bundledEntry).href);
  }
}

const browser = await chromium.launch({
  headless: true,
  ...(CHROME_EXECUTABLE ? { executablePath: CHROME_EXECUTABLE } : {}),
  args: ["--no-first-run", "--no-default-browser-check"]
});
try {
  const page = await browser.newPage();
  let blockedHttpRequestCount = 0;
  await page.route("http://**/*", async (route) => {
    blockedHttpRequestCount += 1;
    await route.abort();
  });
  await page.route("https://**/*", async (route) => {
    blockedHttpRequestCount += 1;
    await route.abort();
  });
  await page.goto("about:blank");
  const results = [];
  for (const fixture of fixtures) {
    let projection;
    try {
      projection = inspectOwnerPngSourceCanvasAlpha(fixture.bytes);
    } catch {
      throw new Error(`Local bounded PNG sampler rejected synthetic fixture ${fixture.id}.`);
    }
    const canvas = await page.evaluate(async ({ dataUrl, width, height }) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      const targetWidth = Math.max(1, Math.round(image.naturalWidth * Math.min(1, 1_024 / Math.max(image.naturalWidth, image.naturalHeight))));
      const targetHeight = Math.max(1, Math.round(image.naturalHeight * Math.min(1, 1_024 / Math.max(image.naturalWidth, image.naturalHeight))));
      const surface = document.createElement("canvas");
      surface.width = targetWidth;
      surface.height = targetHeight;
      const context = surface.getContext("2d", { willReadFrequently: true });
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, targetWidth, targetHeight);
      const pixels = context.getImageData(0, 0, targetWidth, targetHeight).data;
      let transparent = false;
      let opaqueAlpha8Count = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] < 255) transparent = true;
        else opaqueAlpha8Count += 1;
      }
      return { width: targetWidth, height: targetHeight, transparent, opaqueAlpha8Count };
    }, {
      dataUrl: `data:image/png;base64,${fixture.bytes.toString("base64")}`,
      width: fixture.expected.width,
      height: fixture.expected.height
    });
    assert.deepEqual(
      { width: canvas.width, height: canvas.height, transparent: canvas.transparent },
      { width: fixture.expected.width, height: fixture.expected.height, transparent: fixture.expected.transparent },
      `${fixture.id} Chromium fixture`
    );
    if (fixture.expected.opaque_alpha8_count !== undefined) {
      assert.equal(canvas.opaqueAlpha8Count, fixture.expected.opaque_alpha8_count, `${fixture.id} alpha8 conversion aggregate`);
    }
    assert.deepEqual(
      { width: projection.source_sample_width, height: projection.source_sample_height, transparent: projection.source_alpha_eligible },
      { width: fixture.expected.width, height: fixture.expected.height, transparent: fixture.expected.transparent },
      `${fixture.id} local PNG sampler comparison`
    );
    results.push({
      id: fixture.id,
      width: canvas.width,
      height: canvas.height,
      sampled_alpha_has_transparency: canvas.transparent,
      ...(fixture.expected.opaque_alpha8_count === undefined ? {} : { opaque_alpha8_count: canvas.opaqueAlpha8Count })
    });
  }
  assert.equal(blockedHttpRequestCount, 0, "the synthetic probe should not initiate HTTP(S) requests");
  console.log(JSON.stringify({
    status: "PASS",
    scope: "FINITE_SYNTHETIC_PNG_FIXTURES_ONLY",
    browser: "Google Chrome / Chromium",
    browser_version: browser.version(),
    blocked_http_request_count: blockedHttpRequestCount,
    fixture_count: results.length,
    results
  }, null, 2));
} finally {
  await browser.close();
}
