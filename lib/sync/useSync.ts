'use client'

import { useEffect, useState } from 'react'
import { getStatus, STATUS_EVENT, SyncStatus } from '@/lib/sync/engine'

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(getStatus)
  useEffect(() => {
    const update = () => setStatus(getStatus())
    update()
    window.addEventListener(STATUS_EVENT, update)
    return () => window.removeEventListener(STATUS_EVENT, update)
  }, [])
  return status
}

export function formatAgo(iso?: string): string {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
