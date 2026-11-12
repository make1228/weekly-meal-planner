import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLegacyMigration} from '../../backend/migration.js';
import {emptyAccountSnapshot} from '../../account/model.js';
const fixture=()=>({home:{schemaVersion:1,ownerUid:'verified-one',ownerEmail:'one@example.com',partnerEmail:'two@example.com'},policy:{ownerEmail:'one@example.com'},record:{schemaVersion:1,snapshot:emptyAccountSnapshot('2026-11-12'),revision:7,recentMutationIds:['old-receipt']},identities:[{uid:'verified-one',email:'one@example.com',emailVerified:true,providerData:[{providerId:'google.com'}]},{uid:'verified-two',email:'two@example.com',emailVerified:true,providerData:[{providerId:'google.com'}]}]});
test('migration dry run preserves source and both verified UID identities without exposing emails in the report',()=>{
 const input=fixture(),before=structuredClone(input),a=prepareLegacyMigration(input,'2026-11-12'),b=prepareLegacyMigration(input,'2026-11-12');
 assert.deepEqual(input,before);assert.deepEqual(a,b);assert.equal(a.report.sourceWrites,0);assert.equal(a.report.verifiedAccounts,2);
 assert.doesNotMatch(JSON.stringify(a.report),/example.com|verified-one/);
 assert.equal(a.plan.snapshot.state.inventory.length,0);assert.equal(a.plan.accounts[0].profile.equipment[0].model,'BOSCH PXY875KW1E');
 assert.deepEqual(a.plan.recentMutationIds,['old-receipt']);
});
test('migration rejects unverified identities, altered owner UID, missing partner and mismatched policy',()=>{
 for(const mutate of [f=>f.identities[1].emailVerified=false,f=>f.home.ownerUid='forged',f=>f.home.partnerEmail='',f=>f.policy.ownerEmail='attacker@example.com']){
  const f=fixture();mutate(f);assert.throws(()=>prepareLegacyMigration(f,'2026-11-12'));
 }
});
