import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('./',import.meta.url));
const names=['index.html','styles.css','app.js','model.js','store.js','config.js','guide.js','role.js','documents.js','record-utils.js'];
const assets={};
for(const name of names)assets['/'+name]={body:await readFile(root+'src/'+name,'utf8'),type:name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.html')?'text/html; charset=utf-8':'application/javascript; charset=utf-8'};
const appSource=assets['/app.js'].body+'\n'+await readFile(root+'src/workspace.js','utf8');
const bundledApp=await build({stdin:{contents:appSource,resolveDir:root+'src',sourcefile:'app.js'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
assets['/app.js'].body=bundledApp.outputFiles[0].text;
const version=createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0,12);
for(const asset of Object.values(assets))asset.body=asset.body.replace(/\?v=[a-f0-9]+/g,'?v='+version);
let server=await readFile(root+'src/api.js','utf8');
server=server.replace('export default {',await readFile(root+'src/drive-server.js','utf8')+'\n'+await readFile(root+'src/maintenance.js','utf8')+'\nexport default {');
const workerSource=server+'\nconst ASSETS='+JSON.stringify(assets)+';\n';
const compiled=await build({stdin:{contents:workerSource,resolveDir:root+'src',sourcefile:'api.js'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const worker=compiled.outputFiles[0].text;
await writeFile(root+'worker.js',worker);
await writeFile(root+'../backend.js',worker);
const result=await build({stdin:{contents:appSource,resolveDir:root+'src',sourcefile:'app.js'},
  bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',
  plugins:[{name:'github-api',setup(b){b.onLoad({filter:/config\.js$/},()=>({contents:"export const config={eventsUrl:'https://quidedge-recruitment.inquiries-quidedge-au.workers.dev/api/events'};",loader:'js'}));}}]});
const standalone=assets['/index.html'].body.replace(/<link rel="stylesheet"[^>]+>/,'<style>'+assets['/styles.css'].body+'</style>')
 .replace(/<script type="module" src="[^\"]+"><\/script>/,'<script>'+result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')+'</script>');
await writeFile(root+'../index.html',standalone);
console.log('Built standalone Worker and GitHub frontend · '+version);
