// Meeting settings are operational metadata, outside the append-only public audit feed.
const reminderRecipient='prasad.quidedge@gmail.com';
function bookingSeq(c){return c.history.filter(e=>e.kind==='stage').at(-1)?.seq||0;}
function meetingSlot(c){const round=c?.stage==='R1 Scheduled'?'R1':c?.stage==='R2 Scheduled'?'R2':'';return round&&c[round.toLowerCase()]?{round,slot:c[round.toLowerCase()]}:null;}
function zoomProblem(value){try{const u=new URL(value);return u.protocol!=='https:'||u.username||u.password||!(u.hostname==='zoom.us'||u.hostname.endsWith('.zoom.us'))||!/^\/(j|my|s)\//.test(u.pathname)||value.length>1500;}catch{return true;}}
async function meetingCandidates(db){const rows=await db.prepare('SELECT * FROM recruitment_events ORDER BY seq').all();return project(rows.results.map(toEvent)).candidates;}
async function interviewApi(request,env,url){
 const db=env.DB.withSession('first-primary');
 if(request.method==='GET'){
  const rows=await db.prepare("SELECT key,value FROM maintenance_state WHERE key LIKE 'interview:%'").all();
  let emailReady=false;try{emailReady=(await bridgeRequest(env,{action:'health',email:true})).email_ready===true;}catch{}
  return json({recipient:reminderRecipient,email_ready:emailReady,meetings:rows.results.map(r=>JSON.parse(r.value))});
 }
 if(request.method!=='POST')return error('Use GET or POST.',405);
 const p=await boundedJson(request,5000);if(!p||!uuid.test(p.candidate_id||'')||typeof p.enabled!=='boolean'||typeof p.zoom!=='string'||typeof p.remind_at!=='string')return error('Invalid interview settings.');
 const c=(await meetingCandidates(db)).find(c=>c.id===p.candidate_id),booking=meetingSlot(c);
 if(!booking||booking.slot!==p.slot||booking.round!==p.round)return error('The booking changed. Refresh and reopen its meeting details.',409);
 if(p.zoom&&zoomProblem(p.zoom))return error('Use a valid HTTPS Zoom meeting link (zoom.us).');
 const at=Date.parse(p.remind_at+':00+05:30'),start=Date.parse(booking.slot+':00+05:30');
 if(p.enabled&&(!p.zoom||!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(p.remind_at)||!Number.isFinite(at)||at<=Date.now()||at>=start))return error('Choose a future reminder time before the interview and add its Zoom link.');
 const key='interview:'+c.id,old=await db.prepare('SELECT value FROM maintenance_state WHERE key=?').bind(key).first();
 const prior=old?JSON.parse(old.value):null;if((prior?.version||'')!==(p.version||''))return error('Meeting details changed in another window. Reopen and retry.',409);
 const same=prior&&prior.slot===p.slot&&prior.round===p.round&&prior.zoom===p.zoom&&prior.remind_at===p.remind_at&&prior.enabled===p.enabled&&prior.booking_seq===bookingSeq(c);
 if(same)return json(prior);
 const value={candidate_id:c.id,...booking,booking_seq:bookingSeq(c),zoom:p.zoom,enabled:p.enabled,remind_at:p.enabled?p.remind_at:'',version:crypto.randomUUID(),status:p.enabled?'pending':'disabled',updated_at:new Date().toISOString()};
 const result=await db.prepare('INSERT INTO maintenance_state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE maintenance_state.value=? RETURNING value').bind(key,JSON.stringify(value),old?.value||'').first();
 if(!result)return error('Meeting details changed. Reopen and retry.',409);
 return json(value);
}
async function dispatchInterviewReminders(env){
 if(!env.DB||!driveConfigured(env))return;
 const db=env.DB.withSession('first-primary'),rows=await db.prepare("SELECT key,value FROM maintenance_state WHERE key LIKE 'interview:%'").all();
 for(const row of rows.results){
  let m;try{m=JSON.parse(row.value);}catch{continue;}
  if(!m.enabled||!['pending','awaiting-activation'].includes(m.status)||Date.parse(m.remind_at+':00+05:30')>Date.now())continue;
  const c=(await meetingCandidates(db)).find(c=>c.id===m.candidate_id),b=meetingSlot(c);
  let status=!b||b.slot!==m.slot||b.round!==m.round||bookingSeq(c)!==m.booking_seq?'cancelled':Date.parse(m.slot+':00+05:30')<=Date.now()?'expired':'';
  if(status){await db.prepare('UPDATE maintenance_state SET value=? WHERE key=? AND value=?').bind(JSON.stringify({...m,status}),row.key,row.value).run();continue;}
  let mailReady=false;try{mailReady=(await bridgeRequest(env,{action:'health',email:true})).email_ready===true;}catch{}
  if(!mailReady){await db.prepare('UPDATE maintenance_state SET value=? WHERE key=? AND value=?').bind(JSON.stringify({...m,status:'awaiting-activation'}),row.key,row.value).run();continue;}
  const claimed={...m,status:'sending'};
  const claim=await db.prepare('UPDATE maintenance_state SET value=? WHERE key=? AND value=? RETURNING key').bind(JSON.stringify(claimed),row.key,row.value).first();if(!claim)continue;
  try{
   const result=await bridgeRequest(env,{action:'interview-email',candidate_id:c.id,id:m.version,alias:c.alias,role:'Client Acquisition & Client Relations Specialist',round:m.round,slot:m.slot,zoom:m.zoom},45000);
   status=result.sent===true?'sent':'needs-review';
  }catch{status='needs-review';}
  await db.prepare('UPDATE maintenance_state SET value=? WHERE key=? AND value=?').bind(JSON.stringify({...claimed,status,processed_at:new Date().toISOString()}),row.key,JSON.stringify(claimed)).run();
 }
}
