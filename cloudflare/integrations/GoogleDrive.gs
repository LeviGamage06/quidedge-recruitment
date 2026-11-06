/** Owner-run private storage bridge. Keep DRIVE_WEB_APP_SECRET in Script Properties only. */
var ROOT_FOLDER_ID='1n2x6MZ8wqBCPe2bQcU4Z0XQDCV8121Mj';
var ROLE_FOLDER_NAME='Client Acquisition & Client Relations Specialist';
function reply_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function doGet(){return reply_({service:'QuidEdge private document storage',protocol:3});}
function notPublic_(item){if(item.isTrashed())throw Error('TRASHED');var access=item.getSharingAccess();if(access===DriveApp.Access.ANYONE||access===DriveApp.Access.ANYONE_WITH_LINK)throw Error('PUBLIC_FOLDER');}
function parent_(folder,parent){var parents=folder.getParents(),valid=false;while(parents.hasNext())if(parents.next().getId()===parent.getId())valid=true;if(!valid)throw Error('LOCATION_CHANGED');notPublic_(folder);}
function root_(){var folder=DriveApp.getFolderById(ROOT_FOLDER_ID);notPublic_(folder);return folder;}
function role_(root,props,create){var id=props.getProperty('roleFolder'),folder;if(id)folder=DriveApp.getFolderById(id);else{var list=root.getFoldersByName(ROLE_FOLDER_NAME);if(list.hasNext())folder=list.next();else if(create)folder=root.createFolder(ROLE_FOLDER_NAME);if(folder)props.setProperty('roleFolder',folder.getId());}if(folder)parent_(folder,root);return folder;}
function candidate_(role,props,p,create){
 var key='candidate:'+p.candidate_id,id=props.getProperty(key),folder,marker='QE-CANDIDATE:'+p.candidate_id;
 if(id)folder=DriveApp.getFolderById(id);
 else if(role){var folders=role.getFolders();while(folders.hasNext()){var f=folders.next();if(f.getDescription()===marker){folder=f;break;}}
  if(!folder&&create){var name=p.name.trim().replace(/[\/\\]/g,'-')+' — '+p.alias,list=role.getFoldersByName(name);folder=list.hasNext()?list.next():role.createFolder(name);if(folder.getDescription()&&folder.getDescription()!==marker)throw Error('FOLDER_CONFLICT');folder.setDescription(marker);}
  if(folder)props.setProperty(key,folder.getId());
 }
 if(folder){parent_(folder,role);if(folder.getDescription()!==marker)throw Error('FOLDER_CONFLICT');if(create){var label=p.name.trim().replace(/[\/\\]/g,'-')+' — '+p.alias;if(folder.getName()!==label)folder.setName(label);}}
 return folder;
}
function digest_(bytes){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function receipt_(folder,id){if(!folder)return null;var list=folder.getFilesByName('.QuidEdge receipt — '+id+'.json');if(!list.hasNext())return null;var file=list.next();notPublic_(file);return JSON.parse(file.getBlob().getDataAsString());}
function doPost(e){
 var lock=LockService.getScriptLock(),locked=false;
 try{
  if(!e||!e.postData||e.postData.contents.length>10*1024*1024)return reply_({ok:false,code:'INVALID'});
  var p=JSON.parse(e.postData.contents),props=PropertiesService.getScriptProperties(),secret=props.getProperty('DRIVE_WEB_APP_SECRET');
  if(!secret||secret.length<32||p.secret!==secret)return reply_({ok:false,code:'UNAUTHORIZED'});
  var uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if(p.action!=='backup'&&p.action!=='health'&&!uuid.test(p.candidate_id||''))return reply_({ok:false,code:'INVALID'});
  var root=root_(),role=role_(root,props,false),folder;
  if(p.candidate_id){if(!uuid.test(p.candidate_id))return reply_({ok:false,code:'INVALID'});folder=candidate_(role,props,p,false);}
  if(p.action==='health')return reply_({ok:true,ready:true,protocol:3});
  if(p.action==='status'){
   var status={ok:true,cv:'Missing',cover:'Missing'};
   if(folder){var files=folder.getFiles();while(files.hasNext()){var file=files.next();notPublic_(file);var description=file.getDescription()||'';if(description.indexOf('QE-DOCUMENT:'+p.candidate_id+':cv:')===0)status.cv='Available';if(description.indexOf('QE-DOCUMENT:'+p.candidate_id+':cover:')===0)status.cover='Available';}}
   return reply_(status);
  }
  if(p.action==='receipt'){
   if(!uuid.test(p.id||''))return reply_({ok:false,code:'INVALID'});
   var receipt=receipt_(folder,p.id);
   if(!receipt)return reply_({ok:true,uploaded:false});
   if(receipt.fingerprint!==p.fingerprint||receipt.candidate_id!==p.candidate_id)return reply_({ok:false,code:'CONFLICT'});
   var original=DriveApp.getFileById(receipt.file_id);notPublic_(original);var parents=original.getParents(),found=false;while(parents.hasNext())if(parents.next().getId()===folder.getId())found=true;if(!found)throw Error('LOCATION_CHANGED');
   return reply_({ok:true,uploaded:true,document_type:receipt.document_type});
  }
  if(!lock.tryLock(25000))return reply_({ok:false,code:'BUSY'});locked=true;
  if(p.action==='backup'){
   if(!Array.isArray(p.records)||!p.records.length||p.records.length>500||p.records[0].seq!==p.first||p.records[p.records.length-1].seq!==p.last)return reply_({ok:false,code:'INVALID'});
   var dirs=root.getFoldersByName('_System backups'),backups=dirs.hasNext()?dirs.next():root.createFolder('_System backups');parent_(backups,root);
   var body=JSON.stringify({schema:1,first:p.first,last:p.last,events:p.records}),sha=digest_(Utilities.newBlob(body).getBytes()),name='events-'+p.first+'-'+p.last+'-'+sha+'.json',matches=backups.getFilesByName(name);
   if(matches.hasNext())notPublic_(matches.next());else backups.createFile(Utilities.newBlob(body,'application/json',name));
   return reply_({ok:true,saved:true,last:p.last});
  }
  if(!uuid.test(p.id||'')||!/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(p.alias||'')||!['cv','cover'].includes(p.document_type)||!['pdf','doc','docx'].includes(p.extension)||typeof p.name!=='string'||p.name.trim().length<2||p.name.trim().length>120||/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(p.name)||typeof p.data!=='string'||p.data.length>6990508||typeof p.fingerprint!=='string'||!p.fingerprint)return reply_({ok:false,code:'INVALID'});
  var bytes=Utilities.base64Decode(p.data);if(!bytes.length||bytes.length>5*1024*1024)return reply_({ok:false,code:'INVALID'});
  role=role_(root,props,true);folder=candidate_(role,props,p,true);
  var existing=receipt_(folder,p.id);if(existing){if(existing.fingerprint!==p.fingerprint)return reply_({ok:false,code:'CONFLICT'});notPublic_(DriveApp.getFileById(existing.file_id));return reply_({ok:true,document_type:existing.document_type});}
  var sha=digest_(bytes),name=(p.document_type==='cv'?'CV':'Cover letter')+' — '+p.alias+' — '+sha+'.'+p.extension,files=folder.getFilesByName(name),file;
  if(files.hasNext())file=files.next();else{var mime={pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}[p.extension];file=folder.createFile(Utilities.newBlob(bytes,mime,name));}
  notPublic_(file);file.setDescription('QE-DOCUMENT:'+p.candidate_id+':'+p.document_type+':'+sha);
  var receipt={candidate_id:p.candidate_id,document_type:p.document_type,fingerprint:p.fingerprint,file_id:file.getId()};
  folder.createFile(Utilities.newBlob(JSON.stringify(receipt),'application/json','.QuidEdge receipt — '+p.id+'.json'));
  return reply_({ok:true,document_type:p.document_type});
 }catch(err){return reply_({ok:false,code:['PUBLIC_FOLDER','LOCATION_CHANGED','TRASHED','FOLDER_CONFLICT'].indexOf(err.message)>=0?err.message:'DRIVE_ERROR'});}
 finally{if(locked)lock.releaseLock();}
}
/** Runs only from the owner's editor. Creates clearly labelled synthetic verification files, never recruitment events. */
function runStorageSelfTest(){
 var secret=PropertiesService.getScriptProperties().getProperty('DRIVE_WEB_APP_SECRET'),pdf='%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n';
 var base={secret:secret,candidate_id:'00000000-0000-4000-8000-000000000001',alias:'QE-SYSTEM-CHECK',name:'System verification (synthetic files)',extension:'pdf',data:Utilities.base64Encode(pdf)};
 ['cv','cover'].forEach(function(type,index){var p=Object.assign({},base,{id:'00000000-0000-4000-8000-00000000000'+(index+2),document_type:type,fingerprint:'self-test-protocol-3-'+type});var result=JSON.parse(doPost({postData:{contents:JSON.stringify(p)}}).getContent());if(!result.ok)throw Error('Private storage verification failed: '+result.code);});
 var status=JSON.parse(doPost({postData:{contents:JSON.stringify({secret:secret,action:'status',candidate_id:base.candidate_id})}}).getContent());if(status.cv!=='Available'||status.cover!=='Available')throw Error('Files did not verify');
 console.log('Private CV and cover-letter storage verified with synthetic files.');
}
