'use client'

import { Checkbox, Radio } from '@heroui/react'
import type { ComponentProps, ReactNode } from 'react'

type UICheckboxProps = Omit<ComponentProps<typeof Checkbox>, 'children'> & {
  children?: ReactNode
}

/**
 * HeroUI v3.0 的 Checkbox 复合结构：
 * Checkbox > Control / Content（Content 内放纯文本标签）。
 * 注意：当前依赖版本（@heroui/react 3.0.x）中 Control 必须与 Content 平级，
 * 放进 Content 会触发 flex-col，导致控件和文案上下错位。
 */
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

/** 同 UICheckbox：Radio.Control 与 Radio.Content 平级。 */
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
