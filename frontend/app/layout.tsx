import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'OAuth Server',
  description: 'Personal OAuth 2.0 Authorization Server',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
