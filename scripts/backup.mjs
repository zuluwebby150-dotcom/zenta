// Full logical backup of the Firestore database to one JSON-lines file (one document per line).
//
//   node scripts/backup.mjs                          -> backups/zenta-<date>.jsonl
//   node scripts/backup.mjs --user <uid>             -> only one shop (users/<uid>/...)
//   node scripts/backup.mjs --verify backups/x.jsonl -> print document counts per collection
//
// Credentials: set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file with the
// "Cloud Datastore Viewer" role (read-only is enough), or run on a machine logged in with
// `gcloud auth application-default login`. Set GCLOUD_PROJECT=zenta-business.
// The file contains customer data: keep it private and delete old copies.
import { mkdirSync, createWriteStream, readFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { encode, collectionOf } from './lib.mjs';

const arg = n => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : null; };

if (arg('verify')) {
  const counts = {};
  for (const line of readFileSync(arg('verify'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const c = collectionOf(JSON.parse(line).path); counts[c] = (counts[c] || 0) + 1;
  }
  console.table(counts); process.exit(0);
}

initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'zenta-business' });
const db = getFirestore(undefined, process.env.FIRESTORE_DATABASE || 'default');

const only = arg('user');
const out = arg('out') || `backups/zenta-${new Date().toISOString().slice(0, 10)}${only ? '-' + only : ''}.jsonl`;
mkdirSync('backups', { recursive: true });
const ws = createWriteStream(out);
let n = 0;

async function walk(ref) {                       // ref = CollectionReference
  for (const d of await ref.listDocuments()) {   // includes "phantom" parents such as users/<uid>
    const snap = await d.get();
    if (snap.exists) { ws.write(JSON.stringify({ path: d.path, data: encode(snap.data()) }) + '\n'); n++; }
    for (const sub of await d.listCollections()) await walk(sub);
  }
}

if (only) { for (const sub of await db.doc(`users/${only}`).listCollections()) await walk(sub); }
else { for (const top of await db.listCollections()) await walk(top); }

await new Promise(r => ws.end(r));
console.log(`Backed up ${n} documents to ${out}`);
