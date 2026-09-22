import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Redo2, Square, Undo2 } from 'lucide-react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Spinner } from './ui/spinner';
import IconButton from './IconButton';

type Props = {
  onSubmit: (text: string, signal: AbortSignal) => Promise<string>;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
  active: boolean; revision: number; controls: ReactNode;
};
const examples = ['split in half', 'zoom 2× to the top left', 'mute the audio'];

export default function ChatEditor({ onSubmit, onUndo, onRedo, canUndo, canRedo, active, revision, controls }: Props) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ message: string; error?: boolean; revision?: number } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null), controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (active && matchMedia('(pointer: fine)').matches) input.current?.focus({ preventScroll: true }); }, [active]);
  async function submit() {
    const prompt = text.trim();
    if (!prompt || controller.current) return;
    const request = new AbortController(); controller.current = request;
    setPending(true); setResult(null);
    const timeout = setTimeout(() => request.abort('timeout'), 30000);
    try {
      const message = await onSubmit(prompt, request.signal);
      if (!request.signal.aborted) { setResult({ message, revision: revision + 1 }); setText(''); }
    } catch (error) {
      if (request.signal.reason === 'timeout') setResult({ message: 'That took too long. Your video hasn’t changed. Try again.', error: true });
      else if (!request.signal.aborted) setResult({ message: error instanceof Error ? error.message : 'Couldn’t apply that edit. Try again.', error: true });
    } finally {
      clearTimeout(timeout);
      if (controller.current === request) { controller.current = null; setPending(false); }
    }
  }
  function cancel() { controller.current?.abort(); controller.current = null; setPending(false); setResult({ message: 'Edit cancelled. Your video hasn’t changed.' }); }
  const visibleResult = result && (result.revision === undefined || result.revision === revision) ? result : null;
  return <Card className="chat-editor gap-0 p-3 sm:p-4" render={<section aria-label="edit with chat" />}>
    <form onSubmit={e => { e.preventDefault(); void submit(); }}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <label htmlFor="edit-prompt" className="text-xs font-medium text-muted-foreground">what would you like to change?</label>
        <div inert={pending} role="group" aria-label="chat clip controls" className="flex items-center gap-1">{controls}</div>
      </div>
      <textarea id="edit-prompt" ref={input} value={text} maxLength={1200} readOnly={pending} rows={2}
        className="chat-prompt mt-2 block w-full resize-none border-0 bg-transparent px-0 py-1 text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/55"
        placeholder="trim the first 2 seconds, then make it faster…"
        aria-describedby="chat-note" onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape' && pending) { e.preventDefault(); cancel(); }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
        }} />
      <div className="mt-2 flex min-h-12 items-center justify-between sm:min-h-8 gap-3">
        <div role="status" aria-live="polite" className={`min-w-0 text-xs leading-relaxed ${visibleResult?.error ? 'text-destructive-foreground' : 'text-muted-foreground'}`}>
          {pending ? <span className="inline-flex items-center gap-2"><Spinner aria-hidden="true" className="size-3.5" />making your edit…</span>
            : visibleResult ? <span className="inline-flex items-start gap-1.5">{visibleResult.revision !== undefined && <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />}{visibleResult.message}</span>
              : <div className="flex flex-wrap gap-1.5">{examples.map((example,index) => <Button key={example} type="button" variant="outline" size="xs" className={`rounded-full font-normal text-muted-foreground ${index===2?'hidden sm:inline-flex':''}`} onClick={() => { setText(example); input.current?.focus(); }}>{example}</Button>)}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="undo" size="icon-sm" disabled={!canUndo || pending} onClick={() => { onUndo(); setResult({ message: 'edit undone' }); }}><Undo2 /></IconButton>
          <IconButton label="redo" size="icon-sm" disabled={!canRedo || pending} onClick={() => { onRedo(); setResult({ message: 'edit restored' }); }}><Redo2 /></IconButton>
          {pending ? <Button key="cancel" type="button" size="icon-sm" variant="outline" aria-label="cancel edit" onClick={e => { e.preventDefault(); cancel(); }}><Square className="size-3" fill="currentColor" /></Button>
            : <Button key="submit" type="submit" size="icon-sm" aria-label="apply edit" disabled={!text.trim()}><ArrowUp /></Button>}
        </div>
      </div>
    </form>
    <div id="chat-note" className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground/75">
      <span>your prompt and edit settings go to Jev. your video stays here.</span>
      <span className="hidden shrink-0 sm:inline">powered by Jev</span>
    </div>
  </Card>;
}
