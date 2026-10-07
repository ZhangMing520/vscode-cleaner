import { computed, ref } from 'vue';
import { darkTheme } from 'naive-ui';
import type { GlobalThemeOverrides } from 'naive-ui';

// VS Code 会给 webview 的 body 挂 vscode-dark / vscode-light / vscode-high-contrast(-light)。
// 主题可运行时切换，用 MutationObserver 监听 body class 变化并使所有派生值失效。
const themeVersion = ref(0);
const isDark = ref(true);

function refresh(): void {
  const cls = document.body.classList;
  isDark.value =
    cls.contains('vscode-dark') ||
    (cls.contains('vscode-high-contrast') && !cls.contains('vscode-high-contrast-light'));
  themeVersion.value++;
}
refresh();
new MutationObserver(refresh).observe(document.body, { attributes: true, attributeFilter: ['class'] });

/** 读取 VS Code CSS 变量；内部读取 themeVersion 使 computed 调用方对主题切换响应。 */
export function vvar(name: string, fallback = ''): string {
  void themeVersion.value;
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

export const theme = computed(() => (isDark.value ? darkTheme : null));

/**
 * 把 VS Code 的 --vscode-* token 映射到 Naive 主题。仅覆盖决定"像不像编辑器"的核心 token
 * （背景/前景/边框/主色/输入底色），其余交给 Naive 的 darkTheme / lightTheme 基座。
 */
export const themeOverrides = computed<GlobalThemeOverrides>(() => {
  const bg = vvar('--vscode-editor-background', isDark.value ? '#1e1e1e' : '#ffffff');
  const fg = vvar('--vscode-editor-foreground', isDark.value ? '#cccccc' : '#333333');
  const desc = vvar('--vscode-descriptionForeground', isDark.value ? '#999999' : '#717171');
  const border = vvar('--vscode-panel-border', isDark.value ? '#333333' : '#dddddd');
  const btnBg = vvar('--vscode-button-background', '#0e639c');
  const inputBg = vvar('--vscode-input-background', isDark.value ? '#3c3c3c' : '#ffffff');
  const widget = vvar('--vscode-editorWidget-background', bg);

  return {
    common: {
      fontFamily: vvar('--vscode-font-family', 'sans-serif'),
      fontSize: '13px',
      fontSizeSmall: '12px',
      bodyColor: bg,
      textColorBase: fg,
      textColor1: fg,
      textColor2: fg,
      textColor3: desc,
      borderColor: border,
      dividerColor: border,
      primaryColor: btnBg,
      primaryColorHover: btnBg,
      primaryColorPressed: btnBg,
      primaryColorFocus: btnBg,
      inputColor: inputBg,
      hoverColor: widget,
      modalColor: bg,
      popoverColor: widget,
      cardColor: bg,
      actionColor: widget,
      errorColor: vvar('--vscode-errorForeground', '#f66'),
    },
    DataTable: {
      thColor: 'transparent',
      tdColor: 'transparent',
      thColorHover: widget,
      tdColorHover: widget,
      borderColor: border,
    },
  };
});

/** 次要按钮（"删除所选"）配色，随主题切换。 */
export const secondaryButton = computed(() => ({
  bg: vvar('--vscode-button-secondaryBackground', isDark.value ? '#3a3d41' : '#e4e4e4'),
  fg: vvar('--vscode-button-secondaryForeground', isDark.value ? '#ffffff' : '#333333'),
}));
