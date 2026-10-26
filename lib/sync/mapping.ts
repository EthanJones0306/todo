import { Todo } from '@/types'
import { toDateString } from '@/lib/date'
import { GraphDateTime, GraphTask } from '@/lib/sync/graph'
import { composeTitle, parseTitle, repeatPrefixOf } from '@/lib/priority'

/*
 * To Do only gets a task's title and whether it's done. Priority and daily/weekly/monthly travel as
 * title prefixes (see lib/priority.ts). Due dates are read from To Do but never sent; custom repeats
 * and projects live in this app alone.
 */

/**
 * What to send for a task. A new task gets its title and done state; an existing one gets its title, plus
 * its done state only if it was ticked or unticked here — so a rename or priority change can never
 * re-open (or re-complete) a task that was ticked in To Do meanwhile.
 */
export function toGraphTask(todo: Todo, isNew: boolean): Partial<GraphTask> {
  const body: Partial<GraphTask> = { title: composeTitle(todo) }
  if (isNew || todo.doneChanged) body.status = todo.done ? 'completed' : 'notStarted'
  return body
}

function utcToIso(value?: GraphDateTime | null): string | undefined {
  return value?.dateTime ? new Date(value.dateTime.slice(0, 19) + 'Z').toISOString() : undefined
}

/** Done state and due date from To Do, including recognising a repeating task To Do has moved on. */
export function stateFromGraph(task: GraphTask, current: Todo): Partial<Todo> {
  const done = task.status === 'completed'
  const due = localDate(task.dueDateTime)
  // A repeating task stays open in To Do and its due date moves on when an occurrence is ticked off
  // (in To Do or here). Seeing it open again with a later due date means that occurrence was done.
  const rolledForward = !done && !!task.recurrence && (current.done || (!!due && !!current.remoteDue && due > current.remoteDue))
  return {
    lastCompletedAt: rolledForward ? current.completedAt ?? task.lastModifiedDateTime : current.lastCompletedAt,
    lastCompletedDue: rolledForward ? current.remoteDue ?? current.dueDate : current.lastCompletedDue,
    remoteSeries: current.remoteSeries || !!task.recurrence,
    // A due date set, moved or removed in To Do comes across; one set only here is kept.
    dueDate: due ?? (current.dueDate === current.remoteDue ? undefined : current.dueDate),
    remoteDue: due,
    done,
    completedAt: done ? current.completedAt ?? utcToIso(task.completedDateTime) ?? new Date().toISOString() : undefined,
    remoteId: task.id,
    remoteModified: task.lastModifiedDateTime,
  }
}

/** Title (with priority prefixes) and done state from To Do, applied to an existing local task. */
export function syncedFieldsFromGraph(task: GraphTask, current: Todo): Partial<Todo> {
  const p = parseTitle(task.title)
  return {
    text: p.text,
    rank: p.rank,
    priority: p.priority,
    // z_/zz_/zzz_ set daily/weekly/monthly; removing it in To Do makes the task a one-off. Custom stays local.
    category: p.repeat ?? (repeatPrefixOf(current.category) ? 'once' : current.category),
    recurrenceDays: p.repeat ? undefined : current.recurrenceDays,
    ...stateFromGraph(task, current),
  }
}

export function localDate(value?: GraphDateTime | null): string | undefined {
  return value?.dateTime ? toDateString(new Date(value.dateTime.slice(0, 19) + 'Z')) : undefined
}

/** A task that was created in To Do. Its due date is kept if it has one. */
export function newTaskFromGraph(task: GraphTask): Omit<Todo, 'id'> {
  const done = task.status === 'completed'
  const p = parseTitle(task.title)
  const due = localDate(task.dueDateTime)
  return {
    text: p.text,
    rank: p.rank,
    priority: p.priority,
    done,
    remoteSeries: !!task.recurrence || undefined,
    category: p.repeat ?? 'once',
    dueDate: due,
    remoteDue: due,
    completedAt: done ? utcToIso(task.completedDateTime) ?? new Date().toISOString() : undefined,
    remoteId: task.id,
    remoteModified: task.lastModifiedDateTime,
  }
}
