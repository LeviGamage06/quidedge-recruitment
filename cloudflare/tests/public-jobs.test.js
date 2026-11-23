import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateJob,publicJobResponse} from '../src/public-jobs.js';
import careers,{candidatePage} from '../careers-worker.js';
const id='11111111-1111-4111-8111-111111111111';
const record=(seq,payload,kind='job',eventId=id)=>({seq,id:eventId,kind,payload});
test('candidate job projection exposes only approved role fields and respects closure, deletion and restored revisions',()=>{
 const rows=[record(1,{title:'Partner',status:'Open',description:'JD',note:'PRIVATE NOTE',owner:'STAFF OWNER',target_date:'PRIVATE DATE'})];
 assert.deepEqual(Object.keys(candidateJob(rows,id)).sort(),['id','title','department','location','employment','headcount','description','brief'].sort());
 rows.push(record(2,{job_id:id,title:'Updated',description:'NEW JD'},'job','edit'));
 assert.equal(candidateJob(rows,id).description,'NEW JD');
 rows.push(record(3,{operation:'delete',target_id:'edit'},'summary','delete-edit'));assert.equal(candidateJob(rows,id).description,'JD');
 rows.push(record(4,{job_id:id,status:'Paused'},'job','pause'));assert.equal(candidateJob(rows,id),null);
 rows.push(record(5,{job_id:id,status:'Open'},'job','open'));assert.ok(candidateJob(rows,id));
 rows.push(record(6,{operation:'delete',target_id:id},'summary','delete'));assert.equal(candidateJob(rows,id),null);
 rows.push(record(7,{operation:'restore',target_id:id},'summary','restore'));assert.equal(candidateJob(rows,id).title,'Partner');
});
test('public role endpoint cannot query candidates, accepts only GET/HEAD and rejects invalid IDs before reading storage',async()=>{
 let query='';const DB={prepare(sql){query=sql;return{async all(){return{results:[record(1,{title:'Role',status:'Open',description:'PUBLIC JD',private_name:'PRIVATE NAME'})]}}}}};
 const url='https://staff.test/api/public-job?id='+id;
 const response=await publicJobResponse(new Request(url),{DB});assert.equal(response.status,200);assert.match(query,/kind='job'/);assert.doesNotMatch(query,/candidate|SELECT \*/);assert.doesNotMatch(await response.text(),/PRIVATE NAME/);
 assert.equal((await publicJobResponse(new Request(url,{method:'POST'}),{})).status,405);
 assert.equal((await publicJobResponse(new Request('https://staff.test/api/public-job?id=bad'),{})).status,404);
 assert.equal(await (await publicJobResponse(new Request(url,{method:'HEAD'}),{DB})).text(),'');
});
test('isolated careers origin has no staff routes, scripts, API proxy, forms, staff links or candidate information',async()=>{
 const html=candidatePage({id,title:'Partner <img onerror=alert(1)>',description:'# Job\n**Bold**\n- Work <script>alert(1)</script>',private_name:'PRIVATE CANDIDATE',note:'PRIVATE NOTE'});
 assert.match(html,/&lt;img/);assert.match(html,/<strong>Bold<\/strong>/);assert.doesNotMatch(html,/<script|<img|PRIVATE CANDIDATE|PRIVATE NOTE|recruitment.*workers|href=|<form/);
 for(const path of ['/api/events','/api/bootstrap','/app.js','/pipeline','/api/public-job'])assert.equal((await careers.fetch(new Request('https://careers.test'+path))).status,404);
 assert.equal((await careers.fetch(new Request('https://careers.test/jobs/'+id,{method:'POST'}))).status,405);
 const service={fetch:async()=>Response.json({job:{id,title:'Published',description:'PUBLIC JD',private:'PRIVATE VALUE'}})};
 const response=await careers.fetch(new Request('https://careers.test/jobs/'+id),{RECRUITMENT:service});assert.equal(response.status,200);assert.match(response.headers.get('Content-Security-Policy'),/script-src 'none'; connect-src 'none'/);assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.doesNotMatch(await response.text(),/PRIVATE VALUE/);
 service.fetch=async()=>Response.json({error:'gone'},{status:404});assert.equal((await careers.fetch(new Request('https://careers.test/jobs/'+id),{RECRUITMENT:service})).status,404);

});
