import { useRef, useState } from 'react';
import { MoreHorizontal, Download, FolderOpen, Keyboard, Moon, Plus, Sun, Trash2 } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Menu, MenuGroup, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from './ui/menu';
type Props = { filename: string; onRename: (name: string) => void; disabled: boolean; theme: string; onOpenChange: (open: boolean) => void; onOpen: () => void; onOpenProject: () => void; onSaveProject: () => void; onEditJSON: () => void; onTheme: () => void; onHelp: () => void; onClear: () => void };
export default function ProjectMenu(p: Props) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const extension = p.filename.match(/\.[^.]+$/)?.[0] ?? '';
  const stem = extension ? p.filename.slice(0, -extension.length) : p.filename;
  const finish = (save: boolean) => {
    const name = input.current?.value.trim();
    setEditing(false);
    if (save && name) p.onRename(name + extension);
  };
  return <Menu onOpenChange={open => { if (!open) finish(true); p.onOpenChange(open); }}>
    <MenuTrigger render={<Button variant="ghost" size="icon" />} disabled={p.disabled} aria-label="project menu"><MoreHorizontal /></MenuTrigger>
    <MenuPopup align="end" className="min-w-64">
      <MenuGroup aria-label={p.filename}><div className="max-w-64 px-2 py-1.5 text-xs font-medium text-muted-foreground">
        {editing ? <div className="flex items-center gap-1">
          <Input ref={input} size="sm" aria-label="project name" defaultValue={stem} maxLength={1024 - extension.length} autoFocus onFocus={e => e.currentTarget.select()} onBlur={() => finish(true)} onKeyDown={e => {
            e.stopPropagation();
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); finish(e.key === 'Enter'); }
          }} />
          <span className="shrink-0">{extension}</span>
        </div> : <button type="button" className="block w-full cursor-text truncate rounded text-left outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring" aria-label="rename project" title={`${p.filename} — double-click to rename`} onDoubleClick={() => setEditing(true)} onKeyDown={e => {
          if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); e.stopPropagation(); setEditing(true); }
        }}>{p.filename}</button>}
      </div>
      <MenuItem onClick={p.onSaveProject}><Download />save project<MenuShortcut aria-hidden="true">.snip</MenuShortcut></MenuItem>
      <MenuItem onClick={p.onEditJSON}>edit JSON</MenuItem>
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
