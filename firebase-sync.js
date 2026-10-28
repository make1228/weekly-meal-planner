/** Firebase transport only. Meal validation and conflict merging live in sync-model.js. */
export const FIREBASE_SDK_VERSION='13.1.0';
export const HOME_PATH='mealHomes/weekly-table';

export function isFirebaseConfigured(config){
 return !!config&&['apiKey','authDomain','projectId','appId'].every(key=>typeof config[key]==='string'&&config[key].trim()&&!/^(TODO|YOUR_|REPLACE_)/i.test(config[key]));
}
export function normalizePartnerEmail(value,ownerEmail=''){
 const email=String(value??'').trim().toLowerCase();
 if(email==='')return '';
 if(email.length>320||!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email))throw new Error('請填寫家人登入使用的完整 Google 帳號。');
 if(email===String(ownerEmail).trim().toLowerCase())throw new Error('請填寫另一位家人的 Google 帳號。');
 return email;
}
export function firebaseErrorMessage(error){
 const code=String(error?.code||'');
 if(code==='sync/conflict')return '另一位家人剛修改了相同內容。已保留你的編輯，請先查看最新資料再重試。';
 if(code==='sync/expired-mutation')return '這筆編輯等待太久，無法確認先前是否已儲存。請查看最新資料後重新操作，避免庫存重複加入。';
 if(code==='sync/not-initialized')return '尚未建立共用菜單，請先由家庭管理者選擇要上傳的資料。';
 if(code==='sync/already-initialized')return '共用菜單已經建立，已停止上傳，請讀取最新雲端資料。';
 if(code==='sync/signed-out')return '請先使用自己的 Google 帳號登入。';
 if(code==='sync/offline'||code==='unavailable'||code==='auth/network-request-failed')return '目前無法連線；菜單尚未同步，請恢復網路後再試。';
 if(code==='permission-denied'||code==='sync/forbidden')return '這個帳號尚未獲准使用共用菜單，請由家庭管理者加入你的 Google 帳號。';
 if(code==='auth/unauthorized-domain')return '這個網站網址尚未加入 Firebase 的授權網域，請先完成設定。';
 if(code==='auth/operation-not-allowed')return 'Firebase 尚未啟用 Google 登入，請先完成設定。';
 if(code==='auth/popup-blocked')return '瀏覽器擋下登入視窗，請允許彈出視窗後再登入。';
 if(code==='auth/popup-closed-by-user'||code==='auth/cancelled-popup-request')return '已取消登入，可以隨時重試。';
 if(code==='auth/invalid-api-key'||code==='auth/app-not-authorized'||code==='failed-precondition')return 'Firebase 專案設定尚未完成，暫時無法同步。';
 return '雲端連線未完成，請稍後重試；目前資料已保留在這台裝置。';
}
function syncError(code,message){return Object.assign(new Error(message),{code});}
const publicUser=user=>user?{uid:user.uid,email:user.email||'',displayName:user.displayName||'',emailVerified:user.emailVerified===true}:null;
async function loadFirebaseSdk(){
 const root=`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
 const [app,auth,firestore]=await Promise.all([import(`${root}/firebase-app.js`),import(`${root}/firebase-auth.js`),import(`${root}/firebase-firestore.js`)]);
 return {...app,...auth,...firestore};
}

/**
 * No server access is attempted when config is incomplete. SDK injection is for tests.
 * onData receives server-confirmed snapshots only. submit resolves after server commit.
 * Firestore uses its default in-memory cache; no shared data is persisted by this module.
 */
export async function createFirebaseSync({config,applyMutation,validateSnapshot=value=>value,onAuth=()=>{},onHome=()=>{},onData=()=>{},onStatus=()=>{},sdk:injectedSdk}={}){
 const notify=(phase,extra={})=>onStatus({state:phase,phase,...extra});
 if(!isFirebaseConfigured(config)){
  notify('unconfigured');
  return {available:false,signIn:async()=>{throw syncError('sync/unconfigured','Firebase 尚未設定。');},signOut:async()=>{},destroy:()=>{}};
 }
 let sdk;
 try{sdk=injectedSdk||await loadFirebaseSdk();}
 catch(error){notify('error',{error,message:firebaseErrorMessage(error)});return {available:false,error,destroy:()=>{}};}
 let app,auth,db,homeRef,dataRef;
 try{
  app=sdk.getApps().find(candidate=>candidate.name==='weekly-table-sync')||sdk.initializeApp(config,'weekly-table-sync');
  auth=sdk.getAuth(app);db=sdk.getFirestore(app);
  homeRef=sdk.doc(db,HOME_PATH);dataRef=sdk.doc(db,`${HOME_PATH}/data/current`);
 }catch(error){notify('error',{error,message:firebaseErrorMessage(error)});return {available:false,error,destroy:()=>{}};}
 let destroyed=false,generation=0,user=null,home=null,homeUnsubscribe=()=>{},dataUnsubscribe=()=>{},authUnsubscribe=()=>{};
 let dataListening=false,lastDataRevision=-1;
 const active=token=>!destroyed&&token===generation;
 function clearHome(){homeUnsubscribe();dataUnsubscribe();homeUnsubscribe=()=>{};dataUnsubscribe=()=>{};dataListening=false;home=null;lastDataRevision=-1;}
 function fail(error,token){if(!active(token))return;const forbidden=error?.code==='permission-denied'||error?.code==='sync/forbidden';if(forbidden){generation++;clearHome();onHome(null);}notify(forbidden?'forbidden':'error',{error,message:firebaseErrorMessage(error)});}
 function currentMember(){return user&&user.emailVerified&&home&&(user.uid===home.ownerUid&&user.email?.toLowerCase()===home.ownerEmail||home.partnerEmail!==''&&user.email?.toLowerCase()===home.partnerEmail);}
 function assertSession({owner=false}={}){
  if(destroyed||!user||auth.currentUser?.uid!==user.uid)throw syncError('sync/signed-out','請先登入。');
  if(!currentMember()||owner&&user.uid!==home.ownerUid)throw syncError('sync/forbidden','這個帳號沒有操作權限。');
  if(typeof navigator!=='undefined'&&navigator.onLine===false)throw syncError('sync/offline','目前處於離線狀態。');
  return {uid:user.uid,token:generation};
 }
 function verifyMemberSnapshot(membership,session,{owner=false}={}){
  if(!active(session.token)||auth.currentUser?.uid!==session.uid)throw syncError('sync/signed-out','登入狀態已變更。');
  if(!membership.exists())throw syncError('sync/forbidden','家庭空間尚未建立。');
  const data=membership.data(),isOwner=session.uid===data.ownerUid&&user?.email?.toLowerCase()===data.ownerEmail;
  const isPartner=data.partnerEmail!==''&&user?.email?.toLowerCase()===data.partnerEmail;
  if(!user?.emailVerified||data.schemaVersion!==1||!isOwner&&(owner||!isPartner))throw syncError('sync/forbidden','這個帳號沒有操作權限。');
 }
 async function verifyTransactionMember(transaction,session,options){
  verifyMemberSnapshot(await transaction.get(homeRef),session,options);
 }
 async function canRetryAdvancedRevision(error,session,attemptedRevision){
  // A strict revision rule can reject a racing optimistic write before Firestore
  // surfaces contention as `aborted`. Retry only after fresh authorized reads
  // prove that another commit advanced the exact document we just read.
  if(error?.code!=='permission-denied'||!Number.isInteger(attemptedRevision)||typeof sdk.getDocFromServer!=='function')return false;
  // A rejected racing commit can arrive just before the winner becomes visible.
  // Briefly re-probe rather than treating that timing window as lost membership.
  for(const delay of [0,25,75,150]){
   if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
   if(!active(session.token))throw syncError('sync/signed-out','登入狀態已變更。');
   const [membership,current]=await Promise.all([sdk.getDocFromServer(homeRef),sdk.getDocFromServer(dataRef)]);
   verifyMemberSnapshot(membership,session);
   if(!current.exists())return false;
   const record=current.data();
   if(record.schemaVersion!==1||!Number.isInteger(record.revision))return false;
   if(record.revision>attemptedRevision)return true;
  }
  return false;
 }
 function watchData(token){
  if(dataListening)return;
  dataListening=true;
  dataUnsubscribe=sdk.onSnapshot(dataRef,{includeMetadataChanges:true},snapshot=>{
   if(!active(token)||!currentMember())return;
   if(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites){notify(snapshot.metadata.hasPendingWrites?'saving':'connecting');return;}
   const metadata={revision:0,fromCache:false,hasPendingWrites:false,updatedAt:null,updatedBy:null,recentMutationIds:[]};
   if(!snapshot.exists()){onData(null,metadata);notify('needs-initialization');return;}
   const record=snapshot.data();
   try{
    if(record.schemaVersion!==1||!Number.isInteger(record.revision)||record.revision<1)throw syncError('sync/invalid-data','共用資料版本不正確。');
    validateSnapshot(record.snapshot);
    metadata.recentMutationIds=Array.isArray(record.recentMutationIds)?record.recentMutationIds.filter(id=>typeof id==='string').slice(-128):[];
    metadata.revision=record.revision;metadata.updatedAt=record.updatedAt?.toDate?.()?.toISOString?.()||null;metadata.updatedBy=record.updatedBy;
    if(record.revision!==lastDataRevision){lastDataRevision=record.revision;onData(record.snapshot,metadata);}
    notify('synced',{revision:record.revision,updatedAt:metadata.updatedAt});
   }catch(error){fail(error,token);}
  },error=>fail(error,token));
 }
 function watchHome(token){
  homeUnsubscribe=sdk.onSnapshot(homeRef,{includeMetadataChanges:true},snapshot=>{
   if(!active(token))return;
   if(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites){notify('connecting');return;}
   if(!snapshot.exists()){onHome(null);notify('needs-home');return;}
   home=snapshot.data();
   if(home.schemaVersion!==1||!currentMember()){fail(syncError('sync/forbidden','這個帳號尚未加入家庭。'),token);return;}
   onHome({...home,isOwner:user.uid===home.ownerUid});watchData(token);
  },error=>fail(error,token));
 }
 async function bootstrapOwner(token){
  await sdk.runTransaction(db,async transaction=>{
   const snapshot=await transaction.get(homeRef);
   if(!active(token))throw syncError('sync/signed-out','登入狀態已變更。');
   if(!snapshot.exists())transaction.set(homeRef,{schemaVersion:1,ownerUid:user.uid,ownerEmail:user.email.toLowerCase(),partnerEmail:'',createdAt:sdk.serverTimestamp(),updatedAt:sdk.serverTimestamp()});
  });
 }
 authUnsubscribe=sdk.onAuthStateChanged(auth,async nextUser=>{
  generation++;const token=generation;clearHome();user=nextUser;onAuth(publicUser(user));onHome(null);
  if(!user){notify('signed-out');return;}
  notify('connecting');
  if(!user.emailVerified||typeof user.email!=='string'||!user.email){fail(syncError('sync/forbidden','請使用已驗證的 Google 帳號。'),token);return;}
  // The private server policy decides who may create this household. The public
  // client contains no owner identity; existing invited members may only read it.
  try{await bootstrapOwner(token);}
  catch(error){if(error?.code!=='permission-denied'){fail(error,token);return;}}
  if(active(token))watchHome(token);
 },error=>fail(error,generation));
 const online=()=>{if(user)notify('connecting');};
 const offline=()=>{if(user)notify('offline');};
 if(typeof window!=='undefined'){window.addEventListener('online',online);window.addEventListener('offline',offline);}
 return {
  available:true,
  signIn(){const provider=new sdk.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});return sdk.signInWithPopup(auth,provider);},
  async signOut(){generation++;clearHome();user=null;onAuth(null);onHome(null);notify('signed-out');return sdk.signOut(auth);},
  async initialize(snapshot){
   const session=assertSession({owner:true});validateSnapshot(snapshot);notify('saving');
   try{
    const result=await sdk.runTransaction(db,async transaction=>{
     await verifyTransactionMember(transaction,session,{owner:true});
     const existing=await transaction.get(dataRef);
     if(!active(session.token))throw syncError('sync/signed-out','登入狀態已變更。');
     if(existing.exists())throw syncError('sync/already-initialized','共用菜單已經建立。');
     transaction.set(dataRef,{schemaVersion:1,snapshot,revision:1,updatedAt:sdk.serverTimestamp(),updatedBy:session.uid,recentMutationIds:[]});
     return {snapshot,revision:1};
    });
    if(active(session.token))notify('synced',{revision:result.revision});return result;
   }catch(error){
    // Two owner tabs may both see an empty document. The loser must load the
    // winner's data rather than be described as an unauthorized household member.
    if(error?.code==='permission-denied'&&typeof sdk.getDocFromServer==='function'){
     try{
      const [membership,current]=await Promise.all([sdk.getDocFromServer(homeRef),sdk.getDocFromServer(dataRef)]);
      verifyMemberSnapshot(membership,session,{owner:true});
      if(current.exists())error=syncError('sync/already-initialized','共用菜單已經建立。');
     }catch(freshError){error=freshError;}
    }
    fail(error,session.token);throw error;
   }
  },
  async submit(mutation){
   const session=assertSession();notify('saving');
   try{
    let result;
    for(let attempt=0;attempt<3;attempt++){
     let attemptedRevision=null;
     try{
      result=await sdk.runTransaction(db,async transaction=>{
       await verifyTransactionMember(transaction,session);
       const existing=await transaction.get(dataRef);
       if(!active(session.token))throw syncError('sync/signed-out','登入狀態已變更。');
       if(!existing.exists())throw syncError('sync/not-initialized','請先建立共用菜單。');
       const record=existing.data();
       if(record.schemaVersion!==1||!Number.isInteger(record.revision)||record.revision<1)throw syncError('sync/invalid-data','共用資料版本不正確。');
       attemptedRevision=record.revision;
       if(typeof mutation?.id!=='string'||!mutation.id)throw syncError('sync/invalid-mutation','同步操作缺少識別碼。');
       const recentMutationIds=Array.isArray(record.recentMutationIds)?record.recentMutationIds:[];
       if(recentMutationIds.includes(mutation.id))return {snapshot:record.snapshot,revision:record.revision};
       if(!Number.isInteger(mutation.baseRevision)||mutation.baseRevision<1)throw syncError('sync/invalid-mutation','同步操作缺少原始版本。');
       if(record.revision-mutation.baseRevision>=128||mutation.baseRevision>record.revision){validateSnapshot(record.snapshot);throw Object.assign(syncError('sync/expired-mutation','編輯版本已超過安全重試範圍。'),{latestSnapshot:record.snapshot,latestRevision:record.revision});}
       const snapshot=applyMutation(record.snapshot,mutation);validateSnapshot(snapshot);
       const revision=record.revision+1;
       transaction.set(dataRef,{schemaVersion:1,snapshot,revision,updatedAt:sdk.serverTimestamp(),updatedBy:session.uid,recentMutationIds:[...recentMutationIds,mutation.id].slice(-128)});
       return {snapshot,revision};
      });
      break;
     }catch(error){
      if(await canRetryAdvancedRevision(error,session,attemptedRevision)){
       if(attempt<2)continue;
       throw Object.assign(syncError('sync/conflict','共用資料持續更新，請查看最新版本後再試一次。'),{paths:['revision']});
      }
      throw error;
     }
    }
    if(active(session.token))notify('synced',{revision:result.revision});return result;
   }catch(error){fail(error,session.token);throw error;}
  },
  async setPartnerEmail(value){
   const session=assertSession({owner:true}),partnerEmail=normalizePartnerEmail(value,home.ownerEmail);notify('saving');
   try{
    await sdk.runTransaction(db,async transaction=>{
     const existing=await transaction.get(homeRef);
     if(!active(session.token))throw syncError('sync/signed-out','登入狀態已變更。');
     if(!existing.exists()||existing.data().ownerUid!==session.uid)throw syncError('sync/forbidden','只有家庭管理者可以變更家人帳號。');
     transaction.update(homeRef,{partnerEmail,updatedAt:sdk.serverTimestamp()});
    });
    if(active(session.token))notify('synced');return partnerEmail;
   }catch(error){fail(error,session.token);throw error;}
  },
  destroy(){if(destroyed)return;destroyed=true;generation++;clearHome();authUnsubscribe();if(typeof window!=='undefined'){window.removeEventListener('online',online);window.removeEventListener('offline',offline);}}
 };
}
