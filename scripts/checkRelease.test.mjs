import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkRelease } from './checkRelease.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'release-check-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (file, value) => writeFileSync(join(directory, file), value);
  write('.release-please-manifest.json', JSON.stringify({ '.': '0.15.1' }));
  write('RELEASE_NOTES.md', '# v0.15.1\n\nИзменения для игроков.\n');
  write('package.json', JSON.stringify({ version: '0.15.1' }));
  write(
    'package-lock.json',
    JSON.stringify({
      version: '0.15.1',
      packages: { '': { version: '0.15.1' } },
    }),
  );
  return { directory, write };
}

test('matching notes and version pass, including CRLF notes', (t) => {
  const { directory, write } = fixture(t);
  checkRelease(directory);
  write('RELEASE_NOTES.md', '# v0.15.1\r\n\r\nИзменения.\r\n');
  checkRelease(directory, 'v0.15.1');
});

for (const heading of ['# v0.15.0', '# Изменения', '', '# v0.16.0']) {
  test(`reject notes with a stale, missing or mismatched heading: ${heading}`, (t) => {
    const { directory, write } = fixture(t);
    write('RELEASE_NOTES.md', `${heading}\n\nИзменения.\n`);
    assert.throws(() => checkRelease(directory), /RELEASE_NOTES.md/);
  });
}

test('reject a missing notes file', (t) => {
  const { directory } = fixture(t);
  unlinkSync(join(directory, 'RELEASE_NOTES.md'));
  assert.throws(() => checkRelease(directory), /ENOENT/);
});

test('reject a different release tag and inconsistent manifest', (t) => {
  const { directory, write } = fixture(t);
  assert.throws(() => checkRelease(directory, 'v0.16.0'), /Release tag/);
  write('.release-please-manifest.json', JSON.stringify({ '.': '0.15.0' }));
  assert.throws(() => checkRelease(directory), /manifest/);
});

function metadata(version = '0.15.1', name = 'SBG Vanilla+') {
  return `// ==UserScript==\n// @name ${name}\n// @version ${version}\n// ==/UserScript==\n`;
}

test('both release assets must exist and agree with the expected version', (t) => {
  const { directory, write } = fixture(t);
  write('sbg-vanilla-plus.user.js', metadata() + 'console.log("SVP");');
  write('sbg-vanilla-plus.meta.js', metadata());
  checkRelease(directory, 'v0.15.1', '.');
  for (const file of ['sbg-vanilla-plus.user.js', 'sbg-vanilla-plus.meta.js']) {
    const valid = file.endsWith('.meta.js') ? metadata() : metadata() + 'void 0;';
    write(file, metadata('0.15.0') + 'void 0;');
    assert.throws(() => checkRelease(directory, 'v0.15.1', '.'), /Asset version/);
    write(file, valid);
    unlinkSync(join(directory, file));
    assert.throws(() => checkRelease(directory, 'v0.15.1', '.'), /ENOENT/);
    write(file, valid);
  }
});

test('reject incomplete metadata, mismatched metadata and empty code', (t) => {
  const { directory, write } = fixture(t);
  write('sbg-vanilla-plus.user.js', metadata() + 'void 0;');
  write('sbg-vanilla-plus.meta.js', '// ==UserScript==\n');
  assert.throws(() => checkRelease(directory, 'v0.15.1', '.'), /Incomplete/);
  write('sbg-vanilla-plus.meta.js', metadata('0.15.1', 'Other script'));
  assert.throws(() => checkRelease(directory, 'v0.15.1', '.'), /identical metadata/);
  write('sbg-vanilla-plus.meta.js', metadata());
  write('sbg-vanilla-plus.user.js', metadata());
  assert.throws(() => checkRelease(directory, 'v0.15.1', '.'), /executable code/);
});

test('reject stale versions in either lockfile location', (t) => {
  const { directory, write } = fixture(t);
  for (const lock of [
    { version: '0.15.0', packages: { '': { version: '0.15.1' } } },
    { version: '0.15.1', packages: { '': { version: '0.15.0' } } },
  ]) {
    write('package-lock.json', JSON.stringify(lock));
    assert.throws(() => checkRelease(directory), /Lockfile/);
  }
});
