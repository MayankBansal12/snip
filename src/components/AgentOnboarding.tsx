import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverDescription, PopoverPopup, PopoverTitle, PopoverTrigger } from './ui/popover';

const repository = 'https://github.com/MayankBansal12/snip/tree/feat/deterministic-editing-engine';
const introduction = 'Hey, help me edit a video with Snip. Connect its local MCP server, ask what edits I want, and let me preview before exporting.';
const config = JSON.stringify({ mcpServers: { snip: { command: 'node', args: ['/absolute/path/to/snip/scripts/mcp-server.mjs'], env: { SNIP_PORT: '5188' } } } }, null, 2);
const prompt = `${introduction}

Set up Snip from ${repository} using docs/editing-engine.md. Build it locally with Node.js 22+, npm ci, and npm run build. Replace the placeholder path below with the absolute path to the local checkout and configure this stdio MCP server:

${config}

Run the MCP server on the same computer as my browser. Call get_connection and give me the pairing link so I can connect and choose my video locally. Read get_project before editing, use the returned session and revision, and ask what changes I want. Let me preview the edits before starting an export. Keep the video in my browser.`;

export default function AgentOnboarding() {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const contentId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setError(''); setCopied(true); clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setExpanded(true);
      setError('Clipboard access is unavailable. Select and copy the full prompt above.');
    }
  }
  return <Popover>
    <PopoverTrigger openOnHover delay={150} closeDelay={250} render={<Button variant="ghost" size="sm" className="group text-sm font-normal text-muted-foreground" />}>
      edit with your agent<ChevronDown className="size-3.5 group-data-popup-open:rotate-180" />
    </PopoverTrigger>
    <PopoverPopup align="end" sideOffset={12} className="w-[min(32rem,calc(100vw-2rem))] rounded-2xl shadow-xl/5 motion-reduce:transition-none">
      <PopoverTitle className="sr-only">edit with your agent</PopoverTitle>
      <PopoverDescription>Give your agent this prompt to get started.</PopoverDescription>
      <div className="mt-4 rounded-xl bg-muted/60 p-4 sm:p-5">
        <div id={contentId}>
          {expanded ? <textarea aria-label="full agent prompt" readOnly value={prompt} spellCheck={false} className="block h-[min(22rem,40svh)] w-full resize-none rounded-md border-0 bg-transparent p-0 text-sm leading-relaxed text-foreground outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring" />
            : <p className="select-text break-words text-sm leading-relaxed">{introduction}</p>}
        </div>
        <div className="mt-5 flex items-center justify-between gap-3">
          <Button size="sm" variant="ghost" className="-ml-2 text-xs font-normal text-muted-foreground" aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}>
            {expanded ? 'view less' : 'view more'}<ChevronDown className={`size-3.5 ${expanded ? 'rotate-180' : ''}`} />
          </Button>
          <Button size="sm" onClick={() => void copy()}>{copied ? <Check /> : <Copy />}{copied ? 'copied' : 'copy prompt'}</Button>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">MCP setup is included when you copy. Your video stays on your computer.</p>
      <span className="sr-only" role="status">{copied ? 'Full prompt and MCP configuration copied' : ''}</span>
      {error && <p role="alert" className="mt-2 text-sm text-destructive-foreground">{error}</p>}
    </PopoverPopup>
  </Popover>;
}
