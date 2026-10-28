import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,generatePlan,setMealCooked,replaceMeal,aggregateShopping,addDays} from '../engine.js';
import {settingsToDraft} from '../preferences.js';
import {SyncConflictError,createSharedSnapshot,createMutation,hasMutation,applyMutation,validSharedPreferences} from '../sync-model.js';

function initial(){
 const settings={...structuredClone(DEFAULT_SETTINGS),startDate:'2026-10-26'};
 return createSharedSnapshot({version:1,settings,inventory:[],plan:generatePlan(settings,[]),checked:{}},settingsToDraft(settings));
}
const edit=(base,change,options)=>{const next=structuredClone(base);change(next);return createMutation(base,next,options);};
const keys=base=>base.state.plan.days.flatMap(day=>day.meals).map(meal=>meal.key);
const meal=(snapshot,key)=>snapshot.state.plan.days.flatMap(day=>day.meals).find(item=>item.key===key);
const stock=(snapshot,id)=>snapshot.state.inventory.find(item=>item.ingredientId===id)?.quantity;
const firstNeeded=base=>aggregateShopping(base.state.plan,base.state.inventory).find(row=>row.toBuy>0);

test('two family members can cook different meals without losing either update',()=>{
 const base=initial(),[first,second]=keys(base);
 const a=edit(base,next=>{next.state.plan=setMealCooked(next.state.plan,first,true);});
 const b=edit(base,next=>{next.state.plan=setMealCooked(next.state.plan,second,true);});
 const merged=applyMutation(applyMutation(base,a),b);
 assert.equal(meal(merged,first).cooked,true);assert.equal(meal(merged,second).cooked,true);
 assert.deepEqual(base.state.checked,{});assert.equal(meal(base,first).cooked,undefined);
});

test('swap and cook on the same meal conflict instead of losing a cooked marker',()=>{
 const base=initial(),[first]=keys(base);
 const cooked=edit(base,next=>{next.state.plan=setMealCooked(next.state.plan,first,true);});
 const swapped=edit(base,next=>{next.state.plan=replaceMeal(next.state.plan,first,next.state.settings,[]);});
 assert.throws(()=>applyMutation(applyMutation(base,cooked),swapped),error=>error instanceof SyncConflictError&&error.paths.includes(`meal.${first}`));
});

test('regenerating a stale menu cannot erase another device cooked markers',()=>{
 const base=initial(),[first]=keys(base);
 const cooked=edit(base,next=>{next.state.plan=setMealCooked(next.state.plan,first,true);});
 const regenerated=edit(base,next=>{next.state.settings.seed++;next.state.plan=generatePlan(next.state.settings,[],next.state.plan);},{replacePlan:true});
 assert.throws(()=>applyMutation(applyMutation(base,cooked),regenerated),SyncConflictError);
 assert.throws(()=>applyMutation(applyMutation(base,regenerated),cooked),SyncConflictError);
});

test('switching weeks cannot accept an old meal mutation even with the same recipe',()=>{
 const base=initial(),[first]=keys(base);
 const cooked=edit(base,next=>{next.state.plan=setMealCooked(next.state.plan,first,true);});
 const week=edit(base,next=>{next.state.settings.startDate=addDays(next.state.settings.startDate,7);next.state.plan=generatePlan(next.state.settings,[]);},{replacePlan:true});
 assert.throws(()=>applyMutation(applyMutation(base,week),cooked),SyncConflictError);
});

test('simultaneous stock additions sum while unrelated ingredients remain intact',()=>{
 const base=initial();base.state.inventory=[{ingredientId:'egg',quantity:2}];
 const a=edit(base,next=>{next.state.inventory[0].quantity+=3;next.state.inventory.push({ingredientId:'milk',quantity:250});});
 const b=edit(base,next=>{next.state.inventory[0].quantity+=4;});
 const merged=applyMutation(applyMutation(base,a),b);
 assert.equal(stock(merged,'egg'),9);assert.equal(stock(merged,'milk'),250);
});

test('simultaneous first additions to a new ingredient sum',()=>{
 const base=initial();
 const a=edit(base,next=>{next.state.inventory.push({ingredientId:'egg',quantity:2});});
 const b=edit(base,next=>{next.state.inventory.push({ingredientId:'egg',quantity:3});});
 assert.equal(stock(applyMutation(applyMutation(base,a),b),'egg'),5);
});

test('removing stock conflicts with an unseen addition in either arrival order',()=>{
 const base=initial();base.state.inventory=[{ingredientId:'egg',quantity:2}];
 const remove=edit(base,next=>{next.state.inventory=[];});
 const add=edit(base,next=>{next.state.inventory[0].quantity+=1;});
 assert.throws(()=>applyMutation(applyMutation(base,add),remove),SyncConflictError);
 assert.throws(()=>applyMutation(applyMutation(base,remove),add),SyncConflictError);
});

test('merged inventory cannot exceed the allowed stock quantity',()=>{
 const base=initial();base.state.inventory=[{ingredientId:'oil',quantity:999999}];
 const a=edit(base,next=>{next.state.inventory[0].quantity=1000000;});
 assert.throws(()=>applyMutation(applyMutation(base,a),a),SyncConflictError);
});

test('shopping check is discarded when another device changes its required amount',()=>{
 const base=initial(),row=firstNeeded(base);
 const check=edit(base,next=>{next.state.checked[row.ingredientId]=true;});
 const pantry=edit(base,next=>{next.state.inventory.push({ingredientId:row.ingredientId,quantity:Math.min(row.toBuy,1)});});
 const merged=applyMutation(applyMutation(base,pantry),check);
 assert.equal(merged.state.checked[row.ingredientId],undefined);
 const reverse=applyMutation(applyMutation(base,check),pantry);
 assert.equal(reverse.state.checked[row.ingredientId],undefined);
});

test('a shopping check for an unchanged amount survives an unrelated pantry edit',()=>{
 const base=initial(),row=firstNeeded(base);
 const unused='tomato';assert.notEqual(row.ingredientId,unused);
 const check=edit(base,next=>{next.state.checked[row.ingredientId]=true;});
 const pantry=edit(base,next=>{next.state.inventory.push({ingredientId:unused,quantity:100});});
 assert.equal(applyMutation(applyMutation(base,pantry),check).state.checked[row.ingredientId],true);
});

test('shopping checks from the previous week cannot leak into the new week',()=>{
 const base=initial(),row=firstNeeded(base);
 const check=edit(base,next=>{next.state.checked[row.ingredientId]=true;});
 const week=edit(base,next=>{next.state.settings.startDate=addDays(next.state.settings.startDate,7);next.state.plan=generatePlan(next.state.settings,[]);},{replacePlan:true});
 assert.equal(applyMutation(applyMutation(base,week),check).state.checked[row.ingredientId],undefined);
});

test('different preference fields merge while same-field edits show a conflict',()=>{
 const base=initial();
 const a=edit(base,next=>{next.preferences.avoidText+='、香菜';});
 const b=edit(base,next=>{next.preferences.weekdayPeople='3';});
 const c=edit(base,next=>{next.preferences.avoidText+='、洋蔥';});
 const merged=applyMutation(applyMutation(base,a),b);
 assert.equal(merged.preferences.weekdayPeople,'3');assert.match(merged.preferences.avoidText,/香菜/);
 assert.deepEqual(merged.state.settings,base.state.settings,'form preferences do not apply to a menu until Generate');
 assert.throws(()=>applyMutation(applyMutation(base,a),c),error=>error.code==='sync/conflict'&&error.paths.includes('preferences.avoidText'));
});

test('recipe feedback merges independent fields and survives menu regeneration',()=>{
 const base=initial(),id=meal(base,keys(base)[0]).recipeId;
 const like=edit(base,next=>{next.state.settings.feedback[id]={liked:true};});
 const portion=edit(base,next=>{next.state.settings.feedback[id]={portion:'more'};});
 const regen=edit(base,next=>{next.state.settings.seed++;next.state.plan=generatePlan(next.state.settings,[],next.state.plan);},{replacePlan:true});
 const merged=applyMutation(applyMutation(applyMutation(base,like),portion),regen);
 assert.deepEqual(merged.state.settings.feedback[id],{liked:true,portion:'more'});
});

test('seed updates from simultaneous swaps merge instead of producing false conflicts',()=>{
 const base=initial(),[first,second]=keys(base);
 const change=key=>edit(base,next=>{next.state.plan=replaceMeal(next.state.plan,key,next.state.settings,[]);next.state.settings.seed++;});
 assert.equal(applyMutation(applyMutation(base,change(first)),change(second)).state.settings.seed,2);
});

test('invalid unfinished preferences retain earlier shared fields without adding defaults',()=>{
 const previous={weekdayPeople:'2',slots:['lunch','dinner'],avoidText:'青椒',favorites:['義式']};
 const result=validSharedPreferences({weekdayPeople:'',weekendPeople:'0',maxMinutes:'',slots:[],favorites:[],avoidText:'',riceMeals:'1.5'},previous);
 assert.deepEqual(result,{weekdayPeople:'2',slots:['lunch','dinner'],avoidText:'',favorites:[]});
 assert.deepEqual(validSharedPreferences({weekdayPeople:'',slots:[]}),{});
});

test('inventory order, set-array ordering and empty feedback do not create mutations',()=>{
 const base=initial();base.state.inventory=[{ingredientId:'egg',quantity:2},{ingredientId:'milk',quantity:100}];
 const next=structuredClone(base);next.state.inventory.reverse();next.state.settings.avoid.reverse();next.state.settings.favorites.reverse();next.state.settings.slots.reverse();next.preferences.slots.reverse();next.state.settings.feedback['lemon-chicken']={};
 assert.equal(hasMutation(createMutation(base,next)),false);
});

test('mutations are JSON serializable and preserve original snapshots',()=>{
 const base=initial(),original=structuredClone(base);
 const mutation=edit(base,next=>{next.state.inventory.push({ingredientId:'egg',quantity:2.25});});
 const result=applyMutation(base,JSON.parse(JSON.stringify(mutation)));
 assert.equal(stock(result,'egg'),2.25);assert.deepEqual(base,original);assert.equal(typeof mutation.id,'string');
});

test('malformed inventory and incompatible shared versions are rejected at the boundary',()=>{
 const base=initial(),bad=structuredClone(base);bad.state.inventory=[{ingredientId:'egg',quantity:NaN}];
 assert.throws(()=>createMutation(base,bad),TypeError);
 assert.throws(()=>applyMutation({...base,version:2},createMutation(base,base)),TypeError);
 assert.throws(()=>createSharedSnapshot({...base.state,inventory:[{ingredientId:'unknown',quantity:1}]},base.preferences),TypeError);
});

test('an old-week uncheck cannot clear a newly checked item in the latest week',()=>{
 const base=initial(),row=firstNeeded(base);base.state.checked[row.ingredientId]=true;
 const uncheck=edit(base,next=>{next.state.checked={};});
 const latest=structuredClone(base);latest.state.settings.startDate=addDays(latest.state.settings.startDate,7);latest.state.plan=generatePlan(latest.state.settings,[]);latest.state.checked[row.ingredientId]=true;
 assert.equal(applyMutation(latest,uncheck).state.checked[row.ingredientId],true);
});

test('generation identity rejects stale cooking even if regenerated recipes are identical',()=>{
 const base=initial(),[first]=keys(base);base.state.plan.generationId='generation-one';
 const cooked=edit(base,next=>{next.state.plan=setMealCooked(next.state.plan,first,true);});
 const latest=structuredClone(base);latest.state.plan.generationId='generation-two';
 assert.throws(()=>applyMutation(latest,cooked),SyncConflictError);
});

test('partial next preferences cannot delete cloud values for unfinished fields',()=>{
 const base=initial(),next=structuredClone(base);next.preferences={weekdayPeople:'',slots:[],avoidText:'香菜'};
 const merged=applyMutation(base,createMutation(base,next));
 assert.equal(merged.preferences.weekdayPeople,base.preferences.weekdayPeople);
 assert.deepEqual(merged.preferences.slots,base.preferences.slots);assert.equal(merged.preferences.avoidText,'香菜');
});

test('backup import quantities are absolute and conflict with unseen pantry updates',()=>{
 const base=initial();base.state.inventory=[{ingredientId:'egg',quantity:2}];
 const imported=edit(base,next=>{next.state.inventory[0].quantity=10;},{replaceInventory:true});
 const added=edit(base,next=>{next.state.inventory[0].quantity=3;});
 assert.equal(stock(applyMutation(base,imported),'egg'),10);
 assert.throws(()=>applyMutation(applyMutation(base,added),imported),SyncConflictError);
});


test('cloud normalization keeps lunch before dinner when shared input arrives in reverse order',()=>{
 const raw=initial();raw.state.settings.slots=['dinner','lunch'];raw.preferences.slots=['dinner','lunch'];
 const snapshot=createSharedSnapshot(raw.state,raw.preferences);
 assert.deepEqual(snapshot.state.settings.slots,['lunch','dinner']);
 assert.deepEqual(snapshot.preferences.slots,['lunch','dinner']);
 const nextWeek=generatePlan({...snapshot.state.settings,startDate:addDays(snapshot.state.settings.startDate,7)},snapshot.state.inventory);
 for(const day of nextWeek.days)assert.deepEqual(day.meals.map(meal=>meal.slot),['lunch','dinner']);
 assert.equal(hasMutation(createMutation(initial(),snapshot)),false,'ordering correction alone does not create a shared edit');
});
