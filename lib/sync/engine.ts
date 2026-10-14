'use client'

import { Mode, MODE_ORDER, Project, Todo } from '@/types'
import { loadProjects, saveProjectsRaw } from '@/lib/storage'
import { DATA_CHANGE_EVENT, LOCAL_CHANGE_EVENT, loadDeleted, loadTodos, saveDeleted, saveTodosRaw } from '@/lib/todos'
import { getAccount, getToken, ReauthRequired } from '@/lib/sync/msal'
import {
  createChecklistItem,
  createTask,
  deleteChecklistItem,
  deleteTask,
  GraphError,
  GraphTask,
  listTasks,
  updateChecklistItem,
  updateTask,
} from '@/lib/sync/graph'
import { bodyText, fromGraphTask, mergePhases, toGraphTask } from '@/lib/sync/mapping'

/* ---------- Linked lists ---------- */

export interface ListLink {
  listId: string
  listName: string
  lastSync?: string
}

const LINKS_KEY = 'arcade-sync'
const DELETED_STEPS_KEY = (mode: Mode) => `arcade-sync-deleted-steps-${mode}`

export function loadLinks(): Partial<Record<Mode, ListLink>> {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(LINKS_KEY) || '{}')
  } catch {
    return {}
  }
}

function saveLinks(links: Partial<Record<Mode, ListLink>>): void {
  localStorage.setItem(LINKS_KEY, JSON.stringify(links))
}

export function getLink(mode: Mode): ListLink | undefined {
  return loadLinks()[mode]
}

/** Point a workspace at a To Do list (or none). Old remote ids are dropped so nothing leaks into the new list. */
export function setLink(mode: Mode, link: ListLink | null): void {
  const links = loadLinks()
  if (links[mode]?.listId === link?.listId) return
  if (link) links[mode] = link
  else delete links[mode]
  saveLinks(links)

  saveTodosRaw(
    mode,
    loadTodos(mode).map(t => ({ ...t, remoteId: undefined, remoteModified: undefined, dirty: undefined }))
  )
  saveProjectsRaw(
    mode,
    loadProjects(mode).map(p => ({
      ...p,
      dirty: true,
      knownChecklistIds: undefined,
      phases: p.phases.map(ph => ({ ...ph, remoteId: undefined })),
    }))
  )
  saveDeleted(mode, [])
  localStorage.removeItem(DELETED_STEPS_KEY(mode))
  setStatus({ ...status, lastSync: undefined, error: undefined })
}

/** Number of local changes in a linked workspace that haven't been sent to To Do yet. */
export function pendingCount(mode: Mode): number {
  if (!loadLinks()[mode]) return 0
  return (
    loadTodos(mode).filter(t => !t.remoteId || t.dirty).length +
    loadProjects(mode).filter(p => p.dirty).length +
    loadDeleted(mode).length +
    loadDeletedSteps(mode).length
  )
}

/** True if a linked workspace has edits that haven't reached To Do yet. */
export function hasPendingChanges(): boolean {
  const links = loadLinks()
  return MODE_ORDER.some(
    mode =>
      links[mode] &&
      (loadTodos(mode).some(t => !t.remoteId || t.dirty) ||
        loadProjects(mode).some(p => p.dirty) ||
        loadDeleted(mode).length > 0 ||
        loadDeletedSteps(mode).length > 0)
  )
}

/**
 * Remove every synced workspace's tasks and projects from this device. They stay safe in
 * Microsoft To Do and come back after signing in again — work data shouldn't linger locally.
 */
export function forgetSyncedData(): void {
  const links = loadLinks()
  for (const mode of MODE_ORDER) {
    if (!links[mode]) continue
    saveTodosRaw(mode, [])
    saveProjectsRaw(mode, [])
    saveDeleted(mode, [])
    localStorage.removeItem(DELETED_STEPS_KEY(mode))
  }
  window.dispatchEvent(new Event(DATA_CHANGE_EVENT))
}

/* ---------- Status ---------- */

export type SyncPhase = 'unconfigured' | 'signed-out' | 'idle' | 'syncing' | 'error' | 'offline'

export interface SyncStatus {
  phase: SyncPhase
  lastSync?: string
  error?: string
}

export const STATUS_EVENT = 'arcade-sync-status'
let status: SyncStatus = { phase: 'idle' }

export function getStatus(): SyncStatus {
  return status
}

export function setStatus(next: SyncStatus): void {
  status = next
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(STATUS_EVENT))
}

/* ---------- Queued step deletions (when a synced project is deleted) ---------- */

interface DeletedStep {
  taskId: string
  itemId: string
}

function loadDeletedSteps(mode: Mode): DeletedStep[] {
  try {
    return JSON.parse(localStorage.getItem(DELETED_STEPS_KEY(mode)) || '[]')
  } catch {
    return []
  }
}

export function queueProjectRemoval(mode: Mode, project: Project, sourceTodo?: Todo): void {
  if (!sourceTodo?.remoteId) return
  const steps = project.phases.filter(p => p.remoteId).map(p => ({ taskId: sourceTodo.remoteId!, itemId: p.remoteId! }))
  localStorage.setItem(DELETED_STEPS_KEY(mode), JSON.stringify([...loadDeletedSteps(mode), ...steps]))
  window.dispatchEvent(new CustomEvent(LOCAL_CHANGE_EVENT, { detail: { mode } }))
}

/* ---------- Sync ---------- */

function patchStoredTodo(mode: Mode, id: string, patch: (t: Todo) => Partial<Todo>): void {
  saveTodosRaw(
    mode,
    loadTodos(mode).map(t => (t.id === id ? { ...t, ...patch(t) } : t))
  )
}

const contentKey = (t: Todo) => JSON.stringify([t.text, t.done, t.dueDate ?? null, t.category, t.recurrenceDays ?? null])

async function pushTodos(mode: Mode, listId: string, token: string): Promise<void> {
  for (const todo of loadTodos(mode)) {
    if (todo.remoteId && !todo.dirty) continue
    const key = contentKey(todo)
    let remote: GraphTask
    const { body, dueDate } = toGraphTask(todo, !todo.remoteId)
    try {
      remote = todo.remoteId
        ? await updateTask(token, listId, todo.remoteId, body)
        : await createTask(token, listId, body)
    } catch (e) {
      // Edited here but deleted in To Do: bring it back rather than lose the edit.
      if (!(e instanceof GraphError && e.status === 404 && todo.remoteId)) throw e
      remote = await createTask(token, listId, toGraphTask(todo, true).body)
    }
    patchStoredTodo(mode, todo.id, current => ({
      remoteId: remote.id,
      remoteModified: remote.lastModifiedDateTime,
      dueDate: current.dueDate ?? dueDate,
      // Only clear the flag if nothing changed while the request was in flight.
      dirty: contentKey(current) !== key,
    }))
  }
}

async function pushDeletions(mode: Mode, listId: string, token: string): Promise<void> {
  for (const id of loadDeleted(mode)) {
    try {
      await deleteTask(token, listId, id)
    } catch (e) {
      if (!(e instanceof GraphError && e.status === 404)) throw e
    }
    saveDeleted(
      mode,
      loadDeleted(mode).filter(x => x !== id)
    )
  }
  for (const step of loadDeletedSteps(mode)) {
    try {
      await deleteChecklistItem(token, listId, step.taskId, step.itemId)
    } catch (e) {
      if (!(e instanceof GraphError && e.status === 404)) throw e
    }
    localStorage.setItem(
      DELETED_STEPS_KEY(mode),
      JSON.stringify(loadDeletedSteps(mode).filter(s => s.itemId !== step.itemId))
    )
  }
}

async function pushProjects(mode: Mode, listId: string, token: string): Promise<void> {
  const todos = loadTodos(mode)
  for (const project of loadProjects(mode)) {
    if (!project.dirty) continue
    const taskId = todos.find(t => t.id === project.sourceTodoId)?.remoteId
    if (!taskId) continue

    await updateTask(token, listId, taskId, { body: { content: project.description, contentType: 'text' } })
    const phaseIds = new Map<string, string>()
    for (const phase of project.phases) {
      const item = { displayName: phase.title, isChecked: phase.status === 'done' }
      if (phase.remoteId) {
        try {
          await updateChecklistItem(token, listId, taskId, phase.remoteId, item)
          continue
        } catch (e) {
          if (!(e instanceof GraphError && e.status === 404)) throw e
        }
      }
      const created = await createChecklistItem(token, listId, taskId, item)
      phaseIds.set(phase.id, created.id)
    }
    const kept = new Set([...project.phases.map(p => p.remoteId), ...Array.from(phaseIds.values())])
    for (const id of project.knownChecklistIds ?? []) {
      if (kept.has(id)) continue
      try {
        await deleteChecklistItem(token, listId, taskId, id)
      } catch (e) {
        if (!(e instanceof GraphError && e.status === 404)) throw e
      }
    }

    const snapshot = JSON.stringify([project.description, project.phases.map(p => [p.id, p.title, p.status === 'done'])])
    saveProjectsRaw(
      mode,
      loadProjects(mode).map(p => {
        if (p.id !== project.id) return p
        const phases = p.phases.map(ph => (phaseIds.has(ph.id) ? { ...ph, remoteId: phaseIds.get(ph.id) } : ph))
        const now = JSON.stringify([p.description, p.phases.map(ph => [ph.id, ph.title, ph.status === 'done'])])
        return {
          ...p,
          phases,
          knownChecklistIds: phases.map(ph => ph.remoteId).filter((id): id is string => !!id),
          dirty: now !== snapshot,
        }
      })
    )
  }
}

function applyRemote(mode: Mode, remote: GraphTask[]): void {
  const pendingDelete = new Set(loadDeleted(mode))
  const remoteById = new Map(remote.map(r => [r.id, r]))
  let todos = loadTodos(mode)
  let projects = loadProjects(mode)
  const localByRemote = new Map(todos.filter(t => t.remoteId).map(t => [t.remoteId!, t]))

  // Removed in To Do (and not edited here since) → remove here too, with its project.
  const removed = new Set(todos.filter(t => t.remoteId && !t.dirty && !remoteById.has(t.remoteId)).map(t => t.id))
  todos = todos.filter(t => !removed.has(t.id))
  projects = projects.filter(p => !removed.has(p.sourceTodoId))

  for (const r of remote) {
    if (pendingDelete.has(r.id)) continue
    const local = localByRemote.get(r.id)
    if (!local) {
      todos.push({ id: crypto.randomUUID(), ...fromGraphTask(r) })
    } else if (!local.dirty && local.remoteModified !== r.lastModifiedDateTime) {
      todos = todos.map(t => (t.id === local.id ? { ...t, ...fromGraphTask(r), dirty: false } : t))
    }
  }

  // Tasks with steps in To Do are projects here.
  for (const r of remote) {
    const todo = todos.find(t => t.remoteId === r.id)
    if (!todo || !r.checklistItems) continue
    const project = projects.find(p => p.sourceTodoId === todo.id)
    if (!project) {
      if (r.checklistItems.length === 0) continue
      const now = new Date().toISOString()
      const created: Project = {
        id: crypto.randomUUID(),
        sourceTodoId: todo.id,
        title: todo.text,
        description: bodyText(r),
        phases: [],
        createdAt: now,
        updatedAt: now,
        mode,
        knownChecklistIds: r.checklistItems.map(i => i.id),
      }
      created.phases = mergePhases(created, r)
      projects.push(created)
      todos = todos.map(t => (t.id === todo.id ? { ...t, isProject: true, projectId: created.id } : t))
    } else if (!project.dirty) {
      const next: Project = {
        ...project,
        description: bodyText(r) || project.description,
        phases: mergePhases(project, r),
        knownChecklistIds: r.checklistItems.map(i => i.id),
      }
      if (JSON.stringify(next) !== JSON.stringify(project)) {
        projects = projects.map(p => (p.id === project.id ? { ...next, updatedAt: new Date().toISOString() } : p))
      }
    }
  }

  saveTodosRaw(mode, todos)
  saveProjectsRaw(mode, projects)
}

let running: Promise<void> | null = null
let rerun = false

async function syncOnce(): Promise<void> {
  const links = loadLinks()
  const modes = MODE_ORDER.filter(m => links[m])
  if (modes.length === 0) return
  if (!(await getAccount())) {
    setStatus({ phase: 'signed-out' })
    return
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setStatus({ ...status, phase: 'offline' })
    return
  }

  setStatus({ ...status, phase: 'syncing', error: undefined })
  try {
    const token = await getToken()
    for (const mode of modes) {
      const link = links[mode]!
      await pushDeletions(mode, link.listId, token)
      await pushTodos(mode, link.listId, token)
      await pushProjects(mode, link.listId, token)
      applyRemote(mode, await listTasks(token, link.listId))
      const latest = loadLinks()
      if (latest[mode]?.listId === link.listId) {
        latest[mode] = { ...latest[mode]!, lastSync: new Date().toISOString() }
        saveLinks(latest)
      }
    }
    window.dispatchEvent(new Event(DATA_CHANGE_EVENT))
    setStatus({ phase: 'idle', lastSync: new Date().toISOString() })
  } catch (e) {
    window.dispatchEvent(new Event(DATA_CHANGE_EVENT))
    const message =
      e instanceof ReauthRequired
        ? e.message
        : e instanceof GraphError && e.status === 403
        ? 'Access denied — your organisation may need to approve this app.'
        : e instanceof GraphError && e.status === 404
        ? 'The linked To Do list no longer exists. Pick another in Settings → Sync.'
        : e instanceof Error
        ? e.message
        : 'Sync failed'
    setStatus({ ...status, phase: e instanceof ReauthRequired ? 'signed-out' : 'error', error: message })
  }
}

/** Sync every linked workspace. Calls made while a sync is running are coalesced into one follow-up run. */
export function requestSync(): Promise<void> {
  if (running) {
    rerun = true
    return running
  }
  running = (async () => {
    do {
      rerun = false
      await syncOnce()
    } while (rerun)
    running = null
  })()
  return running
}
