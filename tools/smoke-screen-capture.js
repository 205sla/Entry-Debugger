'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { decodePng } = require('./png-test-utils');
const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'dist/entry-debugger-extension-release');
const evidenceDir = path.join(rootDir, 'dist/screen-capture-evidence');
const entryUrl = process.env.ENTRY_DEBUGGER_SMOKE_URL || 'https://playentry.org/ws/590e746f150c3963bf86078e';
const { chromium } = require(require.resolve('playwright', {
  paths: [rootDir, path.resolve(rootDir, '../../apps/MYentry-game')]
}));

async function fixture(page) {
  await page.evaluate(async () => {
    if (Entry.engine.state !== 'stop') Entry.engine.toggleStop();
    for (const object of Entry.container.objects_) {
      object.script.load([]); object.entity.setVisible(false);
    }
    const scene = Entry.scene.selectedScene.id;
    const svg = (body) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' + body + '</svg>');
    const red = svg('<path fill="#ff0000" d="M0 0h64v64H0z"/>');
    const stripes = svg('<path fill="#ffffff" d="M0 0h64v64H0z"/><path fill="#0000ff" d="M0 0h64v16H0z"/>' +
      Array.from({length:64},(_,i)=>'<path fill="#000000" d="M'+i+' 16h.5v48h-.5z"/>').join(''));
    const bitmap = document.createElement('canvas'); bitmap.width = bitmap.height = 64;
    bitmap.getContext('2d').fillStyle='#00ff00'; bitmap.getContext('2d').fillRect(0,0,64,64);
    const green = bitmap.toDataURL();
    for (const [id, x, y, fileurl, imageType] of [
      ['edRed',-120,10,red,'svg'],['edVector',120,10,stripes,'svg'],['edBitmap',0,-65,green,'png']
    ]) {
      Entry.container.addObject({id,name:id,objectType:'sprite',scene,script:[],
        sprite:{name:id,pictures:[{id:id+'Pic',fileurl,imageType,dimension:{width:64,height:64},name:id}],sounds:[]},
        entity:{x,y,regX:32,regY:32,scaleX:1,scaleY:1,rotation:0,direction:90,width:64,height:64,visible:true}});
    }
    Entry.container.addObject({id:'edText',name:'edText',objectType:'textBox',text:'Capture 123 한글',scene,script:[],
      sprite:{name:'edText',pictures:[],sounds:[]},entity:{x:0,y:90,regX:110,regY:14,scaleX:1,scaleY:1,
        width:220,height:28,rotation:0,direction:90,visible:true,text:'Capture 123 한글',
        font:'20px Arial',fontSize:20,colour:'#000000',bgColor:'#ffffff',textAlign:1}});
    // Real Entry script executes while running. It changes the bitmap position;
    // exact pause-time coordinates are compared with both PNG and post-capture state.
    Entry.container.getObject('edBitmap').script.load([[{type:'when_run_button_click'},
      {type:'repeat_inf',statements:[[{type:'move_x',params:[0.1]},{type:'move_x',params:[-0.1]}]]}]]);
    window.logicSteps=0;
    const movingScript=Entry.container.getObject('edBitmap').script;
    const originalTick=movingScript.tick;
    movingScript.tick=function(){window.logicSteps++;return originalTick.apply(this,arguments);};
    window.captureResults = [];
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'SCREEN_CAPTURE_RESULT') window.captureResults.push(event.data.payload);
    });
    window.captureState = () => ({
      entities: Entry.container.objects_.map((o) => ({id:o.id,model:o.entity.toJSON(),effect:o.entity.effect})),
      variables: Entry.variableContainer.variables_.map((v)=>[v.id_,v.getValue()]),
      lists: Entry.variableContainer.lists_.map((v)=>[v.id_,v.array_]),
      width:Entry.stage.canvas.canvas.width,height:Entry.stage.canvas.canvas.height,
      x:Entry.stage.canvas.x,y:Entry.stage.canvas.y,sx:Entry.stage.canvas.scaleX,sy:Entry.stage.canvas.scaleY,
      resolution:Entry.stage._app.renderer?.resolution,
      turbo:Entry.isTurbo,fps:Entry.FPS,engineTime:Entry.engine._getEngineTimeMs?.(),scriptTicks:window.logicSteps
    });
    Entry.addEventListener('dispatchEventDidTogglePause', () => {
      if (Entry.engine.state === 'pause') {
        window.pausedState=window.captureState();
        if(window.failureKind==='cors') return;
        const out=document.createElement('canvas');
        out.width=640;out.height=360;
        if (Entry.stage._app.renderer) Entry.stage._app.renderer.render(Entry.stage.canvas);
        else {
          const ctx=out.getContext('2d');Entry.stage.canvas.updateContext(ctx);Entry.stage.canvas.draw(ctx,true);
        }
        if (Entry.stage._app.renderer) out.getContext('2d').drawImage(Entry.stage.canvas.canvas,0,0,640,360);
        window.pausedPng=out.toDataURL();
      }
    });
    Entry.requestUpdate=true;
  });
  await page.waitForTimeout(1000);
}

function inspect(png, state) {
  assert.strictEqual(png.width,1920); assert.strictEqual(png.height,1080);
  const at = (x,y) => png.pixel((x+240)*4,(135-y)*4);
  const brightness=state.entities.find((o)=>o.id==='edRed').effect?.brightness||0;
  assert.deepStrictEqual(at(-120,10),[255+brightness,0,0,255], 'red object location/color/effect');
  const vectorBrightness=state.entities.find((o)=>o.id==='edVector').effect?.brightness||0;
  assert.deepStrictEqual(at(120,34),[0,0,255+vectorBrightness,255], 'vector blue header location/color');
  const green=state.entities.find((o)=>o.id==='edBitmap').model;
  assert.deepStrictEqual(at(green.x,green.y),[0,255,0,255], 'bitmap matches exact paused position');
  assert.deepStrictEqual(at(-230,-120),[255,255,255,255], 'stage background and composition');
  // Each half-unit SVG stripe becomes TWO distinct pixels at 4x. A 640px
  // screenshot enlarged to 1920 cannot resolve this sequence.
  let sharpPairs=0;
  for(let i=4;i<60;i++) {
    const x=(120-32+i+240)*4;
    const y=(135-10)*4;
    if(png.pixel(x,y)[0]<40 && png.pixel(x+2,y)[0]>215) sharpPairs++;
  }
  assert(sharpPairs>48,'SVG must be re-rasterized, sharp pairs='+sharpPairs);
  let ink=0;
  for(let y=80;y<240;y++) for(let x=600;x<1320;x++) if(png.pixel(x,y)[0]<80) ink++;
  assert(ink>1000,'text must be included');
  return {width:png.width,height:png.height,sharpPairs,textPixels:ink};
}

async function checkSplitControls(page, boost, fullscreen) {
  await page.waitForSelector('.ed-screen-controls:visible');
  const group=page.locator('.ed-screen-controls:visible');
  assert.strictEqual(await group.count(),1,'one visible split group');
  const pause=group.locator('button').first(),capture=group.getByRole('button',{name:'캡처하기',exact:true});
  const left=await pause.boundingBox(),right=await capture.boundingBox(),whole=await group.boundingBox();
  assert(Math.abs(left.width-right.width)<1,'equal halves');
  assert(Math.abs(left.width+right.width-whole.width)<1,'halves fill group');
  assert(Math.abs(left.x+left.width-right.x)<1,'adjacent controls');
  assert((await pause.innerText()).includes('일시정지'));
  assert.strictEqual(await capture.getAttribute('title'),'캡처하기');
  await page.screenshot({path:path.join(evidenceDir,(boost?'webgl':'canvas')+(fullscreen?'-full':'')+'-split-ui.png')});
  const before=await page.evaluate(()=>window.captureResults.length);
  let downloads=0; const listener=()=>downloads++;page.on('download',listener);
  try {
    await pause.click();
    await page.waitForFunction(()=>Entry.engine.state==='pause');
    await page.waitForTimeout(350);
    assert.strictEqual(await page.locator('.ed-screen-controls').count(),0,'native resume restores full button');
    assert.strictEqual(downloads,0,'native pause must not capture');
    assert.strictEqual(await page.evaluate(()=>window.captureResults.length),before);
    await page.locator(fullscreen?'button.entryRestartButtonWorkspace_full:visible':'button.entryRestartButtonWorkspace_w:visible').click();
    await page.waitForSelector('.ed-screen-controls:visible');
  } finally {page.off('download',listener);}
  const placement=await page.locator('#ed-toggle-screen-capture').evaluate((el)=>({
    section:el.closest('.ed-section').id,
    previous:el.closest('.ed-lab-setting').previousElementSibling.querySelector('.ed-lab-title').textContent
  }));
  assert.deepStrictEqual(placement,{section:'ed-section-settings',previous:'블럭 이미지 초고화질 저장'});
}

async function clickCapture(page, filename) {
  await page.waitForFunction(()=>Entry.engine.state==='run' && !!Entry.engine.pauseButton.parentElement.querySelector('.ed-screen-capture'));
  const before = await page.evaluate(()=>window.captureResults.length);
  const downloadPromise=page.waitForEvent('download',{timeout:25000}).catch((error)=>({error}));
  // Use the separate capture half in ordinary/fullscreen mode.
  console.log('capture start',filename,await page.locator('button.ed-screen-capture:visible').count());
  if(await page.locator('.tooltipGuide .close').count()) await page.locator('.tooltipGuide .close').click();
  await page.locator('button.ed-screen-capture:visible').first().click({timeout:10000});
  const download=await downloadPromise;
  if(download.error) throw new Error(JSON.stringify(await page.evaluate(()=>({results:window.captureResults,state:Entry.engine.state})))+download.error.message);
  await download.saveAs(path.join(evidenceDir,filename));
  await page.waitForFunction((n)=>window.captureResults.length>n,before);
  const state=await page.evaluate(()=>({state:Entry.engine.state,before:window.pausedState,after:window.captureState(),
    result:window.captureResults.at(-1),disabled:Entry.engine.pauseButton.disabled,
    label:Entry.engine.pauseButton.textContent,pausedPng:window.pausedPng}));
  assert.strictEqual(state.state,'pause'); assert(state.result.success,state.result.message);
  assert.strictEqual(state.disabled,false); assert.notStrictEqual(state.label,'캡처하기');
  assert.deepStrictEqual(state.after,state.before,'capture must not advance entity/variable/timer settings');
  const png=decodePng(fs.readFileSync(path.join(evidenceDir,filename)));
  const details=inspect(png,state.before);
  const baseline=decodePng(Buffer.from(state.pausedPng.split(',')[1],'base64'));
  // Match coarse stage colors away from vector edges to pause-time screen.
  for(const [x,y] of [[160,166],[480,134],[15,340]]) {
    assert.deepStrictEqual(png.pixel(x*3,y*3),baseline.pixel(x,y),'pause image composition');
  }
  return details;
}

async function settings(page, patch) {
  // Exercise the actual settings checkbox and its storage/background path.
  await page.locator('.propertyTabdebugging').click();
  for(const [key,value] of Object.entries(patch)) {
    const selector={'screenCaptureEnabled':'#ed-toggle-screen-capture','labTabEnabled':'#ed-toggle-setting-lab-tab'}[key];
    await page.locator(selector).evaluate((el,checked)=>{el.checked=checked;el.dispatchEvent(new Event('change',{bubbles:true}));},value);
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(350);
}

async function overlays(page, boost) {
  await page.evaluate(()=>{
    Entry.variableContainer.addVariable({id:'edVisibleVar',name:'Capture variable',value:42,x:-230,y:85,visible:true});
    Entry.variableContainer.addList({id:'edVisibleList',name:'Capture list',variableType:'list',
      array:[{data:'alpha'},{data:'beta'}],x:145,y:55,width:85,height:70,visible:true});
    const red=Entry.container.getObject('edRed').entity;
    new Entry.Dialog(red,'Bubble','speak');
    Entry.setBasicBrush(red);
    red.brush.moveTo(-210,60);red.brush.lineTo(-100,105);red.brush.stop=true;
    Entry.requestUpdate=true;
  });
  await page.waitForTimeout(400);
  await page.evaluate(()=>Entry.engine.togglePause());
  await clickCapture(page,boost?'webgl-overlays.png':'canvas-overlays.png');
  const png=decodePng(fs.readFileSync(path.join(evidenceDir,boost?'webgl-overlays.png':'canvas-overlays.png')));
  const baseline=decodePng(Buffer.from((await page.evaluate(()=>window.pausedPng)).split(',')[1],'base64'));
  // Count colored/ink pixels in the independently decoded variable/list/pen/
  // bubble regions and require agreement with the actual paused screen.
  let matched=0,total=0,ink=0;
  for(let y=0;y<360;y+=2) for(let x=0;x<640;x+=2) {
    const expected=baseline.pixel(x,y),actual=png.pixel(x*3+1,y*3+1);
    if(expected.slice(0,3).some((v)=>v<220)) ink++;
    if(expected.every((v,i)=>Math.abs(v-actual[i])<70)) matched++;
    total++;
  }
  assert(ink>4500,'overlays and objects must have visible ink');
  assert(matched/total>0.95,'paused display composition agreement '+matched/total);
  console.log('overlays match',boost,matched/total,ink);
}

async function lifecycle(page, context, worker, boost) {
  // Scene change and return via real Entry APIs, without saving the project.
  await page.evaluate(()=>{
    const original=Entry.scene.selectedScene;
    Entry.scene.addScene();
    Entry.scene.selectScene(original);
    Entry.engine.togglePause();
  });
  await clickCapture(page,boost?'webgl-scene-return.png':'canvas-scene-return.png');
  // Simulate SPA URL events without invoking server save/navigation. The actual
  // full editor reconnect is tested separately below.
  await page.evaluate(()=>{window.returnUrl=location.href;history.pushState({},'','/capture-test-away');});
  await page.waitForTimeout(500);
  assert.strictEqual(await page.locator('.ed-screen-capture').count(),0);
  await page.evaluate(()=>history.pushState({},'',window.returnUrl));
  await page.waitForTimeout(700);
  await settings(page,{screenCaptureEnabled:true});
  await page.evaluate(()=>{
    if(Entry.engine.state==='pause') Entry.engine.togglePause();
    else if(Entry.engine.state==='stop') Entry.engine.toggleRun();
  });
  await clickCapture(page,boost?'webgl-spa-return.png':'canvas-spa-return.png');
  // Actual extension popup OFF/ON (persistent normalization and UI cleanup).
  const popup=await context.newPage();
  await popup.goto('chrome-extension://'+new URL(worker.url()).hostname+'/popup.html');
  await popup.locator('.toggle-switch').click();
  await page.waitForSelector('#ed-debugger-panel',{state:'detached'});
  assert.strictEqual(await page.locator('.ed-screen-capture').count(),0);
  await popup.locator('.toggle-switch').click();
  await page.waitForSelector('#ed-debugger-panel',{state:'attached'});
  await settings(page,{labTabEnabled:true,screenCaptureEnabled:true});
  await popup.close();
  // Preserve intended active renderer for a new initialization.
  const storedBoost=await page.evaluate(()=>localStorage.getItem('__ENTRY_DEBUGGER_BOOST_MODE_ENABLED__')==='1');
  if(storedBoost!==boost) await page.locator('#ed-boost-mode-toggle').click();
  await page.waitForTimeout(300);
  assert.strictEqual((await worker.evaluate(()=>chrome.storage.local.get('screenCaptureEnabled'))).screenCaptureEnabled,true);
  await page.reload({waitUntil:'domcontentloaded'});
  await Promise.race([
    page.getByText('아니요',{exact:true}).waitFor({state:'visible',timeout:20000}),
    page.waitForFunction(()=>!!window.Entry?.stage,null,{timeout:20000})
  ]);
  if(await page.getByText('아니요',{exact:true}).isVisible()) await page.getByText('아니요',{exact:true}).click();
  try {
    await page.waitForFunction(()=>window.Entry?.playground?.object&&window.__ENTRY_DEBUGGER_SCREEN_CAPTURE_INJECTED__,null,{timeout:20000});
  } catch(error) {
    console.log('reconnect debug',await page.evaluate(()=>({url:location.href,entry:!!window.Entry,
      stage:!!window.Entry?.stage,object:!!window.Entry?.playground?.object,
      capture:window.__ENTRY_DEBUGGER_SCREEN_CAPTURE_INJECTED__,body:document.body.innerText.slice(0,250),
      scripts:[...document.scripts].map((s)=>s.src).filter((s)=>s.includes('chrome-extension'))})));
    throw error;
  }
  assert.strictEqual(await page.evaluate(()=>!!Entry.stage._app.renderer),boost);
  await fixture(page);
  await page.evaluate(()=>Entry.engine.toggleRun());
  await clickCapture(page,boost?'webgl-reconnect.png':'canvas-reconnect.png');
  assert.strictEqual(await page.locator('#ed-toggle-screen-capture').count(),1);
}

async function expectFailure(page, kind) {
  await page.evaluate(async (kind)=>{
    window.failureRestore=[];
    window.failureKind=kind;
    const replace=(owner,key,fn)=>{
      const descriptor=Object.getOwnPropertyDescriptor(owner,key);
      window.failureRestore.push(()=>descriptor?Object.defineProperty(owner,key,descriptor):delete owner[key]);
      owner[key]=fn;
    };
    if(kind==='encode') replace(HTMLCanvasElement.prototype,'toBlob',function(cb){cb(null);});
    if(kind==='timeout') replace(HTMLCanvasElement.prototype,'toBlob',function(){});
    if(kind==='cancel') replace(HTMLCanvasElement.prototype,'toBlob',function(){});
    if(kind==='font') replace(document.fonts,'load',()=>Promise.reject(new Error('Injected font loading failure')));
    if(kind==='cors') {
      const image=new Image();
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src='https://capture-test.playentry.org/tainted.png';});
      const Node=Entry.container.getObject('edBitmap').entity.object.constructor;
      const node=new Node(image); // Canvas2D Bitmap, no crossOrigin attribute.
      Entry.stage.canvas.addChild(node);
      window.failureRestore.push(()=>Entry.stage.canvas.removeChild(node));
    }
    if(kind==='render') {
      if(Entry.stage._app.renderer) {
        const renderer=Entry.stage._app.renderer,original=renderer.render;
        replace(renderer,'render',function(){
          if(this.view.width>640) throw new Error('Injected high-resolution render failure');
          return original.apply(this,arguments);
        });
      } else {
        const root=Entry.stage.canvas,original=root.draw;
        replace(root,'draw',function(ctx){
          if(ctx.canvas.width>640) throw new Error('Injected high-resolution render failure');
          return original.apply(this,arguments);
        });
      }
    }
    Entry.engine.togglePause();
  },kind);
  const count=await page.evaluate(()=>window.captureResults.length);
  let downloads=0;
  const onDownload=()=>downloads++;
  page.on('download',onDownload);
  try {
    await page.locator('button.ed-screen-capture:visible').first().click();
    await page.evaluate(()=>{
      if(Entry.engine.pauseButton.disabled) {
        Entry.engine.pauseButton.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        Entry.engine.pauseButtonFull.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      }
    });
    if(kind==='cancel') await settings(page,{screenCaptureEnabled:false});
    await page.waitForFunction((n)=>window.captureResults.length>n,count,{timeout:20000});
    const result=await page.evaluate(()=>({result:window.captureResults.at(-1),state:Entry.engine.state,
      before:window.pausedState,after:window.captureState(),disabled:Entry.engine.pauseButton.disabled}));
    assert.strictEqual(result.result.success,false,kind);
    assert.strictEqual(result.state,'pause');assert.strictEqual(result.disabled,false);
    assert.deepStrictEqual(result.after,result.before,kind+' restoration');
    assert.strictEqual(downloads,0,kind+' must not download');
    assert.strictEqual(await page.evaluate(()=>window.captureResults.length),count+1,'duplicate click must not create jobs');
    console.log('failure restored',kind,result.result.message);
  } finally {
    page.off('download',onDownload);
    await page.evaluate(()=>{window.failureRestore.reverse().forEach((restore)=>restore());window.failureKind=null;});
    if(kind==='cancel') await settings(page,{screenCaptureEnabled:true});
  }
}

async function main() {
  fs.mkdirSync(evidenceDir,{recursive:true});
  const summary=[];
  for(const boost of [false,true]) {
    const profile=fs.mkdtempSync(path.join(os.tmpdir(),'entry-capture-'));
    const context=await chromium.launchPersistentContext(profile,{
      executablePath:process.env.ENTRY_DEBUGGER_CHROMIUM_EXECUTABLE,headless:false,
      viewport:{width:1600,height:1100},ignoreDefaultArgs:['--disable-extensions'],
      args:['--window-position=-2400,-1600','--mute-audio','--disable-extensions-except='+extensionDir,'--load-extension='+extensionDir]
    });
    try {
      const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
      await worker.evaluate(()=>chrome.storage.local.set({enabled:true,debuggerTabEnabled:true,labTabEnabled:true,
        screenCaptureEnabled:true,boostModeEnabled:false,turboModeEnabled:true,frameProfilerEnabled:true}));
      const page=await context.newPage();
      page.on('pageerror',(error)=>console.log('PAGEERROR',error.message));
      page.on('requestfailed',(request)=>{if(request.url().includes('capture-origin'))console.log('CORS fixture request',request.failure());});
      page.on('console',(message)=>{if(message.type()==='error'&&message.text().includes('capture-origin'))console.log(message.text());});
      await page.goto(entryUrl,{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForFunction(()=>window.Entry?.playground?.object&&window.__ENTRY_DEBUGGER_SCREEN_CAPTURE_INJECTED__,null,{timeout:60000});
      await page.waitForTimeout(1500);
      if(await page.locator('.tooltipGuide .close').count()) await page.locator('.tooltipGuide .close').click();
      if(boost) {
        await page.locator('#ed-boost-mode-toggle').click();
        await page.waitForFunction(()=>localStorage.getItem('__ENTRY_DEBUGGER_BOOST_MODE_ENABLED__')==='1');
        await page.reload({waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>window.Entry?.stage?._app?.renderer&&window.__ENTRY_DEBUGGER_SCREEN_CAPTURE_INJECTED__,null,{timeout:60000});
      }
      assert.strictEqual(await page.evaluate(()=>!!Entry.stage._app.renderer),boost);
      await fixture(page);
      await page.route('https://capture-test.playentry.org/tainted.png',(route)=>route.fulfill({
        contentType:'image/png',body:fs.readFileSync(path.join(evidenceDir,'canvas.png'))
      }));
      await page.evaluate(()=>Entry.engine.toggleRun());
      await checkSplitControls(page,boost,false);
      summary.push({boost,fullscreen:false,...await clickCapture(page,boost?'webgl.png':'canvas.png')});
      if(process.env.ENTRY_CAPTURE_FOCUS==='lifecycle') {
        await lifecycle(page,context,worker,boost);
        continue;
      }
      if(process.env.ENTRY_CAPTURE_FOCUS==='cors') {
        if(!boost) await expectFailure(page,'cors');
        continue;
      }
      // Native resume, capture again, then enter actual Entry workspace fullscreen.
      await page.locator('button.entryRestartButtonWorkspace_w:visible').click();
      await clickCapture(page,boost?'webgl-repeat.png':'canvas-repeat.png');
      await page.evaluate(()=>Entry.engine.maximizeButton.click());
      await page.waitForSelector('.entryPopupWindow',{state:'visible'});
      await page.locator('button.entryRestartButtonWorkspace_full:visible').click();
      await checkSplitControls(page,boost,true);
      summary.push({boost,fullscreen:true,...await clickCapture(page,boost?'webgl-full.png':'canvas-full.png')});
      await page.screenshot({path:path.join(evidenceDir,boost?'webgl-ui.png':'canvas-ui.png')});
      await page.evaluate(()=>Entry.engine.toggleFullScreen());

      // Real native color effect cache and turbo mode remain active throughout capture.
      await page.evaluate(()=>{
        const red=Entry.container.getObject('edRed').entity;
        red.effect.brightness=-50;red.applyFilter(true);
        const vector=Entry.container.getObject('edVector').entity;
        vector.effect.brightness=-5;vector.applyFilter(true);
        Entry.engine.setSpeedMeter(Infinity);
        Entry.engine.togglePause();
      });
      await clickCapture(page,boost?'webgl-effects-turbo.png':'canvas-effects-turbo.png');
      assert.strictEqual(await page.evaluate(()=>Entry.isTurbo),true);
      for(const kind of ['render','encode','font','timeout','cancel',...(!boost?['cors']:[])]) await expectFailure(page,kind);
      await page.evaluate(()=>Entry.engine.togglePause());
      await clickCapture(page,boost?'webgl-after-failure.png':'canvas-after-failure.png');

      // OFF/ON in either order with boost. Changing boost without reload must
      // keep capturing with the actual renderer, irrespective of option flags.
      for(let i=0;i<3;i++) {
        await settings(page,{screenCaptureEnabled:false});
        await page.evaluate(()=>Entry.engine.togglePause());
        await page.waitForTimeout(250);
        assert.strictEqual(await page.locator('.ed-screen-capture').count(),0);
        await page.locator('button.entryPauseButtonWorkspace_w:visible').click();
        assert.strictEqual(await page.evaluate(()=>Entry.engine.state),'pause');
        await page.locator('#ed-boost-mode-toggle').click();
        await settings(page,{screenCaptureEnabled:true});
        assert.strictEqual(await page.locator('.ed-screen-capture').count(),0,'resume must not become capture');
      }
      await page.evaluate(()=>Entry.engine.togglePause());
      await clickCapture(page,boost?'webgl-after-toggles.png':'canvas-after-toggles.png');

      // Thumbnail applied through the real file selection and Apply UI.
      const thumbnail=await page.evaluate(()=>{
        const c=document.createElement('canvas');c.width=16;c.height=9;
        c.getContext('2d').fillStyle='#ff00ff';c.getContext('2d').fillRect(0,0,16,9);
        return c.toDataURL();
      });
      await page.locator('#ed-thumbnail-tool input[type=file]').setInputFiles({name:'magenta.png',mimeType:'image/png',buffer:Buffer.from(thumbnail.split(',')[1],'base64')});
      await page.waitForFunction(()=>!document.querySelector('#ed-thumbnail-tool [data-action=apply]').disabled);
      await page.locator('#ed-thumbnail-tool [data-action=apply]').evaluate((button)=>button.click());
      await page.waitForFunction(()=>document.querySelector('.ed-thumbnail-status').textContent.includes('적용 준비 완료'),null,{timeout:10000});
      const appliedThumbnail=await page.evaluate(()=>Entry.canvas_.toDataURL());
      const thumbnailPng=decodePng(Buffer.from(appliedThumbnail.split(',')[1],'base64'));
      assert.deepStrictEqual(thumbnailPng.pixel(200,100),[255,0,255,255]);
      await page.evaluate(()=>Entry.engine.togglePause());
      await clickCapture(page,boost?'webgl-thumbnail.png':'canvas-thumbnail.png');
      assert.strictEqual(await page.evaluate(()=>Entry.canvas_.toDataURL()),appliedThumbnail);

      // Capture is a settings feature; laboratory OFF must preserve it.
      await settings(page,{labTabEnabled:false});
      assert.strictEqual(await page.locator('#ed-toggle-screen-capture').isChecked(),true);
      await page.evaluate(()=>Entry.engine.togglePause());
      await clickCapture(page,boost?'webgl-lab-off.png':'canvas-lab-off.png');
      await settings(page,{labTabEnabled:true});
      assert.strictEqual(await page.locator('#ed-toggle-screen-capture').isChecked(),true);
      await overlays(page,boost);
      await lifecycle(page,context,worker,boost);
      console.log('[screen-capture]',JSON.stringify(summary.at(-1)));
    } finally {await context.close(); fs.rmSync(profile,{recursive:true,force:true});}
  }
  fs.writeFileSync(path.join(evidenceDir,'results.json'),JSON.stringify(summary,null,2));
  console.log('[smoke-screen-capture] OK',JSON.stringify(summary));
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
