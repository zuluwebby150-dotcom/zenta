# Zenta Business

A simple PWA for small shops in Zambia: sales, stock, expenses and customer credit (Nkongole).
Single-page app (`index.html`) on Firebase Auth + Cloud Firestore (database id `default`).

## Files
- `index.html` – the whole app
- `sw.js` – service worker (offline cache; network first with a 4s timeout)
- `manifest.json`, `*.png` – install metadata and icons
- `firestore.rules` – database security rules (the real source of truth for the paywall)
- `firebase.json` – so rules can be deployed from this repo

## Deploy the rules
```
firebase deploy --only firestore:rules
```
The admin account (`zuluwebby150@gmail.com`) must have a **verified email**, or the Admin screen cannot
activate subscribers. In the app: More → "Admin: verify my email", open the link, sign in again.

## Notes
- Subscription and trial are enforced in the rules using server time, not only in the app.
- Increase `V` in `sw.js` only when you want to purge old caches.
