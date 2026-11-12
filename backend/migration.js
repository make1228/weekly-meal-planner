import {CATALOG_VERSION} from '../account/catalog-version.js';
import {createHash} from 'node:crypto';
import {validateAccountSnapshot,retainAccountSnapshot,validateProfile} from '../account/model.js';
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const email=x=>String(x||'').trim().toLowerCase();
const legacyEquipment=[
 {id:'ih',model:'BOSCH PXY875KW1E'},{id:'air-fryer',model:''},{id:'rice-cooker',model:''},
 {id:'microwave',model:'BOSCH BEL554MS0U'},{id:'steam-oven',model:'BOSCH HSG7584B1'}
];
export function prepareLegacyMigration({home,policy,record,identities},today){
 if(home?.schemaVersion!==1||record?.schemaVersion!==1||home.ownerUid!==identities?.[0]?.uid||email(home.ownerEmail)!==email(policy?.ownerEmail))throw new Error('來源擁有者與私人政策不一致，禁止遷移。');
 const emails=[home.ownerEmail,home.partnerEmail].filter(Boolean).map(email);
 if(emails.length!==2||new Set(emails).size!==2||identities.length!==2||new Set(identities.map(x=>x.uid)).size!==2)throw new Error('必須確認兩位既有使用者身分。');
 for(let i=0;i<2;i++)if(email(identities[i].email)!==emails[i]||identities[i].emailVerified!==true||!identities[i].providerData.some(p=>p.providerId==='google.com'))throw new Error('舊制Google身分尚未核實。');
 if(!Number.isInteger(record.revision)||record.revision<1)throw new Error('來源版本不正確。');
 const original=validateAccountSnapshot(record.snapshot),snapshot=retainAccountSnapshot(original,today);
 const sourceHash=fingerprint({home,policy,record,identities});
 const id='legacy-'+sourceHash.slice(0,20);
 const plan={schemaVersion:2,id,sourceHash,sourceRevision:record.revision,sourceId:'weekly-table',sourcePaths:['mealHomeAccess/weekly-table','mealHomes/weekly-table','mealHomes/weekly-table/data/current'],snapshot,accounts:identities.map(x=>({uid:x.uid,profile:validateProfile({displayName:x.displayName||'',equipment:legacyEquipment})})),recentMutationIds:(record.recentMutationIds||[]).slice(-128)};
 return {plan,report:{migrationId:id,sourceHash,sourceRevision:record.revision,verifiedAccounts:2,sourceWrites:0,targetWrites:5,inventoryRows:snapshot.state.inventory.length,meals:[snapshot.state.plan,snapshot.state.plan.nextWeek.plan].flatMap(p=>p.days.flatMap(d=>d.meals)).length,expiredWeeksRemoved:original.state.plan.startDate!==snapshot.state.plan.startDate}};
}
export async function applyLegacyMigration(db,plan,{timestamp=()=>new Date()}={}){
 const dataRef=db.doc('mealPlannerLegacyData/'+plan.sourceId);
 return db.runTransaction(async t=>{
  const oldData=await t.get(dataRef),reads=[];
  for(const a of plan.accounts){
   if(!a.uid||a.uid.includes('/'))throw new Error('遷移UID無效。');
   const profileRef=db.doc('mealPlannerUsers/'+a.uid),bindingRef=db.doc('mealPlannerLegacyBindings/'+a.uid);
   reads.push({a,profileRef,bindingRef,profile:await t.get(profileRef),binding:await t.get(bindingRef)});
  }
  if(oldData.exists){
   if(oldData.data().migrationId!==plan.id)throw new Error('目標已有其他資料，停止遷移。');
   if(reads.every(x=>x.profile.exists&&x.binding.exists&&x.binding.data().migrationId===plan.id))return {status:'already-applied',migrationId:plan.id};
   throw new Error('遷移狀態不完整，需先檢查目標備份。');
  }
  if(reads.some(x=>x.profile.exists||x.binding.exists))throw new Error('目標帳號已存在，禁止覆蓋。');
  t.set(dataRef,{schemaVersion:2,ownerUid:'legacy:'+plan.sourceId,catalogVersion:CATALOG_VERSION,migrationId:plan.id,sourceHash:plan.sourceHash,snapshot:plan.snapshot,revision:1,recentMutationIds:plan.recentMutationIds,updatedAt:timestamp(),updatedBy:'migration'});
  for(const {a,profileRef,bindingRef} of reads){
   t.set(profileRef,{schemaVersion:2,ownerUid:a.uid,status:'active',profile:a.profile,profileRevision:1,dataPath:dataRef.path,migrationId:plan.id,createdAt:timestamp(),updatedAt:timestamp()});
   t.set(bindingRef,{verified:true,sourceId:plan.sourceId,migrationId:plan.id});
  }
  return {status:'applied',migrationId:plan.id};
 });
}
export async function rollbackLegacyMigration(db,plan){
 return db.runTransaction(async t=>{
  const dataRef=db.doc('mealPlannerLegacyData/'+plan.sourceId),data=await t.get(dataRef),refs=[];
  for(const a of plan.accounts)for(const prefix of ['mealPlannerUsers','mealPlannerLegacyBindings']){
   const ref=db.doc(prefix+'/'+a.uid),snap=await t.get(ref);refs.push({ref,snap});
  }
  if(!data.exists)return {status:'already-rolled-back'};
  if(data.data().migrationId!==plan.id||data.data().revision!==1||refs.some(x=>!x.snap.exists||x.snap.data().migrationId!==plan.id||x.snap.data().profileRevision>1))throw new Error('目標已有新變更，禁止直接回復；先另行備份與合併。');
  for(const {ref} of refs)t.delete(ref);t.delete(dataRef);
  return {status:'rolled-back',sourceWrites:0};
 });
}
