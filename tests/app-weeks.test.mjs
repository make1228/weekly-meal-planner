import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as engine from '../engine.js';
import * as preferences from '../preferences.js';
import * as weeks from '../weeks.js';
import * as stores from '../stores.js';
import {accountConfig} from '../account/config.js';
import {publicDefaults} from '../account/model.js';
import {profileEquipment,renderUserEquipment} from '../account/equipment.js';
import {validateState} from '../state-validation.js';
import * as cookingUI from '../cooking-ui.js';
import {newGenerationId} from '../sync-model.js';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const clone=value=>structuredClone(value);
class Element{
 constructor(){this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.open=false;this.dataset={};this.listeners=new Map();this.attributes=new Map();this.textContent='';this.innerHTML='';this.classList={add(){},remove(){},toggle(){}};}
 addEventListener(type,callback){const callbacks=this.listeners.get(type)||[];callbacks.push(callback);this.listeners.set(type,callbacks);}
 async emit(type,event={}){for(const callback of this.listeners.get(type)||[])await callback({target:this,preventDefault(){},...event});}
 setAttribute(name,value){this.attributes.set(name,String(value));}
 getAttribute(name){return this.attributes.get(name)??null;}
 focus(){}scrollIntoView(){}close(){this.open=false;}showModal(){this.open=true;}
 querySelector(){return null;}
}
function harness(initial){
 const elements=new Map(),element=selector=>{if(!elements.has(selector))elements.set(selector,new Element());return elements.get(selector);};
 const choices={slots:['lunch','dinner'],favorites:['台式','義式','西式','美式'],appetite:['normal','small']};
 const inputs=Object.fromEntries(Object.entries(choices).map(([name,values])=>[name,values.map(value=>Object.assign(new Element(),{value,name}))]));
 const tabs=['menu','shopping'].map(tab=>Object.assign(new Element(),{dataset:{tab}}));
 const document={querySelector:selector=>selector==='#settings-form [name=appetite]:checked'?inputs.appetite.find(input=>input.checked)||null:element(selector),querySelectorAll:selector=>{
  const match=selector.match(/^\[name=(slots|favorites|appetite)\]$/);if(match)return inputs[match[1]];
  if(selector==='.tab')return tabs;return [];
 }};
 const storage=new Map();if(initial)storage.set('weekly-table-v1',JSON.stringify(initial));
 let storageWrites=0,generationCalls=0,sharedWrites=0,todayInstant='2026-11-04T12:00:00Z';
 const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storageWrites++;storage.set(key,String(value));}};
 const names={weekdayPeople:'#weekday-people',weekendPeople:'#weekend-people',weekdayChildren:'#weekday-children',weekendChildren:'#weekend-children',maxMinutes:'#max-minutes',avoid:'#avoid',riceMeals:'#rice-meals',pastaMeals:'#pasta-meals'};
 class FormData{
  get(name){if(names[name])return element(names[name]).value;if(name==='appetite')return inputs.appetite.find(input=>input.checked)?.value??null;return null;}
  getAll(name){return (inputs[name]||[]).filter(input=>input.checked).map(input=>input.value);}
 }
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[todayInstant]));}static now(){return Date.parse(todayInstant);}}
 let adapter;
 const installCloudSync=value=>{adapter=value;return {saveAccountDrafts:()=>false,noteDraftChange(){},refresh(){},async mutate(action){sharedWrites++;action();adapter.persist();adapter.refresh();}};};
 const bindings={accountConfig,publicDefaults,profileEquipment,renderUserEquipment,validateState,...engine,...preferences,...weeks,...stores,...cookingUI,newGenerationId,installCloudSync,document,localStorage,FormData,Date:FixedDate,window:{print(){}},navigator:{clipboard:{writeText:async()=>{}}},setTimeout:()=>0,clearTimeout(){}};
 bindings.generatePlan=(...args)=>{generationCalls++;return engine.generatePlan(...args);};
 const run=new Function(...Object.keys(bindings),source+'\nreturn {validateState,fullState,getView:()=>structuredClone(state),getDraft:()=>structuredClone(draftSettings)};');
 const app=run(...Object.values(bindings));
 return {...app,e:element,inputs,storage,setToday:value=>{todayInstant=value;},get storageWrites(){return storageWrites;},get generationCalls(){return generationCalls;},get sharedWrites(){return sharedWrites;},adapter};
}
function saved(date='2026-11-02',extra={}){
 const settings={...clone(engine.DEFAULT_SETTINGS),startDate:date,seed:7,...extra};
 return {version:1,settings,inventory:[],plan:{...engine.generatePlan(settings),generationId:'saved-menu'},checked:{}};
}
const meals=state=>state.plan.days.flatMap(day=>day.meals);

test('fresh app starts with two empty weeks and viewing them never generates or saves a menu',async()=>{
 const app=harness(),stored=app.storage.get('weekly-table-v1'),writes=app.storageWrites;
 assert.equal(app.generationCalls,0);assert.equal(meals(app.getView()).length,0);
 assert.match(app.e('#menu-grid').innerHTML,/本週尚未產生菜單/);
 for(let index=0;index<3;index++){
  await app.e('#next-week').emit('click');assert.equal(app.getView().plan.startDate,'2026-11-09');assert.match(app.e('#menu-grid').innerHTML,/下一週尚未產生菜單/);
  await app.e('#prev-week').emit('click');assert.equal(app.getView().plan.startDate,'2026-11-02');
 }
 assert.equal(app.generationCalls,0);assert.equal(app.sharedWrites,0);assert.equal(app.storageWrites,writes);
 assert.equal(app.storage.get('weekly-table-v1'),stored);
 assert.equal(app.e('#prev-week').getAttribute('aria-pressed'),'true');
 assert.equal(app.e('#next-week').getAttribute('aria-pressed'),'false');
 assert.doesNotMatch(app.e('#week-summary').innerHTML+app.e('#shopping-progress-text').textContent,/NaN|都煮好了/);
});

test('Generate saves only the selected week and switching away and back retains its exact menu',async()=>{
 const app=harness();await app.e('#next-week').emit('click');await app.e('#settings-form').emit('submit');
 const generated=app.getView(),stored=app.storage.get('weekly-table-v1'),writes=app.storageWrites;
 assert.equal(app.generationCalls,1);assert.equal(app.sharedWrites,1);assert.equal(meals(generated).length,14);
 assert.equal(app.fullState().plan.unplanned,true);assert.equal(meals(app.fullState().plan.nextWeek).length,14);
 await app.e('#prev-week').emit('click');assert.equal(meals(app.getView()).length,0);
 await app.e('#next-week').emit('click');assert.deepEqual(app.getView(),generated);
 assert.equal(app.storageWrites,writes);assert.equal(app.storage.get('weekly-table-v1'),stored);assert.equal(app.generationCalls,1);assert.equal(app.sharedWrites,1);
 const reloaded=harness(JSON.parse(stored));await reloaded.e('#next-week').emit('click');assert.deepEqual(reloaded.getView(),generated);assert.equal(reloaded.generationCalls,0);
 await app.e('#settings-form').emit('submit');assert.equal(app.generationCalls,2);assert.notEqual(app.getView().plan.generationId,generated.plan.generationId);
 assert.equal(app.fullState().plan.unplanned,true,'regenerating next week cannot fill current week');
});

test('legacy saved menu and cooked flags survive startup and read-only week navigation',async()=>{
 const legacy=saved(),first=meals(legacy)[0];legacy.plan=engine.setMealCooked(legacy.plan,first.key,true);
 const app=harness(legacy);assert.deepEqual(app.getView(),legacy);assert.equal(app.generationCalls,0);
 const before=clone(app.fullState()),writes=app.storageWrites;
 await app.e('#next-week').emit('click');assert.equal(meals(app.getView()).length,0);
 await app.e('#prev-week').emit('click');assert.deepEqual(app.getView(),legacy);
 assert.deepEqual(app.fullState(),before);assert.equal(app.storageWrites,writes);assert.equal(app.generationCalls,0);
});

test('a legacy saved next-week menu remains dated next week and backups round trip both weeks',async()=>{
 const legacy=saved('2026-11-09'),app=harness(legacy);
 assert.equal(app.getView().plan.unplanned,true);await app.e('#next-week').emit('click');assert.deepEqual(app.getView(),legacy);
 const full=app.fullState(),checked=app.validateState(JSON.parse(JSON.stringify(full)));
 assert.deepEqual(checked,full);assert.equal(meals(checked).length,0);assert.equal(meals(checked.plan.nextWeek).length,14);
 const nested=clone(full);nested.plan.nextWeek.plan.nextWeek=clone(full.plan.nextWeek);assert.throws(()=>app.validateState(nested),/本週與下一週/);
 const wrong=clone(full);wrong.plan.nextWeek=weeks.emptyWeek(full.settings,'2026-11-16');assert.throws(()=>app.validateState(wrong),/下一週日期/);
 const fabricated=clone(full);fabricated.plan.days[0].meals=[meals(legacy)[0]];assert.throws(()=>app.validateState(fabricated),/餐別或日期/);
});

test('cloud refresh preserves this device selected week while replacing both stored weeks',async()=>{
 const app=harness(saved()),full=app.fullState(),next=weeks.viewWeek(full,'2026-11-09');next.plan=engine.generatePlan(next.settings);const remote=weeks.saveWeekView(full,next);
 await app.e('#next-week').emit('click');app.adapter.setState(remote);app.adapter.refresh();
 assert.equal(app.getView().plan.startDate,'2026-11-09');assert.deepEqual(app.getView(),next);
 assert.equal(app.e('#next-week').getAttribute('aria-pressed'),'true');assert.equal(app.generationCalls,0);
});


test('two-week backups retain independent family portions and unfinished preferences stay in one draft',async()=>{
 const legacy=saved('2026-11-02',{weekdayChildren:1,appetite:'small'}),app=harness(legacy);
 const full=app.fullState(),next=weeks.viewWeek(full,'2026-11-09');next.settings={...next.settings,weekdayPeople:0,weekdayChildren:2,appetite:'small'};next.plan=engine.generatePlan(next.settings);app.adapter.setState(weeks.saveWeekView(full,next));app.adapter.refresh();
 const imported=app.validateState(JSON.parse(JSON.stringify(app.fullState())));
 assert.equal(imported.plan.days[0].meals[0].servings,2.7);assert.equal(imported.plan.days[0].meals[0].portionFactor,0.7);
 assert.equal(imported.plan.nextWeek.plan.days[0].meals[0].servings,1.4);assert.equal(imported.plan.nextWeek.plan.days[0].meals[0].portionFactor,0.7);
 const inconsistent=clone(imported);inconsistent.plan.nextWeek.plan.days[0].meals[0].children=1;assert.throws(()=>app.validateState(inconsistent),/人數與份量不一致/);
 app.e('#avoid').value+='、香菜';await app.e('#settings-form').emit('input',{target:app.e('#avoid')});const draft=app.getDraft();
 await app.e('#next-week').emit('click');await app.e('#prev-week').emit('click');assert.deepEqual(app.getDraft(),draft);assert.equal(app.generationCalls,0);
 assert.ok(!app.getView().settings.avoid.includes('香菜'),'typing a draft and switching weeks never applies it to a saved menu');
});


test('account view capture and restore keep both personal weeks and the personal selected week together',async()=>{
 const app=harness(saved());await app.e('#next-week').emit('click');await app.e('#settings-form').emit('submit');const personal=app.adapter.captureLocal();
 const shared=weeks.retainWeeks(saved('2026-11-02',{weekdayPeople:5}),'2026-11-04',engine.DEFAULT_SETTINGS);shared.inventory=[{ingredientId:'egg',quantity:9}];
 app.adapter.setState(shared);app.adapter.refresh();await app.e('#prev-week').emit('click');
 app.adapter.restoreLocal(personal);app.adapter.refresh();
 assert.deepEqual(app.fullState(),personal.state);assert.equal(app.getView().plan.startDate,personal.selectedWeek);assert.deepEqual(app.getDraft(),personal.draftSettings);
 assert.deepEqual(app.getView().inventory,[],'another account pantry cannot leak through a restored view');
});

test('an open page promotes the saved next week on Monday and removes expired storage without generating',async()=>{
 const app=harness(saved());await app.e('#next-week').emit('click');await app.e('#settings-form').emit('submit');const next=app.getView(),generations=app.generationCalls;
 app.setToday('2026-11-09T01:00:00Z');assert.equal(app.adapter.retentionNeeded(app.fullState()),true);
 app.adapter.refresh();
 assert.equal(app.fullState().plan.startDate,'2026-11-09');assert.deepEqual(app.getView(),next);assert.equal(app.fullState().plan.nextWeek.plan.startDate,'2026-11-16');assert.equal(app.fullState().plan.nextWeek.plan.unplanned,true);
 assert.equal(app.generationCalls,generations);assert.equal(app.adapter.retentionNeeded(app.fullState()),false);
 const stored=JSON.parse(app.storage.get('weekly-table-v1'));assert.equal(stored.plan.startDate,'2026-11-09');assert.equal(stored.plan.nextWeek.plan.startDate,'2026-11-16');assert.ok(!JSON.stringify(stored).includes('2026-11-02'));
 assert.match(app.e('#week-title').textContent,/本週菜單/);assert.equal(app.e('#prev-week').getAttribute('aria-pressed'),'true');
});

test('recipe catalog opens the full cooking guide without generating or changing saved weeks',async()=>{
 const app=harness(),before=clone(app.fullState()),writes=app.sharedWrites;
 await app.e('#catalog-list').emit('click',{target:{closest:()=>({dataset:{catalogRecipe:'chicken-salad'}})}});
 const html=app.e('#recipe-content').innerHTML;
 for(const label of ['溫雞胸毛豆沙拉','開始前先準備','完整作法','熟度怎麼判斷','成功關鍵與調整','74°C','尚未逐道實際試煮'])assert.ok(html.includes(label),label);
 assert.equal(app.e('#recipe-dialog').open,true);
 assert.deepEqual(app.fullState(),before);assert.equal(app.sharedWrites,writes);assert.equal(app.generationCalls,0);
});
test('full guide in the real app uses the same small adult/child amounts as its ingredient rows',async()=>{
 const app=harness(saved('2026-11-02',{weekdayPeople:2,weekdayChildren:1,appetite:'small'}));
 await app.e('#catalog-list').emit('click',{target:{closest:()=>({dataset:{catalogRecipe:'we-cheddar-chicken-pasta'}})}});
 const html=app.e('#recipe-content').innerHTML;
 assert.match(html,/2 大人＋1 小孩・小食量 70%/);
 assert.match(html,/132.3 g/);
 assert.match(html,/74°C/);assert.doesNotMatch(html,/\{\{|undefined|NaN/);
 const stored=app.storage.get('weekly-table-v1');
 const reloaded=harness(JSON.parse(stored));
 await reloaded.e('#catalog-list').emit('click',{target:{closest:()=>({dataset:{catalogRecipe:'we-cheddar-chicken-pasta'}})}});
 assert.equal(reloaded.e('#recipe-content').innerHTML,html);
});
