import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { Button } from './ui/button';
import { Popover, PopoverDescription, PopoverPopup, PopoverTitle, PopoverTrigger } from './ui/popover';

type Props = { prompt: string };
export default function AgentOnboarding({ prompt }: Props) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    setError('');
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true); clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Clipboard access is unavailable. Select and copy the full prompt above.');
    }
  }
  return <Popover>
    <PopoverTrigger openOnHover delay={150} closeDelay={1000} render={<Button variant="ghost" size="sm" className="group text-sm font-normal text-muted-foreground" />}>
      use snip with your agent<ChevronDown className="size-3.5 group-data-popup-open:rotate-180" />
    </PopoverTrigger>
    <PopoverPopup align="end" sideOffset={12} className="w-[min(32rem,calc(100vw-2rem))] rounded-2xl shadow-xl/5 motion-reduce:transition-none">
      <PopoverTitle className="sr-only">use snip with your agent</PopoverTitle>
      <PopoverDescription>copy below prompt and pass it to your agent to get started.</PopoverDescription>
      <div className="mt-4">
        <div className="min-w-0 rounded-xl bg-muted/60 p-4 sm:p-5">
          <textarea aria-label="full agent prompt" readOnly value={prompt} spellCheck={false} className="block h-28 w-full resize-none overflow-y-auto rounded-md border-0 bg-transparent p-0 text-sm leading-relaxed text-foreground lowercase outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring" />
          <div className="mt-5 flex justify-end">
            <Button size="sm" onClick={() => void copy()}>{copied ? <Check /> : <Copy />}{copied ? 'copied' : 'copy prompt'}</Button>
          </div>
        </div>
      </div>
      <span className="sr-only" role="status">{copied ? 'Prompt copied' : ''}</span>
      {error && <p role="alert" className="mt-2 text-sm text-destructive-foreground">{error}</p>}
    </PopoverPopup>
  </Popover>;
}
