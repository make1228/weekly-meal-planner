import {createHash} from 'node:crypto';
import {applyMutation} from '../sync-model.js';
import {emptyAccountSnapshot,validateAccountSnapshot,validateProfile,assertSafeJSON,retainAccountSnapshot,taipeiDate} from '../account/model.js';
import {getReplacementOptions,aggregateShopping} from '../engine.js';
import {viewWeek,weekWindow} from '../weeks.js';
import {commandMutation} from '../account/commands.js';
const clone=x=>structuredClone(x);
const error=(code,message,details={})=>Object.assign(new Error(message),{code,details});
const idPattern=/^[A-Za-z0-9_-]{8,100}$/;
const accountPath=uid=>'mealPlannerUsers/'+uid;
const bindingPath=uid=>'mealPlannerLegacyBindings/'+uid;
const privatePath=uid=>accountPath(uid)+'/data/current';
const allowedActions=new Set(['bootstrap','submit','command','profile','export','replace','deleteAccount','deletionStatus','options','shopping']);
function canonical(value){return JSON.stringify(value);}
function requireIdentity(context,now){
 if(!context?.uid||typeof context.uid!=='string'||context.uid.includes('/'))throw error('unauthenticated','請先登入。');
 if(!['google.com','apple.com'].includes(context.provider))throw error('permission-denied','請使用Google或Apple登入。');
 if(!Number.isFinite(context.authTime)||context.authTime>now/1000+60)throw error('unauthenticated','登入資訊無效。');
}
function recent(context,now){if(now/1000-context.authTime>300)throw error('failed-precondition','請重新驗證登入後再操作。',{reason:'reauth-required'});}
function allowedKeys(object,keys){if(!object||typeof object!=='object'||Array.isArray(object)||Object.keys(object).some(k=>!keys.includes(k)))throw error('invalid-argument','不允許的請求欄位。');}
function verifyWindow(snapshot,today){
 const kept=retainAccountSnapshot(snapshot,today);
 if(kept.state.plan.startDate!==snapshot.state.plan.startDate||snapshot.state.plan.nextWeek?.plan.startDate!==kept.state.plan.nextWeek.plan.startDate)throw error('failed-precondition','週次已變更，請先重新載入。',{reason:'week-window'});
}
function result(record){return {snapshot:record.snapshot,revision:record.revision,recentMutationIds:record.recentMutationIds||[],updatedAt:record.updatedAt?.toDate?.()?.toISOString?.()||null};}
/** Actual transaction service used by Cloud Functions and emulator integration tests. */
export function createAccountService({db,auth,serverTimestamp,clock=()=>new Date()}){
 async function rateLimit(uid){
  const now=clock().getTime(),ref=db.doc('mealPlannerRateLimits/'+uid),bucket=Math.floor(now/60000);
  await db.runTransaction(async t=>{
   const old=(await t.get(ref)).data(),count=old?.bucket===bucket?old.count+1:1;
   if(count>120)throw error('resource-exhausted','操作太頻繁，請稍後重試。');
   t.set(ref,{bucket,count,expiresAt:new Date(now+120000)});
  });
 }
 async function resolve(t,uid){
  const ref=db.doc(accountPath(uid)),accountSnap=await t.get(ref);
  if(!accountSnap.exists||accountSnap.data().status!=='active')throw error('failed-precondition','帳號尚未準備好。');
  const account=accountSnap.data(),binding=(await t.get(db.doc(bindingPath(uid)))).data();
  const path=binding?.verified===true?'mealPlannerLegacyData/'+binding.sourceId:privatePath(uid);
  if(account.dataPath!==path)throw error('permission-denied','帳號資料對應不正確。');
  const dataRef=db.doc(path),dataSnap=await t.get(dataRef);
  if(!dataSnap.exists)throw error('failed-precondition','菜單資料尚未建立。');
  return {ref,account,dataRef,record:dataSnap.data(),legacy:binding?.verified===true};
 }
 async function bootstrap(uid){
  const today=taipeiDate(clock());
  return db.runTransaction(async t=>{
   const ref=db.doc(accountPath(uid)),old=await t.get(ref),binding=(await t.get(db.doc(bindingPath(uid)))).data(),deletionJob=await t.get(db.doc('mealPlannerDeletionJobs/'+uid));
   if(deletionJob.exists)throw error('failed-precondition','帳號刪除尚未完成，請查看進度並重試刪除。',{reason:'deleting'});
   const path=binding?.verified===true?'mealPlannerLegacyData/'+binding.sourceId:privatePath(uid);
   const dataRef=db.doc(path),data=await t.get(dataRef);
   if(old.exists&&old.data().status!=='active')throw error('failed-precondition','帳號正在刪除，請完成或重試刪除流程。',{reason:'deleting'});
   if(old.exists&&old.data().dataPath!==path)throw error('failed-precondition','資料遷移尚未完成。');
   if(binding?.verified===true&&!data.exists)throw error('failed-precondition','舊資料相容對應尚未完成。');
   const profile=old.exists?old.data().profile:{displayName:'',equipment:[]};
   const account=old.exists?old.data():{schemaVersion:2,ownerUid:uid,status:'active',profile,profileRevision:1,dataPath:path,createdAt:serverTimestamp(),updatedAt:serverTimestamp()};
   let record=data.exists?data.data():{schemaVersion:2,ownerUid:binding?.verified?'legacy:'+binding.sourceId:uid,snapshot:emptyAccountSnapshot(today),revision:1,recentMutationIds:[],updatedAt:serverTimestamp(),updatedBy:uid};
   const retained=retainAccountSnapshot(record.snapshot,today);
   validateAccountSnapshot(retained);
   if(canonical(record.snapshot)!==canonical(retained))record={...record,snapshot:retained,revision:record.revision+1,updatedAt:serverTimestamp(),updatedBy:uid};
   if(!old.exists)t.set(ref,account);
   if(!data.exists||record.revision!==data.data().revision)t.set(dataRef,record);
   return {schemaVersion:2,profile,profileRevision:account.profileRevision,dataPath:path,legacyShared:!!binding?.verified,...result(record)};
  });
 }
 async function submit(uid,mutation,replaceRequest=null){
  assertSafeJSON(mutation);allowedKeys(mutation,['version','id','baseRevision','settings','preferences','inventory','plan','checked','feedback','nextWeek','meals','context','planTimestamp','seedDelta']);
  if(!idPattern.test(mutation.id||''))throw error('invalid-argument','操作識別碼不正確。');
  const today=taipeiDate(clock());
  return db.runTransaction(async t=>{
   const {dataRef,record}=await resolve(t,uid);
   if(record.recentMutationIds.includes(mutation.id))return result(record);
   if(!Number.isInteger(mutation.baseRevision)||mutation.baseRevision<1||mutation.baseRevision>record.revision||record.revision-mutation.baseRevision>=128)throw error('failed-precondition','編輯版本已超過安全重試範圍。',{code:'sync/expired-mutation',latestSnapshot:record.snapshot,latestRevision:record.revision});
   let snapshot;
   if(replaceRequest){
    if(record.revision!==mutation.baseRevision)throw error('aborted','雲端已更新，請重新預覽匯入內容。',{code:'sync/conflict',latestSnapshot:record.snapshot,latestRevision:record.revision});
    snapshot=validateAccountSnapshot(replaceRequest);
   }else{
    try{snapshot=validateAccountSnapshot(applyMutation(record.snapshot,mutation));}
    catch(e){if(e.code==='sync/conflict')throw error('aborted','另一個裝置已修改相同內容。',{code:e.code,paths:e.paths,latestSnapshot:record.snapshot,latestRevision:record.revision});throw e;}
   }
   verifyWindow(snapshot,today);
   const next={...record,snapshot,revision:record.revision+1,recentMutationIds:[...record.recentMutationIds,mutation.id].slice(-128),updatedAt:serverTimestamp(),updatedBy:uid};
   t.set(dataRef,next);return result(next);
  });
 }
 async function deletion(uid){
  const ref=db.doc(accountPath(uid)),job=db.doc('mealPlannerDeletionJobs/'+uid);
  const a=await ref.get();
  if(a.exists){
   await db.runTransaction(async t=>{
    const current=await t.get(ref);
    if(current.exists){t.update(ref,{status:'deleting',updatedAt:serverTimestamp()});t.set(job,{status:'deleting',step:'data',updatedAt:serverTimestamp()},{merge:true});}
   });
  }
  try{
   // Only this UID's private subtree is removed. A migrated shared source and
   // the original legacy project documents are never deleted here.
   await db.recursiveDelete(db.collection(accountPath(uid)+'/data'));
   await db.doc(bindingPath(uid)).delete();
   await db.doc('mealPlannerRateLimits/'+uid).delete();
   await ref.delete();
   await job.set({status:'deleting',step:'auth',updatedAt:serverTimestamp()},{merge:true});
   try{await auth.revokeRefreshTokens(uid);await auth.deleteUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;}
   await job.delete();
   return {status:'completed'};
  }catch(e){
   await job.set({status:'retryable',step:'retry',errorCode:String(e.code||'internal'),updatedAt:serverTimestamp()},{merge:true});
   throw error('unavailable','刪除尚未完成，可重新登入後重試。',{reason:'deletion-retry'});
  }
 }
 return async function handle(input,context){
  const now=clock().getTime();requireIdentity(context,now);
  allowedKeys(input,['action','payload']);const {action,payload={}}=input;
  if(!allowedActions.has(action))throw error('invalid-argument','不支援的帳號操作。');
  assertSafeJSON(payload,1500000);
  if(action==='deletionStatus'){
   const j=await db.doc('mealPlannerDeletionJobs/'+context.uid).get(),a=await db.doc(accountPath(context.uid)).get();
   return j.exists?{status:j.data().status,step:j.data().step}:{status:a.exists?'active':'completed'};
  }
  if(action==='deleteAccount'){
   allowedKeys(payload,['confirmation']);recent(context,now);
   if(payload.confirmation!=='DELETE_MY_ACCOUNT')throw error('invalid-argument','請確認要刪除帳號。');
   return deletion(context.uid);
  }
  let identity;
  try{identity=await auth.getUser(context.uid);}catch(e){if(e.code==='auth/user-not-found')throw error('unauthenticated','帳號已刪除，請重新登入。');throw e;}
  if(identity.disabled||context.authTime<Math.floor(new Date(identity.tokensValidAfterTime||0).getTime()/1000))throw error('unauthenticated','登入權限已更新，請重新驗證。');
  await rateLimit(context.uid);
  if(action==='bootstrap'){allowedKeys(payload,[]);return bootstrap(context.uid);}
  if(action==='profile'){
   allowedKeys(payload,['profile','revision']);const profile=validateProfile(payload.profile);
   return db.runTransaction(async t=>{
    const {ref,account}=await resolve(t,context.uid);
    if(payload.revision!==account.profileRevision)throw error('aborted','帳號設定已在另一個裝置更新。',{reason:'profile-conflict'});
    t.update(ref,{profile,profileRevision:account.profileRevision+1,updatedAt:serverTimestamp()});
    return {profile,profileRevision:account.profileRevision+1};
   });
  }
  if(action==='export'){
   allowedKeys(payload,[]);const value=await db.runTransaction(t=>resolve(t,context.uid));
   return {schemaVersion:2,exportedAt:clock().toISOString(),profile:value.account.profile,...result(value.record)};
  }
  if(action==='shopping'||action==='options'){
   allowedKeys(payload,action==='shopping'?['week']:['week','mealKey']);
   if(!weekWindow(taipeiDate(clock())).includes(payload.week))throw error('invalid-argument','只可查看本週與下一週。');
   const value=await db.runTransaction(t=>resolve(t,context.uid)),view=viewWeek(value.record.snapshot.state,payload.week);
   return action==='shopping'?{rows:aggregateShopping(view.plan,view.inventory),revision:value.record.revision}:{recipeIds:getReplacementOptions(view.plan,payload.mealKey,view.settings,view.inventory).map(r=>r.id),revision:value.record.revision};
  }
  if(action==='submit'){allowedKeys(payload,['mutation']);return submit(context.uid,payload.mutation);}
  if(action==='command'){
   allowedKeys(payload,['id','type','payload','baseSnapshot','baseRevision']);
   return submit(context.uid,commandMutation(payload,taipeiDate(clock())));
  }
  if(action==='replace'){
   allowedKeys(payload,['snapshot','baseRevision','id','confirmed']);recent(context,now);
   if(payload.confirmed!==true)throw error('invalid-argument','請先預覽並確認匯入資料。');
   return submit(context.uid,{id:payload.id,baseRevision:payload.baseRevision},payload.snapshot);
  }
 };
}
