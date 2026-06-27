'use client'

import { UICheckbox } from '@/components/ui/primitives'
import { AdminFieldGroup } from '@/components/admin/admin-ui'

interface GroupItem {
  id: number
  name: string
  description?: string
}

interface GroupCheckboxListProps {
  /** 列表用途：白名单或黑名单，用于显示标题与说明。 */
  type: 'allowed' | 'denied'
  groups: GroupItem[]
  /** 当前已选中的用户组 id。 */
  selectedIds: number[]
  /** 切换某个用户组的选中状态。 */
  onToggle: (groupId: number) => void
}

const CONFIG = {
  allowed: {
    label: '允许访问（白名单）',
    description: '这些用户组的成员可以访问此应用。',
  },
  denied: {
    label: '禁止访问（黑名单）',
    description: '这些用户组的成员会被拒绝访问。',
  },
} as const

/**
 * 用户组多选列表：用于「应用访问控制」与「用户组应用权限」中
 * 白名单 / 黑名单两套完全相同结构的勾选列表，避免重复实现。
 */
export default function GroupCheckboxList({
  type,
  groups,
  selectedIds,
  onToggle,
}: GroupCheckboxListProps) {
  const config = CONFIG[type]

  return (
    <AdminFieldGroup label={config.label} description={config.description}>
      <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-default-200/70 p-3">
        {groups.map((group) => (
          <UICheckbox
            key={group.id}
            className="m-0 max-w-full border-b border-default-200/70 py-3 last:border-b-0"
            isSelected={selectedIds.includes(group.id)}
            onChange={() => onToggle(group.id)}
          >
            <div className="min-w-0">
              <p className="font-medium text-foreground">{group.name}</p>
              {group.description ? (
                <p className="mt-1 text-xs text-default-500">{group.description}</p>
              ) : null}
            </div>
          </UICheckbox>
        ))}
      </div>
    </AdminFieldGroup>
  )
}
