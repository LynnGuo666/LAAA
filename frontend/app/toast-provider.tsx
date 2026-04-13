'use client'

import { Toast } from '@heroui/react'

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toast.Provider />
    </>
  )
}
