import { MoreHorizontal, Download, FolderOpen, Keyboard, Moon, Plus, Sun, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from './ui/menu';
type Props = { filename: string; disabled: boolean; theme: string; onOpenChange: (open: boolean) => void; onOpen: () => void; onOpenProject: () => void; onSaveProject: () => void; onTheme: () => void; onHelp: () => void; onClear: () => void };
export default function ProjectMenu(p: Props) {
  return <Menu onOpenChange={p.onOpenChange}>
    <MenuTrigger render={<Button variant="ghost" size="icon" />} disabled={p.disabled} aria-label="project menu"><MoreHorizontal /></MenuTrigger>
    <MenuPopup align="end" className="min-w-64">
      <MenuGroup><MenuGroupLabel className="max-w-64 truncate" title={p.filename}>{p.filename}</MenuGroupLabel>
      <MenuItem onClick={p.onSaveProject}><Download />save project<MenuShortcut aria-hidden="true">.snip</MenuShortcut></MenuItem>
      <MenuItem onClick={p.onOpenProject}><FolderOpen />open project</MenuItem></MenuGroup>
      <MenuSeparator />
      <MenuItem onClick={p.onOpen}><Plus />new video</MenuItem>
      <MenuItem className="sm:hidden" onClick={p.onTheme}>{p.theme === 'dark' ? <Sun /> : <Moon />}switch to {p.theme === 'dark' ? 'light' : 'dark'} mode</MenuItem>
      <MenuItem onClick={p.onHelp}><Keyboard />keyboard shortcuts<MenuShortcut aria-hidden="true">?</MenuShortcut></MenuItem>
      <MenuSeparator />
      <MenuItem variant="destructive" onClick={p.onClear}><Trash2 />clear saved video</MenuItem>
    </MenuPopup>
  </Menu>;
}
