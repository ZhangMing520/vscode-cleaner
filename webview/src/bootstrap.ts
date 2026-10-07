import type { CleanerBootstrap } from '../../src/types';

/**
 * 宿主通过带 nonce 的内联 bootstrap 脚本注入的数据（见 src/report.ts）。
 * 类型与宿主共用 src/types.ts 的 CleanerBootstrap，langs 与宿主侧 src/i18n 语言包同源。
 */
declare global {
  interface Window {
    __CLEANER__?: CleanerBootstrap;
  }
}

const fallback: CleanerBootstrap = { items: [], langs: { en: {} }, locale: 'en' };

export const bootstrap: CleanerBootstrap = window.__CLEANER__ ?? fallback;
