import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverDescription, PopoverPopup, PopoverTitle, PopoverTrigger } from './ui/popover';

const repository = 'https://github.com/MayankBansal12/snip/tree/feat/deterministic-editing-engine';
const introduction = 'Hey, help me edit a video with Snip. Connect its local MCP server, ask what edits I want, and let me preview before exporting.';
const prompt = `${introduction} Set up Snip from ${repository} using docs/editing-engine.md, then give me the pairing link to open my video locally.`;
const config = JSON.stringify({ mcpServers: { snip: { command: 'node', args: ['/absolute/path/to/snip/scripts/mcp-server.mjs'], env: { SNIP_PORT: '5188' } } } }, null, 2);

export default function AgentOnboarding() {
  const [copied, setCopied] = useState<'prompt' | 'server' | null>(null);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy(kind: 'prompt' | 'server') {
    try {
      await navigator.clipboard.writeText(kind === 'prompt' ? prompt : config);
      setError(''); setCopied(kind); clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(null), 2000);
    } catch { setError('Clipboard access is unavailable. Select and copy the prompt below.'); }
  }
  return <Popover>
    <PopoverTrigger openOnHover delay={150} closeDelay={250} render={<Button variant="ghost" size="sm" className="group text-sm font-normal text-muted-foreground" />}>
      edit with your agent<ChevronDown className="size-3.5 group-data-popup-open:rotate-180" />
    </PopoverTrigger>
    <PopoverPopup align="end" sideOffset={12} className="w-[min(32rem,calc(100vw-2rem))] rounded-2xl shadow-xl/5">
      <PopoverTitle className="sr-only">edit with your agent</PopoverTitle>
      <PopoverDescription>Give your agent this prompt to get started.</PopoverDescription>
      <div className="mt-4 rounded-xl bg-muted/60 p-4 sm:p-5">
        <p className="select-text break-words text-sm leading-relaxed">{introduction}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => void copy('server')}>{copied === 'server' ? <Check /> : <Copy />}{copied === 'server' ? 'copied' : 'copy MCP server'}</Button>
          <Button size="sm" onClick={() => void copy('prompt')}>{copied === 'prompt' ? <Check /> : <Copy />}{copied === 'prompt' ? 'copied' : 'copy prompt'}</Button>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Your video stays on your computer. The copied prompt includes the <a className="underline underline-offset-2" href={`${repository.replace('/tree/', '/blob/')}/docs/editing-engine.md`} target="_blank" rel="noreferrer">MCP setup instructions</a>.</p>
      {copied === 'server' && <p className="mt-2 text-xs text-muted-foreground">Replace the path in the config with your local Snip folder.</p>}
      <span className="sr-only" role="status">{copied ? `${copied === 'prompt' ? 'Prompt' : 'MCP server configuration'} copied` : ''}</span>
      {error && <p role="alert" className="mt-2 text-sm text-destructive-foreground">{error}</p>}
    </PopoverPopup>
  </Popover>;
}
