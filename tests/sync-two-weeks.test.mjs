import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,generatePlan,setMealCooked,replaceMeal,aggregateShopping,mealIngredientQuantity,recipeById} from '../engine.js';
import {settingsToDraft} from '../preferences.js';
import {retainWeeks,viewWeek,saveWeekView} from '../weeks.js';
import {createSharedSnapshot,createMutation,applyMutation,hasMutation,SyncConflictError} from '../sync-model.js';

const currentDate='2026-11-02',nextDate='2026-11-09',today='2026-11-04';
const clone=value=>structuredClone(value);
const meals=plan=>plan.days.flatMap(day=>day.meals);
const current=state=>viewWeek(state,currentDate);
const following=state=>viewWeek(state,nextDate);
const ids=week=>meals(week.plan).map(meal=>meal.recipeId);
function initial({emptyNext=false,family=false}={}){
 const settings={...clone(DEFAULT_SETTINGS),startDate:currentDate,seed:4};
 let state=retainWeeks({version:1,settings,inventory:[],plan:{...generatePlan(settings),generationId:'current-original'},checked:{}},today,DEFAULT_SETTINGS);
 if(!emptyNext){
  const next=following(state);next.settings={...next.settings,seed:8,...(family?{weekdayChildren:1,weekendChildren:1,appetite:'small'}:{})};
  next.plan={...generatePlan(next.settings),generationId:'next-original'};state=saveWeekView(state,next);
 }
 return createSharedSnapshot(state,settingsToDraft(settings));
}
function edit(base,date,change,options){const next=clone(base),week=viewWeek(next.state,date);change(week);next.state=saveWeekView(next.state,week);return createMutation(base,next,options);}
function regenerate(week){week.settings.seed++;week.plan={...generatePlan(week.settings,week.inventory,week.plan),generationId:`regenerated-${week.plan.startDate}`};}
const cooked=(state,date,key)=>meals(viewWeek(state,date).plan).find(meal=>meal.key===key)?.cooked;
function sharedRows(state){const a=aggregateShopping(current(state).plan,state.inventory),b=new Set(aggregateShopping(following(state).plan,state.inventory).filter(row=>row.toBuy>1).map(row=>row.ingredientId));return a.filter(row=>row.toBuy>1&&b.has(row.ingredientId));}

test('viewing either saved week and returning produces no mutation or hidden generation',()=>{
 const base=initial(),before=clone(base);
 for(const date of [nextDate,currentDate,nextDate,currentDate]){
  const viewed=viewWeek(base.state,date),after={...clone(base),state:saveWeekView(base.state,viewed)};
  assert.deepEqual(after,base);assert.equal(hasMutation(createMutation(base,after)),false);
 }
 assert.deepEqual(base,before);
 assert.deepEqual(Object.keys(base.state).sort(),['checked','inventory','plan','settings','version']);
 assert.ok(base.state.plan.nextWeek);assert.ok(!Object.hasOwn(base.state.plan.nextWeek.plan,'nextWeek'));
});

test('current regeneration merges with an independently cooked following-week meal in both arrival orders',()=>{
 const base=initial(),key=meals(following(base.state).plan)[0].key;
 const generation=edit(base,currentDate,regenerate,{replacePlan:true});
 const cook=edit(base,nextDate,week=>{week.plan=setMealCooked(week.plan,key,true);});
 for(const operations of [[generation,cook],[cook,generation]]){
  const result=operations.reduce(applyMutation,base);
  assert.equal(result.state.plan.generationId,`regenerated-${currentDate}`);
  assert.equal(cooked(result.state,nextDate,key),true);
  assert.deepEqual(ids(following(result.state)),ids(following(base.state)));
 }
});

test('following-week regeneration does not acquire a current-week CAS or erase current cooked edits',()=>{
 const base=initial(),key=meals(base.state.plan)[0].key;
 const generation=edit(base,nextDate,regenerate,{replacePlan:true});
 assert.equal(generation.plan,null,'explicit generation is scoped to the week that actually changed');
 assert.ok(generation.nextWeek.mutation.plan);
 const cook=edit(base,currentDate,week=>{week.plan=setMealCooked(week.plan,key,true);});
 for(const operations of [[generation,cook],[cook,generation]]){
  const result=operations.reduce(applyMutation,base);
  assert.equal(result.state.plan.nextWeek.plan.generationId,`regenerated-${nextDate}`);
  assert.equal(cooked(result.state,currentDate,key),true);
  assert.deepEqual(ids(current(result.state)),ids(current(base.state)));
 }
});

test('two different following-week meals still merge while swapping an already cooked target conflicts',()=>{
 const base=initial(),[a,b]=meals(following(base.state).plan);
 const first=edit(base,nextDate,week=>{week.plan=setMealCooked(week.plan,a.key,true);});
 const second=edit(base,nextDate,week=>{week.plan=setMealCooked(week.plan,b.key,true);});
 const combined=applyMutation(applyMutation(base,first),second);
 assert.equal(cooked(combined.state,nextDate,a.key),true);assert.equal(cooked(combined.state,nextDate,b.key),true);
 assert.deepEqual(current(combined.state),current(base.state));
 const swapped=edit(base,nextDate,week=>{week.plan=replaceMeal(week.plan,a.key,week.settings,week.inventory);});
 assert.throws(()=>applyMutation(applyMutation(base,first),swapped),error=>error instanceof SyncConflictError&&error.paths.includes(`nextWeek.meal.${a.key}`));
});

test('stale following-week generation cannot erase unseen cooked history in either order',()=>{
 const base=initial(),key=meals(following(base.state).plan)[0].key;
 const generation=edit(base,nextDate,regenerate,{replacePlan:true});
 const cook=edit(base,nextDate,week=>{week.plan=setMealCooked(week.plan,key,true);});
 for(const [first,second] of [[generation,cook],[cook,generation]]){
  const latest=applyMutation(base,first),before=clone(latest);
  assert.throws(()=>applyMutation(latest,second),SyncConflictError);assert.deepEqual(latest,before);
 }
});

test('stock deltas from different viewed weeks merge globally exactly once without scaling stock',()=>{
 const base=initial({family:true});base.state.inventory=[{ingredientId:'egg',quantity:2}];
 const a=edit(base,currentDate,week=>{week.inventory[0].quantity+=3;});
 const b=edit(base,nextDate,week=>{week.inventory[0].quantity+=4;});
 for(const operations of [[a,b],[b,a]]){
  const result=operations.reduce(applyMutation,base);
  assert.equal(result.state.inventory.find(row=>row.ingredientId==='egg').quantity,9);
  for(const date of [currentDate,nextDate]){
   const week=viewWeek(result.state,date),row=aggregateShopping(week.plan,week.inventory).find(item=>item.ingredientId==='egg');
   if(row){assert.equal(row.stock,9);assert.equal(row.usedStock,Math.min(row.required,9));}
  }
  assert.deepEqual(ids(current(result.state)),ids(current(base.state)));assert.deepEqual(ids(following(result.state)),ids(following(base.state)));
 }
});

test('global pantry changes invalidate affected checks in both weeks while unrelated checks survive',()=>{
 const base=initial(),[affected,unchanged]=sharedRows(base.state);assert.ok(affected&&unchanged);
 for(const week of [base.state,base.state.plan.nextWeek])week.checked={[affected.ingredientId]:true,[unchanged.ingredientId]:true};
 const change=edit(base,nextDate,week=>{week.inventory.push({ingredientId:affected.ingredientId,quantity:1});});
 const result=applyMutation(base,change);
 for(const week of [result.state,result.state.plan.nextWeek]){
  assert.equal(week.checked[affected.ingredientId],undefined);assert.equal(week.checked[unchanged.ingredientId],true);
 }
 const staleCheck=edit(base,nextDate,week=>{week.checked[affected.ingredientId]=false;delete week.checked[affected.ingredientId];});
 const latest=applyMutation(result,staleCheck);assert.equal(latest.state.plan.nextWeek.checked[affected.ingredientId],undefined);
});

test('shopping checks in different weeks remain separate and do not force a menu replacement',()=>{
 const base=initial(),row=sharedRows(base.state)[0];assert.ok(row);
 const a=edit(base,currentDate,week=>{week.checked[row.ingredientId]=true;});
 const b=edit(base,nextDate,week=>{week.checked[row.ingredientId]=true;});
 assert.equal(a.plan,null);assert.equal(b.plan,null);assert.equal(b.nextWeek.mutation.plan,null);
 const result=applyMutation(applyMutation(base,a),b);
 assert.equal(result.state.checked[row.ingredientId],true);assert.equal(result.state.plan.nextWeek.checked[row.ingredientId],true);
});

test('recipe feedback remains global, merges once and is reflected in both weekly views',()=>{
 const base=initial(),a=ids(current(base.state))[0],b=ids(following(base.state)).find(id=>id!==a);assert.ok(b);
 const first=edit(base,currentDate,week=>{week.settings.feedback[a]={liked:true};});
 const second=edit(base,nextDate,week=>{week.settings.feedback[b]={slow:true};});
 const result=applyMutation(applyMutation(base,first),second);
 assert.deepEqual(result.state.settings.feedback[a],{liked:true});assert.deepEqual(result.state.settings.feedback[b],{slow:true});
 assert.deepEqual(result.state.plan.nextWeek.settings.feedback,result.state.settings.feedback);
 assert.equal(first.nextWeek,undefined);assert.equal(second.nextWeek,undefined);
});

test('first following-week generation merges with current edits and competing first generations conflict',()=>{
 const base=initial({emptyNext:true}),firstKey=meals(base.state.plan)[0].key;
 const generated=edit(base,nextDate,regenerate,{replacePlan:true});
 const cookedMutation=edit(base,currentDate,week=>{week.plan=setMealCooked(week.plan,firstKey,true);});
 for(const operations of [[generated,cookedMutation],[cookedMutation,generated]]){
  const result=operations.reduce(applyMutation,base);
  assert.equal(meals(following(result.state).plan).length,14);assert.equal(cooked(result.state,currentDate,firstKey),true);
  assert.equal(result.state.plan.nextWeek.plan.unplanned,undefined);
 }
 const different=edit(base,nextDate,week=>{week.settings.seed+=11;regenerate(week);},{replacePlan:true});
 assert.throws(()=>applyMutation(applyMutation(base,generated),different),SyncConflictError);
});

test('legacy single-week clients may update current meals without deleting an existing following week',()=>{
 const base=initial(),next=clone(base),key=meals(next.state.plan)[0].key;
 delete next.state.plan.nextWeek;next.state.plan=setMealCooked(next.state.plan,key,true);
 const mutation=createMutation(base,next),result=applyMutation(base,mutation);
 assert.equal(mutation.nextWeek,undefined);assert.equal(cooked(result.state,currentDate,key),true);
 assert.deepEqual(result.state.plan.nextWeek,base.state.plan.nextWeek);
 const legacy=clone(base);delete legacy.state.plan.nextWeek;
 assert.equal(hasMutation(createMutation(legacy,clone(legacy))),false,'old records are not expanded implicitly');
});

test('following-week family portions, cooked state and quantities survive JSON and shared merge',()=>{
 const base=initial({family:true}),week=following(base.state),[first,second]=meals(week.plan);
 const changed=edit(base,nextDate,view=>{view.plan=setMealCooked(view.plan,first.key,true);});
 const result=JSON.parse(JSON.stringify(applyMutation(base,changed))),restored=createSharedSnapshot(result.state,result.preferences);
 assert.equal(cooked(restored.state,nextDate,first.key),true);assert.equal(second.servings,2.7);assert.equal(second.portionFactor,0.7);
 const recipe=recipeById(second.recipeId),item=recipe.ingredients[0];
 assert.ok(Math.abs(mealIngredientQuantity(second,item)-item.quantity/recipe.baseServings*1.89)<1e-9);
 assert.deepEqual(current(restored.state),current(base.state));
});

test('next-week boundaries reject wrong dates, nested archives and null metadata',()=>{
 const base=initial();
 for(const change of [state=>{state.plan.nextWeek=null;},state=>{state.plan.nextWeek.plan.startDate='2026-11-16';},state=>{state.plan.nextWeek.plan.nextWeek=clone(state.plan.nextWeek);}]){
  const state=clone(base.state);change(state);assert.throws(()=>createSharedSnapshot(state,base.preferences),TypeError);
 }
});


test('Monday promotion keeps the saved following-week menu, cooked markers and valid shopping checks',()=>{
 const base=initial(),view=following(base.state),[first]=meals(view.plan);
 view.plan=setMealCooked(view.plan,first.key,true);
 const row=aggregateShopping(view.plan,view.inventory).find(item=>item.toBuy>0);view.checked[row.ingredientId]=true;
 base.state=saveWeekView(base.state,view);
 const retained=retainWeeks(base.state,'2026-11-09',DEFAULT_SETTINGS);
 const target=createSharedSnapshot(retained,base.preferences),mutation=createMutation(base,target,{replacePlan:true});
 const result=applyMutation(base,mutation);
 assert.equal(result.state.plan.startDate,nextDate);assert.equal(result.state.plan.nextWeek.plan.startDate,'2026-11-16');
 assert.deepEqual(ids(viewWeek(result.state,nextDate)),ids(view));
 assert.equal(meals(result.state.plan).find(meal=>meal.key===first.key).cooked,true);
 assert.equal(result.state.checked[row.ingredientId],true);
 assert.equal(result.state.plan.nextWeek.plan.unplanned,true);assert.deepEqual(result.state.inventory,base.state.inventory);
});

test('legacy next-week-only records move into the following slot without losing that week shopping checks',()=>{
 const source=following(initial().state),[first]=meals(source.plan);source.plan=setMealCooked(source.plan,first.key,true);
 const row=aggregateShopping(source.plan,source.inventory).find(item=>item.toBuy>0);source.checked[row.ingredientId]=true;
 const base=createSharedSnapshot(source,settingsToDraft(source.settings)),target=createSharedSnapshot(retainWeeks(base.state,today,DEFAULT_SETTINGS),base.preferences);
 const result=applyMutation(base,createMutation(base,target,{replacePlan:true}));
 assert.equal(result.state.plan.startDate,currentDate);assert.equal(result.state.plan.unplanned,true);
 assert.equal(result.state.plan.nextWeek.plan.startDate,nextDate);
 assert.equal(result.state.plan.nextWeek.checked[row.ingredientId],true);
 assert.equal(meals(result.state.plan.nextWeek.plan).find(meal=>meal.key===first.key).cooked,true);
 assert.deepEqual(ids(following(result.state)),ids(source));
});
