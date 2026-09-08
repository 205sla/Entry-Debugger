'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname,'../entry-debugger-extension/high-quality-screen-capture.js'),'utf8');
function extract(name,next) {
  const start=source.indexOf('  function '+name+'(');
  const end=source.indexOf('  function '+next+'(',start);
  assert(start>=0&&end>start);
  return vm.runInNewContext('('+source.slice(start,end).trim()+')',{MAX_PIXELS:8294400});
}
const sizeFor=extract('sizeFor','allocate');
const make=(scale=4/3)=>({root:{scaleX:scale,scaleY:scale,canvas:{width:640,height:360}},stage:{_app:{}}});
assert.deepStrictEqual(JSON.parse(JSON.stringify(sizeFor(make()))),{
  width:1920,height:1080,factor:3,screenWidth:640,screenHeight:360,limit:8192
});
for(const scale of [0.01,0.25,0.5,1,3,15]) {
  const size=sizeFor(make(scale));
  assert(size.width*size.height<=8294400);
  assert(size.width<=8192&&size.height<=8192);
  assert(Math.abs(size.width/size.height-16/9)<0.02);
}
const glJob=make();
glJob.stage._app.renderer={screen:{width:640,height:360},gl:{
  MAX_TEXTURE_SIZE:1,MAX_RENDERBUFFER_SIZE:2,isContextLost:()=>false,getParameter:()=>1024
}};
const limited=sizeFor(glJob);
assert.strictEqual(limited.width,1024);assert.strictEqual(limited.height,576);
glJob.stage._app.renderer.gl.isContextLost=()=>true;
assert.throws(()=>sizeFor(glJob),/WebGL/);
for(const scale of [0,NaN,Infinity]) assert.throws(()=>sizeFor(make(scale)),/크기와 배율/);
const restoreAll=extract('restoreAll','render2D');
const restored=[];
assert.throws(()=>restoreAll([()=>restored.push(1),()=>{throw Error('failure');},()=>restored.push(3)]),/failure/);
assert.deepStrictEqual(restored,[3,1],'one failing cleanup must not skip another');
console.log('[check-screen-capture] OK: pixel/GL caps, invalid scale, cleanup failure isolation. PNG content is tested by smoke:screen-capture.');
