import {validPdf} from './fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {validDraft,validEvent,foldCalendarLine} from '../src/record-utils.js';
import {loadEvents,append,createEventReader} from '../src/store.js';
import {uploadDocument} from '../src/documents.js';
const event={seq:1,id:'d3057f15-9b02-43de-92d0-0cb296ecf641',kind:'job',subject_id:null,event_date:'2026-11-05',payload:{title:'Role'}};
test('bad responses cannot confirm saves or erase the caller draft',async()=>{
 const original=globalThis.fetch;
 try {for(const body of [{},{...event,id:'d3057f15-9b02-43de-92d0-0cb296ecf642'}]){globalThis.fetch=async()=>Response.json(body);await assert.rejects(()=>append(event),/not confirmed/);}}
 finally{globalThis.fetch=original;}
});
test('event loading rejects duplicate, descending and malformed records',async()=>{
 const original=globalThis.fetch;
 try {for(const body of [[event,event],[{...event,seq:2},event],[{...event,payload:null}]]){globalThis.fetch=async()=>Response.json(body);await assert.rejects(()=>loadEvents(),/cursor/);}}
 finally{globalThis.fetch=original;}
});
test('invalid draft shapes are rejected and long calendar lines fold by UTF-8 bytes',()=>{
 assert.equal(validDraft({kind:'invalid',values:{}}),false);assert.equal(validEvent(event),true);
 const line='DESCRIPTION:'+ 'සිංහල '.repeat(60);const folded=foldCalendarLine(line);
 assert.equal(folded.replace(/\r\n /g,''),line);
 for(const part of folded.split('\r\n'))assert.ok(new TextEncoder().encode(part).length<=75);
});
test('successful HTTP response without a document receipt remains an upload failure',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({uploaded:true});
 try {await assert.rejects(()=>uploadDocument('/api',{id:event.id},'Test Name',new File([validPdf],'cv.pdf'),'cv',event.id),/did not confirm/);}
 finally{globalThis.fetch=original;}
});

test('a local save receipt cannot skip another user’s intervening updates',async()=>{
 const original=globalThis.fetch;const reader=createEventReader();const seen=[];
 globalThis.fetch=async(url,options)=>{
  if(options.method==='POST')return Response.json({...event,seq:4});
  if(String(url).endsWith('/bootstrap')){seen.push(0);return Response.json({events:[event],cursor:1});}
  const cursor=Number(new URL(url,'https://example.test').searchParams.get('after'));seen.push(cursor);
  return Response.json(cursor===0?[event]:[2,3,4].map(seq=>({...event,seq,id:event.id.slice(0,-1)+seq})));
 };
 try{assert.equal((await reader()).length,1);await append(event);assert.deepEqual((await reader()).map(e=>e.seq),[2,3,4]);assert.deepEqual(seen,[0,1]);}
 finally{globalThis.fetch=original;}
});
test('commission acceptance also requires recorded boundaries and scorecards follow the position',async()=>{
 const {stageProblem,scorecardFor}=await import('../src/model.js');
 const payload={stage:'R1 Scheduled',r1:'2026-11-07T12:00',note:'Interview',action:'Interview',owner:'COO',due:'2026-11-07'};
 const candidate={job_id:'e2173dde-bc77-409a-96a1-86dcb23841f0',commission_ack:'Accepted'};
 assert.match(stageProblem(payload,candidate,'2026-11-06'),/commission/);
 assert.equal(stageProblem(payload,{...candidate,terms_detail:'Agreed written boundaries'},'2026-11-06'),'');
 assert.notDeepEqual(scorecardFor({profile:'client-acquisition-v1'}).R1,scorecardFor({}).R1);
});


test('independent form drafts survive switching, saving and discarding another tool',async()=>{
 const {mergeDrafts}=await import('../src/record-utils.js');
 const base={id:event.id,request:event.id,revision:1,values:{note:'Unsaved evidence'}};
 const stage={...base,kind:'stage'},commission={...base,kind:'commission'};
 let drafts=mergeDrafts([],stage);
 drafts=mergeDrafts(drafts,commission);
 assert.equal(drafts.length,2);
 const changed={...stage,values:{note:'Changed evidence'}};
 drafts=mergeDrafts(drafts,changed);
 assert.deepEqual(drafts,[commission,changed]);
 assert.deepEqual(mergeDrafts(drafts,null,'commission',event.id),[changed]);
 assert.deepEqual(mergeDrafts(drafts,null,'stage',event.id),[commission]);
});

test('restoring a deleted candidate or booking requires a new reminder but scorecards do not',async()=>{
 const {interviewRevision}=await import('../src/model.js');const c={id:'candidate'},history=[{seq:1,id:'candidate',kind:'candidate',payload:{}},{seq:2,id:'booking',kind:'stage',subject_id:'candidate',payload:{stage:'R1 Scheduled'}}];
 assert.equal(interviewRevision(history,c),2);history.push({seq:3,id:'score',kind:'score',subject_id:'candidate',payload:{}});assert.equal(interviewRevision(history,c),2);
 history.push({seq:4,id:'delete',kind:'summary',payload:{operation:'delete',target_id:'candidate'}});history.push({seq:5,id:'restore',kind:'summary',payload:{operation:'restore',target_id:'candidate'}});assert.equal(interviewRevision(history,c),5);
 history.push({seq:6,id:'delete-stage',kind:'summary',payload:{operation:'delete',target_id:'booking'}});assert.equal(interviewRevision(history,c),6);
});
