// Administrative, UID-preserving copy to an empty dedicated Auth environment.
// Never deletes/revokes source users and never resolves ownership by email.
export function authImportRecords(plan,identities){
 if(plan?.accounts?.length!==2||identities?.length!==2)throw new Error('Exactly two reviewed legacy identities are required.');
 return identities.map((identity,index)=>{
  if(identity.uid!==plan.accounts[index].uid||identity.emailVerified!==true||identity.providerData?.length!==1||identity.providerData[0].providerId!=='google.com'||!identity.providerData[0].uid)throw new Error('Legacy provider/UID differs from the reviewed Google-only migration.');
  const provider=identity.providerData[0];
  return {uid:identity.uid,email:identity.email,emailVerified:true,...(identity.displayName?{displayName:identity.displayName}:{}),providerData:[{uid:provider.uid,providerId:'google.com',...(provider.email?{email:provider.email}:{})}]};
 });
}
function matching(actual,expected){
 return actual.uid===expected.uid&&actual.providerData.length===1&&actual.providerData[0].providerId==='google.com'&&actual.providerData[0].uid===expected.providerData[0].uid;
}
async function optional(get){try{return await get();}catch(e){if(e.code==='auth/user-not-found')return null;throw e;}}
export async function copyLegacyAuth({source,target,plan,identities,apply=false}){
 const records=authImportRecords(plan,identities),missing=[];let existing=0;
 // Inspect everything before any write. A partial Auth import can be rerun;
 // conflicting users are never overwritten or removed to make room.
 for(const record of records){
  const current=await source.getUser(record.uid);
  if(!matching(current,record)||current.emailVerified!==true||current.email!==record.email)throw new Error('Source Auth identity changed after backup; make a fresh reviewed backup.');
  const user=await optional(()=>target.getUser(record.uid));
  const provider=await optional(()=>target.getUserByProviderUid('google.com',record.providerData[0].uid));
  if(user&&!matching(user,record)||provider&&provider.uid!==record.uid)throw new Error('Target UID/provider conflict; no automatic merge is permitted.');
  if(user)existing++;else missing.push(record);
 }
 if(!apply)return {status:'dry-run',verifiedAccounts:records.length,existingAccounts:existing,plannedImports:missing.length,sourceWrites:0};
 if(!missing.length)return {status:'already-imported',verifiedAccounts:records.length,sourceWrites:0,targetImports:0};
 const result=await target.importUsers(missing);
 // Admin import supports partial results. Do not roll back successful accounts
 // by deleting them: report counts; the next run verifies and skips them.
 if(result.failureCount)throw Object.assign(new Error('Auth import partially failed; preserve the receipt and rerun after resolving the error.'),{report:{successCount:result.successCount,failureCount:result.failureCount,errors:result.errors.map(x=>({index:x.index,code:x.error.code})),sourceWrites:0}});
 for(const record of records)if(!matching(await target.getUser(record.uid),record))throw new Error('Auth import verification failed.');
 return {status:'imported',verifiedAccounts:records.length,targetImports:result.successCount,sourceWrites:0};
}
