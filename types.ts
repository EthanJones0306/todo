export type Category = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom'
export type RecurrenceDays = number[]
export type Mode = 'personal' | 'work'
export type Theme = 'neon' | 'crt' | 'paper' | 'standard' | 'midnight' | 'forest' | 'sunset' | 'nord' | 'slate' | 'stone' | 'zinc' | 'monochrome' | 'pch' | 'terraces' | 'swarm' | 'aurora' | 'swell' | 'contour' | 'nightsky'
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
  /** Ranked priority (1 = most important); written to To Do as a "1_" title prefix */
  rank?: number
  /** High/low priority; written to To Do as an "H_" / "L_" title prefix */
  priority?: 'high' | 'low'
  /**
   * Part of a series To Do repeats itself: completing a copy makes To Do create the next one,
   * so the app must never un-tick it on a new day.
   */
  remoteSeries?: boolean
  /**
   * Created in this app (rather than pulled from To Do). Only these synced tasks are reset each
   * morning; tasks from To Do keep To Do's state, including its completed history.
   */
  createdHere?: boolean
  /**
   * When an occurrence of a task To Do repeats itself was last ticked off. To Do keeps such a task open
   * and moves its due date to the next occurrence, so this is what says "done for this period".
   */
  lastCompletedAt?: string
  /** The due date of the occurrence last ticked off (so an overdue tick isn't mistaken for this period's) */
  lastCompletedDue?: string
  /**
   * Done/not-done was changed here since the last sync, so To Do needs to hear it. Other edits (title,
   * priority, drag) never send a status, so they can't overwrite a tick made in To Do meanwhile.
   */
  doneChanged?: boolean
  /** The task whose tick created this custom-days copy (so unticking it can take the copy back) */
  spawnedBy?: string
  /** A synced daily task created here that has already been carried over to a fresh copy for a later day */
  rolledOver?: boolean
  /** The due date To Do last had for this task, so removing it in To Do can be told apart from a local-only date */
  remoteDue?: string
  /** Microsoft To Do task id when this workspace is synced */
  remoteId?: string
  /** lastModifiedDateTime of the remote task when we last synced it */
  remoteModified?: string
  /** Local changes not yet pushed to Microsoft To Do */
  dirty?: boolean
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