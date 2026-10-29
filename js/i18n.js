// Minimal i18n: the German UI string is the key; other languages map from it.
import { EN } from './i18n-en.js';

const DICTS = { en: EN };
let lang = 'de';
try {
  const saved = localStorage.getItem('ts.lang');
  lang = saved || ((navigator.language || 'de').toLowerCase().startsWith('de') ? 'de' : 'en');
} catch (e) { /* storage unavailable */ }

export function getLang() { return lang; }

export function setLang(l) {
  lang = l;
  try { localStorage.setItem('ts.lang', l); } catch (e) { /* ignore */ }
  document.documentElement.lang = l;
}

export function t(key, params) {
  let s = (lang !== 'de' && DICTS[lang]?.[key]) || key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m));
  return s;
}
