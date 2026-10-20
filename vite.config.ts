import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { renderTableHtml } from './src/table';
import type { Dataset } from './src/types';

function readDataset(): Dataset {
  try {
    return JSON.parse(readFileSync('data/dataset.json', 'utf8')) as Dataset;
  } catch (error) {
    throw new Error(
      `Cannot read data/dataset.json (run \`npm run data:build\` first): ${(error as Error).message}`,
    );
  }
}

/**
 * Bake the data table into index.html at build time.
 *
 * The table is the no-JavaScript fallback and the screen-reader equivalent of
 * the chart, so it must exist in the served HTML rather than being injected by
 * the same script the chart needs.
 */
function injectTable(): Plugin {
  return {
    name: 'inject-dataset-table',
    transformIndexHtml(html: string) {
      if (!html.includes('<!--DATASET_TABLE-->')) return html;
      const dataset = readDataset();
      return html.replace(
        '<!--DATASET_TABLE-->',
        renderTableHtml(dataset, {
          plan: 'go',
          index: 'artificial_analysis_intelligence_index',
        }),
      );
    },
  };
}

export default defineConfig({
  base: '/opencode-pareto/',
  plugins: [injectTable()],
  build: { target: 'es2022' },
});
