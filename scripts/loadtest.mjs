// Big-shop load test. Seeds one shop with lots of data in the Firestore EMULATOR and times the same
// queries the app runs. It refuses to run against the real database.
//
//   npm run loadtest            (needs the emulator, see README "Testing")
//   SALES=100000 PRODUCTS=8000 CUSTOMERS=3000 npm run loadtest
//
// What to look at: query time and bytes for "today" (what a shop sees on open) versus "month" (the heaviest
// period the app offers), plus how many documents the app downloads on every launch.
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('Refusing to run: FIRESTORE_EMULATOR_HOST is not set (this test must never touch the real database).'); process.exit(1); }
const N = { sales: +process.env.SALES || 50000, products: +process.env.PRODUCTS || 5000, customers: +process.env.CUSTOMERS || 2000, expenses: +process.env.EXPENSES || 3000 };
initializeApp({ projectId: 'zenta-test' });
const db = getFirestore(undefined, 'default');
const uid = 'bigshop', DAY = 864e5, now = Date.now();
const U = n => db.collection(`users/${uid}/${n}`);
const pick = a => a[Math.floor(Math.random() * a.length)];

const t0 = Date.now();
const bw = db.bulkWriter();
for (let i = 0; i < N.products; i++) bw.set(U('products').doc('p' + i), { t: now, name: 'Product ' + i, qty: 50, cost: 10, price: 15, pack: 0 });
for (let i = 0; i < N.customers; i++) bw.set(U('customers').doc('c' + i), { t: now, name: 'Customer ' + i, phone: '0977' + String(i).padStart(6, '0'), owed: i % 7 ? 0 : 120 });
for (let i = 0; i < N.expenses; i++) bw.set(U('expenses').doc('e' + i), { t: now - Math.random() * 62 * DAY, what: 'Expense ' + i, amt: 50 + (i % 400) });
for (let i = 0; i < N.sales; i++) bw.set(U('sales').doc('s' + i), { t: now - Math.random() * 62 * DAY, item: 'Product ' + (i % N.products), qty: 1 + (i % 4), price: 15, total: 15 * (1 + (i % 4)), mode: pick(['cash', 'cash', 'mtn', 'airtel', 'credit']), cid: '', cname: '', pid: 'p' + (i % N.products), cost: 10 });
await bw.close();
console.log(`Seeded ${N.sales} sales, ${N.products} products, ${N.customers} customers, ${N.expenses} expenses in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

const d0 = new Date(); d0.setHours(0, 0, 0, 0);
const dayAgo = (n) => d0.getTime() - n * DAY;
const month0 = new Date(d0.getFullYear(), d0.getMonth(), 1).getTime();
const timed = async (label, q) => {
  const s = Date.now(), snap = await q.get(), ms = Date.now() - s;
  const kb = Math.round(snap.docs.reduce((a, d) => a + JSON.stringify(d.data()).length, 0) / 1024);
  console.log(`${label.padEnd(34)} ${String(snap.size).padStart(7)} docs  ${String(kb).padStart(7)} KB  ${String(ms).padStart(6)} ms`);
};
await timed('sales: today', U('sales').where('t', '>=', d0.getTime()).orderBy('t', 'desc'));
await timed('sales: this week', U('sales').where('t', '>=', dayAgo(6)).orderBy('t', 'desc'));
await timed('sales: this month', U('sales').where('t', '>=', month0).orderBy('t', 'desc'));
await timed('sales: last 60 days', U('sales').where('t', '>=', dayAgo(60)).orderBy('t', 'desc'));
await timed('expenses: this month', U('expenses').where('t', '>=', month0).orderBy('t', 'desc'));
await timed('products: ALL (every launch)', U('products').orderBy('t', 'desc'));
await timed('customers: ALL (every launch)', U('customers').orderBy('t', 'desc'));
console.log('\nProducts and customers are downloaded in full on every launch (then cached offline). Sales/expenses/payments only for the chosen period.');
