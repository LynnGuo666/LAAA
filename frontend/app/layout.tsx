import './globals.css'
import type { Metadata } from 'next'
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog-provider'
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
      <body>
        <ToastProvider>
          <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
        </ToastProvider>
      </body>
    </html>
  )
}
