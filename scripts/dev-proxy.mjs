import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const port=Number(process.env.PORT||4173);
const cli=path.join(root,'node_modules/firebase-tools/lib/bin/firebase.js');
const emulator=spawn(process.execPath,[cli,'emulators:start','--config','firebase.public.json','--project','demo-weekly-meal-public','--only','auth,firestore'],{cwd:root,env:{...process.env,GCLOUD_PROJECT:'demo-weekly-meal-public',JAVA_TOOL_OPTIONS:'-Xmx512m'},stdio:['ignore','pipe','pipe']});
let ready=false;
const functions=spawn(process.execPath,[path.join(root,'node_modules/@google-cloud/functions-framework/build/src/main.js'),'--source=backend/lib/index.js','--target=mealAccount','--port=5001'],{cwd:root,env:{...process.env,FUNCTIONS_EMULATOR:'true',GCLOUD_PROJECT:'demo-weekly-meal-public',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'},stdio:'inherit'});
emulator.stdout.on('data',async chunk=>{const text=chunk.toString();process.stdout.write(text);if(text.includes('All emulators ready')){
 try{const r=await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-weekly-meal-public/config',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({signIn:{allowDuplicateEmails:true}})});ready=r.ok;}catch(error){console.error('Auth emulator linking policy failed:',error.message);}
}});
emulator.stderr.on('data',chunk=>process.stderr.write(chunk));
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.jpg':'image/jpeg'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({emulatorsReady:ready,projectId:'demo-weekly-meal-public'}));return;}
 let target;
 if(url.pathname.startsWith('/identitytoolkit.googleapis.com/')||url.pathname.startsWith('/securetoken.googleapis.com/')||url.pathname.startsWith('/emulator/auth/')||url.pathname.startsWith('/www.googleapis.com/'))target=9099;
 else if(url.pathname.startsWith('/google.firestore.v1.Firestore/')||url.pathname.startsWith('/v1/projects/'))target=8080;
 else if(url.pathname.startsWith('/demo-weekly-meal-public/'))target=5001;
 if(target){
  if(!ready){res.writeHead(503);res.end('測試環境啟動中');return;}
  const headers={...req.headers,host:'127.0.0.1:'+target};
  const upstream=http.request({hostname:'127.0.0.1',port:target,path:req.url,method:req.method,headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end('Emulator unavailable');});req.pipe(upstream);return;
 }
 const relative=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);
 const file=path.resolve(root,'dist',relative);
 if(!file.startsWith(path.join(root,'dist')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');fs.createReadStream(file).pipe(res);
});
server.listen(port,'0.0.0.0',()=>console.log('Meal staging proxy at http://127.0.0.1:'+port));
function stop(){emulator.kill('SIGINT');functions.kill('SIGTERM');server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
emulator.on('exit',code=>{ready=false;if(code)console.error('Emulator exited: '+code);});
