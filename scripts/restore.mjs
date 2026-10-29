// Restore a backup file made by backup.mjs.
//
//   node scripts/restore.mjs backups/x.jsonl --dry-run              -> show what would be written
//   node scripts/restore.mjs backups/x.jsonl --yes                  -> write everything back
//   node scripts/restore.mjs backups/x.jsonl --user <uid> --yes     -> restore one shop only
//   node scripts/restore.mjs backups/x.jsonl --database restore-test --yes   -> into another database
//
// Restoring OVERWRITES documents with the same path (it does not delete anything that is not in the file).
// Always rehearse with --database <scratch-db> or the emulator (FIRESTORE_EMULATOR_HOST=127.0.0.1:8080) first.
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { decode, collectionOf } from './lib.mjs';

const file = process.argv[2];
const has = n => process.argv.includes('--' + n);
const arg = n => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : null; };
if (!file || file.startsWith('--')) { console.error('Usage: node scripts/restore.mjs <backup.jsonl> [--user uid] [--database id] [--dry-run | --yes]'); process.exit(1); }

const only = arg('user');
const rows = readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l))
  .filter(r => !only || r.path.startsWith(`users/${only}/`));

const counts = {};
rows.forEach(r => { const c = collectionOf(r.path); counts[c] = (counts[c] || 0) + 1; });
console.table(counts);
if (has('dry-run') || !has('yes')) { console.log(`${rows.length} documents. Nothing written (add --yes to restore).`); process.exit(0); }

initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'zenta-business' });
const db = getFirestore(undefined, arg('database') || process.env.FIRESTORE_DATABASE || 'default');
const bw = db.bulkWriter();
let failed = 0;
bw.onWriteError(e => { failed++; console.error('FAILED', e.documentRef.path, e.message); return false; });
for (const r of rows) bw.set(db.doc(r.path), decode(r.data));
await bw.close();
console.log(failed ? `Restored with ${failed} failures.` : `Restored ${rows.length} documents.`);
process.exit(failed ? 1 : 0);
