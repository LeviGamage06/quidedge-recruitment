import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {validPdf} from './fixtures.js';
const source=readFileSync(new URL('../integrations/GoogleDrive.gs',import.meta.url),'utf8');
function bridge(){
 const items=new Map(),properties=new Map([['DRIVE_WEB_APP_SECRET','test-only-connection-key-with-32-characters']]);let count=0;
 const iterator=values=>{let i=0;return {hasNext:()=>i<values.length,next:()=>values[i++]};};
 class Item{
  constructor(name,parent,blob){this.name=name;this.id='item'+count++;this.parent=parent;this.blob=blob;this.children=[];this.files=[];this.access='PRIVATE';this.description=null;this.trashed=false;items.set(this.id,this);}
  getId(){return this.id;}getName(){return this.name;}setName(n){this.name=n;return this;}isTrashed(){return this.trashed;}getParents(){return iterator(this.parent?[this.parent]:[]);}
  getSharingAccess(){return this.access;}getDescription(){return this.description;}setDescription(d){this.description=d;return this;}
  createFolder(n){const item=new Item(n,this);this.children.push(item);return item;}
  getFolders(){return iterator(this.children.filter(i=>!i.trashed));}getFoldersByName(n){return iterator(this.children.filter(i=>i.name===n&&!i.trashed));}
  getFiles(){return iterator(this.files.filter(i=>!i.trashed));}getFilesByName(n){return iterator(this.files.filter(i=>i.name===n&&!i.trashed));}
  createFile(blob){const item=new Item(blob.name,this,blob);this.files.push(item);return item;}getBlob(){return this.blob;}
 }
 const blob=(value,mime,name)=>{const bytes=typeof value==='string'?[...Buffer.from(value)]:value;return {name,mime,bytes,getBytes:()=>bytes,getDataAsString:()=>Buffer.from(bytes).toString()};};
 const root=new Item('root');items.set('1n2x6MZ8wqBCPe2bQcU4Z0XQDCV8121Mj',root);
 const context=vm.createContext({console,PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v)})},DriveApp:{Access:{ANYONE:'ANYONE',ANYONE_WITH_LINK:'ANYONE_WITH_LINK'},getFolderById:id=>items.get(id),getFileById:id=>items.get(id)},ContentService:{MimeType:{JSON:'json'},createTextOutput:body=>({body,getContent(){return body;},setMimeType(){return this;}})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},Utilities:{base64Decode:s=>[...Buffer.from(s,'base64')],base64Encode:s=>Buffer.from(s).toString('base64'),DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(algo,bytes)=>[...createHash(algo).update(Buffer.from(bytes)).digest()],newBlob:blob}});
 vm.runInContext(source,context);
 const send=extra=>JSON.parse(context.doPost({postData:{contents:JSON.stringify({secret:properties.get('DRIVE_WEB_APP_SECRET'),id:'11111111-1111-4111-8111-111111111111',candidate_id:'d3057f15-9b02-43de-92d0-0cb296ecf63e',alias:'QE-001',name:'Example Applicant',document_type:'cv',extension:'pdf',fingerprint:'opaque-test-fingerprint',data:Buffer.from(validPdf).toString('base64'),...extra})}}).body);
 return {send,root,properties,context};
}
test('private folders preserve original documents and exact retries reuse receipt',()=>{
 const b=bridge();assert.equal(b.send().ok,true);assert.equal(b.send().ok,true);const role=b.root.children[0],folder=role.children[0];assert.equal(folder.files.length,2);
 assert.equal(b.send({id:'11111111-1111-4111-8111-111111111112',document_type:'cover',fingerprint:'cover-proof'}).ok,true);assert.equal(folder.files.length,4);
});
test('health checks root, role and selected candidate privacy and parent ancestry',()=>{
 const b=bridge();assert.equal(b.send({action:'health'}).ready,true);b.send();const role=b.root.children[0],folder=role.children[0];
 role.access='ANYONE_WITH_LINK';assert.equal(b.send({action:'health'}).code,'PUBLIC_FOLDER');role.access='PRIVATE';folder.parent=b.root;assert.equal(b.send({action:'health'}).code,'LOCATION_CHANGED');assert.equal(b.send({document_type:'cover'}).code,'LOCATION_CHANGED');
});
test('name corrections rename the folder while original files and contents remain intact',()=>{
 const b=bridge();b.send();const folder=b.root.children[0].children[0],file=folder.files[0],originalName=file.name;
 assert.equal(b.send({name:'Corrected Applicant'}).ok,true);assert.equal(folder.name,'Corrected Applicant — QE-001');assert.equal(file.name,originalName);assert.equal(folder.files.length,2);
});
test('unauthorized requests cannot create folders and public roots are blocked',()=>{
 const b=bridge();assert.equal(b.send({secret:'wrong'}).code,'UNAUTHORIZED');assert.equal(b.root.children.length,0);b.root.access='ANYONE';assert.equal(b.send().code,'PUBLIC_FOLDER');
});
test('receipts support recovery and availability reflects missing original files',()=>{
 const b=bridge();b.send();assert.equal(b.send({action:'receipt'}).uploaded,true);assert.equal(b.send({action:'status'}).cv,'Available');b.root.children[0].children[0].files[0].trashed=true;assert.equal(b.send({action:'status'}).cv,'Missing');assert.equal(b.send({action:'receipt'}).code,'TRASHED');
});
test('backups are private append-only files and identical retry does not duplicate',()=>{
 const b=bridge();const input={action:'backup',first:1,last:1,records:[{seq:1,id:'example',kind:'job'}]};assert.equal(b.send(input).saved,true);assert.equal(b.send(input).saved,true);assert.equal(b.root.children[0].name,'_System backups');assert.equal(b.root.children[0].files.length,1);
});
test('synthetic owner storage verification uses both document types',()=>{const b=bridge();b.context.runStorageSelfTest();assert.equal(b.root.children[0].children[0].files.length,4);});
test('interview email recipient is fixed and duplicate/ambiguous retries cannot send twice',()=>{
 const b=bridge(),messages=[];b.context.MailApp={getRemainingDailyQuota:()=>10,sendEmail:message=>messages.push(message)};
 const p={action:'interview-email',round:'R1',slot:'2026-11-20T09:00',zoom:'https://us02web.zoom.us/j/123456789',recipient:'attacker@example.com'};
 assert.equal(b.send(p).sent,true);assert.equal(b.send(p).sent,true);assert.equal(messages.length,1);assert.equal(messages[0].to,'prasad.quidedge@gmail.com');assert.match(messages[0].body,/09:00.*Sri Lanka/);
 const bad={...p,id:'11111111-1111-4111-8111-111111111113',zoom:'https://zoom.us.evil.example/j/123'};assert.equal(b.send(bad).ok,false);
 b.context.MailApp.sendEmail=()=>{throw Error('ambiguous network failure')};const unknown={...p,id:'11111111-1111-4111-8111-111111111114'};assert.equal(b.send(unknown).ok,false);assert.equal(b.send(unknown).status,'sending');assert.equal(messages.length,1);
});
