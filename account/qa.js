// Non-secret fixture identities for the demo-project emulator only.
// This module is never loaded by staging/production Firebase environments.
export function installEmulatorAccounts({sdk,auth,config}){
 if(!config.emulator||!config.firebase.projectId.startsWith('demo-')||!['127.0.0.1','localhost'].includes(location.hostname))return;
 const bar=document.createElement('aside');bar.id='emulator-test-accounts';bar.setAttribute('aria-label','模擬器驗收工具');
 bar.style.cssText='padding:9px 18px;background:#fff2d6;font-size:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap';
 const label=document.createElement('strong');label.textContent='模擬器驗收・僅使用虛構資料';bar.append(label);
 for(const [key,name] of [['alpha','測試帳號 A'],['beta','測試帳號 B']]){
  const button=document.createElement('button');button.type='button';button.textContent=name;button.className='secondary-button';
  button.addEventListener('click',async()=>{
   button.disabled=true;
   try{await sdk.signInWithCredential(auth,sdk.GoogleAuthProvider.credential(JSON.stringify({sub:'meal-qa-'+key,email:key+'@meal.test',email_verified:true,name:'QA '+key})));}
   catch(e){label.textContent='測試帳號載入失敗：'+e.code;}
   finally{button.disabled=false;}
  });
  bar.append(button);
 }
 document.body.prepend(bar);
 return ()=>bar.remove();
}
