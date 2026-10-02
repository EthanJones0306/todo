import type { Metadata, Viewport } from 'next'
import { Orbitron, Press_Start_2P, Playfair_Display, EB_Garamond, Inter, JetBrains_Mono } from 'next/font/google'
import { SETTINGS_INIT_SCRIPT } from '@/lib/init-script'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-ui',
})

const orbitron = Orbitron({
  weight: ['600', '800'],
  subsets: ['latin'],
  variable: '--font-arcade',
})

const pressStart = Press_Start_2P({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-retro',
})

const jetbrainsMono = JetBrains_Mono({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-mono',
})

const playfairDisplay = Playfair_Display({
  weight: ['600', '700'],
  style: ['italic', 'normal'],
  subsets: ['latin'],
  variable: '--font-paper-heading',
})

const ebGaramond = EB_Garamond({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-paper',
})

export const metadata: Metadata = {
  title: 'Arcade Tasks',
  description: 'A focused, local-first task manager with smart views, recurring tasks, projects and twelve themes.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${orbitron.variable} ${pressStart.variable} ${jetbrainsMono.variable} ${playfairDisplay.variable} ${ebGaramond.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SETTINGS_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
