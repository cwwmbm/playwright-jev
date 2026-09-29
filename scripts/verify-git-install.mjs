import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workspace = mkdtempSync(join(tmpdir(), 'playwright-jev-git-'));
const repository = join(workspace, 'library');
const consumer = join(workspace, 'consumer');
mkdirSync(repository);
mkdirSync(consumer);
// Only package/build inputs: never copy local secrets, test traces or browser state.
for (const path of [
  'src',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'README.md',
]) {
  cpSync(join(root, path), join(repository, path), { recursive: true });
}
function run(command, args, cwd) {
  if (command === 'npm' && process.env.npm_execpath) {
    args = [process.env.npm_execpath, ...args];
    command = process.execPath;
  }
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OPENROUTER_API_KEY: '', TYPESAFE_API_KEY: '' },
  });
}
try {
  run('git', ['init', '--quiet'], repository);
  run('git', ['add', '.'], repository);
  run(
    'git',
    [
      '-c',
      'user.name=Package Check',
      '-c',
      'user.email=package-check@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '-m',
      'Package fixture',
    ],
    repository,
  );
  const commit = run('git', ['rev-parse', 'HEAD'], repository).trim();
  const gitUrl = `git+${pathToFileURL(repository).href}#${commit}`;
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({
      name: 'jev-consumer-check',
      private: true,
      type: 'module',
    }),
  );
  console.log(
    'Installing from a clean Git commit (no committed dist, no API key)…',
  );
  run('npm', ['install', '--no-audit', '--no-fund', gitUrl], consumer);
  const installed = join(consumer, 'node_modules', 'playwright-jev');
  const shipped = readdirSync(installed);
  assert(shipped.includes('dist'), 'Git prepare must build dist');
  for (const excluded of ['.env', 'examples', 'tests', 'test-results', 'src'])
    assert(!shipped.includes(excluded), `Unexpected package file: ${excluded}`);
  writeFileSync(
    join(consumer, 'check.mjs'),
    `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as esm from 'playwright-jev';
const cjs = createRequire(import.meta.url)('playwright-jev');
for (const api of [esm, cjs]) {
  assert.equal(typeof api.createJev, 'function');
  for (const name of ['click','fill','fillForm','verify','read','within']) assert.equal(typeof api.Jev.prototype[name], 'function');
  const provider = new api.OpenRouterProvider({ apiKey: 'mock', fetch: async () => Response.json({ model: 'mock', answers: { ok: { type: 'noul', noul: 1 } } }) });
  const result = await provider.decide({ state: {}, questions: { ok: { type: 'noul', instructions: 'Check' } } }, AbortSignal.timeout(1000));
  assert.equal(result.answers.ok.noul, 1);
}
`,
  );
  run(process.execPath, ['check.mjs'], consumer);
  for (const extension of ['mts', 'cts'])
    writeFileSync(
      join(consumer, `check.${extension}`),
      `import { createJev, type JevOptions } from 'playwright-jev';\nimport type { Page } from 'playwright-core';\nexport function use(page: Page, options: JevOptions) { return createJev(page, options).fillForm({ city: 'Vancouver' }); }\n`,
    );
  run(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--module',
      'nodenext',
      '--target',
      'ES2022',
      '--skipLibCheck',
      'check.mts',
      'check.cts',
    ],
    consumer,
  );
  const lock = JSON.parse(
    readFileSync(join(consumer, 'package-lock.json'), 'utf8'),
  );
  assert(
    lock.packages['node_modules/playwright-jev'].resolved.includes(commit),
  );
  console.log(
    'PASS: clean Git installation, ESM/CommonJS execution, TypeScript declarations, peer dependency and package contents.',
  );
  console.log(`Temporary consumer: ${consumer}`);
} catch (error) {
  console.error(error.stderr?.toString() ?? error.message);
  console.error(`Inspect temporary consumer: ${consumer}`);
  process.exitCode = 1;
}
