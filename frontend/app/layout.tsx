import './globals.css'
import type { Metadata } from 'next'
import { Agentation } from 'agentation'
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
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{
          __html: `(function(){
      var t = localStorage.getItem('theme');
      if (!t) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', t);
    })();`
        }} />
      </head>
      <body>
        <ToastProvider>
          <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
          {process.env.NODE_ENV === 'development' && <Agentation />}
        </ToastProvider>
      </body>
    </html>
  )
}
