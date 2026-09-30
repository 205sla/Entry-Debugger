'use strict';
// Local UI review harness. No Entry account or external request is used.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'entry-debugger-extension');
const id = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const png = fs.readFileSync(path.join(extension, 'icon128.png'));
let project = {title:'썸네일 관리자 테스트',x:0,contentSaves:0,thumbnailUploads:0};
let thumbnail = png;
const assets = new Set(['settings.js','hangul-search.js','function-library-templates.js','thumbnail-media.js','thumbnail-ui.js','thumbnail-override.js','style.css','content.js']);
const setup = `
const storageListeners=[], runtimeListeners=[];
const defaults={...EntryDebuggerSettings.getDefaultSettings(),functionUsageEnabled:false,consoleDebuggingEnabled:false,boostModeControlVisible:false,functionPrivateVariablesEnabled:false,dropdownSearchEnabled:false,labTabEnabled:true};
function read(){return JSON.parse(localStorage.getItem('thumbnail-review')||'null')||defaults;}
function change(next){const old=read(),changes={};for(const k of new Set([...Object.keys(old),...Object.keys(next)])){if(old[k]!==next[k])changes[k]={oldValue:old[k],newValue:next[k]};}localStorage.setItem('thumbnail-review',JSON.stringify(next));storageListeners.forEach(fn=>fn(changes,'local'));}
window.chrome={runtime:{getURL:name=>'/ext/'+name,onMessage:{addListener:fn=>runtimeListeners.push(fn)},sendMessage:(msg,callback)=>{if(msg.type==='SET_SETTINGS'){const settings=EntryDebuggerSettings.normalize(msg.settings);change({...read(),...settings});runtimeListeners.forEach(fn=>fn({type:'APPLY_SETTINGS',settings},{},()=>{}));callback?.({settings});}}},storage:{local:{get:(keys,callback)=>{const data=read(),result=keys===null?data:typeof keys==='object'?{...keys,...data}:data;callback?.(result);return Promise.resolve(result);},set:async values=>change({...read(),...values}),remove:async key=>{const next=read();delete next[key];change(next);}},onChanged:{addListener:fn=>storageListeners.push(fn)}}};
const canvas=document.querySelector('canvas');
window.Entry={canvas_:canvas};
function draw(){const c=canvas.getContext('2d');c.fillStyle='#eaf0ff';c.fillRect(0,0,480,270);c.fillStyle='#4076ff';c.fillRect(110+Number(document.querySelector('#x').value),75,75,120);c.fillStyle='#172b4d';c.font='22px sans-serif';c.fillText('자동 썸네일',24,40);}
async function stats(){const data=await(await fetch('/fixture/project')).json();document.querySelector('#counts').textContent='작품 저장 '+data.contentSaves+'회 · 썸네일 업로드 '+data.thumbnailUploads+'회';return data;}
(async()=>{const data=await stats();document.querySelector('#title').value=data.title;document.querySelector('#x').value=data.x;draw();})();
document.querySelector('#x').oninput=draw;
document.querySelector('#save').onclick=async()=>{const label=document.querySelector('#save-result');label.textContent='저장 중';try{await fetch('/fixture/project',{method:'POST',body:JSON.stringify({title:document.querySelector('#title').value,x:Number(document.querySelector('#x').value)})});const result=await fetch('/rest/picture/project/thumbnail/${id}',{method:'POST',body:JSON.stringify({thumbnail:canvas.toDataURL()})});await result.json();label.textContent='저장 완료 · 화면 복원 완료';await stats();}catch(error){label.textContent=error.message;}};
`;
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>썸네일 관리자 · 로컬 검증</title><link rel="stylesheet" href="/ext/style.css"><style>body{font:14px Arial,sans-serif;margin:28px;background:#edf1f7;color:#24334b}h1{font-size:23px}main{display:flex;gap:24px;max-width:1120px;margin:auto}.stage{width:480px;background:white;border-radius:12px;padding:18px;height:430px}canvas{width:100%;margin:12px 0}label{display:block;margin:8px 0}input{padding:6px}button{padding:8px;cursor:pointer}aside{width:500px;background:white;border-radius:12px;overflow:hidden}.propertyTab{height:42px;display:flex;align-items:center;padding:0 14px;background:#dfe8ff}.propertyTabElement{cursor:pointer;margin-right:12px}.propertyTabdebugging{font-size:14px!important;width:auto!important;background:none!important}.propertyContent{position:relative;height:750px}.ed-wrapper{height:100%}#ed-debugger-panel{height:100%;width:100%}.notice{max-width:1120px;margin:0 auto 20px}</style><div class="notice"><h1>썸네일 관리자</h1><p>로컬 검증 화면 · 실제 확장 UI와 저장 훅 사용 · 엔트리 서버에는 전송하지 않습니다.</p></div><main><section class="stage"><label>작품 제목 <input id="title"></label><label>X좌표 <input id="x" type="number"></label><canvas width="480" height="270"></canvas><button id="save">작품 저장</button><p id="save-result" role="status">저장 대기</p><p id="counts"></p></section><aside><div class="propertyTab"><div class="propertyTabElement propertyTabobject">오브젝트</div></div><div class="propertyContent"></div></aside></main><script src="/ext/settings.js"></script><script>${setup}</script><script src="/ext/hangul-search.js"></script><script src="/ext/function-library-templates.js"></script><script src="/ext/thumbnail-media.js"></script><script src="/ext/thumbnail-ui.js"></script><script src="/ext/content.js"></script></html>`;
const server = http.createServer(async (req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:8097');
  res.setHeader('Cache-Control','no-store');
  if(url.pathname.startsWith('/ext/')){
    const file=url.pathname.slice(5);
    res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');
    if(!assets.has(file)){res.end('/* Unrelated Entry runtime omitted in this fixture. */');return;}
    let source=fs.readFileSync(path.join(extension,file),'utf8');
    if(file==='content.js')source=source.replace("url.protocol === 'https:' &&","url.protocol === 'http:' &&").replace("url.hostname === 'playentry.org' &&","url.hostname === '127.0.0.1' &&");
    res.end(source);return;
  }
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=Buffer.concat(chunks).toString('utf8');
  if(url.pathname==='/fixture/project'){
    if(req.method==='POST')project={...project,...JSON.parse(body),contentSaves:project.contentSaves+1};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(project));return;
  }
  if(url.pathname==='/rest/picture/project/thumbnail/'+id&&req.method==='POST'){
    thumbnail=Buffer.from(JSON.parse(body).thumbnail.split(',')[1],'base64');project.thumbnailUploads++;
    res.setHeader('Content-Type','application/json');res.end('{}');return;
  }
  if(url.pathname==='/uploads/thumb/'+id.slice(0,4)+'/'+id+'.png'){
    res.setHeader('Content-Type','image/png');res.end(thumbnail);return;
  }
  if(url.pathname==='/ws/'+id){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  res.statusCode=404;res.end('Not found');
});
server.listen(8097,'127.0.0.1',()=>console.log('Thumbnail review: http://127.0.0.1:8097/ws/'+id));
