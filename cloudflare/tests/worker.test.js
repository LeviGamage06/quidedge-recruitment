import * as requireFs from 'node:fs';
import {validPdf,pdfText,validDocx} from './fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import worker from '../worker.js';
import {defaultRoleRecord} from '../src/role.js';
import {checkDocument} from '../src/documents.js';

const origin = 'https://levigamage06.github.io';
const request = (path, options) => new Request('https://quidedge.example' + path, options);
const directory = mkdtempSync(join(tmpdir(), 'quidedge-test-'));
const database = join(directory, 'records.sqlite');
const python = `import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row
q=json.loads(sys.stdin.read())
if q.get('schema'):
 c.executescript(q['schema']); out=None
else:
 r=c.execute(q['sql'], q['parameters']); out=[dict(x) for x in r.fetchall()]
c.commit(); print(json.dumps(out))`;
function sql(sql, parameters=[], schema) {
  return JSON.parse(execFileSync('python3',['-c',python,database],{
    input:JSON.stringify({sql,parameters,schema}),encoding:'utf8',stdio:['pipe','pipe','pipe']
  }));
}
sql('', [], readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url),'utf8')+readFileSync(new URL('../migrations/0002_operations.sql', import.meta.url),'utf8'));
const DB = {
  withSession() { return this; },
  prepare(statement) {
    let parameters=[];
    return {
      bind(...values) { parameters=values; return this; },
      async all() { return {results:sql(statement,parameters)}; },
      async first() { return sql(statement,parameters)[0] || null; },
      async run() { sql(statement,parameters); return {success:true}; }
    };
  }
};

async function saveRecord(body){
 if(body.subject_id || body.kind==='job'&&body.payload.job_id){const id=body.subject_id||body.payload.job_id;body={...body,expected_seq:body.expected_seq??sql(`SELECT MAX(seq) AS seq FROM recruitment_events WHERE id=? OR subject_id=? OR json_extract(payload,'$.job_id')=?`,[id,id,id])[0].seq};}
 return worker.fetch(request('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{DB});
}

test.after(() => rmSync(directory,{recursive:true,force:true}));
test('frontend assets use the independent same-origin API', async () => {
  const response=await worker.fetch(request('/config.js'),{});
  assert.equal(response.status,200);
  const body=await response.text();
  assert.match(body,/eventsUrl: '\/api\/events'/);
  assert.doesNotMatch(readFileSync(new URL('../worker.js',import.meta.url),'utf8'),/chatgpt\.site/);
});
test('API preflight allows the existing GitHub frontend',async()=>{
  const response=await worker.fetch(request('/api/events',{method:'OPTIONS',headers:{Origin:origin}}),{});
  assert.equal(response.status,204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
});
test('unapproved browser origins cannot append records',async()=>{
  assert.equal((await worker.fetch(request('/api/events',{method:'POST',headers:{Origin:'https://unknown.example'}}),{DB})).status,403);
});
test('storage outage is explicit and update/delete are unavailable',async()=>{
  assert.equal((await worker.fetch(request('/api/events'),{})).status,503);
  for(const method of ['PUT','PATCH','DELETE']) assert.equal((await worker.fetch(request('/api/events',{method}),{DB})).status,405);
});
test('records persist, retries are idempotent and conflicting IDs are rejected',async()=>{
  const record={id:'5fe51d80-42df-460a-b94b-42a3a2dcd815',kind:'job',subject_id:null,event_date:'2026-11-05',payload:{title:'Social Media Strategist',department:'Creative',location:'Remote'}};
  const save=body=>worker.fetch(request('/api/events',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)}),{DB});
  assert.equal((await save(record)).status,201);
  assert.equal((await save(record)).status,200);
  assert.equal((await save({...record,payload:{...record.payload,title:'Changed'}})).status,409);
  const rows=await (await worker.fetch(request('/api/events'),{DB})).json();
  assert.equal(rows.length,1); assert.equal(rows[0].payload.title,record.payload.title);
  assert.equal((await (await worker.fetch(request('/api/events?after=1'),{DB})).json()).length,0);
});
test('database triggers block UPDATE and DELETE',()=>{
  assert.throws(()=>sql("UPDATE recruitment_events SET kind='summary'"));
  assert.throws(()=>sql('DELETE FROM recruitment_events'));
  assert.equal(sql('SELECT COUNT(*) AS total FROM recruitment_events')[0].total,1);
});

test('clean Pages URL is allowed, lookalike origins remain blocked',async()=>{
 const origin='https://quidedge-hire.pages.dev';
 const response=await worker.fetch(request('/api/events',{method:'OPTIONS',headers:{Origin:origin}}),{});
 assert.equal(response.status,204);
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
 assert.equal((await worker.fetch(request('/api/events',{headers:{Origin:origin+'.attacker.example'}}),{DB})).status,403);
});

test('role, commission review and Round 1 gate use preserved event history',async()=>{
  const save=saveRecord;
  const job=defaultRoleRecord('2026-11-05');assert.equal((await save(job)).status,201);
  const candidate={id:'d3057f15-9b02-43de-92d0-0cb296ecf63e',kind:'candidate',subject_id:null,event_date:'2026-11-05',payload:{alias:'QE-TEST',job_id:job.id,source:'Referral',stage:'Sourced',action:'Review application',due:'2026-11-06',owner:'COO',commission_plan:'10 / 20 / 30 recurring',commission_ack:'Pending'}};
  assert.equal((await save(candidate)).status,201);
  const stage={id:'d3057f15-9b02-43de-92d0-0cb296ecf63f',kind:'stage',subject_id:candidate.id,event_date:'2026-11-05',payload:{stage:'R1 Scheduled',note:'Ready',action:'Interview',due:'2026-11-06',owner:'COO',r1:'2026-11-06T10:00'}};
  assert.equal((await save(stage)).status,400);
  assert.equal((await save({id:'d3057f15-9b02-43de-92d0-0cb296ecf640',kind:'activity',subject_id:candidate.id,event_date:'2026-11-05',payload:{event:'Commission terms reviewed',note:'No fixed salary and recurring terms explained.',commission_plan:'10 / 20 / 30 recurring',commission_ack:'Accepted',terms_detail:'Standard recurring structure. Boundary amounts require written agreement.'}})).status,201);
  assert.equal((await save(stage)).status,201);
  assert.equal(sql('SELECT COUNT(*) AS total FROM recruitment_events WHERE id=?',[candidate.id])[0].total,1);
});
test('document readiness is honest and file validation rejects disguised content',async()=>{
  const status=await(await worker.fetch(request('/api/integrations'),{})).json();
  assert.equal(status.drive_ready,false);
  assert.equal((await worker.fetch(request('/api/documents',{method:'POST'}),{DB})).status,503);
  await assert.rejects(()=>checkDocument(new File(['<script>bad</script>'],'cv.pdf',{type:'application/pdf'})));
  assert.equal((await checkDocument(new File([validPdf],'cv.pdf'))).extension,'pdf');
});
test('Drive receipt is idempotent and private names and bytes never enter public storage',async()=>{
  const original=globalThis.fetch;let calls=0;
  const env={DB,DRIVE_WEB_APP_URL:'https://script.google.com/macros/s/test_deployment/exec',DRIVE_WEB_APP_SECRET:'test-only-connection-key-with-32-characters'};
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,env.DRIVE_WEB_APP_URL);assert.equal(JSON.parse(options.body).name,'Private Applicant Name');return Response.json({ok:true,document_type:'cv'});};
  try{
    const data={id:'d3057f15-9b02-43de-92d0-0cb296ecf641',candidate_id:'d3057f15-9b02-43de-92d0-0cb296ecf63e',name:'Private Applicant Name',document_type:'cv',extension:'pdf',data:btoa(validPdf)};
    const save=()=>worker.fetch(request('/api/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),env);
    const response=await save();assert.equal(response.status,201);
    const result=await response.json();assert.equal(result.event.payload.document_type,'cv');
    assert.equal((await save()).status,200);assert.equal(calls,1);
    const publicData=JSON.stringify(await(await worker.fetch(request('/api/events'),{DB})).json());
    assert.doesNotMatch(publicData,/Private Applicant Name|private bytes|test-only-connection-key|script.google.com/);
  }finally{globalThis.fetch=original;}
});
test('reusing an upload receipt for changed content is rejected without forwarding',async()=>{
 const env={DB,DRIVE_WEB_APP_URL:'https://script.google.com/macros/s/test_deployment/exec',DRIVE_WEB_APP_SECRET:'test-only-connection-key-with-32-characters'};
 const input={id:'d3057f15-9b02-43de-92d0-0cb296ecf641',candidate_id:'d3057f15-9b02-43de-92d0-0cb296ecf63e',name:'Private Applicant Name',document_type:'cv',extension:'pdf',data:btoa(pdfText('Different valid document'))};
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('Must not forward conflicting retry');};
 try{const response=await worker.fetch(request('/api/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),env);assert.equal(response.status,409);}finally{globalThis.fetch=original;}
});
test('integration readiness requires an authenticated live protocol response',async()=>{
 const env={DRIVE_WEB_APP_URL:'https://script.google.com/macros/s/test_deployment/exec',DRIVE_WEB_APP_SECRET:'test-only-connection-key-with-32-characters'};
 const original=globalThis.fetch;
 try {
  for(const [reply,expected] of [[{ok:true,ready:true,protocol:3},true],[{ready:true},false],[{ok:false,code:'UNAUTHORIZED'},false],[{ok:true,ready:true,protocol:1},false]]) {
   globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);assert.equal(body.action,'health');assert.equal(body.secret,env.DRIVE_WEB_APP_SECRET);return Response.json(reply);};
   assert.equal((await(await worker.fetch(request('/api/integrations'),env)).json()).drive_ready,expected);
  }
 }finally{globalThis.fetch=original;}
});
const id=()=>crypto.randomUUID();
const candidateId='d3057f15-9b02-43de-92d0-0cb296ecf63e';
const linked=(kind,payload,subject=candidateId)=>({id:id(),kind,subject_id:subject,event_date:'2026-11-06',payload});
test('declined commission blocks R2 and hiring even with a completed checklist',async()=>{
 assert.equal((await saveRecord(linked('activity',{event:'Commission terms reviewed',note:'Candidate declined',commission_plan:'10 / 20 / 30 recurring',commission_ack:'Declined',terms_detail:'Confirmed written boundaries'}))).status,201);
 assert.equal((await saveRecord(linked('activity',{event:'Hiring checklist updated',note:'Evidence checked',terms:'Complete',writing:'Complete',references:'Complete',offer:'Complete',agreement:'Complete',nda:'Complete'}))).status,201);
 for(const stage of ['R2 Scheduled','Hired'])assert.equal((await saveRecord(linked('stage',{stage,note:'Advance',action:'Interview',owner:'COO',due:'2026-11-07',r2:'2026-11-07T12:00',start_date:'2026-11-08'}))).status,400);
});
test('missing revision and invalid enums cannot bypass public API validation',async()=>{
 const missing=linked('stage',{stage:'Contacted',note:'Follow up',action:'Wait',owner:'COO',due:'2026-11-07'});
 assert.equal((await worker.fetch(request('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(missing)}),{DB})).status,409);
 for(const payload of [{round:'R1',recommendation:'Advance',reviewer:'BAD',score1:'5',note:'Evidence'},{round:'R1',recommendation:'Advance',reviewer:'COO',score1:'5',note:'Phone +94 77 123 4567'}])assert.equal((await saveRecord(linked('score',payload))).status,400);
});
test('append-only corrections update current details and reserve historical candidate codes',async()=>{
 const correction={event:'Candidate details corrected',alias:'QE-CORRECTED',source:'Other',availability:'Available now',notice:'Immediate',market:'Australia',note:'Correct initial details'};
 assert.equal((await saveRecord(linked('activity',correction))).status,201);
 assert.equal(sql("SELECT json_extract(payload,'$.alias') AS alias FROM recruitment_events WHERE id=?",[candidateId])[0].alias,'QE-TEST');
 const body={id:id(),kind:'candidate',subject_id:null,event_date:'2026-11-06',payload:{alias:'QE-CORRECTED',job_id:defaultRoleRecord('2026-11-06').id,source:'Other',stage:'Sourced',action:'Review',owner:'COO',due:'2026-11-07',commission_plan:'10 / 20 / 30 recurring',commission_ack:'Pending'}};
 assert.equal((await saveRecord(body)).status,409);
});
test('interview overlap is checked atomically and adjacent slots are allowed',async()=>{
 const make=async alias=>{const body={id:id(),kind:'candidate',subject_id:null,event_date:'2026-11-06',payload:{alias,job_id:defaultRoleRecord('2026-11-06').id,source:'Referral',stage:'Sourced',action:'Review',owner:'COO',due:'2026-11-07',commission_plan:'10 / 20 / 30 recurring',commission_ack:'Accepted',terms_detail:'Written commission boundaries confirmed'}};assert.equal((await saveRecord(body)).status,201);return body.id;};
 const a=await make('QE-BOOK-A'),b=await make('QE-BOOK-B');
 const schedule=(candidate,slot)=>saveRecord(linked('stage',{stage:'R1 Scheduled',r1:slot,note:'Book interview',action:'Interview',owner:'COO',due:'2026-11-07'},candidate));
 assert.equal((await schedule(a,'2026-11-07T12:00')).status,201);
 assert.equal((await schedule(b,'2026-11-07T12:15')).status,409);
 assert.equal((await schedule(b,'2026-11-07T12:30')).status,201);
});
test('bootstrap includes history required to undo deleted or edited records',async()=>{
 const {project}=await import('../src/model.js');
 for(let i=0;i<8;i++)assert.equal((await saveRecord({...linked('activity',{event:'Follow-up sent',note:'Old follow up'}),event_date:'2025-01-01'})).status,201);
 const full=await(await worker.fetch(request('/api/events'),{DB})).json();
 const response=await worker.fetch(request('/api/bootstrap'),{DB});assert.equal(response.status,200);const snapshot=await response.json();
 const trim=events=>{const state=project(events);for(const c of state.candidates)delete c.history;return state;};
 assert.deepEqual(trim(snapshot.events),trim(full));assert.equal(snapshot.events.length,full.length);assert.equal(snapshot.cursor,full.at(-1).seq);
});
test('status checks only expose safe availability and never accept manual availability events',async()=>{
 assert.equal((await saveRecord(linked('activity',{event:'Document availability checked',note:'Spoofed',cv_state:'Available',cover_state:'Available'}))).status,400);
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({ok:true,cv:'Available',cover:'Missing'});
 try{const env={DB,DRIVE_WEB_APP_URL:'https://script.google.com/macros/s/test_deployment/exec',DRIVE_WEB_APP_SECRET:'test-only-connection-key-with-32-characters'};const response=await worker.fetch(request('/api/document-status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id(),candidate_id:candidateId})}),env);assert.equal(response.status,200);const body=await response.json();assert.equal(body.event.payload.cv_state,'Available');assert.equal(body.cover,'Missing');}finally{globalThis.fetch=original;}
});
test('maintenance reconciles a Drive-success/database-failure receipt and saves a private backup',async()=>{
 const job={id:id(),candidate_id:candidateId,fingerprint:'recover-test',document_type:'cv',event_date:'2026-11-06',payload:JSON.stringify({event:'Document stored',upload_fingerprint:'recover-test',document_type:'cv',note:'Recovery receipt'})};
 sql('INSERT INTO document_outbox(id,candidate_id,fingerprint,document_type,event_date,payload) VALUES (?,?,?,?,?,?)',Object.values(job));
 const original=globalThis.fetch;let backups=0;globalThis.fetch=async(url,options)=>{const p=JSON.parse(options.body);if(p.action==='receipt')return Response.json({ok:true,uploaded:true,document_type:'cv'});if(p.action==='backup'){backups++;assert.ok(p.records.length);return Response.json({ok:true,saved:true,last:p.last});}throw Error('Unexpected bridge operation');};
 try{let pending;await worker.scheduled({}, {DB,DRIVE_WEB_APP_URL:'https://script.google.com/macros/s/test_deployment/exec',DRIVE_WEB_APP_SECRET:'test-only-connection-key-with-32-characters'},{waitUntil:p=>{pending=p;}});await pending;assert.equal(sql('SELECT state FROM document_outbox WHERE id=?',[job.id])[0].state,'complete');assert.equal(sql('SELECT COUNT(*) AS total FROM recruitment_events WHERE id=?',[job.id])[0].total,1);assert.equal(backups,1);}finally{globalThis.fetch=original;}
});
test('application write limits reject bursts without deleting or rewriting recruitment data',async()=>{
 const env={DB,DRIVE_WEB_APP_SECRET:'test-only-connection-key-with-32-characters'};
 const originalNow=Date.now;Date.now=()=>1793932800000;
 try{let response;for(let i=0;i<61;i++)response=await worker.fetch(request('/api/events',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'198.51.100.15'},body:'{}'}),env);
 assert.equal(response.status,429);assert.ok(response.headers.get('Retry-After'));}
 finally{Date.now=originalNow;}
});
test('obsolete asset version URLs are revalidated instead of immutable caching',async()=>{const response=await worker.fetch(request('/app.js?v=old-version'),{});assert.equal(response.headers.get('Cache-Control'),'no-cache');});
test('DOCX validation checks package contents and rejects fake ZIP and truncated PDFs',async()=>{
 assert.equal((await checkDocument(new File([validDocx],'letter.docx'))).extension,'docx');
 await assert.rejects(()=>checkDocument(new File([new Uint8Array([80,75,3,4,0,0,0,0])],'fake.docx')));
 await assert.rejects(()=>checkDocument(new File(['%PDF-1.4 truncated'],'fake.pdf')));
});
test('private event backup restore recreates original IDs, payloads, timestamps and append-only triggers',()=>{
 const rows=sql('SELECT * FROM recruitment_events ORDER BY seq').map(row=>({...row,payload:JSON.parse(row.payload)}));
 const backup=join(directory,'restore-fixture.json'),output=join(directory,'restore.sql'),restored=join(directory,'restored.sqlite');
 const {writeFileSync,readFileSync}=requireFs;
 writeFileSync(backup,JSON.stringify({schema:1,first:rows[0].seq,last:rows.at(-1).seq,events:rows}));
 execFileSync('python3',[new URL('../scripts/restore_backup.py',import.meta.url).pathname,backup,'--output',output]);
 const result=JSON.parse(execFileSync('python3',['-c',`import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]);c.executescript(open(sys.argv[2]).read());c.row_factory=sqlite3.Row
print(json.dumps([dict(r) for r in c.execute('SELECT * FROM recruitment_events ORDER BY seq')]))`,restored,output],{encoding:'utf8'}));
 assert.deepEqual(result.map(row=>({...row,payload:JSON.parse(row.payload)})),rows);
 assert.throws(()=>execFileSync('python3',['-c',"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('DELETE FROM recruitment_events')",restored],{stdio:'pipe'}));
});
test('accepted commission cannot be recorded on a new candidate without agreed boundaries',async()=>{
 const record={id:id(),kind:'candidate',subject_id:null,event_date:'2026-11-06',payload:{alias:'QE-TERMS-REQUIRED',job_id:defaultRoleRecord('2026-11-06').id,source:'Referral',stage:'Sourced',action:'Review',owner:'COO',due:'2026-11-07',commission_plan:'10 / 20 / 30 recurring',commission_ack:'Accepted'}};
 assert.equal((await saveRecord(record)).status,400);
 assert.equal((await saveRecord({...record,payload:{...record.payload,terms_detail:'Written agreement sets the applicable boundaries'}})).status,201);
});
test('unconfirmed old uploads cannot starve later receipt recovery jobs',async()=>{
 const created=[];
 for(let n=0;n<17;n++){const requestId=id();created.push(requestId);sql('INSERT INTO document_outbox(id,candidate_id,fingerprint,document_type,event_date,payload) VALUES (?,?,?,?,?,?)',[requestId,candidateId,'fair-'+n,'cv','2026-11-06',JSON.stringify({event:'Document stored',document_type:'cv',upload_fingerprint:'fair-'+n,note:'Recovery fixture'})]);}
 const original=globalThis.fetch,checked=new Set();globalThis.fetch=async(url,options)=>{const p=JSON.parse(options.body);if(p.action==='receipt'){checked.add(p.id);return Response.json({ok:true,uploaded:false});}if(p.action==='backup')return Response.json({ok:true,saved:true,last:p.last});throw Error('Unexpected operation');};
 try{for(let run=0;run<3;run++){let task;await worker.scheduled({}, {DB,DRIVE_WEB_APP_URL:'https://script.google.com/macros/s/test_deployment/exec',DRIVE_WEB_APP_SECRET:'test-only-connection-key-with-32-characters'},{waitUntil:p=>{task=p;}});await task;}for(const requestId of created)assert.ok(checked.has(requestId));}finally{globalThis.fetch=original;}
});

test('complete hiring journey preserves scorecards, checklist gates and original application',async()=>{
 const {project}=await import('../src/model.js');
 const candidate={id:id(),kind:'candidate',subject_id:null,event_date:'2026-11-06',payload:{alias:'QE-JOURNEY',job_id:defaultRoleRecord('2026-11-06').id,source:'Headhunting',stage:'Sourced',action:'Review application',owner:'COO',due:'2026-11-08',commission_plan:'10 / 20 / 30 recurring',commission_ack:'Accepted',terms_detail:'Applicable commission boundaries confirmed in writing'}};
 const expectSaved=async record=>{const response=await saveRecord(record);assert.equal(response.status,201,JSON.stringify(await response.json()));};
 await expectSaved(candidate);
 const stage=(value,extra={})=>linked('stage',{stage:value,note:'Evidence reviewed',action:'Next review',owner:'COO',due:'2026-11-08',...extra},candidate.id);
 for(const value of ['Contacted','Replied'])await expectSaved(stage(value));
 await expectSaved(stage('R1 Scheduled',{r1:'2026-11-08T09:00'}));
 for(const [round,review,next] of [['R1','R1 Review','R2 Prep'],['R2','R2 Review','Reference Check']]){
  if(round==='R2')await expectSaved(stage('R2 Scheduled',{r2:'2026-11-08T10:00'}));
  await expectSaved(linked('score',{round,reviewer:'COO',recommendation:'Advance',score1:'5',score2:'4',score3:'4',score4:'5',note:'Observed evidence recorded'},candidate.id));
  await expectSaved(stage(review));await expectSaved(stage(next));
 }
 await expectSaved(stage('Offer / Agreement'));
 assert.equal((await saveRecord(stage('Hired',{start_date:'2026-11-10'}))).status,400);
 await expectSaved(linked('activity',{event:'Hiring checklist updated',note:'All required evidence checked',terms:'Complete',writing:'Complete',references:'Complete',offer:'Complete',agreement:'Complete',nda:'Complete'},candidate.id));
 assert.equal((await saveRecord(stage('Hired'))).status,400);
 await expectSaved(stage('Hired',{start_date:'2026-11-10'}));
 const history=await(await worker.fetch(request('/api/events?subject='+candidate.id),{DB})).json();
 const current=project(history).candidates[0];
 assert.equal(current.stage,'Hired');assert.equal(current.start_date,'2026-11-10');
 assert.equal(history.filter(e=>e.kind==='score').length,2);
 assert.deepEqual(history[0].payload,candidate.payload);
 const snapshot=await(await worker.fetch(request('/api/bootstrap'),{DB})).json();
 assert.equal(project(snapshot.events).candidates.find(c=>c.id===candidate.id).stage,'Hired');
});

test('paused positions reject new applications and reopening preserves role history',async()=>{
 const job={id:id(),kind:'job',subject_id:null,event_date:'2026-11-06',payload:{title:'QA temporary role',department:'Operations',location:'Remote',status:'Open'}};
 assert.equal((await saveRecord(job)).status,201);
 const update=status=>({id:id(),kind:'job',subject_id:null,event_date:'2026-11-06',payload:{...job.payload,job_id:job.id,status,note:'Role availability updated'}});
 assert.equal((await saveRecord(update('Paused'))).status,201);
 const candidate={id:id(),kind:'candidate',subject_id:null,event_date:'2026-11-06',payload:{alias:'QE-REOPEN',job_id:job.id,source:'Referral',stage:'Sourced',action:'Review',owner:'COO',due:'2026-11-08'}};
 assert.equal((await saveRecord(candidate)).status,400);
 assert.equal((await saveRecord(update('Open'))).status,201);
 assert.equal((await saveRecord(candidate)).status,201);
 assert.equal(sql('SELECT COUNT(*) AS n FROM recruitment_events WHERE id=? OR json_extract(payload,\'$.job_id\')=?',[job.id,job.id])[0].n,4);
});

async function currentEvents(){return sql('SELECT * FROM recruitment_events ORDER BY seq').map(row=>({...row,payload:JSON.parse(row.payload)}));}
async function currentRevision(target){const {project,recordStates}=await import('../src/model.js');const all=await currentEvents(),state=project(all),event=all.find(e=>e.id===target);return Math.max(recordStates(all).get(target)?.revision||event?.seq||0,state.candidates.find(c=>c.id===target)?.revision||0,state.jobs.find(j=>j.id===target)?.revision||0);}
async function control(target,operation,expected){return saveRecord({id:id(),kind:'summary',subject_id:null,event_date:'2026-11-08',expected_seq:expected??await currentRevision(target),payload:{operation,target_id:target,note:'QA record management'}});}
async function crudFixture(code){const job={id:id(),kind:'job',subject_id:null,event_date:'2026-11-08',payload:{title:'QA operations',department:'Operations',location:'Remote',status:'Open'}};assert.equal((await saveRecord(job)).status,201);const c={id:id(),kind:'candidate',subject_id:null,event_date:'2026-11-08',payload:{alias:code,job_id:job.id,source:'Referral',stage:'Sourced',action:'Review',owner:'COO',due:'2026-11-20'}};assert.equal((await saveRecord(c)).status,201);return {job,c};}
async function crudSave(candidate,kind,payload){const event={id:id(),kind,subject_id:candidate,event_date:'2026-11-08',expected_seq:await currentRevision(candidate),payload};const response=await saveRecord(event);assert.equal(response.status,201,JSON.stringify(await response.json()));return event;}
test('candidate and position delete/restore preserve originals and reject stale writes',async()=>{
 const {project}=await import('../src/model.js');const {job,c}=await crudFixture('QA-TRASH-LIFECYCLE');
 const old=await currentRevision(c.id);
 await crudSave(c.id,'activity',{event:'Follow-up sent',note:'New evidence'});
 assert.equal((await control(c.id,'delete',old)).status,409);
 assert.equal((await control(c.id,'delete')).status,201);
 assert.equal(project(await currentEvents()).candidates.find(x=>x.id===c.id).deleted,true);
 assert.equal((await saveRecord({...linked('activity',{event:'Follow-up sent',note:'Blocked'},c.id),expected_seq:await currentRevision(c.id)})).status,400);
 assert.equal((await control(c.id,'restore')).status,201);
 assert.equal(project(await currentEvents()).candidates.find(x=>x.id===c.id).deleted,false);
 assert.equal((await control(job.id,'delete')).status,201);
 assert.equal(project(await currentEvents()).jobs.find(x=>x.id===job.id).deleted,true);
 const copy={...c,id:id(),payload:{...c.payload,alias:'QA-DELETED-POSITION'}};
 assert.equal((await saveRecord(copy)).status,400);
 assert.equal((await control(job.id,'restore')).status,201);
 assert.equal((await saveRecord(copy)).status,201);
 assert.equal(sql('SELECT COUNT(*) AS n FROM recruitment_events WHERE id=?',[c.id])[0].n,1);
});
test('deleted scorecards, checklists and milestones disappear and restore without losing evidence',async()=>{
 const {project,visibleEvents}=await import('../src/model.js');const {c}=await crudFixture('QA-ENTRY-TRASH');
 const a=await crudSave(c.id,'activity',{event:'Hiring checklist updated',note:'Checked',terms:'Complete',writing:'Complete',references:'Complete',offer:'Complete',agreement:'Complete',nda:'Complete'});
 assert.equal(project(await currentEvents()).candidates.find(x=>x.id===c.id).checklist.terms,'Complete');
 assert.equal((await control(a.id,'delete')).status,201);
 assert.equal(project(await currentEvents()).candidates.find(x=>x.id===c.id).checklist.terms,undefined);
 assert.equal((await control(a.id,'restore')).status,201);
 const score=await crudSave(c.id,'score',{round:'R1',recommendation:'Hold',reviewer:'COO',score1:'3',note:'Evidence'});
 assert.equal((await control(score.id,'delete')).status,201);
 assert.equal(visibleEvents(await currentEvents()).some(e=>e.id===score.id),false);
 assert.equal((await control(score.id,'restore')).status,201);
 assert.equal(visibleEvents(await currentEvents()).some(e=>e.id===score.id),true);
});
test('editing an entry replaces its effective value and summary edits reject stale originals',async()=>{
 const {project,visibleEvents}=await import('../src/model.js');const {c}=await crudFixture('QA-ENTRY-EDIT');
 const first=await crudSave(c.id,'activity',{event:'Candidate details corrected',alias:'QA-ENTRY-EDITED',source:'Other',availability:'Available now',notice:'None',note:'Correct code'});
 await crudSave(c.id,'activity',{...first.payload,alias:'QA-ENTRY-EDITED-AGAIN',supersedes:first.id});
 assert.equal(project(await currentEvents()).candidates.find(x=>x.id===c.id).alias,'QA-ENTRY-EDITED-AGAIN');
 assert.equal(visibleEvents(await currentEvents()).some(e=>e.id===first.id),false);
 const summary={id:id(),kind:'summary',subject_id:null,event_date:'2026-11-08',payload:{progress:'Reviewed',priorities:'Follow up'}};
 assert.equal((await saveRecord(summary)).status,201);
 const edit={id:id(),kind:'summary',subject_id:null,event_date:'2026-11-08',expected_seq:await currentRevision(summary.id),payload:{progress:'Corrected progress',priorities:'New priorities',supersedes:summary.id}};
 assert.equal((await saveRecord(edit)).status,201);
 assert.equal((await saveRecord({...edit,id:id()})).status,409);
 assert.equal((await control(edit.id,'delete')).status,201);
 assert.equal((await control(edit.id,'restore')).status,201);
});
test('interview cancellation frees the slot and restore cannot introduce an overlap',async()=>{
 const {project}=await import('../src/model.js');const {c:a}=await crudFixture('QA-BOOK-A'),{c:b}=await crudFixture('QA-BOOK-B');
 const booking={stage:'R1 Scheduled',r1:'2026-12-01T10:00',action:'Interview',due:'2026-12-01',owner:'COO',note:'Book interview'};
 const original=await crudSave(a.id,'stage',booking);
 await crudSave(a.id,'stage',{...booking,stage:'Replied',r1:'',note:'Cancel interview'});
 await crudSave(b.id,'stage',booking);
 assert.equal((await control(a.id,'delete')).status,201);
 assert.equal((await control(a.id,'restore')).status,201);
 const candidate=project(await currentEvents()).candidates.find(x=>x.id===a.id);
 const cancel=candidate.history.findLast(e=>e.kind==='stage');
 assert.equal((await control(cancel.id,'delete')).status,409);
 assert.equal((await control(original.id,'delete')).status,201);
});
test('meeting settings validate Zoom and SL time, reject stale writes, cancel/reschedule and send once',async()=>{
 const cid='baaaaaaa-1111-4111-8111-111111111111',jid=defaultRoleRecord.id;
 const future=new Date(Date.now()+86400000).toISOString().slice(0,16),reminder=new Date(Date.now()+3600000).toISOString().slice(0,16);
 sql("INSERT INTO recruitment_events(id,kind,event_date,payload) VALUES (?,'candidate','2026-11-08',?)",[cid,JSON.stringify({alias:'REMINDER-TEST',job_id:jid,stage:'R1 Scheduled',r1:future})]);
 const save=p=>worker.fetch(request('/api/interviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({candidate_id:cid,round:'R1',slot:future,zoom:'https://zoom.us/j/123456789',enabled:true,remind_at:reminder,version:'',...p})}),{DB});
 sql("INSERT INTO recruitment_events(id,kind,subject_id,event_date,payload) VALUES (?,'stage',?,'2026-11-08',?)",['baaaaaaa-1111-4111-8111-111111111119',cid,JSON.stringify({stage:'R1 Scheduled',r1:future})]);
 // ISO wall clock is interpreted as Sri Lanka; choose at least 7 hours ahead.
 const sendAt=new Date(Date.now()+7*3600000).toISOString().slice(0,16);
 assert.equal((await save({zoom:'https://zoom.us.evil.test/j/123',remind_at:sendAt})).status,400);
 assert.equal((await save({remind_at:future})).status,400);
 let result=await save({remind_at:sendAt});assert.equal(result.status,200);const m=await result.json();
 assert.equal((await save({remind_at:sendAt})).status,409);
 assert.equal((await save({remind_at:sendAt,version:m.version})).status,200);
 const env={DB,DRIVE_WEB_APP_URL:'https://script.google.com/macros/s/test/exec',DRIVE_WEB_APP_SECRET:'test-only-secret-with-at-least-32-characters'};
 const originalFetch=globalThis.fetch;let mails=0;globalThis.fetch=async(url,o)=>{const p=JSON.parse(o.body);if(p.action==='health')return Response.json({ok:true,email_ready:true});assert.equal(p.action,'interview-email');mails++;return Response.json({ok:true,sent:true});};
 async function cron(){const work=[];await worker.scheduled({scheduledTime:Date.UTC(2026,10,8,0,1)},env,{waitUntil:p=>work.push(p)});await Promise.all(work);}
 try{
  const key='interview:'+cid,load=()=>JSON.parse(sql('SELECT value FROM maintenance_state WHERE key=?',[key])[0].value),put=v=>sql('UPDATE maintenance_state SET value=? WHERE key=?',[JSON.stringify(v),key]);
  put({...m,remind_at:'2026-01-01T00:00'});await cron();assert.equal(load().status,'sent');await cron();assert.equal(mails,1);
  put({...m,status:'pending',slot:'2026-01-01T01:00',remind_at:'2026-01-01T00:00'});await cron();assert.equal(load().status,'cancelled');assert.equal(mails,1);
  sql("INSERT INTO recruitment_events(id,kind,subject_id,event_date,payload) VALUES (?,'stage',?,'2026-11-08',?)",['baaaaaaa-1111-4111-8111-111111111112',cid,JSON.stringify({stage:'Replied'})]);put({...m,remind_at:'2026-01-01T00:00'});await cron();assert.equal(load().status,'cancelled');assert.equal(mails,1);
 }finally{globalThis.fetch=originalFetch;}
});
