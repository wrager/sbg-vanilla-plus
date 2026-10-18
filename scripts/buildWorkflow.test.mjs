import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { SourceMap } from 'node:module';
import { createServer as createPortProbe } from 'node:net';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import test from 'node:test';
import { build, createServer, loadConfigFromFile } from 'vite';

const ROOT = resolve(import.meta.dirname, '..');
const CONFIG = resolve(ROOT, 'vite.config.ts');
const CACHE = resolve(ROOT, '.vite/build-workflow-tests');
const FILENAME = 'sbg-vanilla-plus.user.js';
const PACKAGE = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));

async function fixture(t) {
  await mkdir(CACHE, { recursive: true });
  // Spaces exercise file:// escaping in the generated Tampermonkey loader.
  const directory = await mkdtemp(resolve(CACHE, 'project with spaces-'));
  t.after(async () => {
    assert.ok(directory.startsWith(`${CACHE}${sep}`));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function metadata(source) {
  const end = source.indexOf('// ==/UserScript==');
  assert.ok(source.startsWith('// ==UserScript=='));
  assert.ok(end > 0);
  return source.slice(0, end);
}

test('release/debug builds preserve each other and have the intended metadata and source maps', async (t) => {
  const directory = await fixture(t);
  const debugDirectory = resolve(directory, 'debug');
  const releaseDirectory = resolve(directory, 'release');
  await build({
    configFile: CONFIG,
    mode: 'debug',
    logLevel: 'silent',
    build: { outDir: debugDirectory },
  });
  const debug = await readFile(resolve(debugDirectory, FILENAME), 'utf8');
  new Script(debug);
  assert.match(metadata(debug), /@name\s+SBG Vanilla\+ \[DEBUG\]/);
  assert.match(metadata(debug), /@run-at\s+document-start/);
  assert.match(metadata(debug), /@grant\s+none/);
  assert.ok(metadata(debug).includes(PACKAGE.version));
  assert.doesNotMatch(metadata(debug), /@(?:download|update)URL/);
  const mapComment = debug.match(/sourceMappingURL=data:application\/json[^,]*;base64,([^\s]+)/);
  assert.ok(mapComment, 'debug output must contain an inline map');
  const map = JSON.parse(Buffer.from(mapComment[1], 'base64').toString('utf8'));
  const generatedLines = debug.split('\n');
  const line = generatedLines.findIndex((entry) => /^\s*installGameScriptPatcher\(\);/.test(entry));
  assert.ok(line > 0, 'early hook must be present in the standalone bundle');
  const original = new SourceMap(map).findEntry(
    line,
    generatedLines[line].indexOf('installGameScriptPatcher'),
  );
  assert.match(original.originalSource, /src\/entry\.ts$/);
  const entry = (await readFile(resolve(ROOT, 'src/entry.ts'), 'utf8')).split('\n');
  assert.match(entry[original.originalLine], /installGameScriptPatcher\(\)/);
  assert.ok(map.sourcesContent.some((source) => source?.includes('installGameScriptPatcher()')));

  const loader = await readFile(resolve(debugDirectory, 'sbg-vanilla-plus.local.user.js'), 'utf8');
  assert.match(metadata(loader), /@name\s+SBG Vanilla\+ \[LOCAL\]/);
  assert.ok(loader.includes(`@require ${pathToFileURL(resolve(debugDirectory, FILENAME)).href}`));
  assert.doesNotMatch(loader, /@(?:download|update)URL/);
  assert.match(loader, /%20/);

  await build({
    configFile: CONFIG,
    mode: 'production',
    logLevel: 'silent',
    build: { outDir: releaseDirectory },
  });
  const release = await readFile(resolve(releaseDirectory, FILENAME), 'utf8');
  new Script(release);
  assert.match(metadata(release), /@name\s+SBG Vanilla\+\s*\n/);
  assert.match(
    metadata(release),
    /@downloadURL\s+https:\/\/github.com\/wrager\/sbg-vanilla-plus\/releases\/latest\/download\/sbg-vanilla-plus.user.js/,
  );
  assert.match(metadata(release), /@updateURL\s+.*sbg-vanilla-plus.meta.js/);
  assert.match(metadata(release), /@run-at\s+document-start/);
  const releaseVersion = metadata(release).match(/@version\s+(\S+)/)?.[1];
  assert.equal(releaseVersion, PACKAGE.version);
  const releaseMeta = await readFile(resolve(releaseDirectory, 'sbg-vanilla-plus.meta.js'), 'utf8');
  assert.equal(metadata(releaseMeta), metadata(release));
  assert.doesNotMatch(release, /sourceMappingURL|127\.0\.0\.1:517[45]|file:\/\//);
  assert.ok(release.split('\n').length < debug.split('\n').length / 2);
  assert.equal(await readFile(resolve(debugDirectory, FILENAME), 'utf8'), debug);
  await build({
    configFile: CONFIG,
    mode: 'debug',
    logLevel: 'silent',
    build: { outDir: debugDirectory },
  });
  assert.equal(await readFile(resolve(releaseDirectory, FILENAME), 'utf8'), release);
});

test('minified output preserves function and class names for diagnostics', async (t) => {
  const directory = await fixture(t);
  const entryPath = resolve(directory, 'names.ts');
  const outDir = resolve(directory, 'minified');
  await writeFile(
    entryPath,
    'function diagnosticFunction() {}\nclass DiagnosticClass {}\nwindow.__svpProbe = { diagnosticFunction, DiagnosticClass };\n',
  );
  await build({
    configFile: CONFIG,
    mode: 'debug',
    logLevel: 'silent',
    build: { outDir, minify: 'oxc', lib: { entry: entryPath } },
  });
  const output = await readFile(resolve(outDir, FILENAME), 'utf8');
  const browserWindow = {};
  new Script(output).runInNewContext({ window: browserWindow });
  assert.equal(browserWindow.__svpProbe.diagnosticFunction.name, 'diagnosticFunction');
  assert.equal(browserWindow.__svpProbe.DiagnosticClass.name, 'DiagnosticClass');
});

test('Vite config supports native Node TypeScript loading', async () => {
  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'debug' },
    CONFIG,
    ROOT,
    'silent',
    undefined,
    'native',
  );
  assert.ok(loaded);
  assert.equal(loaded.config.build.outDir, 'dist/debug');
  assert.equal(JSON.parse(loaded.config.define.__SVP_VERSION__), PACKAGE.version);
});

test('dev config has no auto-open/reload and refuses an occupied port', async (t) => {
  const probe = createPortProbe();
  const port = await new Promise((done, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const freePort = probe.address().port;
      probe.close((error) => (error ? reject(error) : done(freePort)));
    });
  });
  const server = await createServer({
    configFile: CONFIG,
    logLevel: 'silent',
    server: { port },
  });
  t.after(() => server.close());
  assert.equal(server.config.server.host, '127.0.0.1');
  assert.equal(server.config.server.hmr, false);
  assert.equal(server.config.server.open, false);
  assert.equal(server.config.server.strictPort, true);
  await server.listen();
  const second = await createServer({ configFile: CONFIG, logLevel: 'silent', server: { port } });
  t.after(() => second.close());
  await assert.rejects(second.listen(), /already in use/);
  const config = await loadConfigFromFile({ command: 'build', mode: 'debug' }, CONFIG);
  assert.equal(config.config.build.outDir, 'dist/debug');
  const production = await loadConfigFromFile({ command: 'build', mode: 'production' }, CONFIG);
  assert.equal(production.config.build.outDir, 'dist/release');
});

test(
  'watch rebuilds TypeScript and inline CSS, reports errors, and recovers',
  { timeout: 60000 },
  async (t) => {
    let watcher;
    t.after(() => watcher?.close());
    const directory = await fixture(t);
    const entryPath = resolve(directory, 'probe.ts');
    const cssPath = resolve(directory, 'probe.css');
    const outDir = resolve(directory, 'watch');
    const entry = (label) =>
      `import css from './probe.css?inline';\nwindow.__svpProbe = { label: '${label}', css };\n`;
    await writeFile(entryPath, entry('first'));
    await writeFile(cssPath, '.svp-probe { width: 17px; }');
    watcher = await build({
      configFile: CONFIG,
      mode: 'debug',
      logLevel: 'silent',
      build: { outDir, lib: { entry: entryPath }, watch: { buildDelay: 50 } },
    });
    function nextEvent(code, action = () => {}) {
      return new Promise((done, reject) => {
        const timer = setTimeout(() => {
          watcher.off('event', listener);
          reject(new Error(`Timed out waiting for watch ${code}`));
        }, 15000);
        function listener(event) {
          if (event.code !== code && event.code !== 'ERROR') return;
          clearTimeout(timer);
          watcher.off('event', listener);
          if (event.code === code) {
            Promise.resolve(event.result?.close()).then(() => done(event), reject);
          } else reject(event.error);
        }
        watcher.on('event', listener);
        Promise.resolve()
          .then(action)
          .catch((error) => {
            clearTimeout(timer);
            watcher.off('event', listener);
            reject(error);
          });
      });
    }
    await nextEvent('BUNDLE_END');
    const output = () => readFile(resolve(outDir, FILENAME), 'utf8');
    assert.match(await output(), /label: "first"/);
    await nextEvent('BUNDLE_END', () => writeFile(entryPath, entry('second')));
    assert.match(await output(), /label: "second"/);
    await nextEvent('BUNDLE_END', () => writeFile(cssPath, '.svp-probe { width: 29px; }'));
    assert.match(await output(), /29px/);
    await nextEvent('ERROR', () => writeFile(entryPath, 'export const broken = ;'));
    await nextEvent('BUNDLE_END', () => writeFile(entryPath, entry('recovered')));
    assert.match(await output(), /label: "recovered"/);
    await watcher.close();
  },
);
