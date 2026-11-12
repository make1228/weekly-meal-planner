import fs from 'node:fs/promises';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {copyLegacyAuth} from '../backend/auth-migration.js';
import {prepareLegacyMigration} from '../backend/migration.js';
const args=process.argv.slice(2),flag=name=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
const targetProject=flag('--target-project'),file=flag('--approved-backup');
if(!targetProject||!file||!file.endsWith('.private.json'))throw new Error('Required: --target-project DEDICATED --approved-backup /private/path/before.private.json; optional --apply after review.');
const backup=JSON.parse(await fs.readFile(file,'utf8'));
if(!backup.sourceProject||targetProject===backup.sourceProject||targetProject==='nora-after-hours'||targetProject.startsWith('demo-'))throw new Error('Use a distinct dedicated real target. Emulator rehearsal uses the integration tests.');
const prepared=prepareLegacyMigration(backup.source);
if(prepared.plan.sourceHash!==backup.plan?.sourceHash)throw new Error('Backup fingerprint does not match the reviewed migration plan.');
const source=getAuth(initializeApp({projectId:backup.sourceProject,credential:applicationDefault()},'auth-source'));
const target=getAuth(initializeApp({projectId:targetProject,credential:applicationDefault()},'auth-target'));
try{console.log(JSON.stringify(await copyLegacyAuth({source,target,plan:backup.plan,identities:backup.source.identities,apply:args.includes('--apply')}),null,2));}
catch(e){if(e.report)console.error(JSON.stringify(e.report));throw new Error(e.message);}
