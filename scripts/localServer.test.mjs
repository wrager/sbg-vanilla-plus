import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, sep } from 'node:path';
import test from 'node:test';
import { createLocalServer } from './localServer.mjs';

const CACHE = resolve(import.meta.dirname, '../node_modules/.cache/local-server-tests');
const BUILDS = [
  ['/release.user.js', 'dist/release/sbg-vanilla-plus.user.js', 'npm run build'],
  ['/debug.user.js', 'dist/debug/sbg-vanilla-plus.user.js', 'npm run build:debug'],
  ['/local.user.js', 'dist/debug/sbg-vanilla-plus.local.user.js', 'npm run build:debug'],
];

async function fixture(t) {
  await mkdir(CACHE, { recursive: true });
  const root = await mkdtemp(resolve(CACHE, 'project-'));
  const server = createLocalServer(root);
  t.after(async () => {
    await new Promise((done) => server.close(done));
    assert.ok(root.startsWith(`${CACHE}${sep}`));
    await rm(root, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { root, url: `http://127.0.0.1:${server.address().port}` };
}

test('installation page lists all builds; GET and HEAD set browser headers', async (t) => {
  const { url } = await fixture(t);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  const html = await page.text();
  for (const [route] of BUILDS) assert.ok(html.includes(`href="${route}"`));
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('all allowed builds serve fresh bytes; HEAD never sends their contents', async (t) => {
  const { root, url } = await fixture(t);
  await mkdir(resolve(root, 'dist/debug'), { recursive: true });
  await mkdir(resolve(root, 'dist/release'), { recursive: true });
  for (const [route, file] of BUILDS) {
    const path = resolve(root, file);
    await writeFile(path, '// first build');
    const first = await fetch(url + route);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    assert.match(first.headers.get('content-type'), /javascript/);
    assert.equal(await first.text(), '// first build');
    const head = await fetch(url + route, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    await writeFile(path, '// second build');
    assert.equal(await (await fetch(url + route)).text(), '// second build');
  }
});

test('missing builds report their commands; missing and unknown HEAD responses are empty', async (t) => {
  const { url } = await fixture(t);
  for (const [route, , command] of BUILDS) {
    const missing = await fetch(url + route);
    assert.equal(missing.status, 404);
    assert.ok((await missing.text()).includes(command));
  }
  for (const route of [...BUILDS.map(([route]) => route), '/unknown']) {
    const head = await fetch(url + route, { method: 'HEAD' });
    assert.equal(head.status, 404);
    assert.equal(await head.text(), '');
  }
});

test('unlisted paths stay private and methods other than GET/HEAD cannot write', async (t) => {
  const { root, url } = await fixture(t);
  await writeFile(resolve(root, 'package.json'), 'private project metadata');
  for (const route of [
    '/package.json',
    '/dist/debug/sbg-vanilla-plus.user.js',
    '/%2e%2e/package.json',
    '/debug.user.js?file=package.json',
  ]) {
    const response = await fetch(url + route);
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /private project metadata/);
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const response = await fetch(url + '/debug.user.js', { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
});

test('unreadable builds return 500 without exposing filesystem errors', async (t) => {
  const { root, url } = await fixture(t);
  await mkdir(resolve(root, 'dist/debug/sbg-vanilla-plus.user.js'), { recursive: true });
  const response = await fetch(url + '/debug.user.js');
  assert.equal(response.status, 500);
  const message = await response.text();
  assert.match(message, /Не удалось прочитать сборку/);
  assert.ok(!message.includes(root));
  const head = await fetch(url + '/debug.user.js', { method: 'HEAD' });
  assert.equal(head.status, 500);
  assert.equal(await head.text(), '');
});

test('CLI exits with a clear error when its port is already occupied', async (t) => {
  const blocker = createServer();
  t.after(() => new Promise((done) => blocker.close(done)));
  blocker.listen(5175, '127.0.0.1');
  try {
    await once(blocker, 'listening');
  } catch (error) {
    // An existing local service also exercises refusal to select another port.
    if (error.code !== 'EADDRINUSE') throw error;
  }
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, 'localServer.mjs')], {
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 1, result.error?.message);
  assert.match(result.stderr, /Порт 5175 занят/);
  assert.equal(result.stdout, '');
});
