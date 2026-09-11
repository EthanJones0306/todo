import type { Metadata } from 'next'
import { Press_Start_2P } from 'next/font/google'
import './globals.css'

const pressStart = Press_Start_2P({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-arcade',
})

export const metadata: Metadata = {
  title: 'ARCADE TODO',
  description: 'A retro arcade-themed todo list',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={pressStart.variable}>{children}</body>
    </html>
  )
}
