// Read-only deployment gate; never enables billing or edits Firebase configuration.
import fs from 'node:fs/promises';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
const args=process.argv.slice(2),flag=name=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
const project=flag('--project'),file=flag('--config');
if(!project||!file)throw new Error('Required: --project DEDICATED_PROJECT --config /private/path/public.json');
const config=JSON.parse(await fs.readFile(file,'utf8'));
if(project==='nora-after-hours'||project.startsWith('demo-')||config.firebase?.projectId!==project||config.mode!=='public'||config.emulator||!['staging','production'].includes(config.environment)||!config.appCheckSiteKey||JSON.stringify(config).includes('REPLACE_'))throw new Error('A completed dedicated public environment configuration is required.');
const app=initializeApp({projectId:project,credential:applicationDefault()});
const token=await app.options.credential.getAccessToken();
const base='https://identitytoolkit.googleapis.com/admin/v2/projects/'+encodeURIComponent(project);
const response=await fetch(base+'/config',{headers:{Authorization:'Bearer '+token.access_token}});
if(!response.ok)throw new Error('Cannot read project Auth configuration; verify firebaseauth.configs.get. Status '+response.status);
const auth=await response.json();
if(auth.signIn?.allowDuplicateEmails!==true)throw new Error('Auth must allow duplicate emails across providers. Email-only automatic account linking is prohibited.');
for(const provider of ['google.com','apple.com']){
 const r=await fetch(base+'/defaultSupportedIdpConfigs/'+provider,{headers:{Authorization:'Bearer '+token.access_token}});
 if(!r.ok||(await r.json()).enabled!==true)throw new Error('Required provider not enabled: '+provider);
}
console.log(JSON.stringify({project,environment:config.environment,explicitProviderLinking:true,providers:['google.com','apple.com'],sourceProjectUntouched:true,cloudWrites:0,remainingManualChecks:['billing approval','App Check enforcement','Firestore rules','OAuth authorized domains','Apple app/service grouping','privacy policy','backups and budget alerts']},null,2));
