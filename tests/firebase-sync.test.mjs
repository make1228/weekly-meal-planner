import test from 'node:test';
import assert from 'node:assert/strict';
import {createFirebaseSync,isFirebaseConfigured,normalizePartnerEmail,firebaseErrorMessage,HOME_PATH} from '../firebase-sync.js';
const config={apiKey:'test-key',authDomain:'test.firebaseapp.com',projectId:'test',appId:'test-app'};
const owner={uid:'owner-uid',email:'owner@example.com',emailVerified:true,displayName:'Owner'};
const partner={uid:'partner-uid',email:'partner@example.com',emailVerified:true};
const home={schemaVersion:1,ownerUid:owner.uid,ownerEmail:owner.email,partnerEmail:partner.email,createdAt:{},updatedAt:{}};
const initial={version:1,state:{version:1,settings:{},inventory:[],plan:{},checked:{}},preferences:{}};
const record=(revision=1,snapshot=initial)=>({schemaVersion:1,revision,snapshot,recentMutationIds:[],updatedBy:owner.uid,updatedAt:{toDate:()=>new Date('2026-10-28T00:00:00Z')}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({applyMutation=(latest,mutation)=>({...latest,...mutation.value}),validateSnapshot=value=>value}={}){
 const store=new Map(),listeners=[],events={auth:[],home:[],data:[],status:[]};
 const auth={currentUser:null};let authCallback,transactions=0;
 const snap=(value,metadata={})=>({exists:()=>value!==undefined,data:()=>value,metadata:{fromCache:false,hasPendingWrites:false,...metadata}});
 const sdk={
  getDocFromServer:async ref=>snap(store.get(ref.path)),
  getApps:()=>[],initializeApp:()=>({name:'weekly-table-sync'}),getAuth:()=>auth,getFirestore:()=>({}),doc:(_db,path)=>({path}),serverTimestamp:()=>({serverTime:true}),
  onAuthStateChanged:(_auth,callback)=>{authCallback=callback;return ()=>{authCallback=null;};},
  onSnapshot:(ref,_options,callback,error)=>{const item={path:ref.path,callback,error,unsubscribed:false};listeners.push(item);return ()=>{item.unsubscribed=true;};},
  runTransaction:async(_db,callback)=>{transactions++;const writes=[];const result=await callback({get:async ref=>snap(store.get(ref.path)),set:(ref,value)=>writes.push([ref.path,value]),update:(ref,value)=>writes.push([ref.path,{...store.get(ref.path),...value}])});for(const [path,value] of writes)store.set(path,value);return result;},
  GoogleAuthProvider:class{setCustomParameters(value){this.params=value;}},signInWithPopup:async()=>({user:owner}),signOut:async()=>{auth.currentUser=null;await authCallback?.(null);}
 };
 return {
  store,listeners,events,sdk,auth,
  create:()=>createFirebaseSync({config,applyMutation,validateSnapshot,sdk,onAuth:value=>events.auth.push(value),onHome:value=>events.home.push(value),onData:(value,metadata)=>events.data.push({value,metadata}),onStatus:value=>events.status.push(value)}),
  emitAuth:async value=>{auth.currentUser=value;await authCallback?.(value);},
  emit:(path,value,metadata={})=>{const callbacks=listeners.filter(item=>item.path===path&&!item.unsubscribed);for(const item of callbacks)item.callback(snap(value,metadata));},
  get transactions(){return transactions;}
 };
}
async function connected(options={}){
 const h=harness(options),service=await h.create();h.store.set(HOME_PATH,home);await h.emitAuth(owner);h.emit(HOME_PATH,home);return {...h,service};
}

test('missing Firebase config never imports SDK or prevents local operation',async()=>{
 const statuses=[];const service=await createFirebaseSync({config:null,onStatus:value=>statuses.push(value),sdk:{getApps:()=>{throw new Error('must not run');}}});
 assert.equal(service.available,false);assert.equal(statuses.at(-1).state,'unconfigured');
 assert.equal(isFirebaseConfigured({...config,apiKey:'YOUR_API_KEY'}),false);
 assert.equal(isFirebaseConfigured(config),true);
});

test('partner allowlist uses one normalized distinct email and can be revoked',()=>{
 assert.equal(normalizePartnerEmail(' Wife@Example.com '),'wife@example.com');
 assert.equal(normalizePartnerEmail(''),'');
 for(const value of [owner.email,'not-an-email','two@example.com,other@example.com','a@ b.com'])assert.throws(()=>normalizePartnerEmail(value,owner.email));
});

test('only server-confirmed snapshots are reported as synchronized',async()=>{
 const h=await connected();
 h.emit(`${HOME_PATH}/data/current`,record(),{fromCache:true});
 h.emit(`${HOME_PATH}/data/current`,record(),{hasPendingWrites:true});
 assert.equal(h.events.data.length,0);
 assert.equal(h.events.status.at(-1).state,'saving');
 h.emit(`${HOME_PATH}/data/current`,{...record(),recentMutationIds:['confirmed-edit']});
 assert.equal(h.events.data.length,1);assert.equal(h.events.data[0].metadata.revision,1);assert.deepEqual(h.events.data[0].metadata.recentMutationIds,['confirmed-edit']);
 h.emit(`${HOME_PATH}/data/current`,record());assert.equal(h.events.data.length,1);
 assert.equal(h.events.status.at(-1).state,'synced');h.service.destroy();
});

test('initial upload is explicit, owner-only, and cannot overwrite existing shared data',async()=>{
 const h=await connected();assert.equal(h.store.has(`${HOME_PATH}/data/current`),false);
 await h.service.initialize(initial);assert.equal(h.store.get(`${HOME_PATH}/data/current`).revision,1);
 await assert.rejects(h.service.initialize(initial),{code:'sync/already-initialized'});
 await h.emitAuth(partner);h.emit(HOME_PATH,home);
 await assert.rejects(h.service.initialize(initial),{code:'sync/forbidden'});h.service.destroy();
});

test('retrying a committed mutation ID does not add inventory twice',async()=>{
 let applications=0;
 const h=await connected({applyMutation:(latest,mutation)=>{applications++;return {...latest,counter:(latest.counter||0)+mutation.delta};}});
 h.store.set(`${HOME_PATH}/data/current`,record());
 const mutation={id:'persistent-operation-1',delta:3,baseRevision:1};
 const first=await h.service.submit(mutation),retry=await h.service.submit(mutation);
 assert.equal(first.snapshot.counter,3);assert.equal(retry.snapshot.counter,3);
 assert.equal(first.revision,2);assert.equal(retry.revision,2);assert.equal(applications,1);
 assert.deepEqual(h.store.get(`${HOME_PATH}/data/current`).recentMutationIds,['persistent-operation-1']);h.service.destroy();
});

test('a merge conflict leaves the cloud document and revision unchanged',async()=>{
 const conflict=Object.assign(new Error('changed meal'),{code:'sync/conflict',paths:['meal:Monday']});
 const h=await connected({applyMutation:()=>{throw conflict;}});const old=record();h.store.set(`${HOME_PATH}/data/current`,old);
 await assert.rejects(h.service.submit({id:'conflict',baseRevision:1}),error=>error===conflict);
 assert.equal(h.store.get(`${HOME_PATH}/data/current`),old);
 assert.match(h.events.status.at(-1).message,/保留你的編輯/);h.service.destroy();
});

test('sign-out and account changes invalidate callbacks already queued by old listeners',async()=>{
 const h=await connected();const lateData=h.listeners.find(item=>item.path.endsWith('data/current')).callback;
 await h.service.signOut();lateData({exists:()=>true,data:()=>record(99),metadata:{fromCache:false,hasPendingWrites:false}});
 assert.equal(h.events.data.length,0);assert.equal(h.events.auth.at(-1),null);
 await assert.rejects(h.service.submit({id:'signed-out'}),{code:'sync/signed-out'});h.service.destroy();
});

test('membership revocation invalidates a queued data callback and further writes',async()=>{
 const h=await connected();await h.emitAuth(partner);h.emit(HOME_PATH,home);
 const dataListener=h.listeners.filter(item=>item.path.endsWith('data/current')).at(-1);
 h.emit(HOME_PATH,{...home,partnerEmail:''});
 dataListener.callback({exists:()=>true,data:()=>record(3),metadata:{fromCache:false,hasPendingWrites:false}});
 assert.equal(h.events.data.length,0);assert.equal(h.events.status.at(-1).state,'forbidden');
 await assert.rejects(h.service.submit({id:'revoked'}),{code:'sync/forbidden'});h.service.destroy();
});

test('owner membership change never changes owner fields and rejects invalid address before a write',async()=>{
 const h=await connected();
 await h.service.setPartnerEmail(' NEW@Example.com ');
 const saved=h.store.get(HOME_PATH);assert.equal(saved.partnerEmail,'new@example.com');assert.equal(saved.ownerUid,owner.uid);assert.equal(saved.ownerEmail,owner.email);
 const count=h.transactions;await assert.rejects(h.service.setPartnerEmail('bad-email'));assert.equal(h.transactions,count);h.service.destroy();
});

test('Firebase initialization errors are returned as unavailable without crashing the app',async()=>{
 const statuses=[];const service=await createFirebaseSync({config,sdk:{getApps:()=>{throw Object.assign(new Error('invalid'),{code:'auth/invalid-api-key'});}},onStatus:value=>statuses.push(value)});
 assert.equal(service.available,false);assert.equal(statuses.at(-1).state,'error');assert.match(statuses.at(-1).message,/設定尚未完成/);
 assert.match(firebaseErrorMessage({code:'auth/popup-blocked'}),/彈出視窗/);
});

 test('an ambiguous retry whose receipt expired cannot apply an inventory delta again',async()=>{
 const latest={...initial,latestMarker:'server-read-review'};
 const h=await connected();h.store.set(`${HOME_PATH}/data/current`,record(130,latest));
 await assert.rejects(h.service.submit({id:'old-operation',baseRevision:1,value:{counter:1}}),error=>{
  assert.equal(error.code,'sync/expired-mutation');
  assert.equal(error.latestRevision,130);
  assert.deepEqual(error.latestSnapshot,latest);
  return true;
 });
 assert.equal(h.store.get(`${HOME_PATH}/data/current`).revision,130);h.service.destroy();
});

test('sign-out while a transaction waits for its read prevents the pending write',async()=>{
 const h=await connected();const old=record();h.store.set(`${HOME_PATH}/data/current`,old);
 let release,writeAttempted=false;
 h.sdk.runTransaction=async(_db,callback)=>callback({get:()=>new Promise(resolve=>{release=()=>resolve({exists:()=>true,data:()=>old});}),set:()=>{writeAttempted=true;}});
 const pending=h.service.submit({id:'waiting',baseRevision:1,value:{counter:9}});
 await h.service.signOut();release();
 await assert.rejects(pending,{code:'sync/signed-out'});assert.equal(writeAttempted,false);h.service.destroy();
});

test('unverified sign-in does not subscribe to or create a household',async()=>{
 const h=harness(),service=await h.create();await h.emitAuth({...owner,emailVerified:false});
 assert.equal(h.listeners.length,0);assert.equal(h.transactions,0);assert.equal(h.events.status.at(-1).state,'forbidden');service.destroy();
});

test('a partner revoked before a pending transaction is rejected before modifying data',async()=>{
 const h=await connected();await h.emitAuth(partner);h.emit(HOME_PATH,home);
 const old=record();h.store.set(`${HOME_PATH}/data/current`,old);
 // Simulate revocation already committed on the server before the listener arrives.
 h.store.set(HOME_PATH,{...home,partnerEmail:''});
 await assert.rejects(h.service.submit({id:'racing-revocation',baseRevision:1,value:{counter:1}}),{code:'sync/forbidden'});
 assert.equal(h.store.get(`${HOME_PATH}/data/current`),old);h.service.destroy();
});

test('authenticated revision contention retries the original mutation against the fresh document',async()=>{
 const h=await connected({applyMutation:(latest,mutation)=>({...latest,[mutation.field]:mutation.value})});
 h.store.set(`${HOME_PATH}/data/current`,record(1,{...initial,other:'before'}));
 const run=h.sdk.runTransaction;let attempts=0;
 h.sdk.runTransaction=async(db,callback)=>{
  attempts++;
  if(attempts===1){
   await callback({get:async ref=>({exists:()=>true,data:()=>h.store.get(ref.path)}),set:()=>{}});
   h.store.set(`${HOME_PATH}/data/current`,record(2,{...initial,other:'family update'}));
   throw Object.assign(new Error('racing revision'),{code:'permission-denied'});
  }
  return run(db,callback);
 };
 const mutation={id:'merge-retry',baseRevision:1,field:'mine',value:'my update'};
 const result=await h.service.submit(mutation);
 assert.equal(attempts,2);assert.equal(result.revision,3);
 assert.equal(result.snapshot.other,'family update');assert.equal(result.snapshot.mine,'my update');
 assert.deepEqual(h.store.get(`${HOME_PATH}/data/current`).recentMutationIds,['merge-retry']);h.service.destroy();
});

test('contention retry preserves original before-values and reports a same-field conflict',async()=>{
 const h=await connected({applyMutation:(latest,mutation)=>{
  if(latest.mine!==mutation.before)throw Object.assign(new Error('same field changed'),{code:'sync/conflict',paths:['mine']});
  return {...latest,mine:mutation.after};
 }});
 h.store.set(`${HOME_PATH}/data/current`,record(1,{...initial,mine:'before'}));let attempts=0;
 h.sdk.runTransaction=async(_db,callback)=>{
  attempts++;
  const result=await callback({get:async ref=>({exists:()=>true,data:()=>h.store.get(ref.path)}),set:()=>{}});
  h.store.set(`${HOME_PATH}/data/current`,record(2,{...initial,mine:'family update'}));
  throw Object.assign(new Error('racing revision'),{code:'permission-denied'});
 };
 const mutation={id:'same-field-retry',baseRevision:1,before:'before',after:'my update'};
 await assert.rejects(h.service.submit(mutation),{code:'sync/conflict'});
 assert.equal(attempts,2);assert.equal(mutation.before,'before');assert.equal(h.store.get(`${HOME_PATH}/data/current`).snapshot.mine,'family update');h.service.destroy();
});

test('permission denial is never retried without an authorized advanced server revision',async()=>{
 for(const revoked of [false,true]){
  const h=await connected();h.store.set(`${HOME_PATH}/data/current`,record());let attempts=0;
  h.sdk.runTransaction=async(_db,callback)=>{
   attempts++;await callback({get:async ref=>({exists:()=>true,data:()=>h.store.get(ref.path)}),set:()=>{}});
   if(revoked)h.sdk.getDocFromServer=async()=>{throw Object.assign(new Error('revoked'),{code:'permission-denied'});};
   throw Object.assign(new Error('denied'),{code:'permission-denied'});
  };
  await assert.rejects(h.service.submit({id:'denied',baseRevision:1,value:{mine:true}}),{code:'permission-denied'});
  assert.equal(attempts,1);assert.equal(h.events.status.at(-1).state,'forbidden');h.service.destroy();
 }
});

test('repeated authenticated contention stops after three attempts without mislabeling access as revoked',async()=>{
 const h=await connected();h.store.set(`${HOME_PATH}/data/current`,record());let attempts=0;
 h.sdk.runTransaction=async(_db,callback)=>{
  attempts++;await callback({get:async ref=>({exists:()=>true,data:()=>h.store.get(ref.path)}),set:()=>{}});
  h.store.set(`${HOME_PATH}/data/current`,record(attempts+1));
  throw Object.assign(new Error('racing revision'),{code:'permission-denied'});
 };
 await assert.rejects(h.service.submit({id:'busy-family',baseRevision:1,value:{mine:true}}),{code:'sync/conflict'});
 assert.equal(attempts,3);assert.equal(h.events.status.at(-1).state,'error');assert.notEqual(h.events.home.at(-1),null);h.service.destroy();
});

test('two owner tabs initializing concurrently never replace the winning initial data',async()=>{
 const h=await connected();let writes=0;
 h.sdk.runTransaction=async(_db,callback)=>{
  await callback({get:async ref=>({exists:()=>h.store.has(ref.path),data:()=>h.store.get(ref.path)}),set:()=>{writes++;}});
  h.store.set(`${HOME_PATH}/data/current`,record(1,{...initial,winner:true}));
  throw Object.assign(new Error('created by another owner tab'),{code:'permission-denied'});
 };
 await assert.rejects(h.service.initialize({...initial,winner:false}),{code:'sync/already-initialized'});
 assert.equal(writes,1);assert.equal(h.store.get(`${HOME_PATH}/data/current`).snapshot.winner,true);
 assert.equal(h.events.status.at(-1).state,'error');assert.notEqual(h.events.home.at(-1),null);h.service.destroy();
});

test('contention probes briefly for a racing winner whose commit is not yet visible',async()=>{
 const h=await connected();h.store.set(`${HOME_PATH}/data/current`,record());
 const run=h.sdk.runTransaction,get=h.sdk.getDocFromServer;let attempts=0,dataProbes=0;
 h.sdk.runTransaction=async(db,callback)=>{
  attempts++;
  if(attempts===1){await callback({get:async ref=>({exists:()=>true,data:()=>h.store.get(ref.path)}),set:()=>{}});throw Object.assign(new Error('winner still committing'),{code:'permission-denied'});}
  return run(db,callback);
 };
 h.sdk.getDocFromServer=async ref=>{
  if(ref.path.endsWith('data/current')&&++dataProbes===2)h.store.set(ref.path,record(2,{...initial,other:true}));
  return get(ref);
 };
 const result=await h.service.submit({id:'delayed-winner',baseRevision:1,value:{mine:true}});
 assert.equal(dataProbes,2);assert.equal(attempts,2);assert.equal(result.revision,3);assert.equal(result.snapshot.other,true);assert.equal(result.snapshot.mine,true);h.service.destroy();
});

test('household owner identity comes from the server-authorized runtime record',async()=>{
 const h=harness(),service=await h.create();
 const configuredOwner={uid:'configured-owner',email:'configured-owner@example.net',emailVerified:true};
 await h.emitAuth(configuredOwner);
 const created=h.store.get(HOME_PATH);
 assert.equal(created.ownerUid,configuredOwner.uid);assert.equal(created.ownerEmail,configuredOwner.email);
 h.emit(HOME_PATH,created);
 assert.equal(h.events.home.at(-1).isOwner,true);
 await service.initialize(initial);
 assert.equal(h.store.get(`${HOME_PATH}/data/current`).updatedBy,configuredOwner.uid);
 service.destroy();
});

test('a denied bootstrap still lets an invited partner read an existing authorized home',async()=>{
 const h=harness(),service=await h.create();h.store.set(HOME_PATH,home);
 const run=h.sdk.runTransaction;
 h.sdk.runTransaction=async()=>{throw Object.assign(new Error('creation is owner-only'),{code:'permission-denied'});};
 await h.emitAuth(partner);
 assert.equal(h.events.status.at(-1).state,'connecting');
 assert.equal(h.listeners.filter(listener=>listener.path===HOME_PATH).length,1);
 h.emit(HOME_PATH,home);
 assert.equal(h.events.home.at(-1).isOwner,false);
 h.sdk.runTransaction=run;
 h.store.set(`${HOME_PATH}/data/current`,record());
 const result=await service.submit({id:'authorized-partner',baseRevision:1,value:{partnerEdit:true}});
 assert.equal(result.snapshot.partnerEdit,true);service.destroy();
});

test('an uninvited account remains denied by the server after its bootstrap is rejected',async()=>{
 const h=harness(),service=await h.create();
 h.sdk.runTransaction=async()=>{throw Object.assign(new Error('server policy denied'),{code:'permission-denied'});};
 await h.emitAuth({uid:'stranger-uid',email:'stranger@example.org',emailVerified:true});
 const listener=h.listeners.find(item=>item.path===HOME_PATH);
 listener.error(Object.assign(new Error('server read denied'),{code:'permission-denied'}));
 assert.equal(h.events.status.at(-1).state,'forbidden');assert.equal(h.events.data.length,0);
 await assert.rejects(service.initialize(initial),{code:'sync/forbidden'});service.destroy();
});
