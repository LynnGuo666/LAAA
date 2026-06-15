import { Chip, Select, ListBox, ListBoxItem } from '@heroui/react'

const USER_STATUS_OPTIONS = [
  { id: 'active', label: '激活' },
  { id: 'inactive', label: '未激活' },
  { id: 'suspended', label: '暂停' },
]

const STATUS_COLOR_MAP: Record<string, 'success' | 'default' | 'danger'> = {
  active: 'success',
  inactive: 'default',
  suspended: 'danger',
}

const STATUS_LABEL_MAP: Record<string, string> = {
  active: '激活',
  inactive: '未激活',
  suspended: '暂停',
}

export function renderStatusChip(status: string) {
  return (
    <Chip color={STATUS_COLOR_MAP[status] ?? 'default'} variant="soft" size="sm">
      {STATUS_LABEL_MAP[status] ?? status}
    </Chip>
  )
}

export function renderStatusSelect(
  value: string,
  onChange: (nextValue: string) => void,
  isDisabled = false,
) {
  return (
    <Select
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key ?? 'active'))}
      isDisabled={isDisabled}
    >
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {USER_STATUS_OPTIONS.map((option) => (
            <ListBoxItem key={option.id} id={option.id}>
              {option.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )
}

export { USER_STATUS_OPTIONS }