import {initializeApp,getApps,getApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {onCall,HttpsError} from 'firebase-functions/v2/https';
import {createAccountService} from './service.js';
if(!getApps().length)initializeApp();
let policyConfirmedAt=0;
async function requireExplicitLinkingPolicy(){
 if(process.env.FUNCTIONS_EMULATOR==='true')return;
 if(Date.now()-policyConfirmedAt<60000)return;
 const project=getApp().options.projectId||process.env.GCLOUD_PROJECT;
 const credential=getApp().options.credential;
 const token=await credential.getAccessToken();
 const response=await fetch('https://identitytoolkit.googleapis.com/admin/v2/projects/'+encodeURIComponent(project)+'/config',{headers:{Authorization:'Bearer '+token.access_token}});
 if(!response.ok||(await response.json()).signIn?.allowDuplicateEmails!==true)throw new HttpsError('failed-precondition','登入設定尚未完成，請聯絡產品管理者。');
 policyConfirmedAt=Date.now();
}
const db=getFirestore(),handle=createAccountService({db,auth:getAuth(),serverTimestamp:()=>FieldValue.serverTimestamp()});
export const mealAccount=onCall({region:'us-central1',enforceAppCheck:process.env.FUNCTIONS_EMULATOR!=='true',maxInstances:3,memory:'256MiB',timeoutSeconds:120},async request=>{
 // This application may not delete global Auth identities in the existing
 // multi-product project. Public environments must have a dedicated project.
 if(process.env.GCLOUD_PROJECT==='nora-after-hours')throw new HttpsError('failed-precondition','公版後端必須使用此產品專用的Firebase專案。');
 try{
  if(!request.auth)throw new HttpsError('unauthenticated','請先登入。');
  await requireExplicitLinkingPolicy();
  const token=request.auth?.token;
  return await handle(request.data,{uid:request.auth?.uid,provider:token?.firebase?.sign_in_provider,authTime:token?.auth_time});
 }catch(e){
  if(e instanceof HttpsError)throw e;
  const codes=['unauthenticated','permission-denied','invalid-argument','failed-precondition','aborted','resource-exhausted','unavailable'];
  throw new HttpsError(codes.includes(e.code)?e.code:'invalid-argument',e.message||'請求無法完成。',e.details||{});
 }
});
