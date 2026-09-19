import { ChevronDown, Download, FolderOpen, Keyboard, Moon, Plus, Sun, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from './ui/menu';
type Props = { disabled: boolean; theme: string; onOpenChange: (open: boolean) => void; onOpen: () => void; onOpenProject: () => void; onSaveProject: () => void; onTheme: () => void; onHelp: () => void; onClear: () => void };
export default function ProjectMenu(p: Props) {
  return <Menu onOpenChange={p.onOpenChange}>
    <MenuTrigger render={<Button variant="outline" />} disabled={p.disabled} aria-label="Project menu"><FolderOpen /><span className="hidden sm:inline">Project</span><ChevronDown /></MenuTrigger>
    <MenuPopup align="end" className="min-w-64">
      <MenuGroup><MenuGroupLabel>Your project</MenuGroupLabel>
      <MenuItem onClick={p.onSaveProject}><Download />Save project<MenuShortcut aria-hidden="true">.snip</MenuShortcut></MenuItem>
      <MenuItem onClick={p.onOpenProject}><FolderOpen />Open project</MenuItem></MenuGroup>
      <MenuSeparator />
      <MenuItem onClick={p.onOpen}><Plus />New video</MenuItem>
      <MenuItem onClick={p.onTheme}>{p.theme === 'dark' ? <Sun /> : <Moon />}Switch to {p.theme === 'dark' ? 'light' : 'dark'} mode</MenuItem>
      <MenuItem onClick={p.onHelp}><Keyboard />Keyboard shortcuts<MenuShortcut aria-hidden="true">?</MenuShortcut></MenuItem>
      <MenuSeparator />
      <MenuItem variant="destructive" onClick={p.onClear}><Trash2 />Clear saved video</MenuItem>
    </MenuPopup>
  </Menu>;
}
