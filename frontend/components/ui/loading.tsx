'use client'

import { Spinner, cn } from '@heroui/react'

export function PageLoadingState({ label = '加载中...', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('min-h-screen flex flex-col', className)}>
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <p className="text-sm text-default-500">{label}</p>
        </div>
      </div>
      <p className="pb-6 text-center text-xs text-default-400">Powered By Lynn❤️</p>
    </div>
  )
}
