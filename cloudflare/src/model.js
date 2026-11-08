export const stages = ['Sourced','Contacted','Replied','R1 Scheduled','R1 Review','R2 Prep','R2 Scheduled','R2 Review','Reference Check','Offer / Agreement','On Hold','Hired','Rejected','Withdrawn'];
export const closed = ['Hired','Rejected','Withdrawn'];
export const milestones = ['First outreach','Reply received','Follow-up sent','R1 completed','R2 brief sent','R2 completed','Writing task completed','References completed','Offer sent','Agreement / NDA signed','Interview no-show','Interview cancelled','Offer declined','Blocker update','Commission terms reviewed','Candidate details corrected','Document availability checked'];
export const checklistItems = [
  ['terms','Role and payment terms confirmed'],
  ['writing','Writing / practical task reviewed'],
  ['references','References checked'],
  ['offer','Offer accepted'],
  ['agreement','Agreement completed'],
  ['nda','NDA completed']
];
export const dateSL = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'
}).format(date);
export const groupStages = [
  ['Sourced',['Sourced','Contacted','Replied'],'amber'],
  ['Screening',['R1 Scheduled','R1 Review'],'blue'],
  ['Technical',['R2 Prep','R2 Scheduled','R2 Review','Reference Check'],'coral'],
  ['Offer',['Offer / Agreement'],'purple'],
  ['Hired',['Hired'],'green']
];
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0,10) === value;
}
export function stageProblem(payload, candidate, eventDate) {
  if (candidate.job_id==='e2173dde-bc77-409a-96a1-86dcb23841f0' && ['R1 Scheduled','R1 Review','R2 Prep','R2 Scheduled','R2 Review','Reference Check','Offer / Agreement','Hired'].includes(payload.stage) && (candidate.commission_ack!=='Accepted'||!candidate.terms_detail?.trim())) return 'Confirm accepted commission-only terms before advancing this candidate.';
  if (!stages.includes(payload.stage)) return 'Choose a valid stage.';
  if (!String(payload.note || '').trim()) return 'Add the reason for this update.';
  if (!closed.includes(payload.stage)) {
    if (![payload.action,payload.due,payload.owner].every(v=>typeof v==='string' && v.trim())) return 'Set the next action, owner and due date.';
  }
  const slot = payload.stage === 'R1 Scheduled' ? payload.r1 : payload.stage === 'R2 Scheduled' ? payload.r2 : '';
  if (['R1 Scheduled','R2 Scheduled'].includes(payload.stage)) {
    if (!slot) return 'Set the interview date and time in Sri Lanka time.';
    if (slot.slice(0,10) < eventDate) return 'The interview cannot be earlier than the event date.';
  }
  if (payload.stage === 'Hired') {
    const missing = checklistItems.filter(([key]) => !['Complete','Waived'].includes(candidate.checklist[key]));
    if (missing.length) return 'Complete or waive each hiring checklist item before marking Hired.';
    if (!validDate(payload.start_date)) return 'Confirm the start date before marking Hired.';
  }
  return '';
}
export function recordStates(events) {
  const states=new Map();
  for(const event of [...events].sort((a,b)=>a.seq-b.seq)) {
    if(event.kind==='summary' && event.payload.operation && event.payload.target_id)
      states.set(event.payload.target_id,{deleted:event.payload.operation==='delete',revision:event.seq});
  }
  return states;
}
export function visibleEvents(events) {
  const states=recordStates(events);
  const replaced=new Set(events.filter(e=>e.payload.supersedes).map(e=>e.payload.supersedes));
  return events.filter(e=>!e.payload.operation && !states.get(e.id)?.deleted && !replaced.has(e.id));
}
export function project(events) {
  const states=recordStates(events);
  const visible=new Set(visibleEvents(events).map(e=>e.id));
  const jobs = new Map();
  const candidates = new Map();
  for (const event of [...events].sort((a,b) => a.seq - b.seq)) {
    const p = event.payload;
    if(p.operation)continue;
    if(!visible.has(event.id) && !(event.kind==='candidate'||event.kind==='job'&&!p.job_id))continue;
    if(p.supersedes && !visible.has(event.id))continue;
    if (event.kind === 'job') {
      if (p.job_id) {
        const job = jobs.get(p.job_id);
        if (job) Object.assign(job,p,{id:p.job_id,revision:event.seq});
      } else {
        jobs.set(event.id,{status:'Open',headcount:'1',...p,id:event.id,revision:event.seq});
      }
    }
    if (event.kind === 'candidate') {
      candidates.set(event.id, {
        ...p,id:event.id,date:event.event_date,revision:event.seq,
        history:[event],r1:'',r2:'',checklist:{},documents:{cv:'Missing',cover:'Missing'},start_date:''
      });
    }
    const candidate = candidates.get(event.subject_id);
    if (!candidate) continue;
    candidate.history.push(event);
    candidate.revision = event.seq;
    if (event.kind === 'stage') {
      for (const key of ['stage','action','due','owner','blocker','r1','r2','start_date']) {
        if (key in p) candidate[key] = p[key];
      }
    }
    if (event.kind === 'activity') {
      if(p.event==='Candidate details corrected')for(const key of ['alias','source','availability','notice','market'])if(key in p)candidate[key]=p[key];
      if(p.event==='Document availability checked'){candidate.documents_checked_at=event.created_at;for(const type of ['cv','cover'])if(p[type+'_state'])candidate.documents[type]=p[type+'_state'];}
      if (p.event === 'Document stored' && ['cv','cover'].includes(p.document_type)) candidate.documents[p.document_type] = 'Receipt saved';
      if (p.event === 'Commission terms reviewed') { candidate.commission_ack=p.commission_ack; candidate.commission_plan=p.commission_plan;candidate.terms_detail=p.terms_detail||''; }
      if (p.event === 'Hiring checklist updated') {
        for (const [key] of checklistItems) {
          if (key in p) candidate.checklist[key] = p[key];
        }
      }
      const completed = {
        'Writing task completed':['writing'],
        'References completed':['references'],
        'Agreement / NDA signed':['agreement','nda']
      }[p.event] || [];
      for (const key of completed) candidate.checklist[key] = 'Complete';
    }
  }
  for(const job of jobs.values())job.deleted=Boolean(states.get(job.id)?.deleted);
  for(const candidate of candidates.values())candidate.deleted=Boolean(states.get(candidate.id)?.deleted);
  for(const event of events) {
    const revision=states.get(event.id)?.revision;
    if(!revision)continue;
    const candidate=candidates.get(event.subject_id||event.id);
    const job=jobs.get(event.payload.job_id||event.id);
    if(candidate)candidate.revision=Math.max(candidate.revision,revision);
    if(job)job.revision=Math.max(job.revision,revision);
  }
  return {jobs:[...jobs.values()].reverse(),candidates:[...candidates.values()].reverse()};
}
export function attention(candidate, today = dateSL()) {
  if (closed.includes(candidate.stage)) return 'Closed';
  if (candidate.due && candidate.due < today) return 'Overdue';
  if (candidate.blocker || candidate.owner === 'Leadership') return 'Needs decision';
  if (!candidate.action || !candidate.due || !candidate.owner) return 'Missing next step';
  return candidate.due === today ? 'Due today' : 'On track';
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"','""') + '"';
}

export function newId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes,value => value.toString(16).padStart(2,'0')).join('');
  return hex.slice(0,8) + '-' + hex.slice(8,12) + '-' + hex.slice(12,16) + '-' +
    hex.slice(16,20) + '-' + hex.slice(20);
}

export const roleScorecards={
 acquisition:{R1:['Acquisition evidence','Client communication','Commercial judgment','Confidentiality & terms'],R2:['Prospect research','Discovery & proposals','Objection handling','Client relations & follow-up']},
 social:{R1:['Campaign ownership & results','English & client communication','AI judgment','Confidentiality'],R2:['Brand audit evidence','Creative strategy','Client role-play','Team responsibility']}
};
export function scorecardFor(job){return roleScorecards[job?.profile==='client-acquisition-v1'?'acquisition':'social'];}
export function privacyProblem(value){
 return /[\w.+%-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/|www\./i.test(value)||/(?:\+\d[\d() .-]{7,}\d)|(?:\b0\d{9}\b)|(?:\b\d{3}[- .]\d{3}[- .]\d{4}\b)|(?:\b(?:phone|mobile|tel|contact|whatsapp)\s*:?\s*\d[\d() .-]{6,}\d)/i.test(value);
}

// Include recoverable changes to bookings so restoring a record never revives an old email.
export function interviewRevision(events,candidate){
 const stages=new Set(events.filter(e=>e.kind==='stage'&&e.subject_id===candidate.id).map(e=>e.id));
 return events.reduce((seq,e)=>stages.has(e.id)||e.kind==='summary'&&['delete','restore'].includes(e.payload.operation)&&(e.payload.target_id===candidate.id||stages.has(e.payload.target_id))?Math.max(seq,e.seq):seq,0);
}
