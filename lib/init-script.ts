export const SETTINGS_KEY = 'arcade-settings'
export const THEME_KEY = 'arcade-theme'

/** Runs before first paint so the page never flashes the wrong theme. Keep in sync with applySettingsToDocument. */
export const SETTINGS_INIT_SCRIPT = `try{var s=JSON.parse(localStorage.getItem('${SETTINGS_KEY}')||'{}');var t=localStorage.getItem('${THEME_KEY}')||s.theme||'system';if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'midnight':'standard';var e=document.documentElement;e.setAttribute('data-theme',t);e.setAttribute('data-density',s.density||'comfortable');e.setAttribute('data-scale',s.fontScale||'md');if(s.reduceMotion)e.setAttribute('data-reduce-motion','')}catch(_){}`
