import type { Metadata } from 'next'
import { Orbitron, Rajdhani, Press_Start_2P, Playfair_Display, EB_Garamond } from 'next/font/google'
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

const pressStart = Press_Start_2P({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-retro',
})

const playfairDisplay = Playfair_Display({
  weight: ['700', '800'],
  style: ['italic', 'normal'],
  subsets: ['latin'],
  variable: '--font-paper-heading',
})

const ebGaramond = EB_Garamond({
  weight: ['400', '600'],
  subsets: ['latin'],
  variable: '--font-paper',
})

export const metadata: Metadata = {
  title: 'ARCADE TODO',
  description: 'An arcade-themed todo list with neon and retro CRT themes',
}

const THEME_INIT_SCRIPT = `try{document.documentElement.setAttribute('data-theme',localStorage.getItem('arcade-theme')||'neon')}catch(e){}`


export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className={`${orbitron.variable} ${rajdhani.variable} ${pressStart.variable} ${playfairDisplay.variable} ${ebGaramond.variable}`}
      >
        {children}
      </body>
    </html>
  )
}
