import * as vscode from 'vscode';
import { en } from './en';
import { zhCn } from './zh-cn';

type Bundle = Record<string, string>;

const bundles: Record<string, Bundle> = {
  en,
  'zh-cn': zhCn,
};

/** 替换 {name} 占位符。 */
function substitute(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
  }
  return s;
}

/** 依据 VS Code 当前语言选择语言包；中文（zh*）用 zh-cn，其余回退英文。 */
export function activeBundle(): Bundle {
  const lang = (vscode.env.language || 'en').toLowerCase();
  if (lang.startsWith('zh')) {
    return bundles['zh-cn'];
  }
  return bundles.en;
}

/** 取字符串，支持 {name} 占位符替换；缺失时回退英文，再回退 key 本身。 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const bundle = activeBundle();
  return substitute(bundle[key] ?? en[key] ?? key, vars);
}

/** 当前 VS Code 语言对应的内置 locale 键。 */
export function defaultLocale(): string {
  const lang = (vscode.env.language || 'en').toLowerCase();
  return lang.startsWith('zh') ? 'zh-cn' : 'en';
}

/** 返回全部语言包，供 Webview 内置语言切换器使用。 */
export function getAllBundles(): Record<string, Bundle> {
  return bundles;
}

/** 按指定 locale 取字符串（支持 {name} 占位符），用于 Webview 切换语言后的宿主侧提示。 */
export function tWith(locale: string, key: string, vars?: Record<string, string | number>): string {
  const bundle = bundles[locale] || bundles.en;
  return substitute(bundle[key] ?? en[key] ?? key, vars);
}
