/* 측정 기록 저장소: IndexedDB(사진 포함). localStorage는 용량이 약 5 MB라 사진 기록에 부족하다. */

const DB_NAME = 'distance-meter';
const STORE = 'records';

const open = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(out?.result); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
};

export const listRecords = async () => {
  const all = await tx('readonly', s => s.getAll());
  return (all || []).sort((a, b) => b.time.localeCompare(a.time));
};
export const putRecord = (rec) => tx('readwrite', s => s.put(rec));
export const deleteRecord = (id) => tx('readwrite', s => s.delete(id));

// 설정은 작으므로 localStorage에 둔다.
export const loadJSON = (key, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
};
export const saveJSON = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
};
