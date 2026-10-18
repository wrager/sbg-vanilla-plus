import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import MagicString from 'magic-string';
import { defineConfig, type LibraryOptions, type Plugin } from 'vite';
import monkey, { type MonkeyUserScript } from 'vite-plugin-monkey';
import { version } from './package.json';
import { SBG_COMPATIBLE_VERSIONS } from './src/core/gameVersion';

const NAMESPACE = 'https://github.com/wrager/sbg-vanilla-plus';
const MATCHES = ['https://sbg-game.ru/app/*', 'https://beta.sbg-game.ru/app/*'];
const DOWNLOAD_BASE = 'https://github.com/wrager/sbg-vanilla-plus/releases/latest/download';
const FILENAME = 'sbg-vanilla-plus';

function userscriptHeader(metadata: Record<string, string | string[]>): string {
  const lines = Object.entries(metadata).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value]).map((entry) => `// @${key} ${entry}`),
  );
  return ['// ==UserScript==', ...lines, '// ==/UserScript=='].join('\n');
}

function debugMetadata(metadata: Record<string, string | string[]>): Plugin {
  let bundleUrl = '';
  return {
    name: 'svp-debug-metadata',
    configResolved(config) {
      bundleUrl = pathToFileURL(
        resolve(config.root, config.build.outDir, `${FILENAME}.user.js`),
      ).href;
    },
    renderChunk: {
      order: 'post',
      handler(code) {
        // A Rollup banner is stripped by Vite's final esbuild pass. Add it afterwards
        // and return a map so Rollup composes its line offset with the TypeScript map.
        const output = new MagicString(code);
        output.prepend(`${userscriptHeader(metadata)}\n`);
        return { code: output.toString(), map: output.generateMap({ hires: true }) };
      },
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: `${FILENAME}.meta.js`,
        source: `${userscriptHeader(metadata)}\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: `${FILENAME}.local.user.js`,
        source: `${userscriptHeader({
          ...metadata,
          name: 'SBG Vanilla+ [LOCAL]',
          require: bundleUrl,
        })}\n`,
      });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const isDev = command === 'serve';
  const isDebug = !isDev && mode === 'debug';
  const isRelease = !isDev && !isDebug;

  const name = 'SBG Vanilla+';
  // Префикс версии - у каждой: со списком из двух и более записей `v` перед
  // первой читается как часть номера только для неё.
  const supportedVersions = SBG_COMPATIBLE_VERSIONS.map((sbgVersion) => `v${sbgVersion}`).join(
    ' / ',
  );
  const description = `UI/UX enhancements for SBG ${supportedVersions}`;
  const userscript = {
    name: isDev ? `${name} [DEV]` : isDebug ? `${name} [DEBUG]` : name,
    namespace: NAMESPACE,
    version,
    description,
    author: 'wrager',
    match: MATCHES,
    'run-at': 'document-start',
    grant: 'none',
    license: 'MIT',
    ...(isRelease
      ? {
          downloadURL: `${DOWNLOAD_BASE}/${FILENAME}.user.js`,
          updateURL: `${DOWNLOAD_BASE}/${FILENAME}.meta.js`,
        }
      : {}),
  } satisfies MonkeyUserScript;

  return {
    define: {
      __SVP_VERSION__: JSON.stringify(version),
    },
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      open: false,
      hmr: false,
      cors: { origin: ['https://sbg-game.ru', 'https://beta.sbg-game.ru'] },
    },
    build: {
      outDir: isDebug ? 'dist/debug' : 'dist/release',
      emptyOutDir: true,
      minify: isRelease ? 'esbuild' : false,
      sourcemap: isDebug ? 'inline' : false,
      ...(isDebug
        ? {
            lib: {
              entry: 'src/entry.ts',
              name: 'SbgVanillaPlus',
              formats: ['iife'],
              fileName: () => `${FILENAME}.user.js`,
            } satisfies LibraryOptions,
          }
        : {}),
    },
    esbuild: {
      keepNames: true,
    },
    // vite-plugin-monkey 5 disables source maps, including in its second bundling pass.
    // Native library mode keeps debug maps accurate through the userscript banner.
    plugins: isDebug
      ? [debugMetadata(userscript)]
      : [
          monkey({
            entry: 'src/entry.ts',
            server: { open: false, prefix: false },
            userscript,
            build: {
              fileName: `${FILENAME}.user.js`,
              metaFileName: `${FILENAME}.meta.js`,
            },
          }),
        ],
  };
});
