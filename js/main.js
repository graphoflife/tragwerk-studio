// Entry point.
import { App } from './ui/app.js';
import { toast } from './ui/dom.js';
import { getLang } from './i18n.js';

document.documentElement.lang = getLang();

window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
  toast(String(e.message || e.error), 'err', 6000);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
  toast(String(e.reason?.message || e.reason), 'err', 6000);
});

window.app = new App(document.getElementById('app'));
