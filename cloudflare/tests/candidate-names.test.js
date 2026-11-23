import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {project,candidateLabel,dateSL} from '../src/model.js';
import {candidateJob} from '../src/public-jobs.js';

const jid='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222';
test('candidate names are versioned without changing codes and never enter public job projections',()=>{
 const event=(seq,id,kind,payload,subject_id=null)=>({seq,id,kind,payload,subject_id,event_date:dateSL()});
 const events=[event(1,jid,'job',{title:'Synthetic role',status:'Open'}),event(2,cid,'candidate',{alias:'QA-LEGACY',job_id:jid,stage:'Sourced'})];
 assert.equal(candidateLabel(project(events).candidates[0]),'QA-LEGACY');
 const legacy=structuredClone(events);legacy[1].payload.display_name='Synthetic Existing Name';assert.equal(candidateLabel(project(legacy).candidates[0]),'Synthetic Existing Name');assert.equal(project(legacy).candidates[0].alias,'QA-LEGACY');
 legacy.push(event(3,'legacy-correction','activity',{event:'Candidate details corrected',name:'Synthetic Updated Name'},cid));assert.equal(candidateLabel(project(legacy).candidates[0]),'Synthetic Updated Name');
 assert.doesNotMatch(JSON.stringify(candidateJob(legacy,jid)),/Synthetic Existing Name|Synthetic Updated Name/);
 events.push(event(3,'correction','activity',{event:'Candidate details corrected',name:'Synthetic Candidate 李'},cid));
 assert.equal(candidateLabel(project(events).candidates[0]),'Synthetic Candidate 李');assert.equal(project(events).candidates[0].alias,'QA-LEGACY');
 assert.doesNotMatch(JSON.stringify(candidateJob(events,jid)),/Synthetic Candidate 李|QA-LEGACY/);
 events.push(event(4,'delete','summary',{operation:'delete',target_id:'correction'}));assert.equal(candidateLabel(project(events).candidates[0]),'QA-LEGACY');
 events.push(event(5,'restore','summary',{operation:'restore',target_id:'correction'}));assert.equal(candidateLabel(project(events).candidates[0]),'Synthetic Candidate 李');
});

test('names can be added to legacy records, searched, sorted, exported and restored from a fresh load',async()=>{
 let events=[{seq:1,id:jid,kind:'job',subject_id:null,event_date:dateSL(),payload:{title:'Synthetic role',status:'Open',department:'Growth',location:'Remote'}},{seq:2,id:cid,kind:'candidate',subject_id:null,event_date:dateSL(),payload:{alias:'QA-LEGACY',job_id:jid,stage:'Sourced',source:'Referral',action:'Review',due:dateSL(),owner:'COO'}}];
 const errors=[],blobs=[];
 function open(){return new JSDOM(readFileSync(new URL('../../index.html',import.meta.url),'utf8'),{url:'https://example.test/#pipeline',runScripts:'dangerously',beforeParse(w){
  w.AbortSignal=AbortSignal;w.TextEncoder=TextEncoder;w.Blob=Blob;w.URL.createObjectURL=b=>{blobs.push(b);return 'blob:https://example.test/'+blobs.length;};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  w.fetch=async(url,options={})=>{if(options.method==='POST'){const record=JSON.parse(options.body);const saved={...record,seq:events.at(-1).seq+1,created_at:new Date().toISOString()};events.push(saved);return Response.json(saved);}if(String(url).includes('/bootstrap'))return Response.json({events,cursor:events.at(-1).seq});const u=new URL(url,'https://example.test');return Response.json(events.filter(e=>e.seq>Number(u.searchParams.get('after')||0)));};w.addEventListener('error',e=>errors.push(e.error));
 }});}
 const dom=open(),w=dom.window,d=w.document,tick=()=>new Promise(r=>setTimeout(r,45));
 function click(action){const el=d.querySelector('[data-action="'+action+'"]');assert.ok(el,action);el.click();}
 async function save(){const form=d.querySelector('#entry');assert.equal(form.checkValidity(),true);form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(d.querySelector('dialog').open,false);}
 try{
  await tick();assert.match(d.querySelector('#candidate-results').textContent,/Name not added/);click('view');await tick();assert.equal(d.querySelector('[data-action=correction]').textContent,'Add candidate name');click('correction');d.querySelector('[name=name]').value='Synthetic Zeta';await save();
  assert.equal(events.at(-1).payload.name,'Synthetic Zeta');assert.equal(events.at(-1).payload.alias,'QA-LEGACY');assert.match(d.querySelector('#candidate-results').textContent,/Synthetic Zeta/);
  click('candidate');assert.equal(d.activeElement.name,'name');assert.equal(d.querySelector('[name=name]').required,true);d.querySelector('[name=name]').value='Synthetic Alpha';d.querySelector('[name=alias]').value='QA-NEW';await save();
  d.querySelector('#sort-filter').value='name';d.querySelector('#sort-filter').dispatchEvent(new w.Event('change',{bubbles:true}));assert.deepEqual([...d.querySelectorAll('tbody td[data-label=Candidate] strong')].map(e=>e.textContent),['Synthetic Alpha','Synthetic Zeta']);
  const search=d.querySelector('#search');search.value='zeta';search.dispatchEvent(new w.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,150));assert.match(d.querySelector('#candidate-results').textContent,/Synthetic Zeta/);assert.doesNotMatch(d.querySelector('#candidate-results').textContent,/Synthetic Alpha/);
  click('csv');const csv=await blobs.at(-1).text();assert.ok(csv.startsWith('"Name","Code"'));assert.match(csv,/Synthetic Zeta/);assert.match(csv,/QA-LEGACY/);
  const reloaded=open();try{await tick();assert.match(reloaded.window.document.querySelector('#candidate-results').textContent,/Synthetic Alpha/);assert.match(reloaded.window.document.querySelector('#candidate-results').textContent,/Synthetic Zeta/);}finally{reloaded.window.close();}
  assert.deepEqual(errors,[]);
 }finally{w.close();}
});
