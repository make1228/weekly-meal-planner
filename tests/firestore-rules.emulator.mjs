// Run against a local Firestore emulator. These checks never contact production.
// Dependencies may be kept outside this buildless app via FIREBASE_QA_PACKAGE.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {before,after,beforeEach,test} from 'node:test';
import {DEFAULT_SETTINGS,generatePlan,setMealCooked,replaceMeal} from '../engine.js';
import {createSharedSnapshot,createMutation,applyMutation} from '../sync-model.js';
import {createFirebaseSync} from '../firebase-sync.js';

const require=createRequire(process.env.FIREBASE_QA_PACKAGE||new URL('../package.json',import.meta.url));
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const firestoreSdk=require('firebase/firestore');
const {doc,getDoc,setDoc,updateDoc,serverTimestamp,Timestamp,setLogLevel}=firestoreSdk;
setLogLevel('silent');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw new Error('FIRESTORE_EMULATOR_HOST is required; production access is disabled.');
const projectId='demo-weekly-table-rules';
let environment;
const ownerUid='owner-uid',partnerUid='partner-uid';
const ownerEmail='make1228@gmail.com',partnerEmail='partner@example.com';
const homePath='mealHomes/weekly-table',dataPath=`${homePath}/data/current`;
const claims=email=>({email,email_verified:true,firebase:{sign_in_provider:'google.com'}});
const dbFor=(uid,email,extra={})=>environment.authenticatedContext(uid,{...claims(email),...extra}).firestore();
const home=(partner='')=>({schemaVersion:1,ownerUid,ownerEmail,partnerEmail:partner,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
const snapshot=()=>{
 const settings={...structuredClone(DEFAULT_SETTINGS),startDate:'2026-10-26'};
 return {version:1,state:{version:1,settings,inventory:[],plan:generatePlan(settings,[]),checked:{}},preferences:{weekdayPeople:'2',weekendPeople:'2',slots:['lunch','dinner'],maxMinutes:'60',favorites:['義式','西式'],avoidText:settings.avoid.join('、'),riceMeals:'2',pastaMeals:'1'}};
};
const data=(revision=1,updatedBy=ownerUid)=>({schemaVersion:1,snapshot:snapshot(),revision,updatedAt:serverTimestamp(),updatedBy,recentMutationIds:[]});
async function seed(partner=partnerEmail){
 await environment.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await setDoc(doc(db,homePath),home(partner));
  await setDoc(doc(db,dataPath),data());
 });
}
before(async()=>{
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
 environment=await initializeTestEnvironment({projectId,firestore:{host,port:Number(port),rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
});
beforeEach(async()=>environment.clearFirestore());
after(async()=>environment?.cleanup());

test('only the verified Google owner can create the fixed household',async()=>{
 const anonymous=environment.unauthenticatedContext().firestore();
 await assertFails(setDoc(doc(anonymous,homePath),home()));
 const stranger=dbFor('stranger','stranger@example.com');
 await assertFails(setDoc(doc(stranger,homePath),home()));
 const unverified=dbFor(ownerUid,ownerEmail,{email_verified:false});
 await assertFails(setDoc(doc(unverified,homePath),home()));
 const passwordOwner=dbFor(ownerUid,ownerEmail,{firebase:{sign_in_provider:'password'}});
 await assertFails(setDoc(doc(passwordOwner,homePath),home()));
 const owner=dbFor(ownerUid,ownerEmail);
 await assertFails(setDoc(doc(owner,homePath),{...home(),ownerUid:'different-uid'}));
 await assertFails(setDoc(doc(owner,homePath),{...home(),partnerEmail:ownerEmail}));
 await assertSucceeds(setDoc(doc(owner,homePath),home()));
 await assertSucceeds(setDoc(doc(owner,dataPath),data()));
 assert.equal((await getDoc(doc(owner,homePath))).data().ownerUid,ownerUid);
});

test('unauthenticated users and uninvited accounts cannot read or modify household data',async()=>{
 await seed();
 for(const db of [environment.unauthenticatedContext().firestore(),dbFor('stranger','stranger@example.com')]){
  await assertFails(getDoc(doc(db,homePath)));
  await assertFails(getDoc(doc(db,dataPath)));
  await assertFails(updateDoc(doc(db,dataPath),{revision:2,updatedAt:serverTimestamp(),updatedBy:'stranger'}));
 }
 const owner=dbFor(ownerUid,ownerEmail);
 await assertFails(setDoc(doc(owner,'mealHomes/another-home'),home()));
 await assertFails(setDoc(doc(owner,`${homePath}/data/not-current`),data()));
});

test('the one invited partner can read and edit shared data but cannot edit membership',async()=>{
 await seed();
 const partner=dbFor(partnerUid,partnerEmail);
 await assertSucceeds(getDoc(doc(partner,homePath)));
 await assertSucceeds(getDoc(doc(partner,dataPath)));
 const next=data(2,partnerUid);next.snapshot.state.inventory=[{ingredientId:'egg',quantity:3}];
 await assertSucceeds(setDoc(doc(partner,dataPath),next));
 await assertFails(updateDoc(doc(partner,homePath),{partnerEmail:'another@example.com',updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(doc(partner,homePath),{ownerUid:partnerUid,updatedAt:serverTimestamp()}));
 const unverifiedPartner=dbFor(partnerUid,partnerEmail,{email_verified:false});
 await assertFails(getDoc(doc(unverifiedPartner,dataPath)));
});

test('membership owner identity and household shape cannot be replaced',async()=>{
 await seed();
 const owner=dbFor(ownerUid,ownerEmail);
 for(const patch of [{ownerUid:'new-owner'},{ownerEmail:'new@example.com'},{schemaVersion:2},{partnerEmail:ownerEmail},{partnerEmail:[partnerEmail,'other@example.com']},{unexpected:true},{createdAt:Timestamp.fromMillis(1)}]){
  await assertFails(updateDoc(doc(owner,homePath),{...patch,updatedAt:serverTimestamp()}));
 }
 await assertSucceeds(updateDoc(doc(owner,homePath),{partnerEmail:'replacement@example.com',updatedAt:serverTimestamp()}));
});

test('data writes require the next revision, valid envelope, server time and own UID',async()=>{
 await seed();
 const owner=dbFor(ownerUid,ownerEmail);
 await assertFails(setDoc(doc(owner,dataPath),data(1)));
 await assertFails(setDoc(doc(owner,dataPath),data(3)));
 await assertFails(setDoc(doc(owner,dataPath),data(2,partnerUid)));
 await assertFails(setDoc(doc(owner,dataPath),{...data(2),updatedAt:Timestamp.fromMillis(1)}));
 await assertFails(setDoc(doc(owner,dataPath),{...data(2),schemaVersion:2}));
 await assertFails(setDoc(doc(owner,dataPath),{...data(2),snapshot:{version:1,state:null,preferences:{}}}));
 await assertFails(setDoc(doc(owner,dataPath),{...data(2),unexpected:true}));
 await assertSucceeds(setDoc(doc(owner,dataPath),data(2)));
 assert.equal((await getDoc(doc(owner,dataPath))).data().revision,2);
});

test('revoking a partner blocks their existing authenticated context immediately',async()=>{
 await seed();
 const owner=dbFor(ownerUid,ownerEmail),partner=dbFor(partnerUid,partnerEmail);
 await assertSucceeds(getDoc(doc(partner,dataPath)));
 await assertSucceeds(updateDoc(doc(owner,homePath),{partnerEmail:'',updatedAt:serverTimestamp()}));
 await assertFails(getDoc(doc(partner,homePath)));
 await assertFails(getDoc(doc(partner,dataPath)));
 await assertFails(setDoc(doc(partner,dataPath),data(2,partnerUid)));
 await assertSucceeds(getDoc(doc(owner,dataPath)));
});

test('a partner cannot initialize a missing shared menu',async()=>{
 await environment.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),homePath),home(partnerEmail)));
 const partner=dbFor(partnerUid,partnerEmail);
 await assertSucceeds(getDoc(doc(partner,homePath)));
 await assertFails(setDoc(doc(partner,dataPath),data(1,partnerUid)));
});

test('raw transactions retain household read permissions',async()=>{
 await seed();
 const owner=dbFor(ownerUid,ownerEmail);
 await assertSucceeds(firestoreSdk.runTransaction(owner,async transaction=>{
  const existingHome=await transaction.get(doc(owner,homePath));
  assert.equal(existingHome.data().ownerUid,ownerUid);
  const existingData=await transaction.get(doc(owner,dataPath));
  assert.equal(existingData.data().revision,1);
  transaction.set(doc(owner,dataPath),data(2));
 }));
});

async function waitUntil(check){
 const deadline=Date.now()+8000;
 while(Date.now()<deadline){if(check())return;await new Promise(resolve=>setTimeout(resolve,20));}
 throw new Error('Timed out waiting for a server-confirmed shared snapshot.');
}
async function connectedClient(uid,email){
 const db=dbFor(uid,email),user={uid,email,emailVerified:true},auth={currentUser:user};
 const events={data:[],status:[]};
 // Auth claims are provided by the rules emulator; Firestore transport is real.
 // Only Google popup UI is replaced, so these tests exercise transactions and
 // realtime delivery through the production transport and merge modules.
 const sdk={...firestoreSdk,getApps:()=>[],initializeApp:()=>({name:'weekly-table-sync'}),getAuth:()=>auth,getFirestore:()=>db,onAuthStateChanged:(_auth,callback)=>{queueMicrotask(()=>callback(user));return ()=>{};}};
 const service=await createFirebaseSync({config:{apiKey:'emulator-key',authDomain:'emulator.example.com',projectId,appId:'emulator-app'},sdk,applyMutation,validateSnapshot:value=>createSharedSnapshot(value.state,value.preferences),onData:(value,metadata)=>events.data.push({value,metadata}),onStatus:value=>events.status.push(value)});
 await waitUntil(()=>events.data.some(event=>event.value));
 return {db,service,events,latest:()=>events.data.at(-1)};
}

test('transport commits a single authenticated edit',async()=>{
 await seed();
 const owner=await connectedClient(ownerUid,ownerEmail);
 try{
  const base=owner.latest().value,next=structuredClone(base);
  next.state.inventory=[{ingredientId:'egg',quantity:4}];
  const result=await owner.service.submit({...createMutation(base,next),baseRevision:1});
  assert.equal(result.revision,2);
  assert.equal(result.snapshot.state.inventory[0].quantity,4);
 }finally{owner.service.destroy();}
});

test('two clients merge simultaneous unrelated changes and a newly opened client reads the latest menu',async()=>{
 await seed();
 const owner=await connectedClient(ownerUid,ownerEmail),partner=await connectedClient(partnerUid,partnerEmail);
 let reopened;
 try{
  const base=owner.latest().value,firstMeal=base.state.plan.days[0].meals[0];
  const cooked=structuredClone(base);cooked.state.plan=setMealCooked(cooked.state.plan,firstMeal.key,true);
  const stocked=structuredClone(base);stocked.state.inventory=[{ingredientId:'egg',quantity:4}];
  const ownerMutation={...createMutation(base,cooked),baseRevision:1},partnerMutation={...createMutation(base,stocked),baseRevision:1};
  const outcomes=await Promise.allSettled([owner.service.submit(ownerMutation),partner.service.submit(partnerMutation)]);
  const failed=outcomes.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  await waitUntil(()=>owner.latest().metadata.revision===3&&partner.latest().metadata.revision===3);
  const shared=partner.latest().value;
  assert.equal(shared.state.plan.days[0].meals[0].cooked,true);
  assert.equal(shared.state.inventory.find(item=>item.ingredientId==='egg').quantity,4);
  assert.deepEqual(owner.latest().value,shared);
  assert.equal(partner.latest().metadata.fromCache,false);
  partner.service.destroy();
  reopened=await connectedClient(partnerUid,partnerEmail);
  assert.equal(reopened.latest().metadata.revision,3);
  assert.deepEqual(reopened.latest().value,shared);
  const retried=await owner.service.submit(ownerMutation);
  assert.equal(retried.revision,3);
  assert.equal(retried.snapshot.state.inventory.find(item=>item.ingredientId==='egg').quantity,4);
 }finally{owner.service.destroy();partner.service.destroy();reopened?.service.destroy();}
});

test('simultaneous changes to the same meal reject one edit without overwriting the committed choice',async()=>{
 await seed();
 const owner=await connectedClient(ownerUid,ownerEmail),partner=await connectedClient(partnerUid,partnerEmail);
 try{
  const base=owner.latest().value,key=base.state.plan.days[0].meals[0].key;
  const cooked=structuredClone(base);cooked.state.plan=setMealCooked(cooked.state.plan,key,true);
  const swapped=structuredClone(base);swapped.state.plan=replaceMeal(swapped.state.plan,key,swapped.state.settings,[]);
  const outcomes=await Promise.allSettled([owner.service.submit({...createMutation(base,cooked),baseRevision:1}),partner.service.submit({...createMutation(base,swapped),baseRevision:1})]);
  assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
  const rejected=outcomes.find(result=>result.status==='rejected');
  assert.equal(rejected.reason.code,'sync/conflict');
  const committed=(await getDoc(doc(owner.db,dataPath))).data();
  assert.equal(committed.revision,2);
  assert.deepEqual(committed.snapshot,outcomes.find(result=>result.status==='fulfilled').value.snapshot);
 }finally{owner.service.destroy();partner.service.destroy();}
});
