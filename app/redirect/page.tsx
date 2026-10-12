'use client'

import { useEffect } from 'react'
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge'

/** Microsoft sign-in returns here; MSAL hands the response back to the page that started it. */
export default function Redirect() {
  useEffect(() => {
    broadcastResponseToMainFrame().catch(error => {
      console.error('Error completing Microsoft sign-in:', error)
    })
  }, [])

  return (
    <div className="redirect-page">
      <p>Finishing sign-in…</p>
    </div>
  )
}
