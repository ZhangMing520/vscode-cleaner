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

/** 必选文案：缺失时回退 key 本身。 */
export function S(key: string): string {
  return lookup(key, key);
}

/** 可选文案（desc/tip）：缺失时返回空串而非泄漏 key。 */
export function Sopt(key: string): string {
  return lookup(key, '');
}
