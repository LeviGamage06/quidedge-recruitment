import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {dateSL} from '../src/model.js';

test('candidate records open only matching saved CV/cover links and ignore late responses for a closed panel',async()=>{
 const job=crypto.randomUUID(),a=crypto.randomUUID(),b=crypto.randomUUID(),events=[{id:job,seq:1,kind:'job',subject_id:null,event_date:dateSL(),payload:{title:'QA role',status:'Open'}},...[a,b].map((id,index)=>({id,seq:index+2,kind:'candidate',subject_id:null,event_date:dateSL(),payload:{job_id:job,name:'Synthetic '+index,alias:'QA-'+index,source:'Referral',stage:'Sourced'}}))];
 let delayed,hold=false;
 const dom=new JSDOM(readFileSync(new URL('../../index.html',import.meta.url),'utf8'),{url:'https://example.test/#pipeline',runScripts:'dangerously',beforeParse(w){
  w.AbortSignal=AbortSignal;w.TextEncoder=TextEncoder;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  w.fetch=async(url)=>{const u=new URL(url,'https://example.test');
   if(u.pathname.endsWith('/documents')){const cid=u.searchParams.get('candidate_id');if(hold&&cid===a)await new Promise(resolve=>{delayed=resolve;});return Response.json({candidate_id:cid,documents:[{type:'cv',status:'Available',url:'https://drive.google.com/file/d/'+cid+'/view'},{type:'cover',status:cid===a?'Available':'Missing',url:'https://drive.google.com/file/d/cover_'+cid+'/view'}]});}
   if(u.pathname.endsWith('/bootstrap'))return Response.json({events,cursor:3});
   return Response.json(events.filter(e=>e.seq>Number(u.searchParams.get('after')||0)));
  };
 }});
 const d=dom.window.document,tick=()=>new Promise(resolve=>setTimeout(resolve,60)),open=id=>d.querySelector('[data-action="view"][data-id="'+id+'"]').click(),close=()=>d.querySelector('dialog [data-action="close"]').click();
 try{
  await tick();open(a);await tick();let links=d.querySelectorAll('[data-document-links] a');assert.equal(links.length,2);assert.equal(links[0].textContent,'Open CV');assert.equal(links[1].textContent,'Open cover letter');assert.equal(links[0].target,'_blank');assert.equal(links[0].rel,'noopener noreferrer');close();
  hold=true;open(a);await tick();close();open(b);await tick();delayed();await tick();
  links=d.querySelectorAll('[data-document-links] a');assert.equal(links.length,1);assert.match(links[0].href,new RegExp(b));assert.doesNotMatch(links[0].href,new RegExp(a));assert.match(d.querySelector('[data-document-links]').textContent,/cover letter: No saved file/);
 }finally{dom.window.close();}
});
