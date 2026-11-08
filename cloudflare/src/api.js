/*
QuidEdge API worker. Bind existing D1 database as DB.
Initial schema below is for a NEW database only.
CREATE TABLE recruitment_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('job','candidate','stage','activity','summary','score')),
  subject_id TEXT REFERENCES recruitment_events(id),
  event_date TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload) AND json_type(payload) = 'object'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((kind IN ('stage','activity','score')) = (subject_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TRIGGER recruitment_events_no_update BEFORE UPDATE ON recruitment_events
BEGIN
  SELECT RAISE(ABORT, 'Recruitment records are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER recruitment_events_no_delete BEFORE DELETE ON recruitment_events
BEGIN
  SELECT RAISE(ABORT, 'Recruitment records are append-only');
END;

CREATE INDEX recruitment_events_subject_seq ON recruitment_events(subject_id, seq);
--> statement-breakpoint
CREATE INDEX recruitment_events_kind_seq ON recruitment_events(kind, seq);

*/
import {planPurge} from './purge-plan.js';
import {stages,closed,milestones,checklistItems,dateSL,project,stageProblem,validDate,privacyProblem,recordStates,visibleEvents,interviewRevision} from './model.js';
import {validateDocumentBytes} from './binary.js';
const eventFields = {
  job: {
    required:['title','department','location'],
    optional:['employment','headcount','target_date','brief','status','job_id','note','profile','description']
  },
  candidate: {
    required:['alias','job_id','source','stage','action','due','owner'],
    optional:['availability','notice','blocker','commission_ack','commission_plan','market','terms_detail']
  },
  stage: {
    required:['stage','note'],
    optional:['action','due','owner','blocker','r1','r2','start_date']
  },
  activity: {
    required:['event','note'],
    optional:['terms','writing','references','offer','agreement','nda','commission_ack','commission_plan','alias','source','availability','notice','market','cv_state','cover_state','terms_detail']
  },
  summary: {required:['progress','priorities'],optional:['blockers','operation','target_id','note']},
  score: {
    required:['round','recommendation','note'],
    optional:['score1','score2','score3','score4','reviewer']
  }
};
for(const fields of Object.values(eventFields))fields.optional.push('supersedes');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const privateText = /[\w.+%-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/|www\./i;
const apiHeaders = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json = (value,status = 200) => Response.json(value,{status,headers:apiHeaders});
const error = (message,status = 400) => json({error:message},status);
const toEvent = row => ({...row,payload:JSON.parse(row.payload)});

function validate(record) {
  if (!record || typeof record !== 'object') return 'Invalid record.';
  const {id,kind,subject_id,event_date,payload,expected_seq} = record;
  if (typeof id !== 'string' || !uuid.test(id) || !Object.hasOwn(eventFields,kind) || !validDate(event_date)) {
    return 'Choose a valid record type and event date.';
  }
  if (expected_seq !== undefined && (!Number.isSafeInteger(expected_seq) || expected_seq < 0)) {
    return 'Refresh this record before updating it.';
  }
  const linked = ['stage','activity','score'].includes(kind);
  if (linked ? typeof subject_id !== 'string' || !uuid.test(subject_id) : subject_id !== null) {
    return 'Select an existing candidate.';
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'Invalid fields.';
  const {required,optional} = eventFields[kind];
  if (payload.operation && (kind!=='summary'||!['delete','restore'].includes(payload.operation)||!uuid.test(payload.target_id||'')||!payload.note?.trim()||payload.supersedes))return 'Choose a record and a deletion or restoration reason.';
  if (!payload.operation && required.some(key => typeof payload[key] !== 'string' || !payload[key].trim())) {
    return 'Complete all required fields.';
  }
  for (const [key,value] of Object.entries(payload)) {
    if ((!required.includes(key) && !optional.includes(key)) || typeof value !== 'string' || value.length > (key==='description'?12000:600)) {
      return 'Invalid field or text longer than 600 characters.';
    }
    if (privacyProblem(value)) return 'Public records must omit names, phone numbers, email addresses and links. Use candidate codes.';
    if (['due','start_date','target_date'].includes(key) && value && !validDate(value)) return 'Choose a valid date.';
    if (['r1','r2'].includes(key) && value) {
      if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || !validDate(value.slice(0,10))) {
        return 'Choose a valid interview date and time.';
      }
    }
    if (key.startsWith('score') && !['','1','2','3','4','5'].includes(value)) return 'Scores must be 1 to 5.';
  }
  if(payload.supersedes && !uuid.test(payload.supersedes))return 'Choose an existing record to edit.';
  if (payload.owner && !['COO','Leadership','Candidate'].includes(payload.owner)) return 'Choose a valid action owner.';
  if (kind === 'job') {
    if (payload.job_id && (!uuid.test(payload.job_id) || !payload.note?.trim())) return 'Add a reason for the position update.';
    if (payload.status && !['Open','Paused','Closed'].includes(payload.status)) return 'Choose a valid position status.';
    if (payload.headcount && !/^[1-9]\d{0,2}$/.test(payload.headcount)) return 'Headcount must be 1 to 999.';
  }
  if (payload.commission_ack && !['Pending','Accepted','Declined'].includes(payload.commission_ack)) return 'Choose a valid commission acknowledgement.';
  if (payload.commission_plan && !['10 / 20 / 30 recurring','Other agreed terms'].includes(payload.commission_plan)) return 'Choose a valid commission plan.';
  if (payload.profile && payload.profile !== 'client-acquisition-v1') return 'Choose a valid role profile.';
  if(payload.source && !['Headhunting','Referral','Inbound','Other'].includes(payload.source))return 'Choose a valid source.';
  if(payload.availability && !['To confirm','Available now','Within 2 weeks','Within 1 month','Later'].includes(payload.availability))return 'Choose a valid availability.';
  if(payload.reviewer && !['COO','Leadership'].includes(payload.reviewer))return 'Choose a valid reviewer role.';
  if (kind === 'candidate') {
    if (payload.stage !== 'Sourced' || !uuid.test(payload.job_id)) return 'Select a position and start at Sourced.';
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(payload.alias)) return 'Use a unique candidate code, such as QE-001 (2 to 40 characters).';
  }
  if (kind === 'activity') {
    if (payload.event==='Candidate details corrected') {
      if(!payload.alias || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(payload.alias) || !payload.source || !payload.availability || !payload.notice)return 'Complete the corrected candidate details.';
    } else if(payload.event==='Document availability checked')return 'Document checks are generated by the private storage service.';
    else if (payload.event === 'Hiring checklist updated') {
      if (checklistItems.some(([key]) => !['Pending','Complete','Waived'].includes(payload[key]))) {
        return 'Set every hiring checklist item.';
      }
    } else if (payload.event === 'Commission terms reviewed' && (!['Pending','Accepted','Declined'].includes(payload.commission_ack) || !payload.commission_plan || !payload.terms_detail?.trim())) return 'Confirm the candidate’s commission acknowledgement.';
    else if (!milestones.includes(payload.event)) return 'Choose a valid milestone.';
  }
  if (kind === 'score') {
    if (!['R1','R2'].includes(payload.round) || !['Advance','Hold','Reject'].includes(payload.recommendation)) {
      return 'Choose a valid scorecard round and recommendation.';
    }
    if (![1,2,3,4].some(i => payload['score' + i])) return 'Score at least one tested criterion.';
  }
  return '';
}
async function readRecord(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let bytes = 0;
  for (;;) {
    const {done,value} = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 65536) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(await new Blob(chunks).text());
  } catch {
    return null;
  }
}
async function jobHistory(db,id) {
  const rows=await db.prepare('SELECT * FROM recruitment_events ORDER BY seq').all();
  return project(rows.results.map(toEvent)).jobs.find(j=>j.id===id);
}
function sameRecord(saved,record) {
  return saved.kind === record.kind && saved.subject_id === record.subject_id &&
    saved.event_date === record.event_date && JSON.stringify(Object.entries(saved.payload).sort(([a],[b])=>a.localeCompare(b))) === JSON.stringify(Object.entries(record.payload).sort(([a],[b])=>a.localeCompare(b)));
}
async function api(request,env,url) {
  if (!['GET','POST'].includes(request.method)) {
    return new Response(null,{status:405,headers:{...apiHeaders,Allow:'GET, POST, OPTIONS'}});
  }
  if (!env.DB) return error('Shared storage is unavailable. Please retry.',503);
  const db = env.DB.withSession('first-primary');
  if (request.method === 'GET') {
    const after = Number(url.searchParams.get('after') || 0);
    if (!Number.isSafeInteger(after) || after < 0) return error('Invalid event cursor.');
    const clauses=['seq > ?'];const args=[after];
    if(url.searchParams.has('date')){const date=url.searchParams.get('date');if(!validDate(date))return error('Invalid report date.');clauses.push('event_date=?');args.push(date);}
    if(url.searchParams.has('subject')){const subject=url.searchParams.get('subject');if(!uuid.test(subject||''))return error('Invalid candidate.');clauses.push("(id=? OR subject_id=? OR kind='summary' AND json_extract(payload,'$.operation') IS NOT NULL)");args.push(subject,subject);}
    const rows=await db.prepare('SELECT * FROM recruitment_events WHERE '+clauses.join(' AND ')+' ORDER BY seq LIMIT 500').bind(...args).all();
    return json(rows.results.map(toEvent));
  }
  const record = await readRecord(request);
  const problem = validate(record);
  if (problem) return error(problem);
  if(await db.prepare('SELECT value FROM maintenance_state WHERE key=?').bind('purged-event:'+await purgeHash(record.id)).first())return error('This record was permanently deleted and cannot be replayed. Create a new record if needed.',410);
  const {id,kind,subject_id,event_date,payload} = record;
  const previous = await db.prepare('SELECT * FROM recruitment_events WHERE id=?').bind(id).first();
  if (previous) {
    const saved = toEvent(previous);
    return sameRecord(saved,record) ? json(saved,200) : error('This save ID already belongs to another record.',409);
  }
  const allRows=await db.prepare('SELECT * FROM recruitment_events ORDER BY seq').all();
  const allEvents=allRows.results.map(toEvent), currentState=project(allEvents), states=recordStates(allEvents);
  const head=allEvents.at(-1)?.seq||0;
  if(payload.operation) {
    const target=allEvents.find(e=>e.id===payload.target_id);
    if(!target || target.payload.operation)return error('Choose an existing record.');
    const targetRevision=Math.max(states.get(target.id)?.revision||target.seq,currentState.candidates.find(c=>c.id===target.id)?.revision||0,currentState.jobs.find(j=>j.id===target.id)?.revision||0);
    if(record.expected_seq!==targetRevision)return error('This record changed. Reopen it before continuing.',409);
    const deleted=Boolean(states.get(target.id)?.deleted);
    if(deleted===(payload.operation==='delete'))return error(deleted?'Record is already in Trash.':'Record is already restored.',409);
    if(payload.operation==='restore') {
      const parent=currentState.candidates.find(c=>c.id===target.subject_id);
      if(parent?.deleted)return error('Restore the candidate before restoring its history.');
    }
  }
  if(payload.operation){
    const proposed=project([...allEvents,{...record,seq:head+1}]).candidates.filter(c=>!c.deleted&&['R1 Scheduled','R2 Scheduled'].includes(c.stage));
    for(let i=0;i<proposed.length;i++)for(let j=i+1;j<proposed.length;j++){
      const interval=c=>{const r=c.stage==='R1 Scheduled'?'r1':'r2',start=+new Date(c[r]+':00+05:30');return [start,start+(r==='r1'?30:60)*60000];};
      const [a,b]=interval(proposed[i]),[c,d]=interval(proposed[j]);
      if(a<d&&c<b)return error('This change would restore an overlapping interview. Reschedule the current booking first.',409);
    }
  }
  if(payload.supersedes) {
    const original=allEvents.find(e=>e.id===payload.supersedes);
    if(!original || original.kind!==kind || original.subject_id!==subject_id || ['candidate','job'].includes(kind) || original.payload.operation || !visibleEvents(allEvents).some(e=>e.id===original.id))return error('This entry cannot be edited. Refresh and try again.',409);
    if(kind==='summary' && record.expected_seq!==(states.get(original.id)?.revision||original.seq))return error('Summary changed. Reopen it.',409);
  }
  const conditions = ['COALESCE((SELECT MAX(seq) FROM recruitment_events),0)=?'];
  const parameters = [id,kind,subject_id,event_date,JSON.stringify(payload),head];
  if ((subject_id || kind==='job' && payload.job_id) && record.expected_seq===undefined)return error('A current record revision is required. Refresh and retry.',409);
  if (subject_id) {
    const candidate = currentState.candidates.find(c=>c.id===subject_id);
    if (!candidate) return error('Select an existing candidate.');
    if(candidate.deleted)return error('Restore this candidate from Trash before updating it.');
    if(record.expected_seq!==candidate.revision)return error('Candidate changed. Reopen it before saving.',409);
    if(kind==='activity' && payload.event==='Candidate details corrected'){
      conditions.push("NOT EXISTS (SELECT 1 FROM recruitment_events e WHERE lower(trim(json_extract(e.payload,'$.alias')))=lower(?) AND (e.kind='candidate' OR e.kind='activity' AND json_extract(e.payload,'$.event')='Candidate details corrected') AND COALESCE(e.subject_id,e.id)<>?)");
      parameters.push(payload.alias,subject_id);
    }
    if (kind === 'stage') {
      const stageError = stageProblem(payload,candidate,event_date);
      if (stageError) return error(stageError);
      if(['R1 Scheduled','R2 Scheduled'].includes(payload.stage)){
        const slot=payload.stage==='R1 Scheduled'?payload.r1:payload.r2;
        const duration=payload.stage==='R1 Scheduled'?30:60;
        const start=+new Date(slot+':00+05:30'),end=start+duration*60000;
        const overlap=currentState.candidates.some(c=>!c.deleted&&c.id!==subject_id&&['R1 Scheduled','R2 Scheduled'].includes(c.stage)&&(()=>{const r=c.stage==='R1 Scheduled'?'r1':'r2',t=+new Date(c[r]+':00+05:30');return t<end&&t+(r==='r1'?30:60)*60000>start;})());
        if(overlap)return error('This interview overlaps another COO booking. Choose another time.',409);
      }
    }

  }
  if (kind === 'job' && payload.job_id) {
    const job = await jobHistory(db,payload.job_id);
    if (!job) return error('Select an existing position.');
    if(job.deleted)return error('Restore the position from Trash before editing.');
    if(record.expected_seq!==job.revision)return error('Position changed. Reopen it before saving.',409);
  }
  if (kind === 'candidate') {
    const job = await jobHistory(db,payload.job_id);
    if (!job || job.deleted || job.status !== 'Open') return error('Choose an open position.');
    if(job.profile==='client-acquisition-v1' && (!['Pending','Accepted','Declined'].includes(payload.commission_ack) || !payload.commission_plan || payload.commission_ack==='Accepted' && !payload.terms_detail?.trim())) return error('Record the commission structure and candidate acknowledgement.');
    conditions.push("NOT EXISTS (SELECT 1 FROM recruitment_events WHERE (kind='candidate' OR kind='activity' AND json_extract(payload,'$.event')='Candidate details corrected') AND lower(trim(json_extract(payload,'$.alias')))=lower(?))");
    parameters.push(payload.alias);
    conditions.push("COALESCE((SELECT json_extract(payload,'$.status') FROM recruitment_events WHERE kind='job' AND (id=? OR json_extract(payload,'$.job_id')=?) ORDER BY seq DESC LIMIT 1),'Open')='Open'");
    parameters.push(job.id,job.id);
  }
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  await db.prepare(
    'INSERT INTO recruitment_events (id,kind,subject_id,event_date,payload) SELECT ?,?,?,?,?' + where + ' ON CONFLICT(id) DO NOTHING'
  ).bind(...parameters).run();
  const row = await db.prepare('SELECT * FROM recruitment_events WHERE id=?').bind(id).first();
  if (!row) {
    return error(kind === 'candidate' ? 'Candidate code already exists, or the position has closed. Refresh and check.' :
      'The record changed or this interview overlaps another COO booking. Refresh and choose an available slot.',409);
  }
  const saved = toEvent(row);
  return sameRecord(saved,record) ? json(saved,201) : error('Save ID conflict. Refresh and retry.',409);
}

async function bootstrap(env){
 if(!env.DB)return error('Shared storage is unavailable.',503);
 const db=env.DB.withSession('first-primary');
 const head=await db.prepare('SELECT COALESCE(MAX(seq),0) AS cursor FROM recruitment_events').first();
 const rows=await db.prepare('SELECT * FROM recruitment_events WHERE seq<=? ORDER BY seq').bind(head.cursor).all();
 return json({events:rows.results.map(toEvent),cursor:head.cursor});
}

export default {
  async scheduled(controller,env,ctx){ctx.waitUntil((async()=>{if(!env.DB)return;if(await purgeActive(env.DB))return runPurge(env);return dispatchInterviewReminders(env);})());if(!controller.scheduledTime||new Date(controller.scheduledTime).getUTCMinutes()%10===0)ctx.waitUntil(maintenance(env));},
  async fetch(request,env) {
    const url = new URL(request.url);
    if (['/api/trash','/api/interviews','/api/events','/api/documents','/api/integrations','/api/bootstrap','/api/document-status','/api/maintenance'].includes(url.pathname)) {
      const origin = request.headers.get('Origin');
      const allowed = origin === 'https://levigamage06.github.io' || origin === 'https://quidedge-hire.pages.dev' || origin === url.origin;
      if (origin && !allowed) return error('This origin is not allowed.',403);
      const corsHeaders = allowed ? {'Access-Control-Allow-Origin':origin,Vary:'Origin'} : {};
      if (request.method === 'OPTIONS') {
        return new Response(null,{status:204,headers:{
          ...apiHeaders,...corsHeaders,'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'
        }});
      }
      let response,readEpoch;
      try {
        if(env.DB&&request.method==='GET'&&['/api/events','/api/bootstrap'].includes(url.pathname))readEpoch=await purgeEpoch(env.DB);
        if(request.method==='POST'||['/api/integrations','/api/document-status','/api/maintenance'].includes(url.pathname)){const limited=await rateLimit(request,env,url.pathname);if(limited){for(const [key,value] of Object.entries(corsHeaders))limited.headers.set(key,value);return limited;}}
        if(request.method==='POST'&&url.pathname!=='/api/trash'&&await purgeActive(env.DB))return error('Permanent Trash cleanup is processing. Please wait before saving or restoring records.',423);
        response = url.pathname==='/api/trash' ? await trashApi(request,env,url) : url.pathname==='/api/interviews' ? await interviewApi(request,env,url) : url.pathname==='/api/maintenance' ? await maintenanceStatus(request,env) : url.pathname==='/api/bootstrap' ? (request.method==='GET'?await bootstrap(env):error('Use GET.',405)) : url.pathname==='/api/document-status' ? await documentStatus(request,env,url) : url.pathname === '/api/events' ? await api(request,env,url) : url.pathname === '/api/documents' ? await documentApi(request,env) : request.method === 'GET' ? await driveHealth(env,url.searchParams.get('candidate_id')) : error('Method not allowed.',405);
      } catch {
        response = error('Shared storage is temporarily unavailable. Please retry.',503);
      }
      const result = new Response(response.body,response);
      if(response.ok&&readEpoch!==undefined){try{const epoch=await purgeEpoch(env.DB);if(epoch!==readEpoch)return error('Permanent cleanup changed the workspace. Retry sync to load the clean records.',503);result.headers.set('X-Purge-Epoch',epoch);result.headers.set('Access-Control-Expose-Headers','X-Purge-Epoch');}catch{return error('Shared storage is temporarily unavailable. Retry sync.',503);}}
      for (const [key,value] of Object.entries(corsHeaders)) result.headers.set(key,value);
      return result;
    }
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!Object.hasOwn(ASSETS,path)) return new Response('Not found',{status:404});
    if (!['GET','HEAD'].includes(request.method)) return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
    const asset = ASSETS[path];
    const cache = 'no-cache';
    return new Response(request.method === 'HEAD' ? null : asset.body,{
      headers:{'Content-Type':asset.type,'Cache-Control':cache,'X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex'}
    });
  }
};

