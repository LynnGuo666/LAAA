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

/**
 * 内联加载态：用于嵌入到已有卡片 / 抽屉 / 标签页内容区，
 * 占据较少纵向空间，不像 PageLoadingState 那样占满整屏。
 */
export function InlineLoading({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-6 text-default-500', className)}>
      <Spinner size="sm" />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  )
}

/**
 * 骨架屏：在等待真实内容时保持布局稳定，避免内容跳出造成视觉跳动。
 * rows 控制行数，适合列表 / 表格场景。
 */
export function SkeletonRows({
  rows = 3,
  className,
  rowClassName,
}: {
  rows?: number
  className?: string
  rowClassName?: string
}) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-live="polite">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn('h-4 w-full animate-pulse rounded bg-default-200/70', rowClassName)}
        />
      ))}
      <span className="sr-only">加载中...</span>
    </div>
  )
}
