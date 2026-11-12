import {CATALOG_VERSION} from './catalog-version.js';
import {validateAccountSnapshot,validateProfile} from './model.js';
export const SDK_VERSION='13.3.0';
const fail=(code,message)=>Object.assign(new Error(message),{code});
export function accountError(error){
 const code=String(error?.code||'').replace(/^functions\//,'');
 if(error?.details?.code)return Object.assign(new Error(error.message),error.details,{code:error.details.code});
 const texts={
  'auth/account-exists-with-different-credential':'此帳號已有其他登入方式，請先用原方式登入，再到帳號設定綁定。',
  'auth/credential-already-in-use':'此登入方式已屬於另一個帳號，這次未合併任何資料。',
  'auth/provider-already-linked':'此登入方式已綁定。',
  'auth/popup-closed-by-user':'已取消登入。',
  'auth/cancelled-popup-request':'已取消登入。',
  'auth/operation-not-allowed':'此登入方式尚未由產品管理者啟用。',
  'auth/unauthorized-domain':'測試網址尚未加入登入授權網域。',
  'failed-precondition':error?.message||'請重新載入帳號或重新驗證登入。',
  'resource-exhausted':'操作太頻繁，請稍後重試。',
  'unavailable':'目前無法連線，尚未確認儲存，請恢復網路後重試。'
 };
 return Object.assign(new Error(texts[error?.code]||texts[code]||error?.message||'帳號操作未完成。'),{code:error?.code||code,details:error?.details});
}
async function sdkModules(){
 const root='https://www.gstatic.com/firebasejs/'+SDK_VERSION;
 const modules=await Promise.all(['app','auth','firestore','functions','app-check'].map(name=>import(root+'/firebase-'+name+'.js')));
 return Object.assign({},...modules);
}
function validateEnvironment(config){
 if(config.mode!=='public'||!config.firebase?.projectId)throw fail('sync/unconfigured','公版帳號環境尚未設定。');
 if(config.firebase.projectId==='nora-after-hours')throw fail('sync/unconfigured','公版必須使用產品專用環境。');
 if(config.emulator){
  if(!config.firebase.projectId.startsWith('demo-')||!['127.0.0.1','localhost'].includes(globalThis.location?.hostname||'localhost'))throw fail('sync/unconfigured','模擬器只允許隔離的本機測試環境。');
 }else if(!config.appCheckSiteKey)throw fail('sync/unconfigured','App Check尚未設定。');
}
export async function createAccountSync({config,applyMutation,validateSnapshot=validateAccountSnapshot,onAuth=()=>{},onHome=()=>{},onData=()=>{},onStatus=()=>{},sdk:injectedSdk}={}){
 const notify=(phase,extra={})=>onStatus({state:phase,phase,...extra});
 try{validateEnvironment(config);}catch(error){notify('unconfigured',{message:error.message});return {available:false,destroy(){}};}
 const sdk=injectedSdk||await sdkModules();
 const appName='meal-public-'+config.environment;
 const app=sdk.getApps().find(x=>x.name===appName)||sdk.initializeApp(config.firebase,appName);
 const auth=sdk.getAuth(app),db=sdk.getFirestore(app),functions=sdk.getFunctions(app,config.region||'us-central1');
 if(config.emulator){
  const host=globalThis.location?.hostname||'127.0.0.1',port=Number(globalThis.location?.port||4173);
  sdk.connectAuthEmulator(auth,'http://'+host+':'+port,{disableWarnings:true});
  sdk.connectFirestoreEmulator(db,host,port);
  sdk.connectFunctionsEmulator(functions,host,port);
 }else sdk.initializeAppCheck(app,{provider:new sdk.ReCaptchaEnterpriseProvider(config.appCheckSiteKey),isTokenAutoRefreshEnabled:true});
 let removeQA=()=>{};if(config.emulator){const {installEmulatorAccounts}=await import('./qa.js');removeQA=installEmulatorAccounts({sdk,auth,config})||removeQA;}
 const rpc=sdk.httpsCallable(functions,'mealAccount',{timeout:120000});
 let generation=0,destroyed=false,user=null,profile=null,profileRevision=0,latest=null,unsubData=()=>{},unsubProfile=()=>{};
 const session=()=>{if(!user||auth.currentUser?.uid!==user.uid||destroyed)throw fail('sync/signed-out','請先登入。');if(globalThis.navigator?.onLine===false)throw fail('sync/offline','目前離線，請恢復網路後再操作。');return {uid:user.uid,token:generation};};
 const active=s=>!destroyed&&s.token===generation&&auth.currentUser?.uid===s.uid;
 async function call(action,payload={}){
  const s=session();
  try{const {data}=await rpc({action,payload});if(!active(s))throw fail('sync/signed-out','登入帳號已變更。');return data;}
  catch(e){throw accountError(e);}
 }
 function publishRecord(record,s){
  if(!active(s)||!record||record.revision<(latest?.revision||0))return;
  if(record.catalogVersion&&record.catalogVersion!==CATALOG_VERSION){clear();onHome(null);notify('error',{message:'食譜庫版本已更新，請重新載入或更新App後再使用。'});return false;}
  validateSnapshot(record.snapshot);latest=record;
  onData(record.snapshot,{revision:record.revision,recentMutationIds:record.recentMutationIds||[],fromCache:false,hasPendingWrites:false});
  notify('synced',{revision:record.revision});return true;
 }
 function publicUser(value){return value?{uid:value.uid,email:value.email||value.providerData.find(p=>p.email)?.email||'',displayName:value.displayName||'',providers:value.providerData.map(p=>p.providerId)}:null;}
 function emitHome(info={}){if(user)onHome({ownerUid:user.uid,ownerEmail:user.email||'',partnerEmail:'',isOwner:true,profile,profileRevision,...info});}
 function clear(){unsubData();unsubProfile();unsubData=()=>{};unsubProfile=()=>{};latest=null;profile=null;profileRevision=0;}
 function provider(id){if(id==='apple.com'){const p=new sdk.OAuthProvider(id);p.addScope('email');p.addScope('name');return p;}if(id==='google.com'){const p=new sdk.GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});return p;}throw fail('auth/invalid-provider','不支援的登入方式。');}
 const unsubscribe=sdk.onAuthStateChanged(auth,async value=>{
  generation++;clear();user=value;onAuth(publicUser(value));onHome(null);
  if(!value){notify('signed-out');return;}
  const s={uid:value.uid,token:generation};notify('connecting');
  try{
   const data=await call('bootstrap');
   if(!active(s))return;
   profile=data.profile;profileRevision=data.profileRevision;emitHome({legacyShared:data.legacyShared});
   if(!publishRecord(data,s))return;
   unsubProfile=sdk.onSnapshot(sdk.doc(db,'mealPlannerUsers/'+s.uid),{includeMetadataChanges:true},snap=>{
    if(!active(s)||snap.metadata.fromCache||snap.metadata.hasPendingWrites||!snap.exists())return;
    const account=snap.data();if(account.status!=='active'){clear();onHome(null);notify('error',{message:'帳號正在刪除。'});return;}
    profile=validateProfile(account.profile);profileRevision=account.profileRevision;emitHome({legacyShared:data.legacyShared});
   });
   unsubData=sdk.onSnapshot(sdk.doc(db,data.dataPath),{includeMetadataChanges:true},snap=>{
    if(!active(s))return;
    if(snap.metadata.fromCache||snap.metadata.hasPendingWrites){notify('connecting');return;}
    if(snap.exists())publishRecord(snap.data(),s);
   },error=>{if(active(s)){clear();onHome(null);notify('forbidden',{message:accountError(error).message});}});
  }catch(error){if(active(s)){clear();onHome(null);notify('error',{error,message:accountError(error).message});}}
 });
 return {
  available:true,
  async signIn(id='google.com'){return sdk.signInWithPopup(auth,provider(id));},
  async signOut(){generation++;clear();user=null;onAuth(null);onHome(null);notify('signed-out');return sdk.signOut(auth);},
  async submit(mutation){const s=session();notify('saving');const data=await call('submit',{mutation});if(!publishRecord(data,s))throw fail('sync/catalog-version','請重新載入食譜庫後再使用。');return data;},
  async initialize(){throw fail('sync/already-initialized','帳號已自動建立空白菜單，匯入前請先預覽。');},
  async saveProfile(value,expectedRevision=profileRevision){const s=session();const data=await call('profile',{profile:validateProfile(value),revision:expectedRevision});if(!active(s))throw fail('sync/signed-out','登入帳號已變更。');profile=data.profile;profileRevision=data.profileRevision;emitHome();return data;},
  async linkProvider(id,consent){
   if(consent!==true)throw fail('auth/consent-required','請先同意連結兩種登入方式。');
   const s=session(),target=user,uid=target.uid,current=target.providerData.some(x=>x.providerId==='apple.com')?'apple.com':'google.com';
   await sdk.reauthenticateWithPopup(target,provider(current));
   if(!active(s))throw fail('sync/signed-out','登入帳號已變更，停止綁定。');
   await sdk.linkWithPopup(target,provider(id));
   if(!active(s)||target.uid!==uid)throw fail('auth/identity-changed','帳號身分已變更，停止綁定。');
   onAuth(publicUser(user));return publicUser(user);
  },
  async exportAccount(){return call('export');},
  async importAccount(snapshot,id,revision,confirmed){const s=session();const data=await call('replace',{snapshot,id,baseRevision:revision,confirmed});publishRecord(data,s);return data;},
  async reauthenticate(){
   const s=session(),target=user,id=target.providerData.some(x=>x.providerId==='apple.com')?'apple.com':'google.com';
   const result=await sdk.reauthenticateWithPopup(target,provider(id));
   if(!active(s))throw fail('sync/signed-out','登入帳號已變更。');
   return result;
  },
  async deleteAccount(confirmed){
   if(confirmed!==true)throw fail('auth/consent-required','請先確認刪除帳號。');
   const s=session(),target=user;
   const apple=target.providerData.some(x=>x.providerId==='apple.com');
   const result=await sdk.reauthenticateWithPopup(target,provider(apple?'apple.com':'google.com'));
   if(!active(s))throw fail('sync/signed-out','登入帳號已變更，停止刪除。');
   if(apple){
    const credential=sdk.OAuthProvider.credentialFromResult(result);
    if(!credential?.accessToken)throw fail('auth/revoke-required','Apple授權撤銷尚未完成，帳號尚未刪除。');
    await sdk.revokeAccessToken(auth,credential.accessToken);
   }
   if(!active(s))throw fail('sync/signed-out','登入帳號已變更，停止刪除。');
   const resultData=await call('deleteAccount',{confirmation:'DELETE_MY_ACCOUNT'});
   if(active(s))await sdk.signOut(auth);return resultData;
  },
  async deletionStatus(){return call('deletionStatus');},
  getUser:()=>publicUser(user),
  getProfile:()=>profile?structuredClone(profile):null,
  destroy(){destroyed=true;generation++;clear();unsubscribe();removeQA();}
 };
}
