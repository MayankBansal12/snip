import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const groups = [
  { title: 'Playback', items: [
    ['Play / pause', 'Space', 'K'], ['Nudge 1/30 second', '← / →'], ['Move 1 second', 'Shift', '← / →'],
    ['Previous / next cut', '↑ / ↓'], ['Start / end', 'Home / End'], ['Mute / unmute', 'M'],
    ['Slower / faster', '[ / ]'], ['Expand preview', 'F'],
  ] },
  { title: 'Editing', items: [
    ['Split at playhead', 'S'], ['Trim clip start to playhead', 'I'], ['Trim clip end to playhead', 'O'],
    ['Delete selected clip or annotation', 'Delete'], ['Undo', mod, 'Z'], ['Redo', mod, 'Shift', 'Z'],
    ['Zoom timeline out / in', '− / +'],
  ] },
  { title: 'Workspace', items: [
    ['Frame · Crop · Filters · Annotate · Speed', '1–5'], ['Open a video', mod, 'O'], ['Export settings', mod, 'E'],
    ['Save project', mod, 'S'], ['Open project', mod, 'Shift', 'O'], ['Keyboard shortcuts', '?'], ['Close panel / deselect', 'Esc'],
  ] },
];
export default function ShortcutsDialog({open,onClose}:{open:boolean;onClose:()=>void}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) ref.current?.showModal(); else ref.current?.close(); }, [open]);
  return <dialog ref={ref} className="shortcuts-dialog" aria-labelledby="shortcuts-title" onCancel={onClose} onKeyDown={e=>{if(e.key==='Tab'){e.preventDefault();ref.current?.querySelector<HTMLButtonElement>('button')?.focus();}}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="dialog-heading"><h2 id="shortcuts-title">Keyboard shortcuts</h2><button className="icon-button" aria-label="Close keyboard shortcuts" onClick={onClose} autoFocus><X size={18}/></button></div>
    <p className="dialog-subtitle">A little less clicking.</p>
    <div className="shortcut-groups">{groups.map(group=><section key={group.title}><h3>{group.title}</h3><dl>{group.items.map(([label,...keys])=><div key={label}><dt>{label}</dt><dd>{keys.map(key=><kbd key={key}>{key}</kbd>)}</dd></div>)}</dl></section>)}</div>
    <p className="shortcut-note">Shortcuts pause while you type or open a dialog. Focus a clip edge and use ← / → to trim by 0.1 seconds; hold Shift for 1 second. Ctrl Y also redoes.</p>
  </dialog>;
}
