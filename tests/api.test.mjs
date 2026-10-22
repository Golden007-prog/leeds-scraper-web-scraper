import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createApplication,cronPlan} from '../server/index.mjs';
const origin='http://127.0.0.1:4180';
const fixture='<html><head><title>=FORMULA()</title></head><body><h1>Fixture business</h1><a href="/contact">Contact</a><a href="mailto:contact@example.com">Email</a></body></html>';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const fixturePage=async url=>({html:fixture,url,bytes:fixture.length});
async function start(options){
 const dataDirectory=await mkdtemp(path.join(tmpdir(),'leeds-test-'));
 const app=createApplication({dataDirectory,port:0,fetchPage:fixturePage,...options});
 const {port}=await app.listen();
 return {app,dataDirectory,base:`http://127.0.0.1:${port}/api`};
}
function client(base){
 return async(route,{method='GET',body,requestOrigin=origin}={})=>{
  const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(requestOrigin?{Origin:requestOrigin}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{data=raw}
  return {status:response.status,data};
 };
}
// fetch() cannot send a custom Host header, so the DNS-rebinding guard is probed directly.
const statusWithHost=(base,route,host)=>new Promise((resolve,reject)=>{
 const target=new URL(base+route);
 http.get({hostname:target.hostname,port:target.port,path:target.pathname,headers:{Host:host}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);
});
async function until(request,id,terminal=true){
 for(let i=0;i<100;i++){const {data}=await request('/runs/'+id);if(terminal?!['QUEUED','RUNNING'].includes(data.run.status):data.run.status==='RUNNING')return data.run;await delay(20);}
 assert.fail('Run status deadline');
}
test('local workspace: no sign-in, real worker, cancellation, exports and durable workflows',async()=>{
 let slow=false;
 const fetchPage=async(url,{signal})=>{
  if(slow)await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,5000);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason)},{once:true});});
  return fixturePage(url);
 };
 let {app,dataDirectory,base}=await start({fetchPage});let request=client(base);
 try{
  assert.equal((await request('/health')).status,200);
  assert.equal((await request('/workspace')).data.workspace.name,'Local workspace');
  assert.equal((await request('/runs')).status,200);
  // Browser-reachable mutations still require an allowlisted Origin; foreign Hosts are refused.
  assert.equal((await request('/settings',{method:'PATCH',requestOrigin:'https://evil.example',body:{name:'Wrong'}})).status,403);
  assert.equal((await request('/settings',{method:'PATCH',requestOrigin:null,body:{name:'Wrong'}})).status,403);
  assert.equal(await statusWithHost(base,'/runs','attacker.example'),403);
  assert.equal((await request('/settings',{method:'PATCH',body:{name:'Research desk'}})).data.workspace.name,'Research desk');
  assert.equal((await request('/auth/login',{method:'POST',body:{}})).status,404);
  const input={urls:['https://example.com'],maxPages:2};
  assert.equal((await request('/runs',{method:'POST',body:{actorId:'website-content',input:{urls:['http://127.0.0.1'],maxPages:1}}})).status,400);
  assert.equal((await request('/runs',{method:'POST',body:{actorId:'google-maps',input}})).status,409);
  const tooFewPages=await request('/runs',{method:'POST',body:{actorId:'website-content',input:{urls:['https://example.com','https://example.org'],maxPages:1}}});
  assert.equal(tooFewPages.status,400);assert.match(tooFewPages.data.error,/start URLs/);
  const created=await request('/runs',{method:'POST',body:{actorId:'website-content',input}});assert.equal(created.status,201,JSON.stringify(created.data));const id=created.data.run.id;
  const run=await until(request,id);assert.equal(run.status,'SUCCEEDED');assert.equal(run.resultCount,2);assert.equal(run.results[0].title,'=FORMULA()');assert.match(run.results[0].sourceUrl,/example.com/);
  const csv=await request('/runs/'+id+'/export?format=csv');assert.equal(csv.status,200);assert.match(csv.data,/'=FORMULA/);
  assert.equal((await request('/runs/missing')).status,404);
  const task=(await request('/tasks',{method:'POST',body:{name:'Research',actorId:'contact-extractor',input}})).data.task;
  const schedule=(await request('/schedules',{method:'POST',body:{name:'Daily',taskId:task.id,cron:'0 9 * * *',enabled:true}})).data.schedule;
  assert.equal(schedule.timezone,'UTC');assert.ok(Date.parse(schedule.nextRunAt)>Date.now());
  assert.equal((await request('/schedules/'+schedule.id,{method:'PATCH',body:{enabled:false}})).data.schedule.enabled,false);
  const integration=(await request('/integrations',{method:'POST',body:{name:'Preference',type:'webhook',url:'https://example.com/hook'}})).data.integration;
  assert.equal(integration.enabled,false);assert.equal(integration.mode,'local-preference');
  slow=true;const pending=(await request('/runs',{method:'POST',body:{actorId:'website-content',input}})).data.run;await until(request,pending.id,false);
  assert.equal((await request('/runs/'+pending.id+'/abort',{method:'POST',body:{}})).data.run.status,'ABORTED');assert.equal((await until(request,pending.id)).status,'ABORTED');
  await app.close();
  app=createApplication({dataDirectory,port:0,fetchPage});base=`http://127.0.0.1:${(await app.listen()).port}/api`;request=client(base);
  assert.equal((await request('/workspace')).data.workspace.name,'Research desk');
  assert.equal((await request('/tasks')).data.tasks[0].id,task.id);assert.equal((await request('/runs/'+id)).data.run.resultCount,2);
  await request('/tasks/'+task.id,{method:'DELETE'});assert.equal((await request('/schedules')).data.schedules.length,0);
 }finally{await app.close();await rm(dataDirectory,{recursive:true,force:true});}
});
test('scheduler computes explicit UTC and rejects malformed or impossible input',()=>{
 const start=Date.parse('2026-10-22T08:30:00Z');assert.equal(new Date(cronPlan('0 9 * * *').nextAfter(start)).toISOString(),'2026-10-22T09:00:00.000Z');assert.equal(cronPlan(undefined,5).nextAfter(start),start+300000);
 for(const cron of ['* * *','100 * * * *','* * * * * *','0 0 31 2 *'])assert.throws(()=>cronPlan(cron).nextAfter(start));
});
test('retention never deletes an aborted run while its worker still holds it',async()=>{
 let release;const held=new Promise(r=>{release=r});
 // The collector ignores the abort signal so the worker outlives the persisted ABORTED status.
 const {app,dataDirectory,base}=await start({fetchPage:async url=>{await held;return fixturePage(url);},maxRuns:1});const request=client(base);
 try{
  const input={urls:['https://example.com'],maxPages:1};
  const first=(await request('/runs',{method:'POST',body:{actorId:'website-content',input}})).data.run;
  await until(request,first.id,false);
  assert.equal((await request('/runs/'+first.id+'/abort',{method:'POST',body:{}})).data.run.status,'ABORTED');
  assert.equal((await request('/runs',{method:'POST',body:{actorId:'website-content',input}})).status,429);
  release();
  let finished;for(let i=0;i<100;i++){finished=(await request('/runs/'+first.id)).data.run;if(finished.logs.at(-1).endsWith('Run aborted'))break;await delay(10);}
  assert.equal(finished.status,'ABORTED');assert.ok(finished.finishedAt);
  assert.equal((await request('/runs',{method:'POST',body:{actorId:'website-content',input}})).status,201);
  assert.equal((await request('/runs/'+first.id)).status,404);
 }finally{release();await app.close();await rm(dataDirectory,{recursive:true,force:true});}
});
test('cron matches either restricted day field, as standard cron does',()=>{
 // 2026-10-22 is a Thursday: the next Monday (26th) precedes the 1st of November.
 assert.equal(new Date(cronPlan('0 9 1 * 1').nextAfter(Date.parse('2026-10-22T10:00:00Z'))).toISOString(),'2026-10-26T09:00:00.000Z');
 assert.equal(new Date(cronPlan('0 9 1 * *').nextAfter(Date.parse('2026-10-22T10:00:00Z'))).toISOString(),'2026-11-01T09:00:00.000Z');
});
test('schedule edits replan only timing changes and can switch cron to interval',async()=>{
 const {app,dataDirectory,base}=await start();const request=client(base);
 try{
  const task=(await request('/tasks',{method:'POST',body:{name:'T',actorId:'website-content',input:{urls:['https://example.com']}}})).data.task;
  const created=(await request('/schedules',{method:'POST',body:{name:'S',taskId:task.id,intervalMinutes:60,enabled:true}})).data.schedule;
  await delay(5);
  const renamed=(await request('/schedules/'+created.id,{method:'PATCH',body:{name:'Renamed',enabled:false}})).data.schedule;
  assert.equal(renamed.nextRunAt,created.nextRunAt);assert.equal(renamed.name,'Renamed');
  const cron=(await request('/schedules/'+created.id,{method:'PATCH',body:{cron:'0 9 * * *'}})).data.schedule;
  assert.equal(cron.cron,'0 9 * * *');assert.equal(cron.intervalMinutes,null);
  const interval=(await request('/schedules/'+created.id,{method:'PATCH',body:{intervalMinutes:5}})).data.schedule;
  assert.equal(interval.cron,null);assert.equal(interval.intervalMinutes,5);
 }finally{await app.close();await rm(dataDirectory,{recursive:true,force:true});}
});
