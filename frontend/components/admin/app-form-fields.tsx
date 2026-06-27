'use client'

import { Card, Checkbox, CheckboxGroup, Input, RadioGroup, TextArea } from '@heroui/react'
import { AdminFieldGroup, AdminFormField, AdminNotice } from '@/components/admin/admin-ui'
import { UICheckbox, UIRadio } from '@/components/ui/primitives'

export interface AppFormData {
  name: string
  description: string
  logo: string
  website_url: string
  redirect_uris: string
  allowed_scopes: string[]
  trusted: boolean
  default_access: boolean
}

export const AVAILABLE_SCOPES = [
  { value: 'profile', label: '基本信息 (profile)', description: '用户名、头像等基本信息' },
  { value: 'email', label: '邮箱地址 (email)', description: '用户邮箱地址' },
  { value: 'openid', label: 'OpenID Connect (openid)', description: 'OIDC 标准身份范围' },
  { value: 'read', label: '读取权限 (read)', description: '读取用户数据' },
  { value: 'write', label: '写入权限 (write)', description: '修改用户数据' },
]

export const EMPTY_APP_FORM: AppFormData = {
  name: '',
  description: '',
  logo: '',
  website_url: '',
  redirect_uris: '',
  allowed_scopes: ['profile', 'email'],
  trusted: false,
  default_access: false,
}

export function validateAppForm(formData: AppFormData): string | null {
  if (!formData.name.trim()) return '应用名称不能为空'
  if (formData.allowed_scopes.length === 0) return '请至少选择一个权限范围'
  if (formData.redirect_uris.split('\n').filter((item) => item.trim()).length === 0) {
    return '请至少填写一个回调地址'
  }
  return null
}

interface AppFormFieldsProps {
  formData: AppFormData
  setFormData: (updater: (previous: AppFormData) => AppFormData) => void
  formError?: string | null
  /**
   * 表单字段排列方式：
   * - "stacked"（默认）：所有字段纵向堆叠，适合 Modal。
   * - "two-column"：基础信息 / 高级设置两栏，适合整页编辑。
   */
  layout?: 'stacked' | 'two-column'
}

/**
 * OAuth 应用的表单字段集合：基础信息、回调地址、权限范围、信任与默认访问策略。
 * 在「创建应用」Modal 和「编辑应用」页面之间共享，避免两份重复实现。
 */
export function AppFormFields({
  formData,
  setFormData,
  formError,
  layout = 'stacked',
}: AppFormFieldsProps) {
  const basics = (
    <>
      <AdminFormField label="应用名称" isRequired>
        <Input
          type="text"
          value={formData.name}
          onChange={(event) =>
            setFormData((previous) => ({ ...previous, name: event.target.value }))
          }
        />
      </AdminFormField>

      <AdminFormField label="应用描述">
        <TextArea
          rows={3}
          value={formData.description}
          onChange={(event) =>
            setFormData((previous) => ({ ...previous, description: event.target.value }))
          }
        />
      </AdminFormField>

      <AdminFormField label="应用 Logo URL" description="Logo 会显示在授权页面上。">
        <Input
          type="url"
          placeholder="https://example.com/logo.png"
          value={formData.logo}
          onChange={(event) =>
            setFormData((previous) => ({ ...previous, logo: event.target.value }))
          }
        />
      </AdminFormField>

      <AdminFormField label="应用官网">
        <Input
          type="url"
          placeholder="https://example.com"
          value={formData.website_url}
          onChange={(event) =>
            setFormData((previous) => ({ ...previous, website_url: event.target.value }))
          }
        />
      </AdminFormField>
    </>
  )

  const advanced = (
    <>
      <AdminFormField label="回调地址" description="每行一个回调地址。" isRequired>
        <TextArea
          rows={4}
          className="font-mono text-sm"
          placeholder={`http://localhost:3000/callback\nhttps://myapp.com/callback`}
          value={formData.redirect_uris}
          onChange={(event) =>
            setFormData((previous) => ({ ...previous, redirect_uris: event.target.value }))
          }
        />
      </AdminFormField>

      <AdminFieldGroup label="信任应用">
        <Checkbox
          variant="secondary"
          isSelected={formData.trusted}
          onChange={(isSelected) =>
            setFormData((previous) => ({ ...previous, trusted: isSelected }))
          }
        >
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Checkbox.Content>信任的应用将跳过授权确认</Checkbox.Content>
        </Checkbox>
      </AdminFieldGroup>

      <AdminFieldGroup
        label="默认访问"
        description="当未配置用户或用户组权限时，将采用这里的默认策略。"
      >
        <RadioGroup
          orientation="vertical"
          value={formData.default_access ? 'allow' : 'deny'}
          onChange={(value) =>
            setFormData((previous) => ({ ...previous, default_access: value === 'allow' }))
          }
          className="space-y-2"
        >
          <UIRadio value="allow">允许</UIRadio>
          <UIRadio value="deny">拒绝</UIRadio>
        </RadioGroup>
      </AdminFieldGroup>
    </>
  )

  const scopes = (
    <AdminFieldGroup
      label="权限范围"
      description={`已选择 ${formData.allowed_scopes.length} 项权限。`}
    >
      <Card>
        <Card.Content className="px-4 py-2">
          <CheckboxGroup
            aria-label="权限范围"
            value={formData.allowed_scopes}
            onChange={(value) =>
              setFormData((previous) => ({
                ...previous,
                allowed_scopes: Array.isArray(value) ? value.map(String) : [],
              }))
            }
          >
            {AVAILABLE_SCOPES.map((scope) => (
              <UICheckbox
                key={scope.value}
                value={scope.value}
                className="m-0 max-w-full border-b border-default-200/70 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{scope.label}</p>
                  <p className="text-xs text-default-500">{scope.description}</p>
                </div>
              </UICheckbox>
            ))}
          </CheckboxGroup>
        </Card.Content>
      </Card>
    </AdminFieldGroup>
  )

  return (
    <>
      {formError ? <AdminNotice tone="danger" description={formError} /> : null}

      {layout === 'two-column' ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">{basics}</div>
          <div className="space-y-6">{advanced}</div>
        </div>
      ) : (
        <div className="space-y-6">
          {basics}
          {advanced}
        </div>
      )}

      {scopes}
    </>
  )
}
