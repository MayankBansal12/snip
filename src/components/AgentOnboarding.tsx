import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverDescription, PopoverPopup, PopoverTitle, PopoverTrigger } from './ui/popover';

const repository = 'https://github.com/MayankBansal12/snip/tree/feat/deterministic-editing-engine';
const introduction = 'Hey, help me edit a video with Snip. Connect its local MCP server, ask what edits I want, and let me preview before exporting.';
const config = JSON.stringify({ mcpServers: { snip: { command: 'node', args: ['/absolute/path/to/snip/scripts/mcp-server.mjs'], env: { SNIP_PORT: '5188' } } } }, null, 2);
const prompt = `${introduction}

Set up Snip from ${repository} using docs/editing-engine.md. For this preview, use the feat/deterministic-editing-engine branch, not main. Clone it into a new directory:

git clone --branch feat/deterministic-editing-engine --single-branch https://github.com/MayankBansal12/snip.git snip-agent-preview
cd snip-agent-preview
npm ci
npm run build

Use Node.js 22+. If that directory already exists, choose a fresh directory rather than overwriting existing work. Run git branch --show-current to verify the branch before building. Replace the placeholder path below with the absolute path to the local checkout and configure this stdio MCP server:

${config}

First check where you are running. If you are on my computer, use the local connection. If you are on a VM or remote machine, do not try to open a desktop or agent-browser for me: expose port 5188 through an authenticated HTTPS tunnel (in bb, use bb connect expose 5188), set SNIP_PUBLIC_URL in the MCP server environment to that exact HTTPS origin, and restart the MCP server. Alternatively, forward its loopback port to my computer over SSH. Call get_connection and give me the pairing link to open in my own browser, where I will connect and choose my video. The VM needs only Node.js; preview and export run in my browser. Use the same MCP process throughout the session. If a tab appears connected but your bridge reports otherwise, compare its bridge ID (shown on hover over disconnect agent) with get_connection, and provide the pairing link from your current bridge. Read get_project before editing, use the returned session and revision, and ask what changes I want. Use get_frame with a sourceTime in original-video seconds to inspect the footage before choosing zoom positions or visual edits. Requested frame images are shared with you; the full video remains in the browser. Let me preview the edits before starting an export. Keep the video in my browser.`;

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
      use snip with your agent<ChevronDown className="size-3.5 group-data-popup-open:rotate-180" />
    </PopoverTrigger>
    <PopoverPopup align="end" sideOffset={12} className="w-[min(32rem,calc(100vw-2rem))] rounded-2xl shadow-xl/5 motion-reduce:transition-none">
      <PopoverTitle className="sr-only">use snip with your agent</PopoverTitle>
      <PopoverDescription>copy below prompt and pass it to your agent to get started.</PopoverDescription>
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
      <span className="sr-only" role="status">{copied ? 'Full prompt and MCP configuration copied' : ''}</span>
      {error && <p role="alert" className="mt-2 text-sm text-destructive-foreground">{error}</p>}
    </PopoverPopup>
  </Popover>;
}
