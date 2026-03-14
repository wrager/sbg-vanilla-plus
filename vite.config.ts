import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import { SBG_COMPATIBLE_VERSION } from './src/core/gameVersion';

const NAMESPACE = 'https://github.com/wrager/sbg-vanilla-plus';
const MATCH = 'https://sbg-game.ru/app/*';
const DOWNLOAD_BASE = 'https://github.com/wrager/sbg-vanilla-plus/releases/latest/download';
const FILENAME = 'sbg-vanilla-plus';

export default defineConfig(({ command }) => {
  const isDev = command === 'serve';

  const name = 'SBG Vanilla+';
  const description = `UI/UX enhancements for SBG (SBG v${SBG_COMPATIBLE_VERSION})`;

  return {
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    plugins: [
      monkey({
        entry: 'src/entry.ts',
        userscript: {
          name: isDev ? `${name} [DEV]` : name,
          namespace: NAMESPACE,
          version: '0.1.0',
          description,
          author: 'wrager',
          match: [MATCH],
          'run-at': 'document-idle',
          grant: 'none',
          license: 'MIT',
          ...(isDev
            ? {}
            : {
                downloadURL: `${DOWNLOAD_BASE}/${FILENAME}.user.js`,
                updateURL: `${DOWNLOAD_BASE}/${FILENAME}.meta.js`,
              }),
        },
        build: {
          fileName: `${FILENAME}.user.js`,
          metaFileName: `${FILENAME}.meta.js`,
        },
      }),
    ],
  };
});
