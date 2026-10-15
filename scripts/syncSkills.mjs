import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = join(ROOT, '.agents', 'skills');
const TARGET = join(ROOT, '.claude', 'skills');

// Ordinary files work in Windows checkouts without symlink privileges.
function readTree(directory) {
  const files = new Map();

  function visit(path, relativePath) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not supported: ${path}`);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        visit(join(path, name), relativePath ? `${relativePath}/${name}` : name);
      }
    } else if (stat.isFile()) {
      files.set(relativePath, readFileSync(path));
    } else {
      throw new Error(`Expected an ordinary file or directory: ${path}`);
    }
  }

  try {
    lstatSync(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return files;
    throw error;
  }
  visit(directory, '');
  return files;
}

function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.length !== 1 || !['--check', '--write'].includes(argumentsList[0])) {
    throw new Error('Usage: node scripts/syncSkills.mjs --check | --write');
  }
  const checkOnly = argumentsList[0] === '--check';
  const source = readTree(SOURCE);
  const target = readTree(TARGET);
  if (source.size === 0) throw new Error('No source skills found in .agents/skills/');

  const skills = new Set([...source.keys()].map((path) => path.split('/')[0]));
  for (const skill of skills) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill) || skill.length > 64) {
      throw new Error(`Invalid skill folder name: ${skill}; expected lowercase kebab-case`);
    }
    if (!source.has(`${skill}/SKILL.md`)) throw new Error(`Missing ${skill}/SKILL.md`);
  }

  // Refuse to delete files: a stale copy can also be someone's unsynced work.
  const extra = [...target.keys()].filter((path) => !source.has(path));
  if (extra.length) {
    throw new Error(
      `Files only in .claude/skills/:\n${extra.join('\n')}\n` +
        'Move needed changes to .agents/skills/ or remove obsolete copies, then rerun.',
    );
  }

  const pending = [...source.keys()].filter(
    (path) => !target.has(path) || !source.get(path).equals(target.get(path)),
  );
  if (checkOnly && pending.length) {
    throw new Error(`Skills are out of sync:\n${pending.join('\n')}\nRun npm run skills:sync.`);
  }

  if (!checkOnly) {
    for (const path of pending) {
      const destination = join(TARGET, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, source.get(path));
    }
  }
  console.log(
    `Skills ${checkOnly ? 'checked' : 'synced'}: ${skills.size}; files updated: ${checkOnly ? 0 : pending.length}.`,
  );
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
