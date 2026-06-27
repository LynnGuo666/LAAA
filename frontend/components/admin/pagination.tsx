'use client'

import { Button, Pagination } from '@heroui/react'

interface AdminPaginationProps {
  /** 当前页（从 0 开始计数）。 */
  page: number
  /** 总条目数。 */
  total: number
  /** 每页条数。 */
  limit: number
  /** 翻页回调，参数为目标页（从 0 开始）。 */
  onPageChange: (page: number) => void
  /** 可选的自定义摘要文案，默认为「第 X / Y 页，共 N 条」。 */
  summary?: (page: number, totalPages: number, total: number) => string
  /** 是否居中对齐（默认左对齐摘要、右对齐按钮）。 */
  className?: string
}

const defaultSummary = (page: number, totalPages: number, total: number) =>
  `第 ${page + 1} / ${totalPages} 页，共 ${total} 条`

/**
 * 统一的分页控件：摘要 + 上一页 / 数字页码 / 下一页。
 * 替代 admin 各列表页手写的「上一页/下一页 Button」实现。
 */
export function AdminPagination({
  page,
  total,
  limit,
  onPageChange,
  summary = defaultSummary,
  className,
}: AdminPaginationProps) {
  const totalPages = Math.ceil(total / limit)
  if (totalPages <= 1) return null

  return (
    <Pagination className={className}>
      <Pagination.Summary>{summary(page, totalPages, total)}</Pagination.Summary>
      <Pagination.Content>
        <Pagination.Item>
          <Pagination.Previous
            isDisabled={page === 0}
            onPress={() => onPageChange(Math.max(0, page - 1))}
          >
            上一页
          </Pagination.Previous>
        </Pagination.Item>
        {Array.from({ length: totalPages }, (_, index) => (
          <Pagination.Item key={index}>
            <Pagination.Link isActive={page === index} onPress={() => onPageChange(index)}>
              {index + 1}
            </Pagination.Link>
          </Pagination.Item>
        ))}
        <Pagination.Item>
          <Pagination.Next
            isDisabled={page >= totalPages - 1}
            onPress={() => onPageChange(Math.min(totalPages - 1, page + 1))}
          >
            下一页
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  )
}

/**
 * 精简版分页：仅上一页 / 下一页 + 文案，用于嵌入 Table.Footer 等窄空间。
 */
export function AdminSimplePagination({
  page,
  total,
  limit,
  onPageChange,
  summary = defaultSummary,
  className,
}: AdminPaginationProps) {
  const totalPages = Math.ceil(total / limit)
  if (totalPages <= 1) return null

  return (
    <div className={className ?? 'flex w-full items-center justify-between gap-4 text-sm text-default-500'}>
      <span>{summary(page, totalPages, total)}</span>
      <div className="flex gap-2">
        <Button variant="secondary" isDisabled={page === 0} onPress={() => onPageChange(Math.max(0, page - 1))}>
          上一页
        </Button>
        <Button
          variant="secondary"
          isDisabled={page >= totalPages - 1}
          onPress={() => onPageChange(Math.min(totalPages - 1, page + 1))}
        >
          下一页
        </Button>
      </div>
    </div>
  )
}
