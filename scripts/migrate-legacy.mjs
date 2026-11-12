import fs from 'node:fs/promises';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {prepareLegacyMigration,fingerprint,applyLegacyMigration,rollbackLegacyMigration} from '../backend/migration.js';
import {taipeiDate} from '../account/model.js';
const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];
if(!args.includes('--source-project')||!args.includes('--backup')){
 console.log('Dry run: node scripts/migrate-legacy.mjs --source-project SOURCE --backup /private/path/meal.private.json');
 console.log('Copy only after review: add --target-project DEDICATED --approved-plan /private/path/meal.private.json --apply');
 process.exit(0);
}
const sourceProject=get('--source-project'),backup=get('--backup');
if(!backup.endsWith('.private.json'))throw new Error('Backup must end with .private.json (excluded from Git).');
const source=initializeApp({projectId:sourceProject,credential:applicationDefault()},'migration-source'),db=getFirestore(source);
const [policyDoc,homeDoc,recordDoc]=await Promise.all(['mealHomeAccess/weekly-table','mealHomes/weekly-table','mealHomes/weekly-table/data/current'].map(p=>db.doc(p).get()));
if([policyDoc,homeDoc,recordDoc].some(x=>!x.exists))throw new Error('Source is incomplete; no writes were made.');
const home=homeDoc.data(),policy=policyDoc.data(),record=recordDoc.data(),auth=getAuth(source),identities=[];
for(const mail of [home.ownerEmail,home.partnerEmail]){
 const u=await auth.getUserByEmail(mail);
 identities.push({uid:u.uid,email:u.email,emailVerified:u.emailVerified,displayName:u.displayName||'',providerData:u.providerData});
}
const input={home,policy,record,identities},prepared=prepareLegacyMigration(input,taipeiDate());
await fs.writeFile(backup,JSON.stringify({exportedAt:new Date().toISOString(),sourceProject,source:input,...prepared},null,2),{mode:0o600,flag:'wx'});
console.log(JSON.stringify(prepared.report,null,2));
if(args.includes('--apply')||args.includes('--rollback')){
 const targetProject=get('--target-project'),approved=JSON.parse(await fs.readFile(get('--approved-plan'),'utf8'));
 if(!targetProject||targetProject===sourceProject||targetProject==='nora-after-hours')throw new Error('Target must be a distinct dedicated product project.');
 if(approved.plan?.sourceHash!==prepared.plan.sourceHash)throw new Error('Source changed since approval; no target writes were made.');
 const target=initializeApp({projectId:targetProject,credential:applicationDefault()},'migration-target'),targetDb=getFirestore(target);
 if(args.includes('--rollback'))console.log(await rollbackLegacyMigration(targetDb,approved.plan));
 else{
  // Auth import is deliberately an explicit prerequisite: credentials, refresh
  // tokens and other products' Auth identities are not moved by this script.
  for(const a of prepared.plan.accounts)await getAuth(target).getUser(a.uid);
  console.log(await applyLegacyMigration(targetDb,prepared.plan));
 }
}
