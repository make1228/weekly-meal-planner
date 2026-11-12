import test from 'node:test';
import assert from 'node:assert/strict';
import {accountError} from '../../account/transport.js';
import {serviceError} from '../../backend/errors.js';
test('uncertain transaction results retain transient error codes across backend and Firebase client boundaries',()=>{
 for(const [grpc,expected] of [[14,'unavailable'],[4,'deadline-exceeded'],[13,'internal'],[1,'cancelled']]){
  const server=serviceError({code:grpc,message:'internal infrastructure details'});
  assert.equal(server.code,expected);assert.doesNotMatch(server.message,/infrastructure/);
  const client=accountError({code:'functions/'+server.code,message:server.message});assert.equal(client.code,expected);
 }
 assert.equal(serviceError(new Error('unexpected after commit')).code,'internal');
 assert.equal(accountError({code:'auth/network-request-failed'}).code,'auth/network-request-failed');
 const conflict=accountError({code:'functions/aborted',message:'Conflict',details:{code:'sync/conflict',latestRevision:8}});
 assert.equal(conflict.code,'sync/conflict');assert.equal(conflict.latestRevision,8);
});
