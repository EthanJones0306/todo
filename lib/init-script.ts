export const SETTINGS_KEY = 'arcade-settings'
export const THEME_KEY = 'arcade-theme'
/** Themes that were removed; anyone still on one goes back to System. */
export const RETIRED_THEMES = ['terraces', 'neon', 'crt', 'slate', 'stone', 'zinc', 'nord', 'standard', 'monochrome', 'forest', 'sunset']

/** Runs before first paint so the page never flashes the wrong theme. Keep in sync with applySettingsToDocument. */
export const SETTINGS_INIT_SCRIPT = `try{var s=JSON.parse(localStorage.getItem('${SETTINGS_KEY}')||'{}');var t=localStorage.getItem('${THEME_KEY}')||s.theme||'system';if(${JSON.stringify(RETIRED_THEMES)}.indexOf(t)>-1)t='system';if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'midnight':'pch';var e=document.documentElement;e.setAttribute('data-theme',t);e.setAttribute('data-density',s.density||'comfortable');e.setAttribute('data-scale',s.fontScale||'md');if(s.reduceMotion)e.setAttribute('data-reduce-motion','')}catch(_){}`
