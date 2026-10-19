import { Todo } from '@/types'

/*
 * Microsoft To Do can only sort alphabetically, so priority is encoded as title prefixes:
 *   1_ 2_ 3_ …  ranked priority (1 is most important)
 *   H_          high priority
 *   L_          low priority
 *   zz_         daily task (sorts to the bottom)
 * Prefixes can be combined (e.g. "zz_1_Standup"). The app shows the title without them and
 * rebuilds them when writing back, so To Do's A–Z order matches the app's priority order.
 */

const PREFIX = /^\s*(\d+|h|l|zz)_\s*/i

export type Priority = 'high' | 'low'

export interface ParsedTitle {
  text: string
  rank?: number
  priority?: Priority
  daily: boolean
}

export function parseTitle(title: string): ParsedTitle {
  let rest = title
  let rank: number | undefined
  let priority: Priority | undefined
  let daily = false
  let m: RegExpExecArray | null
  while ((m = PREFIX.exec(rest))) {
    const token = m[1].toLowerCase()
    if (token === 'zz') daily = true
    else if (token === 'h') priority ??= 'high'
    else if (token === 'l') priority ??= 'low'
    else rank ??= parseInt(token, 10)
    rest = rest.slice(m[0].length)
  }
  // A title that is nothing but prefixes keeps its original text.
  if (!rest.trim()) return { text: title.trim(), daily: false }
  return { text: rest.trim(), rank, priority, daily }
}

export function composeTitle(todo: Pick<Todo, 'text' | 'rank' | 'priority' | 'category'>): string {
  const daily = todo.category === 'daily' ? 'zz_' : ''
  const rank = todo.rank ? `${todo.rank}_` : ''
  const level = todo.priority === 'high' ? 'H_' : todo.priority === 'low' ? 'L_' : ''
  return `${daily}${rank}${level}${todo.text}`
}

/** Apply any prefixes typed into a task name (e.g. "H_Call bank") to the task's fields. */
export function withParsedTitle<T extends Todo>(todo: T): T {
  if (!PREFIX.test(todo.text)) return todo
  const p = parseTitle(todo.text)
  return {
    ...todo,
    text: p.text,
    rank: p.rank ?? todo.rank,
    priority: p.priority ?? todo.priority,
    category: p.daily ? 'daily' : todo.category,
  }
}

/**
 * Sort key for priority order: ranked tasks first (1, 2, 3…), then high, normal and low,
 * with daily tasks last — the same order To Do shows from the prefixes.
 */
export function priorityCompare(a: Todo, b: Todo): number {
  const group = (t: Todo) => (t.rank ? 0 : t.priority === 'high' ? 1 : t.priority === 'low' ? 3 : 2)
  return (
    Number(a.category === 'daily') - Number(b.category === 'daily') ||
    group(a) - group(b) ||
    (a.rank ?? 0) - (b.rank ?? 0)
  )
}

export function priorityLabel(todo: Pick<Todo, 'rank' | 'priority'>): string | null {
  if (todo.rank) return `#${todo.rank}`
  if (todo.priority === 'high') return 'High'
  if (todo.priority === 'low') return 'Low'
  return null
}
