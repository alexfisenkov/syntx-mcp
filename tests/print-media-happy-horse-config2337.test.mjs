import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMediaMcpConfig, parseArguments } from '../scripts/print-media-mcp-config.mjs';
const url = new URL('../scripts/print-media-mcp-config.mjs', import.meta.url).href;
test('Happy Horse config is default-off and emits exactly trusted destination and ffprobe placeholders', () => {
  assert.deepEqual(parseArguments(['--confirm-enable-paid-tools', '--include-happy-horse']), { kind: 'emit', includeHappyHorse: true });
  const base = buildMediaMcpConfig(url, process.execPath).mcpServers.syntx.env;
  const selected = buildMediaMcpConfig(url, process.execPath, { includeHappyHorse: true }).mcpServers.syntx.env;
  assert.equal(Object.hasOwn(base, 'SYNTX_OWNER_HAPPY_HORSE'), false);
  assert.deepEqual(Object.fromEntries(Object.entries(selected).filter(([key,value]) => base[key] !== value)), {
    SYNTX_OWNER_HAPPY_HORSE: '1', SYNTX_OWNER_HAPPY_HORSE_UPLOAD_DESTINATION: '<uploaded|hidden>',
    SYNTX_OWNER_HAPPY_HORSE_FFPROBE_PATH: '<absolute path to trusted ffprobe executable>'
  });
});
test('Happy Horse config retains first paid confirmation and rejects duplicate flags', () => {
  for (const args of [['--include-happy-horse'], ['--include-happy-horse','--confirm-enable-paid-tools'],
    ['--confirm-enable-paid-tools','--include-happy-horse','--include-happy-horse']]) assert.throws(() => parseArguments(args));
});
