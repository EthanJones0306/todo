'use client'

import { useState, useEffect } from 'react'

type Category = 'once' | 'daily' | 'weekly' | 'monthly' | 'custom'
type RecurrenceDays = number[]

interface Todo {
  id: string
  text: string
  done: boolean
  category: Category
  dueDate?: string
  recurrenceDays?: RecurrenceDays
  completedAt?: string
  originalId?: string
}

const CATEGORY_ORDER: Category[] = ['once', 'daily', 'weekly', 'monthly', 'custom']
const CATEGORY_LABEL: Record<Category, string> = {
  once: 'One-off',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'Custom...',
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Filter = 'all' | Category
const FILTER_ORDER: Filter[] = ['all', 'daily', 'weekly', 'monthly', 'custom', 'once']
const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'Custom',
  once: 'One-off',
}

type Mode = 'personal' | 'work'
const MODE_ORDER: Mode[] = ['personal', 'work']
const MODE_LABEL: Record<Mode, string> = {
  personal: 'Personal',
  work: 'Work',
}

function normalizeCategory(value: unknown): Category {
  return CATEGORY_ORDER.includes(value as Category) ? (value as Category) : 'once'
}

function getTodayString(): string {
  return new Date().toISOString().split('T')[0]
}

function isOverdue(dueDate?: string): boolean {
  if (!dueDate) return false
  return dueDate < getTodayString()
}

function isDueToday(dueDate?: string): boolean {
  if (!dueDate) return false
  return dueDate === getTodayString()
}

function shouldShowToday(dueDate?: string, recurrenceDays?: RecurrenceDays): boolean {
  if (!dueDate) return true
  const today = getTodayString()
  if (dueDate > today) return false
  if (!recurrenceDays || recurrenceDays.length === 0) return dueDate <= today
  const dayOfWeek = new Date(today).getDay()
  return recurrenceDays.includes(dayOfWeek)
}

type Theme = 'neon' | 'crt' | 'paper' | 'standard' | 'midnight' | 'forest' | 'sunset' | 'nord' | 'slate' | 'stone' | 'zinc' | 'monochrome'

const THEME_ORDER: Theme[] = ['neon', 'crt', 'paper', 'standard', 'midnight', 'forest', 'sunset', 'nord', 'slate', 'stone', 'zinc', 'monochrome']
const THEME_LABEL: Record<Theme, string> = {
  neon: 'Neon',
  crt: 'CRT',
  paper: 'Paper',
  standard: 'Standard',
  midnight: 'Midnight',
  forest: 'Forest',
  sunset: 'Sunset',
  nord: 'Nord',
  slate: 'Slate',
  stone: 'Stone',
  zinc: 'Zinc',
  monochrome: 'Mono',
}

function loadTheme(): Theme {
  if (typeof document === 'undefined') return 'neon'
  const attr = document.documentElement.getAttribute('data-theme')
  return THEME_ORDER.includes(attr as Theme) ? (attr as Theme) : 'neon'
}

function loadMode(): Mode {
  if (typeof window === 'undefined') return 'personal'
  const saved = localStorage.getItem('arcade-mode')
  return MODE_ORDER.includes(saved as Mode) ? (saved as Mode) : 'personal'
}

function loadTodos(mode: Mode): Todo[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(`arcade-todos-${mode}`) || '[]')
    return parsed.map((t: any) => ({ ...t, category: normalizeCategory(t.category) }))
  } catch {
    return []
  }
}

function saveTodos(mode: Mode, todos: Todo[]) {
  localStorage.setItem(`arcade-todos-${mode}`, JSON.stringify(todos))
}

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [input, setInput] = useState('')
  const [mounted, setMounted] = useState(false)
  const [theme, setTheme] = useState<Theme>('neon')
  const [mode, setMode] = useState<Mode>('personal')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [newCategory, setNewCategory] = useState<Category>('once')
  const [newDueDate, setNewDueDate] = useState('')
  const [newRecurrenceDays, setNewRecurrenceDays] = useState<RecurrenceDays>([])
  const [showCustomRecurrence, setShowCustomRecurrence] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    setTodos(loadTodos(mode))
    setTheme(loadTheme())
    setMode(loadMode())
    setMounted(true)
  }, [])

  useEffect(() => {
    if (mounted) saveTodos(mode, todos)
  }, [todos, mounted, mode])

  const applyTheme = (next: Theme) => {
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('arcade-theme', next)
  }

  const applyMode = (next: Mode) => {
    setMode(next)
    localStorage.setItem('arcade-mode', next)
  }

  const addTodo = () => {
    const text = input.trim()
    if (!text) return
    const todo: Todo = {
      id: crypto.randomUUID(),
      text,
      done: false,
      category: newCategory,
      dueDate: newDueDate || undefined,
      recurrenceDays: newCategory === 'custom' && newRecurrenceDays.length > 0 ? newRecurrenceDays : undefined,
    }
    setTodos(prev => [...prev, todo])
    setInput('')
    setNewDueDate('')
    setNewRecurrenceDays([])
    setShowCustomRecurrence(false)
  }

  const toggleTodo = (id: string) => {
    setTodos(prev => {
      const todo = prev.find(t => t.id === id)
      if (!todo) return prev
      
      const newDone = !todo.done
      const now = new Date().toISOString()
      
      if (newDone && todo.category !== 'once' && todo.recurrenceDays && todo.recurrenceDays.length > 0) {
        const nextTodo: Todo = {
          ...todo,
          id: crypto.randomUUID(),
          done: false,
          dueDate: getNextDueDate(todo.dueDate, todo.recurrenceDays),
          completedAt: now,
          originalId: todo.originalId || todo.id,
        }
        return prev.map(t => 
          t.id === id ? { ...t, done: true, completedAt: now } : t
        ).concat(nextTodo)
      }
      
      return prev.map(t => 
        t.id === id ? { ...t, done: newDone, completedAt: newDone ? now : undefined } : t
      )
    })
  }

  const getNextDueDate = (currentDueDate: string | undefined, recurrenceDays: RecurrenceDays): string => {
    const baseDate = currentDueDate ? new Date(currentDueDate) : new Date()
    baseDate.setDate(baseDate.getDate() + 1)
    for (let i = 0; i < 7; i++) {
      if (recurrenceDays.includes(baseDate.getDay())) {
        return baseDate.toISOString().split('T')[0]
      }
      baseDate.setDate(baseDate.getDate() + 1)
    }
    return baseDate.toISOString().split('T')[0]
  }

  const deleteTodo = (id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id))
  }

  const setCategory = (id: string, category: Category) => {
    setTodos(prev => prev.map(t => (t.id === id ? { ...t, category } : t)))
  }

  const setPriority = (id: string, position: number) => {
    setTodos(prev => {
      const from = prev.findIndex(t => t.id === id)
      if (from === -1) return prev
      const to = Math.min(Math.max(1, position), prev.length) - 1
      if (to === from) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') addTodo()
  }

  const startEdit = (todo: Todo) => {
    setEditingId(todo.id)
    setEditText(todo.text)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  const saveEdit = (id: string) => {
    const text = editText.trim()
    if (text) {
      setTodos(prev => prev.map(t => (t.id === id ? { ...t, text } : t)))
    }
    setEditingId(null)
    setEditText('')
  }

  const handleEditKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') saveEdit(id)
    if (e.key === 'Escape') cancelEdit()
  }

  const toggleRecurrenceDay = (day: number) => {
    setNewRecurrenceDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b)
    )
  }

  const isArcade = theme === 'neon' || theme === 'crt'
  const visibleTodos = filter === 'all' 
    ? todos.filter(t => shouldShowToday(t.dueDate, t.recurrenceDays))
    : todos.filter(t => t.category === filter && shouldShowToday(t.dueDate, t.recurrenceDays))
  const remaining = visibleTodos.filter(t => !t.done).length
  const totalTasks = todos.length
  const completedTasks = todos.filter(t => t.done).length

  return (
    <div className="container">
      <div className="topbar">
        <div className="mode-toggle" role="radiogroup" aria-label="Select mode">
          {MODE_ORDER.map(m => (
            <button
              key={m}
              className={`mode-btn ${mode === m ? 'active' : ''}`}
              onClick={() => applyMode(m)}
              role="radio"
              aria-checked={mode === m}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <select
          className="select-control theme-select"
          value={theme}
          onChange={e => applyTheme(e.target.value as Theme)}
          aria-label="Choose theme"
        >
          {THEME_ORDER.map(t => (
            <option key={t} value={t}>
              {THEME_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <h1>To-Do List</h1>

      <div className="panel">
        <div className="input-row">
          <input
            type="text"
            placeholder={isArcade ? 'INSERT COIN...' : 'Add a task...'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <input
            type="date"
            className="select-control due-date-input"
            value={newDueDate}
            onChange={e => setNewDueDate(e.target.value)}
            min={getTodayString()}
            aria-label="Due date"
          />
          <select
            className="select-control new-category-select category-select"
            data-category={newCategory}
            value={newCategory}
            onChange={e => {
              const cat = e.target.value as Category
              setNewCategory(cat)
              if (cat === 'custom') {
                setShowCustomRecurrence(true)
              } else {
                setShowCustomRecurrence(false)
                setNewRecurrenceDays([])
              }
            }}
            aria-label="Category for new task"
          >
            {CATEGORY_ORDER.map(c => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          {showCustomRecurrence && (
            <div className="recurrence-days">
              {DAY_LABELS.map((day, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`recurrence-day ${newRecurrenceDays.includes(idx) ? 'active' : ''}`}
                  onClick={() => toggleRecurrenceDay(idx)}
                  aria-pressed={newRecurrenceDays.includes(idx)}
                >
                  {day}
                </button>
              ))}
            </div>
          )}
          <button className="btn-add" onClick={addTodo}>
            {isArcade ? '+ ADD' : 'Add'}
          </button>
        </div>

        <div className="filter-tabs">
          {FILTER_ORDER.map(f => (
            <button
              key={f}
              className={`filter-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>

        <div className="counters">
          <div className="counter">
            <span>{remaining}</span> {isArcade ? 'MISSIONS LEFT' : 'tasks left'}
          </div>
          <div className="counter total-counter">
            <span>{completedTasks}</span> / <span>{totalTasks}</span> {isArcade ? 'COMPLETED' : 'completed'}
          </div>
        </div>

        <div className="todo-list">
          {!mounted ? null : todos.length === 0 ? (
            <div className="empty-state">
              {isArcade ? (
                <>
                  <p>NO QUESTS YET</p>
                  <p className="blink" style={{ marginTop: '1rem' }}>
                    INSERT COIN TO BEGIN_
                  </p>
                </>
              ) : (
                <>
                  <p>No tasks yet</p>
                  <p style={{ marginTop: '1rem' }}>Add one to get started.</p>
                </>
              )}
            </div>
          ) : visibleTodos.length === 0 ? (
            <div className="empty-state small">
              <p>
                {isArcade ? 'NOTHING HERE' : `No ${FILTER_LABEL[filter].toLowerCase()} tasks`}
              </p>
            </div>
          ) : (
            visibleTodos.map(todo => {
              const index = todos.findIndex(t => t.id === todo.id)
              const isOverdueTask = isOverdue(todo.dueDate)
              const isDueTodayTask = isDueToday(todo.dueDate)
              return (
                <div key={todo.id} className={`todo-item ${todo.done ? 'done' : ''} ${isOverdueTask ? 'overdue' : ''} ${isDueTodayTask && !todo.done ? 'due-today' : ''}`}>
                  <div className="todo-main">
                    <button
                      className="todo-check"
                      onClick={() => toggleTodo(todo.id)}
                      aria-label="Toggle todo"
                    >
                      {todo.done ? '✓' : ''}
                    </button>
                    {editingId === todo.id ? (
                      <input
                        className="todo-edit-input"
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        onKeyDown={e => handleEditKeyDown(e, todo.id)}
                        onBlur={() => saveEdit(todo.id)}
                        autoFocus
                      />
                    ) : (
                      <span className="todo-text" onDoubleClick={() => startEdit(todo)}>
                        {todo.text}
                      </span>
                    )}
                    <div className="todo-actions">
                      <button
                        className="btn-edit"
                        onClick={() => startEdit(todo)}
                        aria-label="Edit todo"
                      >
                        ✎
                      </button>
                      <button
                        className="btn-delete"
                        onClick={() => deleteTodo(todo.id)}
                        aria-label="Delete todo"
                      >
                        X
                      </button>
                    </div>
                  </div>
                  <div className="todo-meta">
                    <select
                      className="select-control priority-select"
                      value={index + 1}
                      onChange={e => setPriority(todo.id, Number(e.target.value))}
                      aria-label={`Priority for "${todo.text}"`}
                    >
                      {todos.map((_, i) => (
                        <option key={i} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                    <select
                      className="select-control category-select"
                      data-category={todo.category}
                      value={todo.category}
                      onChange={e => setCategory(todo.id, e.target.value as Category)}
                      aria-label={`Category for "${todo.text}"`}
                    >
                      {CATEGORY_ORDER.map(c => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                    {todo.dueDate && (
                      <span className={`due-date ${isOverdueTask ? 'overdue' : ''} ${isDueTodayTask && !todo.done ? 'due-today' : ''}`}>
                        {formatDueDate(todo.dueDate)}
                        {todo.recurrenceDays && todo.recurrenceDays.length > 0 && (
                          <span className="recurrence-indicator">
                            {' '}
                            {todo.recurrenceDays.map(d => DAY_LABELS[d]).join(', ')}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' })
}
