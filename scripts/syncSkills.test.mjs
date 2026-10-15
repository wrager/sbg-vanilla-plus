import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'svp-skills-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, 'scripts', 'syncSkills.mjs');
  mkdirSync(dirname(script));
  copyFileSync(new URL('./syncSkills.mjs', import.meta.url), script);
  return {
    path: (path) => join(root, path),
    write(path, content) {
      const destination = join(root, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, content);
    },
    run(mode) {
      // A different cwd proves paths are resolved relative to the script.
      return spawnSync(process.execPath, [script, mode], { cwd: tmpdir(), encoding: 'utf8' });
    },
  };
}

const SOURCE_SKILL = '.agents/skills/sbg-example/SKILL.md';
const TARGET_SKILL = '.claude/skills/sbg-example/SKILL.md';
const SKILL = '---\nname: sbg-example\ndescription: Fixture skill.\n---\n\nИнструкция.\n';

test('copies a skill and nested binary/empty resources; repeat sync leaves files untouched', (t) => {
  const project = fixture(t);
  project.write(SOURCE_SKILL, SKILL);
  project.write('.agents/skills/sbg-example/assets/data.bin', Buffer.from([0, 255, 10]));
  project.write('.agents/skills/sbg-example/references/empty.txt', '');
  assert.equal(project.run('--write').status, 0);
  assert.equal(readFileSync(project.path(TARGET_SKILL), 'utf8'), SKILL);
  assert.deepEqual(
    readFileSync(project.path('.claude/skills/sbg-example/assets/data.bin')),
    Buffer.from([0, 255, 10]),
  );
  assert.equal(
    readFileSync(project.path('.claude/skills/sbg-example/references/empty.txt')).length,
    0,
  );
  const modified = statSync(project.path(TARGET_SKILL)).mtimeMs;
  assert.equal(project.run('--write').status, 0);
  assert.equal(statSync(project.path(TARGET_SKILL)).mtimeMs, modified);
  assert.equal(project.run('--check').status, 0);
});

test('check reports missing copies without creating files', (t) => {
  const project = fixture(t);
  project.write(SOURCE_SKILL, SKILL);
  const result = project.run('--check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /out of sync/);
  assert.equal(existsSync(project.path('.claude')), false);
});

test('check detects edited copies without writing; sync restores the canonical content', (t) => {
  const project = fixture(t);
  project.write(SOURCE_SKILL, SKILL);
  project.write(TARGET_SKILL, 'edited copy');
  assert.equal(project.run('--check').status, 1);
  assert.equal(readFileSync(project.path(TARGET_SKILL), 'utf8'), 'edited copy');
  assert.equal(project.run('--write').status, 0);
  assert.equal(readFileSync(project.path(TARGET_SKILL), 'utf8'), SKILL);
});

test('stale or unknown target files stop both modes before any writes', (t) => {
  const project = fixture(t);
  project.write(SOURCE_SKILL, SKILL);
  project.write(TARGET_SKILL, 'keep until conflict is resolved');
  const extra = '.claude/skills/sbg-old-skill/SKILL.md';
  project.write(extra, 'work to preserve');
  for (const mode of ['--check', '--write']) {
    const result = project.run(mode);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Files only in/);
    assert.equal(readFileSync(project.path(extra), 'utf8'), 'work to preserve');
    assert.equal(
      readFileSync(project.path(TARGET_SKILL), 'utf8'),
      'keep until conflict is resolved',
    );
  }
});

test('missing source tree does not erase existing Claude skills', (t) => {
  const project = fixture(t);
  project.write(TARGET_SKILL, SKILL);
  const result = project.run('--write');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No source skills/);
  assert.equal(readFileSync(project.path(TARGET_SKILL), 'utf8'), SKILL);
});

test('resources without SKILL.md are rejected before creating copies', (t) => {
  const project = fixture(t);
  project.write('.agents/skills/sbg-example/references/guide.md', 'guide');
  const result = project.run('--write');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing sbg-example\/SKILL.md/);
  assert.equal(existsSync(project.path('.claude')), false);
});

test('invalid command line or skill name does not create copies', (t) => {
  const project = fixture(t);
  project.write('.agents/skills/Invalid_Name/SKILL.md', SKILL);
  assert.match(project.run('--unknown').stderr, /Usage:/);
  const result = project.run('--write');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid skill folder name/);
  assert.equal(existsSync(project.path('.claude')), false);
});
