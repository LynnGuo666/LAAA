'use client'

import { Button, Checkbox, Description, FieldError, Input, Label, ListBox, ListBoxItem, Radio, RadioGroup, Select, TextArea, TextField } from '@heroui/react'
import type { ComponentProps, ReactNode } from 'react'

export const UIButton = Button
export const UIInput = Input
export const UITextarea = TextArea
export const UITextField = TextField
export const UILabel = Label
export const UIDescription = Description
export const UIFieldError = FieldError

export const UIRadioGroup = RadioGroup

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

export const UISelect = Select

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

export { ListBox as UIListBox, ListBoxItem as UISelectItem }
