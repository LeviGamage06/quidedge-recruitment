// Only candidate-facing role fields may cross into the isolated careers site.
export function candidateJob(events,id){
  const states=new Map();
  for(const event of events)if(event.kind==='summary'&&event.payload?.operation)states.set(event.payload.target_id,event.payload.operation==='delete');
  const replaced=new Set(events.filter(e=>e.payload?.supersedes).map(e=>e.payload.supersedes));
  let job=null;
  for(const event of events){
    if(event.kind!=='job'||event.payload?.operation)continue;
    const p=event.payload;
    if(!p.job_id&&event.id===id)job={...p,id};
    else if(job&&p.job_id===id&&!states.get(event.id)&&!replaced.has(event.id))Object.assign(job,p);
  }
  if(!job||states.get(id)||job.status!=='Open')return null;
  return Object.fromEntries(['id','title','department','location','employment','headcount','description','brief'].map(key=>[key,String(job[key]??'').slice(0,key==='description'?12000:key==='brief'?600:240)]));
}
export async function publicJobResponse(request,env){
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{...headers,Allow:'GET, HEAD'}});
  const id=new URL(request.url).searchParams.get('id');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||''))return Response.json({error:'Job unavailable.'},{status:404,headers});
  if(!env.DB)return Response.json({error:'Job temporarily unavailable.'},{status:503,headers});
  try{
    const db=typeof env.DB.withSession==='function'?env.DB.withSession('first-primary'):env.DB;
    const rows=await db.prepare("SELECT seq,id,kind,payload FROM recruitment_events WHERE kind='job' OR (kind='summary' AND json_extract(payload,'$.operation') IS NOT NULL) ORDER BY seq").all();
    const events=rows.results.map(event=>({...event,payload:typeof event.payload==='string'?JSON.parse(event.payload):event.payload}));
    const job=candidateJob(events,id);
    return new Response(request.method==='HEAD'?null:JSON.stringify(job?{job}:{error:'Job unavailable.'}),{status:job?200:404,headers});
  }catch{return Response.json({error:'Job temporarily unavailable.'},{status:503,headers});}
}
