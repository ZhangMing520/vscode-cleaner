import { ref } from 'vue';
import { bootstrap } from './bootstrap';

/** 当前 UI 语言；与宿主注入的语言包键（'en' | 'zh-cn'）对应。 */
export const locale = ref<string>(bootstrap.locale);

export const LANGS = bootstrap.langs;

/** 文案查找：当前语言 → 英文回退 → 给定缺省值。 */
function lookup(key: string, fallback: string): string {
  const b = LANGS[locale.value] || LANGS.en;
  return (b && b[key]) || LANGS.en[key] || fallback;
}

/** 替换 {name} 占位符（全局），与宿主 src/i18n substitute 语义一致。 */
function substitute(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
  }
  return s;
}

/** 必选文案：缺失时回退 key 本身；支持 {name} 占位符。 */
export function S(key: string, vars?: Record<string, string | number>): string {
  return substitute(lookup(key, key), vars);
}

/** 可选文案（desc/tip）：缺失时返回空串而非泄漏 key；支持占位符。 */
export function Sopt(key: string, vars?: Record<string, string | number>): string {
  return substitute(lookup(key, ''), vars);
}
