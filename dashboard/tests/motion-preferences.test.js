import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/motion.js',import.meta.url),'utf8').replaceAll('export const ','const ').replaceAll('export function ','function ');
function setup(saved={},reduce=false,broken=false){
 const values=new Map(Object.entries(saved)),listeners={},media={matches:reduce,addEventListener(name,fn){this.change=fn;}};
 const elements={'motion-mode':{value:'',addEventListener(){}},'motion-mode-status':{textContent:''}};
 const document={readyState:'complete',documentElement:{dataset:{}},getElementById:id=>elements[id]||null};
 const context={document,Event,window:{matchMedia:()=>media,addEventListener:(n,fn)=>listeners[n]=fn,dispatchEvent(){}},localStorage:{getItem(k){if(broken)throw Error('blocked');return values.get(k)??null;},setItem(k,v){if(broken)throw Error('blocked');values.set(k,v);}}};
 vm.createContext(context);vm.runInContext(source+'\nglobalThis.api={getMotionMode,setMotionMode,motionEnabled,reveal};',context);
 return {api:context.api,values,media,elements,document,listeners};
}
test('new installations default to soft; prior disabled choice is preserved',()=>{
 assert.equal(setup().api.getMotionMode(),'soft');
 assert.equal(setup({finance_motion_v1:'off'}).api.getMotionMode(),'off');
 assert.equal(setup({finance_motion_v1:'on'}).api.getMotionMode(),'soft');
});
test('three modes persist without touching legacy settings; invalid input is ignored',()=>{
 const s=setup({finance_motion_v1:'off',finance_motion_v2:'full'});
 assert.equal(s.api.getMotionMode(),'full');
 for(const mode of ['off','soft','full']){s.api.setMotionMode(mode);assert.equal(s.values.get('finance_motion_v2'),mode);assert.equal(s.elements['motion-mode'].value,mode);}
 s.api.setMotionMode('invalid');assert.equal(s.api.getMotionMode(),'full');assert.equal(s.values.get('finance_motion_v1'),'off');
});
test('unavailable storage and invalid preferences fall back safely',()=>{
 assert.equal(setup({},false,true).api.getMotionMode(),'soft');
 assert.equal(setup({finance_motion_v2:'unknown'}).api.getMotionMode(),'soft');
 const s=setup({},false,true);s.api.setMotionMode('off');assert.equal(s.api.motionEnabled(),false);
});
test('system reduced motion overrides full without overwriting saved choice',()=>{
 const s=setup({finance_motion_v2:'full'},true);assert.equal(s.api.motionEnabled(),false);assert.equal(s.document.documentElement.dataset.motion,'off');
 assert.match(s.elements['motion-mode-status'].textContent,/reduzido do sistema/);
 s.media.matches=false;s.media.change();assert.equal(s.api.motionEnabled(),true);assert.equal(s.api.getMotionMode(),'full');
});
test('soft uses short opacity only, full retains transforms, off runs no animation',async()=>{
 const s=setup();const calls=[];const element={hidden:false,animate(frames,options){calls.push({frames,options});return {finished:Promise.resolve(),cancel(){},finish(){}};}};
 await s.api.reveal(element);assert.equal(calls[0].options.duration,140);assert(calls[0].frames.every(f=>!('transform'in f)));
 s.api.setMotionMode('full');await s.api.reveal(element);assert.equal(calls[1].options.duration,220);assert('transform'in calls[1].frames[0]);
 s.api.setMotionMode('off');await s.api.reveal(element);assert.equal(calls.length,2);
});
test('preference follows another tab and restores soft when cleared',()=>{
 const s=setup();s.values.set('finance_motion_v2','full');s.listeners.storage({key:'finance_motion_v2'});assert.equal(s.api.getMotionMode(),'full');
 s.values.clear();s.listeners.storage({key:null});assert.equal(s.api.getMotionMode(),'soft');
});
