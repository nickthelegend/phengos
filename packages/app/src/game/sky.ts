/**
 * The ceiling constellation lives in IndexedDB on this device. Stars are stored
 * in ceiling-plane coordinates (u, v), so each session puts them back above the
 * same spots, relative to the ceiling the headset detects.
 */
import type { Star } from '@phengos/core';

const DB = 'phengos';
const STORE = 'sky';
const KEY = 'stars';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadSky(): Promise<Star[]> {
  try {
    const db = await open();
    return await new Promise<Star[]>((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as Star[]) : []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function saveSky(stars: Star[]): Promise<boolean> {
  try {
    const db = await open();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(stars, KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}
