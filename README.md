# Zenta Business

A simple PWA for small shops in Zambia: sales, stock, expenses and customer credit (Nkongole).
Static site on Firebase Auth + Cloud Firestore (database id `default`). No build step.

## Files
- `index.html` – page markup (login, lock screens, sheet container)
- `css/app.css` – all styles
- `js/app.js` – the app (auth, data, views, actions)
- `js/config.js` – Firebase config, price, payment numbers, admin email (all public by design)
- `js/guide.js` – the first-run walkthrough
- `sw.js` – service worker (offline cache; network first with a 4s timeout). Add new files to `SHELL`.
- `manifest.json`, `*.png` – install metadata and icons
- `firestore.rules` – database security rules (the real source of truth for the paywall and data checks)
- `firebase.json` – so rules can be deployed from this repo
- `scripts/` – `backup.mjs`, `restore.mjs`, `loadtest.mjs`; `test/` – rules and backup tests
- `docs/BACKUP.md` – backups and the restore drill

## Deploy
```
firebase deploy --only firestore:rules
```
**Deploy the rules and the new app files together.** The rules require new signups to claim a trial key
(`trials/...`) in the same batch as the account; an old copy of the app cannot create accounts under the new rules.

The admin account (`zuluwebby150@gmail.com`) must have a **verified email**, or the Admin screen cannot
activate subscribers. In the app: More → "Admin: verify my email", open the link, sign in again.

## Free trials: one per phone number and per mailbox
- Signing up writes `trials/p_<phone>` and `trials/e_<normalised email>` and the account in one batch.
  The rules only allow it if neither key exists. Gmail dots, `+tags` and `googlemail.com` are normalised, so
  `a.b@gmail.com` and `ab+shop@gmail.com` are the same mailbox.
- If a key already exists the account is still created, with `noTrial: true`: it works only after the admin
  activates a paid month (the lock screen explains this).
- **Limit:** the phone number is typed in, not verified by SMS. Someone with a new mailbox *and* a different
  number can still get another trial. Real prevention needs Firebase phone authentication (SMS, needs the Blaze plan).

## Errors
Crashes and unhandled errors are written to the `errors` collection (max 5 per session, 600 characters, no
personal data besides the user id and browser string). Only the admin can read them: More → "Admin: app errors".

## Testing
- `npm run test:unit` – backup encoding tests. No extra software needed.
- `npm run test:rules` – 9 security-rule tests (shop isolation, bad data, paywall, trial lock, error reports).
  Needs the Firestore emulator: Node 20+, **JDK 21+**, and `npm i -g firebase-tools`.
  On some Windows builds Java cannot start the emulator ("Unable to establish loopback connection");
  if that happens run it in WSL/Linux or Docker, or check the rules by hand in the Firebase console → Rules Playground.
- `node scripts/serve.mjs 5391` – serve the app locally (then open http://127.0.0.1:5391). Signing up there creates real accounts in the live Firebase project.
- `npm run loadtest` – seeds a big shop (50k sales, 5k products, 2k customers) in the emulator and times the app's queries.

## Security notes
- The **Owner PIN is a UI lock, not security.** Owner and staff share one account login, and
  the PIN is a client-side hash stored in `private/settings`. Anyone who can sign in can still
  read or change the shop's data from the Firebase console or a modified client. The PIN's real
  job is keeping casual staff from seeing profit or deleting things — nothing more.
- The Firestore rules are the real boundary: every shop's data lives under `users/<uid>/...` and only that
  user can touch it; trial/paid dates use server time; only the admin can set `paidUntil`; sales and expenses are
  append-only (only soft-delete flags and `returnedQty` may change a sale afterwards); every collection has a
  fixed list of allowed fields, types, ranges and string lengths.
- Editing a sale in the app writes a corrected sale and moves the original to Deleted (one batch), so the
  rules never need to allow amount edits.
- The Firebase web API key, the payment numbers and the admin email in `js/config.js` are public
  by design (subscribers must see the payment numbers; the admin email only works when signed
  in as that verified account). Add App Check or API key restrictions in the Firebase console
  for an extra layer.
- The app PIN (per phone, 4 digits, 5 tries then sign-out) is a convenience lock for shared
  phones, not a security boundary: clearing site data resets the try counter.

## Notes
- Subscription and trial are enforced in the rules using server time, not only in the app.
- Each write reads the account document exactly once (`activeOf` takes the document, not two gets).
- Lists show 100 rows at a time ("Show more") so a busy month does not freeze a cheap phone.
- Increase `V` in `sw.js` only when you want to purge old caches.
