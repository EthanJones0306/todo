export type Category = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom'
export type RecurrenceDays = number[]
export type Mode = 'personal' | 'work'
export type Theme = 'neon' | 'crt' | 'paper' | 'standard' | 'midnight' | 'forest' | 'sunset' | 'nord' | 'slate' | 'stone' | 'zinc' | 'monochrome'
export type Filter = 'all' | Category
export type PhaseStatus = 'pending' | 'active' | 'done'

export interface Todo {
  id: string
  text: string
  done: boolean
  category: Category
  dueDate?: string
  recurrenceDays?: RecurrenceDays
  completedAt?: string
  originalId?: string
  isProject?: boolean
  projectId?: string
}

export interface Phase {
  id: string
  projectId: string
  title: string
  description: string
  order: number
  status: PhaseStatus
  dueDate?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface Project {
  id: string
  sourceTodoId: string
  title: string
  description: string
  phases: Phase[]
  createdAt: string
  updatedAt: string
  mode: Mode
}

export const CATEGORY_ORDER: Category[] = ['once', 'daily', 'weekly', 'monthly', 'custom']
export const CATEGORY_LABEL: Record<Category, string> = {
  once: 'One-off',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'Custom...',
}

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const FILTER_ORDER: Filter[] = ['all', 'daily', 'weekly', 'monthly', 'custom', 'once']
export const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'Custom',
  once: 'One-off',
}

export const MODE_ORDER: Mode[] = ['personal', 'work']
export const MODE_LABEL: Record<Mode, string> = {
  personal: 'Personal',
  work: 'Work',
}

export const PHASE_STATUS_ORDER: PhaseStatus[] = ['pending', 'active', 'done']
export const PHASE_STATUS_LABEL: Record<PhaseStatus, string> = {
  pending: 'Pending',
  active: 'In Progress',
  done: 'Done',
}

export const PHASE_STATUS_COLOR: Record<PhaseStatus, string> = {
  pending: 'var(--text-dim)',
  active: 'var(--primary)',
  done: 'var(--secondary)',
}