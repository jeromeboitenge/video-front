const DB_NAME = 'frameforge-media';
const STORE_NAME = 'assets';
let database: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local media storage'));
  });
  return database;
}

export async function storeMedia(id: string, file: File) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(file, id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save this media file'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Media storage quota exceeded'));
  });
}

export async function readMedia(id: string) {
  const db = await openDatabase();
  return new Promise<Blob | undefined>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error ?? new Error('Could not read local media'));
  });
}
