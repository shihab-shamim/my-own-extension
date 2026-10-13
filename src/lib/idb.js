// Minimal IndexedDB store for user-uploaded wallpapers (binary blobs are too
// large for chrome.storage). Usable from both the page and the service worker.

const DB_NAME = 'sequoia-tab';
const DB_VERSION = 1;
const STORE = 'wallpapers';

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('addedAt', 'addedAt');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result;
        Promise.resolve(fn(store, (r) => (result = r))).catch(reject);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Transaction aborted'));
      }),
  );
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function putWallpaper(record) {
  return tx('readwrite', (store) => {
    store.put(record);
  });
}

export function getWallpaper(id) {
  return tx('readonly', async (store, done) => {
    done(await reqP(store.get(id)));
  });
}

export function deleteWallpaper(id) {
  return tx('readwrite', (store) => {
    store.delete(id);
  });
}

// Metadata only (no full-size blobs) in upload order.
export function listWallpapers() {
  return tx('readonly', (store, done) => {
    const out = [];
    const req = store.index('addedAt').openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        done(out);
        return;
      }
      const { blob, ...meta } = cursor.value;
      out.push(meta);
      cursor.continue();
    };
  });
}

export function listWallpaperIds() {
  return listWallpapers().then((list) => list.map((w) => w.id));
}
