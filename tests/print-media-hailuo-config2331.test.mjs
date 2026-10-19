import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMediaMcpConfig, parseArguments } from '../scripts/print-media-mcp-config.mjs';
const url = new URL('../scripts/print-media-mcp-config.mjs', import.meta.url).href;
test('Hailuo opt-in is independent and requires an explicit operator upload destination', () => {
  assert.deepEqual(parseArguments(['--confirm-enable-paid-tools', '--include-hailuo-initial']), { kind: 'emit', includeHailuoInitial: true });
  const base = buildMediaMcpConfig(url, process.execPath).mcpServers.syntx.env;
  const selected = buildMediaMcpConfig(url, process.execPath, { includeHailuoInitial: true }).mcpServers.syntx.env;
  assert.equal(Object.hasOwn(base, 'SYNTX_OWNER_HAILUO_INITIAL'), false);
  assert.deepEqual(Object.fromEntries(Object.entries(selected).filter(([key,value]) => base[key] !== value)), {
    SYNTX_OWNER_HAILUO_INITIAL: '1', SYNTX_OWNER_HAILUO_INITIAL_UPLOAD_DESTINATION: '<uploaded|hidden>'
  });
  assert.equal(Object.hasOwn(selected, 'SYNTX_OWNER_HIGGSFIELD_DOP'), false);
});
test('Hailuo opt-in preserves paid confirmation and exact argument validation', () => {
  for (const args of [['--include-hailuo-initial'], ['--include-hailuo-initial','--confirm-enable-paid-tools'],
    ['--confirm-enable-paid-tools','--include-hailuo-initial','--include-hailuo-initial']]) assert.throws(() => parseArguments(args));
});
