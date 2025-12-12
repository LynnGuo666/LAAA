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
      <div className="bg-white rounded-lg shadow-md border border-gray-100 h-full flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-900 text-sm"
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

