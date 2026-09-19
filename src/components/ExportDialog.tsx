import { ArrowDownToLine, Check, Film, ShieldCheck } from 'lucide-react';
import { canvasSize, formatTime, outputSize, sequenceDuration } from '../types';
import type { Edits, Source } from '../types';
import { filesize } from '../media';
import { estimateExportSize, formatSizeEstimate } from '../export-estimate';
import EditorSelect from './EditorSelect';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogDescription, DialogPanel, DialogFooter } from './ui/dialog';
import { Field, FieldLabel } from './ui/field';
import { Progress, ProgressLabel, ProgressValue, ProgressTrack, ProgressIndicator } from './ui/progress';
import { Alert, AlertDescription } from './ui/alert';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from './ui/empty';
export type Download = { url: string; name: string; size: number };
type Props = { open: boolean; source: Source | null; edits: Edits; busy: boolean; progress: number; stage: string; download: Download | null; error: string; onUpdate: (patch: Partial<Edits>) => void; onClose: () => void; onExport: () => void; onCancel: () => void };
export default function ExportDialog(p: Props) {
  const output = p.source ? outputSize(p.source,p.edits) : { width: 0, height: 0 }, canvas = p.source ? canvasSize(p.source,p.edits) : output;
  const estimate = p.source ? estimateExportSize(p.source, p.edits) : null;
  const sizeHint = estimate && <p role="status" aria-live="polite" className="text-xs text-muted-foreground">Estimated size: <span className="font-medium tabular-nums text-foreground">{formatSizeEstimate(estimate)}</span><span className="block mt-1">Actual size may vary.</span></p>;
  const resolutionOptions = [{ value: 'original', label: `Original · ${canvas.width} × ${canvas.height}` }, ...[2160,1440,1080,720,480,360].filter(n => n < Math.min(canvas.width,canvas.height)).map(n => { const size = p.source ? outputSize(p.source,{ ...p.edits, resolution: String(n) }) : output; return { value: String(n), label: `${n}p · ${size.width} × ${size.height}` }; })];
  return <Dialog open={p.open} onOpenChange={open => { if (!open && !p.busy) p.onClose(); }}>
    <DialogPopup className="export-dialog" showCloseButton={!p.busy} closeProps={{ 'aria-label': 'Close export' }}>
      <DialogHeader><DialogTitle>{p.download ? 'Your video is ready' : p.busy ? 'Creating your video' : 'Export video'}</DialogTitle><DialogDescription>{p.download ? 'All yours. Ready to share.' : p.busy ? 'Keep this tab open. Processing stays on this device.' : 'Choose the finishing touches for your download.'}</DialogDescription></DialogHeader>
      <DialogPanel>
        {p.download ? <Empty className="py-6 md:py-6"><EmptyHeader><EmptyMedia variant="icon"><Check className="text-success-foreground" /></EmptyMedia><EmptyTitle>Export complete</EmptyTitle><EmptyDescription>{output.width} × {output.height} · {formatTime(sequenceDuration(p.edits))} · {filesize(p.download.size)}</EmptyDescription></EmptyHeader></Empty> : p.busy ? <div className="space-y-4 py-8"><Progress value={Math.round(p.progress*100)}><div className="flex justify-between gap-4"><ProgressLabel>{p.stage || 'Preparing export…'}</ProgressLabel><ProgressValue /></div><ProgressTrack><ProgressIndicator /></ProgressTrack></Progress>{sizeHint}</div> : <div className="flex flex-col gap-5">
          <Field><FieldLabel>Format</FieldLabel><EditorSelect label="Export format" value={p.edits.format} options={[{ value: 'mp4', label: 'MP4 · widely supported' }, { value: 'webm', label: 'WebM · VP8' }]} onChange={format => p.onUpdate({ format: format as Edits['format'] })} /></Field>
          <Field><FieldLabel>Resolution</FieldLabel><EditorSelect label="Export resolution" value={p.edits.resolution} options={resolutionOptions} onChange={resolution => p.onUpdate({ resolution })} /></Field>
          <Field><FieldLabel>Quality</FieldLabel><EditorSelect label="Export quality" value={p.edits.quality} options={[{ value: 'maximum', label: 'Maximum quality' }, { value: 'compact', label: 'Smaller file' }]} onChange={quality => p.onUpdate({ quality })} /></Field>
          <div className="flex flex-wrap items-center gap-2"><Badge variant="outline"><Film />{formatTime(sequenceDuration(p.edits))}</Badge><Badge variant="outline">{output.width} × {output.height}</Badge><Badge variant="outline">{p.edits.clips.length} {p.edits.clips.length === 1 ? 'clip' : 'clips'}</Badge></div>
          {sizeHint}
          {p.error && <Alert variant="error"><AlertDescription>{p.error}</AlertDescription></Alert>}
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" />No watermark. No upload. Just your video.</p>
        </div>}
      </DialogPanel>
      <DialogFooter>
        {p.download ? <><Button variant="outline" onClick={p.onClose}>Back to editing</Button><Button render={<a href={p.download.url} download={p.download.name} />}><ArrowDownToLine />Download again</Button></> : p.busy ? <Button variant="outline" onClick={p.onCancel}>Cancel export</Button> : <><Button variant="outline" onClick={p.onClose}>Keep editing</Button><Button onClick={p.onExport}><ArrowDownToLine />Export & download</Button></>}
      </DialogFooter>
    </DialogPopup>
  </Dialog>;
}
