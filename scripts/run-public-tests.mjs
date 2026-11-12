import {spawn} from 'node:child_process';
import path from 'node:path';
if(!process.env.FIREBASE_AUTH_EMULATOR_HOST||!process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Auth and Firestore emulators required.');
const configResponse=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+'/emulator/v1/projects/demo-weekly-meal-public/config',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({signIn:{allowDuplicateEmails:true}})});
if(!configResponse.ok)throw new Error('Cannot enforce explicit-only account linking in Auth emulator.');
const root=path.resolve(import.meta.dirname,'..');
const server=spawn(process.execPath,[path.join(root,'node_modules/@google-cloud/functions-framework/build/src/main.js'),'--source=backend/lib/index.js','--target=mealAccount','--port=5001'],{cwd:root,env:{...process.env,FUNCTIONS_EMULATOR:'true',GCLOUD_PROJECT:'demo-weekly-meal-public'},stdio:'inherit'});
let ready=false;
for(let attempt=0;attempt<100;attempt++){
 try{const response=await fetch('http://127.0.0.1:5001/demo-weekly-meal-public/us-central1/mealAccount',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:{action:'bootstrap'}})});if(response.status===401){ready=true;break;}}catch{}
 await new Promise(r=>setTimeout(r,100));
}
if(!ready){server.kill('SIGTERM');throw new Error('Callable HTTP framework did not start.');}
const files=['tests/firestore-rules.emulator.mjs','tests/public/account.emulator.mjs','tests/public/migration.test.mjs'];
const test=spawn(process.execPath,['--test','--test-concurrency=1',...files],{cwd:root,env:process.env,stdio:'inherit'});
test.on('exit',code=>{server.kill('SIGTERM');process.exitCode=code||0;});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{test.kill(signal);server.kill(signal);});
