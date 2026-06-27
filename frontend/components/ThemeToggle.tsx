'use client'
import { useEffect, useState } from 'react'
import { Button } from '@heroui/react'
import { Sun, Moon } from 'lucide-react'

type Theme = 'light' | 'dark'

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  try {
    const stored = localStorage.getItem('theme')
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // localStorage 被禁用时忽略
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light')
  const [mounted, setMounted] = useState(false)

  // 挂载时同步真实主题（layout 的 inline script 已提前设置 data-theme，避免闪烁）
  useEffect(() => {
    setTheme(readInitialTheme())
    setMounted(true)
  }, [])

  // 跟随系统主题变化（仅当用户未显式选择时）
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e: MediaQueryListEvent) => {
      try {
        const stored = localStorage.getItem('theme')
        if (stored === 'light' || stored === 'dark') return
      } catch {
        // 忽略
      }
      const next: Theme = e.matches ? 'dark' : 'light'
      setTheme(next)
      document.documentElement.setAttribute('data-theme', next)
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem('theme', next)
    } catch {
      // 忽略 localStorage 写入失败
    }
    document.documentElement.setAttribute('data-theme', next)
  }

  return (
    <Button
      variant="tertiary"
      size="sm"
      onPress={toggle}
      aria-label="切换主题"
      aria-title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
    >
      {/* 挂载前用占位图标避免水合不一致；挂载后用真实主题 */}
      {mounted ? (theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />) : <Moon className="w-4 h-4" />}
    </Button>
  )
}
