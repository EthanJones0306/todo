'use client'

import { useCallback, useEffect, useState } from 'react'
import { Category, Theme } from '@/types'
import { SETTINGS_KEY, THEME_KEY } from '@/lib/init-script'

export type ThemeChoice = 'system' | Theme
export type Density = 'comfortable' | 'compact'
export type FontScale = 'sm' | 'md' | 'lg'
export type SortOrder = 'manual' | 'due' | 'alpha'

export interface Settings {
  theme: ThemeChoice
  density: Density
  fontScale: FontScale
  reduceMotion: boolean
  name: string
  defaultCategory: Category
  sort: SortOrder
  showCompleted: boolean
  confirmDelete: boolean
  weekStartsOn: 0 | 1
  sidebarCollapsed: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  density: 'comfortable',
  fontScale: 'md',
  reduceMotion: false,
  name: '',
  defaultCategory: 'once',
  sort: 'manual',
  showCompleted: true,
  confirmDelete: false,
  weekStartsOn: 1,
  sidebarCollapsed: false,
}

const CHANGE_EVENT = 'arcade-settings-change'

export function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  let stored: Partial<Settings> = {}
  try {
    stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
  } catch {}
  // The theme predates the settings object and is still read by the pre-paint script.
  const theme = (localStorage.getItem(THEME_KEY) as ThemeChoice | null) ?? stored.theme
  return { ...DEFAULT_SETTINGS, ...stored, ...(theme ? { theme } : {}) }
}

export function resolveTheme(choice: ThemeChoice): Theme {
  if (choice !== 'system') return choice
  if (typeof window === 'undefined') return 'standard'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'midnight' : 'standard'
}

export function applySettingsToDocument(s: Settings): void {
  const el = document.documentElement
  el.setAttribute('data-theme', resolveTheme(s.theme))
  el.setAttribute('data-density', s.density)
  el.setAttribute('data-scale', s.fontScale)
  el.toggleAttribute('data-reduce-motion', s.reduceMotion)
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  localStorage.setItem(THEME_KEY, s.theme)
  applySettingsToDocument(s)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)

  useEffect(() => {
    const sync = () => setSettings(loadSettings())
    sync()
    window.addEventListener(CHANGE_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  // Follow the OS appearance while the theme is "system".
  useEffect(() => {
    if (settings.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applySettingsToDocument(settings)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [settings])

  const update = useCallback((patch: Partial<Settings>) => {
    const next = { ...loadSettings(), ...patch }
    saveSettings(next)
    setSettings(next)
  }, [])

  return [settings, update]
}
