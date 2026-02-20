import './globals.css'
import type { Metadata } from 'next'
import ToastProvider from './toast-provider'

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
    <html lang="en" suppressHydrationWarning>
      <body><ToastProvider>{children}</ToastProvider></body>
    </html>
  )
}
