import {initializeApp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {getAuth,signInWithEmailAndPassword,createUserWithEmailAndPassword,sendPasswordResetEmail,EmailAuthProvider,reauthenticateWithCredential,deleteUser,sendEmailVerification,onAuthStateChanged,signOut} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {initializeFirestore,persistentLocalCache,persistentMultipleTabManager,collection,doc,addDoc,setDoc,updateDoc,deleteDoc,writeBatch,onSnapshot,query,orderBy,limit,where,increment,serverTimestamp,collectionGroup,getDocs,Timestamp} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {FIREBASE_CONFIG,TRIAL_DAYS,PRICE,PAY_MTN,PAY_AIRTEL,ADMIN_EMAIL} from './config.js';
import {GUIDE} from './guide.js';
const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db = initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})},'default');
const $ = id => document.getElementById(id);
const K = n => 'K' + (Math.round((+n||0)*100)/100).toLocaleString();
const esc = s => String(s??'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const inc = increment;
const r2 = n => Math.round((+n||0)*100)/100;
const toast = m => { const t=$('toast'); t.textContent=m; t.style.display='block'; setTimeout(()=>t.style.display='none',2200); };
const dstr = t => new Date(t).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
const dayStart = () => { const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); };

let uid, S={sales:[],expenses:[],products:[],customers:[],payments:[],stocklog:[]}, tab='dash', unsubs=[];
const sb = m => $('biz').textContent = m;
// ---------- Error tracking: crashes are saved to the `errors` collection (only the admin can read it) ----------
const APP_V = 'v27';
let errSent=0, errLast='';
function reportError(msg, src){
  try{ msg=String(msg||'').slice(0,590); if(!uid||errSent>=5||msg===errLast) return; errLast=msg; errSent++;
    addDoc(collection(db,'errors'),{uid,t:serverTimestamp(),msg,src:String(src||'').slice(0,290),ua:navigator.userAgent.slice(0,190),v:APP_V}).catch(()=>{}); }catch(_){} }
addEventListener('error', e => reportError(e.message, (e.filename||'').split('/').pop()+':'+e.lineno));
addEventListener('unhandledrejection', e => reportError('Promise: '+((e.reason&&(e.reason.message||e.reason.code))||e.reason), ''));
let acct=null, q='', per='today', started=false, dataUnsubs=[], D={sales:[],expenses:[]}, loadedFor='', retries=0;
function startData(){ if(started) return; started=true; dataUnsubs.forEach(f=>f()); dataUnsubs=[];
  const [a,b]=range(); loadedFor=per+':'+a;
  const cons=n=>{ if(['sales','expenses','payments'].includes(n)){ const c=[where('t','>=',a)]; if(b!==Infinity) c.push(where('t','<',b)); return [...c,orderBy('t','desc')]; }
    return n==='stocklog'?[orderBy('t','desc'),limit(100)]:[orderBy('t','desc')]; };
  Object.keys(S).forEach(n => dataUnsubs.push(onSnapshot(query(col(n),...cons(n)), s => {
    const all=s.docs.map(d=>({id:d.id,...d.data()})); S[n]=all.filter(x=>!x.deleted); D[n]=all.filter(x=>x.deleted); retries=0; render();
  }, e => { started=false; if(access().ok){ sb('NOT SAVING TO CLOUD: '+e.code); if(retries++<5) setTimeout(()=>{ if(uid&&!started&&access().ok) startData(); },6000); } }))); }
function watchAcct(){ unsubs.push(onSnapshot(docRef('meta','account'), s=>{
  if(!s.exists()){ if(!s.metadata.fromCache) createAccount(); return; }
  acct=s.data(); if(!acct.phone && auth.currentUser) updateDoc(docRef('meta','account'),{phone:localStorage.getItem('zenta_phone')||auth.currentUser.email||''}).catch(()=>{}); if(access().ok) startData(); render(); }, e=>sb('NOT SAVING TO CLOUD: '+e.code))); }
// One free trial per phone number and per mailbox (the rules enforce it with the `trials` collection).
// A new account claims both keys in one batch. If either was used before, the account is created
// with noTrial: true and only works once the admin activates a paid month.
const normEmail = e => { let [l,d]=String(e||'').toLowerCase().split('@'); l=(l||'').split('+')[0]; if(d==='googlemail.com') d='gmail.com'; if(d==='gmail.com') l=l.replace(/\./g,''); return l+'@'+d; };
let creating=false;
async function createAccount(){
  if(creating||!auth.currentUser) return; creating=true;
  const email=auth.currentUser.email||'', phone=localStorage.getItem('zenta_phone')||'';
  try{
    if(!/^\+260\d{9}$/.test(phone)) return askPhone();
    const ref=docRef('meta','account'), b=writeBatch(db);
    b.set(doc(db,'trials','p_'+phone),{uid,t:serverTimestamp()});
    b.set(doc(db,'trials','e_'+normEmail(email)),{uid,t:serverTimestamp()});
    b.set(ref,{start:serverTimestamp(),phone,email});
    try{ await b.commit(); }
    catch(e){ if(e.code!=='permission-denied') throw e;
      await setDoc(ref,{start:serverTimestamp(),phone,email,noTrial:true}); }
  }catch(e){ sb('NOT SAVING TO CLOUD: '+(e.code||e.message)); }
  finally{ creating=false; }
}
function askPhone(){
  sheet('Your phone number',[{k:'ph',label:'Phone number, like +260764173141 (needed to start your account)',type:'tel',v:'+260'}], async v=>{
    const ph=v.ph.replace(/\s/g,''); if(!/^\+260\d{9}$/.test(ph)) return toast('Phone must look like +260764173141'), false;
    localStorage.setItem('zenta_phone',ph); creating=false; setTimeout(createAccount,50); },'Continue'); }
function access(){ if(!acct) return {ok:true,left:TRIAL_DAYS,paid:false};
  const now=Date.now(), st=acct.start?acct.start.toMillis():now, pu=acct.paidUntil?acct.paidUntil.toMillis():0;
  if(now<pu) return {ok:true,paid:true,left:Math.ceil((pu-now)/864e5)};
  if(acct.noTrial) return {ok:false,paid:false,left:0,noTrial:true};
  const left=Math.ceil((st+TRIAL_DAYS*864e5-now)/864e5); return {ok:left>0,paid:false,left:Math.max(left,0)}; }
const PER=[['today','Today'],['yesterday','Yesterday'],['week','This week'],['month','This month'],['last','Last month']];
const ML={cash:'Cash',mtn:'MTN Money',airtel:'Airtel Money',bank:'Bank',credit:'Nkongole'};
function range(){ const d=new Date(); d.setHours(0,0,0,0); const t=d.getTime(), D=864e5;
  if(per==='today') return [t,Infinity]; if(per==='yesterday') return [t-D,t];
  if(per==='week') return [t-((d.getDay()+6)%7)*D,Infinity];
  const m=new Date(d.getFullYear(),d.getMonth(),1).getTime();
  return per==='month'?[m,Infinity]:[new Date(d.getFullYear(),d.getMonth()-1,1).getTime(),m]; }
const inR = x => { const [a,b]=range(); return x.t>=a && x.t<b; };
const perSel = () => `<select class="sel" aria-label="Period" onchange="A.per(this.value)">${PER.map(p=>`<option value="${p[0]}" ${p[0]===per?'selected':''}>${p[1]}</option>`).join('')}</select>`;
const col = n => collection(db,'users',uid,n);
const docRef = (n,id) => doc(db,'users',uid,n,id);

// ---------- Auth ----------
const authErr = e => ({'auth/invalid-credential':'Wrong email or password','auth/user-not-found':'No account with this email','auth/wrong-password':'Wrong password','auth/email-already-in-use':'This email already has an account. Tap Sign in','auth/weak-password':'Password must be at least 6 characters','auth/invalid-email':'Check the email address','auth/too-many-requests':'Too many tries. Wait a few minutes','auth/missing-password':'Enter your password'}[e.code]||('Error: '+e.code));
const setMode = m => { $('login').dataset.mode=m; $('tin').classList.toggle('on',m==='in'); $('tup').classList.toggle('on',m==='up'); $('pw').autocomplete=m==='in'?'current-password':'new-password'; };
$('tin').onclick = () => setMode('in'); $('tup').onclick = () => setMode('up');
$('eye').onclick = () => { const p=$('pw'), show=p.type==='password'; p.type=show?'text':'password'; $('eye').setAttribute('aria-label',show?'Hide password':'Show password'); $('eye').style.color=show?'var(--g)':''; };
['em','pw','ph'].forEach(id => $(id).addEventListener('keydown', e => { if(e.key==='Enter') ($('login').dataset.mode==='in'?$('send'):$('signup')).click(); }));
$('send').onclick = async () => { try{ await signInWithEmailAndPassword(auth,$('em').value.trim(),$('pw').value); }catch(e){ toast(authErr(e)); } };
$('signup').onclick = async () => { const ph=$('ph').value.trim().replace(/\s/g,''); if(!/^\+260\d{9}$/.test(ph)) return toast('Phone must look like +260764173141');
  try{ localStorage.setItem('zenta_phone',ph); await createUserWithEmailAndPassword(auth,$('em').value.trim(),$('pw').value); }catch(e){ toast(authErr(e)); } };
$('forgot').onclick = async e => { e.preventDefault(); const m=$('em').value.trim(); if(!m) return toast('Type your email first');
  try{ await sendPasswordResetEmail(auth,m); toast('Reset link sent. Check your email'); }catch(x){ toast(authErr(x)); } };
onAuthStateChanged(auth, u => {
  unlocked=false; bad=0; ownerHash=''; settingsReady=false; bizName='';
  unsubs.forEach(f=>f()); unsubs=[]; dataUnsubs.forEach(f=>f()); dataUnsubs=[]; started=false; acct=null;
  if(!u){ uid=null; $('app').style.display='none'; $('login').style.display='flex'; return; }
  uid=u.uid; $('login').style.display='none'; $('app').style.display='block';
  watchAcct(); watchSettings();
  buildNav(); render();
});
  // ---------- Sheet (bottom form) ----------
function sheet(title, fields, onSave, saveLabel='Save'){
  $('sin').innerHTML = `<h2 style="margin-top:0">${title}</h2>` + fields.map(f =>
    `<label>${f.label}</label>` + (f.opts
      ? `<select id="f_${f.k}">${f.opts.map(o=>`<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('')}</select>`
      : `<input id="f_${f.k}" type="${f.type||'text'}" ${f.type==='number'?'inputmode="decimal" min="0" step="any"':''} value="${esc(f.v??'')}">`)).join('') +
    `<button id="ok" style="width:100%">${saveLabel}</button><button class="sec" id="no" style="width:100%;margin-top:8px">Cancel</button>`;
  $('sheet').style.display='flex';
  $('no').onclick = closeSheet;
  $('ok').onclick = async () => {
    const btn=$('ok'); if(btn.disabled) return; const v={}; fields.forEach(f=>v[f.k]=$('f_'+f.k).value.trim());
    btn.disabled=true; const lbl=btn.textContent; btn.textContent='Saving…';
    try{ const r=await Promise.race([onSave(v), new Promise(res=>setTimeout(()=>res('slow'),1500))]);
      if(r==='slow'){ toast('Saved on this phone. It will sync when you are online'); closeSheet(); } else if(r!==false) closeSheet();
    }catch(e){ toast('Error: '+e.message); }
    btn.disabled=false; btn.textContent=lbl;
  };
}
const isAdmin = () => auth.currentUser && (auth.currentUser.email||'').toLowerCase() === ADMIN_EMAIL.toLowerCase();
let ADM = {};
async function admin(){
  $('sin').innerHTML='<h2 style="margin-top:0">Subscribers</h2><p>Loading…</p>'; $('sheet').style.display='flex';
  try{ const q=await getDocs(collectionGroup(db,'meta')), now=Date.now(), rows=[]; ADM={};
    q.forEach(d=>{ if(d.id!=='account') return; const a=d.data(); if(!a.phone && !a.email) return; const uid=d.ref.parent.parent.id,
      st=a.start?a.start.toMillis():now, pu=a.paidUntil?a.paidUntil.toMillis():0, tl=a.noTrial?0:Math.ceil((st+TRIAL_DAYS*864e5-now)/864e5);
      const k=now<pu?'paid':tl>0?'trial':'expired'; ADM[uid]=pu;
      rows.push({uid,k,st,em:(a.email||'').toLowerCase(),ph:(a.phone||'').replace(/[^\d]/g,''),phone:((a.phone||'')+(a.email?' · '+a.email:''))||uid.slice(0,8),txt:k==='paid'?`Paid · ${Math.ceil((pu-now)/864e5)} days left`:k==='trial'?`Trial · ${tl} days left`:a.noTrial?'No free trial (already used) · waiting for payment':'Expired'}); });
    const pc={}; rows.forEach(r=>{ if(r.ph) pc[r.ph]=(pc[r.ph]||0)+1; });
    const latest={}; rows.forEach(r=>{ if(r.em&&(!latest[r.em]||r.st>latest[r.em].st)) latest[r.em]=r; });
    const list=rows.filter(r=>!r.em||latest[r.em]===r);
    const n=k=>list.filter(r=>r.k===k).length;
    $('sin').innerHTML=`<h2 style="margin-top:0">Subscribers (${list.length})</h2><p style="color:var(--mute);margin-bottom:10px">Paid ${n('paid')} · Trial ${n('trial')} · Expired ${n('expired')} · Monthly income about K${n('paid')*PRICE}</p>`+
      (list.map(r=>`<div class="row"><div>${esc(r.phone)}<small class="${r.k==='expired'?'neg':''}">${r.txt}${pc[r.ph]>1?` · ⚠ ${pc[r.ph]} accounts share this phone (possible trial reset)`:''}</small></div><button class="sm" onclick="A.extend('${r.uid}')">+30 days</button></div>`).join('')||'<div class="empty">No subscribers yet.</div>')+
      '<button class="sec" style="width:100%;margin-top:8px" onclick="A.close()">Close</button>';
  }catch(e){ $('sin').innerHTML='<h2>Subscribers</h2><p>Could not load: '+esc(e.code||e.message)+'</p><button class="sec" style="width:100%" onclick="A.close()">Close</button>'; }
}
async function showErrors(){
  $('sin').innerHTML='<h2 style="margin-top:0">App errors</h2><p>Loading…</p>'; $('sheet').style.display='flex';
  try{ const s=await getDocs(query(collection(db,'errors'),orderBy('t','desc'),limit(30)));
    $('sin').innerHTML='<h2 style="margin-top:0">App errors (latest 30)</h2>'+(s.docs.map(d=>{ const e=d.data(); return `<div class="row" style="display:block"><b>${esc(e.msg)}</b><small>${esc(e.src||'')} · ${esc(e.v||'')} · ${e.t?new Date(e.t.toMillis()).toLocaleString('en-GB'):''} · ${esc((e.uid||'').slice(0,6))}</small><small>${esc(e.ua||'')}</small></div>`; }).join('')||'<div class="empty">No errors reported.</div>')+'<button class="sec" style="width:100%;margin-top:8px" onclick="A.close()">Close</button>';
  }catch(e){ $('sin').innerHTML='<h2>App errors</h2><p>Could not load: '+esc(e.code||e.message)+'</p><button class="sec" style="width:100%" onclick="A.close()">Close</button>'; } }
async function extend(uid){ if(!confirm('Add 30 days for this subscriber?')) return;
  try{ await updateDoc(doc(db,'users',uid,'meta','account'),{paidUntil:Timestamp.fromMillis(Math.max(Date.now(),ADM[uid]||0)+30*864e5)}); toast('Activated'); admin(); }catch(e){ toast('Error: '+e.code); } }
const pinKey = () => 'zenta_pin_'+uid;
async function hash(p){ const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(uid+':'+p)); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''); }
let unlocked=false, bad=0, hiddenAt=0;
function checkPin(){ const need=uid && localStorage.getItem(pinKey()) && !unlocked; $('pinlock').style.display=need?'block':'none';
  if(need){ $('pinin').value=''; setTimeout(()=>$('pinin').focus(),50); } }
$('pinin').oninput = async () => { const v=$('pinin').value; if(v.length<4) return;
  if(await hash(v)===localStorage.getItem(pinKey())){ unlocked=true; bad=0; localStorage.removeItem('zenta_bad'); $('pinmsg').textContent=''; checkPin(); }
  else { bad=(+localStorage.getItem('zenta_bad')||0)+1; localStorage.setItem('zenta_bad',bad); $('pinin').value=''; if(bad>=5){ localStorage.removeItem(pinKey()); localStorage.removeItem('zenta_bad'); signOut(auth); } else $('pinmsg').textContent='Wrong PIN. '+(5-bad)+' tries left'; } };
$('pinforgot').onclick = e => { e.preventDefault(); localStorage.removeItem(pinKey()); unlocked=false; signOut(auth); };
document.addEventListener('visibilitychange',()=>{ if(!document.hidden && uid && started){ const [x]=range(); if(loadedFor!==per+':'+x){ started=false; startData(); } } });
document.addEventListener('visibilitychange',()=>{ if(document.hidden) hiddenAt=Date.now(); else if(hiddenAt && Date.now()-hiddenAt>30000){ unlocked=false; checkPin(); } });
function setPin(){
  if(localStorage.getItem(pinKey())) sheet('Turn off app PIN',[{k:'p',label:'Enter your current PIN',type:'password'}], async v=>{
    if(await hash(v.p)!==localStorage.getItem(pinKey())) return toast('Wrong PIN'), false; localStorage.removeItem(pinKey()); toast('PIN turned off'); render(); });
  else sheet('Set a 4-digit PIN',[{k:'p',label:'New PIN (4 digits)',type:'password'},{k:'q',label:'Repeat PIN',type:'password'}], async v=>{
    if(!/^\d{4}$/.test(v.p)) return toast('PIN must be 4 digits'), false; if(v.p!==v.q) return toast('PINs do not match'), false;
    localStorage.setItem(pinKey(), await hash(v.p)); unlocked=true; toast('PIN saved'); render(); }); }
function showDeleted(){
  const replaced=new Set(S.sales.map(x=>x.editOf).filter(Boolean));   // originals replaced by an edit are not restorable
  const L=[...D.sales.filter(x=>!replaced.has(x.id)).map(x=>({n:'sales',x,t:`Sale: ${x.item} × ${x.qty} · ${K(x.total)}`})),...D.expenses.map(x=>({n:'expenses',x,t:`Expense: ${x.what} · ${K(x.amt)}`})),...(D.products||[]).map(x=>({n:'products',x,t:`Product: ${x.name}`})),...(D.customers||[]).map(x=>({n:'customers',x,t:`Customer: ${x.name}`}))].sort((a,b)=>(b.x.delAt||0)-(a.x.delAt||0));
  $('sin').innerHTML='<h2 style="margin-top:0">Deleted entries</h2>'+(L.map(r=>`<div class="row"><div>${esc(r.t)}<small>Deleted ${dstr(r.x.delAt||r.x.t)}</small></div><button class="sm" onclick="A.restore('${r.n}','${r.x.id}')">Restore</button></div>`).join('')||'<div class="empty">Nothing deleted.</div>')+'<button class="sec" style="width:100%;margin-top:8px" onclick="A.close()">Close</button>';
  $('sheet').style.display='flex'; }
const prodOf = s => S.products.find(x=>x.id===s.pid)||S.products.find(x=>x.name===s.item);
function delSale(id){ const s=S.sales.find(x=>x.id===id); if(!s) return; if(s.returnedQty>0) return toast('This sale has a return. Delete the return first.'); askOwner(()=>{
  if(!confirm('Move this sale to Deleted? The stock and any Nkongole will be put back.')) return;
  const b=writeBatch(db), p=prodOf(s); b.update(docRef('sales',id),{deleted:true,delAt:Date.now()});
  if(p) b.update(docRef('products',p.id),{qty:inc(s.qty)}); if(s.mode==='credit'&&s.cid) b.update(docRef('customers',s.cid),{owed:inc(-s.total)});
  b.commit(); toast('Sale moved to Deleted'); }); }
// Edit a sale = reverse the old one and write a corrected one, in a single batch.
// The original is kept (moved to Deleted, hidden from restore) and the new sale points back to it with editOf,
// so the books stay append-only and the stock and Nkongole always balance.
function editSale(id){
  const s=S.sales.find(x=>x.id===id); if(!s||s.ret) return;
  if(s.returnedQty>0) return toast('This sale has a return. Delete the return first.');
  askOwner(()=>{
    const p=prodOf(s);
    sheet('Edit sale: '+esc(s.item),[
      {k:'qty',label:'Quantity (pieces)',type:'number',v:s.qty},
      {k:'price',label:'Price each (K)',type:'number',v:s.price},
      {k:'cid',label:'Customer',opts:[['','Walk-in customer'],...S.customers.map(c=>[c.id,c.name])]},
      {k:'mode',label:'Payment',opts:[['cash','Cash'],['mtn','MTN Money'],['airtel','Airtel Money'],['bank','Bank'],['credit','Nkongole (pay later)']]}
    ], async v=>{
      const qty=+v.qty, price=+v.price;
      if(!(qty>0)||!(price>0)) return toast('Quantity and price must be more than 0'), false;
      if(v.mode==='credit'&&!v.cid) return toast('Choose a customer for Nkongole'), false;
      const total=r2(qty*price), c=S.customers.find(x=>x.id===v.cid), b=writeBatch(db);
      b.update(docRef('sales',id),{deleted:true,delAt:Date.now()});
      if(p) b.update(docRef('products',p.id),{qty:inc(s.qty-qty)});                       // give back the old pieces, take the new ones
      if(s.mode==='credit'&&s.cid) b.update(docRef('customers',s.cid),{owed:inc(-s.total)});
      if(v.mode==='credit') b.update(docRef('customers',v.cid),{owed:inc(total)});
      b.set(doc(col('sales')),{t:s.t,item:s.item,qty,price,total,mode:v.mode,cid:v.cid||'',cname:c?c.name:'',pid:s.pid||'',cost:s.cost||0,packs:0,packPrice:0,editOf:id});
      b.set(doc(col('stocklog')),{t:Date.now(),name:s.item,txt:'Sale edited · '+s.qty+' × '+K(s.price)+' → '+qty+' × '+K(price)});
      await b.commit(); toast('Sale corrected');
    },'Save changes');
    $('f_cid').value=s.cid||''; $('f_mode').value=s.mode||'cash';
    if(s.packs>0) $('sin').insertAdjacentHTML('afterbegin','<p style="color:var(--mute);margin-bottom:10px">This was a pack sale. After editing it is recorded in single pieces.</p>');
  }); }
function custHistory(id){
  const c=S.customers.find(x=>x.id===id); if(!c) return;
  const pl=PER.find(p=>p[0]===per)[1];
  const rows=[...S.sales.filter(x=>x.cid===id&&x.mode==='credit'&&inR(x)).map(x=>({t:x.t,txt:(x.ret?'↩ Return · ':'Nkongole sale · ')+x.item+' × '+Math.abs(x.qty),amt:x.total,cr:true})),
              ...S.payments.filter(x=>x.cid===id&&inR(x)).map(x=>({t:x.t,txt:'Payment received'+(x.mode?' · '+(ML[x.mode]||x.mode):''),amt:-x.amt}))].sort((a,b)=>b.t-a.t);
  $('sin').innerHTML=`<h2 style="margin-top:0">${esc(c.name)}</h2><p style="margin-bottom:10px">Owes <b>${K(c.owed)}</b> now</p><p style="color:var(--mute);margin-bottom:10px;font-size:13px">Showing: ${pl}. Change the period on the Sales tab to see older entries.</p>`+
    (rows.map(r=>`<div class="row"><div>${esc(r.txt)}<small>${dstr(r.t)}</small></div><span class="amt ${r.cr?'cr':''}">${r.amt<0?'−':'+'}${K(Math.abs(r.amt))}</span></div>`).join('')||'<div class="empty">Nothing in this period.</div>')+
    '<button class="sec" style="width:100%;margin-top:8px" onclick="A.close()">Close</button>';
  $('sheet').style.display='flex'; }
const restore = (n,id) => { const s=n==='sales'?D.sales.find(x=>x.id===id):null;
  if(s){ const b=writeBatch(db), p=prodOf(s); b.update(docRef('sales',id),{deleted:false,delAt:null});
    if(p) b.update(docRef('products',p.id),{qty:inc(-s.qty)}); if(s.mode==='credit'&&s.cid) b.update(docRef('customers',s.cid),{owed:inc(s.total)}); b.commit(); }
  else updateDoc(docRef(n,id),{deleted:false,delAt:null});
  toast('Restored'); setTimeout(showDeleted,500); };
let ownerHash='', settingsReady=false, bizName='';
let ownerUntil=0, lockT=0;
const isUnlocked = () => !ownerHash || Date.now()<ownerUntil;
const V = x => isUnlocked()?K(x):'🔒';
function unlockOwner(){ askOwner(()=>{ ownerUntil=Date.now()+5*60000; clearTimeout(lockT); lockT=setTimeout(lockOwner,5*60000); render(); }); }
function lockOwner(){ ownerUntil=0; render(); }
const ownerBtn = () => ownerHash?`<button class="sec sm" style="margin:0 0 10px" onclick="A.${isUnlocked()?'lockO':'unlockO'}()">${isUnlocked()?'🔓 Hide owner numbers':'🔒 Show owner numbers (PIN)'}</button>`:'';
document.addEventListener('visibilitychange',()=>{ if(document.hidden) ownerUntil=0; else if(uid) render(); });
const ohash = p => hash('owner:'+p);
const saveOwner = h => setDoc(docRef('private','settings'),{owner:h},{merge:true});
function watchSettings(){ unsubs.push(onSnapshot(docRef('private','settings'), s=>{ ownerHash=s.exists()?(s.data().owner||''):''; bizName=s.exists()?(s.data().biz||''):''; settingsReady=true; render(); }, e=>sb('NOT SAVING TO CLOUD: '+e.code))); }
function askOwner(cb){
  if(!settingsReady) return toast('Please wait a moment and try again');
  if(!ownerHash) return cb();
  sheet('Owner PIN',[{k:'p',label:'Enter the owner PIN',type:'password'}], async v=>{
    if(await ohash(v.p)!==ownerHash){ toast('Wrong owner PIN'); return false; } setTimeout(cb,50); },'Confirm');
  $('sin').insertAdjacentHTML('beforeend','<p style="text-align:center;margin-top:12px"><a href="#" id="of">Forgot owner PIN?</a></p>');
  $('of').onclick = e => { e.preventDefault(); forgotOwner(); }; }
function forgotOwner(){
  sheet('Reset owner PIN',[{k:'pw',label:'Your account password (staff do not have this)',type:'password'},{k:'p',label:'New 4-digit owner PIN',type:'password'}], async v=>{
    if(!/^\d{4}$/.test(v.p)) return toast('PIN must be 4 digits'), false;
    try{ await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, v.pw)); }catch(e){ toast('Wrong account password'); return false; }
    await saveOwner(await ohash(v.p)); toast('Owner PIN reset'); },'Reset PIN'); }
function setOwner(){
  if(ownerHash) return askOwner(()=>sheet('Change or turn off owner PIN',[{k:'p',label:'New 4-digit PIN (leave empty to turn off)',type:'password'}], async v=>{
    if(!v.p){ await saveOwner(''); toast('Owner PIN turned off'); return; }
    if(!/^\d{4}$/.test(v.p)) return toast('PIN must be 4 digits'), false; await saveOwner(await ohash(v.p)); toast('Owner PIN changed'); }));
  if(!settingsReady) return toast('Please wait a moment and try again');
  sheet('Set owner PIN',[{k:'p',label:'Owner PIN (4 digits, keep it secret)',type:'password'},{k:'q',label:'Repeat PIN',type:'password'}], async v=>{
    if(!/^\d{4}$/.test(v.p)) return toast('PIN must be 4 digits'), false; if(v.p!==v.q) return toast('PINs do not match'), false;
    await saveOwner(await ohash(v.p)); toast('Owner PIN saved'); }); }
const has = (t,x) => String(t||'').toLowerCase().includes(x.toLowerCase());
const pRows = () => list(S.products.filter(p=>has(p.name,q)).slice(0,CAP*2),p=>`<div class="row"><div>${esc(p.name)}<small>${isUnlocked()?(p.cost>0?'Cost '+K(p.cost):'<span class="neg">No cost price</span>')+' · ':''}Sells ${K(p.price)}${isUnlocked()&&p.price>0&&p.cost>p.price?' · <span class="neg">check cost</span>':''}</small></div><div><span class="amt ${p.qty<=(p.low??3)?'neg':''}">${p.qty}</span> <button class="sec sm" onclick="A.restock('${p.id}')">+ Stock</button> <button class="sec sm" onclick="A.editProduct('${p.id}')">Edit</button></div></div>`,'No products found.');
const cRows = () => list(S.customers.filter(c=>has(c.name,q)||has(c.phone,q)).slice(0,CAP*2),c=>`<div class="row"><div>${esc(c.name)}<small>${esc(c.phone||'')}</small></div><div><span class="amt ${c.owed>0?'cr':''}">${K(c.owed)}</span> ${c.owed>0?`<button class="sm" onclick="A.receive('${c.id}')">Paid</button>`:''} <button class="sec sm" onclick="A.custHistory('${c.id}')">History</button> <button class="sec sm" onclick="A.editCustomer('${c.id}')">Edit</button></div></div>`,'No customers found.');
function editProduct(id){ const p=S.products.find(x=>x.id===id);
  sheet('Edit product',[{k:'name',label:'Name',v:p.name},{k:'qty',label:'Quantity in stock (pieces)',type:'number',v:p.qty},{k:'cost',label:'Cost price of ONE piece (K)',type:'number',v:p.cost},{k:'price',label:'Selling price of ONE piece (K)',type:'number',v:p.price},...packFields(p),{k:'low',label:'Warn me when stock is at or below',type:'number',v:p.low??3}], async v=>{
    if(!v.name) return toast('Enter a name'), false;
    if(+v.qty<0||+v.cost<0||+v.price<0) return toast('Numbers cannot be negative'), false;
    const nq=+v.qty||0,nc=costOf(v),np=+v.price||0,ch=[]; if(!okCost(nc,np)) return false;
    if(v.name!==p.name) ch.push('name: '+p.name+' → '+v.name); if(nq!==p.qty) ch.push('quantity: '+p.qty+' → '+nq);
    if(nc!==p.cost) ch.push('cost: '+K(p.cost)+' → '+K(nc)); if(np!==p.price) ch.push('price: '+K(p.price)+' → '+K(np));
    const b=writeBatch(db); b.update(docRef('products',id),{name:v.name,qty:nq,cost:nc,price:np,pack:+v.packSize||0,low:+v.low||0});
    if(ch.length) b.set(doc(col('stocklog')),{t:Date.now(),name:v.name,txt:'Edited · '+ch.join(', ')});
    await b.commit(); toast('Product updated'); });
  $('sin').insertAdjacentHTML('beforeend','<button class="sec" id="dl" style="width:100%;margin-top:8px;color:var(--red)">Delete product</button>');
  $('dl').onclick=()=>{ closeSheet(); if(confirm('Delete this product? You can restore it from Deleted entries.')) updateDoc(docRef('products',id),{deleted:true,delAt:Date.now()}).then(()=>toast('Moved to Deleted')); }; }
function editCustomer(id){ const c=S.customers.find(x=>x.id===id);
  sheet('Edit customer',[{k:'name',label:'Name',v:c.name},{k:'phone',label:'Phone',type:'tel',v:c.phone}], async v=>{
    if(!v.name) return toast('Enter a name'), false; await updateDoc(docRef('customers',id),{name:v.name,phone:v.phone}); toast('Customer updated'); });
  $('sin').insertAdjacentHTML('beforeend','<button class="sec" id="dl" style="width:100%;margin-top:8px;color:var(--red)">Delete customer</button>');
  $('dl').onclick=()=>{ if(c.owed>0) return toast('This customer still owes '+K(c.owed)); closeSheet(); askOwner(()=>{ if(confirm('Delete this customer? You can restore them from Deleted entries.')) updateDoc(docRef('customers',id),{deleted:true,delAt:Date.now()}).then(()=>toast('Moved to Deleted')); }); }; }
function showLog(){ $('sin').innerHTML='<h2 style="margin-top:0">Stock changes</h2>'+(S.stocklog.slice(0,100).map(l=>`<div class="row"><div>${esc(l.name)}<small>${esc(l.txt)}</small></div><small>${dstr(l.t)}</small></div>`).join('')||'<div class="empty">No changes recorded yet.</div>')+'<button class="sec" style="width:100%;margin-top:8px" onclick="A.close()">Close</button>'; $('sheet').style.display='flex'; }
function setBiz(){ sheet('Business name',[{k:'n',label:'Your shop name (shown on receipts)',v:bizName}], async v=>{
  if(!v.n) return toast('Enter a name'), false; await setDoc(docRef('private','settings'),{biz:v.n},{merge:true}); bizName=v.n; toast('Saved'); render(); }); }
function receipt(id){ const s=S.sales.find(x=>x.id===id); if(!s) return;
  const go=()=>{ const c=S.customers.find(x=>x.id===s.cid);
    const d=new Date(s.t).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
    const L=['*'+bizName+'*','Receipt',d,'------------------',(s.packs>0?s.item+' × '+s.packs+(s.packs>1?' packs':' pack')+' @ '+K(s.packPrice):s.item+' × '+s.qty+' @ '+K(s.price)),'*Total: '+K(s.total)+'*','Paid by: '+(s.mode==='credit'?'Nkongole (not yet paid)':(ML[s.mode]||'Cash'))];
    if(s.mode==='credit'&&c) L.push('Balance owed: '+K(c.owed));
    L.push('','Thank you!'); const txt=L.join('\n');
    let num=c&&c.phone?c.phone.replace(/[^\d]/g,''):''; if(num.startsWith('0')) num='260'+num.slice(1);
    const url='https://wa.me/'+num+'?text='+encodeURIComponent(txt);
    $('sin').innerHTML='<h2 style="margin-top:0">Receipt</h2><div class="row" style="white-space:pre-wrap;display:block">'+esc(txt)+'</div><a class="btn" style="display:block;text-align:center;text-decoration:none" href="'+url+'" target="_blank" rel="noopener">Send on WhatsApp</a><button class="sec" id="cp" style="width:100%;margin-top:8px">Copy text</button><button class="sec" style="width:100%;margin-top:8px" onclick="A.close()">Close</button>';
    $('sheet').style.display='flex'; $('cp').onclick=()=>{ if(navigator.clipboard) navigator.clipboard.writeText(txt).then(()=>toast('Copied')); }; };
  if(bizName) go(); else sheet('Business name',[{k:'n',label:'Your shop name (shown on receipts)'}], async v=>{
    if(!v.n) return toast('Enter a name'), false; await setDoc(docRef('private','settings'),{biz:v.n},{merge:true}); bizName=v.n; setTimeout(go,50); }); }
const csvText = rows => '\ufeff'+rows.map(r=>r.map(c=>{ c=String(c??''); return /[",\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c; }).join(',')).join('\n');
function showExport(){ const pl=PER.find(p=>p[0]===per)[1];
  $('sin').innerHTML='<h2 style="margin-top:0">Export to Excel</h2><p style="color:var(--mute);margin-bottom:12px">Sales and expenses use the period selected on this screen: <b>'+pl+'</b>.</p><button style="width:100%;margin-bottom:8px" onclick="A.csv(\'sales\')">Sales</button><button style="width:100%;margin-bottom:8px" onclick="A.csv(\'expenses\')">Expenses</button><button style="width:100%;margin-bottom:8px" onclick="A.csv(\'stock\')">Stock list (now)</button><button class="sec" style="width:100%" onclick="A.close()">Close</button>';
  $('sheet').style.display='flex'; }
async function exportCsv(kind){
  const d=t=>new Date(t).toLocaleString('en-GB'); let rows;
  if(kind==='sales') rows=[['Date','Item','Quantity','Price','Total','Payment','Customer'],...S.sales.filter(inR).map(x=>[d(x.t),x.item,x.qty,x.price,x.total,ML[x.mode]||'Cash',x.cname||''])];
  else if(kind==='expenses') rows=[['Date','What for','Amount'],...S.expenses.filter(inR).map(x=>[d(x.t),x.what,x.amt])];
  else rows=[['Product','Quantity','Cost price','Selling price','Stock value'],...S.products.map(p=>[p.name,p.qty,p.cost,p.price,p.qty*p.cost])];
  const file=new File([csvText(rows)],'zenta-'+kind+(kind==='stock'?'':'-'+per)+'.csv',{type:'text/csv'});
  if(navigator.canShare && navigator.canShare({files:[file]})){ try{ await navigator.share({files:[file],title:file.name}); return; }catch(e){ if(e.name==='AbortError') return; } }
  const a=document.createElement('a'); a.href=URL.createObjectURL(file); a.download=file.name; document.body.appendChild(a); a.click(); a.remove(); toast('Saved to Downloads'); }
let gi=0;
function showGuide(i){ gi=i; const g=GUIDE[i], last=i===GUIDE.length-1, n=GUIDE.length, G=$('guide');
  G.style.setProperty('--ga',g.c[0]); G.style.setProperty('--gb',g.c[1]); G.style.setProperty('--gs',g.c[2]);
  const dots=GUIDE.map((_,k)=>`<i class="${k===i?'on':''}"></i>`).join('');
  G.innerHTML=`<div class="gw"><div class="gstage"><i class="gb1"></i><i class="gb2"></i><div class="gtop"><span>${i+1} of ${n}</span>${last?'<span style="visibility:hidden"></span>':'<a href="#" onclick="A.gend(false);return false">Skip</a>'}</div>${g.art()}</div>
   <div class="gpanel"><h1>${g.t}</h1><p>${g.x}</p><div class="dots">${dots}</div>
   <div class="gbtn">`+(last?`<button onclick="A.gend(true)">Add my first product</button><button class="o" onclick="A.gend(false)">I will look around</button>`
    :`<button onclick="A.gnav(${i+1})">${i?'Next':'Get started'}</button>`+(i?`<button class="o" onclick="A.gnav(${i-1})">Back</button>`:''))+`</div></div></div>`;
  G.style.display='block'; }
(()=>{ let x0=null; const el=$('guide');
  el.addEventListener('touchstart',e=>{ x0=e.touches[0].clientX; },{passive:true});
  el.addEventListener('touchend',e=>{ if(x0===null) return; const d=e.changedTouches[0].clientX-x0; x0=null;
    if(d<-60 && gi<GUIDE.length-1) showGuide(gi+1); else if(d>60 && gi>0) showGuide(gi-1); },{passive:true}); })();
function endGuide(go){ localStorage.setItem('zenta_guide_'+uid,'1'); $('guide').style.display='none'; if(go){ tab='stock'; render(); addProduct(); } }
function deleteAccount(){
    sheet('Delete my account',[{k:'pw',label:'This permanently deletes ALL your records. If it fails partway, sign in and run it again to finish. Enter your password to confirm',type:'password'}], async v=>{
     try{ await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, v.pw)); }catch(e){ toast('Wrong password'); return false; }
     try{ unsubs.forEach(f=>f()); dataUnsubs.forEach(f=>f());
       for(const n of ['private','sales','expenses','products','customers','payments','stocklog']){
        const q=await getDocs(col(n));
        for(let i=0;i<q.docs.length;i+=400){ const b=writeBatch(db); q.docs.slice(i,i+400).forEach(d=>b.delete(d.ref)); await b.commit(); } }
      await updateDoc(docRef('meta','account'),{phone:'',email:''});
      await deleteUser(auth.currentUser); toast('Your account was deleted');
    }catch(e){ toast('Could not finish: '+(e.code||e.message)); return false; } },'Delete everything'); }
function returnSale(id){
  const s=S.sales.find(x=>x.id===id); if(!s||s.ret) return; const left=s.qty-(s.returnedQty||0); if(left<=0) return toast('This sale was already returned');
  sheet('Return or exchange: '+esc(s.item),[{k:'q',label:'Quantity coming back (up to '+left+')',type:'number',v:left},
    {k:'kind',label:'What does the customer want?',opts:[['ex','Exchange for another item'],['refund','Money back (owner PIN)']]},
    {k:'npid',label:'New item (for an exchange)',opts:[['','Choose item'],...S.products.map(p=>[p.id,p.name+' ('+p.qty+' left) K'+p.price])]},
    {k:'nq',label:'New item quantity',type:'number',v:1},{k:'why',label:'Reason (optional)'}], async v=>{
    const q=+v.q; if(!(q>0)||q>left) return toast('Quantity must be between 1 and '+left), false;
    const np=v.kind==='ex'?S.products.find(x=>x.id===v.npid):null, nq=+v.nq||0;
    if(v.kind==='ex'&&(!np||!(nq>0))) return toast('Choose the new item and quantity'), false;
    const needsOwner = v.kind==='refund' || q*s.price>nq*(np?np.price:0);
    const run=()=>doReturn(s,q,v.kind,np,nq,v.why||'');
    if(needsOwner&&!isUnlocked()){ setTimeout(()=>askOwner(run),50); return; }
    await run(); },'Save'); }
async function doReturn(s,q,kind,np,nq,why){
  if(np&&nq>np.qty&&!confirm('Only '+np.qty+' of '+np.name+' in stock. Continue?')) return;
  const b=writeBatch(db), p=prodOf(s), now=Date.now(), back=r2(q*s.price), nt=np?r2(nq*np.price):0;
  b.set(doc(col('sales')),{t:now,item:s.item,qty:-q,price:s.price,total:-back,mode:s.mode,cid:s.cid||'',cname:s.cname||'',pid:s.pid||'',cost:s.cost||0,ret:true,refOf:s.id,why});
  b.update(docRef('sales',s.id),{returnedQty:inc(q)});
  if(p) b.update(docRef('products',p.id),{qty:inc(q)});
  b.set(doc(col('stocklog')),{t:now,name:s.item,txt:'Returned +'+q+(np?' (exchanged for '+np.name+')':' (money back)')});
  let owedChange=s.mode==='credit'?-back:0;
  if(np){ b.set(doc(col('sales')),{t:now+1,item:np.name,qty:nq,price:np.price,total:nt,mode:s.mode,cid:s.cid||'',cname:s.cname||'',pid:np.id,cost:np.cost||0,exWith:s.id});
    b.update(docRef('products',np.id),{qty:inc(-nq)}); if(s.mode==='credit') owedChange+=nt; }
  if(owedChange&&s.cid) b.update(docRef('customers',s.cid),{owed:inc(owedChange)});
  await b.commit(); toast(np?'Exchange saved':'Return saved'); }
const closeSheet = () => $('sheet').style.display='none';
$('sheet').onclick = e => { if(e.target.id==='sheet') closeSheet(); };

// ---------- Actions ----------
function chipify(id){ const sel=$(id); sel.style.display='none';
  const w=document.createElement('div'); w.className='chips'; sel.after(w);
  const draw=()=>{ w.innerHTML=[...sel.options].map(o=>`<button type="button" class="chip ${o.value===sel.value?'on':''}" data-v="${esc(o.value)}">${esc(o.text)}</button>`).join(''); };
  w.onclick=e=>{ const b=e.target.closest('.chip'); if(b){ sel.value=b.dataset.v; draw(); if(sel.onchange) sel.onchange(); } }; draw(); }
function stepify(id){ const inp=$(id), w=document.createElement('div'); w.className='step'; inp.before(w);
  const m=document.createElement('button'), p=document.createElement('button'); m.type=p.type='button'; m.textContent='−'; p.textContent='+'; m.setAttribute('aria-label','Less'); p.setAttribute('aria-label','More');
  w.append(m,inp,p); m.onclick=()=>{ inp.value=Math.max(1,(+inp.value||1)-1); }; p.onclick=()=>{ inp.value=(+inp.value||0)+1; }; }
function addSale(){
  sheet('New sale',[
    {k:'pid',label:'Product',opts:[['','Other item (type below)'],...S.products.map(p=>[p.id,`${p.name} (${p.qty} left)`])]},
    {k:'item',label:'Item name (if not from stock)'},
    {k:'unit',label:'Selling by',opts:[['pc','Single pieces'],['pack','Whole packs (tray, carton)']]},
    {k:'qty',label:'Quantity',type:'number',v:1},
    {k:'price',label:'Price each (K)',type:'number'},
    {k:'cid',label:'Customer',opts:[['','Walk-in customer'],...S.customers.map(c=>[c.id,c.name])]},
    {k:'mode',label:'Payment',opts:[['cash','Cash'],['mtn','MTN Money'],['airtel','Airtel Money'],['bank','Bank'],['credit','Nkongole (pay later)']]}
  ], async v => {
    const p=S.products.find(x=>x.id===v.pid), packs=(v.unit==='pack'&&p&&p.pack>0)?+v.qty:0;
    if(v.unit==='pack'&&!packs) return toast('Choose a product that has a pack size. Edit the product and set the pieces in one pack.'), false;
    const qty=packs?packs*p.pack:+v.qty, packPrice=packs?(+v.price||r2(p.price*p.pack)):0, price=packs?packPrice/p.pack:(+v.price||(p?p.price:0));
    if(!(qty>0)||!(price>0)) return toast('Quantity and price must be more than 0'), false;
    if(v.mode==='credit' && !v.cid) return toast('Choose a customer for Nkongole'), false;
    if(p && qty>p.qty && !confirm(`Only ${p.qty} in stock. Continue?`)) return false;
    const total=packs?r2(packs*packPrice):r2(qty*price), c=S.customers.find(x=>x.id===v.cid);
    const b=writeBatch(db);
    b.set(doc(col('sales')),{t:Date.now(),item:p?p.name:(v.item||'Sale'),qty,price,total,mode:v.mode,cid:v.cid||'',cname:c?c.name:'',pid:p?p.id:'',cost:p?p.cost:0,packs,packPrice});
    if(p) b.update(docRef('products',p.id),{qty:inc(-qty)});
    if(v.mode==='credit') b.update(docRef('customers',v.cid),{owed:inc(total)});
    await b.commit(); toast('Sale saved');
  });
  chipify('f_mode'); chipify('f_unit'); stepify('f_qty');
  const sel=$('f_pid'); sel.insertAdjacentHTML('beforebegin','<input id="ps" placeholder="Type to search products">');
  const fill=t=>{ const m=S.products.filter(p=>p.name.toLowerCase().includes(t.toLowerCase()));
    sel.innerHTML='<option value="">Other item (type below)</option>'+m.map(p=>`<option value="${p.id}">${esc(p.name)} (${p.qty} left)</option>`).join(''); if(t&&m.length){ sel.value=m[0].id; sel.onchange(); } };
  const setPrice=()=>{ const p=S.products.find(x=>x.id===sel.value); if(p) $('f_price').value=($('f_unit').value==='pack'&&p.pack>0)?r2(p.price*p.pack):p.price; };
  sel.onchange=setPrice; $('f_unit').onchange=setPrice;
  $('ps').oninput=()=>fill($('ps').value);
}
function addExpense(){
  sheet('New expense',[{k:'what',label:'What was it for? (not stock purchases: use + Stock)'},{k:'amt',label:'Amount (K)',type:'number'}], async v=>{
    if(!v.what||!(+v.amt>0)) return toast('Fill in what it was for and an amount above 0'), false;
    await addDoc(col('expenses'),{t:Date.now(),what:v.what,amt:+v.amt}); toast('Expense saved');
  });
}
const packFields = p => [{k:'packPrice',label:'Optional: price of a whole pack/carton (K)',type:'number'},{k:'packSize',label:'Optional: pieces in one pack',type:'number',v:(p&&p.pack)||''}];
const costOf = v => (+v.packPrice>0&&+v.packSize>0) ? Math.round(+v.packPrice/+v.packSize*1000)/1000 : (+v.cost||0);
const okCost = (c,p) => !(p>0&&c>p) || confirm('The cost (K'+c+') is higher than the selling price (K'+p+'). Is that the cost of a whole pack? Costs and prices must be for ONE piece. Save anyway?');
function addProduct(){
  sheet('New product',[{k:'name',label:'Name'},{k:'qty',label:'Quantity in stock (pieces)',type:'number',v:0},{k:'cost',label:'Cost price of ONE piece (K)',type:'number'},{k:'price',label:'Selling price of ONE piece (K)',type:'number'},...packFields()], async v=>{
    if(!v.name) return toast('Enter a name'), false;
    if(+v.qty<0||+v.cost<0||+v.price<0) return toast('Numbers cannot be negative'), false;
    const cost=costOf(v), price=+v.price||0; if(!okCost(cost,price)) return false;
    await addDoc(col('products'),{t:Date.now(),name:v.name,qty:+v.qty||0,cost,price,pack:+v.packSize||0}); toast('Product saved'); });
}
function restock(id){
  const p=S.products.find(x=>x.id===id), f=[{k:'n',label:'Pieces received',type:'number'}];
  if(p.pack>0) f.push({k:'packs',label:'Or packs received (1 pack = '+p.pack+' pieces)',type:'number'});
  sheet('Add stock: '+esc(p.name),f, async v=>{
    const n=(+v.n||0)+(+v.packs||0)*(p.pack||0); if(!(n>0)) return toast('Enter a quantity above 0'), false;
    const b=writeBatch(db); b.update(docRef('products',id),{qty:inc(n)}); b.set(doc(col('stocklog')),{t:Date.now(),name:p.name,txt:'Received +'+n}); await b.commit(); toast('Stock updated'); });
}
function addCustomer(){
  sheet('New customer',[{k:'name',label:'Name'},{k:'phone',label:'Phone',type:'tel'}], async v=>{
    if(!v.name) return toast('Enter a name'), false;
    await addDoc(col('customers'),{t:Date.now(),name:v.name,phone:v.phone,owed:0}); toast('Customer saved');
  });
}
function receive(id){
  const c=S.customers.find(x=>x.id===id);
  sheet(`Payment from ${esc(c.name)} (owes ${K(c.owed)})`,[{k:'amt',label:'Amount received now (K). A part-payment is fine',type:'number'},
    {k:'mode',label:'Paid by',opts:[['cash','Cash'],['mtn','MTN Money'],['airtel','Airtel Money'],['bank','Bank']]}], async v=>{
    const a=r2(v.amt); if(!(a>0)||a>c.owed) return toast('Amount must be up to '+K(c.owed)), false;
    const b=writeBatch(db); b.update(docRef('customers',id),{owed:inc(-a)});
    b.set(doc(col('payments')),{t:Date.now(),cid:id,cname:c.name,amt:a,mode:v.mode}); await b.commit();
    toast(a<c.owed?'Part-payment recorded. Still owes '+K(r2(c.owed-a)):'Fully paid');
  },'Record payment');
  chipify('f_mode');
}
function del(name,id){ askOwner(()=>{ if(confirm('Move this entry to Deleted? You can restore it later.')) updateDoc(docRef(name,id),{deleted:true,delAt:Date.now()}); }); }
let deferred=null; addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); deferred=e; });
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone;
const installBtn=()=>standalone()?'':'<button class="sec" style="width:100%;margin-bottom:10px" onclick="A.install()">Install Zenta on this phone</button>';
function install(){ if(deferred){ deferred.prompt(); deferred=null; return; }
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
  $('sin').innerHTML='<h2 style="margin-top:0">Install Zenta</h2><p style="margin-bottom:14px">'+(ios?'Tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>.':'Open the browser menu (⋮) and tap <b>Install app</b> or <b>Add to Home screen</b>.')+'</p><button class="sec" style="width:100%" onclick="A.close()">Close</button>'; $('sheet').style.display='flex'; }
const verify=()=>sendEmailVerification(auth.currentUser).then(()=>toast('Verification email sent. Open the link, then sign in again')).catch(e=>toast('Error: '+e.code));
window.A={unlockO:unlockOwner,lockO:lockOwner,ret:returnSale,go:t=>{tab=t;q='';shown=CAP;render();},more:()=>{shown+=CAP;render();},install,verify,delSale,delAcct:()=>askOwner(deleteAccount),gnav:showGuide,gend:endGuide,guide:()=>showGuide(0),exportMenu:()=>askOwner(showExport),csv:exportCsv,receipt,setBiz,q:v=>{q=v; $('lst').innerHTML=tab==='stock'?pRows():cRows();},editProduct:id=>askOwner(()=>editProduct(id)),editCustomer,log:()=>askOwner(showLog),setPin,deleted:()=>askOwner(showDeleted),setOwner,restore,admin,extend,close:()=>closeSheet(),per:v=>{per=v; shown=CAP; if(access().ok){ started=false; startData(); } render();},addSale,addExpense,addProduct,restock,addCustomer,receive,del,editSale,custHistory,errors:showErrors,out:()=>signOut(auth)};

// ---------- Views ----------
const TI={dash:`<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/></svg>`,sales:`<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>`,exp:`<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/></svg>`,stock:`<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>`,cust:`<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14a6.5 6.5 0 013.5 6"/></svg>`,more:`<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>`};
const tabs=[['dash','Home'],['sales','Sales'],['exp','Expenses'],['stock','Stock'],['cust','Nkongole'],['more','More']];
function buildNav(){ $('nav').innerHTML=tabs.map(t=>`<a href="#" data-t="${t[0]}">${TI[t[0]]}${t[1]}</a>`).join('');
  $('nav').onclick=e=>{const a=e.target.closest('a'); if(a){e.preventDefault(); tab=a.dataset.t; q=''; shown=CAP; render();}}; }
// Big shops: never draw thousands of rows at once. Lists show CAP rows, with a button for more.
const CAP=100; let shown=CAP;
const moreBtn=n=>n>shown?`<button class="sec" style="width:100%;margin-bottom:12px" onclick="A.more()">Show more (${n-shown} left)</button>`:'';
const sum=(a,f)=>a.reduce((s,x)=>s+(+f(x)||0),0);
const list=(a,fn,msg)=>a.length?a.map(fn).join(''):`<div class="empty">${msg}</div>`;
const fab=(fn,label)=>`<button class="fab" onclick="A.${fn}()">+ ${label}</button>`;

function render(){
  if(!uid) return;
  const y=scrollY, fq=document.activeElement?.id==='q'?document.activeElement.selectionStart:null;
  checkPin();
  const ac=access(); $('lock').style.display=ac.ok?'none':'block'; $('lockmsg').textContent=ac.noTrial?'A free trial was already used with this phone number or email. Your account is ready: subscribe to start using Zenta.':'Your records are safe. Subscribe to keep using Zenta.'; $('ref').textContent=acct&&acct.phone?acct.phone:(auth.currentUser?auth.currentUser.email:'');
  if(ac.ok) sb(ac.paid?`Subscribed · ${ac.left} days left`:`Free trial · ${ac.left} days left`);
  if(ac.ok && !localStorage.getItem('zenta_guide_'+uid) && $('guide').style.display!=='block') showGuide(0);
  document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('on',a.dataset.t===tab));
  const tSales=S.sales.filter(inR), tExp=S.expenses.filter(inR), pl=PER.find(p=>p[0]===per)[1], noCost=S.products.filter(p=>!(p.cost>0)).length, badCost=S.products.filter(p=>p.price>0&&p.cost>p.price).length, negStock=S.products.filter(p=>p.qty<0).length, negBanner=negStock?`<div class="row" onclick="A.go('stock')" style="border-color:var(--red)"><span>⚠️ ${negStock} product(s) show stock below zero (more sold than recorded). Add stock to correct it.</span></div>`:'', banner=negBanner+(isUnlocked()&&(noCost+badCost)?`<div class="row" onclick="A.go('stock')" style="border-color:var(--cu,#C4611F)"><span>⚠️ ${noCost?noCost+' product(s) have no cost price. ':''}${badCost?badCost+' have a cost above the selling price. ':''}Profit may be wrong. Tap to fix.</span></div>`:'');
  const cogs=s=>(+s.qty||0)*(s.cost!==undefined?s.cost:((S.products.find(p=>p.name===s.item)||{}).cost||0)), cg=sum(tSales,cogs), sales=sum(tSales,s=>s.total), exp=sum(tExp,e=>e.amt), owed=sum(S.customers,c=>c.owed), stockV=sum(S.products,p=>p.qty*p.cost);
  const low=S.products.filter(p=>p.qty<=(p.low??3));
  const titles={dash:'Today',sales:'Sales',exp:'Expenses',stock:'Stock',cust:'Customers & Nkongole',more:'Cash flow & more'};
  $('ttl').textContent=titles[tab]; let h='';
  if(tab==='dash') h=`<div>${perSel()}</div>${ownerBtn()}${banner}<div class="hero"><small>Sales · ${pl}</small><div class="big">${K(sales)}</div><div class="sub"><div><small>Profit</small><b>${V(sales-cg-exp)}</b></div><div><small>Expenses</small><b>${V(exp)}</b></div></div></div>
    <div class="grid"><div class="stat"><small>Stock value</small><b>${V(stockV)}</b></div>
    <div class="stat cu"><small>Outstanding Nkongole</small><b>${K(owed)}</b></div></div>
    ${low.length?`<h2>Running low</h2>`+low.map(p=>`<div class="row"><span>${esc(p.name)}</span><span class="amt neg">${p.qty} left</span></div>`).join(''):''}
    <h2>Recent sales</h2>`+list(S.sales.slice(0,5),saleRow,'No sales yet. Tap Sales to record your first.');
  if(tab==='sales') h=perSel()+list(tSales.slice(0,shown),saleRow,'No sales in this period.')+moreBtn(tSales.length)+fab('addSale','Sale');
  if(tab==='exp') h=perSel()+list(tExp.slice(0,shown),e=>`<div class="row"><div>${esc(e.what)}<small>${dstr(e.t)}</small></div><div><span class="amt neg">${K(e.amt)}</span> <button class="sec sm" aria-label="Delete expense" onclick="A.del('expenses','${e.id}')" aria-label="Delete"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>`,'No expenses yet.')+moreBtn(tExp.length)+fab('addExpense','Expense');
  if(tab==='stock') h=`<input id="q" placeholder="Search products" value="${esc(q)}" oninput="A.q(this.value)"><div id="lst">${pRows()}</div>`+fab('addProduct','Product');
  if(tab==='cust') h=`<input id="q" placeholder="Search customers" value="${esc(q)}" oninput="A.q(this.value)"><div id="lst">${cRows()}</div>`+fab('addCustomer','Customer');
  if(tab==='more'){ const by={}, prod={}; tSales.forEach(x=>{by[x.mode||'cash']=(by[x.mode||'cash']||0)+x.total; prod[x.item]=(prod[x.item]||0)+x.total;});
    const cin=sum(tSales.filter(x=>x.mode!=='credit'),x=>x.total)+sum(S.payments.filter(inR),x=>x.amt);
    const rows=o=>Object.entries(o).sort((p,q)=>q[1]-p[1]).slice(0,6).map(([k,v])=>`<div class="row"><span>${esc(ML[k]||k)}</span><span class="amt">${K(v)}</span></div>`).join('')||'<div class="empty">Nothing yet.</div>';
    const I=p=>`<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    const item=(fn,ic,t,sub)=>`<button class="mi" onclick="${fn}"><span class="mi-ic">${I(ic)}</span><span class="mi-t">${t}${sub?`<small>${sub}</small>`:''}</span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button>`;
    const nDel=Object.values(D).reduce((n,a)=>n+a.length,0);
    h=`${perSel()}<div class="grid"><div class="stat"><small>Sales</small><b>${K(sales)}</b></div><div class="stat"><small>Expenses</small><b>${V(exp)}</b></div>
    <div class="stat"><small>Profit</small><b>${V(sales-cg-exp)}</b></div><div class="stat"><small>Cash in − out</small><b>${V(cin-exp)}</b></div></div>
    <h2>Sales by payment method</h2>${rows(by)}<h2>Top products</h2>${rows(prod)}
    <p style="color:var(--mute);margin:4px 0 0;font-size:13px">Cash in = paid sales + Nkongole payments received. Subscription: K${PRICE}/month.</p>
    <h2>Business</h2><div class="mgroup">${item('A.setBiz()','<path d="M3 9l1-5h16l1 5M4 9v11h16V9M9 20v-6h6v6"/>','Business name',bizName?esc(bizName):'Shown on receipts')}${item('A.exportMenu()','<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>','Export to Excel','Sales, expenses, stock (CSV)')}${item('A.log()','<path d="M12 8v5l3 2"/><circle cx="12" cy="12" r="9"/>','Stock changes','History of edits and restocks')}${item('A.deleted()','<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>','Deleted entries',nDel+' item'+(nDel===1?'':'s')+' you can restore')}</div>
    <h2>Security</h2><div class="mgroup">${item('A.setPin()','<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>','App PIN',localStorage.getItem(pinKey())?'On · tap to turn off':'Lock this phone with 4 digits')}${item('A.setOwner()','<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>','Owner PIN',ownerHash?'On · tap to change or turn off':'Only you can edit or delete')}</div>
    <h2>Help</h2><div class="mgroup">${item('A.guide()','<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1-1.5 2M12 17h.01"/>','How to use Zenta','Quick walkthrough')}${isAdmin()?item('A.admin()','<path d="M3 17l6-6 4 4 8-8"/>','Admin: subscribers','')+item('A.errors()','<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>','Admin: app errors',''):''}</div>
    <div class="mgroup" style="margin-top:18px">${item('A.out()','<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>','Sign out','')}</div>
    <p style="text-align:center;margin-top:18px"><a href="#" onclick="A.delAcct();return false" style="color:var(--red);font-size:14px">Delete my account</a></p><p style="text-align:center;margin-top:12px;font-size:14px;color:var(--mute)"><a href="privacy.html" style="color:inherit">Privacy</a> · <a href="terms.html" style="color:inherit">Terms</a></p>`; }
  if(tab==='exp'&&!isUnlocked()) h='<div class="empty">🔒<br>Expenses are private to the owner.<br><br><button onclick="A.unlockO()">Enter owner PIN</button></div>';
  $('view').innerHTML=h;
  if(fq!==null&&$('q')){ $('q').focus(); try{ $('q').setSelectionRange(fq,fq); }catch(_){} }
  scrollTo(0,y);
}
function saleRow(s){ return `<div class="row"><div>${s.ret?'↩ Return · ':''}${s.editOf?'✎ ':''}${esc(s.item)} × ${s.packs>0?s.packs+(s.packs>1?' packs':' pack'):s.qty}<small>${dstr(s.t)} · ${ML[s.mode]||'Cash'}${s.mode==='credit'?' · <span class="cr">'+esc(s.cname)+'</span>':''}</small></div><div><span class="amt">${K(s.total)}</span> ${s.ret?'':`<button class="sec sm" aria-label="Edit sale" onclick="A.editSale('${s.id}')">✎</button> <button class="sec sm" aria-label="Return or exchange" onclick="A.ret('${s.id}')">↩</button> `}<button class="sec sm" aria-label="Receipt" onclick="A.receipt('${s.id}')" aria-label="Receipt"><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg></button> <button class="sec sm" aria-label="Delete sale" onclick="A.delSale('${s.id}')" aria-label="Delete"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>`; }

$('mtn').textContent=PAY_MTN; $('air').textContent=PAY_AIRTEL;
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
