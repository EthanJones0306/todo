'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/*
 * Pointer-driven drag-to-reorder for a vertical list. Pure mechanics: it measures the rows, moves the
 * dragged one with the pointer, slides the others to open a gap, auto-scrolls the window and reports
 * where the row was dropped. What a drop means (and which slots are allowed) is up to the caller.
 *
 * Transforms are written straight to the DOM so a drag never re-renders the list on every pointer
 * move; React state only changes when the landing slot does.
 */

export interface SortableDrag {
  id: string
  /** Index the row started at. */
  from: number
  /** Index the row would land at if dropped now. */
  to: number
  /** Inclusive range of indexes the row may land in. */
  range: [number, number]
  /** True while the row animates into its slot (or back) after the pointer is released. */
  settling: boolean
}

interface Options {
  ids: string[]
  enabled: boolean
  /** Slots the row with this id may land in; the whole list when omitted. */
  getRange?: (id: string) => [number, number]
  /**
   * Called once the row has settled at a new index. `targetId` is the row that was at that index: moving
   * down, the dragged row lands after it; moving up, before it. Until the new order renders, the
   * transforms hold every row exactly where the new order puts it, so the swap is invisible.
   */
  onDrop: (id: string, targetId: string) => void
}

const START_DISTANCE = 5
const EDGE = 60
const MAX_SCROLL_SPEED = 18
const SETTLE_MS = 180
const LIFT = 'scale(1.02)'
// Never start a row drag from something that already does its own thing on press.
const INTERACTIVE = 'button, input, textarea, select, a, label, [role="checkbox"], [contenteditable], .menu-wrap'

function reducedMotion(): boolean {
  return (
    document.documentElement.hasAttribute('data-reduce-motion') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

interface Session {
  id: string
  /** The list as it was when the drag started. */
  ids: string[]
  pointerId: number
  from: number
  to: number
  range: [number, number]
  /** Document-space (scroll-independent) row boxes, measured at drag start. */
  rects: { top: number; height: number }[]
  /** How far each other row slides to make room: the dragged row's height plus the gap between rows. */
  shift: number
  startY: number
  startScroll: number
  clientY: number
  els: HTMLElement[]
  frame: number
  reduce: boolean
}

export function useSortable({ ids, enabled, getRange, onDrop }: Options) {
  const [drag, setDrag] = useState<SortableDrag | null>(null)
  // Latest props for listeners that live outside React's render cycle.
  const latest = useRef({ ids, enabled, getRange, onDrop })
  latest.current = { ids, enabled, getRange, onDrop }
  // Window listeners must be the same functions when removed as when added, so build them once.
  const [h] = useState(() => createHandlers(latest, setDrag))

  // A row that leaves mid-drag (sync, another tab) ends the drag where it started.
  useEffect(() => {
    if (drag && !drag.settling && !ids.includes(drag.id)) h.cancel()
  })

  // Once the list has rendered after a drop, remove the transforms before the browser paints.
  useLayoutEffect(() => {
    if (!drag) h.clearSettled()
  })

  useEffect(() => h.dispose, [h])

  return { drag, rowRef: h.rowRef, onRowPointerDown: h.onRowPointerDown, onGripPointerDown: h.onGripPointerDown }
}

function createHandlers(
  latest: { current: Options },
  setDrag: React.Dispatch<React.SetStateAction<SortableDrag | null>>
) {
  const els = new Map<string, HTMLElement>()
  const refs = new Map<string, (el: HTMLElement | null) => void>()
  let session: Session | null = null
  let pending: { id: string; pointerId: number; x: number; y: number; el: HTMLElement } | null = null
  let settleTimer: number | undefined
  let settled: HTMLElement[] = []

  const transforms = (s: Session) => {
    s.els.forEach((el, i) => {
      if (i === s.from) return
      const offset = i > s.from && i <= s.to ? -s.shift : i < s.from && i >= s.to ? s.shift : 0
      el.style.transform = offset ? `translateY(${offset}px)` : ''
    })
  }

  /** Where the dragged row's top sits, relative to its start, when it rests at `to`. */
  const slotOffset = (s: Session, to: number) => {
    const r = s.rects
    if (to > s.from) return r[to].top + r[to].height - (r[s.from].top + r[s.from].height)
    return r[to].top - r[s.from].top
  }

  const update = () => {
    const s = session
    if (!s) return
    const dy = s.clientY + window.scrollY - (s.startY + s.startScroll)
    s.els[s.from].style.transform = `translateY(${dy}px)${s.reduce ? '' : ` ${LIFT}`}`

    // Land past every row whose midpoint the dragged row's centre has crossed.
    const centre = s.rects[s.from].top + dy + s.rects[s.from].height / 2
    let to = s.from
    for (let i = s.from + 1; i < s.rects.length; i++) if (centre > s.rects[i].top + s.rects[i].height / 2) to = i
    for (let i = s.from - 1; i >= 0; i--) if (centre < s.rects[i].top + s.rects[i].height / 2) to = i
    to = Math.min(Math.max(to, s.range[0]), s.range[1])
    if (to !== s.to) {
      s.to = to
      transforms(s)
      setDrag(d => (d ? { ...d, to } : d))
    }
  }

  // Scroll the window while the pointer rests near the top or bottom edge, faster the closer it gets.
  const autoScroll = () => {
    const s = session
    if (!s) return
    const y = s.clientY
    const bottom = window.innerHeight - y
    const speed = y < EDGE ? -(1 - y / EDGE) : bottom < EDGE ? 1 - bottom / EDGE : 0
    if (speed) window.scrollBy(0, Math.sign(speed) * Math.max(1, Math.round(Math.abs(speed) * MAX_SCROLL_SPEED)))
    s.frame = requestAnimationFrame(autoScroll)
  }

  const clearStyles = (list: HTMLElement[]) => {
    list.forEach(el => {
      el.style.transition = 'none'
      el.style.transform = ''
    })
    // Commit the un-transformed layout before transitions come back, so nothing animates from the old spot.
    void document.body.offsetHeight
    requestAnimationFrame(() => list.forEach(el => (el.style.transition = '')))
  }

  const attach = () => {
    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const detach = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('scroll', update)
    document.documentElement.classList.remove('is-sorting')
  }

  /** Release the row: settle it at its landing slot (or back home), then hand the result to the caller. */
  const finish = (commit: boolean) => {
    const s = session
    if (!s) return
    cancelAnimationFrame(s.frame)
    detach()
    session = null
    const to = commit ? s.to : s.from
    if (!commit) {
      s.to = s.from
      transforms(s)
    }
    s.els[s.from].style.transform = `translateY(${slotOffset(s, to)}px)`
    setDrag(d => (d ? { ...d, to, settling: true } : d))

    const done = () => {
      settleTimer = undefined
      settled = s.els
      if (to !== s.from) latest.current.onDrop(s.id, s.ids[to])
      setDrag(null)
    }
    if (s.reduce) done()
    else settleTimer = window.setTimeout(done, SETTLE_MS)
  }

  const begin = (id: string, el: HTMLElement, pointerId: number, startY: number) => {
    pending = null
    const { ids, getRange } = latest.current
    const from = ids.indexOf(id)
    const list = ids.map(i => els.get(i)).filter((x): x is HTMLElement => !!x)
    if (from === -1 || list.length !== ids.length) return detach()
    const rects = list.map(r => {
      const b = r.getBoundingClientRect()
      return { top: b.top + window.scrollY, height: b.height }
    })
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - (rects[0].top + rects[0].height)) : 0
    const range = getRange?.(id) ?? [0, ids.length - 1]
    try {
      el.setPointerCapture(pointerId)
    } catch {
      // The pointer may already be gone (a very quick tap); the window listeners still see the rest.
    }
    window.getSelection()?.removeAllRanges()
    document.documentElement.classList.add('is-sorting')
    session = {
      id,
      ids,
      pointerId,
      from,
      to: from,
      range,
      rects,
      shift: rects[from].height + gap,
      startY,
      startScroll: window.scrollY,
      clientY: startY,
      els: list,
      frame: 0,
      reduce: reducedMotion(),
    }
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('keydown', onKey, true)
    session.frame = requestAnimationFrame(autoScroll)
    setDrag({ id, from, to: from, range, settling: false })
    update()
  }

  function onMove(e: PointerEvent) {
    const p = pending
    if (p && e.pointerId === p.pointerId) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= START_DISTANCE) return
      begin(p.id, p.el, e.pointerId, p.y)
    }
    const s = session
    if (!s || e.pointerId !== s.pointerId) return
    e.preventDefault()
    s.clientY = e.clientY
    update()
  }

  function onUp(e: PointerEvent) {
    if (pending?.pointerId === e.pointerId) {
      pending = null
      return detach()
    }
    if (!session || e.pointerId !== session.pointerId) return
    // The click that follows a drag would otherwise land on whatever is under the pointer.
    const swallow = (ev: MouseEvent) => {
      ev.stopPropagation()
      ev.preventDefault()
    }
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, true), 0)
    finish(true)
  }

  function onCancel(e: PointerEvent) {
    if (pending?.pointerId === e.pointerId) {
      pending = null
      detach()
    } else if (session?.pointerId === e.pointerId) finish(false)
  }

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !session) return
    e.preventDefault()
    e.stopPropagation()
    finish(false)
  }

  const busy = () => !latest.current.enabled || !!session || !!pending || settleTimer !== undefined

  return {
    rowRef(id: string) {
      let ref = refs.get(id)
      if (!ref) {
        ref = el => (el ? els.set(id, el) : els.delete(id))
        refs.set(id, ref)
      }
      return ref
    },

    /** Pointer down on the row itself: mouse only, and only once it has moved a few pixels. */
    onRowPointerDown: (id: string) => (e: React.PointerEvent<HTMLElement>) => {
      if (busy() || e.pointerType !== 'mouse' || e.button !== 0) return
      if ((e.target as HTMLElement).closest(INTERACTIVE)) return
      pending = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, el: e.currentTarget }
      attach()
    },

    /** Pointer down on the grip handle: any pointer, straight away. */
    onGripPointerDown: (id: string) => (e: React.PointerEvent<HTMLElement>) => {
      const row = els.get(id)
      if (busy() || !row || (e.pointerType === 'mouse' && e.button !== 0)) return
      e.preventDefault()
      e.stopPropagation()
      attach()
      begin(id, row, e.pointerId, e.clientY)
    },

    cancel: () => finish(false),

    clearSettled: () => {
      if (!settled.length) return
      clearStyles(settled)
      settled = []
    },

    dispose: () => {
      window.clearTimeout(settleTimer)
      if (session) cancelAnimationFrame(session.frame)
      session = null
      pending = null
      detach()
    },
  }
}
