import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import { SBG_COMPATIBLE_VERSION } from './src/core/gameVersion';

const NAMESPACE = 'https://github.com/wrager/sbg-vanilla-plus';
const MATCH = 'https://sbg-game.ru/app/*';
const DOWNLOAD_BASE = 'https://github.com/wrager/sbg-vanilla-plus/releases/latest/download';

export default defineConfig(({ mode }) => {
  const isStyle = mode === 'style';

  const name = isStyle ? 'SBG Vanilla+ Style' : 'SBG Vanilla+ Features';
  const description = isStyle
    ? `CSS-only UI enhancements for SBG (SBG v${SBG_COMPATIBLE_VERSION})`
    : `UI/UX enhancements for SBG (SBG v${SBG_COMPATIBLE_VERSION})`;
  const filename = isStyle ? 'sbg-vanilla-plus-style' : 'sbg-vanilla-plus-features';

  return {
    build: {
      outDir: 'dist',
      emptyOutDir: isStyle,
    },
    plugins: [
      monkey({
        entry: isStyle ? 'src/entryStyle.ts' : 'src/entryFeatures.ts',
        userscript: {
          name,
          namespace: NAMESPACE,
          version: '0.1.0',
          description,
          author: 'Alexander Filimonov (wrager)',
          match: [MATCH],
          'run-at': 'document-idle',
          grant: 'none',
          license: 'MIT',
          downloadURL: `${DOWNLOAD_BASE}/${filename}.user.js`,
          updateURL: `${DOWNLOAD_BASE}/${filename}.meta.js`,
        },
        build: {
          fileName: `${filename}.user.js`,
          metaFileName: `${filename}.meta.js`,
        },
      }),
    ],
  };
});
