import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription, DialogPanel } from './ui/dialog';
import { Kbd } from './ui/kbd';
const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const groups = [
  { title: 'Playback', items: [
    ['Play / pause', 'Space', 'K'], ['Nudge 1/30 second', '← / →'], ['Move 1 second', 'Shift', '← / →'],
    ['Previous / next cut', '↑ / ↓'], ['Start / end', 'Home / End'], ['Mute / unmute', 'M'],
    ['Selected clip slower / faster', '[ / ]'], ['Expand preview', 'F'],
  ] },
  { title: 'Editing', items: [
    ['Open focused clip actions', 'Enter'], ['Split at playhead', 'S'], ['Trim clip start to playhead', 'I'], ['Trim clip end to playhead', 'O'],
    ['Delete selected clip', 'Delete'], ['Undo', mod, 'Z'], ['Redo', mod, 'Shift', 'Z'],
    ['Zoom timeline out / in', '− / +'],
  ] },
  { title: 'Workspace', items: [
    ['Open a video', mod, 'O'], ['Export settings', mod, 'E'],
    ['Save project', mod, 'S'], ['Open project', mod, 'Shift', 'O'], ['Keyboard shortcuts', '?'], ['Close clip actions', 'Esc'],
  ] },
];
export default function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Dialog open={open} onOpenChange={open => { if (!open) onClose(); }}><DialogPopup className="shortcuts-dialog max-w-2xl" closeProps={{ 'aria-label': 'Close keyboard shortcuts' }}><DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>A little less clicking. A little more flow.</DialogDescription></DialogHeader><DialogPanel><div className="grid gap-6 sm:grid-cols-2">{groups.map(group => <section key={group.title} className={group.title === 'Workspace' ? 'sm:col-span-2' : ''}><h3 className="mb-2 text-xs font-medium text-muted-foreground">{group.title}</h3><dl>{group.items.map(([label,...keys]) => <div key={label} className="flex items-center justify-between gap-4 border-b py-2.5"><dt className="text-xs">{label}</dt><dd className="flex shrink-0 gap-1">{keys.map(key => <Kbd key={key}>{key}</Kbd>)}</dd></div>)}</dl></section>)}</div><p className="mt-6 text-xs leading-relaxed text-muted-foreground">Shortcuts pause while you type or open a dialog. Focus a clip edge and use ← / → to trim by 0.1 seconds; hold Shift for 1 second. Ctrl Y also redoes.</p></DialogPanel></DialogPopup></Dialog>;
}
