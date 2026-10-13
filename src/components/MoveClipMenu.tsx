import { ArrowLeft, ArrowRight, ArrowLeftToLine, ArrowRightToLine, ArrowLeftRight } from 'lucide-react';
import { Button } from './ui/button';
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from './ui/menu';

export default function MoveClipMenu({ index, count, onOpen, onMove }: { index: number; count: number; onOpen: () => void; onMove: (index: number) => void }) {
  return <Menu onOpenChange={open => { if (open) onOpen(); }}>
    <MenuTrigger render={<Button size="xs" variant="ghost" />} aria-label="move clip" disabled={count < 2 || index < 0}>
      <ArrowLeftRight /><span className="hidden sm:inline">move</span>
    </MenuTrigger>
    <MenuPopup side="top" align="start" sideOffset={12}>
      <MenuItem disabled={index <= 0} onClick={() => onMove(index - 1)}><ArrowLeft />move earlier<MenuShortcut aria-hidden="true">alt ↑</MenuShortcut></MenuItem>
      <MenuItem disabled={index >= count - 1} onClick={() => onMove(index + 1)}><ArrowRight />move later<MenuShortcut aria-hidden="true">alt ↓</MenuShortcut></MenuItem>
      <MenuItem disabled={index <= 0} onClick={() => onMove(0)}><ArrowLeftToLine />move to first</MenuItem>
      <MenuItem disabled={index >= count - 1} onClick={() => onMove(count - 1)}><ArrowRightToLine />move to last</MenuItem>
    </MenuPopup>
  </Menu>;
}
