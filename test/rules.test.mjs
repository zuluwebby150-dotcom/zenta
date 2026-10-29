import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

const FV = firebase.firestore.FieldValue, TS = firebase.firestore.Timestamp;
const ADMIN = { email: 'zuluwebby150@gmail.com', email_verified: true };
let env;

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'zenta-test', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const as = (uid, email) => env.authenticatedContext(uid, { email: email || uid + '@x.com', email_verified: true }).firestore();
const asAdmin = () => env.authenticatedContext('adm', ADMIN).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const seed = fn => env.withSecurityRulesDisabled(async c => fn(c.firestore()));
const DAY = 864e5;
const trialAcct = (uid, ago = 1) => seed(db => db.doc(`users/${uid}/meta/account`).set({ start: TS.fromMillis(Date.now() - ago * DAY), phone: '+260970000001', email: uid + '@x.com' }));
const sale = o => ({ t: Date.now(), item: 'Oil', qty: 2, price: 90, total: 180, mode: 'cash', cid: '', cname: '', pid: 'p1', cost: 70, packs: 0, packPrice: 0, ...o });

// ---- one shop can never see another shop's data ----
test('isolation: a shop cannot read or write another shop\'s data', async () => {
  await trialAcct('a'); await trialAcct('b');
  await seed(async db => {
    for (const c of ['sales', 'expenses', 'products', 'customers', 'payments', 'stocklog'])
      await db.doc(`users/b/${c}/x`).set({ t: 1, name: 'n', qty: 1, cost: 1, price: 1, owed: 0, amt: 1, what: 'w', item: 'i', total: 1, mode: 'cash', cid: 'c', txt: 't' });
    await db.doc('users/b/private/settings').set({ owner: 'h', biz: 'B' });
  });
  const a = as('a');
  for (const c of ['sales', 'expenses', 'products', 'customers', 'payments', 'stocklog']) {
    await assertFails(a.doc(`users/b/${c}/x`).get());
    await assertFails(a.collection(`users/b/${c}`).get());
    await assertFails(a.doc(`users/b/${c}/x`).delete());
  }
  await assertFails(a.doc('users/b/private/settings').get());
  await assertFails(a.doc('users/b/private/settings').set({ biz: 'hacked' }));
  await assertFails(a.doc('users/b/meta/account').get());
  await assertFails(a.collectionGroup('meta').get());
  await assertFails(a.collectionGroup('sales').get());
  await assertFails(a.doc('users/b/sales/new').set(sale()));
  await assertFails(anon().doc('users/b/sales/x').get());
  await assertSucceeds(as('b').doc('users/b/sales/x').get());
});

test('isolation: even the admin can read subscriptions only, not shop data', async () => {
  await trialAcct('b');
  await seed(db => db.doc('users/b/sales/x').set(sale()));
  await assertSucceeds(asAdmin().collectionGroup('meta').get());
  await assertFails(asAdmin().doc('users/b/sales/x').get());
  await assertFails(asAdmin().doc('users/b/private/settings').get());
  await assertFails(env.authenticatedContext('z', { email: ADMIN.email, email_verified: false }).firestore().collectionGroup('meta').get());
});

// ---- bad data ----
test('bad data: sales', async () => {
  await trialAcct('a'); const a = as('a');
  await assertSucceeds(a.doc('users/a/sales/ok').set(sale()));
  for (const bad of [
    sale({ qty: -1 }), sale({ qty: 0 }), sale({ total: -5 }), sale({ qty: '2' }), sale({ total: 1e9 }), sale({ price: -1 }),
    sale({ mode: 'bitcoin' }), sale({ item: 'x'.repeat(500) }), sale({ junk: 'spam' }), sale({ t: Date.now() + 10 * DAY }), sale({ t: 5 }),
    sale({ ret: true }), sale({ cost: -3 }),
  ]) await assertFails(a.doc('users/a/sales/bad').set(bad));
  const { item, ...noItem } = sale(); await assertFails(a.doc('users/a/sales/bad').set(noItem));
  await assertSucceeds(a.doc('users/a/sales/ret').set(sale({ ret: true, refOf: 'ok', qty: -1, total: -90 })));
  await assertSucceeds(a.doc('users/a/sales/ok').update({ deleted: true, delAt: Date.now() }));
  await assertSucceeds(a.doc('users/a/sales/ok').update({ returnedQty: FV.increment(1) }));
  await assertFails(a.doc('users/a/sales/ok').update({ returnedQty: 99 }));
  await assertFails(a.doc('users/a/sales/ok').update({ total: 1 }));
  await assertFails(a.doc('users/a/sales/ok').update({ qty: 100 }));
});

test('bad data: expenses, products, customers, payments, settings', async () => {
  await trialAcct('a'); const a = as('a');
  await assertSucceeds(a.doc('users/a/expenses/e').set({ t: Date.now(), what: 'Rent', amt: 500 }));
  for (const bad of [{ amt: -5 }, { amt: 0 }, { amt: '5' }, { amt: 1e9 }, { what: 'x'.repeat(300) }, { junk: 1 }])
    await assertFails(a.doc('users/a/expenses/bad').set({ t: Date.now(), what: 'Rent', amt: 5, ...bad }));
  await assertFails(a.doc('users/a/expenses/e').update({ amt: 1 }));
  await assertSucceeds(a.doc('users/a/expenses/e').update({ deleted: true, delAt: Date.now() }));

  const prod = o => ({ t: Date.now(), name: 'Sugar', qty: 5, cost: 25, price: 30, pack: 0, ...o });
  await assertSucceeds(a.doc('users/a/products/p').set(prod()));
  for (const bad of [{ qty: 1e9 }, { qty: -50000 }, { cost: -1 }, { price: '30' }, { name: '' }, { name: 'x'.repeat(500) }, { evil: 1 }, { pack: -2 }])
    await assertFails(a.doc('users/a/products/bad').set(prod(bad)));
  await assertSucceeds(a.doc('users/a/products/p').update({ qty: -3 }));
  await assertSucceeds(a.doc('users/a/products/p').update({ qty: FV.increment(10) }));
  await assertSucceeds(a.doc('users/a/products/p').update({ deleted: true, delAt: Date.now() }));
  await assertSucceeds(a.doc('users/a/products/p').update({ deleted: false, delAt: null }));

  await assertSucceeds(a.doc('users/a/customers/c').set({ t: Date.now(), name: 'Bwalya', phone: '0977', owed: 0 }));
  for (const bad of [{ owed: 'lots' }, { owed: 1e12 }, { name: '' }, { x: 1 }])
    await assertFails(a.doc('users/a/customers/bad').set({ t: Date.now(), name: 'B', phone: '1', owed: 0, ...bad }));
  await assertSucceeds(a.doc('users/a/customers/c').update({ owed: FV.increment(50) }));

  await assertSucceeds(a.doc('users/a/payments/p').set({ t: Date.now(), cid: 'c', cname: 'B', amt: 20 }));
  await assertFails(a.doc('users/a/payments/bad').set({ t: Date.now(), cid: 'c', amt: -20 }));
  await assertFails(a.doc('users/a/payments/p').update({ amt: 1 }));
  await assertSucceeds(a.doc('users/a/stocklog/l').set({ t: Date.now(), name: 'Sugar', txt: 'Received +5' }));
  await assertFails(a.doc('users/a/stocklog/l2').set({ t: Date.now(), name: 'S', txt: 'x'.repeat(1000) }));

  await assertSucceeds(a.doc('users/a/private/settings').set({ owner: 'abc', biz: 'My Shop' }, { merge: true }));
  await assertFails(a.doc('users/a/private/settings').set({ owner: 'abc', junk: 'x' }, { merge: true }));
  await assertFails(a.doc('users/a/private/other').set({ x: 1 }));
  await assertFails(a.doc('users/a/unknown/x').set({ x: 1 }));
});

// ---- subscription / paywall ----
test('paywall: expired trials cannot write, paid accounts can, clients cannot grant themselves time', async () => {
  await trialAcct('old', 20); await trialAcct('new', 1);
  await assertFails(as('old').doc('users/old/sales/s').set(sale()));
  await assertSucceeds(as('old').doc('users/old/sales/s').get());
  await assertSucceeds(as('new').doc('users/new/sales/s').set(sale()));
  await assertFails(as('old').doc('users/old/meta/account').update({ paidUntil: TS.fromMillis(Date.now() + 30 * DAY) }));
  await assertFails(as('old').doc('users/old/meta/account').update({ start: TS.fromMillis(Date.now()) }));
  await assertSucceeds(as('old').doc('users/old/meta/account').update({ phone: '+260971111111' }));
  await assertSucceeds(asAdmin().doc('users/old/meta/account').update({ paidUntil: TS.fromMillis(Date.now() + 30 * DAY) }));
  await assertSucceeds(as('old').doc('users/old/sales/s2').set(sale()));
});

// ---- one free trial per phone and per mailbox ----
const signup = (db, uid, phone, email) => {
  const b = db.batch();
  b.set(db.doc(`trials/p_${phone}`), { uid, t: FV.serverTimestamp() });
  const [l, d] = email.toLowerCase().split('@'), loc = l.split('+')[0], dom = d === 'googlemail.com' ? 'gmail.com' : d;
  b.set(db.doc(`trials/e_${dom === 'gmail.com' ? loc.replace(/\./g, '') : loc}@${dom}`), { uid, t: FV.serverTimestamp() });
  b.set(db.doc(`users/${uid}/meta/account`), { start: FV.serverTimestamp(), phone, email });
  return b.commit();
};
const noTrialAcct = (db, uid, phone, email) => db.doc(`users/${uid}/meta/account`).set({ start: FV.serverTimestamp(), phone, email, noTrial: true });

test('trials: first signup gets a trial, same phone or same mailbox does not', async () => {
  await assertSucceeds(signup(as('u1', 'Bob.Smith@gmail.com'), 'u1', '+260970000001', 'Bob.Smith@gmail.com'));
  await assertSucceeds(as('u1', 'Bob.Smith@gmail.com').doc('users/u1/sales/s').set(sale()));
  await assertFails(signup(as('u2', 'other@x.com'), 'u2', '+260970000001', 'other@x.com'));
  for (const [i, e] of ['bobsmith@gmail.com', 'b.o.b.smith@gmail.com', 'bobsmith+shop@gmail.com', 'BOBSMITH@googlemail.com'].entries())
    await assertFails(signup(as('v' + i, e), 'v' + i, '+26097000010' + i, e));
  await assertFails(signup(as('u1b', 'Bob.Smith@gmail.com'), 'u1b', '+260970000099', 'Bob.Smith@gmail.com'));
  await assertSucceeds(signup(as('u3', 'carol@x.com'), 'u3', '+260970000003', 'carol@x.com'));
});

test('trials: a repeat signup falls back to a subscription-only (noTrial) account', async () => {
  await assertSucceeds(signup(as('u1', 'bob@x.com'), 'u1', '+260970000001', 'bob@x.com'));
  const db = as('u2', 'bob2@x.com');
  await assertSucceeds(noTrialAcct(db, 'u2', '+260970000001', 'bob2@x.com'));
  await assertFails(db.doc('users/u2/sales/s').set(sale()));
  await assertSucceeds(asAdmin().doc('users/u2/meta/account').update({ paidUntil: TS.fromMillis(Date.now() + 30 * DAY) }));
  await assertSucceeds(db.doc('users/u2/sales/s').set(sale()));
  // an account with a fresh trial cannot be created without claiming the trial keys
  await assertFails(as('u4', 'dave@x.com').doc('users/u4/meta/account').set({ start: FV.serverTimestamp(), phone: '+260970000044', email: 'dave@x.com' }));
  // a client cannot take, delete or read someone else's trial keys
  await assertFails(as('u5').doc('trials/p_+260970000001').set({ uid: 'u5', t: FV.serverTimestamp() }));
  await assertFails(as('u1', 'bob@x.com').doc('trials/p_+260970000001').delete());
  await assertFails(as('u1', 'bob@x.com').doc('trials/p_+260970000001').get());
  // phone must be a Zambian number, email must match the signed-in email
  await assertFails(signup(as('u6', 'eve@x.com'), 'u6', '12345', 'eve@x.com'));
  await assertFails(signup(as('u7', 'eve2@x.com'), 'u7', '+260970000077', 'someoneelse@x.com'));
});

// ---- error reports ----
test('error reports: any signed-in user may report, only the admin may read', async () => {
  await assertSucceeds(as('a').doc('errors/e1').set({ uid: 'a', t: FV.serverTimestamp(), msg: 'boom', src: 'app.js:1', ua: 'UA', v: 'v27' }));
  await assertFails(as('a').doc('errors/e2').set({ uid: 'someone-else', t: FV.serverTimestamp(), msg: 'boom' }));
  await assertFails(as('a').doc('errors/e3').set({ uid: 'a', t: FV.serverTimestamp(), msg: 'x'.repeat(5000) }));
  await assertFails(anon().doc('errors/e4').set({ uid: 'a', t: FV.serverTimestamp(), msg: 'boom' }));
  await assertFails(as('a').doc('errors/e1').get());
  await assertSucceeds(asAdmin().doc('errors/e1').get());
});
