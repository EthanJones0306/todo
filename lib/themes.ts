import { Theme } from '@/types'

export interface ThemeMeta {
  id: Theme
  label: string
  tone: 'light' | 'dark'
  /** bg, surface, accent, text — used for the preview swatch */
  swatch: [string, string, string, string]
  /** Has an animated background (still when motion is reduced). */
  motion?: boolean
}

export const THEMES: ThemeMeta[] = [
  { id: 'pch', label: 'PCH', tone: 'light', swatch: ['#f4f6f9', '#ffffff', '#002F6C', '#002F6C'] },
  { id: 'standard', label: 'Standard', tone: 'light', swatch: ['#f7f7f8', '#ffffff', '#5b5bd6', '#0f1115'] },
  { id: 'slate', label: 'Slate', tone: 'light', swatch: ['#f6f8fa', '#ffffff', '#3b4a63', '#0f172a'] },
  { id: 'stone', label: 'Stone', tone: 'light', swatch: ['#f7f6f3', '#ffffff', '#7c5b3a', '#1c1917'] },
  { id: 'zinc', label: 'Zinc', tone: 'light', swatch: ['#f7f7f7', '#ffffff', '#18181b', '#09090b'] },
  { id: 'monochrome', label: 'Mono', tone: 'light', swatch: ['#ffffff', '#ffffff', '#000000', '#000000'] },
  { id: 'swell', label: 'Swell', tone: 'light', motion: true, swatch: ['#e5e8eb', '#ffffff', '#2340c8', '#0f1633'] },
  { id: 'contour', label: 'Contour', tone: 'light', motion: true, swatch: ['#f6e6cc', '#fffaf2', '#b2441a', '#3a1d0e'] },
  { id: 'paper', label: 'Paper', tone: 'light', swatch: ['#efe6cf', '#f8f2e1', '#7a3b1d', '#241c14'] },
  { id: 'midnight', label: 'Midnight', tone: 'dark', swatch: ['#0b0d12', '#151922', '#8b8cf8', '#eef0f5'] },
  { id: 'nord', label: 'Nord', tone: 'dark', swatch: ['#2e3440', '#3b4252', '#88c0d0', '#eceff4'] },
  { id: 'forest', label: 'Forest', tone: 'dark', swatch: ['#0b120e', '#131d17', '#4ade80', '#e7f3ea'] },
  { id: 'sunset', label: 'Sunset', tone: 'dark', swatch: ['#160d0c', '#221614', '#fb923c', '#fff4ec'] },
  { id: 'neon', label: 'Neon', tone: 'dark', swatch: ['#0c0820', '#1c1240', '#ff2ec4', '#f3eeff'] },
  { id: 'terraces', label: 'Terraces', tone: 'dark', motion: true, swatch: ['#e31b32', '#3a0710', '#5ce4ec', '#e8feff'] },
  { id: 'swarm', label: 'PCH Swarm', tone: 'dark', motion: true, swatch: ['#00245a', '#00204e', '#5fb4d0', '#f2f6fb'] },
  { id: 'aurora', label: 'Aurora', tone: 'dark', motion: true, swatch: ['#03090f', '#0b1a22', '#5be39a', '#eafff3'] },
  { id: 'nightsky', label: 'Night sky', tone: 'dark', motion: true, swatch: ['#1c2836', '#26364a', '#9ec5da', '#e3edf3'] },
  { id: 'crt', label: 'CRT', tone: 'dark', swatch: ['#050805', '#0a120a', '#39ff14', '#c8ffc0'] },
]
