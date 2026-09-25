import type { Metadata } from 'next'
import { Orbitron, Rajdhani, Press_Start_2P, Playfair_Display, EB_Garamond, Inter, Space_Grotesk } from 'next/font/google'
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

const inter = Inter({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-standard',
})

const spaceGrotesk = Space_Grotesk({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-sharp',
})

export const metadata: Metadata = {
  title: 'To-Do List',
  description: 'A todo list with neon, retro CRT, paper, standard, midnight, forest, sunset, nord, slate, stone, zinc, and monochrome themes',
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
        className={`${orbitron.variable} ${rajdhani.variable} ${pressStart.variable} ${playfairDisplay.variable} ${ebGaramond.variable} ${inter.variable} ${spaceGrotesk.variable}`}
      >
        {children}
      </body>
    </html>
  )
}
