import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {dateSL} from '../src/model.js';

test('all positions expose the private upload panel and preserve honest readiness states',async()=>{
 const events=[],calls=[],errors=[];
 for(const [index,market] of ['Worldwide','Sri Lanka'].entries()){
  const job=crypto.randomUUID(),candidate=crypto.randomUUID();
  events.push({id:job,kind:'job',subject_id:null,seq:events.length+1,event_date:dateSL(),payload:{title:'Strategic Partnerships Manager',location:market,status:'Open'}});
  events.push({id:candidate,kind:'candidate',subject_id:null,seq:events.length+1,event_date:dateSL(),payload:{name:'Synthetic Applicant '+index,alias:'QA-SHARED-'+index,job_id:job,source:'Referral',stage:'Sourced',action:'Review',owner:'COO',due:dateSL()}});
 }
 let ready=true;
 const dom=new JSDOM(readFileSync(new URL('../../index.html',import.meta.url),'utf8'),{url:'https://example.test/#coo',runScripts:'dangerously',beforeParse(w){
  w.AbortSignal=AbortSignal;w.TextEncoder=TextEncoder;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  w.fetch=async(url,options={})=>{calls.push({url:String(url),method:options.method||'GET'});if(String(url).includes('/integrations'))return Response.json({drive_ready:ready});if(String(url).includes('/maintenance'))return Response.json({backup_cursor:0,pending_receipts:0});if(String(url).includes('/bootstrap'))return Response.json({events,cursor:events.length});const u=new URL(url,'https://example.test');return Response.json(events.filter(e=>u.searchParams.has('subject')?e.id===u.searchParams.get('subject')||e.subject_id===u.searchParams.get('subject'):e.seq>Number(u.searchParams.get('after')||0)));};
  w.addEventListener('error',e=>errors.push(e.error));
 }});
 const w=dom.window,d=w.document,tick=()=>new Promise(r=>setTimeout(r,60));
 try{
  await tick();const checklist=()=>[...d.querySelectorAll('.panel')].find(el=>el.querySelector('h2')?.textContent==='CV & cover letter checklist');
  assert.deepEqual([...checklist().querySelectorAll('button')].map(b=>b.textContent),['Upload documents','Upload documents']);
  for(const candidate of events.filter(e=>e.kind==='candidate')){
   checklist().querySelector('[data-id="'+candidate.id+'"]').click();await tick();
   const form=d.querySelector('#document-entry');assert.ok(form);assert.equal(form.elements.private_name.value,candidate.payload.name);assert.equal(form.querySelector('[type=submit]').disabled,false);assert.match(d.querySelector('dialog').textContent,/shared across hiring positions/);
   assert.match(d.querySelector('dialog').textContent,new RegExp(events.find(e=>e.id===candidate.payload.job_id).payload.location));d.querySelector('dialog [data-action=close]').click();
  }
  ready=false;checklist().querySelector('button').click();await tick();assert.equal(d.querySelector('#document-entry [type=submit]').disabled,true);assert.match(d.querySelector('#drive-connection').textContent,/not verified/);d.querySelector('dialog [data-action=close]').click();
  w.location.hash='pipeline';await tick();
  assert.equal(d.querySelectorAll('.candidate-table tbody tr').length,2);
  assert.match(d.querySelector('.candidate-table').textContent,/Worldwide/);assert.match(d.querySelector('.candidate-table').textContent,/Sri Lanka/);
  for(const row of d.querySelectorAll('.candidate-table tbody tr')){assert.equal(row.querySelectorAll('.candidate-documents span').length,2);assert.equal(row.querySelectorAll('.row-actions button').length,3);}
  assert.ok(calls.filter(c=>c.url.includes('/integrations')).every(c=>c.method==='GET'));assert.deepEqual(errors,[]);
 }finally{w.close();}
});
