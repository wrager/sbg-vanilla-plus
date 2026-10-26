import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ReleaseNotes, assertLocalRelease, renderLocal, digest } from './releaseNotes.mjs';

function spawnReleaseCommand(program, args, options) {
  if (process.platform !== 'win32' || (program !== 'npm' && !/\.(?:bat|cmd)$/i.test(program))) {
    return spawnSync(program, args, options);
  }
  if (program === 'npm') {
    program = execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
  }
  for (const value of [program, ...args]) {
    assert.doesNotMatch(value, /["\r\n%!^&|<>]/, 'Unsupported batch command argument');
  }
  const command = [program, ...args].map((value) => `"${value}"`).join(' ');
  return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${command}"`], {
    ...options,
    windowsVerbatimArguments: true,
  });
}

export function runCommands(commands, runner = spawnReleaseCommand, options = {}) {
  for (const [program, ...args] of commands) {
    const command =
      process.platform === 'win32' && program === './gradlew' ? './gradlew.bat' : program;
    const result = runner(command, args, {
      ...options,
      stdio: 'inherit',
      shell: false,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Release preparation failed: ${program}`);
  }
}

export async function prepareRelease(
  number,
  {
    directory = process.cwd(),
    environment = process.env,
    runner = spawnReleaseCommand,
    fetcher = fetch,
    materialsReady = false,
  } = {},
) {
  const config = JSON.parse(readFileSync(resolve(directory, '.github/release-notes.json'), 'utf8'));
  const client = new ReleaseNotes(environment.GITHUB_REPOSITORY || config.repository, {
    token: environment.GH_TOKEN || environment.GITHUB_TOKEN,
    fetcher,
  });
  const pull = await client.find(number);
  const original = await client.state(pull);
  assertLocalRelease(original, directory, config.artifacts);
  if (config.android)
    assert.ok(
      environment.ANDROID_SERIAL,
      'Set ANDROID_SERIAL to a dedicated API 33 / WebView 101 emulator',
    );
  if (!materialsReady)
    runCommands(config.beforeNotes, runner, { cwd: directory, env: environment });
  const current = await client.state(await client.find(pull.number));
  assert.equal(current.pull.head.sha, original.pull.head.sha, 'PR changed during preparation');
  assert.equal(current.pull.base.sha, original.pull.base.sha, 'Main changed during preparation');
  assert.equal(digest(current.notes), digest(original.notes), 'Notes changed during preparation');
  renderLocal(client, current, directory, config.artifacts);
  runCommands(config.checks, runner, { cwd: directory, env: environment });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.ok(
    process.argv[3] === undefined || process.argv[3] === '--materials-ready',
    'Unknown preparation option',
  );
  prepareRelease(process.argv[2] ? Number(process.argv[2]) : undefined, {
    materialsReady: process.argv[3] === '--materials-ready',
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
