# snip project container, version 2

A `.snip` file is a self-contained binary container, not a video export or ZIP. It uses a fixed header, a small UTF-8 JSON manifest, and the source video’s original bytes. Browser `Blob` composition/slicing avoids materializing the whole video in JavaScript memory. There is no compression, base64, server, or runtime download dependency.

| Offset | Bytes | Meaning |
| --- | --- | --- |
| 0 | 8 | ASCII `SNIPFILE` |
| 8 | 4 | Container version, unsigned 32-bit little-endian: `2` |
| 12 | 4 | Manifest byte length, unsigned 32-bit little-endian |
| 16 | manifest length | UTF-8 JSON manifest |
| 16 + manifest length | source size | Original video bytes |

The manifest contains `savedAt` (ISO timestamp), `source` (`name`, MIME `type`, byte `size`), and `edits` (the version-2 `Edits` schema in `src/types.ts`). It excludes transient selection, undo history, theme, and playhead position. Unknown manifest fields do not affect loading.

Version 2 adds optional per-clip `speed` (0.25–4) and `zoom` (`scale`: 1–4, `x` and `y`: 0–1). A missing clip speed falls back to the legacy global speed. A missing zoom uses scale 1 and a centered position. Positions align the zoomed view between the left/top (0) and right/bottom (1) edges of the existing crop. Output dimensions do not change.

Clip speed accepts any finite number in that range, including custom values outside the preset list. Zoom transitions are derived from adjacent clips: the incoming viewport eases from the previous clip’s framing to its own over 0.28 seconds of sequence time, capped at half the incoming clip’s duration. Preview and export use the same cosine easing. No footage is overlapped and sequence duration is unchanged; no extra transition fields are stored.

The importer accepts container versions 1 and 2. New saves use version 2 so older apps reject them instead of silently discarding clip adjustments. Existing global crop, framing, color, and annotation settings still render and export, although their editing UI is deferred.

The importer checks the signature, container version, bounds, exact source length, and edit schema. It reads real video metadata with the browser decoder, then checks clip ranges, ordered/nonoverlapping clips, unique IDs, finite numeric ranges, normalized crop/annotations, colors, and supported export options. A 50 ms tolerance accommodates decoder differences at the source endpoint; clip ends within that tolerance are clamped to the decoded duration. Unsupported versions are rejected with an update prompt.

Limits: 500 MiB embedded source, 8 MiB manifest, 10,000 clips, 1,000 annotations, and 100,000 total freehand points. There is no cryptographic checksum; length and schema checks do not detect all possible corruption inside video data. Browser codec compatibility still applies.

Only after the complete project has validated does the app atomically write the new source and edits to IndexedDB and replace the visible workspace. Failed validation or an aborted storage transaction preserves the previous workspace. Opening a valid project starts a new undo history.

Downloads are immutable snapshots. Ordinary browser downloads provide the file on desktop and mobile without requiring a filesystem permission API. The app does not silently rewrite a file in the user’s Downloads folder.
