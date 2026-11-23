// Independent candidate-facing Worker. No database binding or staff routes.
const UPSTREAM='https://quidedge-recruitment.inquiries-quidedge-au.workers.dev/api/public-job';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inline=value=>escape(value).replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>');
function markdown(value){
 let out='',paragraph=[],type='',items=[];
 const para=()=>{if(paragraph.length){out+='<p>'+paragraph.map(inline).join('<br>')+'</p>';paragraph=[];}};
 const list=()=>{if(type){out+='<'+type+'>'+items.map(x=>'<li>'+inline(x)+'</li>').join('')+'</'+type+'>';items=[];type='';}};
 for(const line of String(value||'').split(/\r?\n/)){
  const h=line.match(/^#{1,6}\s+(.+)$/),b=line.match(/^\s*[-*]\s+(.+)$/),n=line.match(/^\s*\d+[.)]\s+(.+)$/);
  if(h){para();list();out+='<h3>'+inline(h[1])+'</h3>';}
  else if(b||n){para();const next=b?'ul':'ol';if(type&&type!==next)list();type=next;items.push((b||n)[1]);}
  else if(!line.trim()){para();list();}else{list();paragraph.push(line);}
 }para();list();return out;
}
const css=`:root{color-scheme:light;font-family:Inter,Aptos,system-ui,sans-serif;color:#20251f;background:#efefe3}*{box-sizing:border-box}body{margin:0;line-height:1.65}header,main,footer{width:min(960px,100% - 40px);margin:auto}header{padding:30px 0 22px;border-bottom:1px solid #d4d8ca;display:flex;justify-content:space-between;align-items:center;gap:20px}.brand{font-size:30px;letter-spacing:-.06em;font-weight:850}.brand span{color:#a95920}.eyebrow{font-size:.73rem;text-transform:uppercase;letter-spacing:.14em;color:#5c6557;font-weight:700}main{padding:34px 0 40px}h1{font-size:clamp(30px,5vw,48px);line-height:1.12;letter-spacing:-.045em;margin:12px 0 22px;overflow-wrap:anywhere}h2{font-size:24px;letter-spacing:-.035em;line-height:1.3;margin:0 0 20px}h3{font-size:20px;line-height:1.4;letter-spacing:-.02em;margin:28px 0 12px}p{margin:12px 0}li{padding:4px 0}ul,ol{padding-left:24px}article{background:#fafaf4;border:1px solid #e0e3d7;padding:clamp(20px,4vw,36px);border-radius:20px;margin:24px 0}.status{border:1px solid #a3c9a4;background:#deedda;color:#274d2c;padding:7px 13px;border-radius:24px;font-size:.82rem;font-weight:650}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 28px;background:#fafaf4;border:1px solid #dfe2d5;padding:24px;border-radius:18px;margin:24px 0}dl div{min-width:0}dt{font-size:.78rem;color:#5b6455;font-weight:650}dd{margin:4px 0 0;font-weight:600;overflow-wrap:anywhere}.intro{color:#5b6455;max-width:65ch}.content{overflow-wrap:anywhere}.next{background:#f8e3bb;border:1px solid #e2c99b;padding:22px 26px;border-radius:18px}.next h2{margin-bottom:8px}footer{border-top:1px solid #d4d8ca;color:#5b6455;font-size:.8rem;padding:22px 0 32px}.badge{font-size:.78rem;color:#5b6455}a{color:inherit}a:focus-visible{outline:3px solid #81400b;outline-offset:4px}@media(max-width:520px){header,main,footer{width:calc(100% - 32px)}header{padding-top:20px}.brand{font-size:27px}.badge{max-width:135px;text-align:right}main{padding-top:26px}h1{font-size:32px}dl{grid-template-columns:1fr;padding:20px;gap:14px}article{padding:20px;border-radius:16px}.next{padding:20px}h3{font-size:19px}}@media print{body{background:white}header,main,footer{width:100%}article,dl{border:0;padding:0}.status{border:1px solid #555}h2,h3{break-after:avoid}li{break-inside:avoid}}`;
function page(title,body){return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#efefe3"><meta name="robots" content="noindex,nofollow"><title>'+escape(title)+' | QuidEdge Careers</title><meta property="og:title" content="'+escape(title)+'"><meta property="og:description" content="Explore this opportunity at QuidEdge, an Australian creative growth and branding agency."><meta property="og:type" content="website"><style>'+css+'</style></head><body><header><div class="brand">quidedge<span>.</span></div><div class="badge">Careers · International opportunities</div></header><main>'+body+'</main><footer>QuidEdge · Australian creative growth & branding agency<br>This page contains job information only.</footer></body></html>';}
export function candidatePage(job){
 const fields=[['Location',job.location],['Engagement',job.employment],['Department',job.department],['Open positions',job.headcount]];
 return page(job.title,'<div class="eyebrow">Build your next chapter</div><h1>'+escape(job.title)+'</h1><span class="status">Open opportunity</span><p class="intro">Explore the role, what you’ll do, and what QuidEdge is looking for.</p><dl>'+fields.filter(([,value])=>value).map(([label,value])=>'<div><dt>'+escape(label)+'</dt><dd>'+escape(value)+'</dd></div>').join('')+'</dl>'+(job.brief?'<article class="content"><h2>Role requirements</h2>'+markdown(job.brief)+'</article>':'')+'<article class="content"><h2>About this opportunity</h2>'+markdown(job.description||job.brief||'Please contact the person who shared this role for the full job description.')+'</article><section class="next"><h2>Interested in this opportunity?</h2><p>Contact the person who shared this job link with you to discuss the role and next steps.</p></section>');
}
const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
export default {
 async fetch(request,env={}){
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{...headers,Allow:'GET, HEAD'}});
  const path=new URL(request.url).pathname;
  const match=path.match(/^\/jobs\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/?$/i);
  const response=(body,status=200)=>new Response(request.method==='HEAD'?null:body,{status,headers});
  if(path==='/')return response(page('Careers','<div class="eyebrow">QuidEdge careers</div><h1>Great work starts with meaningful connections.</h1><p>Open the job link shared with you to explore a specific opportunity.</p>'));
  if(!match)return response(page('Page unavailable','<h1>Page unavailable</h1><p>Check the job link you received and try again.</p>'),404);
  try{
   if(!env.RECRUITMENT)throw Error("Unavailable");
   const upstream=await env.RECRUITMENT.fetch(UPSTREAM+'?id='+encodeURIComponent(match[1]),{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)});
   if(upstream.status===404)return response(page('Opportunity unavailable','<h1>This opportunity is no longer available.</h1><p>Contact the person who shared this link for the latest opportunities.</p>'),404);
   if(!upstream.ok)throw Error('Unavailable');
   const data=await upstream.json();if(data.job?.id!==match[1]||typeof data.job?.title!=='string')throw Error('Invalid job');
   const job=Object.fromEntries(['id','title','department','location','employment','headcount','brief','description'].map(key=>[key,String(data.job[key]??'').slice(0,key==='description'?12000:key==='brief'?600:240)]));
   return response(candidatePage(job));
  }catch{return response(page('Temporarily unavailable','<h1>Please try again shortly.</h1><p>This job description could not be loaded. Refresh this page or contact the person who shared the link.</p>'),503);}
 }
};
