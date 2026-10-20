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

/**
 * Drag-and-drop in priority order: move `movedId` to where `targetId` sits and re-derive priorities.
 * The moved task takes the target's level (ranked, high, normal or low), and every ranked task is
 * renumbered 1, 2, 3… in its new position, so the To Do title prefixes keep the same order.
 * Daily (zz_) tasks are ordered separately; dropping across that boundary does nothing.
 * Ranks are numbered across the whole workspace, not just the visible list, so filtered views stay
 * consistent with To Do. Returns the original array when nothing changes.
 */
export function reprioritise(todos: Todo[], movedId: string, targetId: string): Todo[] {
  const moved = todos.find(t => t.id === movedId)
  const target = todos.find(t => t.id === targetId)
  if (!moved || !target || moved === target || moved.done || target.done) return todos
  const daily = moved.category === 'daily'
  if ((target.category === 'daily') !== daily) return todos

  const inGroup = (t: Todo) => !t.done && (t.category === 'daily') === daily
  const ordered = todos.filter(inGroup).sort(priorityCompare)
  const movingDown = ordered.indexOf(moved) < ordered.indexOf(target)

  const placed: Todo = target.rank
    ? { ...moved, rank: Number.MAX_SAFE_INTEGER, priority: undefined }
    : { ...moved, rank: undefined, priority: target.priority }
  const rest = ordered.filter(t => t !== moved)
  const at = rest.indexOf(target) + (movingDown ? 1 : 0)
  rest.splice(at, 0, placed)

  let rank = 0
  const renumbered = rest.map(t => {
    if (!t.rank) return t
    rank++
    return t.rank === rank ? t : { ...t, rank }
  })

  let i = 0
  return todos.map(t => (inGroup(t) ? renumbered[i++] : t))
}

export function canReprioritise(moved: Todo | undefined, target: Todo | undefined): boolean {
  return !!moved && !!target && moved !== target && !target.done && (moved.category === 'daily') === (target.category === 'daily')
}
