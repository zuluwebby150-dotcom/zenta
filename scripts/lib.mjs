// Shared by backup.mjs and restore.mjs. Firestore Timestamps are stored in the backup file as
// {"__ts":[seconds,nanoseconds]} so every field survives a JSON round trip exactly.
import { Timestamp } from 'firebase-admin/firestore';

export function encode(v) {
  if (v instanceof Timestamp) return { __ts: [v.seconds, v.nanoseconds] };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}

export function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    if (Array.isArray(v.__ts) && v.__ts.length === 2 && Object.keys(v).length === 1) return new Timestamp(v.__ts[0], v.__ts[1]);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

// "users/abc/sales/s1" -> "users/sales"  (used to count documents per collection)
export const collectionOf = path => path.split('/').filter((_, i) => i % 2 === 0).join('/');
