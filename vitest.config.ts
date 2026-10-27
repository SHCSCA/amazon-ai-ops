import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Local evidence and backups are artifacts, never an executable test source.
    include: ['{apps,packages,scripts}/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    pool: 'forks',
    // 真实浏览器与原生夹具按文件串行，隔离回归资源。
    fileParallelism: false,
    maxWorkers: 4,
    minWorkers: 1,
  },
});
