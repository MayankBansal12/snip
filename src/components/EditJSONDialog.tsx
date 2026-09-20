import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Alert, AlertDescription } from './ui/alert';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription, DialogPanel, DialogFooter } from './ui/dialog';
import { MAX_JSON_BYTES } from '../engine';

type Props = { open: boolean; onClose: () => void; onRead: () => Promise<string>; onApply: (json: string) => Promise<void> };
export default function EditJSONDialog(p: Props) {
  const [text, setText] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!p.open) return;
    let active = true; setBusy(true); setError(''); setText('');
    p.onRead().then(value => { if (active) setText(value); }).catch(e => { if (active) setError(String(e.message)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [p.open]);
  const save = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'edits.snip.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <Dialog open={p.open} onOpenChange={open => { if (!open && !busy) p.onClose(); }}>
    <DialogPopup className="max-w-3xl" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>edit JSON</DialogTitle><DialogDescription>Save or apply edits for this source video. Applying replaces the edits in one undo step. Export renders locally in this browser.</DialogDescription></DialogHeader>
      <DialogPanel className="space-y-4">
        <label className="block text-sm">open JSON file<input aria-label="open edit JSON" type="file" accept=".json,application/json" disabled={busy} className="mt-2 block w-full text-sm" onChange={async e => {
          const file = e.target.files?.[0]; if (!file) return;
          if (file.size > MAX_JSON_BYTES) { setError('Edit JSON exceeds 8 MiB.'); return; }
          setText(await file.text()); setError('');
        }} /></label>
        <Textarea aria-label="edit specification" className="min-h-80 font-mono text-xs" value={text} disabled={busy} onChange={e => setText(e.target.value)} spellCheck={false} />
        {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription></Alert>}
      </DialogPanel>
      <DialogFooter><Button variant="outline" disabled={busy || !text} onClick={save}>download JSON</Button><Button disabled={busy || !text} onClick={async () => {
        setBusy(true); setError(''); try { await p.onApply(text); p.onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not apply JSON.'); } finally { setBusy(false); }
      }}>{busy ? 'preparing…' : 'apply edits'}</Button></DialogFooter>
    </DialogPopup>
  </Dialog>;
}
