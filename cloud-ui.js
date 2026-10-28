import {firebaseConfig} from './firebase-config.js';
import {createFirebaseSync,firebaseErrorMessage} from './firebase-sync.js';
import {createSharedSnapshot,createMutation,applyMutation,hasMutation,validSharedPreferences,newGenerationId} from './sync-model.js';
import {settingsToDraft} from './preferences.js';

const $=selector=>document.querySelector(selector);
const clone=value=>structuredClone(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const DRAFT_PREFIX='weekly-table-cloud-drafts-v1:';
const PENDING_PREFIX='weekly-table-cloud-pending-v1:';
const EDIT_CONTROLS='#settings-form [type=submit],#pantry-form [type=submit],[data-remove],[data-swap],[data-cooked],[data-buy],#clear-checked,[data-feedback],[data-portion],#import-button,#prev-week,#next-week,#start-date,#replacement-random,[data-select-recipe]';

/** Keeps personal browser data separate from the signed-in household. */
export function installCloudSync(adapter,{config=firebaseConfig,transport=createFirebaseSync}={}){
 let client=null,user=null,home=null,base=null,revision=0,phase='connecting',busy=false,authBusy=false,unconfirmed=null,destroyed=false;
 let confirmedReceipts=new Set();
 let renderedPreferences=null,accountDraft=null,connectingDraftBase=null,preferenceTimer,draftOrigin=null,draftBlocked=false,connectionGeneration=0,bootGeneration=0,everHadData=false;
 let personal=adapter.captureLocal();
 const initialDescription=$('#cloud-description').textContent;
 const validateSnapshot=snapshot=>{
  if(snapshot?.version!==1||!snapshot.state||!snapshot.preferences||Array.isArray(snapshot.preferences))throw new Error('共用資料格式不正確。');
  adapter.validateState(snapshot.state);
  return snapshot;
 };
 function error(message){$('#cloud-error').textContent=message;$('#cloud-error').hidden=!message;}
 function canEdit(){return !user||!!base&&!busy&&!authBusy&&!unconfirmed&&phase==='synced'&&navigator.onLine!==false;}
 function setUnconfirmed(value){
  unconfirmed=value;
  if(user){try{localStorage.setItem(PENDING_PREFIX+(config?.projectId||'unconfigured')+':'+user.uid,JSON.stringify(value));}catch(e){error('此裝置無法保存儲存確認紀錄。請先確認同步完成，再關閉頁面。');}}
 }
 function uncertain(error){return !error?.code||['unavailable','deadline-exceeded','unknown','internal','cancelled','auth/network-request-failed'].includes(error.code);}
 function clearRecoveredPantry(mutation){
  const changes=mutation?.inventory||[],draft=adapter.getPantryDraft();
  if(changes.length!==1||!(changes[0].delta>0)||draft.ingredientId!==changes[0].key||Math.round(Number(draft.quantity)*100)/100!==changes[0].delta)return;
  const cleared={...draft,quantity:''};adapter.setPantryDraft(cleared);if(accountDraft)accountDraft.pantryDraft=clone(cleared);
 }
 function recoverErrorSnapshot(failure){if(failure.latestSnapshot&&Number.isInteger(failure.latestRevision))accept(failure.latestSnapshot,{revision:failure.latestRevision});}
 function pendingPreferences(){return !!base&&!equal(validSharedPreferences(adapter.getDraft(),base.preferences),base.preferences);}
 function lockControls(){
  const locked=!canEdit();
  for(const element of document.querySelectorAll(EDIT_CONTROLS)){
   if(locked){if(!element.hasAttribute('data-cloud-locked')){element.dataset.cloudWasDisabled=String(element.disabled);element.dataset.cloudLocked='true';}element.disabled=true;}
   else if(element.hasAttribute('data-cloud-locked')){element.disabled=element.dataset.cloudWasDisabled==='true';delete element.dataset.cloudWasDisabled;delete element.dataset.cloudLocked;}
  }
  $('.workspace').classList.toggle('cloud-edit-locked',locked);
 }
 function renderStatus(){
  const current=user&&navigator.onLine===false?'offline':busy||authBusy?'saving':user&&unconfirmed&&base?'unconfirmed':phase;
  const labels={connecting:'正在連線，請稍候…',unconfigured:'雲端同步尚未開通；此裝置資料仍會自動保存。','signed-out':'尚未登入。目前使用此裝置的個人資料。',forbidden:'此帳號尚未加入共用餐桌，請管理者加入你的 Google 帳號。','needs-home':'正在準備家庭空間…','needs-initialization':home?.isOwner?'請選擇第一份共用菜單。':'請家庭管理者先建立共用菜單。',saving:'正在儲存到雲端，完成後即可關閉頁面。',synced:'已同步。兩人看到同一份最新菜單。',offline:'目前離線。已載入的菜單可查看，恢復連線後再修改。',error:'連線未完成，請重新連線；此裝置原有資料仍會保留。'};
  labels.unconfirmed=unconfirmed?.reviewOnly?'上次儲存已超過可自動確認的範圍。請先核對最新菜單與庫存，再繼續操作。':'上次儲存結果尚未確認。請先確認，避免重複加入庫存或重複操作。';
  const pending=current==='synced'&&pendingPreferences();
  const detail=pending?(draftBlocked?'設定有衝突，已保留此裝置的輸入。請確認最新共用內容後，再修改或產生菜單。':'菜單已同步；有效設定會自動補送，每分鐘再次檢查。'):labels[current]||labels.error;
  const compact={connecting:'連線中',unconfigured:'使用此裝置儲存','signed-out':'尚未登入',forbidden:'帳號尚未加入','needs-home':'準備共用空間','needs-initialization':'待建立共用菜單',saving:'同步中',synced:'已同步',offline:'目前離線',error:'同步未完成',unconfirmed:unconfirmed?.reviewOnly?'儲存待核對':'儲存結果尚未確認'};
  $('#cloud-status').textContent=pending?(draftBlocked?'設定衝突，待確認':'設定待同步'):compact[current]||compact.error;
  $('#cloud-status').title=detail;$('#cloud-status').ariaLabel=detail;
  $('.cloud-panel').dataset.phase=current;
  $('#cloud-account').hidden=!user;
  $('#cloud-account').textContent=user?`目前帳號：${user.email}`:'';
  $('#cloud-sign-in').hidden=!!user;
  $('#cloud-sign-in').disabled=!client?.available||authBusy;
  $('#cloud-sign-out').hidden=!user;
  $('#cloud-sign-out').disabled=busy||authBusy;
  $('#cloud-setup').hidden=!(user&&home?.isOwner&&!base&&phase==='needs-initialization');
  $('#cloud-initialize').disabled=busy||authBusy||navigator.onLine===false;
  $('#cloud-members').hidden=!(user&&home?.isOwner);
  $('#cloud-member-form button').disabled=busy||authBusy||navigator.onLine===false;
  $('#cloud-retry').hidden=!unconfirmed&&!['error','forbidden','offline'].includes(phase);
  $('#cloud-retry').textContent=unconfirmed&&base?(unconfirmed.reviewOnly?'我已核對最新菜單與庫存':'確認上次儲存結果'):'重新連線';
  $('#cloud-retry').disabled=busy||authBusy||user&&navigator.onLine===false;
  $('#cloud-description').textContent=user&&base?'菜單、有效設定、庫存與採買勾選，兩人即時共用。':initialDescription;
  $('#storage-description').textContent=user&&base?'共用資料儲存在雲端；未完成的輸入保留在此裝置。':'尚未使用共用菜單，原有資料保存在此瀏覽器。';
  const save=$('#save-state');
  save.dataset.phase=current==='saving'?'busy':current;
  if(user)save.innerHTML=`<i></i> ${current==='synced'?(pendingPreferences()?(draftBlocked?'設定待確認':'設定待同步'):'已同步'):current==='saving'?'儲存中':current==='offline'?'目前離線':'等待同步'}`;
  else if(!adapter.storageAvailable())save.textContent='暫時無法儲存';
  else save.innerHTML='<i></i> 已存於此裝置';
  lockControls();
 }
 function saveAccountDrafts(){
  if(!user)return false;
  const saved={version:1,draft:clone(adapter.getDraft()),pantryDraft:clone(adapter.getPantryDraft()),basePreferences:clone(renderedPreferences||accountDraft?.basePreferences||connectingDraftBase),preferenceOrigin:draftOrigin?{preferences:clone(draftOrigin.snapshot.preferences)}:null,draftBlocked};
  if(!base)accountDraft=saved;
  try{localStorage.setItem(DRAFT_PREFIX+user.uid,JSON.stringify(saved));}
  catch(e){error('此裝置無法保存未完成的輸入。已同步的菜單仍保存在雲端。');}
  renderStatus();return true;
 }
 function closeStaleDialogs(){for(const selector of ['#recipe-dialog','#replacement-dialog']){const d=$(selector);if(d.open)d.close();}}
 function hydrate({first=false}={}){
  if(!base)return;
  const previous=first?accountDraft?.basePreferences:renderedPreferences;
  let draft=first?(accountDraft?.draft||base.preferences):adapter.getDraft();
  draft=clone(draft);
  if(first&&previous){
   // Preserve the before-values of restored edits, even if the server changed
   // while this device was closed. A same-field edit must conflict, not win.
   const origin=accountDraft?.preferenceOrigin?.preferences||previous;
   draftOrigin={snapshot:{...clone(base),preferences:validSharedPreferences(origin,base.preferences)},revision};
   draftBlocked=accountDraft?.draftBlocked===true;
  }
  for(const [key,value] of Object.entries(base.preferences))if(!previous||equal(draft[key],previous[key])||equal(draft[key],value)){
   draft[key]=clone(value);
   if(draftOrigin)draftOrigin.snapshot.preferences[key]=clone(value);
  }
  adapter.setState(adapter.validateState(clone(base.state)));
  adapter.setDraft(draft);
  if(first&&accountDraft?.pantryDraft)adapter.setPantryDraft(accountDraft.pantryDraft);
  renderedPreferences=clone(base.preferences);
  if(!pendingPreferences()){draftOrigin=null;draftBlocked=false;}
  if(first&&draftBlocked)error('先前的設定有衝突，已保留你的輸入。請確認最新共用內容後，再修改或產生菜單。');
  closeStaleDialogs();adapter.refresh();saveAccountDrafts();renderStatus();
  if(first&&pendingPreferences()&&!draftBlocked){clearTimeout(preferenceTimer);preferenceTimer=setTimeout(syncDraft,700);}
 }
 function accept(snapshot,metadata={}){
  if(!user||!home)return;
  if(snapshot===null){if(!base){phase='needs-initialization';renderStatus();}return;}
  validateSnapshot(snapshot);
  const nextRevision=metadata.revision||0;
  if(base&&nextRevision<revision)return;
  confirmedReceipts=new Set(metadata.recentMutationIds||[]);
  if(unconfirmed&&confirmedReceipts.has(unconfirmed.mutation?.id)){clearRecoveredPantry(unconfirmed.mutation);setUnconfirmed(null);error('');}
  const first=!everHadData;
  base=clone(snapshot);revision=nextRevision;everHadData=true;
  if(!busy){phase='synced';hydrate({first});}
 }
 async function mutate(action,{replacePlan=false,replaceInventory=false,sharePreferences=false,preferenceOrigin=null}={}){
  clearTimeout(preferenceTimer);
  if(!user){action();adapter.persist();adapter.refresh();return;}
  if(!canEdit())throw new Error(navigator.onLine===false?'目前離線，請恢復連線後再修改共用菜單。':'共用餐桌還沒準備好，請等待同步完成。');
  const identity=user.uid,token=connectionGeneration,start=clone(preferenceOrigin?.snapshot||base),startRevision=revision,before=clone(adapter.getState());
  let submitted=false,completed=false,stagedMutation=null;
  busy=true;error('');renderStatus();
  try{
   action();
   const next=createSharedSnapshot(preferenceOrigin?start.state:adapter.getState(),sharePreferences?validSharedPreferences(adapter.getDraft(),start.preferences):start.preferences);
   const mutation=createMutation(start,next,{replacePlan,replaceInventory});mutation.baseRevision=startRevision;
   if(hasMutation(mutation)){
    stagedMutation=mutation;setUnconfirmed({version:1,uid:identity,mutation});
    submitted=true;
    const result=await client.submit(mutation);
    if(token!==connectionGeneration||user?.uid!==identity)return;
    setUnconfirmed(null);
    accept(result.snapshot,{revision:result.revision});
   }
   phase='synced';completed=true;
  }catch(e){
   if(token!==connectionGeneration||user?.uid!==identity)return;
   recoverErrorSnapshot(e);
   if(stagedMutation&&confirmedReceipts.has(stagedMutation.id)){setUnconfirmed(null);phase='synced';completed=true;return;}
   if(submitted&&!uncertain(e)&&e.code!=='sync/expired-mutation')setUnconfirmed(null);
   if(e.code==='sync/expired-mutation'&&unconfirmed)setUnconfirmed({...unconfirmed,reviewOnly:true});
   if(!base)adapter.setState(before);
   phase=e.code==='sync/conflict'||!submitted?'synced':navigator.onLine===false?'offline':'error';
   if(e.code==='sync/conflict')draftBlocked=true;
   error(e.code==='sync/conflict'?'另一位家人剛修改了相同內容，已讀取最新菜單。請確認後再操作；你尚未套用的設定仍保留在此裝置。':submitted?firebaseErrorMessage(e):e.message);
   throw e;
  }finally{
   if(token===connectionGeneration&&user?.uid===identity){busy=false;if(base)hydrate();else adapter.refresh();renderStatus();if(completed&&sharePreferences)draftOrigin=pendingPreferences()?{snapshot:clone(base),revision}:null;if(completed&&pendingPreferences()&&draftOrigin&&!draftBlocked){clearTimeout(preferenceTimer);preferenceTimer=setTimeout(syncDraft,700);}}
  }
 }
 async function syncDraft(){
  preferenceTimer=null;
  if(destroyed||!user||!base||!canEdit()||draftBlocked)return;
  const nextPreferences=validSharedPreferences(adapter.getDraft(),base.preferences);
  if(equal(nextPreferences,base.preferences))return;
  try{await mutate(()=>{},{sharePreferences:true,preferenceOrigin:draftOrigin||{snapshot:clone(base),revision}});}
  catch(e){/* The account panel keeps the retryable failure visible. */}
 }
 function noteDraftChange(){if(destroyed)return;if(user&&base){if(!draftOrigin||draftBlocked)draftOrigin={snapshot:clone(base),revision};draftBlocked=false;}saveAccountDrafts();clearTimeout(preferenceTimer);if(user&&base)preferenceTimer=setTimeout(syncDraft,700);}
 function onAuth(nextUser){
  clearTimeout(preferenceTimer);
  const previousUid=user?.uid||null,nextUid=nextUser?.uid||null;
  if(previousUid===nextUid){user=nextUser;renderStatus();return;}
  if(!user)personal=adapter.captureLocal();
  connectionGeneration++;busy=false;user=nextUser;home=null;base=null;revision=0;renderedPreferences=null;everHadData=false;accountDraft=null;draftOrigin=null;draftBlocked=false;unconfirmed=null;confirmedReceipts=new Set();error('');
  closeStaleDialogs();adapter.restoreLocal(clone(personal));
  connectingDraftBase=clone(adapter.getDraft());
  if(user){
   try{const saved=JSON.parse(localStorage.getItem(DRAFT_PREFIX+user.uid)||'null');if(saved?.version===1)accountDraft=saved;}catch(e){/* Ignore malformed device drafts. */}
   try{const saved=JSON.parse(localStorage.getItem(PENDING_PREFIX+(config?.projectId||'unconfigured')+':'+user.uid)||'null');if(saved?.version===1&&saved.uid===user.uid&&typeof saved.mutation?.id==='string')unconfirmed=saved;}catch(e){/* Ignore malformed recovery records. */}
   phase='connecting';
  }else phase='signed-out';
  adapter.refresh();renderStatus();
 }
 function onHome(nextHome){
  home=nextHome;
  if(home){
   $('#cloud-member-description').textContent=`管理者：${home.ownerEmail}${home.partnerEmail?` · 家人：${home.partnerEmail}`:' · 尚未加入另一位家人'}`;
   if(document.activeElement!==$('#cloud-partner-email'))$('#cloud-partner-email').value=home.partnerEmail||'';
  }else if(base){base=null;revision=0;everHadData=false;renderedPreferences=null;closeStaleDialogs();adapter.restoreLocal(clone(personal));adapter.refresh();}
  renderStatus();
 }
 async function connect(){
  const token=++bootGeneration;client?.destroy();client=null;if(user)onAuth(null);phase='connecting';error('');renderStatus();
  try{
   const guarded=callback=>(...args)=>{if(token===bootGeneration)callback(...args);};
   const created=await transport({config,applyMutation,validateSnapshot,onAuth:guarded(onAuth),onHome:guarded(onHome),onData:guarded(accept),onStatus:guarded(status=>{phase=status.phase||status.state;if(status.message)error(status.message);renderStatus();})});
   // Auth callbacks can run while the async factory is initializing.
   if(token!==bootGeneration){created.destroy();return;}
   client=created;renderStatus();
  }catch(e){phase='error';error(firebaseErrorMessage(e));renderStatus();}
 }
 $('#cloud-sign-in').addEventListener('click',async()=>{if(!client?.available)return;authBusy=true;error('');renderStatus();try{await client.signIn();}catch(e){error(firebaseErrorMessage(e));}finally{authBusy=false;renderStatus();}});
 $('#cloud-sign-out').addEventListener('click',async()=>{if(busy)return;authBusy=true;renderStatus();try{await client.signOut();}catch(e){error(firebaseErrorMessage(e));}finally{authBusy=false;renderStatus();}});
 $('#cloud-initialize').addEventListener('click',async()=>{
  if(busy||!user||!home?.isOwner)return;
  busy=true;const identity=user.uid,token=connectionGeneration;error('');renderStatus();
  try{
   const initialState=clone(adapter.getState());initialState.plan.generationId=newGenerationId();
   const snapshot=createSharedSnapshot(initialState,validSharedPreferences(adapter.getDraft(),settingsToDraft(initialState.settings)));
   validateSnapshot(snapshot);
   accountDraft={draft:clone(adapter.getDraft()),pantryDraft:clone(adapter.getPantryDraft()),basePreferences:clone(snapshot.preferences)};
   const result=await client.initialize(snapshot);
   if(token===connectionGeneration&&user?.uid===identity){accept(result.snapshot,{revision:result.revision});phase='synced';adapter.toast('已建立共用菜單。加入家人的 Google 帳號，就能一起使用。');}
  }catch(e){error(firebaseErrorMessage(e));phase='error';}
  finally{if(token===connectionGeneration){busy=false;if(base)hydrate({first:renderedPreferences===null});renderStatus();}}
 });
 $('#cloud-member-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!home?.isOwner)return;
  busy=true;error('');renderStatus();
  try{await client.setPartnerEmail($('#cloud-partner-email').value);phase=base?'synced':'needs-initialization';adapter.toast('家庭成員已儲存，家人可使用自己的 Google 帳號登入。');}
  catch(e){error(firebaseErrorMessage(e));phase='error';}
  finally{busy=false;renderStatus();}
 });
 async function recoverPending({automatic=false}={}){
  if(destroyed||busy||authBusy||navigator.onLine===false)return;
  if(!unconfirmed||!base){if(!automatic)connect();return;}
  if(unconfirmed.reviewOnly){if(!automatic){setUnconfirmed(null);phase='synced';error('');renderStatus();}return;}
  const identity=user?.uid,token=connectionGeneration,mutation=unconfirmed.mutation;busy=true;error('');renderStatus();
  try{const result=await client.submit(mutation);if(token!==connectionGeneration||user?.uid!==identity)return;clearRecoveredPantry(mutation);setUnconfirmed(null);accept(result.snapshot,{revision:result.revision});phase='synced';adapter.toast('已確認上次儲存結果，資料已同步。');}
  catch(e){if(token!==connectionGeneration)return;recoverErrorSnapshot(e);if(confirmedReceipts.has(mutation.id)){clearRecoveredPantry(mutation);setUnconfirmed(null);phase='synced';}else{if(!uncertain(e)&&e.code!=='sync/expired-mutation')setUnconfirmed(null);if(e.code==='sync/expired-mutation'&&unconfirmed)setUnconfirmed({...unconfirmed,reviewOnly:true});phase=e.code==='sync/conflict'?'synced':'error';error(firebaseErrorMessage(e));}}
  finally{if(token===connectionGeneration){busy=false;if(base)hydrate();renderStatus();}}
 }
 async function automaticSync(){
  if(destroyed||!user||!home||!base||busy||authBusy||navigator.onLine===false)return;
  if(unconfirmed){if(!unconfirmed.reviewOnly)await recoverPending({automatic:true});return;}
  if(draftBlocked)return;
  if(phase==='error'){await connect();return;}
  await syncDraft();
 }
 const beforeUnload=event=>{if(busy||unconfirmed||user&&pendingPreferences()){event.preventDefault();event.returnValue='';}};
 const online=()=>{if(user){renderStatus();automaticSync();}};
 const offline=()=>{if(user){phase='offline';renderStatus();}};
 const visible=()=>{if(document.visibilityState!=='hidden')automaticSync();};
 $('#cloud-retry').addEventListener('click',()=>recoverPending());
 window.addEventListener('beforeunload',beforeUnload);
 window.addEventListener('online',online);
 window.addEventListener('offline',offline);
 document.addEventListener?.('visibilitychange',visible);
 const automaticTimer=setInterval(automaticSync,60000);automaticTimer.unref?.();
 connect();
 return {mutate,noteDraftChange,saveAccountDrafts,refresh:renderStatus,isSignedIn:()=>!!user,destroy:()=>{destroyed=true;bootGeneration++;connectionGeneration++;clearTimeout(preferenceTimer);clearInterval(automaticTimer);window.removeEventListener?.('beforeunload',beforeUnload);window.removeEventListener?.('online',online);window.removeEventListener?.('offline',offline);document.removeEventListener?.('visibilitychange',visible);client?.destroy();}};
}
