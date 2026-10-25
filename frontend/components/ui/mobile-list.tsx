'use client'

import { cn } from '@heroui/react'
import type { ReactNode } from 'react'

/**
 * 窄屏卡片列表容器：桌面端隐藏（md 以上用表格），移动端按卡片堆叠。
 */
export function MobileList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn('space-y-3 md:hidden', className)}>{children}</div>
}

export function MobileListCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border border-border bg-surface p-4', className)}>
      {children}
    </div>
  )
}

/**
 * 卡片内的「标签 / 值」行。标签固定宽度，值可换行。
 */
export function MobileField({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-sm', className)}>
      <span className="text-muted">{label}</span>
      <div className="min-w-0 text-foreground">{children}</div>
    </div>
  )
}
