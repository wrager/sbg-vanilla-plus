import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkRelease(directory, tag, assetDirectory) {
  const read = (file) => readFileSync(resolve(directory, file), 'utf8');
  const { version } = JSON.parse(read('package.json'));
  const expectedTag = tag ?? `v${version}`;
  assert.equal(expectedTag, `v${version}`, 'Release tag must match package.version');
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, version, 'Lockfile version must match package.version');
  assert.equal(
    lock.packages[''].version,
    version,
    'Lockfile root version must match package.version',
  );
  assert.equal(
    JSON.parse(read('.release-please-manifest.json'))['.'],
    version,
    'Release Please manifest must match package.version',
  );
  assert.equal(
    read('RELEASE_NOTES.md').split(/\r?\n/, 1)[0],
    `# ${expectedTag}`,
    'RELEASE_NOTES.md must start with the release version',
  );

  if (assetDirectory) {
    const sources = ['sbg-vanilla-plus.user.js', 'sbg-vanilla-plus.meta.js'].map((name) =>
      readFileSync(resolve(directory, assetDirectory, name), 'utf8'),
    );
    const headers = sources.map((source) => {
      assert.ok(source.startsWith('// ==UserScript=='), 'Missing userscript metadata');
      const end = source.indexOf('// ==/UserScript==');
      assert.ok(end > 0, 'Incomplete userscript metadata');
      const header = source.slice(0, end);
      assert.equal(
        header.match(/^\/\/ @version\s+(\S+)$/m)?.[1],
        version,
        'Asset version must match the release tag',
      );
      return header;
    });
    assert.equal(headers[0], headers[1], 'Release assets must have identical metadata');
    assert.ok(
      sources[0]
        .slice(sources[0].indexOf('// ==/UserScript==') + '// ==/UserScript=='.length)
        .trim(),
      'Userscript must contain executable code',
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkRelease(process.cwd(), process.argv[2], process.argv[3]);
  console.log('Release version, notes and requested assets are consistent.');
}
