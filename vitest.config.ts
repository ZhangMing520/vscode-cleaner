import { defineConfig } from 'vitest/config';

// 独立于 vite.config.ts（后者 root 指向 webview/，会带偏 vitest 的测试根目录）
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
