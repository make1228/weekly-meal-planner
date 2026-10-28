import test from 'node:test';
import assert from 'node:assert/strict';
import {installCloudSync} from '../cloud-ui.js';
import {DEFAULT_SETTINGS,generatePlan,aggregateShopping} from '../engine.js';
import {settingsToDraft} from '../preferences.js';
import {createSharedSnapshot,applyMutation} from '../sync-model.js';

const clone=value=>structuredClone(value);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const owner={uid:'owner',email:'owner@example.com'};
const partner={uid:'partner',email:'partner@example.com'};
const home={isOwner:true,ownerEmail:owner.email,partnerEmail:partner.email};
function initialState(seed=0){const settings={...clone(DEFAULT_SETTINGS),startDate:'2026-10-26',seed};return {version:1,settings,inventory:[],plan:{...generatePlan(settings,[]),generationId:`generation-${seed}`},checked:{}};}
function shared(seed=1){const state=initialState(seed);return createSharedSnapshot(state,settingsToDraft(state.settings));}
class Element{
 constructor(){this.hidden=false;this.disabled=false;this.dataset={};this.textContent='';this.innerHTML='';this.value='';this.open=false;this.listeners=new Map();const names=new Set();this.classList={toggle:(name,on)=>on?names.add(name):names.delete(name),contains:name=>names.has(name)};}
 addEventListener(type,handler){const list=this.listeners.get(type)||[];list.push(handler);this.listeners.set(type,list);}
 hasAttribute(name){if(name.startsWith('data-'))return Object.hasOwn(this.dataset,name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()));return false;}
 async emit(type,event={}){for(const callback of this.listeners.get(type)||[])await callback({preventDefault(){},...event});}
 close(){this.open=false;}
}
function setup(){
 const selectors=['#cloud-description','#cloud-error','#cloud-status','.cloud-panel','#cloud-account','#cloud-sign-in','#cloud-sign-out','#cloud-setup','#cloud-initialize','#cloud-members','#cloud-member-form button','#cloud-retry','#storage-description','#save-state','.workspace','#recipe-dialog','#replacement-dialog','#cloud-member-description','#cloud-partner-email','#cloud-member-form'];
 const elements=new Map(selectors.map(selector=>[selector,new Element()])),controls=[new Element(),new Element()];
 elements.get('#cloud-description').textContent='Sign in to share a table';
 const oldGlobals=new Map(['document','window','navigator','localStorage'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const storage=new Map(),windowListeners=new Map();
 const document={activeElement:null,querySelector:selector=>{assert.ok(elements.has(selector),`Unexpected selector: ${selector}`);return elements.get(selector);},querySelectorAll:()=>controls};
 const window={addEventListener:(type,handler)=>{const list=windowListeners.get(type)||[];list.push(handler);windowListeners.set(type,list);}};
 const navigator={onLine:true};
 const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))};
 for(const [key,value] of Object.entries({document,window,navigator,localStorage}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
 let state=initialState(),draft=settingsToDraft(state.settings),pantryDraft={ingredientId:'egg',quantity:'2'},persisted=null,persistCount=0,refreshCount=0;
 const personal=clone({state,draftSettings:draft,pantryFormDraft:pantryDraft}),toasts=[];
 const adapter={
  getState:()=>state,setState:value=>{state=value;},getDraft:()=>draft,setDraft:value=>{draft=value;},getPantryDraft:()=>pantryDraft,setPantryDraft:value=>{pantryDraft=value;},
  captureLocal:()=>clone({state,draftSettings:draft,pantryFormDraft:pantryDraft}),restoreLocal:value=>{state=value.state;draft=value.draftSettings;pantryDraft=value.pantryFormDraft;},
  validateState:value=>{aggregateShopping(value.plan,value.inventory);return clone(value);},
  persist:()=>{persistCount++;persisted=clone({state,draftSettings:draft,pantryFormDraft:pantryDraft});},storageAvailable:()=>true,refresh:()=>{refreshCount++;},toast:message=>toasts.push(message)
 };
 const sessions=[],calls={initialize:[],submit:[],partner:[]};let remote=shared(),revision=1,submit=async mutation=>{remote=applyMutation(remote,mutation);return {snapshot:clone(remote),revision:++revision};};
 const transport=async options=>{
  const session={options,destroyed:false};sessions.push(session);
  session.client={available:true,destroy:()=>{session.destroyed=true;},signIn:async()=>options.onAuth(owner),signOut:async()=>options.onAuth(null),initialize:async snapshot=>{calls.initialize.push(clone(snapshot));remote=clone(snapshot);return {snapshot,revision:1};},submit:async mutation=>{calls.submit.push(clone(mutation));return submit(mutation);},setPartnerEmail:async email=>{calls.partner.push(email);}};
  return session.client;
 };
 const controller=installCloudSync(adapter,{config:{projectId:'test-project'},transport});
 return {adapter,controller,e:selector=>elements.get(selector),elements,controls,calls,sessions,personal,storage,toasts,navigator,
  get state(){return state;},get draft(){return draft;},get pantryDraft(){return pantryDraft;},get persisted(){return persisted;},get persistCount(){return persistCount;},get refreshCount(){return refreshCount;},
  setRemote:value=>{remote=clone(value);},setSubmit:value=>{submit=value;},
  emitAuth:value=>sessions.at(-1).options.onAuth(value),emitHome:value=>sessions.at(-1).options.onHome(value),emitData:(value,metadata={revision:1})=>sessions.at(-1).options.onData(value,metadata),emitStatus:state=>sessions.at(-1).options.onStatus({state}),
  emitWindow:type=>{for(const callback of windowListeners.get(type)||[])callback({});},
  cleanup:()=>{controller.destroy();for(const [key,descriptor] of oldGlobals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
 };
}
async function connected(){const h=setup();await tick();h.emitAuth(owner);h.emitHome(home);h.emitData(shared());return h;}

test('personal edits stay independent when signing in, changing shared data and signing out',async()=>{
 const h=setup();try{
  await tick();
  await h.controller.mutate(()=>{h.state.inventory.push({ingredientId:'egg',quantity:2});});
  const personal=clone(h.adapter.captureLocal());assert.equal(h.persistCount,1);
  h.emitAuth(owner);h.emitHome(home);h.emitData(shared());
  assert.deepEqual(h.state.inventory,[]);assert.equal(h.calls.initialize.length,0);
  await h.controller.mutate(()=>{h.state.inventory.push({ingredientId:'milk',quantity:100});});
  assert.equal(h.state.inventory.find(row=>row.ingredientId==='milk').quantity,100);
  assert.equal(h.persistCount,1,'shared records never write the personal local source');
  await h.e('#cloud-sign-out').emit('click');
  assert.deepEqual(h.adapter.captureLocal(),personal);assert.deepEqual(h.persisted,personal);
 }finally{h.cleanup();}
});

test('an existing server record wins first cloud load without uploading local defaults',async()=>{
 const h=setup();try{
  await tick();h.emitAuth(owner);h.emitHome(home);
  const cloud=shared(9);cloud.state.inventory=[{ingredientId:'egg',quantity:9}];cloud.preferences.avoidText+='、香菜';
  h.emitData(cloud,{revision:12});
  assert.deepEqual(h.state,cloud.state);assert.equal(h.draft.avoidText,cloud.preferences.avoidText);
  assert.equal(h.calls.initialize.length,0);assert.equal(h.calls.submit.length,0);assert.match(h.e('#cloud-status').textContent,/已同步/);
 }finally{h.cleanup();}
});

test('a missing cloud record prompts explicit initialization and locks shared edits',async()=>{
 const h=setup();try{
  await tick();h.emitAuth(owner);h.emitHome(home);h.emitData(null);
  assert.equal(h.e('#cloud-setup').hidden,false);assert.equal(h.calls.initialize.length,0);
  assert.ok(h.controls.every(control=>control.disabled));
  await assert.rejects(h.controller.mutate(()=>{throw new Error('must not edit');}),/還沒準備好/);
  await h.e('#cloud-initialize').emit('click');
  assert.equal(h.calls.initialize.length,1);assert.equal(h.e('#cloud-setup').hidden,true);assert.match(h.e('#cloud-status').textContent,/已同步/);
 }finally{h.cleanup();}
});

test('membership revocation clears household data from the display and prevents edits',async()=>{
 const h=await connected();try{
  assert.notEqual(h.state.settings.seed,h.personal.state.settings.seed);
  h.e('#recipe-dialog').open=true;h.e('#replacement-dialog').open=true;
  h.emitHome(null);h.emitStatus('forbidden');
  assert.deepEqual(h.adapter.captureLocal(),h.personal);assert.equal(h.e('#recipe-dialog').open,false);assert.equal(h.e('#replacement-dialog').open,false);
  assert.match(h.e('#cloud-status').textContent,/尚未加入/);assert.ok(h.controls.every(control=>control.disabled));
  await assert.rejects(h.controller.mutate(()=>{}),/還沒準備好/);
 }finally{h.cleanup();}
});

test('failed shared writes roll back to server state and never contaminate personal storage',async()=>{
 const h=await connected();try{
  const latest=clone(h.state);h.setSubmit(async()=>{throw Object.assign(new Error('network'),{code:'unavailable'});});
  await assert.rejects(h.controller.mutate(()=>{h.state.inventory.push({ingredientId:'egg',quantity:7});}),{code:'unavailable'});
  assert.deepEqual(h.state,latest);assert.equal(h.persistCount,0);assert.equal(h.e('#cloud-error').hidden,false);
  assert.match(h.e('#cloud-status').textContent,/結果尚未確認/);
  assert.ok(h.controls.every(control=>control.disabled),'ambiguous results prevent a second shared action');
  await h.e('#cloud-sign-out').emit('click');assert.deepEqual(h.adapter.captureLocal(),h.personal);
 }finally{h.cleanup();}
});

test('a previous account pending write cannot overwrite the next account view',async()=>{
 const h=await connected();try{
  let resolve;h.setSubmit(()=>new Promise(done=>{resolve=done;}));
  const pending=h.controller.mutate(()=>{h.state.inventory.push({ingredientId:'egg',quantity:7});});
  h.emitAuth(partner);h.emitHome({...home,isOwner:false});
  const nextAccount=shared(6);nextAccount.state.inventory=[{ingredientId:'milk',quantity:6}];h.emitData(nextAccount,{revision:20});
  resolve({snapshot:shared(99),revision:99});await pending;
  assert.deepEqual(h.state,nextAccount.state);assert.match(h.e('#cloud-account').textContent,/partner@example.com/);
 }finally{h.cleanup();}
});

test('callbacks from a destroyed connection cannot replace a reconnected household',async()=>{
 const h=await connected();try{
  const previous=h.sessions.at(-1);h.emitStatus('error');await h.e('#cloud-retry').emit('click');await tick();
  assert.equal(previous.destroyed,true);
  h.emitAuth(owner);h.emitHome(home);const current=shared(8);h.emitData(current,{revision:8});
  previous.options.onData(shared(99),{revision:99});previous.options.onAuth(null);previous.options.onHome(null);previous.options.onStatus({state:'error'});
  assert.deepEqual(h.state,current.state);assert.equal(h.controller.isSignedIn(),true);assert.match(h.e('#cloud-status').textContent,/已同步/);
 }finally{h.cleanup();}
});

test('unfinished account drafts remain local while remote updates apply to untouched fields',async()=>{
 const h=await connected();try{
  h.draft.weekdayPeople='';h.pantryDraft.quantity='';h.controller.saveAccountDrafts();
  const next=shared();next.preferences.weekendPeople='3';h.emitData(next,{revision:2});
  assert.equal(h.draft.weekdayPeople,'');assert.equal(h.draft.weekendPeople,'3');assert.equal(h.pantryDraft.quantity,'');
  const saved=JSON.parse(h.storage.get('weekly-table-cloud-drafts-v1:owner'));
  assert.equal(saved.draft.weekdayPeople,'');assert.equal(saved.state,undefined);assert.equal(h.persistCount,0);
 }finally{h.cleanup();}
});

test('shared edits stay locked offline without changing the local personal source',async()=>{
 const h=await connected();try{
  const before=clone(h.state);h.navigator.onLine=false;h.emitWindow('offline');
  assert.match(h.e('#cloud-status').textContent,/離線/);assert.ok(h.controls.every(control=>control.disabled));
  await assert.rejects(h.controller.mutate(()=>{h.state.inventory=[];}),/離線/);
  assert.deepEqual(h.state,before);assert.equal(h.persistCount,0);
 }finally{h.cleanup();}
});

test('debounced valid preferences sync without applying them to the current menu',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const h=await connected();try{
  const applied=clone(h.state.settings);h.draft.avoidText+='、香菜';h.draft.weekdayPeople='';
  h.controller.noteDraftChange();assert.match(h.e('#save-state').innerHTML,/待同步/);
  t.mock.timers.tick(701);await tick();
  assert.equal(h.calls.submit.length,1);assert.deepEqual(h.state.settings,applied);
  assert.match(h.draft.avoidText,/香菜/);assert.equal(h.draft.weekdayPeople,'');
  assert.deepEqual(h.calls.submit[0].preferences.map(operation=>operation.key),['avoidText']);
  assert.match(h.e('#save-state').innerHTML,/已同步/);
 }finally{h.cleanup();t.mock.timers.reset();}
});

test('same-field remote preference changes during debounce retain the local draft and show conflict',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const h=await connected();try{
  h.draft.avoidText+='、香菜';h.controller.noteDraftChange();
  const remote=shared();remote.preferences.avoidText+='、洋蔥';h.setRemote(remote);h.emitData(remote,{revision:2});
  t.mock.timers.tick(701);await tick();
  assert.equal(h.calls.submit.length,1);assert.match(h.draft.avoidText,/香菜/);
  assert.match(h.e('#cloud-error').textContent,/相同內容/);assert.match(h.e('#save-state').innerHTML,/待確認/);assert.match(h.e('#cloud-status').textContent,/設定衝突/);
  t.mock.timers.tick(2000);await tick();assert.equal(h.calls.submit.length,1,'a conflicted draft does not overwrite remote settings on a retry loop');
  assert.deepEqual(h.state,remote.state);assert.equal(h.persistCount,0);
 }finally{h.cleanup();t.mock.timers.reset();}
});

test('typing during another shared save syncs afterward without resubmitting that save',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const h=await connected();try{
  let server=shared(),release;
  h.setSubmit(mutation=>new Promise(resolve=>{release=()=>{server=applyMutation(server,mutation);resolve({snapshot:clone(server),revision:2});};}));
  const pending=h.controller.mutate(()=>{h.state.inventory.push({ingredientId:'milk',quantity:100});});
  h.draft.avoidText+='、香菜';h.controller.noteDraftChange();t.mock.timers.tick(701);await tick();
  assert.equal(h.calls.submit.length,1,'busy saves defer the preference write');
  release();await pending;
  h.setSubmit(async mutation=>{server=applyMutation(server,mutation);return {snapshot:clone(server),revision:3};});
  t.mock.timers.tick(701);await tick();
  assert.equal(h.calls.submit.length,2);assert.equal(h.calls.submit[1].inventory.length,0);
  assert.equal(h.state.inventory.find(row=>row.ingredientId==='milk').quantity,100);assert.match(h.draft.avoidText,/香菜/);
  assert.match(h.e('#save-state').innerHTML,/已同步/);
 }finally{h.cleanup();t.mock.timers.reset();}
});

test('typing while the first cloud record loads preserves those edits and hydrates untouched preferences',async()=>{
 const h=setup();try{
  await tick();h.emitAuth(owner);
  h.draft.weekdayPeople='';h.draft.avoidText+='、香菜';h.pantryDraft.quantity='';
  h.controller.noteDraftChange();
  const remote=shared(7);remote.preferences.weekendPeople='3';remote.preferences.favorites=['美式'];remote.preferences.avoidText+='、洋蔥';
  h.emitHome(home);h.emitData(remote,{revision:7});
  assert.deepEqual(h.state,remote.state,'the server menu still wins initial loading');
  assert.equal(h.draft.weekdayPeople,'','the unfinished field typed during connecting survives');
  assert.match(h.draft.avoidText,/香菜/);assert.doesNotMatch(h.draft.avoidText,/洋蔥/);
  assert.equal(h.draft.weekendPeople,'3');assert.deepEqual(h.draft.favorites,['美式'],'untouched personal fields adopt the shared preference');
  assert.equal(h.pantryDraft.quantity,'');assert.equal(h.calls.submit.length,0);assert.equal(h.calls.initialize.length,0);
  const saved=JSON.parse(h.storage.get('weekly-table-cloud-drafts-v1:owner'));
  assert.equal(saved.draft.weekdayPeople,'');assert.equal(saved.pantryDraft.quantity,'');
  assert.equal(saved.basePreferences.weekendPeople,'3');assert.match(h.e('#save-state').innerHTML,/待同步/);
  h.emitAuth(null);assert.deepEqual(h.adapter.captureLocal(),h.personal,'connecting edits do not alter the personal local source');
 }finally{h.cleanup();}
});

test('a later synchronized metadata event does not dismiss an unresolved preference conflict',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const h=await connected();try{
  h.draft.avoidText+='、香菜';h.controller.noteDraftChange();
  const remote=shared();remote.preferences.avoidText+='、洋蔥';h.setRemote(remote);h.emitData(remote,{revision:2});
  t.mock.timers.tick(701);await tick();
  const conflict=h.e('#cloud-error').textContent;assert.match(conflict,/相同內容/);assert.equal(h.e('#cloud-error').hidden,false);
  h.emitStatus('synced');h.emitData(remote,{revision:3});h.emitStatus('synced');
  assert.equal(h.e('#cloud-error').textContent,conflict);assert.equal(h.e('#cloud-error').hidden,false);
  assert.match(h.draft.avoidText,/香菜/);assert.match(h.e('#save-state').innerHTML,/待確認/);
  t.mock.timers.tick(2000);await tick();assert.equal(h.calls.submit.length,1);
 }finally{h.cleanup();t.mock.timers.reset();}
});

const pendingKey='weekly-table-cloud-pending-v1:test-project:owner';

test('retrying a committed save with a lost response reuses its exact mutation and never adds stock twice',async()=>{
 const h=await connected();try{
  let server=shared(),applications=0,attempts=0;const receipts=new Set();
  h.setSubmit(async mutation=>{
   attempts++;if(!receipts.has(mutation.id)){server=applyMutation(server,mutation);receipts.add(mutation.id);applications++;}
   if(attempts===1)throw Object.assign(new Error('response was lost'),{code:'unavailable'});
   return {snapshot:clone(server),revision:2};
  });
  await assert.rejects(h.controller.mutate(()=>{h.state.inventory.push({ingredientId:'egg',quantity:7});}),{code:'unavailable'});
  const pending=JSON.parse(h.storage.get(pendingKey));
  assert.equal(pending.version,1);assert.equal(pending.uid,owner.uid);assert.equal(pending.mutation.baseRevision,1);
  assert.deepEqual(pending.mutation,h.calls.submit[0]);assert.match(h.e('#cloud-status').textContent,/結果尚未確認/);
  let secondActionRan=false;await assert.rejects(h.controller.mutate(()=>{secondActionRan=true;}),/還沒準備好/);assert.equal(secondActionRan,false);
  await h.e('#cloud-retry').emit('click');
  assert.deepEqual(h.calls.submit[1],pending.mutation);assert.equal(applications,1);
  assert.equal(h.state.inventory.find(row=>row.ingredientId==='egg').quantity,7);
  assert.equal(JSON.parse(h.storage.get(pendingKey)),null);assert.ok(h.controls.every(control=>!control.disabled));assert.match(h.e('#cloud-status').textContent,/已同步/);
 }finally{h.cleanup();}
});

test('a server receipt acknowledges an uncertain save and unlocks editing without another submission',async()=>{
 const h=await connected();try{
  let server=shared();h.setSubmit(async mutation=>{server=applyMutation(server,mutation);throw Object.assign(new Error('lost acknowledgment'),{code:'deadline-exceeded'});});
  await assert.rejects(h.controller.mutate(()=>{h.state.inventory.push({ingredientId:'milk',quantity:100});}),{code:'deadline-exceeded'});
  const pending=JSON.parse(h.storage.get(pendingKey));assert.ok(pending);assert.ok(h.controls.every(control=>control.disabled));
  h.emitData(server,{revision:2,recentMutationIds:[pending.mutation.id]});h.emitStatus('synced');
  assert.equal(JSON.parse(h.storage.get(pendingKey)),null);assert.equal(h.calls.submit.length,1);
  assert.equal(h.state.inventory.find(row=>row.ingredientId==='milk').quantity,100);assert.ok(h.controls.every(control=>!control.disabled));assert.equal(h.e('#cloud-error').hidden,true);
 }finally{h.cleanup();}
});

test('account reconnect restores the same pending mutation while another account stays independent',async()=>{
 const h=await connected();try{
  const server=shared();h.setSubmit(async()=>{throw Object.assign(new Error('network'),{code:'unavailable'});});
  await assert.rejects(h.controller.mutate(()=>{h.state.inventory.push({ingredientId:'egg',quantity:3});}),{code:'unavailable'});
  const original=JSON.parse(h.storage.get(pendingKey));
  h.emitAuth(null);h.emitAuth(partner);h.emitHome({...home,isOwner:false});h.emitData(server);
  assert.doesNotMatch(h.e('#cloud-status').textContent,/結果尚未確認/);assert.ok(h.controls.every(control=>!control.disabled));
  h.emitAuth(null);h.emitAuth(owner);h.emitHome(home);h.emitData(server);
  assert.match(h.e('#cloud-status').textContent,/結果尚未確認/);assert.ok(h.controls.every(control=>control.disabled));
  h.setSubmit(async mutation=>({snapshot:applyMutation(server,mutation),revision:2}));
  await h.e('#cloud-retry').emit('click');
  assert.deepEqual(h.calls.submit.at(-1),original.mutation);assert.equal(h.state.inventory.find(row=>row.ingredientId==='egg').quantity,3);
  assert.equal(JSON.parse(h.storage.get(pendingKey)),null);assert.equal(h.persistCount,0);
 }finally{h.cleanup();}
});

test('a definite conflict clears the persisted pending mutation and keeps the conflict visible',async()=>{
 const h=await connected();try{
  const latest=clone(h.state);h.setSubmit(async()=>{throw Object.assign(new Error('same meal changed'),{code:'sync/conflict'});});
  await assert.rejects(h.controller.mutate(()=>{h.state.inventory.push({ingredientId:'egg',quantity:3});}),{code:'sync/conflict'});
  assert.equal(JSON.parse(h.storage.get(pendingKey)),null);assert.deepEqual(h.state,latest);
  assert.ok(h.controls.every(control=>!control.disabled));assert.match(h.e('#cloud-error').textContent,/相同內容/);
  h.emitStatus('synced');assert.equal(h.e('#cloud-error').hidden,false);
 }finally{h.cleanup();}
});

test('an expired uncertain save requires explicit review instead of replaying an old stock delta',async()=>{
 const h=await connected();try{
  h.setSubmit(async()=>{throw Object.assign(new Error('network'),{code:'unavailable'});});
  await assert.rejects(h.controller.mutate(()=>{h.state.inventory.push({ingredientId:'egg',quantity:3});}),{code:'unavailable'});
  const latest=shared(2);latest.state.inventory=[{ingredientId:'egg',quantity:10}];
  h.setSubmit(async()=>{throw Object.assign(new Error('receipt expired'),{code:'sync/expired-mutation',latestSnapshot:latest,latestRevision:130});});
  await h.e('#cloud-retry').emit('click');
  assert.equal(JSON.parse(h.storage.get(pendingKey)).reviewOnly,true);assert.match(h.e('#cloud-retry').textContent,/已核對/);assert.ok(h.controls.every(control=>control.disabled));
  assert.deepEqual(h.state,latest.state,'the review screen displays the server-read snapshot carried by the expired receipt error');
  await h.e('#cloud-retry').emit('click');
  assert.equal(h.calls.submit.length,2,'explicit review discards the expired action without a third submission');
  assert.equal(JSON.parse(h.storage.get(pendingKey)),null);assert.equal(h.state.inventory.find(row=>row.ingredientId==='egg').quantity,10);assert.ok(h.controls.every(control=>!control.disabled));
 }finally{h.cleanup();}
});

test('a recovered stock receipt clears only the matching submitted pantry amount',async()=>{
 const h=await connected();try{
  h.pantryDraft.ingredientId='egg';h.pantryDraft.quantity='2.00';h.controller.saveAccountDrafts();
  let server=shared();h.setSubmit(async mutation=>{server=applyMutation(server,mutation);throw Object.assign(new Error('lost response'),{code:'unavailable'});});
  await assert.rejects(h.controller.mutate(()=>{h.state.inventory.push({ingredientId:'egg',quantity:2});}),{code:'unavailable'});
  assert.equal(h.pantryDraft.quantity,'2.00','an uncertain save retains its unfinished form until acknowledged');
  const pending=JSON.parse(h.storage.get(pendingKey));h.emitData(server,{revision:2,recentMutationIds:[pending.mutation.id]});
  assert.equal(h.pantryDraft.quantity,'');assert.equal(h.pantryDraft.ingredientId,'egg');
  assert.equal(h.state.inventory.find(row=>row.ingredientId==='egg').quantity,2);
  assert.equal(JSON.parse(h.storage.get('weekly-table-cloud-drafts-v1:owner')).pantryDraft.quantity,'');
 }finally{h.cleanup();}
});

test('manual recovery preserves a differently edited pantry amount instead of clearing the new draft',async()=>{
 const h=await connected();try{
  h.pantryDraft.ingredientId='egg';h.pantryDraft.quantity='2';h.controller.saveAccountDrafts();
  let server=shared();h.setSubmit(async mutation=>{server=applyMutation(server,mutation);throw Object.assign(new Error('lost response'),{code:'unavailable'});});
  await assert.rejects(h.controller.mutate(()=>{h.state.inventory.push({ingredientId:'egg',quantity:2});}),{code:'unavailable'});
  h.pantryDraft.quantity='5';h.controller.saveAccountDrafts();
  h.setSubmit(async()=>({snapshot:server,revision:2}));await h.e('#cloud-retry').emit('click');
  assert.equal(h.pantryDraft.quantity,'5');assert.equal(h.pantryDraft.ingredientId,'egg');
  assert.equal(h.state.inventory.find(row=>row.ingredientId==='egg').quantity,2,'the acknowledgment does not apply the new draft amount');
  assert.equal(JSON.parse(h.storage.get('weekly-table-cloud-drafts-v1:owner')).pantryDraft.quantity,'5');assert.equal(JSON.parse(h.storage.get(pendingKey)),null);
 }finally{h.cleanup();}
});

test('Firestore map key ordering never marks identical preferences as pending or submits empty writes',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const h=setup();try{
  await tick();h.emitAuth(owner);h.emitHome(home);
  const remote=shared();remote.preferences=Object.fromEntries(Object.entries(remote.preferences).reverse());h.setRemote(remote);h.emitData(remote);
  assert.equal(h.e('#cloud-status').textContent,'已同步');assert.match(h.e('#save-state').innerHTML,/已同步/);
  t.mock.timers.tick(180000);await tick();
  assert.equal(h.calls.submit.length,0,'key-order differences must never create a retry loop');
  assert.equal(h.e('#cloud-status').textContent,'已同步');
 }finally{h.cleanup();t.mock.timers.reset();}
});

test('one-minute fallback sends valid unsent preferences while leaving menu settings unchanged',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const h=await connected();try{
  const applied=clone(h.state.settings);h.draft.avoidText+='、香菜';h.controller.saveAccountDrafts();
  t.mock.timers.tick(59999);await tick();assert.equal(h.calls.submit.length,0);
  t.mock.timers.tick(1);await tick();
  assert.equal(h.calls.submit.length,1);assert.deepEqual(h.calls.submit[0].preferences.map(operation=>operation.key),['avoidText']);
  assert.deepEqual(h.state.settings,applied);assert.equal(h.e('#cloud-status').textContent,'已同步');
  t.mock.timers.tick(120000);await tick();assert.equal(h.calls.submit.length,1,'already synchronized preferences do not write every minute');
 }finally{h.cleanup();t.mock.timers.reset();}
});

test('restored valid preferences sync after loading without requiring another keystroke',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const h=setup();try{
  await tick();const remote=shared(),draft=clone(remote.preferences);draft.avoidText+='、香菜';
  h.storage.set('weekly-table-cloud-drafts-v1:owner',JSON.stringify({version:1,draft,basePreferences:remote.preferences,pantryDraft:{ingredientId:'egg',quantity:'2'}}));
  h.emitAuth(owner);h.emitHome(home);h.emitData(remote);
  assert.equal(h.e('#cloud-status').textContent,'設定待同步');
  t.mock.timers.tick(701);await tick();
  assert.equal(h.calls.submit.length,1);assert.match(h.draft.avoidText,/香菜/);assert.equal(h.e('#cloud-status').textContent,'已同步');
 }finally{h.cleanup();t.mock.timers.reset();}
});

test('a restored draft keeps its original before-values across remote changes and reload',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const h=await connected();try{
  h.draft.avoidText+='、香菜';h.controller.noteDraftChange();
  const remote=shared();remote.preferences.avoidText+='、洋蔥';h.setRemote(remote);h.emitData(remote,{revision:2});
  const saved=JSON.parse(h.storage.get('weekly-table-cloud-drafts-v1:owner'));
  assert.doesNotMatch(saved.preferenceOrigin.preferences.avoidText,/洋蔥/,'the original before-value survives saving a newer server snapshot');
  h.emitAuth(null);h.emitAuth(owner);h.emitHome(home);h.emitData(remote,{revision:2});
  t.mock.timers.tick(701);await tick();
  assert.equal(h.calls.submit.length,1);assert.match(h.e('#cloud-status').textContent,/設定衝突/);assert.match(h.e('#save-state').innerHTML,/待確認/);
  assert.equal(h.e('#cloud-error').hidden,false);assert.match(h.draft.avoidText,/香菜/);assert.doesNotMatch(h.draft.avoidText,/洋蔥/);
  t.mock.timers.tick(180000);await tick();assert.equal(h.calls.submit.length,1,'minute checks never silently override a same-field conflict');
  h.emitAuth(null);h.emitAuth(owner);h.emitHome(home);h.emitData(remote,{revision:2});
  t.mock.timers.tick(61000);await tick();assert.equal(h.calls.submit.length,1,'conflict acknowledgement is still required after reopening');
  assert.match(h.e('#cloud-status').textContent,/設定衝突/);
 }finally{h.cleanup();t.mock.timers.reset();}
});

test('minute checks retain invalid unfinished input locally without writing or reporting a false pending state',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const h=await connected();try{
  h.draft.weekdayPeople='';h.draft.slots=[];h.controller.noteDraftChange();
  t.mock.timers.tick(121000);await tick();
  assert.equal(h.calls.submit.length,0);assert.equal(h.draft.weekdayPeople,'');assert.deepEqual(h.draft.slots,[]);
  assert.equal(h.e('#cloud-status').textContent,'已同步');
 }finally{h.cleanup();t.mock.timers.reset();}
});

test('minute checks recover an uncertain committed write with the same ID instead of duplicating stock',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const h=await connected();try{
  let server=shared(),attempts=0,applications=0;const receipts=new Set();
  h.setSubmit(async mutation=>{attempts++;if(!receipts.has(mutation.id)){server=applyMutation(server,mutation);receipts.add(mutation.id);applications++;}if(attempts===1)throw Object.assign(new Error('lost response'),{code:'unavailable'});return {snapshot:clone(server),revision:2};});
  await assert.rejects(h.controller.mutate(()=>{h.state.inventory.push({ingredientId:'egg',quantity:3});}),{code:'unavailable'});
  const pending=JSON.parse(h.storage.get(pendingKey));t.mock.timers.tick(60000);await tick();
  assert.equal(h.calls.submit.length,2);assert.deepEqual(h.calls.submit[1],pending.mutation);assert.equal(applications,1);
  assert.equal(h.state.inventory.find(item=>item.ingredientId==='egg').quantity,3);assert.equal(JSON.parse(h.storage.get(pendingKey)),null);assert.equal(h.e('#cloud-status').textContent,'已同步');
 }finally{h.cleanup();t.mock.timers.reset();}
});

test('automatic checks never acknowledge an expired save on the user behalf',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const h=await connected();try{
  h.setSubmit(async()=>{throw Object.assign(new Error('network'),{code:'unavailable'});});
  await assert.rejects(h.controller.mutate(()=>{h.state.inventory.push({ingredientId:'egg',quantity:3});}),{code:'unavailable'});
  const latest=shared();h.setSubmit(async()=>{throw Object.assign(new Error('expired'),{code:'sync/expired-mutation',latestSnapshot:latest,latestRevision:130});});
  t.mock.timers.tick(60000);await tick();assert.equal(JSON.parse(h.storage.get(pendingKey)).reviewOnly,true);
  t.mock.timers.tick(180000);await tick();assert.equal(h.calls.submit.length,2);assert.equal(JSON.parse(h.storage.get(pendingKey)).reviewOnly,true);
  assert.equal(h.e('#cloud-status').textContent,'儲存待核對');assert.ok(h.controls.every(control=>control.disabled));
 }finally{h.cleanup();t.mock.timers.reset();}
});

test('automatic checks skip signed-out accounts, offline sessions and destroyed controllers',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const h=await connected();try{
  h.draft.avoidText+='、香菜';h.controller.saveAccountDrafts();h.navigator.onLine=false;h.emitWindow('offline');
  t.mock.timers.tick(60000);await tick();assert.equal(h.calls.submit.length,0);
  h.emitAuth(null);h.navigator.onLine=true;t.mock.timers.tick(60000);await tick();assert.equal(h.calls.submit.length,0);
  h.emitAuth(owner);h.emitHome(home);h.emitData(shared());h.controller.destroy();
  t.mock.timers.tick(180000);await tick();assert.equal(h.calls.submit.length,0);
 }finally{h.cleanup();t.mock.timers.reset();}
});
