import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
test('responsive enhancements keep table actions, accessible menu, safe JD rendering and candidate-only sharing',async()=>{
 const html='<header class="top"><a class="brand">QuidEdge</a><nav id="nav"><a href="#overview">Overview</a><a href="#role" class="active">Hiring roles</a></nav></header><main id="app"><section class="panel"><h2>Roles</h2><table><tbody><tr><td data-label="Role"><strong>Partner</strong><small>Remote</small></td></tr></tbody></table></section><section class="role-position"><details open><summary>Partner</summary><div class="toolbar"><button data-action="job" data-id="11111111-1111-4111-8111-111111111111">Edit</button></div><div class="role-text"># JD\n**Important**\n- Text &lt;script&gt;alert(1)&lt;/script&gt;</div></details></section></main><dialog id="dialog"><form><div class="section-top"><h2>Form</h2><button data-action="close">Close</button></div><details><summary>Optional terms</summary><input name="terms" required></details></form></dialog>';
 const dom=new JSDOM(html,{url:'https://staff.test/#role',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,d=w.document;const tick=()=>new Promise(resolve=>setTimeout(resolve,70));
 try{
  w.eval(readFileSync(new URL('../src/enhancements.js',import.meta.url),'utf8'));await tick();
  assert.equal(d.querySelector('#workspace-menu').getAttribute('aria-controls'),'nav');d.querySelector('#workspace-menu').click();assert.equal(d.querySelector('#workspace-menu').getAttribute('aria-expanded'),'true');
  d.querySelector('nav').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(d.querySelector('#workspace-menu').getAttribute('aria-expanded'),'false');
  assert.equal(d.querySelectorAll('.cell-content').length,1);assert.match(d.querySelector('td').textContent,/PartnerRemote/);assert.equal(d.querySelectorAll('.role-text script').length,0);assert.equal(d.querySelector('.role-text h3').textContent,'JD');
  d.querySelector('[data-action=share-candidate-jd]').click();await tick();assert.match(d.querySelector('.share-jd-box input').value,/^https:\/\/quidedge-careers\.[^/]+\/jobs\//);assert.equal(d.querySelector('.share-jd-box a').rel,'noopener noreferrer');
  const dialog=d.querySelector('dialog');dialog.setAttribute('open','');await tick();assert.equal(dialog.getAttribute('aria-labelledby'),'dialog-title');assert.ok(d.querySelector('.dialog-heading'));
  const field=d.querySelector('[name=terms]');field.checkValidity();assert.equal(field.closest('details').open,true);assert.equal(field.getAttribute('aria-invalid'),'true');assert.ok(d.querySelector('.field-error'));field.value='Accepted';field.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(field.hasAttribute('aria-invalid'),false);assert.equal(d.querySelector('.field-error'),null);
  await tick();assert.equal(d.querySelectorAll('.cell-content').length,1);assert.equal(d.querySelectorAll('[data-action=share-candidate-jd]').length,1);
 }finally{w.close();}
});
