import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// 产物固定为 media/main.js + media/main.css：宿主侧 report.ts 直接按固定文件名
// asWebviewUri 引用，不做 hash 文件名发现。Vite 默认会输出带 hash 的名字，必须在此固定。
export default defineConfig({
  root: fileURLToPath(new URL('./webview', import.meta.url)),
  base: '',
  plugins: [vue()],
  build: {
    outDir: fileURLToPath(new URL('./media', import.meta.url)),
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      output: {
        entryFileNames: 'main.js',
        assetFileNames: 'main.[ext]',
      },
    },
  },
});
