import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {dateSL} from '../src/model.js';

test('COO queues, handover, filter reset and closed candidate actions remain consistent',async()=>{
  const jid='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222';
  const events=[];
  function add(kind,payload,subject_id=null){const id=crypto.randomUUID();events.push({id,seq:events.length+1,kind,payload,subject_id,event_date:dateSL(),created_at:new Date().toISOString()});return id;}
  events.push({id:jid,seq:1,kind:'job',subject_id:null,event_date:dateSL(),payload:{title:'Partnerships',department:'Growth',location:'Remote',status:'Open'}});
  events.push({id:cid,seq:2,kind:'candidate',subject_id:null,event_date:dateSL(),payload:{alias:'QA-COO',job_id:jid,stage:'Sourced',source:'Referral',action:'Review',owner:'COO',due:dateSL(),commission_ack:'Accepted',terms_detail:''}});
  add('summary',{progress:'Current handover',priorities:'Next review'});
  const deleted=add('summary',{progress:'Deleted handover',priorities:'Old priority'});
  add('summary',{operation:'delete',target_id:deleted,note:'Remove old handover'});
  // Trashing a position must not hide its active candidates from the COO.
  add('summary',{operation:'delete',target_id:jid,note:'Position archived'});
  const errors=[];
  const dom=new JSDOM(readFileSync(new URL('../../index.html',import.meta.url),'utf8'),{url:'https://example.test/#coo',runScripts:'dangerously',beforeParse(w){
    w.AbortSignal=AbortSignal;w.TextEncoder=TextEncoder;
    w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
    w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
    w.fetch=async url=>String(url).includes('/bootstrap')?Response.json({events,cursor:events.length}):String(url).includes('/maintenance')?Response.json({backup_cursor:0,pending_receipts:0}):Response.json(events.filter(e=>e.seq>Number(new URL(url,'https://example.test').searchParams.get('after')||0)));
    w.addEventListener('error',e=>errors.push(e.error));
  }});
  const w=dom.window,d=w.document,tick=()=>new Promise(r=>setTimeout(r,50));
  const panel=title=>[...d.querySelectorAll('.panel')].find(p=>p.querySelector('h2')?.textContent===title);
  try{
    await tick();
    assert.match(panel('Today’s next actions').textContent,/QA-COO/);
    assert.match(panel('Commission acknowledgement').textContent,/QA-COO/);
    assert.match(panel('Daily COO handover').textContent,/Current handover/);
    assert.doesNotMatch(panel('Daily COO handover').textContent,/Deleted handover|undefined/);
    w.location.hash='pipeline';await tick();
    const sort=d.querySelector('#sort-filter');sort.value='code';sort.dispatchEvent(new w.Event('change',{bubbles:true}));
    d.querySelector('[data-action=reset]').click();assert.equal(d.querySelector('#sort-filter').value,'recent');assert.equal(d.activeElement.id,'search');
    add('stage',{stage:'Hired',start_date:dateSL()},cid);w.dispatchEvent(new w.Event('online'));await tick();
    d.querySelector('[data-action=view]').click();await tick();
    assert.match(d.querySelector('.next-action-card').textContent,/Hiring completed/);
    assert.equal(d.querySelector('.next-action-card button').dataset.action,'correction');
    assert.deepEqual(errors,[]);
  }finally{w.close();}
});
