import './globals.css'
import type { Metadata } from 'next'
import dynamic from 'next/dynamic'
import { ConfirmDialogProvider } from '@/components/ui/confirm-dialog-provider'
import { AuthBootstrap } from '@/components/AuthBootstrap'
import ToastProvider from './toast-provider'

// agentation 仅在开发模式按需动态加载:NODE_ENV 会在构建期被内联,
// 生产构建下整个分支成为死代码被 tree-shake,不进任何 chunk。
const Agentation =
  process.env.NODE_ENV === 'development'
    ? dynamic(() => import('agentation').then((m) => m.Agentation))
    : null

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
          <ConfirmDialogProvider>
            <AuthBootstrap>{children}</AuthBootstrap>
          </ConfirmDialogProvider>
          {Agentation ? <Agentation /> : null}
        </ToastProvider>
      </body>
    </html>
  )
}
