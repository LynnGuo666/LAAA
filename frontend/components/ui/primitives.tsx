'use client'

import { Checkbox, Radio } from '@heroui/react'
import type { ComponentProps, ReactNode } from 'react'

type UICheckboxProps = Omit<ComponentProps<typeof Checkbox>, 'children'> & {
  children?: ReactNode
}

export function UICheckbox({ children, ...props }: UICheckboxProps) {
  return (
    <Checkbox {...props}>
      <Checkbox.Control>
        <Checkbox.Indicator />
      </Checkbox.Control>
      {children ? <Checkbox.Content>{children}</Checkbox.Content> : null}
    </Checkbox>
  )
}

type UIRadioProps = Omit<ComponentProps<typeof Radio>, 'children'> & {
  children?: ReactNode
}

export function UIRadio({ children, ...props }: UIRadioProps) {
  return (
    <Radio {...props}>
      <Radio.Control>
        <Radio.Indicator />
      </Radio.Control>
      {children ? <Radio.Content>{children}</Radio.Content> : null}
    </Radio>
  )
}
