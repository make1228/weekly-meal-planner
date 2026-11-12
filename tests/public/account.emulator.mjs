import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithCredential,GoogleAuthProvider,OAuthProvider,linkWithCredential,signOut} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,getDoc,setDoc,collection,getDocs,onSnapshot,terminate} from 'firebase/firestore';
import {getFunctions,connectFunctionsEmulator,httpsCallable} from 'firebase/functions';
import {initializeApp as adminApp,getApp as getAdminApp} from 'firebase-admin/app';
import {getFirestore as adminStore} from 'firebase-admin/firestore';
import {getAuth as adminAuth} from 'firebase-admin/auth';
import {prepareLegacyMigration,applyLegacyMigration,rollbackLegacyMigration} from '../../backend/migration.js';
import {createAccountService} from '../../backend/service.js';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {commandMutation} from '../../account/commands.js';
import {createMutation,createSharedSnapshot} from '../../sync-model.js';
import {setMealCooked,recipeById} from '../../engine.js';
const projectId='demo-weekly-meal-public';
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)throw new Error('Emulators are required; production calls prohibited.');
let rules,admin;const clients=[];let serial=0;
before(async()=>{
 admin=adminStore(adminApp({projectId},'account-admin-tests'));
 rules=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8080,rules:await readFile('firestore.public.rules','utf8')}});
});
after(async()=>{await rules.cleanup();for(const c of clients){await signOut(c.auth);await terminate(c.db);await deleteApp(c.app);}});
function googleToken(sub,email=sub+'@example.com'){return JSON.stringify({sub,email,email_verified:true,name:'Test user'});}
async function user(prefix='user'){
 const unique=prefix+'-'+Date.now()+'-'+serial++;
 const app=initializeApp({projectId,apiKey:'demo-key',authDomain:projectId+'.firebaseapp.com'},unique),auth=getAuth(app),db=getFirestore(app),functions=getFunctions(app,'us-central1');
 connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8080);connectFunctionsEmulator(functions,'127.0.0.1',5001);
 await signInWithCredential(auth,GoogleAuthProvider.credential(googleToken(unique)));
 const client={app,auth,db,uid:auth.currentUser.uid,call:async(action,payload={})=>(await httpsCallable(functions,'mealAccount')({action,payload})).data};
 clients.push(client);return client;
}
const operation=(base,type,payload={})=>({baseSnapshot:base.snapshot,baseRevision:base.revision,id:'operation-'+Date.now()+'-'+serial++,type,payload});
const meals=result=>result.snapshot.state.plan.days.flatMap(d=>d.meals);
test('new real Auth users receive neutral independent snapshots and cannot set target UID',async()=>{
 const a=await user('neutral'),b=await user('independent'),ra=await a.call('bootstrap'),rb=await b.call('bootstrap');
 assert.notEqual(a.uid,b.uid);assert.notEqual(ra.dataPath,rb.dataPath);
 assert.deepEqual(ra.snapshot.state.settings.avoid,[]);assert.deepEqual(ra.profile.equipment,[]);assert.equal(meals(ra).length,0);
 assert.equal(rb.revision,1);
 await assert.rejects(a.call('bootstrap',{uid:b.uid}),/不允許/);
 const changed=await a.call('command',operation(ra,'inventoryAdd',{ingredientId:'breast',quantity:50}));
 assert.equal(changed.snapshot.state.inventory[0].quantity,50);
 assert.deepEqual((await b.call('bootstrap')).snapshot.state.inventory,[]);
});
test('real callable requests reject anonymous clients; rules reject cross-user reads, writes, lists and owner forgery',async()=>{
 const a=await user('rules-a'),b=await user('rules-b');const ra=await a.call('bootstrap');await b.call('bootstrap');
 await assertSucceeds(getDoc(doc(a.db,ra.dataPath)));
 await assertFails(getDoc(doc(b.db,ra.dataPath)));
 await assertFails(getDoc(doc(b.db,'mealPlannerUsers/'+a.uid)));
 await assertFails(getDocs(collection(a.db,'mealPlannerUsers')));
 await assertFails(setDoc(doc(a.db,ra.dataPath),{ownerUid:b.uid}));
 await assertFails(setDoc(doc(a.db,'mealPlannerLegacyBindings/'+a.uid),{verified:true,sourceId:'weekly-table'}));
 const anon=initializeApp({projectId,apiKey:'demo-key'},'anonymous-'+serial++),f=getFunctions(anon);connectFunctionsEmulator(f,'127.0.0.1',5001);
 await assert.rejects(httpsCallable(f,'mealAccount')({action:'bootstrap'}),/請先登入/);await deleteApp(anon);
});
test('two independently loaded clients of the same account receive server-confirmed updates and survive reload',async()=>{
 const a=await user('same-account'),ra=await a.call('bootstrap');
 const second=initializeApp(a.app.options,'second-device-'+serial++),auth=getAuth(second),db=getFirestore(second),f=getFunctions(second);
 connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectFirestoreEmulator(db,'127.0.0.1',8080);connectFunctionsEmulator(f,'127.0.0.1',5001);
 // Explicit provider credential for the same provider subject, not an email lookup.
 const sub=a.app.name;await signInWithCredential(auth,GoogleAuthProvider.credential(googleToken(sub)));
 assert.equal(auth.currentUser.uid,a.uid);
 const seen=[];let resolve;
 const arrival=new Promise(r=>{resolve=r;});
 const off=onSnapshot(doc(db,ra.dataPath),{includeMetadataChanges:true},s=>{if(s.exists()&&!s.metadata.fromCache&&!s.metadata.hasPendingWrites){seen.push(s.data().revision);if(s.data().revision>1)resolve();}});
 const generated=await a.call('command',operation(ra,'generate',{week:ra.snapshot.state.plan.startDate}));
 await Promise.race([arrival,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Listener timeout')),10000))]);
 assert.ok(seen.includes(generated.revision));assert.equal(meals(generated).length,14);
 const reload=(await httpsCallable(f,'mealAccount')({action:'bootstrap'})).data;assert.deepEqual(reload.snapshot,generated.snapshot);
 const marked=(await httpsCallable(f,'mealAccount')({action:'command',payload:operation(reload,'cooked',{mealKey:meals(reload)[0].key,cooked:true})})).data;
 assert.equal((await a.call('bootstrap')).revision,marked.revision);
 off();await signOut(auth);await terminate(db);await deleteApp(second);
});
test('idempotent retries, nonoverlapping concurrent edits and same-field conflicts use the real backend',async()=>{
 const a=await user('races'),base=await a.call('bootstrap');
 const first=operation(base,'inventoryAdd',{ingredientId:'egg',quantity:2});
 const once=await a.call('command',first),twice=await a.call('command',first);
 assert.equal(once.revision,twice.revision);assert.equal(twice.snapshot.state.inventory[0].quantity,2);
 const next=await a.call('command',operation(base,'inventoryAdd',{ingredientId:'milk',quantity:100}));
 assert.equal(next.snapshot.state.inventory.length,2);
 const prefs={...next.snapshot.preferences,avoidText:'茄子'};
 const left=operation(next,'preferences',{preferences:prefs}),right=operation(next,'preferences',{preferences:{...prefs,avoidText:'青椒'}});
 await a.call('command',left);
 await assert.rejects(a.call('command',right),e=>e.details?.code==='sync/conflict');
 const stale={...operation(base,'inventoryAdd',{ingredientId:'egg',quantity:1}),baseRevision:999};
 await assert.rejects(a.call('command',stale),e=>e.details?.code==='sync/expired-mutation');
});
test('current and next week remain independent; portions and cooked shopping semantics stay intact',async()=>{
 const a=await user('weeks'),base=await a.call('bootstrap'),nextWeek=base.snapshot.state.plan.nextWeek.plan.startDate;
 const next=await a.call('command',operation(base,'generate',{week:nextWeek}));
 assert.equal(meals(next).length,0);assert.equal(next.snapshot.state.plan.nextWeek.plan.days.flatMap(d=>d.meals).length,14);
 const before=JSON.stringify(next.snapshot.state.plan);
 const prefs=await a.call('command',operation(next,'preferences',{preferences:{...next.snapshot.preferences,weekdayPeople:'2',weekdayChildren:'1',appetite:'small'}}));
 const m=prefs.snapshot.state.plan.nextWeek.plan.days[0].meals[0];assert.equal(m.servings,2.7);assert.equal(m.portionFactor,.7);
 assert.equal((await a.call('bootstrap')).snapshot.state.plan.unplanned,true);
 assert.notEqual(JSON.stringify(prefs.snapshot.state.plan),before);
});
test('explicit Apple linking with private email keeps the Firebase UID; another provider identity cannot be stolen',async()=>{
 const a=await user('link-a'),b=await user('link-b');await a.call('bootstrap');await b.call('bootstrap');
 const apple=new OAuthProvider('apple.com'),sub='apple-private-'+serial++;
 const credential=apple.credential({idToken:JSON.stringify({sub,email:'hidden-'+serial+'@privaterelay.appleid.com',email_verified:true})});
 const uid=a.uid;await linkWithCredential(a.auth.currentUser,credential);assert.equal(a.auth.currentUser.uid,uid);
 assert.ok(a.auth.currentUser.providerData.some(p=>p.providerId==='apple.com'));
 await assert.rejects(linkWithCredential(b.auth.currentUser,credential),/already|credential/i);
 assert.notEqual(b.auth.currentUser.uid,uid);
});
test('confirmed import CAS, export and profile revisions are enforced on actual persisted data',async()=>{
 const a=await user('import'),base=await a.call('bootstrap');
 const profile={displayName:'測試使用者',equipment:[{id:'ih',model:'My IH'}]};
 await a.call('profile',{profile,revision:1});
 await assert.rejects(a.call('profile',{profile:{...profile,displayName:'Stale'},revision:1}),/另一個裝置/);
 const exported=await a.call('export');assert.deepEqual(exported.profile,profile);
 await assert.rejects(a.call('replace',{snapshot:base.snapshot,baseRevision:1,id:'import-operation-123',confirmed:false}),/確認/);
 await a.call('command',operation(base,'inventoryAdd',{ingredientId:'egg',quantity:1}));
 await assert.rejects(a.call('replace',{snapshot:base.snapshot,baseRevision:1,id:'import-operation-456',confirmed:true}),e=>e.details?.code==='sync/conflict');
});
test('legacy two-UID mapping stays shared; deleting one account preserves the other and the old source',async()=>{
 const a=await user('legacy-a'),b=await user('legacy-b');
 const seed=await a.call('bootstrap'),shared={schemaVersion:2,ownerUid:'legacy:test-source',snapshot:seed.snapshot,revision:1,recentMutationIds:[],updatedAt:new Date(),updatedBy:'migration'};
 await admin.doc('mealPlannerLegacyData/test-source').set(shared);
 for(const c of [a,b]){
  await admin.doc('mealPlannerLegacyBindings/'+c.uid).set({verified:true,sourceId:'test-source',migrationId:'synthetic-migration'});
  await admin.doc('mealPlannerUsers/'+c.uid).delete();
 }
 await admin.doc('mealHomes/weekly-table/data/current').set({proof:'original source is retained'});
 const ra=await a.call('bootstrap'),rb=await b.call('bootstrap');
 assert.equal(ra.dataPath,rb.dataPath);assert.equal(ra.legacyShared,true);
 const changed=await a.call('command',operation(ra,'inventoryAdd',{ingredientId:'breast',quantity:120}));
 assert.deepEqual((await b.call('bootstrap')).snapshot,changed.snapshot);
 assert.equal((await a.call('deleteAccount',{confirmation:'DELETE_MY_ACCOUNT'})).status,'completed');
 assert.equal((await admin.doc('mealPlannerUsers/'+a.uid).get()).exists,false);
 assert.equal((await admin.doc('mealPlannerLegacyBindings/'+a.uid).get()).exists,false);
 assert.equal((await admin.doc('mealHomes/weekly-table/data/current').get()).data().proof,'original source is retained');
 assert.deepEqual((await b.call('bootstrap')).snapshot,changed.snapshot);
});

test('shopping and replacement APIs use the shared engine and preserve actual inventory through cooked toggles',async()=>{
 const a=await user('shopping-contract'),base=await a.call('bootstrap');
 let value=await a.call('command',operation(base,'generate',{}));
 const week=value.snapshot.state.plan.startDate,meal=meals(value)[0];
 const options=await a.call('options',{week,mealKey:meal.key});assert.ok(options.recipeIds.length>10);
 const added=await a.call('command',operation(value,'inventoryAdd',{ingredientId:'oil',quantity:100}));
 const before=await a.call('shopping',{week});assert.ok(before.rows.length>0);
 const cooked=await a.call('command',operation(added,'cooked',{week,mealKey:meal.key,cooked:true}));
 assert.deepEqual(cooked.snapshot.state.inventory,added.snapshot.state.inventory);
 const restored=await a.call('command',operation(cooked,'cooked',{week,mealKey:meal.key,cooked:false}));
 assert.deepEqual((await a.call('shopping',{week})).rows,before.rows);
 assert.deepEqual(restored.snapshot.state.inventory,added.snapshot.state.inventory);
});
test('disabled and deleted Auth identities cannot bootstrap with a previously issued token',async()=>{
 const a=await user('revoked');await a.call('bootstrap');
 await adminAuth(getAdminApp('account-admin-tests')).updateUser(a.uid,{disabled:true});
 await assert.rejects(a.call('bootstrap'),e=>e.code==='functions/unauthenticated');
 await adminAuth(getAdminApp('account-admin-tests')).updateUser(a.uid,{disabled:false});
 await a.call('deleteAccount',{confirmation:'DELETE_MY_ACCOUNT'});
 await assert.rejects(a.call('bootstrap'),e=>e.code==='functions/unauthenticated');
});
test('actual migration transaction is atomic, rerunnable and rollback refuses subsequent edits',async()=>{
 const a=await user('migration-a'),b=await user('migration-b');
 const identities=(await Promise.all([a,b].map(c=>adminAuth(getAdminApp('account-admin-tests')).getUser(c.uid)))).map(u=>({...u,email:u.email||u.providerData[0].email,emailVerified:true}));
 const source={home:{schemaVersion:1,ownerUid:a.uid,ownerEmail:identities[0].email,partnerEmail:identities[1].email},policy:{ownerEmail:identities[0].email},record:{schemaVersion:1,revision:7,recentMutationIds:[],snapshot:(await a.call('bootstrap')).snapshot},identities};
 await admin.doc('mealPlannerUsers/'+a.uid+'/data/current').delete();await admin.doc('mealPlannerUsers/'+a.uid).delete();
 const original=JSON.stringify(source),{plan}=prepareLegacyMigration(source);plan.sourceId='migration-'+serial++;
 const broken=structuredClone(plan);broken.accounts[1].uid='invalid/uid';
 await assert.rejects(applyLegacyMigration(admin,broken));assert.equal((await admin.doc('mealPlannerLegacyData/'+plan.sourceId).get()).exists,false);
 assert.equal((await applyLegacyMigration(admin,plan)).status,'applied');
 assert.equal((await applyLegacyMigration(admin,plan)).status,'already-applied');
 assert.equal((await a.call('bootstrap')).dataPath,(await b.call('bootstrap')).dataPath);
 await admin.doc('mealPlannerUsers/'+a.uid).update({profileRevision:2});
 await assert.rejects(rollbackLegacyMigration(admin,plan),/新變更/);
 await admin.doc('mealPlannerUsers/'+a.uid).update({profileRevision:1});
 assert.equal((await rollbackLegacyMigration(admin,plan)).status,'rolled-back');
 assert.equal((await rollbackLegacyMigration(admin,plan)).status,'already-rolled-back');
 assert.equal(JSON.stringify(source),original);
});
test('interrupted account deletion records retry progress and rerun completes without shared-source deletion',async()=>{
 const a=await user('deletion-retry');await a.call('bootstrap');let fail=true;
 const service=createAccountService({db:admin,auth:{getUser:uid=>adminAuth(getAdminApp('account-admin-tests')).getUser(uid),revokeRefreshTokens:uid=>adminAuth(getAdminApp('account-admin-tests')).revokeRefreshTokens(uid),deleteUser:async uid=>{if(fail){fail=false;throw Object.assign(new Error('synthetic interruption'),{code:'auth/internal-error'});}return adminAuth(getAdminApp('account-admin-tests')).deleteUser(uid);}},serverTimestamp:()=>new Date()});
 const context={uid:a.uid,provider:'google.com',authTime:Math.floor(Date.now()/1000)};
 await assert.rejects(service({action:'deleteAccount',payload:{confirmation:'DELETE_MY_ACCOUNT'}},context),e=>e.details.reason==='deletion-retry');
 assert.equal((await service({action:'deletionStatus'},context)).status,'retryable');
 await assert.rejects(service({action:'bootstrap'},context),e=>e.details.reason==='deleting');
 assert.equal((await service({action:'deleteAccount',payload:{confirmation:'DELETE_MY_ACCOUNT'}},context)).status,'completed');
 assert.equal((await admin.doc('mealPlannerDeletionJobs/'+a.uid).get()).exists,false);
});

test('equal email across Google and Apple does not implicitly merge product accounts',async()=>{
 const a=await user('same-email'),email=a.auth.currentUser.providerData.find(p=>p.providerId==='google.com').email;
 const b=await user('other-provider');
 await signOut(b.auth);
 const credential=new OAuthProvider('apple.com').credential({idToken:JSON.stringify({sub:'same-mail-apple-'+serial++,email,email_verified:true})});
 await signInWithCredential(b.auth,credential);
 assert.notEqual(b.auth.currentUser.uid,a.uid);
 const first=await a.call('bootstrap'),second=await b.call('bootstrap');
 assert.notEqual(first.dataPath,second.dataPath);
});
