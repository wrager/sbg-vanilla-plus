import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { SourceMap } from 'node:module';
import { resolve, sep } from 'node:path';
import test from 'node:test';
import { ESLint } from 'eslint';
import tsJest from 'ts-jest';
import typescript from 'typescript';
import jestConfig from '../jest.config.js';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE = resolve(ROOT, '.vite/toolchain-tests');
const PACKAGE = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
const [TYPECHECK_LAUNCHER, ...TYPECHECK_ARGS] = PACKAGE.scripts.typecheck.split(' ');

async function fixture(t) {
  await mkdir(CACHE, { recursive: true });
  const directory = await mkdtemp(resolve(CACHE, 'project-'));
  t.after(async () => {
    assert.ok(directory.startsWith(`${CACHE}${sep}`));
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(
    resolve(directory, 'tsconfig.json'),
    JSON.stringify({ extends: resolve(ROOT, 'tsconfig.json'), include: ['*.ts'] }),
  );
  return directory;
}

test('the typecheck script runs native TypeScript 7 alongside the compatibility API', async (t) => {
  const compatibility = JSON.parse(
    await readFile(resolve(ROOT, 'node_modules/typescript/package.json'), 'utf8'),
  );
  assert.match(typescript.version, /^6\.0\./);
  assert.equal(typeof typescript.createProgram, 'function');
  assert.equal(typeof typescript.createLanguageService, 'function');
  assert.equal(typeof typescript.transpileModule, 'function');
  assert.ok(compatibility.bin.tsc6);
  assert.equal(compatibility.bin.tsc, undefined, 'the compatibility API must not shadow TS 7');

  assert.equal(TYPECHECK_LAUNCHER, 'node');
  const version = spawnSync(process.execPath, [...TYPECHECK_ARGS, '--version'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /Version 7\./);

  const directory = await fixture(t);
  const source = resolve(directory, 'probe.ts');
  await writeFile(
    source,
    'export const label: string = 42;\nexport const absent: string = null;\n',
  );
  const check = () =>
    spawnSync(process.execPath, [...TYPECHECK_ARGS, '-p', directory], {
      cwd: ROOT,
      encoding: 'utf8',
    });
  const invalid = check();
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stdout, /Type 'number' is not assignable to type 'string'/);
  assert.match(invalid.stdout, /Type 'null' is not assignable to type 'string'/);
  await writeFile(source, "export const label: string = 'valid';\n");
  const valid = check();
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
});

test('strict type-dependent ESLint rules reject unsafe values and floating promises', async (t) => {
  const directory = await fixture(t);
  const invalidPath = resolve(directory, 'invalid.ts');
  const validPath = resolve(directory, 'valid.ts');
  await writeFile(
    invalidPath,
    "export const label: string = JSON.parse('{}');\nPromise.resolve();\n",
  );
  await writeFile(
    validPath,
    "export const label: string = 'valid';\nvoid Promise.resolve(label);\n",
  );
  const eslint = new ESLint({ cwd: ROOT });
  const [invalid, valid] = await eslint.lintFiles([invalidPath, validPath]);
  assert.ok(
    invalid.messages.some(({ ruleId }) => ruleId === '@typescript-eslint/no-unsafe-assignment'),
  );
  assert.ok(
    invalid.messages.some(({ ruleId }) => ruleId === '@typescript-eslint/no-floating-promises'),
  );
  assert.equal(valid.errorCount, 0, JSON.stringify(valid.messages));
  assert.equal(valid.warningCount, 0, JSON.stringify(valid.messages));
});

test('ts-jest retains mock hoisting, source maps and syntax diagnostics through the compatibility API', () => {
  const [transformerName, options] = jestConfig.transform['^.+\\.tsx?$'];
  assert.equal(transformerName, 'ts-jest');
  const transformer = tsJest.default.createTransformer(options);
  const filename = resolve(ROOT, 'src/__mocks__/toolchainProbe.ts');
  const transformOptions = {
    config: { ...jestConfig, cwd: ROOT, rootDir: ROOT, globals: {} },
    configString: JSON.stringify(jestConfig),
    cacheFS: new Map(),
    instrument: false,
    supportsStaticESM: false,
  };
  const source = [
    "import { value } from './probe';",
    "jest.mock('./probe', () => ({ value: 'mocked' }));",
    'export const label: string = value;',
  ].join('\n');
  const output = transformer.process(source, filename, transformOptions);
  assert.ok(output.code.indexOf('.mock(') < output.code.indexOf('require("./probe")'));
  const encoded = output.code.match(/sourceMappingURL=data:application\/json[^,]*;base64,([^\s]+)/);
  assert.ok(encoded, 'Jest transforms must retain an inline source map');
  const map = JSON.parse(Buffer.from(encoded[1], 'base64').toString('utf8'));
  assert.deepEqual(map.sourcesContent, [source]);
  const lines = output.code.split('\n');
  const generatedLine = lines.findIndex((line) => line.includes('exports.label = probe_1.value'));
  assert.ok(generatedLine >= 0);
  assert.equal(new SourceMap(map).findEntry(generatedLine, 0).originalLine, 2);
  assert.throws(
    () => transformer.process('export const broken = ;', filename, transformOptions),
    /Expression expected/,
  );
});
