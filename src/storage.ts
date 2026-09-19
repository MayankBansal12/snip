import type { Edits, Source } from './types';
const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('snip-local-project', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('project');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
export async function restoreProject(): Promise<{ source: Source; edits: Edits } | null> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('project', 'readonly');
    const store = transaction.objectStore('project');
    const source = store.get('source');
    const edits = store.get('edits');
    transaction.oncomplete = () => resolve(source.result && edits.result ? { source: source.result, edits: edits.result } : null);
    transaction.onerror = () => reject(transaction.error);
  });
}
async function write(values: Record<string, unknown> | null) {
  const db = await database;
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('project', 'readwrite');
    const store = transaction.objectStore('project');
    if (values) Object.entries(values).forEach(([key, value]) => store.put(value, key));
    else store.clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Local storage is full.'));
  });
}
export const saveProject = (source: Source, edits: Edits) => write({ source, edits });
export const saveSource = (source: Source) => write({ source });
export const saveEdits = (edits: Edits) => write({ edits });
export const clearProject = () => write(null);
