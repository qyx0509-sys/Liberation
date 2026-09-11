import { spawn } from 'node:child_process';
import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '..');
const results = [];
let tests = '', builds = '';
async function run(name) {
  console.log(`Running npm run ${name}`);
  const started = Date.now();
  let output = '';
  const child = process.platform === 'win32'
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd run ${name}`], { cwd: root, windowsHide: true })
    : spawn('npm', ['run', name], { cwd: root });
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('close', done); });
  results.push({ command: `npm run ${name}`, code, durationMs: Date.now() - started });
  const record = `\n===== npm run ${name} (exit ${code}) =====\n${output}\n`;
  if (name === 'build') builds += record; else tests += record;
  console.log(output.trim().split('\n').slice(-10).join('\n'));
  if (code !== 0) console.error(output.slice(-18000));
  await writeFile(resolve(root, 'JOBFILL_UI_TEST_RESULT.txt'), tests);
  await writeFile(resolve(root, 'JOBFILL_UI_BUILD_RESULT.txt'), builds);
  return code === 0;
}
await mkdir(resolve(root, 'ui-review'), { recursive: true });
let passed = await run('build');
for (const command of ['test:unit', 'test:matrix', 'test:e2e']) passed = await run(command) && passed;
passed = await run('build') && passed;
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : resolve(directory, entry.name)))).flat();
}
const sha = value => createHash('sha256').update(value).digest('hex');
const dist = resolve(root, 'dist');
const mismatch = [];
const builtFiles = await files(dist);
for (const file of builtFiles) {
  const path = relative(dist, file);
  if (sha(await readFile(file)) !== sha(await readFile(resolve(root, path)))) mismatch.push(path);
}
passed = !mismatch.length && passed;
builds += `\nSource/dist SHA-256 parity: ${builtFiles.length} files; mismatches: ${JSON.stringify(mismatch)}\n`;
await writeFile(resolve(root, 'JOBFILL_UI_BUILD_RESULT.txt'), builds);
await writeFile(resolve(root, 'ui-review/verification.json'), JSON.stringify({ passed, results, distFiles: builtFiles.length, mismatch }, null, 2));
console.log(`Final verification: ${passed ? 'PASS' : 'FAIL'}; dist parity ${builtFiles.length} files`);
process.exitCode = passed ? 0 : 1;
