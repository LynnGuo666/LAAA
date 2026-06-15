'use client'

import {
  Alert,
  Button,
  Card,
  Description,
  FieldError,
  Label,
  Modal,
  Separator,
  Spinner,
  TextField,
  cn,
} from '@heroui/react'
import type { ComponentProps, ReactNode } from 'react'

type NoticeTone = 'danger' | 'success' | 'warning' | 'accent' | 'default'

type AdminPageHeaderProps = {
  title: string
  description?: string
  actions?: ReactNode
}

type AdminSectionProps = {
  children: ReactNode
  className?: string
  variant?: 'default' | 'transparent'
}

type AdminNoticeProps = {
  tone: NoticeTone
  title?: string
  description: ReactNode
  className?: string
}

type AdminLoadingStateProps = {
  label?: string
  className?: string
}

type AdminEmptyStateProps = {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

type AdminFormFieldProps = Omit<ComponentProps<typeof TextField>, 'children'> & {
  label: string
  description?: string
  errorMessage?: string
  children: ReactNode
}

type AdminFieldGroupProps = {
  label: string
  description?: string
  errorMessage?: string
  children: ReactNode
  className?: string
}

type AdminModalFormProps = {
  title: string
  description?: string
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  children: ReactNode
  primaryActionLabel: string
  secondaryActionLabel?: string
  primaryVariant?: ComponentProps<typeof Button>['variant']
  isPending?: boolean
  isDisabled?: boolean
  size?: ComponentProps<typeof Modal.Container>['size']
  scroll?: ComponentProps<typeof Modal.Container>['scroll']
}

type EntityAvatarProps = {
  src?: string | null
  name: string
  size?: 'sm' | 'md' | 'lg'
  rounded?: 'full' | 'lg'
}

const avatarSizeClasses = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-16 w-16 text-2xl',
}

const avatarRoundedClasses = {
  full: 'rounded-full',
  lg: 'rounded-xl',
}

export function AdminPageHeader({ title, description, actions }: AdminPageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-2 text-sm leading-6 text-default-600">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function AdminSection({ children, className, variant = 'default' }: AdminSectionProps) {
  if (variant === 'transparent') {
    return <div className={cn('space-y-4', className)}>{children}</div>
  }

  return (
    <Card className={className}>
      {children}
    </Card>
  )
}

export function AdminNotice({ tone, title, description, className }: AdminNoticeProps) {
  return (
    <Alert status={tone} className={className}>
      <Alert.Indicator />
      <Alert.Content>
        {title ? <Alert.Title>{title}</Alert.Title> : null}
        <Alert.Description>{description}</Alert.Description>
      </Alert.Content>
    </Alert>
  )
}

export function AdminLoadingState({
  label = '加载中...',
  className,
}: AdminLoadingStateProps) {
  return (
    <AdminSection className={cn('p-10', className)}>
      <div className="flex flex-col items-center justify-center gap-3 text-center">
        <Spinner size="lg" />
        <p className="text-sm text-default-500">{label}</p>
      </div>
    </AdminSection>
  )
}

export function AdminEmptyState({
  title,
  description,
  action,
  className,
}: AdminEmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 p-10 text-center', className)}>
      <div className="space-y-1">
        <p className="text-base font-medium text-foreground">{title}</p>
        {description ? <p className="text-sm text-default-500">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

export function AdminSeparator({ className }: { className?: string }) {
  return <Separator className={className} />
}

export function AdminFormField({
  label,
  description,
  errorMessage,
  children,
  ...textFieldProps
}: AdminFormFieldProps) {
  return (
    <TextField {...textFieldProps} isInvalid={Boolean(errorMessage) || textFieldProps.isInvalid}>
      <Label>{label}</Label>
      {children}
      {description ? <Description>{description}</Description> : null}
      {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
    </TextField>
  )
}

export function AdminFieldGroup({
  label,
  description,
  errorMessage,
  children,
  className,
}: AdminFieldGroupProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label>{label}</Label>
      {children}
      {description ? <Description>{description}</Description> : null}
      {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
    </div>
  )
}

export function AdminModalForm({
  title,
  description,
  isOpen,
  onOpenChange,
  onSubmit,
  children,
  primaryActionLabel,
  secondaryActionLabel = '取消',
  primaryVariant = 'primary',
  isPending = false,
  isDisabled = false,
  size = 'lg',
  scroll = 'inside',
}: AdminModalFormProps) {
  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        isDismissable={!isPending}
      >
        <Modal.Container placement="center" scroll={scroll} size={size}>
          <Modal.Dialog aria-label={title}>
            <form onSubmit={onSubmit}>
              <Modal.CloseTrigger />
              <Modal.Header>
                <div className="space-y-1">
                  <Modal.Heading>{title}</Modal.Heading>
                  {description ? (
                    <Description className="text-sm text-default-500">
                      {description}
                    </Description>
                  ) : null}
                </div>
              </Modal.Header>
              <Modal.Body className="space-y-4">{children}</Modal.Body>
              <Modal.Footer>
                <Button
                  type="button"
                  variant="secondary"
                  onPress={() => onOpenChange(false)}
                  isDisabled={isPending || isDisabled}
                >
                  {secondaryActionLabel}
                </Button>
                <Button
                  type="submit"
                  variant={primaryVariant}
                  isDisabled={isDisabled}
                  isPending={isPending}
                >
                  {primaryActionLabel}
                </Button>
              </Modal.Footer>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

export function EntityAvatar({
  src,
  name,
  size = 'md',
  rounded = 'lg',
}: EntityAvatarProps) {
  const baseClassName = cn(
    'shrink-0 overflow-hidden border border-default-200 bg-default-100 text-default-600 dark:border-default-100/10',
    avatarSizeClasses[size],
    avatarRoundedClasses[rounded],
  )

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className={cn(baseClassName, 'object-cover')}
      />
    )
  }

  return (
    <div className={cn(baseClassName, 'flex items-center justify-center font-semibold')}>
      {name.charAt(0).toUpperCase()}
    </div>
  )
}