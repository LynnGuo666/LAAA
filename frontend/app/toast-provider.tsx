'use client'

import { Toast } from '@heroui/react'
import type { ReactNode } from 'react'

type ToastProviderProps = {
  children: ReactNode
}

export default function ToastProvider({ children }: ToastProviderProps) {
  return <Toast.Provider>{children}</Toast.Provider>
}
