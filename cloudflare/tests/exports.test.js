import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';

test('JSON, filtered CSV and SL calendar exports contain the persisted synthetic records',async()=>{
 const jid='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222',hired='33333333-3333-4333-8333-333333333333';
 const events=[
  {id:jid,kind:'job',payload:{title:'=2+2',department:'Growth',location:'Remote',status:'Open'}},
  {id:cid,kind:'candidate',payload:{alias:'QA-ACTIVE',job_id:jid,stage:'Sourced',source:'Referral'}},
  {id:hired,kind:'candidate',payload:{alias:'QA-HIRED',job_id:jid,stage:'Sourced',source:'Referral'}},
  {id:'44444444-4444-4444-8444-444444444444',kind:'stage',subject_id:hired,payload:{stage:'Hired',start_date:'2026-12-21'}},
  {id:'55555555-5555-4555-8555-555555555555',kind:'stage',subject_id:cid,payload:{stage:'R1 Scheduled',r1:'2026-12-20T09:00'}}
 ].map((e,i)=>({...e,seq:i+1,subject_id:e.subject_id||null,event_date:'2026-11-23',created_at:'2026-11-23T00:00:00Z'}));
 const blobs=[],downloads=[],errors=[];let writes=0;
 const dom=new JSDOM(readFileSync(new URL('../../index.html',import.meta.url),'utf8'),{url:'https://example.test/#overview',runScripts:'dangerously',beforeParse(w){
  w.TextEncoder=TextEncoder;w.AbortSignal=AbortSignal;w.Blob=Blob;
  w.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:https://example.test/'+blobs.length;};w.URL.revokeObjectURL=()=>{};
  const nativeClick=w.HTMLAnchorElement.prototype.click;w.HTMLAnchorElement.prototype.click=function(){if(this.download){downloads.push(this.download);return;}nativeClick.call(this);};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  w.fetch=async(url,options={})=>{if(options.method==='POST'){writes++;throw Error('No mutations expected');}if(String(url).includes('/bootstrap'))return Response.json({events,cursor:events.length});if(String(url).includes('/integrations'))return Response.json({drive_ready:false});if(String(url).includes('/maintenance'))return Response.json({backup_cursor:0,pending_receipts:0});const u=new URL(url,'https://example.test');return Response.json(events.filter(e=>e.seq>Number(u.searchParams.get('after')||0)));};
  w.addEventListener('error',event=>errors.push(event.error));
 }});
 const w=dom.window,d=w.document,tick=()=>new Promise(r=>setTimeout(r,40));
 try{
  await tick();d.querySelector('[data-action=export]').click();await tick();assert.equal(JSON.parse(await blobs[0].text()).events.length,events.length);assert.match(downloads[0],/\.json$/);
  w.location.hash='pipeline';await tick();d.querySelector('#stage-filter').value='Hired';d.querySelector('#stage-filter').dispatchEvent(new w.Event('change',{bubbles:true}));d.querySelector('[data-action=csv]').click();
  const csv=await blobs[1].text();assert.match(csv,/QA-HIRED/);assert.doesNotMatch(csv,/QA-ACTIVE/);assert.ok(csv.includes('"\'=2+2"'),'spreadsheet formula is escaped');assert.equal(csv.split('\r\n').length,2);
  w.location.hash='interviews';await tick();d.querySelector('[data-action=calendar]').click();const calendar=await blobs[2].text();assert.match(calendar,/DTSTART:20261220T033000Z/);assert.match(calendar,/DTEND:20261220T040000Z/);assert.match(calendar,/QA-ACTIVE/);assert.match(downloads[2],/\.ics$/);
  for(const line of calendar.split('\r\n'))assert.ok(new TextEncoder().encode(line).length<=75);
  w.location.hash='coo';await tick();const setup=d.querySelector('[data-action=documents]');assert.equal(setup.textContent,'Upload documents');setup.click();await tick();assert.match(d.querySelector('dialog').textContent,/existing private recruitment Drive destination/);assert.equal(d.querySelectorAll('dialog input[type=file]').length,2);assert.equal(d.querySelector('#document-entry [type=submit]').disabled,true);
  assert.equal(writes,0);assert.deepEqual(errors,[]);
 }finally{w.close();}
});
