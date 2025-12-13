'use client';

import React from 'react';

interface SidePanelProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function SidePanel({ title, open, onClose, children }: SidePanelProps) {
  if (!open) return null;

  return (
    <aside className="w-full lg:w-[420px] lg:shrink-0">
      <div className="surface h-full flex flex-col animate-slide-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white text-sm"
            aria-label="关闭面板"
          >
            关闭
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </aside>
  );
}
