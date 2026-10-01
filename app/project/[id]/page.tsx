'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { 
  Project, 
  Phase, 
  Mode, 
  PhaseStatus,
  DAY_LABELS,
  PHASE_STATUS_LABEL,
  PHASE_STATUS_COLOR,
} from '@/types'
import { 
  loadProjects, 
  getProject, 
  updateProject, 
  deleteProject,
  addPhase,
  updatePhase,
  deletePhase,
  reorderPhases,
  togglePhaseStatus,
} from '@/lib/storage'

export default function ProjectPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const [project, setProject] = useState<Project | null>(null)
  const [mode, setMode] = useState<Mode>('personal')
  const [mounted, setMounted] = useState(false)
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null)
  const [draggingPhaseId, setDraggingPhaseId] = useState<string | null>(null)
  const [dragOverPhaseId, setDragOverPhaseId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [showDescriptionModal, setShowDescriptionModal] = useState(false)
  const [newPhaseTitle, setNewPhaseTitle] = useState('')

  useEffect(() => {
    const loadMode = (): Mode => {
      if (typeof window === 'undefined') return 'personal'
      const saved = localStorage.getItem('arcade-mode')
      return ['personal', 'work'].includes(saved || '') ? (saved as Mode) : 'personal'
    }
    const m = loadMode()
    setMode(m)
    const p = getProject(m, projectId)
    setProject(p ?? null)
    setMounted(true)
  }, [projectId])

  useEffect(() => {
    if (mounted && project) {
      const currentMode = mode
      const updated = getProject(currentMode, projectId)
      if (updated) setProject(updated)
    }
  }, [mounted, projectId, mode])

  if (!mounted) {
    return (
      <div className="container">
        <div className="panel" style={{ textAlign: 'center', padding: '3rem' }}>
          Loading...
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="container">
        <div className="panel" style={{ textAlign: 'center', padding: '3rem' }}>
          <p>Project not found</p>
          <button className="btn-add" onClick={() => router.back()} style={{ marginTop: '1rem' }}>
            ← Back
          </button>
        </div>
      </div>
    )
  }

  const handleAddPhase = () => {
    if (!newPhaseTitle.trim()) return
    addPhase(mode, projectId, newPhaseTitle.trim())
    setNewPhaseTitle('')
    const updated = getProject(mode, projectId)
    if (updated) setProject(updated)
  }

  const handleUpdatePhase = (phase: Phase) => {
    updatePhase(mode, projectId, phase)
    const updated = getProject(mode, projectId)
    if (updated) setProject(updated)
  }

  const handleDeletePhase = (phaseId: string) => {
    deletePhase(mode, projectId, phaseId)
    const updated = getProject(mode, projectId)
    if (updated) setProject(updated)
  }

  const handleToggleStatus = (phaseId: string) => {
    togglePhaseStatus(mode, projectId, phaseId)
    const updated = getProject(mode, projectId)
    if (updated) setProject(updated)
  }

  const handleReorder = (phaseIds: string[]) => {
    reorderPhases(mode, projectId, phaseIds)
    const updated = getProject(mode, projectId)
    if (updated) setProject(updated)
  }

  const startEditPhase = (phase: Phase) => {
    setEditingPhaseId(phase.id)
    setEditTitle(phase.title)
    setEditDescription(phase.description)
  }

  const saveEditPhase = (phase: Phase) => {
    const updated = { ...phase, title: editTitle, description: editDescription, updatedAt: new Date().toISOString() }
    handleUpdatePhase(updated)
    setEditingPhaseId(null)
    setEditTitle('')
    setEditDescription('')
  }

  const cancelEditPhase = () => {
    setEditingPhaseId(null)
    setEditTitle('')
    setEditDescription('')
  }

  const handleDragStart = (e: React.DragEvent, phaseId: string) => {
    e.dataTransfer.setData('text/plain', phaseId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingPhaseId(phaseId)
  }

  const handleDragEnd = () => {
    setDraggingPhaseId(null)
    setDragOverPhaseId(null)
  }

  const handleDragOver = (e: React.DragEvent, phaseId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverPhaseId(phaseId)
  }

  const handleDragLeave = () => {
    setDragOverPhaseId(null)
  }

  const handleDrop = (e: React.DragEvent, targetPhaseId: string) => {
    e.preventDefault()
    const sourcePhaseId = e.dataTransfer.getData('text/plain')
    if (sourcePhaseId && sourcePhaseId !== targetPhaseId && project) {
      const phases = [...project.phases]
      const sourceIndex = phases.findIndex(p => p.id === sourcePhaseId)
      const targetIndex = phases.findIndex(p => p.id === targetPhaseId)
      if (sourceIndex !== -1 && targetIndex !== -1) {
        const [moved] = phases.splice(sourceIndex, 1)
        phases.splice(targetIndex, 0, moved)
        handleReorder(phases.map(p => p.id))
      }
    }
    setDraggingPhaseId(null)
    setDragOverPhaseId(null)
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return ''
    const date = new Date(dateStr + 'T00:00:00')
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' })
  }

  const renderMarkdown = (text: string) => {
    if (!text) return <span className="empty-desc">No description</span>
    return (
      <div className="markdown-desc" dangerouslySetInnerHTML={{ __html: text
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br/>')
      }} />
    )
  }

  return (
    <div className="container">
      <div className="project-header">
        <button className="btn-back" onClick={() => router.back()}>
          ← Back
        </button>
        <div className="project-title-area">
          <h1>{project.title}</h1>
          <button 
            className="btn-description"
            onClick={() => setShowDescriptionModal(true)}
            aria-label="Edit project description"
          >
            {project.description ? '✎ Description' : '+ Add description'}
          </button>
        </div>
      </div>

      <div className="project-timeline">
        {project.phases.length === 0 ? (
          <div className="empty-phases">
            <p>No phases yet</p>
            <p style={{ fontSize: '14px', color: 'var(--text-dim)', marginTop: '0.5rem' }}>
              Add your first phase below
            </p>
          </div>
        ) : (
          project.phases.map((phase, index) => (
            <PhaseCard
              key={phase.id}
              phase={phase}
              index={index}
              total={project.phases.length}
              isEditing={editingPhaseId === phase.id}
              isDragging={draggingPhaseId === phase.id}
              isDragOver={dragOverPhaseId === phase.id}
              editTitle={editTitle}
              editDescription={editDescription}
              setEditTitle={setEditTitle}
              setEditDescription={setEditDescription}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onEdit={startEditPhase}
              onSave={saveEditPhase}
              onCancel={cancelEditPhase}
              onDelete={() => handleDeletePhase(phase.id)}
              onToggleStatus={() => handleToggleStatus(phase.id)}
              formatDate={formatDate}
              renderMarkdown={renderMarkdown}
            />
          ))
        )}

        <div className="add-phase-form">
          <input
            type="text"
            placeholder="New phase title..."
            value={newPhaseTitle}
            onChange={e => setNewPhaseTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddPhase()}
          />
          <button className="btn-add" onClick={handleAddPhase} disabled={!newPhaseTitle.trim()}>
            + Add Phase
          </button>
        </div>
      </div>

      {showDescriptionModal && (
        <div className="modal-overlay" onClick={() => setShowDescriptionModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Project Description</h2>
            <textarea
              value={project.description}
              onChange={e => {
                const updated = { ...project, description: e.target.value, updatedAt: new Date().toISOString() }
                updateProject(mode, updated)
                setProject(updated)
              }}
              placeholder="Describe your project..."
              rows={8}
              spellCheck={true}
            />
            <div className="modal-actions">
              <button className="btn-add" onClick={() => setShowDescriptionModal(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface PhaseCardProps {
  phase: Phase
  index: number
  total: number
  isEditing: boolean
  isDragging: boolean
  isDragOver: boolean
  editTitle: string
  editDescription: string
  setEditTitle: (v: string) => void
  setEditDescription: (v: string) => void
  onDragStart: (e: React.DragEvent, phaseId: string) => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent, phaseId: string) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent, phaseId: string) => void
  onEdit: (phase: Phase) => void
  onSave: (phase: Phase) => void
  onCancel: () => void
  onDelete: () => void
  onToggleStatus: (phaseId: string) => void
  formatDate: (dateStr?: string) => string
  renderMarkdown: (text: string) => React.ReactNode
}

function PhaseCard({
  phase,
  index,
  total,
  isEditing,
  isDragging,
  isDragOver,
  editTitle,
  editDescription,
  setEditTitle,
  setEditDescription,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onToggleStatus,
  formatDate,
  renderMarkdown,
}: PhaseCardProps) {
  const statusColor = PHASE_STATUS_COLOR[phase.status]

  return (
    <div 
      className={`phase-card ${isDragOver ? 'drag-over' : ''} ${isDragging ? 'dragging' : ''}`}
      draggable={!isEditing}
      onDragStart={e => onDragStart(e, phase.id)}
      onDragEnd={onDragEnd}
      onDragOver={e => onDragOver(e, phase.id)}
      onDragLeave={onDragLeave}
      onDrop={e => onDrop(e, phase.id)}
    >
      <div className="phase-connector">
        {index < total - 1 && <div className="connector-line" />}
        <div 
          className="connector-dot"
          style={{ backgroundColor: statusColor }}
        />
      </div>
      <div className="phase-content">
        <div className="phase-header-row">
          <div className="phase-drag-handle" title="Drag to reorder">
            ⋮
          </div>
          {isEditing ? (
            <input
              type="text"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onSave(phase)}
              onBlur={onCancel}
              autoFocus
              className="phase-title-input"
            />
          ) : (
            <h3 className="phase-title" onClick={() => onEdit(phase)}>
              {phase.title}
            </h3>
          )}
          <div className="phase-status" style={{ color: statusColor }}>
            {PHASE_STATUS_LABEL[phase.status]}
          </div>
        </div>

        {phase.dueDate && (
          <div className="phase-due-date">
            Due: {formatDate(phase.dueDate)}
          </div>
        )}

        {isEditing ? (
          <div className="phase-description-edit">
            <textarea
              value={editDescription}
              onChange={e => setEditDescription(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && onSave(phase)}
              placeholder="Phase description (markdown supported)..."
              rows={4}
              spellCheck={true}
            />
            <div className="phase-edit-actions">
              <button className="btn-add" onClick={() => onSave(phase)}>Save</button>
              <button className="btn-secondary" onClick={onCancel}>Cancel</button>
            </div>
          </div>
        ) : phase.description ? (
          <div className="phase-description">
            {renderMarkdown(phase.description)}
          </div>
        ) : (
          <button 
            className="btn-add-description"
            onClick={() => onEdit(phase)}
          >
            + Add description
          </button>
        )}

        <div className="phase-actions">
          <button 
            className="btn-status"
            onClick={() => onToggleStatus(phase.id)}
            style={{ color: statusColor }}
          >
            {phase.status === 'done' ? '✓' : phase.status === 'active' ? '▶' : '○'}
            {phase.status === 'done' ? ' Done' : phase.status === 'active' ? ' Active' : ' Pending'}
          </button>
          <button 
            className="btn-edit-phase"
            onClick={() => onEdit(phase)}
            aria-label="Edit phase"
          >
            ✎
          </button>
          <button 
            className="btn-delete-phase"
            onClick={onDelete}
            aria-label="Delete phase"
          >
            ×
          </button>
        </div>

        {phase.completedAt && (
          <div className="phase-completed">
            Completed: {formatDate(phase.completedAt)}
          </div>
        )}
      </div>
    </div>
  )
}