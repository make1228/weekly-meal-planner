import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAccountSync} from '../../account/transport.js';
import {emptyAccountSnapshot} from '../../account/model.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(){
 const app={name:'meal-public-test',options:{projectId:'isolated-test'}};
 const auth={currentUser:null},calls=[],homes=[],records=[],listeners=[];
 let authCallback,reauth=deferred(),profileReply=null,revoke=deferred();
 const snapshot=emptyAccountSnapshot(),record={snapshot,revision:1,recentMutationIds:[],profile:{displayName:'',equipment:[]},profileRevision:1,dataPath:'unused'};
 const sdk={getApps:()=>[app],initializeApp:()=>app,getAuth:()=>auth,getFirestore:()=>({}),getFunctions:()=>({}),initializeAppCheck(){calls.push({action:'app-check-initialize'});},ReCaptchaEnterpriseProvider:class{},
  httpsCallable:()=>async request=>{calls.push(request);if(request.action==='profile'&&profileReply)return profileReply.promise;return {data:structuredClone(record)};},
  onAuthStateChanged:(_,cb)=>{authCallback=cb;return ()=>{};},
  doc:(_,path)=>path,onSnapshot:(path,...args)=>{listeners.push({path,callback:args.find(x=>typeof x==='function')});return ()=>{};},
  GoogleAuthProvider:class{setCustomParameters(){}},OAuthProvider:class{addScope(){}static credentialFromResult(){return {accessToken:'fixture'};}},
  reauthenticateWithPopup:()=>reauth.promise,linkWithPopup:async()=>{calls.push({action:'link'});},revokeAccessToken:()=>revoke.promise,signOut:async()=>{auth.currentUser=null;await authCallback(null);}
 };
 const client=await createAccountSync({config:{mode:'public',environment:'test',firebase:{projectId:'isolated-test'},appCheckSiteKey:'fixture'},sdk,onHome:value=>homes.push(value),onData:(value,meta)=>records.push({value,meta})});
 const user=(uid,provider='google.com')=>({uid,email:uid+'@example.test',providerData:[{providerId:provider}]});
 const switchTo=async value=>{auth.currentUser=value;await authCallback(value);};
 await switchTo(user('A'));
 return {sdk,client,calls,homes,records,listeners,user,switchTo,reauth,revoke,profileHold:()=>profileReply=deferred()};
}
test('provider linking is cancelled if the UID changes during original-provider reauthentication',async()=>{
 const f=await fixture(),pending=f.client.linkProvider('apple.com',true);
 await f.switchTo(f.user('B'));f.reauth.resolve({});
 await assert.rejects(pending,e=>e.code==='sync/signed-out');
 assert.equal(f.calls.filter(x=>x.action==='link').length,0);assert.equal(f.client.getUser().uid,'B');f.client.destroy();
});
test('account deletion cannot target the next signed-in user after an outstanding reauthentication',async()=>{
 const f=await fixture(),pending=f.client.deleteAccount(true);
 await f.switchTo(f.user('B'));f.reauth.resolve({});
 await assert.rejects(pending,e=>e.code==='sync/signed-out');
 assert.equal(f.calls.filter(x=>x.action==='deleteAccount').length,0);f.client.destroy();
});
test('a late profile response cannot install the previous UID profile after switching accounts',async()=>{
 const f=await fixture(),held=f.profileHold(),pending=f.client.saveProfile({displayName:'PRIVATE_A',equipment:[]},1);
 await f.switchTo(f.user('B'));held.resolve({data:{profile:{displayName:'PRIVATE_A',equipment:[]},profileRevision:2}});
 await assert.rejects(pending,e=>e.code==='sync/signed-out');
 assert.equal(f.client.getProfile().displayName,'');assert.ok(!JSON.stringify(f.homes.at(-1)).includes('PRIVATE_A'));f.client.destroy();
});
test('late snapshots from an unsubscribed previous UID are ignored after account switching',async()=>{
 const f=await fixture(),old=f.listeners.find(x=>x.path==='unused').callback;
 await f.switchTo(f.user('B'));const count=f.records.length;
 old({metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>({snapshot:emptyAccountSnapshot(),revision:99})});
 assert.equal(f.records.length,count);f.client.destroy();
});
test('sign-out clears profile and prevents an outstanding Apple revocation flow from deleting another UID',async()=>{
 const f=await fixture();await f.switchTo(f.user('A','apple.com'));
 const pending=f.client.deleteAccount(true);f.reauth.resolve({});
 await new Promise(r=>setImmediate(r));
 await f.switchTo(f.user('B'));f.revoke.resolve();
 await assert.rejects(pending,e=>e.code==='sync/signed-out');
 assert.equal(f.calls.filter(x=>x.action==='deleteAccount').length,0);
 await f.client.signOut();assert.equal(f.client.getProfile(),null);assert.equal(f.client.getUser(),null);assert.equal(f.homes.at(-1),null);f.client.destroy();
});

test('an unsupported catalog version stops the live session instead of reinterpreting saved meals',async()=>{
 const f=await fixture(),callback=f.listeners.find(x=>x.path==='unused').callback;
 const count=f.records.length;
 callback({metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>({snapshot:emptyAccountSnapshot(),revision:99,catalogVersion:'unsupported-future-version'})});
 assert.equal(f.records.length,count);assert.equal(f.homes.at(-1),null);assert.equal(f.client.getProfile(),null);f.client.destroy();
});

test('reconnecting the same Firebase app does not reinitialize App Check or emulator transports',async()=>{
 const f=await fixture();f.client.destroy();
 const second=await createAccountSync({config:{mode:'public',environment:'test',firebase:{projectId:'isolated-test'},appCheckSiteKey:'fixture'},sdk:f.sdk});
 assert.equal(second.available,true);assert.equal(f.calls.filter(x=>x.action==='app-check-initialize').length,1);second.destroy();
});

test('same-UID auth refresh during explicit linking does not cancel the approved account flow',async()=>{
 const f=await fixture(),pending=f.client.linkProvider('apple.com',true);
 await f.switchTo(f.user('A'));f.reauth.resolve({});await pending;
 assert.equal(f.calls.filter(x=>x.action==='link').length,1);assert.equal(f.client.getUser().uid,'A');f.client.destroy();
});
