// Local CPU benchmark with synthetic records only; never connects to a database.
import {project} from '../src/model.js';
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
const events=[{seq:1,id:'job',kind:'job',payload:{title:'Synthetic role'}}];
for(let i=0;i<1000;i++){const id='candidate-'+i;events.push({seq:events.length+1,id,kind:'candidate',payload:{alias:'QA-'+i,job_id:'job',stage:'Sourced'}});for(let k=0;k<9;k++)events.push({seq:events.length+1,id:'event-'+i+'-'+k,kind:'activity',subject_id:id,payload:{event:'Follow-up sent',note:'Synthetic evidence'}});}
const samples=[];for(let i=0;i<7;i++){const start=performance.now();const p=project(events);if(p.candidates.length!==1000)throw Error('Projection count mismatch');samples.push(+(performance.now()-start).toFixed(2));}
const result={scope:'Local JavaScript projection; not live Worker/D1 latency',events:events.length,candidates:1000,baseline_median_ms:2.81,samples_ms:samples,median_ms:[...samples].sort((a,b)=>a-b)[3],local_target_ms:50,correct_record_count:true};
result.meets_local_target=result.median_ms<=result.local_target_ms;writeFileSync(new URL('../../docs/audit/performance.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
