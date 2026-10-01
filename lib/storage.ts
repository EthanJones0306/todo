'use client'

import { Project, Phase, Mode, Todo, PhaseStatus } from '@/types'

const PROJECTS_KEY = (mode: Mode) => `arcade-projects-${mode}`

function generateId(): string {
  return crypto.randomUUID()
}

function nowISO(): string {
  return new Date().toISOString()
}

export function loadProjects(mode: Mode): Project[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECTS_KEY(mode)) || '[]')
    return parsed
  } catch {
    return []
  }
}

export function saveProjects(mode: Mode, projects: Project[]): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(PROJECTS_KEY(mode), JSON.stringify(projects))
}

export function getProject(mode: Mode, id: string): Project | undefined {
  const projects = loadProjects(mode)
  return projects.find(p => p.id === id)
}

export function createProjectFromTodo(
  mode: Mode,
  sourceTodo: Todo,
  title?: string,
  description?: string
): Project {
  const projectId = generateId()
  const now = nowISO()

  const defaultPhases: Phase[] = [
    {
      id: generateId(),
      projectId,
      title: 'Planning',
      description: '',
      order: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: generateId(),
      projectId,
      title: 'Execution',
      description: '',
      order: 1,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
  ]

  const project: Project = {
    id: projectId,
    sourceTodoId: sourceTodo.id,
    title: title || sourceTodo.text,
    description: description || '',
    phases: defaultPhases,
    createdAt: now,
    updatedAt: now,
    mode,
  }

  const projects = loadProjects(mode)
  projects.push(project)
  saveProjects(mode, projects)

  return project
}

export function updateProject(mode: Mode, project: Project): Project {
  const projects = loadProjects(mode)
  const index = projects.findIndex(p => p.id === project.id)
  if (index === -1) throw new Error('Project not found')

  const updated = { ...project, updatedAt: nowISO() }
  projects[index] = updated
  saveProjects(mode, projects)
  return updated
}

export function deleteProject(mode: Mode, projectId: string): void {
  const projects = loadProjects(mode)
  const filtered = projects.filter(p => p.id !== projectId)
  saveProjects(mode, filtered)
}

export function addPhase(mode: Mode, projectId: string, title: string): Phase {
  const project = getProject(mode, projectId)
  if (!project) throw new Error('Project not found')

  const now = nowISO()
  const newPhase: Phase = {
    id: generateId(),
    projectId,
    title,
    description: '',
    order: project.phases.length,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  }

  const updatedProject = {
    ...project,
    phases: [...project.phases, newPhase].sort((a, b) => a.order - b.order),
    updatedAt: now,
  }
  updateProject(mode, updatedProject)
  return newPhase
}

export function updatePhase(mode: Mode, projectId: string, phase: Phase): Phase {
  const project = getProject(mode, projectId)
  if (!project) throw new Error('Project not found')

  const updatedPhase = { ...phase, updatedAt: nowISO() }
  const updatedProject = {
    ...project,
    phases: project.phases.map(p => p.id === phase.id ? updatedPhase : p).sort((a, b) => a.order - b.order),
    updatedAt: nowISO(),
  }
  updateProject(mode, updatedProject)
  return updatedPhase
}

export function deletePhase(mode: Mode, projectId: string, phaseId: string): void {
  const project = getProject(mode, projectId)
  if (!project) throw new Error('Project not found')

  const updatedProject = {
    ...project,
    phases: project.phases.filter(p => p.id !== phaseId).map((p, i) => ({ ...p, order: i })),
    updatedAt: nowISO(),
  }
  updateProject(mode, updatedProject)
}

export function reorderPhases(mode: Mode, projectId: string, phaseIds: string[]): void {
  const project = getProject(mode, projectId)
  if (!project) throw new Error('Project not found')

  const phaseMap = new Map(project.phases.map(p => [p.id, p]))
  const reordered = phaseIds.map((id, i) => {
    const phase = phaseMap.get(id)
    return phase ? { ...phase, order: i } : null
  }).filter(Boolean) as Phase[]

  const updatedProject = {
    ...project,
    phases: reordered,
    updatedAt: nowISO(),
  }
  updateProject(mode, updatedProject)
}

export function togglePhaseStatus(mode: Mode, projectId: string, phaseId: string): Phase {
  const project = getProject(mode, projectId)
  if (!project) throw new Error('Project not found')

  const phase = project.phases.find(p => p.id === phaseId)
  if (!phase) throw new Error('Phase not found')

  const statuses: PhaseStatus[] = ['pending', 'active', 'done']
  const currentIndex = statuses.indexOf(phase.status)
  const nextIndex = (currentIndex + 1) % statuses.length
  const nextStatus = statuses[nextIndex]

  const updatedPhase = {
    ...phase,
    status: nextStatus,
    completedAt: nextStatus === 'done' ? nowISO() : undefined,
    updatedAt: nowISO(),
  }

  return updatePhase(mode, projectId, updatedPhase)
}

export function getPhase(mode: Mode, projectId: string, phaseId: string): Phase | undefined {
  const project = getProject(mode, projectId)
  if (!project) return undefined
  return project.phases.find(p => p.id === phaseId)
}