import { Todo } from '@/types'
import { toDateString } from '@/lib/date'
import { GraphDateTime, GraphTask } from '@/lib/sync/graph'

/*
 * To Do only gets a task's name and whether it's done. Repeats, due dates, order and
 * projects live in this app alone, so nothing here can be mangled by To Do's simpler model.
 */

export function toGraphTask(todo: Todo): Partial<GraphTask> {
  return { title: todo.text, status: todo.done ? 'completed' : 'notStarted' }
}

function utcToIso(value?: GraphDateTime | null): string | undefined {
  return value?.dateTime ? new Date(value.dateTime.slice(0, 19) + 'Z').toISOString() : undefined
}

/** Name and done state from To Do, applied to an existing local task. */
export function syncedFieldsFromGraph(task: GraphTask, current: Todo): Partial<Todo> {
  const done = task.status === 'completed'
  return {
    text: task.title,
    done,
    completedAt: done ? current.completedAt ?? utcToIso(task.completedDateTime) ?? new Date().toISOString() : undefined,
    remoteId: task.id,
    remoteModified: task.lastModifiedDateTime,
  }
}

/** A task that was created in To Do. Its due date is kept if it has one; it arrives as a one-off. */
export function newTaskFromGraph(task: GraphTask): Omit<Todo, 'id'> {
  const done = task.status === 'completed'
  const due = task.dueDateTime?.dateTime ? toDateString(new Date(task.dueDateTime.dateTime.slice(0, 19) + 'Z')) : undefined
  return {
    text: task.title,
    done,
    category: 'once',
    dueDate: due,
    completedAt: done ? utcToIso(task.completedDateTime) ?? new Date().toISOString() : undefined,
    remoteId: task.id,
    remoteModified: task.lastModifiedDateTime,
  }
}
