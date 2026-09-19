import { useEffect, useRef } from 'react';

/** Import clipboard files without reading or requesting access to the clipboard. */
export function useFilePaste(options: { enabled: boolean; onFile: (file: File) => void }) {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (!latest.current.enabled || event.defaultPrevented || !event.clipboardData) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input,textarea,[contenteditable]:not([contenteditable="false"])')) return;

      const files = Array.from(event.clipboardData.files);
      if (!files.length) {
        for (const item of event.clipboardData.items) {
          const file = item.kind === 'file' ? item.getAsFile() : null;
          if (file) files.push(file);
        }
      }
      const file = files.find(candidate => candidate.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv|avi|snip)$/i.test(candidate.name)) || files[0];
      if (!file) return;

      event.preventDefault();
      latest.current.onFile(file);
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, []);
}
