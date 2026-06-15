'use client'

import { AlertDialog, Button } from '@heroui/react'
import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useRef, useState } from 'react'

type ConfirmOptions = {
  title?: string
  description: string
  confirmText?: string
  cancelText?: string
  status?: 'default' | 'accent' | 'success' | 'warning' | 'danger'
  confirmVariant?: React.ComponentProps<typeof Button>['variant']
}

type ConfirmDialog = (options: ConfirmOptions) => Promise<boolean>

const ConfirmDialogContext = createContext<ConfirmDialog | null>(null)

const defaultOptions: Required<Omit<ConfirmOptions, 'description'>> = {
  title: '请确认操作',
  confirmText: '确认',
  cancelText: '取消',
  status: 'warning',
  confirmVariant: 'primary',
}

type ConfirmDialogProviderProps = {
  children: ReactNode
}

export function ConfirmDialogProvider({ children }: ConfirmDialogProviderProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [options, setOptions] = useState<Required<ConfirmOptions>>({
    ...defaultOptions,
    description: '',
  })
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const resolveAndClose = useCallback((value: boolean) => {
    setIsOpen(false)
    if (resolverRef.current) {
      resolverRef.current(value)
      resolverRef.current = null
    }
  }, [])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setIsOpen(nextOpen)
    if (!nextOpen && resolverRef.current) {
      resolverRef.current(false)
      resolverRef.current = null
    }
  }, [])

  const confirm = useCallback<ConfirmDialog>(async (nextOptions) => {
    setOptions({
      title: nextOptions.title ?? defaultOptions.title,
      description: nextOptions.description,
      confirmText: nextOptions.confirmText ?? defaultOptions.confirmText,
      cancelText: nextOptions.cancelText ?? defaultOptions.cancelText,
      status: nextOptions.status ?? defaultOptions.status,
      confirmVariant: nextOptions.confirmVariant ?? defaultOptions.confirmVariant,
    })
    setIsOpen(true)

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  return (
    <ConfirmDialogContext.Provider value={confirm}>
      {children}
      <AlertDialog>
        <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={handleOpenChange}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Icon status={options.status} />
                <AlertDialog.Heading>{options.title}</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>{options.description}</AlertDialog.Body>
              <AlertDialog.Footer>
                <Button variant="secondary" onPress={() => resolveAndClose(false)}>
                  {options.cancelText}
                </Button>
                <Button variant={options.confirmVariant} onPress={() => resolveAndClose(true)}>
                  {options.confirmText}
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </ConfirmDialogContext.Provider>
  )
}

export function useConfirmDialog() {
  const context = useContext(ConfirmDialogContext)
  if (!context) {
    throw new Error('useConfirmDialog must be used within ConfirmDialogProvider')
  }
  return context
}
