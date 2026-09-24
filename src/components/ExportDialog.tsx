import type { ExportDetails } from '../media-analysis';
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
export type Download = { url: string; name: string; size: number; details?: ExportDetails };
type Props = { onSaveProject:()=>void; open: boolean; source: Source | null; edits: Edits; busy: boolean; progress: number; stage: string; download: Download | null; error: string; onUpdate: (patch: Partial<Edits>) => void; onClose: () => void; onExport: () => void; onCancel: () => void };
export default function ExportDialog(p: Props) {
  const details=p.download?.details;
  const output = p.source ? outputSize(p.source,p.edits) : { width: 0, height: 0 }, canvas = p.source ? canvasSize(p.source,p.edits) : output;
  const estimate = p.source ? estimateExportSize(p.source, p.edits) : null;
  const sizeHint = estimate && <p role="status" aria-live="polite" className="whitespace-nowrap text-[10px] text-muted-foreground sm:text-xs">estimated size: <span className="font-medium tabular-nums text-foreground">{formatSizeEstimate(estimate)}</span> (actual size may vary)</p>;
  const resolutionOptions = [{ value: 'original', label: `original · ${canvas.width} × ${canvas.height}` }, ...[2160,1440,1080,720,480,360].filter(n => n < Math.min(canvas.width,canvas.height)).map(n => { const size = p.source ? outputSize(p.source,{ ...p.edits, resolution: String(n) }) : output; return { value: String(n), label: `${n}p · ${size.width} × ${size.height}` }; })];
  return <Dialog open={p.open} onOpenChange={open => { if (!open && !p.busy) p.onClose(); }}>
    <DialogPopup className="export-dialog" showCloseButton={!p.busy} closeProps={{ 'aria-label': 'close export' }}>
      <DialogHeader><DialogTitle>{p.download ? 'your video is ready' : p.busy ? 'creating your video' : 'export video'}</DialogTitle><DialogDescription>{p.download ? 'all yours. ready to share.' : p.busy ? 'keep this tab open. processing stays on this device.' : 'choose the finishing touches for your download.'}</DialogDescription></DialogHeader>
      <DialogPanel>
        {p.download ? <Empty className="py-6 md:py-6"><EmptyHeader><EmptyMedia variant="icon"><Check className="text-success-foreground" /></EmptyMedia><EmptyTitle>export complete</EmptyTitle><EmptyDescription>{details?.width??output.width} × {details?.height??output.height} · {formatTime(details?.duration??sequenceDuration(p.edits))} · {filesize(p.download.size)}{details&&<> · {details.frameRate.toFixed(2)} fps{details.variable?' average (variable)':''}</>}</EmptyDescription></EmptyHeader>{details&&<details className="mt-3 text-left text-xs text-muted-foreground"><summary className="cursor-pointer">video details</summary><dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2"><dt>video codec</dt><dd>{details.videoCodec.toUpperCase()}</dd><dt>video frames</dt><dd>{details.frameCount}</dd><dt>audio</dt><dd>{details.audio?`${details.audio.codec.toUpperCase()} · ${details.audio.sampleRate} Hz · ${details.audio.channels} channels`:'no audio'}</dd><dt>original duration</dt><dd>{formatTime(p.source?.duration??0)}</dd></dl></details>}</Empty> : p.busy ? <div className="space-y-4 py-8"><Progress value={Math.round(p.progress*100)}><div className="flex justify-between gap-4"><ProgressLabel>{p.stage || 'preparing export…'}</ProgressLabel><ProgressValue /></div><ProgressTrack><ProgressIndicator /></ProgressTrack></Progress>{sizeHint}</div> : <div className="flex flex-col gap-5">
          <Field><FieldLabel>format</FieldLabel><EditorSelect label="export format" value={p.edits.format} options={[{ value: 'mp4', label: 'mp4 · widely supported' }, { value: 'webm', label: 'webm · vp8' }]} onChange={format => p.onUpdate({ format: format as Edits['format'] })} /></Field>
          <Field><FieldLabel>resolution</FieldLabel><EditorSelect label="export resolution" value={p.edits.resolution} options={resolutionOptions} onChange={resolution => p.onUpdate({ resolution })} /></Field>
          <Field><FieldLabel>quality</FieldLabel><EditorSelect label="export quality" value={p.edits.quality} options={[{ value: 'maximum', label: 'maximum quality' }, { value: 'compact', label: 'smaller file' }]} onChange={quality => p.onUpdate({ quality })} /></Field>
          <div className="flex flex-wrap items-center gap-2"><Badge variant="outline"><Film />{formatTime(sequenceDuration(p.edits))}</Badge><Badge variant="outline">{output.width} × {output.height}</Badge><Badge variant="outline">{p.edits.clips.length} {p.edits.clips.length === 1 ? 'clip' : 'clips'}</Badge></div>
          {sizeHint}
          <p className="text-xs leading-relaxed text-muted-foreground">Files up to 500 MB. Large or 4K exports can exceed browser memory, especially on phones. Choose a smaller resolution if export fails.</p>
          {p.error && <Alert variant="error"><AlertDescription>{p.error} Your edits are unchanged. Try a smaller resolution, or save the project and reopen it to retry.<Button variant="link" size="sm" onClick={p.onSaveProject}>save project</Button></AlertDescription></Alert>}
          <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" />no watermark</p>
        </div>}
      </DialogPanel>
      <DialogFooter>
        {p.download ? <><Button variant="outline" onClick={p.onClose}>back to editing</Button><Button render={<a href={p.download.url} download={p.download.name} />}><ArrowDownToLine />download again</Button></> : p.busy ? <Button variant="outline" onClick={p.onCancel}>cancel export</Button> : <><Button variant="outline" onClick={p.onClose}>keep editing</Button><Button onClick={p.onExport}><ArrowDownToLine />export & download</Button></>}
      </DialogFooter>
    </DialogPopup>
  </Dialog>;
}
