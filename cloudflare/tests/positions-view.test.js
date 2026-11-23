import {JSDOM} from 'jsdom';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const enhancements=fs.readFileSync(new URL('../src/enhancements.js',import.meta.url),'utf8');
const positionsRows=()=>`
  <table class="positions-table"><thead><tr><th>Role</th><th>Action</th></tr></thead><tbody>
    <tr><td>Partnership Manager</td><td><div class="row-actions">
      <a href="#role/job-1">View job description</a>
      <button type="button" data-action="job" data-id="job-1">Manage</button>
    </div></td></tr>
    <tr><td>Video Editor</td><td><div class="row-actions">
      <a href="#role/job-2">View job description</a>
      <button type="button" data-action="job" data-id="job-2">Manage</button>
    </div></td></tr>
  </tbody></table>`;

test('Positions retain one job-description link each after enhancement and DOM updates',async()=>{
  const dom=new JSDOM(`<!doctype html><html><head><title>QuidEdge</title></head><body>
    <header class="top"><nav id="nav"><a class="active" href="#overview">Overview</a></nav></header>
    <main><div id="app">${positionsRows()}</div></main><dialog id="dialog"></dialog>
  </body></html>`,{url:'https://example.test/#overview',runScripts:'outside-only',pretendToBeVisual:true});
  const {window}=dom;
  const {document}=window;
  const tick=()=>new Promise(resolve=>setTimeout(resolve,100));
  const check=()=>{
    const links=[...document.querySelectorAll('.positions-table a[href^="#role/"]')];
    assert.equal(links.length,2,'one link for each position');
    assert.deepEqual(links.map(link=>link.getAttribute('href')),['#role/job-1','#role/job-2']);
    assert.equal(document.querySelectorAll('[data-action="open-role-details"]').length,0);
    for(const row of document.querySelectorAll('#app tbody tr')){
      assert.equal(row.querySelectorAll('a[href^="#role/"]').length,1);
    }
  };
  try{
    window.eval(enhancements);
    await tick();
    check();
    document.querySelector('#app tbody tr').append(document.createElement('span'));
    await tick();
    check();
    document.querySelector('#app').innerHTML=positionsRows();
    await tick();
    check();
  }finally{
    window.close();
  }
});
