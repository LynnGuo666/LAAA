import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'OAuth 2.0 Authorization Server',
  description: 'Secure OAuth 2.0 and OpenID Connect authorization server',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className={`${inter.className} h-full`}>
        <main className="min-h-full">
          {children}
        </main>
      </body>
    </html>
  )
}