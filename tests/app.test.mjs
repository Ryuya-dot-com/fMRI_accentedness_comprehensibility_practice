import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
import * as core from '../core.mjs';

const code = readFileSync(new URL('../app.mjs',import.meta.url),'utf8').replace(/^import .*;\n/,'');
const tick = async () => { for(let i=0;i<5;i++) await new Promise(setImmediate); };
async function harness({id='005',missingAudio=false,button=0,search=''}={}) {
  const ids = [...readFileSync(new URL('../index.html',import.meta.url),'utf8').matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
  const elements = new Map();
  class Element {
    constructor() { this.hidden=false; this.value=''; this.textContent=''; this.listeners={}; this.classes=new Set(); this.classList={toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x)}; }
    addEventListener(type,fn) { this.listeners[type]=fn; }
    setAttribute() {}
  }
  for (const id of ids) elements.set(id,new Element());
  const el = id=>{assert.ok(elements.has(id),id);return elements.get(id);};
  const cells = [1,2,3,4,5].map(n=>Object.assign(new Element(),{dataset:{value:String(n)}}));
  let now=0, raf, playing=null, plays=0;
  const pad = {index:0,id:'simulated Trainer',connected:true,axes:[-.03,0],buttons:[0,0,0].map(()=>({pressed:false}))};
  const document = {getElementById:el, querySelectorAll:()=>cells,hidden:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}};
  const window = {isSecureContext:true,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}};
  class AudioContext {
    state='suspended'; destination={};
    async resume(){this.state='running';} async suspend(){this.state='suspended';}
    async decodeAudioData(bytes){assert.ok(bytes.byteLength>44);return {};}
    createGain(){return {gain:{value:1},connect(){}};}
    createBufferSource(){playing={connect(){},start(){plays++;},stop(){},onended:null};return playing;}
  }
  window.AudioContext=AudioContext;
  const requests=[];
  const c=vm.createContext({...core,document,window,AudioContext,navigator:{getGamepads:()=>[pad]},
    crypto:webcrypto,URLSearchParams,performance:{now:()=>now},location:{search,reload(){}},requestAnimationFrame:fn=>{raf=fn;},
    fetch:async file=>{requests.push(file);assert.ok(file==='./practice.json'||/^audio\/practice_\d{2}\.wav$/.test(file));
      const bytes=readFileSync(new URL('../'+file,import.meta.url));
      return {ok:!(missingAudio&&file.endsWith('.wav')),json:async()=>JSON.parse(bytes),arrayBuffer:async()=>Uint8Array.from(bytes).buffer};}});
  vm.runInContext(code,c);
  const get=expr=>vm.runInContext(expr,c);
  const frame=(delta=20)=>{now+=delta; const fn=raf;raf=null;fn(now);};
  const press=()=>{pad.buttons[button].pressed=true;frame();pad.buttons[button].pressed=false;frame();};
  el('participant').value=id;
  await el('start-form').listeners.submit({preventDefault(){}}); await tick();
  return {el,pad,cells,document,window,requests,get,frame,press,
    get plays(){return plays;}, endAudio:()=>playing.onended(),
    advance:()=>frame(Math.max(0,get('deadline')-now)),
    calibrate:()=>{press();frame(510);pad.axes[0]=.66;press();pad.axes[0]=-.03;frame();pad.axes[0]=-.7;press();pad.axes[0]=-.03;frame();},
  };
}
test('combined link: calibration and 20 trials; same finger regardless of button index; no early, held or late answers',async()=>{
  for(const button of [0,2]) {
    const h=await harness({button});
    h.calibrate();assert.equal(h.get('phase'),'instructions');
    assert.match(h.el('message-body').textContent,/文法や語彙|実際に内容/);
    assert.equal(h.get('blocks[0].left'),'理解しやすい');
    h.press();h.advance();
    for(let i=0;i<20;i++) {
      assert.equal(h.get('phase'),'listening');assert.equal(h.plays,i+1);
      h.pad.axes[0]=-.7;h.pad.buttons[button].pressed=true;h.frame();h.endAudio();
      if(h.get('phase')==='delay')h.advance();
      assert.equal(h.get('phase'),'rating');h.frame();
      assert.equal(h.get('rating.value'),3);assert.equal(h.get('rating.confirmed'),false);
      h.pad.axes[0]=-.03;h.pad.buttons[button].pressed=false;h.frame();
      if(i!==2) {
        h.pad.axes[0]=-.7;h.frame();h.frame();assert.equal(h.get('rating.value'),4);
        h.pad.axes[0]=-.03;h.frame();h.pad.axes[0]=-.7;h.frame();assert.equal(h.get('rating.value'),5);
        h.press();assert.equal(h.get('rating.confirmed'),true);
        assert.equal(h.get('phase'),'rating','early answer keeps the full rating window');
      }
      h.advance();assert.equal(h.get('phase'),'iti');assert.equal(h.get('rating'),null);
      if(i===2)assert.match(h.el('feedback').textContent,/確定できません/);
      h.pad.axes[0]=-.03;h.advance();
      if(i===9){h.advance();assert.equal(h.get('phase'),'instructions');h.press();h.advance();}
    }
    h.advance();assert.equal(h.get('phase'),'finish');assert.equal(h.get('buffers.size'),0);
    assert.equal(h.requests.length,11);assert.equal(h.el('participant').value,'');
  }
});
test('separate links finish after ten sounds of only the selected task for all eight ID assignments',async()=>{
  for (let id=1;id<=8;id++) for (const task of ['accentedness','comprehensibility']) {
    const h=await harness({id:String(id).padStart(3,'0'),search:`?task=${task}`});
    const title=task==='accentedness'?'外国語訛り':'理解しやすさ';
    assert.equal(h.document.title,`${title}の練習`);
    assert.equal(h.el('welcome-title').textContent,`${title}の練習`);
    assert.equal(h.get('blocks.length'),1);
    assert.equal(h.get('blocks[0].task'),task);
    assert.equal(h.get('new Set(blocks[0].trials.map(t=>t.file)).size'),10);
    const left=task==='accentedness'?(id<=4?'訛りが強い':'訛りがない'):(id<=4?'理解しにくい':'理解しやすい');
    assert.equal(h.get('blocks[0].left'),left);
    h.calibrate();assert.equal(h.el('message-title').textContent,`練習：${title}の評価`);
    h.press();h.advance();
    for (let trial=0;trial<10;trial++) {
      assert.equal(h.get('phase'),'listening');assert.equal(h.plays,trial+1);
      h.endAudio();if(h.get('phase')==='delay')h.advance();
      assert.equal(h.get('phase'),'rating');
      assert.equal(h.el('task-title').textContent,title);
      assert.equal(h.el('left-label').textContent,left);
      h.press();assert.equal(h.get('rating.confirmed'),true);
      h.advance();h.advance();
    }
    assert.equal(h.get('phase'),'final');h.advance();
    assert.equal(h.get('phase'),'finish');assert.equal(h.plays,10);
    assert.equal(h.get('buffers.size'),0);assert.equal(h.el('participant').value,'');
    assert.equal(h.requests.length,11);
  }
});
test('an invalid task link does not silently start a different task',async()=>{
  for (const search of ['?task=unknown','?task=','?task=__proto__']) {
    const h=await harness({search});
    assert.equal(h.get('phase'),'welcome');assert.equal(h.requests.length,0);
    assert.match(h.el('start-error').textContent,/リンクが正しくありません/);
  }
});
test('disconnect, loss of focus, hidden page and missing audio stop instead of silently continuing',async()=>{
  for(const kind of ['disconnect','blur','hidden']) {
    const h=await harness();h.calibrate();h.press();h.advance();
    if(kind==='disconnect'){h.pad.connected=false;h.frame();}
    if(kind==='blur')h.window.listeners.blur();
    if(kind==='hidden'){h.document.hidden=true;h.document.listeners.visibilitychange();}
    assert.equal(h.get('phase'),'error');assert.equal(h.el('restart').hidden,false);
  }
  const missing=await harness({missingAudio:true});assert.equal(missing.get('phase'),'error');
});
