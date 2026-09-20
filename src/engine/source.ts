import { sha256 } from '@noble/hashes/sha2.js';
import type { Source } from '../types';
import type { SourceInfo } from './index';
const hashes = new WeakMap<Blob, Promise<string>>();
/** Hash in chunks so identifying a 500 MiB source does not duplicate it in RAM. */
export async function identifySource(source: Source): Promise<SourceInfo> {
  let pending = hashes.get(source.file);
  if (!pending) {
    pending = (async () => {
      const hash = sha256.create();
      for (let offset = 0; offset < source.file.size; offset += 1024 * 1024)
        hash.update(new Uint8Array(await source.file.slice(offset, offset + 1024 * 1024).arrayBuffer()));
      return Array.from(hash.digest(), byte => byte.toString(16).padStart(2, '0')).join('');
    })();
    hashes.set(source.file, pending);
    pending.catch(() => hashes.delete(source.file));
  }
  return { sha256: await pending, size: source.file.size, width: source.width, height: source.height, duration: source.duration };
}
