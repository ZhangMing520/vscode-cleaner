/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<Record<string, never>, Record<string, never>, any>;
  export default component;
}

/** VS Code webview 注入的全局 API，整个页面只允许调用一次。消息形状与宿主共用 src/types.ts。 */
declare function acquireVsCodeApi(): {
  postMessage(msg: import('../../src/types').WebviewToHostMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};
