import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,generatePlan,setMealCooked,setPlanDiners,aggregateShopping,replaceMeal,mealIngredientQuantity,recipeById,addDays} from '../engine.js';
import {weekWindow,emptyWeek,retainWeeks,viewWeek,saveWeekView} from '../weeks.js';

const clone=value=>structuredClone(value);
const CURRENT='2026-11-02',NEXT='2026-11-09',TODAY='2026-11-04';
const settings=(startDate=CURRENT,extra={})=>({...clone(DEFAULT_SETTINGS),startDate,seed:3,...extra});
function single(startDate=CURRENT,extra={}){
 const applied=settings(startDate,extra);
 return {version:1,settings:applied,inventory:[],plan:generatePlan(applied),checked:{}};
}
function both(){
 const full=retainWeeks(single(),TODAY,DEFAULT_SETTINGS),next=viewWeek(full,NEXT);
 next.settings.seed=17;next.plan=generatePlan(next.settings);return saveWeekView(full,next);
}
const meals=week=>week.plan.days.flatMap(day=>day.meals);
const commonShopping=full=>{
 const current=aggregateShopping(full.plan,full.inventory),following=new Map(aggregateShopping(full.plan.nextWeek.plan,full.inventory).map(row=>[row.ingredientId,row.toBuy]));
 return current.find(row=>row.toBuy>1&&(following.get(row.ingredientId)||0)>1);
};

test('week windows use the supplied local calendar date across Sundays, years and leap days',()=>{
 assert.deepEqual(weekWindow(TODAY),[CURRENT,NEXT]);
 assert.deepEqual(weekWindow('2026-11-08'),[CURRENT,NEXT]);
 assert.deepEqual(weekWindow('2026-11-09'),[NEXT,'2026-11-16']);
 assert.deepEqual(weekWindow('2027-01-01'),['2026-12-28','2027-01-04']);
 assert.deepEqual(weekWindow('2028-02-29'),['2028-02-28','2028-03-06']);
 for(const value of [undefined,null,'2026-02-30','not-a-date'])assert.throws(()=>weekWindow(value));
});

test('an unplanned week is deterministic, contains no recipes and never generates on viewing',()=>{
 const original=settings(),before=clone(original),first=emptyWeek(original,NEXT),second=emptyWeek(original,NEXT);
 assert.deepEqual(first,second);assert.deepEqual(original,before);
 assert.equal(first.plan.unplanned,true);assert.equal(first.plan.generationId,`unplanned-${NEXT}`);
 assert.deepEqual(first.checked,{});assert.equal(first.settings.startDate,NEXT);assert.equal(first.plan.startDate,NEXT);
 assert.equal(first.plan.days.length,7);assert.equal(meals(first).length,0);assert.deepEqual(aggregateShopping(first.plan),[]);
 first.plan.days.forEach((day,index)=>{assert.equal(day.date,addDays(NEXT,index));assert.equal(day.weekday,index+1);assert.deepEqual(day.meals,[]);});
 for(const date of ['2026-11-03','2026-02-30',null])assert.throws(()=>emptyWeek(original,date));
 const empty=retainWeeks({...single(),plan:null},TODAY,DEFAULT_SETTINGS),snapshot=clone(empty);
 for(const date of [CURRENT,NEXT,CURRENT,NEXT]){const view=viewWeek(empty,date);assert.equal(meals(view).length,0);assert.equal(view.plan.unplanned,true);}
 assert.deepEqual(empty,snapshot);
});

test('a legacy current menu retains exact meal choices and cooked markers while next week starts empty',()=>{
 const legacy=single(),first=legacy.plan.days[0].meals[0];legacy.plan=setMealCooked(legacy.plan,first.key,true);
 legacy.inventory=[{ingredientId:'egg',quantity:3}];legacy.settings.feedback[first.recipeId]={liked:true};legacy.checked.oil=true;
 const original=clone(legacy),full=retainWeeks(legacy,TODAY,DEFAULT_SETTINGS);
 assert.deepEqual(legacy,original);assert.deepEqual(viewWeek(full,CURRENT),legacy);
 assert.equal(full.plan.nextWeek.plan.startDate,NEXT);assert.equal(full.plan.nextWeek.plan.unplanned,true);
 assert.equal(meals(full.plan.nextWeek).length,0);assert.deepEqual(full.inventory,legacy.inventory);
 assert.deepEqual(Object.keys(full).sort(),['checked','inventory','plan','settings','version']);
 assert.equal(Object.hasOwn(full.plan.nextWeek.plan,'nextWeek'),false);
});

test('a legacy menu already dated next week stays next week rather than being relabelled or replaced',()=>{
 const legacy=single(NEXT,{weekdayChildren:2,appetite:'small'}),meal=legacy.plan.days[0].meals[0];legacy.plan=setMealCooked(legacy.plan,meal.key,true);
 const full=retainWeeks(legacy,TODAY,DEFAULT_SETTINGS);
 assert.equal(full.plan.unplanned,true);assert.equal(meals(viewWeek(full,CURRENT)).length,0);
 assert.deepEqual(viewWeek(full,NEXT),legacy);assert.equal(full.settings.startDate,CURRENT);
});

test('two saved weeks survive JSON storage and repeated viewing without menu or metadata changes',()=>{
 const full=both(),serialized=JSON.stringify(full),roundtrip=JSON.parse(serialized);
 for(let index=0;index<6;index++)for(const date of [CURRENT,NEXT]){
  const view=viewWeek(roundtrip,date);assert.equal(Object.hasOwn(view.plan,'nextWeek'),false);
  assert.equal(meals(view).length,14);assert.deepEqual(saveWeekView(roundtrip,view),roundtrip);
 }
 assert.equal(JSON.stringify(full),serialized);
 const detached=viewWeek(roundtrip,NEXT);detached.plan.days[0].meals[0].cooked=true;detached.inventory.push({ingredientId:'egg',quantity:2});
 assert.equal(meals(roundtrip.plan.nextWeek)[0].cooked,undefined);assert.deepEqual(roundtrip.inventory,[]);
});

test('on Monday saved next week is promoted intact and the expired week is removed',()=>{
 let full=both();const next=viewWeek(full,NEXT),meal=meals(next)[0];next.plan=setMealCooked(next.plan,meal.key,true);next.checked.oil=true;next.settings.feedback[meal.recipeId]={liked:true};next.inventory=[{ingredientId:'milk',quantity:250}];full=saveWeekView(full,next);
 const preserved=viewWeek(full,NEXT),before=clone(full),promoted=retainWeeks(full,NEXT,DEFAULT_SETTINGS);
 assert.deepEqual(full,before);assert.deepEqual(viewWeek(promoted,NEXT),preserved);
 assert.equal(promoted.plan.nextWeek.plan.startDate,'2026-11-16');assert.equal(promoted.plan.nextWeek.plan.unplanned,true);
 assert.deepEqual(promoted.inventory,full.inventory);assert.deepEqual(promoted.settings.feedback,full.settings.feedback);
 assert.equal(promoted.plan.startDate,NEXT);assert.equal(promoted.plan.days.some(day=>day.date<CURRENT),false);
 assert.equal(Object.hasOwn(promoted.plan.nextWeek.plan,'nextWeek'),false);
 assert.deepEqual(retainWeeks(promoted,NEXT,DEFAULT_SETTINGS),promoted,'retention is idempotent after promotion');
});

test('stale or more distant legacy menus are discarded without generating new recipes or changing stock',()=>{
 for(const date of ['2026-10-19','2026-10-26','2026-11-16']){
  const old=single(date);old.inventory=[{ingredientId:'egg',quantity:2.5}];old.settings.feedback[meals(old)[0].recipeId]={slow:true};
  const full=retainWeeks(old,TODAY,DEFAULT_SETTINGS);
  assert.equal(full.plan.startDate,CURRENT);assert.equal(full.plan.unplanned,true);assert.equal(full.plan.nextWeek.plan.unplanned,true);
  assert.deepEqual(full.inventory,old.inventory);assert.deepEqual(full.settings.feedback,old.settings.feedback);
  assert.equal(meals(viewWeek(full,CURRENT)).length+meals(viewWeek(full,NEXT)).length,0);
 }
});

test('saving current or next week preserves the other saved menu and its cooked and shopping states',()=>{
 const original=both();
 for(const date of [CURRENT,NEXT]){
  const other=date===CURRENT?NEXT:CURRENT,full=clone(original),view=viewWeek(full,date),before=clone(full),otherBefore=viewWeek(full,other);
  const first=meals(view)[0];view.plan=setMealCooked(view.plan,first.key,true);view.checked.oil=true;
  view.settings.seed++;view.plan=replaceMeal(view.plan,meals(view)[1].key,view.settings,view.inventory);
  const saved=saveWeekView(full,view);
  assert.deepEqual(full,before);assert.deepEqual(viewWeek(saved,date),view);assert.deepEqual(viewWeek(saved,other),otherBefore);
 }
});

test('family portions and cooked metadata retain the exact child and small factors in each saved week',()=>{
 const original=both(),next=viewWeek(original,NEXT);next.settings={...next.settings,weekdayPeople:2,weekdayChildren:1,weekendPeople:0,weekendChildren:2,appetite:'small'};
 next.plan=setPlanDiners(next.plan,next.settings);next.plan=setMealCooked(next.plan,meals(next)[0].key,true);
 const saved=saveWeekView(original,next),loaded=viewWeek(JSON.parse(JSON.stringify(saved)),NEXT);
 assert.deepEqual(loaded,next);assert.deepEqual(viewWeek(saved,CURRENT),viewWeek(original,CURRENT));
 for(const [index,meal] of meals(loaded).entries()){
  assert.equal(meal.servings,index>=10?1.4:2.7);assert.equal(meal.portionFactor,0.7);
  const item=recipeById(meal.recipeId).ingredients[0],expected=item.quantity/2*(index>=10?0.98:1.89);
  assert.ok(Math.abs(mealIngredientQuantity(meal,item)-expected)<1e-9);
 }
});

test('inventory edits clear affected shopping checks in both weeks and preserve unaffected checks and cooked flags',()=>{
 let full=both();const common=commonShopping(full);assert.ok(common);
 full.checked[common.ingredientId]=true;full.plan.nextWeek.checked[common.ingredientId]=true;
 const currentRows=aggregateShopping(full.plan),nextRows=aggregateShopping(full.plan.nextWeek.plan);
 const unaffected=currentRows.find(row=>row.ingredientId!==common.ingredientId&&nextRows.some(other=>other.ingredientId===row.ingredientId));assert.ok(unaffected);
 full.checked[unaffected.ingredientId]=true;full.plan.nextWeek.checked[unaffected.ingredientId]=true;
 const currentFirst=full.plan.days[0].meals[0],nextFirst=full.plan.nextWeek.plan.days[0].meals[0];
 full.plan.days[0].meals[0].cooked=true;full.plan.nextWeek.plan.days[0].meals[0].cooked=true;
 const next=viewWeek(full,NEXT);next.inventory.push({ingredientId:common.ingredientId,quantity:0.5});const before=clone(full),saved=saveWeekView(full,next);
 assert.deepEqual(full,before);assert.equal(saved.checked[common.ingredientId],undefined);assert.equal(saved.plan.nextWeek.checked[common.ingredientId],undefined);
 assert.equal(saved.checked[unaffected.ingredientId],true);assert.equal(saved.plan.nextWeek.checked[unaffected.ingredientId],true);
 assert.equal(saved.plan.days[0].meals[0].key,currentFirst.key);assert.equal(saved.plan.days[0].meals[0].cooked,true);
 assert.equal(saved.plan.nextWeek.plan.days[0].meals[0].key,nextFirst.key);assert.equal(saved.plan.nextWeek.plan.days[0].meals[0].cooked,true);
 assert.deepEqual(saved.inventory,[{ingredientId:common.ingredientId,quantity:0.5}]);
});

test('global feedback is shared across both views while menus remain separate',()=>{
 const full=both(),next=viewWeek(full,NEXT),recipeId=meals(next)[0].recipeId;next.settings.feedback[recipeId]={liked:true,portion:'right'};
 const saved=saveWeekView(full,next);
 assert.deepEqual(saved.settings.feedback,next.settings.feedback);assert.deepEqual(saved.plan.nextWeek.settings.feedback,next.settings.feedback);
 assert.deepEqual(viewWeek(saved,CURRENT).settings.feedback,next.settings.feedback);assert.deepEqual(viewWeek(saved,NEXT).settings.feedback,next.settings.feedback);
 assert.deepEqual(saved.plan.days,full.plan.days);assert.deepEqual(saved.plan.nextWeek.plan,full.plan.nextWeek.plan);
});

test('invalid week selection and nested archives are rejected instead of creating more retained weeks',()=>{
 const full=both(),before=clone(full);
 for(const date of ['2026-10-26','2026-11-16','2026-11-03'])assert.throws(()=>viewWeek(full,date));
 const other=single('2026-11-16');assert.throws(()=>saveWeekView(full,other),/本週與下一週/);
 const nested=clone(full);nested.plan.nextWeek.plan.nextWeek=clone(full.plan.nextWeek);
 assert.throws(()=>retainWeeks(nested,TODAY,DEFAULT_SETTINGS),/嵌套/);assert.throws(()=>viewWeek(nested,NEXT),/嵌套/);
 const view=viewWeek(full,CURRENT);view.plan.nextWeek=clone(full.plan.nextWeek);assert.throws(()=>saveWeekView(full,view),/嵌套/);
 const wrongDate=clone(full);wrongDate.plan.nextWeek.plan.startDate='2026-11-16';wrongDate.plan.nextWeek.settings.startDate='2026-11-16';assert.throws(()=>viewWeek(wrongDate,NEXT),/日期/);
 assert.deepEqual(full,before);
});
