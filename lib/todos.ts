'use client'

import { Category, CATEGORY_ORDER, Mode, MODE_ORDER, RecurrenceDays, Todo } from '@/types'
import { addDays, getTodayString, parseDate, toDateString } from '@/lib/date'

const TODOS_KEY = (mode: Mode) => `arcade-todos-${mode}`
const MODE_KEY = 'arcade-mode'

function normalizeCategory(value: unknown): Category {
  return CATEGORY_ORDER.includes(value as Category) ? (value as Category) : 'once'
}

export function loadMode(): Mode {
  if (typeof window === 'undefined') return 'personal'
  const saved = localStorage.getItem(MODE_KEY)
  return MODE_ORDER.includes(saved as Mode) ? (saved as Mode) : 'personal'
}

export function saveMode(mode: Mode): void {
  localStorage.setItem(MODE_KEY, mode)
}

export function loadTodos(mode: Mode): Todo[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(TODOS_KEY(mode)) || '[]')
    return parsed.map((t: any) => ({ ...t, category: normalizeCategory(t.category) }))
  } catch {
    return []
  }
}

export function saveTodos(mode: Mode, todos: Todo[]): void {
  localStorage.setItem(TODOS_KEY(mode), JSON.stringify(todos))
}

/** Whether a task belongs in the "Today" view. */
export function shouldShowToday(dueDate?: string, recurrenceDays?: RecurrenceDays): boolean {
  if (!dueDate) return true
  const today = getTodayString()
  if (dueDate > today) return false
  if (!recurrenceDays || recurrenceDays.length === 0) return true
  return recurrenceDays.includes(parseDate(today).getDay())
}

export function getNextDueDate(currentDueDate: string | undefined, recurrenceDays: RecurrenceDays): string {
  let date = addDays(currentDueDate || getTodayString(), 1)
  for (let i = 0; i < 7; i++) {
    if (recurrenceDays.includes(parseDate(date).getDay())) return date
    date = addDays(date, 1)
  }
  return date
}

export { toDateString }
