import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {loadEvents,createEventReader} from '../src/store.js';
import {validEvent} from '../src/record-utils.js';
import {stageProblem} from '../src/model.js';
const makeEvent=seq=>({seq,id:'11111111-1111-4111-8111-'+String(seq).padStart(12,'0'),kind:'job',subject_id:null,event_date:'2026-11-23',payload:{title:'Synthetic role'}});

test('paginated feeds reject a cleanup epoch change and duplicate IDs across pages',async()=>{
 const original=globalThis.fetch;
 try{
  for(const duplicate of [false,true]){
   let calls=0;globalThis.fetch=async()=>{const n=calls++;const events=n?[duplicate?{...makeEvent(1),seq:501}:makeEvent(501)]:Array.from({length:500},(_,i)=>makeEvent(i+1));return Response.json(events,{headers:{'X-Purge-Epoch':duplicate?'same':n?'after':'before'}});};
   await assert.rejects(()=>loadEvents(),duplicate?/cursor|duplicate/i:/cleanup|workspace changed/i);
  }
 }finally{globalThis.fetch=original;}
});

test('bootstrap requires ordered unique complete snapshots and retains fallback cleanup epoch',async()=>{
 const original=globalThis.fetch;
 try{
  for(const events of [[makeEvent(2),makeEvent(1)],[makeEvent(1),{...makeEvent(1),seq:2}],[makeEvent(1)]]){
   globalThis.fetch=async()=>Response.json({events,cursor:2});await assert.rejects(()=>createEventReader()(),/snapshot/i);
  }
  let bootstraps=0;globalThis.fetch=async url=>{if(String(url).includes('/bootstrap')){bootstraps++;return Response.json({error:'Use pagination'},{status:413});}const after=Number(new URL(url,'https://example.test').searchParams.get('after')||0);return Response.json(after?[]:[makeEvent(1)],{headers:{'X-Purge-Epoch':'retained'}});};
  const reader=createEventReader();assert.equal((await reader()).length,1);assert.equal((await reader()).length,0);assert.equal(bootstraps,1);
 }finally{globalThis.fetch=original;}
});

test('malformed calendar dates and missing subject associations cannot be accepted as events',()=>{
 assert.equal(validEvent({...makeEvent(1),event_date:'2026-02-31'}),false);
 assert.equal(validEvent({...makeEvent(1),kind:'stage',subject_id:null}),false);
});

test('Client Acquisition profile gates progression for every position ID',()=>{
 const payload={stage:'R1 Scheduled',r1:'2026-11-25T09:00',note:'Evidence',action:'Interview',due:'2026-11-25',owner:'COO'};
 const candidate={job_id:makeEvent(1).id,commission_ack:'Pending',checklist:{}};
 assert.match(stageProblem(payload,candidate,'2026-11-23',{profile:'client-acquisition-v1'}),/commission/i);
 assert.equal(stageProblem(payload,{...candidate,commission_ack:'Accepted',terms_detail:'Approved written boundaries'},'2026-11-23',{profile:'client-acquisition-v1'}),'');
});

test('offline startup provides a recovery message without fetching or losing the page',async()=>{
 let requests=0;const dom=new JSDOM(readFileSync(new URL('../../index.html',import.meta.url),'utf8'),{url:'https://example.test/#overview',runScripts:'dangerously',beforeParse(w){Object.defineProperty(w.navigator,'onLine',{value:false});w.fetch=async()=>{requests++;throw Error('Offline');};w.AbortSignal=AbortSignal;}});
 try{await new Promise(r=>setTimeout(r,40));assert.match(dom.window.document.querySelector('#app').textContent,/offline/i);assert.match(dom.window.document.querySelector('#mode').textContent,/offline/i);assert.equal(requests,0);}finally{dom.window.close();}
});
