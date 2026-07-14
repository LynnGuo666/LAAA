// ESLint flat config — Next 15 + React 19 + Tailwind v4。
// `next lint` 已废弃且与 ESLint 9 有兼容问题,改用直接组合 flat config。
// 我们不直接 import 'eslint-config-next'(它内部触发 @rushstack/eslint-patch,
// 与 ESLint 9 不兼容),而是用 @next/eslint-plugin-next 的 flatConfig + 手动挂
// react / react-hooks 插件。
import nextPlugin from '@next/eslint-plugin-next'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

const nextFlat = nextPlugin.flatConfig

/** @type {import('eslint').LabeledConfig[]} */
export default [
  {
    ignores: ['out/**', 'node_modules/**', '.next/**', 'next-env.d.ts'],
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      '@next/next': nextPlugin,
      '@typescript-eslint': tsPlugin,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...nextFlat.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      // 既有代码风格宽松,先开警告级而非 error,避免 CI 一开就全红
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react/no-unescaped-entities': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
]

