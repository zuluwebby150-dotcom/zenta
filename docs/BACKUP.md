# Backups and restore drill

Two layers. Neither has been run against the real project from this repo yet: do the **drill** at the bottom once
and write the date here: `Last drill: ____`.

## Layer 1: Google-managed (recommended, set up once)
Run these with the `gcloud` CLI logged in to the `zenta-business` project (Owner or Datastore Owner role).
The database id is `default` (not `(default)`).

```
# Point-in-time recovery: restore to any minute in the last 7 days (also protects against a bad deploy or a bug)
gcloud firestore databases update --database=default --enable-pitr

# Daily backup, kept for 14 days (daily schedules can keep up to 14 weeks)
gcloud firestore backups schedules create --database=default --recurrence=daily --retention=14d

# See what exists
gcloud firestore backups list
gcloud firestore backups schedules list --database=default
```
These cost storage (small for this app) and are restored into a **new** database; they never overwrite the live one.

## Layer 2: your own copy (`scripts/backup.mjs`)
A plain JSON-lines file you can keep off Google (an external drive, another cloud). One document per line.

```
npm install
set GCLOUD_PROJECT=zenta-business
set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\read-only-service-account.json
npm run backup                          # backups\zenta-YYYY-MM-DD.jsonl
npm run backup -- --user <uid>          # one shop only
node scripts/backup.mjs --verify backups\zenta-YYYY-MM-DD.jsonl    # counts per collection
```
Use a service account with only **Cloud Datastore Viewer**. The file contains customer names and phone numbers:
keep it private, and delete copies you no longer need (see privacy.html).

## Restore
```
npm run restore -- backups\zenta-2026-10-29.jsonl --dry-run                 # shows counts, writes nothing
npm run restore -- backups\zenta-2026-10-29.jsonl --database restore-test --yes   # rehearse in a scratch database
npm run restore -- backups\zenta-2026-10-29.jsonl --user <uid> --yes         # put one shop back in the live database
```
Restore **overwrites** documents with the same path and never deletes anything. To undo a bad day for one shop,
restore that shop with `--user`. To recover from a wider problem, use a Layer 1 backup or PITR into a new database,
check it, then copy the shops back.

## The restore drill (do this once, then every few months)
1. `gcloud firestore databases create --database=restore-test --location=<same as default> --type=firestore-native`
2. `npm run backup`, then `node scripts/backup.mjs --verify <file>` and note the counts.
3. `npm run restore -- <file> --database restore-test --yes`
4. Compare counts in the Firebase console for `restore-test` with step 2, open a few shops' sales and check totals.
5. `gcloud firestore databases delete --database=restore-test`
6. Write the date at the top of this file.

`test/backup.test.mjs` already proves the file format round-trips timestamps and fields exactly; the drill proves the
whole chain (credentials, export, import, counts) on the real project.
