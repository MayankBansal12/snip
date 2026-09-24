import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Redo2, Square, Undo2 } from 'lucide-react';
import { Button } from './ui/button';
import IconButton from './IconButton';

type Props = {
  onSubmit: (text: string, signal: AbortSignal) => Promise<string>;
  onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean;
  active: boolean; revision: number;
};

export default function ChatEditor({ onSubmit, onUndo, onRedo, canUndo, canRedo, active, revision }: Props) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ message: string; error?: boolean; revision?: number } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null), controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (active && matchMedia('(pointer: fine)').matches) input.current?.focus({ preventScroll: true }); }, [active]);
  useEffect(() => {
    if (!result || result.error) return;
    const timer = setTimeout(() => setResult(current => current === result ? null : current), 3000);
    return () => clearTimeout(timer);
  }, [result]);
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
  return <section className="chat-editor" aria-label="edit with chat">
    <form className={`flex min-w-0 items-center gap-x-2 gap-y-2 ${visibleResult?.error ? 'flex-wrap' : ''}`} aria-busy={pending} onSubmit={e => { e.preventDefault(); void submit(); }}>
      <textarea id="edit-prompt" ref={input} value={text} maxLength={1200} readOnly={pending} rows={1}
        className="chat-prompt block min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-base leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/55"
        placeholder={visibleResult && !visibleResult.error ? '' : 'describe your edit…'} aria-label="what would you like to change?"
        aria-describedby={visibleResult ? 'chat-status' : undefined}
        onChange={e => { setText(e.target.value); setResult(null); }}
        onKeyDown={e => {
          if (e.key === 'Escape' && pending) { e.preventDefault(); cancel(); }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
        }} />
      <div id="chat-status" role="status" aria-live="polite" aria-atomic="true"
        className={visibleResult ? visibleResult.error ? 'order-last w-full px-1 text-xs leading-relaxed text-destructive-foreground' : 'chat-feedback min-w-0 self-center text-xs text-muted-foreground' : 'sr-only'}>
        {visibleResult && <span className="flex min-w-0 items-center justify-end gap-1.5" title={visibleResult.message}>
          {visibleResult.revision !== undefined && <Check aria-hidden="true" className="size-3.5 shrink-0 text-primary" />}
          <span className={visibleResult.error ? 'w-full' : 'truncate'}>{visibleResult.message}</span>
        </span>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label="undo" size="icon-xs" disabled={!canUndo || pending} onClick={() => { onUndo(); setResult({ message: 'edit undone' }); }}><Undo2 /></IconButton>
        <IconButton label="redo" size="icon-xs" disabled={!canRedo || pending} onClick={() => { onRedo(); setResult({ message: 'edit restored' }); }}><Redo2 /></IconButton>
        {pending ? <Button key="cancel" type="button" size="icon-xs" variant="outline" aria-label="cancel edit" onClick={e => { e.preventDefault(); cancel(); }}><Square className="size-3" fill="currentColor" /></Button>
          : <Button key="submit" type="submit" size="icon-xs" aria-label="apply edit" disabled={!text.trim()}><ArrowUp /></Button>}
      </div>
    </form>
  </section>;
}
