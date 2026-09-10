import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Local evidence and backups are artifacts, never an executable test source.
    include: ['{apps,packages,scripts}/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    pool: 'forks',
    maxWorkers: 4,
    minWorkers: 1,
  },
});
