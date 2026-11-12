import {EQUIPMENT,validateProfile,validateAccountSnapshot,retainAccountSnapshot} from './model.js';
import {createSharedSnapshot,validSharedPreferences,newGenerationId} from '../sync-model.js';
import {settingsToDraft} from '../preferences.js';
import {accountError} from './transport.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function installPublicControls({getClient,getSession,getPersonal,setBusy,accept,toast}){
 const $=s=>document.querySelector(s);
 const apple=document.createElement('button');apple.type='button';apple.id='account-apple';apple.className='secondary-button';apple.textContent='Apple 登入';
 const open=document.createElement('button');open.type='button';open.id='account-open';open.className='text-button';open.textContent='帳號設定';
 $('#cloud-sign-in').after(apple,open);
 const dialog=document.createElement('dialog');dialog.id='account-dialog';dialog.setAttribute('aria-labelledby','account-title');
 dialog.innerHTML='<button type="button" class="dialog-close icon-button" aria-label="關閉帳號設定">×</button><h2 id="account-title">帳號設定</h2><p id="account-identity"></p>'+
 '<form id="account-profile"><label class="field">暱稱<input name="displayName" maxlength="60" autocomplete="nickname"></label><fieldset><legend>我的烹調設備</legend>'+
 EQUIPMENT.map(item=>'<label class="account-tool"><input type="checkbox" name="equipment" value="'+item.id+'"><span>'+item.name+'</span><input type="text" name="model-'+item.id+'" maxlength="120" placeholder="型號（選填）" aria-label="'+item.name+'型號"></label>').join('')+
 '</fieldset><button class="secondary-button" type="submit">儲存帳號設定</button></form>'+
 '<h3>登入方式</h3><p id="account-providers"></p><label class="account-consent"><input id="account-link-consent" type="checkbox">我同意將兩種登入方式連結至目前帳號，共用同一份資料。</label>'+
 '<div class="account-buttons"><button type="button" id="account-link-google" class="secondary-button">連結 Google</button><button type="button" id="account-link-apple" class="secondary-button">連結 Apple</button></div>'+
 '<details><summary>匯出與匯入資料</summary><div class="account-buttons"><button type="button" id="account-export" class="secondary-button">匯出我的資料</button><button type="button" id="account-import-local" class="secondary-button">預覽此裝置資料</button><button type="button" id="account-import-file" class="secondary-button">預覽備份檔</button><input id="account-file" type="file" accept="application/json" hidden></div>'+
 '<p>匯入只保留本週與下一週。確認前不會寫入雲端，亦不會自動上傳此裝置資料。</p><div id="account-import-preview" hidden></div><label id="account-import-check-label" class="account-consent" hidden><input id="account-import-check" type="checkbox">我已確認，使用預覽資料取代目前帳號的菜單、偏好與庫存。</label><button type="button" id="account-import-confirm" class="secondary-button" hidden>確認匯入</button></details>'+
 '<details><summary>刪除帳號</summary><p>永久刪除此產品的帳號、個人設定與私人資料；舊制兩人共用的資料會保留給另一位使用者。操作前可先匯出。</p><label class="account-consent"><input type="checkbox" id="account-delete-check">我確認刪除此產品帳號，並同意重新驗證登入。</label><button type="button" id="account-delete" class="secondary-button">刪除我的帳號</button><button type="button" id="account-deletion-status" class="text-button">檢查刪除進度</button></details>'+
 '<p id="account-message" role="status" aria-live="polite"></p><a href="./privacy.html" target="_blank" rel="noopener">隱私與資料說明</a>';
 document.body.append(dialog);
 let preview=null,previewRevision=null,profileRevision=0,working=false;
 const message=text=>{$('#account-message').textContent=text;};
 function close(){dialog.close();preview=null;$('#account-link-consent').checked=false;$('#account-delete-check').checked=false;$('#account-import-preview').hidden=true;$('#account-import-check-label').hidden=true;$('#account-import-confirm').hidden=true;}
 dialog.querySelector('.dialog-close').addEventListener('click',close);
 dialog.addEventListener('cancel',close);
 function fill(){
  const s=getSession(),profile=s.home?.profile||{displayName:'',equipment:[]};profileRevision=s.home?.profileRevision||1;
  dialog.querySelector('[name=displayName]').value=profile.displayName;
  for(const item of EQUIPMENT){
   const current=profile.equipment.find(x=>x.id===item.id);
   dialog.querySelector('[name=equipment][value="'+item.id+'"]').checked=!!current;
   dialog.querySelector('[name=model-'+item.id+']').value=current?.model||'';
  }
  $('#account-identity').textContent=s.user?.email||'目前登入帳號';
  $('#account-providers').textContent=(s.user?.providers||[]).map(id=>id==='apple.com'?'Apple':'Google').join('、');
 }
 async function run(action){
  if(working||getSession().busy)return;
  working=true;setBusy(true);message('處理中…');
  try{await action();}
  catch(e){message(accountError(e).message);}
  finally{working=false;setBusy(false);render();}
 }
 function render(){
  const s=getSession(),signed=!!s.user,ready=signed&&!!getClient()?.available&&!s.busy;
  apple.hidden=signed;apple.disabled=!getClient()?.available||s.busy;
  open.hidden=!signed;open.disabled=!ready;
  if(!signed&&dialog.open)close();
  $('#account-link-google').disabled=(s.user?.providers||[]).includes('google.com')||working;
  $('#account-link-apple').disabled=(s.user?.providers||[]).includes('apple.com')||working;
  $('#account-delete').disabled=working||!$('#account-delete-check').checked;
  $('#account-import-confirm').disabled=working||!$('#account-import-check').checked;
 }
 apple.addEventListener('click',()=>run(()=>getClient().signIn('apple.com')));
 open.addEventListener('click',()=>{message('');fill();dialog.showModal();render();});
 $('#account-profile').addEventListener('submit',event=>{
  event.preventDefault();
  run(async()=>{
   const profile=validateProfile({displayName:dialog.querySelector('[name=displayName]').value,equipment:EQUIPMENT.filter(x=>dialog.querySelector('[name=equipment][value="'+x.id+'"]').checked).map(x=>({id:x.id,model:dialog.querySelector('[name=model-'+x.id+']').value}))});
   await getClient().saveProfile(profile,profileRevision);fill();message('帳號設定已儲存。');toast('帳號設定已同步。');
  });
 });
 for(const id of ['google','apple'])$('#account-link-'+id).addEventListener('click',()=>run(async()=>{
  await getClient().linkProvider(id+'.com',$('#account-link-consent').checked);$('#account-link-consent').checked=false;fill();message('登入方式已連結，兩端使用同一帳號資料。');
 }));
 $('#account-export').addEventListener('click',()=>run(async()=>{
  const data=await getClient().exportAccount(),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='weekly-meal-account-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('已匯出帳號設定、菜單、偏好與庫存。');
 }));
 function prepare(raw){
  let snapshot=raw.snapshot;
  if(!snapshot){
   const {version,settings,inventory,plan,checked}=raw.state||raw;
   const state={version,settings,inventory,plan,checked};
   snapshot=createSharedSnapshot(state,validSharedPreferences(raw.draftSettings||raw.preferences?.draft,settingsToDraft(settings)));
  }
  snapshot=retainAccountSnapshot(validateAccountSnapshot(snapshot));
  preview=validateAccountSnapshot(snapshot);previewRevision=getSession().revision;
  const menus=[preview.state.plan,...(preview.state.plan.nextWeek?[preview.state.plan.nextWeek.plan]:[])],count=menus.flatMap(p=>p.days.flatMap(d=>d.meals)).length;
  $('#account-import-preview').textContent='預覽：'+count+' 餐、'+preview.state.inventory.length+' 項庫存；忌口：'+(preview.preferences.avoidText||'未設定')+'。確認後會取代雲端內容。';
  $('#account-import-preview').hidden=false;$('#account-import-check-label').hidden=false;$('#account-import-confirm').hidden=false;$('#account-import-check').checked=false;message('請核對預覽內容。');render();
 }
 $('#account-import-local').addEventListener('click',()=>{try{prepare(getPersonal());}catch(e){message(e.message);}});
 $('#account-import-file').addEventListener('click',()=>$('#account-file').click());
 $('#account-file').addEventListener('change',async event=>{
  const file=event.target.files[0];if(!file)return;
  try{if(file.size>1000000)throw new Error('備份檔過大。');prepare(JSON.parse(await file.text()));}catch(e){message(e.message);}finally{event.target.value='';}
 });
 $('#account-import-check').addEventListener('change',render);
 $('#account-import-confirm').addEventListener('click',()=>run(async()=>{
  if(!preview||!$('#account-import-check').checked)return;
  await getClient().reauthenticate();
  const result=await getClient().importAccount(preview,newGenerationId(),previewRevision,true);
  accept(result.snapshot,{revision:result.revision});preview=null;$('#account-import-confirm').hidden=true;message('資料已匯入並由伺服器確認。');
 }));
 $('#account-delete-check').addEventListener('change',render);
 $('#account-delete').addEventListener('click',()=>run(async()=>{
  if(!$('#account-delete-check').checked)return;
  await getClient().deleteAccount(true);close();toast('此產品帳號已刪除。');
 }));
 $('#account-deletion-status').addEventListener('click',()=>run(async()=>{const status=await getClient().deletionStatus();message(status.status==='completed'?'刪除已完成。':status.status==='active'?'帳號仍在使用中。':'刪除尚未完成，可重新驗證後重試。');}));
 return {render,destroy(){close();dialog.remove();apple.remove();open.remove();}};
}
