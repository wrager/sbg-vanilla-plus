/**
 * Download and organize external reference scripts for development.
 *
 * Usage: npm run refs:fetch
 *
 * Downloads EUI/CUI sources and releases, OpenLayers bundle, game script.
 * Manual content in refs/game/dom/, refs/game/css/ and refs/screenshots/ is preserved.
 */

import { execSync } from 'node:child_process';
import { createWriteStream, existsSync, readdirSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, posix, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = resolve(import.meta.dirname, '..');
const REFS = join(ROOT, 'refs');
const TEMP = join(REFS, '.tmp');

// GitHub API zipball URLs handle branch resolution automatically
const URLS = {
  euiZipball: 'https://api.github.com/repos/egorantonov/sbg-enhanced/zipball',
  cuiSource:
    'https://raw.githubusercontent.com/egorantonov/sbg-enhanced/master/scripts/cui.user.js',
  euiRelease: 'https://github.com/egorantonov/sbg-enhanced/releases/latest/download/eui.user.js',
  cuiRelease: 'https://github.com/egorantonov/sbg-enhanced/releases/latest/download/cui.user.js',
  olBundle: 'https://sbg-game.ru/packages/js/ol@10.6.0.js',
  gamePage: 'https://sbg-game.ru/app/',
};

/** @type {{ name: string; location: string; source: string; status: 'ok' | 'error'; error?: string }[]} */
const manifest = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert Windows path to forward-slash path for shell commands */
function toSlash(windowsPath) {
  return windowsPath.replace(/\\/g, '/');
}

/** @param {string} url @returns {Promise<Response>} */
async function fetchUrl(url) {
  const headers = { 'User-Agent': 'sbg-vanilla-plus-refs-fetcher' };
  const response = await fetch(url, { redirect: 'follow', headers });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response;
}

/** @param {string} url @param {string} dest */
async function downloadFile(url, dest) {
  const response = await fetchUrl(url);
  const body = response.body;
  if (!body) throw new Error(`Empty body for ${url}`);
  await mkdir(join(dest, '..'), { recursive: true });
  const nodeStream = Readable.fromWeb(body);
  await pipeline(nodeStream, createWriteStream(dest));
}

/** @param {string} filePath @param {'babel' | 'html' | 'css'} parser */
function prettify(filePath, parser = 'babel') {
  try {
    execSync(`npx prettier --write --parser ${parser} "${toSlash(filePath)}"`, {
      cwd: ROOT,
      stdio: 'pipe',
    });
  } catch (error) {
    console.warn(`  Warning: prettier failed for ${basename(filePath)}: ${error.message}`);
  }
}

/**
 * Beautify a minified JS bundle using js-beautify.
 * Prettier cannot split single-expression UMD bundles into multiple lines,
 * so we use js-beautify for large bundles like OpenLayers.
 * @param {string} filePath
 */
function beautify(filePath) {
  try {
    execSync(`npx js-beautify -f "${toSlash(filePath)}" -o "${toSlash(filePath)}"`, {
      cwd: ROOT,
      stdio: 'pipe',
    });
  } catch (error) {
    console.warn(`  Warning: js-beautify failed for ${basename(filePath)}: ${error.message}`);
  }
}

/**
 * Download a GitHub zip archive and extract specific paths.
 * Uses PowerShell Expand-Archive on Windows to avoid tar colon issues.
 * @param {string} zipUrl
 * @param {string} destDir
 * @param {string | null} subdir - subdirectory to extract (e.g. 'src'), or null
 * @param {string[] | null} files - specific files to extract, or null for entire subdir
 */
async function downloadAndExtractZip(zipUrl, destDir, subdir, files) {
  await mkdir(TEMP, { recursive: true });
  const zipPath = join(TEMP, `archive-${Date.now()}.zip`);

  await downloadFile(zipUrl, zipPath);
  await mkdir(destDir, { recursive: true });

  // Extract using PowerShell (avoids tar colon issue on Windows)
  const extractDir = join(TEMP, `extract-${Date.now()}`);
  await mkdir(extractDir, { recursive: true });
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`,
    { stdio: 'pipe' },
  );

  // GitHub archives have a single root dir like "owner-repo-hash/"
  const entries = readdirSync(extractDir);
  if (entries.length === 0) throw new Error('Empty archive');
  const archiveRoot = join(extractDir, entries[0]);

  if (subdir) {
    const source = join(archiveRoot, subdir);
    if (existsSync(source)) {
      await copyRecursive(source, join(destDir, subdir));
    } else {
      // Try to find it — list what's in the archive root
      const available = readdirSync(archiveRoot).join(', ');
      throw new Error(`Subdirectory "${subdir}" not found. Available: ${available}`);
    }
  } else if (files) {
    for (const file of files) {
      const source = join(archiveRoot, file);
      if (existsSync(source)) {
        await copyFile(source, join(destDir, file));
      } else {
        console.warn(`  Warning: "${file}" not found in archive, skipping`);
      }
    }
  }

  await rm(zipPath, { force: true });
  await rm(extractDir, { recursive: true, force: true });
}

/**
 * Recursively copy a directory using Node.js fs (no shell commands).
 * @param {string} source
 * @param {string} dest
 */
async function copyRecursive(source, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyRecursive(sourcePath, destPath);
    } else {
      await copyFile(sourcePath, destPath);
    }
  }
}

/**
 * Extract game script URL from the HTML page.
 * The game uses an inline script that dynamically builds the URL:
 *   s.src = (m()?'script':'intel')+'@'+v+'.'+hash+'.js'
 * @param {string} html
 * @returns {string | null}
 */
function extractGameScriptUrl(html) {
  // The inline script contains: const v='0.6.0',hs='hash.1',hi='hash2'
  // and builds: (m()?'script':'intel')+'@'+v+'.'+(m()?hs:hi)+'.js'
  // We want the mobile (script) variant.
  const versionMatch = html.match(/const\s+v\s*=\s*'([\d.]+)'\s*,\s*hs\s*=\s*'([^']+)'/);
  if (versionMatch) {
    return `script@${versionMatch[1]}.${versionMatch[2]}.js`;
  }

  // Fallback: look for any script@version pattern in the HTML
  const fallback = html.match(/((?:script|intel)@[\d.]+\.[a-f0-9.]+\.js)/);
  if (fallback) return fallback[1];

  return null;
}

/** @param {string} name @param {string} location @param {string} source */
function ok(name, location, source) {
  manifest.push({ name, location, source, status: 'ok' });
  console.log(`  OK: ${name}`);
}

/** @param {string} name @param {string} source @param {string} error */
function fail(name, source, error) {
  manifest.push({ name, location: '', source, status: 'error', error });
  console.error(`  FAIL: ${name} — ${error}`);
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

async function fetchEuiSources() {
  const dest = join(REFS, 'eui');
  await downloadAndExtractZip(URLS.euiZipball, dest, 'src', null);
  ok('EUI sources', 'eui/src/', URLS.euiZipball);
}

async function fetchCuiSources() {
  const dest = join(REFS, 'cui', 'index.js');
  await downloadFile(URLS.cuiSource, dest);
  prettify(dest);
  ok('CUI source', 'cui/index.js', URLS.cuiSource);
}

async function fetchEuiRelease() {
  const dest = join(REFS, 'releases', 'eui.user.js');
  await downloadFile(URLS.euiRelease, dest);
  beautify(dest);
  ok('EUI release', 'releases/eui.user.js', URLS.euiRelease);
}

async function fetchCuiRelease() {
  const dest = join(REFS, 'releases', 'cui.user.js');
  await downloadFile(URLS.cuiRelease, dest);
  beautify(dest);
  ok('CUI release', 'releases/cui.user.js', URLS.cuiRelease);
}

async function fetchOlBundle() {
  const dest = join(REFS, 'ol', 'ol.js');
  await downloadFile(URLS.olBundle, dest);
  beautify(dest);
  ok('OpenLayers 10.6.0', 'ol/ol.js', URLS.olBundle);
}

/** Fetch game page HTML + extract and download game script. */
async function fetchGameAssets() {
  const response = await fetchUrl(URLS.gamePage);
  const html = await response.text();
  const htmlDest = join(REFS, 'game', 'index.html');
  await mkdir(join(REFS, 'game'), { recursive: true });
  await writeFile(htmlDest, html, 'utf-8');
  prettify(htmlDest, 'html');
  ok('Game HTML', 'game/index.html', URLS.gamePage);

  // Extract and download game script
  const scriptRelativeUrl = extractGameScriptUrl(html);
  if (scriptRelativeUrl) {
    const scriptUrl = new URL(scriptRelativeUrl, URLS.gamePage).href;
    const scriptDest = join(REFS, 'game', 'script.js');
    try {
      await downloadFile(scriptUrl, scriptDest);
      prettify(scriptDest);
      ok('Game script', 'game/script.js', scriptUrl);
    } catch (error) {
      fail('Game script', scriptUrl, error.message);
    }
  } else {
    const preview = html.substring(0, 500);
    fail(
      'Game script',
      URLS.gamePage,
      `Could not extract script URL from HTML. Preview:\n${preview}`,
    );
  }
}

function generateScoutReadme() {
  return `# SBG Scout

Android-приложение, которое оборачивает [sbg-game.ru/app](https://sbg-game.ru/app) в нативный WebView и включает встроенный менеджер юзерскриптов. Vanilla+ устанавливается и обновляется через Scout автоматически.

- Репозиторий: https://github.com/wrager/sbg-scout
- Релизы: https://github.com/wrager/sbg-scout/releases

Эта папка — **только справочник**. Источники/релизы Scout сюда автоматически не выкачиваются: Scout — нативное Android-приложение (Kotlin/Java), взаимодействие юзерскрипта с ним исчерпывается UA-детектом и поведением WebView, а не чтением его исходников.

## Детект

Scout добавляет в \`navigator.userAgent\` суффикс \`SbgScout/<version>\`. Канонический детект — функция \`isSbgScout()\` из \`src/core/host.ts\`. Напрямую матчить \`navigator.userAgent\` в модулях запрещено — всегда через \`host.ts\`.

\`\`\`ts
import { isSbgScout } from '../../core/host';

if (isSbgScout()) {
  // Код, специфичный для Scout
}
\`\`\`

## Особенности окружения

- **WebView, а не браузер.** Нет полноценной адресной строки, часть UX (bookmarks, share) перенесена в нативные меню Scout. Tampermonkey/Violentmonkey не используются — менеджер скриптов встроен в сам Scout.
- **Нативное управление экраном.** Scout сам определяет, когда экран должен оставаться включённым (геолокационная игра), поэтому Wake Lock API изнутри WebView в лучшем случае дублирует поведение хоста, а в худшем конфликтует с ним. См. ниже «Несовместимые модули».
- **Собственная строка в игровом меню настроек.** Игра рендерит внутри \`.settings-content\` отдельный \`.settings-section__item\` с текстом «SBG Scout», ведущий в нативный экран Scout. Vanilla+ использует эту строку как якорь для вставки своего пункта настроек (см. [src/core/settings/ui.ts](../../src/core/settings/ui.ts)): в Scout пункт SVP встаёт после неё, а в обычном браузере — в начале списка.
- **Установка/обновление юзерскриптов.** Scout сам скачивает релизы \`sbg-vanilla-plus.user.js\` с GitHub и ставит их в WebView — шаг «поставить Tampermonkey» для пользователя Scout отсутствует, и в README инструкция по установке в Scout отличается от инструкции для обычного браузера.

## Модули, несовместимые со Scout

Список централизован в [src/core/host.ts](../../src/core/host.ts) (\`DISALLOWED_IN_SCOUT\`). Для таких модулей \`bootstrap()\` принудительно выставляет \`false\` в \`svp_settings.modules[id]\`, а settings-UI рендерит чекбокс как \`disabled + unchecked\`.

| Модуль         | Причина несовместимости                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| \`keepScreenOn\` | Scout нативно управляет экраном. Wake Lock API из WebView дублирует/конфликтует с хостом, модуль там вреден. |

Если появляется новый несовместимый модуль — добавлять id в \`DISALLOWED_IN_SCOUT\` в \`host.ts\` и строку в таблицу выше.
`;
}

function generateReadme() {
  const timestamp = new Date().toISOString();
  const rows = manifest
    .map((entry) => {
      const status = entry.status === 'ok' ? 'OK' : `FAIL: ${entry.error}`;
      return `| ${entry.name} | \`${entry.location}\` | ${status} |`;
    })
    .join('\n');

  return `# Reference Scripts

Auto-generated by \`npm run refs:fetch\`. Do not edit manually.

Last fetched: ${timestamp}

## Contents

| Reference | Location | Status |
|-----------|----------|--------|
${rows}

## Automatic content

Everything except \`game/dom/\`, \`game/css/\`, \`screenshots/\` and \`scout/\` is downloaded automatically.
Re-run \`npm run refs:fetch\` to update (manual content is preserved).

## Manual content

Stub files with instructions are created automatically on first run.
Open the stub file for details on how to populate it.

- \`game/dom/body.html\` — rendered DOM (from DevTools)
- \`game/css/variables.css\` — :root CSS custom properties (from DevTools)
- \`screenshots/\` — UI screenshots
- \`scout/\` — справочник по SBG Scout (хост-приложение Android)
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Fetching references...\n');

  // Preserve manual content directories
  const manualDirs = [
    join(REFS, 'game', 'dom'),
    join(REFS, 'game', 'css'),
    join(REFS, 'screenshots'),
    join(REFS, 'scout'),
  ];
  const preservedPaths = [];
  for (const dir of manualDirs) {
    if (existsSync(dir)) {
      const tempDest = join(TEMP, basename(dir));
      await mkdir(TEMP, { recursive: true });
      await copyRecursive(dir, tempDest);
      preservedPaths.push({ original: dir, temp: tempDest });
    }
  }

  // Clean auto-generated content
  if (existsSync(REFS)) {
    for (const entry of readdirSync(REFS)) {
      if (entry === '.tmp') continue;
      await rm(join(REFS, entry), { recursive: true, force: true });
    }
  }

  // Create directory structure
  const dirs = [
    join(REFS, 'eui'),
    join(REFS, 'cui'),
    join(REFS, 'ol'),
    join(REFS, 'game', 'dom'),
    join(REFS, 'game', 'css'),
    join(REFS, 'releases'),
    join(REFS, 'screenshots'),
    join(REFS, 'scout'),
  ];
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }

  // Restore preserved manual content
  for (const { original, temp } of preservedPaths) {
    await rm(original, { recursive: true, force: true });
    await copyRecursive(temp, original);
  }

  // Create stub files with instructions for manual content
  const stubs = [
    {
      path: join(REFS, 'game', 'dom', 'body.html'),
      content: [
        '<!--',
        '  Rendered DOM of the game page.',
        '  How to get:',
        '  1. Open https://sbg-game.ru/app/ in browser',
        '  2. Open DevTools → Elements',
        '  3. Right-click <body> → Copy → Copy outerHTML',
        '  4. Replace this file contents with the result',
        '-->',
        '',
      ].join('\n'),
    },
    {
      path: join(REFS, 'game', 'css', 'variables.css'),
      content: [
        '/*',
        ' * :root CSS custom properties of the game.',
        ' * Variables are set dynamically via JS, so they cannot be extracted automatically.',
        ' * How to get:',
        ' * 1. Open https://sbg-game.ru/app/ in browser',
        ' * 2. Open DevTools → Console',
        " * 3. Run: copy([...document.styleSheets].flatMap(s => { try { return [...s.cssRules] } catch { return [] } }).filter(r => r.selectorText === ':root').map(r => r.cssText).join('\\n'))",
        ' * 4. Replace this file contents with the result',
        ' */',
        '',
      ].join('\n'),
    },
    {
      path: join(REFS, 'scout', 'README.md'),
      content: generateScoutReadme(),
    },
  ];
  for (const stub of stubs) {
    if (!existsSync(stub.path)) {
      await writeFile(stub.path, stub.content, 'utf-8');
    }
  }

  // Fetch everything in parallel (except game assets which have dependencies)
  await Promise.allSettled([
    fetchEuiSources().catch((error) => fail('EUI sources', URLS.euiZipball, error.message)),
    fetchCuiSources().catch((error) => fail('CUI sources', URLS.cuiZipball, error.message)),
    fetchEuiRelease().catch((error) => fail('EUI release', URLS.euiRelease, error.message)),
    fetchCuiRelease().catch((error) => fail('CUI release', URLS.cuiRelease, error.message)),
    fetchOlBundle().catch((error) => fail('OL bundle', URLS.olBundle, error.message)),
    fetchGameAssets().catch((error) => fail('Game assets', URLS.gamePage, error.message)),
  ]);

  // Generate README
  const readme = generateReadme();
  await writeFile(join(REFS, 'README.md'), readme, 'utf-8');
  console.log('  OK: README.md');

  // Cleanup temp
  await rm(TEMP, { recursive: true, force: true });

  // Summary
  const succeeded = manifest.filter((entry) => entry.status === 'ok').length;
  const failed = manifest.filter((entry) => entry.status === 'error').length;
  console.log(`\nDone: ${succeeded} OK, ${failed} failed`);
  console.log(`Output: ${REFS}`);

  if (failed > 0) process.exit(1);
}

main();
