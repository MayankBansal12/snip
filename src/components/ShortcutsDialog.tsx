import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription, DialogPanel } from './ui/dialog';
import { Kbd } from './ui/kbd';
const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
const groups = [
  { title: 'playback', items: [
    ['play / pause', 'space'], ['nudge 1/30 second', '← / →'], ['move 1 second', 'Shift', '← / →'],
    ['focus previous / next clip', '↑ / ↓'], ['previous / next cut', 'shift', '↑ / ↓'], ['start / end', 'home / end'], ['mute / unmute', 'k'],
    ['speed presets / reverse', 'x / shift x'], ['expand preview', 'F'],
  ] },
  { title: 'editing', items: [
    ['open focused clip adjustments', 'enter'], ['merge neighboring clip', 'm'], ['zoom presets / reverse', 'z / shift z'], ['move clip earlier / later', 'alt', '↑ / ↓'], ['trim start by 0.1s', 'alt', '← / →'], ['trim end by 0.1s', 'alt', 'shift', '← / →'], ['split at playhead', 'S'], ['trim clip start to playhead', 'I'], ['trim clip end to playhead', 'O'],
    ['delete selected clip', 'Delete'], ['Undo', mod, 'Z'], ['Redo', mod, 'Shift', 'Z'],
    ['zoom timeline out / in', '− / +'],
  ] },
  { title: 'workspace', items: [
    ['open a video', mod, 'O'], ['export settings', mod, 'e'], ['export with default settings', mod, 'shift', 'e'],
    ['save project', mod, 'S'], ['open project', mod, 'Shift', 'O'], ['keyboard shortcuts', '?'], ['close clip actions', 'Esc'],
  ] },
];
export default function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Dialog open={open} onOpenChange={open => { if (!open) onClose(); }}><DialogPopup className="shortcuts-dialog max-w-2xl" closeProps={{ 'aria-label': 'close keyboard shortcuts' }}><DialogHeader><DialogTitle>keyboard shortcuts</DialogTitle><DialogDescription>a little less clicking. a little more flow.</DialogDescription></DialogHeader><DialogPanel><div className="grid gap-6 sm:grid-cols-2">{groups.map(group => <section key={group.title} className={group.title === 'workspace' ? 'sm:col-span-2' : ''}><h3 className="mb-2 text-xs font-medium text-muted-foreground">{group.title}</h3><dl>{group.items.map(([label,...keys]) => <div key={label} className="flex items-center justify-between gap-4 border-b py-2.5"><dt className="text-xs">{label}</dt><dd className="flex shrink-0 gap-1">{keys.map(key => <Kbd key={key}>{key}</Kbd>)}</dd></div>)}</dl></section>)}</div><p className="mt-6 text-xs leading-relaxed text-muted-foreground">shortcuts pause while you type or open a dialog. focus a clip edge and use ← / → to trim by 0.1 seconds; hold shift for 1 second. ctrl y also redoes.</p></DialogPanel></DialogPopup></Dialog>;
}
