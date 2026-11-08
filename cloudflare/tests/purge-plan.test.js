import test from 'node:test';
import assert from 'node:assert/strict';
import {planPurge} from '../src/purge-plan.js';
const e=(seq,id,kind,payload={},subject_id=null)=>({seq,id,kind,payload,subject_id});
test('permanent removal includes candidate history, versions and Trash controls, preserving other records',()=>{
 const events=[e(1,'job','job'),e(2,'candidate','candidate',{job_id:'job'}),e(3,'stage','stage',{},'candidate'),e(4,'edit','stage',{supersedes:'stage'},'candidate'),e(5,'trash-stage','summary',{operation:'delete',target_id:'stage'}),e(6,'trash-candidate','summary',{operation:'delete',target_id:'candidate'}),e(7,'other','candidate',{job_id:'job'})];
 assert.deepEqual(new Set(planPurge(events,['candidate']).event_ids),new Set(['candidate','stage','edit','trash-stage','trash-candidate']));
 assert.throws(()=>planPurge(events,['other']),/currently in Trash/);assert.throws(()=>planPurge(events,[]),/Choose/);
 events.push(e(8,'trash-job','summary',{operation:'delete',target_id:'job'}));assert.throws(()=>planPurge(events,['job']),/every candidate/);
 events.push(e(9,'trash-other','summary',{operation:'delete',target_id:'other'}));assert.equal(planPurge(events,['job']).candidate_ids.length,2);
});
test('deleting a trashed correction removes its version chain and its restore/delete controls',()=>{
 const events=[e(1,'first','summary'),e(2,'second','summary',{supersedes:'first'}),e(3,'third','summary',{supersedes:'second'}),e(4,'trash','summary',{operation:'delete',target_id:'third'})];
 assert.deepEqual(new Set(planPurge(events,['third']).event_ids),new Set(['first','second','third','trash']));
});
