import type { Metadata } from 'next'
import { Orbitron, Rajdhani } from 'next/font/google'
import './globals.css'

const orbitron = Orbitron({
  weight: ['600', '800'],
  subsets: ['latin'],
  variable: '--font-arcade',
})

const rajdhani = Rajdhani({
  weight: ['500', '600'],
  subsets: ['latin'],
  variable: '--font-body',
})

export const metadata: Metadata = {
  title: 'ARCADE TODO',
  description: 'A neon arcade-themed todo list',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${orbitron.variable} ${rajdhani.variable}`}>{children}</body>
    </html>
  )
}
