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
import {stages,closed,milestones,checklistItems,dateSL,project,stageProblem,validDate,privacyProblem} from './model.js';
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
  summary: {required:['progress','priorities'],optional:['blockers']},
  score: {
    required:['round','recommendation','note'],
    optional:['score1','score2','score3','score4','reviewer']
  }
};
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
  if (required.some(key => typeof payload[key] !== 'string' || !payload[key].trim())) {
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
  const rows = await db.prepare(
    "SELECT * FROM recruitment_events WHERE id=? OR (kind='job' AND json_extract(payload,'$.job_id')=?) ORDER BY seq"
  ).bind(id,id).all();
  return project(rows.results.map(toEvent)).jobs[0];
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
    if(url.searchParams.has('subject')){const subject=url.searchParams.get('subject');if(!uuid.test(subject||''))return error('Invalid candidate.');clauses.push('(id=? OR subject_id=?)');args.push(subject,subject);}
    const rows=await db.prepare('SELECT * FROM recruitment_events WHERE '+clauses.join(' AND ')+' ORDER BY seq LIMIT 500').bind(...args).all();
    return json(rows.results.map(toEvent));
  }
  const record = await readRecord(request);
  const problem = validate(record);
  if (problem) return error(problem);
  const {id,kind,subject_id,event_date,payload} = record;
  const previous = await db.prepare('SELECT * FROM recruitment_events WHERE id=?').bind(id).first();
  if (previous) {
    const saved = toEvent(previous);
    return sameRecord(saved,record) ? json(saved,200) : error('This save ID already belongs to another record.',409);
  }
  const conditions = [];
  const parameters = [id,kind,subject_id,event_date,JSON.stringify(payload)];
  if ((subject_id || kind==='job' && payload.job_id) && record.expected_seq===undefined)return error('A current record revision is required. Refresh and retry.',409);
  if (subject_id) {
    const rows = await db.prepare(
      'SELECT * FROM recruitment_events WHERE id=? OR subject_id=? ORDER BY seq'
    ).bind(subject_id,subject_id).all();
    const candidate = project(rows.results.map(toEvent)).candidates[0];
    if (!candidate) return error('Select an existing candidate.');
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
        conditions.push("NOT EXISTS (SELECT 1 FROM recruitment_events e WHERE e.kind='stage' AND e.subject_id<>? AND json_extract(e.payload,'$.stage') IN ('R1 Scheduled','R2 Scheduled') AND e.seq=(SELECT MAX(x.seq) FROM recruitment_events x WHERE x.kind='stage' AND x.subject_id=e.subject_id) AND julianday(CASE json_extract(e.payload,'$.stage') WHEN 'R1 Scheduled' THEN json_extract(e.payload,'$.r1') ELSE json_extract(e.payload,'$.r2') END)<julianday(?,?) AND julianday(CASE json_extract(e.payload,'$.stage') WHEN 'R1 Scheduled' THEN json_extract(e.payload,'$.r1') ELSE json_extract(e.payload,'$.r2') END,CASE json_extract(e.payload,'$.stage') WHEN 'R1 Scheduled' THEN '+30 minutes' ELSE '+60 minutes' END)>julianday(?))");
        parameters.push(subject_id,slot,'+'+duration+' minutes',slot);
      }
    }
    const revision = record.expected_seq ?? candidate.revision;
    conditions.push('COALESCE((SELECT MAX(seq) FROM recruitment_events WHERE id=? OR subject_id=?),0)=?');
    parameters.push(subject_id,subject_id,revision);
  }
  if (kind === 'job' && payload.job_id) {
    const job = await jobHistory(db,payload.job_id);
    if (!job) return error('Select an existing position.');
    const revision = record.expected_seq ?? job.revision;
    conditions.push("COALESCE((SELECT MAX(seq) FROM recruitment_events WHERE id=? OR (kind='job' AND json_extract(payload,'$.job_id')=?)),0)=?");
    parameters.push(job.id,job.id,revision);
  }
  if (kind === 'candidate') {
    const job = await jobHistory(db,payload.job_id);
    if (!job || job.status !== 'Open') return error('Choose an open position.');
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
 const query=`WITH bounded AS (SELECT * FROM recruitment_events WHERE seq<=?)
 SELECT * FROM bounded WHERE kind='candidate' OR kind='job' AND json_extract(payload,'$.job_id') IS NULL
 OR seq IN (SELECT MAX(e.seq) FROM bounded e JOIN json_each(e.payload) j WHERE e.kind='job' GROUP BY COALESCE(json_extract(e.payload,'$.job_id'),e.id),j.key)
 OR seq IN (SELECT MAX(e.seq) FROM bounded e JOIN json_each(e.payload) j WHERE e.kind='stage' GROUP BY e.subject_id,j.key)
 OR seq IN (SELECT MAX(e.seq) FROM bounded e JOIN json_each(e.payload) j WHERE e.kind='activity' AND json_extract(e.payload,'$.event') IN ('Hiring checklist updated','Commission terms reviewed','Candidate details corrected','Document availability checked') GROUP BY e.subject_id,json_extract(e.payload,'$.event'),j.key)
 OR seq IN (SELECT MAX(seq) FROM bounded WHERE kind='activity' AND json_extract(payload,'$.event') IN ('Writing task completed','References completed','Agreement / NDA signed') GROUP BY subject_id,json_extract(payload,'$.event'))
 OR seq IN (SELECT MAX(seq) FROM bounded WHERE kind='activity' AND json_extract(payload,'$.event')='Document stored' GROUP BY subject_id,json_extract(payload,'$.document_type'))
 OR seq IN (SELECT MAX(seq) FROM bounded WHERE subject_id IS NOT NULL GROUP BY subject_id)
 OR event_date=? AND kind='summary' ORDER BY seq`;
 const rows=await db.prepare(query).bind(head.cursor,dateSL()).all();
 return json({events:rows.results.map(toEvent),cursor:head.cursor});
}

export default {
  async scheduled(controller,env,ctx){ctx.waitUntil(maintenance(env));},
  async fetch(request,env) {
    const url = new URL(request.url);
    if (['/api/events','/api/documents','/api/integrations','/api/bootstrap','/api/document-status','/api/maintenance'].includes(url.pathname)) {
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
      let response;
      try {
        if(request.method==='POST'||['/api/integrations','/api/document-status','/api/maintenance'].includes(url.pathname)){const limited=await rateLimit(request,env,url.pathname);if(limited){for(const [key,value] of Object.entries(corsHeaders))limited.headers.set(key,value);return limited;}}
        response = url.pathname==='/api/maintenance' ? await maintenanceStatus(request,env) : url.pathname==='/api/bootstrap' ? (request.method==='GET'?await bootstrap(env):error('Use GET.',405)) : url.pathname==='/api/document-status' ? await documentStatus(request,env,url) : url.pathname === '/api/events' ? await api(request,env,url) : url.pathname === '/api/documents' ? await documentApi(request,env) : request.method === 'GET' ? await driveHealth(env,url.searchParams.get('candidate_id')) : error('Method not allowed.',405);
      } catch {
        response = error('Shared storage is temporarily unavailable. Please retry.',503);
      }
      const result = new Response(response.body,response);
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

