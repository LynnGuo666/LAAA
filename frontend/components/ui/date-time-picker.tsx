'use client'

import { Calendar, DateField, DatePicker, TimeField, cn } from '@heroui/react'
import { parseDateTime, toCalendarDateTime } from '@internationalized/date'
import type { CalendarDateTime } from '@internationalized/date'

type DateTimePickerProps = {
  /** 表单值格式：YYYY-MM-DDTHH:mm（与原生 datetime-local 一致） */
  value: string
  onChange: (value: string) => void
  isDisabled?: boolean
  ariaLabel?: string
  className?: string
}

function parseValue(value: string): CalendarDateTime | null {
  if (!value) return null
  try {
    // parseDateTime 需要秒，而 datetime-local 的值通常只到分钟
    return parseDateTime(value.length === 16 ? `${value}:00` : value)
  } catch {
    return null
  }
}

/**
 * HeroUI DatePicker 封装的日期+时间选择器。
 * 替代原生 <input type="datetime-local">，让日历/时间面板与站点主题一致，
 * 对外的 value 仍是 datetime-local 字符串，便于继续提交给后端。
 */
export function DateTimePicker({
  value,
  onChange,
  isDisabled,
  ariaLabel = '选择日期和时间',
  className,
}: DateTimePickerProps) {
  return (
    <DatePicker
      aria-label={ariaLabel}
      className={cn('w-full', className)}
      granularity="minute"
      hourCycle={24}
      shouldForceLeadingZeros
      shouldCloseOnSelect={false}
      isDisabled={isDisabled}
      value={parseValue(value)}
      onChange={(next) => {
        if (!next) {
          onChange('')
          return
        }
        // 只选日期时 React Aria 可能给 CalendarDate，统一补成 00:00
        const dateTime = 'hour' in next ? next : toCalendarDateTime(next)
        onChange(dateTime.toString().slice(0, 16))
      }}
    >
      {({ state }) => (
        <>
          <DateField.Group fullWidth>
            <DateField.Input>
              {(segment) => <DateField.Segment segment={segment} />}
            </DateField.Input>
            <DateField.Suffix>
              <DatePicker.Trigger>
                <DatePicker.TriggerIndicator />
              </DatePicker.Trigger>
            </DateField.Suffix>
          </DateField.Group>

          <DatePicker.Popover className="flex flex-col gap-3">
            <Calendar aria-label="选择日期">
              <Calendar.Header>
                <Calendar.YearPickerTrigger>
                  <Calendar.YearPickerTriggerHeading />
                  <Calendar.YearPickerTriggerIndicator />
                </Calendar.YearPickerTrigger>
                <Calendar.NavButton slot="previous" />
                <Calendar.NavButton slot="next" />
              </Calendar.Header>
              <Calendar.Grid>
                <Calendar.GridHeader>
                  {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
                </Calendar.GridHeader>
                <Calendar.GridBody>
                  {(date) => <Calendar.Cell date={date} />}
                </Calendar.GridBody>
              </Calendar.Grid>
              <Calendar.YearPickerGrid>
                <Calendar.YearPickerGridBody>
                  {({ year }) => <Calendar.YearPickerCell year={year} />}
                </Calendar.YearPickerGridBody>
              </Calendar.YearPickerGrid>
            </Calendar>

            <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3">
              <span className="text-sm text-muted">时间</span>
              <TimeField
                aria-label="选择时间"
                granularity="minute"
                hourCycle={24}
                shouldForceLeadingZeros
                value={state.timeValue}
                onChange={(next) => {
                  if (next) state.setTimeValue(next)
                }}
                className="w-40"
              >
                <TimeField.Group variant="secondary">
                  <TimeField.Input>
                    {(segment) => <TimeField.Segment segment={segment} />}
                  </TimeField.Input>
                </TimeField.Group>
              </TimeField>
            </div>
          </DatePicker.Popover>
        </>
      )}
    </DatePicker>
  )
}
