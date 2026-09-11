import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const matrixFile = fileURLToPath(new URL('./phase3-3-control-adapter-matrix.test.mjs', import.meta.url));

function runMatrixCase(pattern) {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [
    '--test',
    `--test-name-pattern=${pattern}`,
    matrixFile,
  ], {
    encoding: 'utf8',
    env: childEnv,
    timeout: 120_000,
    windowsHide: true,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.equal(result.error, undefined, output);
  assert.equal(result.status, 0, output);
  assert.match(output, /(?:#|ℹ) pass 1\b/, `目标场景未被唯一执行：\n${output}`);
  assert.match(output, /(?:#|ℹ) fail 0\b/, output);
}

const CASES = Object.freeze([
  ['JQX Arrow-only Trigger', 'Phase 3\\.3\\.1 JQX multi-trigger'],
  ['JQX Boolean', 'Phase 3\\.3\\.1 JQX Boolean'],
  ['Pre-existing Hidden Options', 'Phase 3\\.3\\.1 JQX visibility transition'],
  ['Multiple JQX Widgets', 'Phase 3\\.3\\.1 Multiple JQX Widgets'],
  ['Unrelated Visible Overlay', 'Phase 3\\.3\\.1 JQX overlay ownership'],
  ['No Match', 'Custom Select fail-closed'],
  ['Dangerous Option', 'Custom Select Safety：下一步'],
  ['No Site Profile / Generic Mode', 'Phase 3\\.3\\.1 Generic Mode'],
]);

for (const [name, pattern] of CASES) {
  test(`Phase 3.3.1 ${name}`, () => runMatrixCase(pattern));
}
