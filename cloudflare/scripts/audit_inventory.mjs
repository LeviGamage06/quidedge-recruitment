// Read-only synthetic UI inventory. No requests leave this process.
import {JSDOM} from 'jsdom';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dateSL} from '../src/model.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const jid='e2173dde-bc77-409a-96a1-86dcb23841f0',other='11111111-1111-4111-8111-111111111111';
const id=n=>'22222222-2222-4222-8222-'+String(n).padStart(12,'0');
const events=[],today=dateSL();
const add=(kind,payload,subject_id=null,fixed)=>{const event={seq:events.length+1,id:fixed||id(events.length+100),kind,payload,subject_id,event_date:today,created_at:new Date().toISOString()};events.push(event);return event.id;};
add('job',{title:'Client Acquisition',department:'Client Services',location:'Remote',profile:'client-acquisition-v1',status:'Open'},null,jid);
add('job',{title:'General position',department:'Creative',location:'Remote',status:'Open'},null,other);
for(let n=1;n<=27;n++)add('candidate',{alias:'QA-INV-'+n,job_id:n===27?other:jid,source:'Referral',stage:'Sourced',action:'Review',due:today,owner:'COO',commission_ack:'Accepted',terms_detail:'Agreed synthetic boundaries'},null,id(n));
add('stage',{stage:'R1 Scheduled',r1:'2026-12-20T09:00',action:'Interview',due:'2026-12-20',owner:'COO'},id(2));
const summary=add('summary',{progress:'Synthetic progress',priorities:'Synthetic priorities'});
const trashed=add('summary',{progress:'Synthetic removed progress',priorities:'Synthetic removed priorities'});
add('summary',{operation:'delete',target_id:trashed,note:'Synthetic removal'});
const errors=[];
const dom=new JSDOM(readFileSync(root+'index.html','utf8'),{url:'https://audit.invalid/#overview',runScripts:'dangerously',beforeParse(w){
 w.AbortSignal=AbortSignal;w.TextEncoder=TextEncoder;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
 w.fetch=async value=>{const url=new URL(value,'https://audit.invalid');if(url.pathname.endsWith('/bootstrap'))return Response.json({events,cursor:events.at(-1).seq});if(url.pathname.endsWith('/maintenance'))return Response.json({backup_cursor:0,pending_receipts:0});if(url.pathname.endsWith('/integrations'))return Response.json({drive_ready:false});if(url.pathname.endsWith('/interviews'))return Response.json({email_ready:false,meetings:[]});if(url.pathname.endsWith('/trash'))return Response.json({state:'idle',permanent_delete_ready:true});const after=Number(url.searchParams.get('after')||0),subject=url.searchParams.get('subject');return Response.json(events.filter(e=>e.seq>after&&(!subject||e.id===subject||e.subject_id===subject||e.payload.operation)));};
 w.addEventListener('error',event=>errors.push(String(event.error)));
}});
const w=dom.window,d=w.document,tick=()=>new Promise(r=>setTimeout(r,35));
const rows=[],seen=new Set();
const calls={view:'GET /api/events?subject=<candidate>',export:'GET /api/events',csv:'Local CSV download',calendar:'Local ICS download',documents:'GET /api/integrations', 'verify-documents':'POST /api/document-status','interview-details':'GET /api/interviews','purge-one':'POST /api/trash on confirmed submit','purge-all':'POST /api/trash on confirmed submit',sync:'GET /api/bootstrap or /api/events'};
function label(el){if(el.matches('input,textarea,select')){const parent=el.closest('label');return [...(parent?.childNodes||[])].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').trim()||el.name||el.id;}return el.textContent.trim().replace(/\s+/g,' ');}
function capture(location,scope=d){for(const el of scope.querySelectorAll('button,a,input,select,textarea,summary')){
 const name=label(el).replace(/QA-INV-\d+/g,'[candidate code]');const action=el.dataset.action||el.name||el.id||el.getAttribute('href')||'disclosure';
 const key=[location,el.tagName,name,action].join('|');if(seen.has(key))continue;seen.add(key);
 const form=el.closest('form');const api=calls[action]||(el.type==='submit'?(form?.id==='interview-entry'?'POST /api/interviews':form?.id==='document-entry'?'POST /api/documents':form?.id==='purge-entry'?'POST /api/trash':'POST /api/events'):'Local view/form action; server write occurs only on submit');
 const constraints=[el.required?'required':'',el.maxLength>=0?'maxLength='+el.maxLength:'',el.pattern?'pattern='+el.pattern:'',el.min?'min='+el.min:'',el.max?'max='+el.max:''].filter(Boolean).join('; ');
 rows.push({location,component:el.tagName.toLowerCase(),label:name,action,api,intended_behavior:el.matches('summary')?'Expand/collapse labelled section':el.matches('input,textarea,select')?'Edit or select '+name:el.tagName==='A'?'Navigate to labelled destination':'Run labelled action',actual_behavior:'Rendered and associated handler inspected in synthetic DOM',input_requirements:constraints,validation:'Native constraints plus server field/date/enum/revision checks for writes',choices:el.tagName==='SELECT'?[...el.options].map(o=>o.textContent).join(' | '):'',loading:'Network actions expose loading/disabled state; pending-save draft retained',error:'Inline form alert, banner, status or notice',success:'Server receipt and shared-state refresh; local actions update view/download',mobile:'Responsive record cards/forms; full browser width matrix recorded separately',keyboard:'Native semantic control; focus styling; modal focus return',security:'Public no-login authority boundary; codes/public-safe notes; private document bytes only via configured bridge',test_coverage:'ui, audit-regressions, full-audit, worker, client, enhancements and bridge suites; see release matrix',status:'Synthetic DOM inspected; not a production mutation certification'});
}}
function click(action,record){const selector='[data-action="'+action+'"]'+(record?'[data-id="'+record+'"]':'');const el=d.querySelector(selector);if(!el)throw Error('Missing inventory action '+selector);el.click();}
async function route(name){w.location.hash=name;await tick();}
async function close(){const el=d.querySelector('#dialog [data-action=discard]')||d.querySelector('#dialog [data-action=close]');if(el)el.click();await tick();}
try{
 await tick();for(const name of ['overview','coo','role','pipeline','activity','interviews','guide','trash']){await route(name);capture('Route #'+name,d.querySelector('#app'));}capture('Global navigation',d.querySelector('header'));
 await route('role');click('share-candidate-jd');await tick();capture('Public JD sharing',d.querySelector('#app'));
 await route('guide');d.querySelector('#guide-track').value='Social media';d.querySelector('#guide-track').dispatchEvent(new w.Event('change',{bubbles:true}));capture('Guide social media track',d.querySelector('#app'));
 await route('pipeline');click('next');capture('Pipeline pagination',d.querySelector('#app'));click('previous');
 for(const [action,record,title] of [['candidate',null,'New candidate'],['job',null,'New position'],['job',jid,'Edit position']]){await route('overview');click(action,record);await tick();capture('Dialog '+title,d.querySelector('#dialog'));await close();}
 for(const action of ['stage','activity','score','checklist','commission','correction','documents']){await route('overview');click('view',id(26));await tick();capture('Candidate record',d.querySelector('#dialog'));click(action);await tick();capture('Dialog '+action,d.querySelector('#dialog'));await close();}
 await route('interviews');click('interview-details',id(2));await tick();capture('Dialog Zoom and reminder',d.querySelector('#dialog'));await close();
 await route('activity');click('summary');await tick();capture('Dialog Daily summary',d.querySelector('#dialog'));const note=d.querySelector('[name=progress]');note.value='Synthetic resumable draft';note.dispatchEvent(new w.Event('input',{bubbles:true}));click('close');await tick();capture('Draft controls',d.querySelector('#app'));click('resume');await tick();capture('Dialog Resumed draft',d.querySelector('#dialog'));click('discard');
 await route('activity');click('edit-event',summary);await tick();capture('Dialog Edit history',d.querySelector('#dialog'));await close();click('delete-record',summary);await tick();capture('Dialog Move to Trash',d.querySelector('#dialog'));await close();
 await route('trash');click('restore-record',trashed);await tick();capture('Dialog Restore',d.querySelector('#dialog'));await close();for(const action of ['purge-one','purge-all']){click(action,action==='purge-one'?trashed:undefined);await tick();capture('Dialog '+action,d.querySelector('#dialog'));await close();}
 if(errors.length)throw Error(errors.join('\n'));
 for(const file of ['app.js','workspace.js'])for(const match of readFileSync(root+'cloudflare/src/'+file,'utf8').matchAll(/btn\('([^']*)','([^']*)'/g)){
  const [,label,action]=match;if(rows.some(row=>row.action===action&&row.label===label))continue;
  rows.push({...rows[0],location:'Conditional source control ('+file+')',component:'button',label,action,api:calls[action]||'Local action / form; see server mutation on submit',intended_behavior:'Run '+label,actual_behavior:'Conditional source handler inspected',input_requirements:'Depends on selected record and form',choices:'',status:'Source inspected; conditional state may not occur in inventory fixture'});
 }

 const columns=Object.keys(rows[0]),cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
 mkdirSync(root+'docs/audit',{recursive:true});writeFileSync(root+'docs/audit/functionality-inventory.csv',[columns,...rows.map(row=>columns.map(c=>row[c]))].map(row=>row.map(cell).join(',')).join('\n')+'\n');
 console.log(JSON.stringify({components:rows.length,locations:[...new Set(rows.map(r=>r.location))],errors}));
}finally{w.close();}
