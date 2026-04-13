'use client';

import React from 'react';
import { Drawer } from '@heroui/react';

interface SidePanelProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function SidePanel({ title, open, onClose, children }: SidePanelProps) {
  return (
    <Drawer>
      <Drawer.Backdrop
        isOpen={open}
        onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}
        variant="transparent"
      >
        <Drawer.Content placement="right">
          <Drawer.Dialog aria-label={title}>
            <Drawer.Header>
              <Drawer.Heading>{title}</Drawer.Heading>
              <Drawer.CloseTrigger />
            </Drawer.Header>
            <Drawer.Body>{children}</Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
