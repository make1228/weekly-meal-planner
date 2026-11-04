import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,RECIPES,generatePlan,aggregateShopping,replaceMeal,setMealCooked,setPlanAppetite,setPlanDiners,equivalentServings,mealDiners,mealPortionFactor,mealIngredientQuantity} from '../engine.js';
import {settingsToDraft,restoreDraft,draftToSettings,draftMatchesSettings} from '../preferences.js';
import {createSharedSnapshot,createMutation,hasMutation,applyMutation,validSharedPreferences,SyncConflictError} from '../sync-model.js';

const clone=value=>structuredClone(value);
const settings=extra=>({...clone(DEFAULT_SETTINGS),startDate:'2026-10-26',seed:19,...extra});
const meals=plan=>plan.days.flatMap(day=>day.meals);
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} should equal ${expected}`);
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
function snapshot(extra={}){const applied=settings(extra);return createSharedSnapshot({version:1,settings:applied,inventory:[],plan:generatePlan(applied),checked:{}},settingsToDraft(applied));}

test('two adults and one child use 2.7 adult portions, then small appetite uses 1.89 without changing headcounts',()=>{
 assert.equal(DEFAULT_SETTINGS.weekdayChildren,0);assert.equal(DEFAULT_SETTINGS.weekendChildren,0);
 assert.equal(equivalentServings(2,1),2.7);
 const normal=generatePlan(settings({weekdayChildren:1,weekendChildren:1}));
 const small=generatePlan(settings({weekdayChildren:1,weekendChildren:1,appetite:'small'}));
 assert.deepEqual(meals(normal).map(meal=>meal.recipeId),meals(small).map(meal=>meal.recipeId));
 for(const meal of meals(small)){
  assert.equal(meal.servings,2.7);assert.deepEqual(mealDiners(meal),{adults:2,children:1});
  near(meal.servings*mealPortionFactor(meal),1.89);
  const recipe=RECIPES.find(recipe=>recipe.id===meal.recipeId);
  for(const item of recipe.ingredients)near(mealIngredientQuantity(meal,item),item.quantity/recipe.baseServings*1.89);
 }
 for(const meal of meals(normal)){assert.equal(mealPortionFactor(meal),1);assert.deepEqual(mealDiners(meal),{adults:2,children:1});}
});

test('weekday and weekend headcounts are independent and child-only groups are supported',()=>{
 const plan=generatePlan(settings({weekdayPeople:0,weekdayChildren:1,weekendPeople:3,weekendChildren:2}));
 for(const day of plan.days)for(const meal of day.meals){
  assert.deepEqual(mealDiners(meal),day.weekday>=6?{adults:3,children:2}:{adults:0,children:1});
  assert.equal(meal.servings,day.weekday>=6?4.4:0.7);
 }
 const maximum=generatePlan(settings({weekdayPeople:12,weekdayChildren:12,weekendPeople:0,weekendChildren:12}));
 assert.equal(maximum.days[0].meals[0].servings,20.4);assert.equal(maximum.days[6].meals[0].servings,8.4);
 for(const prefix of ['weekday','weekend'])assert.throws(()=>generatePlan(settings({[`${prefix}People`]:0,[`${prefix}Children`]:0})),/至少/);
 for(const value of [-1,13,0.5,Infinity,NaN])for(const key of ['weekdayPeople','weekendPeople','weekdayChildren','weekendChildren'])assert.throws(()=>generatePlan(settings({[key]:value})),/整數/);
 for(const value of [null,'1',-1,13,0.5,Infinity,NaN])assert.throws(()=>equivalentServings(value,1),/整數/);
 assert.throws(()=>equivalentServings(0,0),/至少/);
});

test('updating family portions preserves the menu, cooked flags and history without compounding appetite',()=>{
 let original=generatePlan(settings());const first=meals(original)[0];
 original=setMealCooked(original,first.key,true);original.days[0].meals[0].replacementHistory=[first.recipeId];original.generationId='same-menu';
 const untouched=clone(original),family=settings({weekdayPeople:2,weekdayChildren:1,weekendPeople:0,weekendChildren:2,appetite:'small'});
 const updated=setPlanDiners(original,family);
 assert.deepEqual(original,untouched);assert.equal(updated.generationId,'same-menu');
 for(const [index,meal] of meals(updated).entries()){
  const old=meals(original)[index];assert.equal(meal.recipeId,old.recipeId);assert.equal(meal.cooked,old.cooked);assert.deepEqual(meal.replacementHistory,old.replacementHistory);
  assert.equal(meal.portionFactor,0.7);assert.equal(meal.servings,index>=10?1.4:2.7);
 }
 assert.deepEqual(setPlanDiners(updated,family),updated,'repeated edits must not multiply the child or small factor again');
 const normal=setPlanAppetite(updated,'normal');assert.deepEqual(meals(normal).map(mealDiners),meals(updated).map(mealDiners));
 assert.deepEqual(setPlanDiners(updated,settings()),original,'returning to the original headcounts restores legacy meal shapes');
 let swapped=setMealCooked(updated,first.key,false);
 for(let index=0;index<4;index++){
  swapped=replaceMeal(swapped,first.key,family);
  const meal=meals(swapped).find(meal=>meal.key===first.key);
  assert.deepEqual(mealDiners(meal),{adults:2,children:1});assert.equal(meal.servings,2.7);assert.equal(meal.portionFactor,0.7);
 }
});

test('legacy weekday metadata cannot change weekday and weekend portions in a saved seven-day menu',()=>{
 const original=generatePlan(settings());
 original.days.forEach((day,index)=>{day.weekday=index<5?7:1;});
 const before=clone(original),family=settings({weekdayPeople:2,weekdayChildren:1,weekendPeople:0,weekendChildren:2,appetite:'small'});
 const updated=setPlanDiners(original,family);
 assert.deepEqual(original,before);
 updated.days.forEach((day,index)=>{
  assert.equal(day.weekday,original.days[index].weekday,'legacy metadata is preserved without controlling portions');
  for(const meal of day.meals){assert.deepEqual(mealDiners(meal),index>=5?{adults:0,children:2}:{adults:2,children:1});assert.equal(meal.servings,index>=5?1.4:2.7);assert.equal(mealPortionFactor(meal),0.7);}
 });
});

test('family ingredient demand merges before actual pantry stock is deducted once and cooked meals are excluded',()=>{
 const recipe=RECIPES.find(recipe=>recipe.id==='lemon-chicken'),ingredient=recipe.ingredients.find(item=>item.ingredientId==='chicken');
 const plan={startDate:'2026-10-26',days:[1,2].map(weekday=>({weekday,meals:[{key:`meal-${weekday}`,recipeId:recipe.id,servings:2.7,adults:2,children:1,portionFactor:0.7}]}))};
 const stock=[{ingredientId:'chicken',quantity:60},{ingredientId:'chicken',quantity:40}],before=clone(plan);
 const expected=round(ingredient.quantity/recipe.baseServings*1.89*2),row=aggregateShopping(plan,stock).find(row=>row.ingredientId==='chicken');
 assert.equal(row.required,expected);assert.equal(row.stock,100);assert.equal(row.usedStock,100);assert.equal(row.toBuy,round(expected-100));
 const cooked=setMealCooked(plan,'meal-1',true),remaining=aggregateShopping(cooked,stock).find(row=>row.ingredientId==='chicken');
 assert.equal(remaining.required,round(ingredient.quantity/recipe.baseServings*1.89));assert.equal(remaining.toBuy,round(remaining.required-100));
 assert.deepEqual(aggregateShopping(setMealCooked(cooked,'meal-1',false),stock),aggregateShopping(plan,stock));
 assert.deepEqual(plan,before);assert.equal(stock[0].quantity,60);assert.equal(stock[1].quantity,40);
});

test('inconsistent diner metadata is rejected while legacy fractional servings remain usable',()=>{
 const recipe=RECIPES[0],item=recipe.ingredients[0],legacy={key:'one',recipeId:recipe.id,servings:1.5};
 assert.deepEqual(mealDiners(legacy),{adults:1.5,children:0});near(mealIngredientQuantity(legacy,item),item.quantity*1.5/recipe.baseServings);
 for(const malformed of [{adults:2},{children:1},{adults:2,children:1},{adults:0,children:0},{adults:'1',children:1},{adults:1,children:-1}]){
  const meal={...legacy,...malformed};assert.throws(()=>mealIngredientQuantity(meal,item),/人數|份量|整數|至少/);
  assert.throws(()=>aggregateShopping({days:[{meals:[meal]}]}),/人數|份量|整數|至少/);
 }
 const legacySettings=settings();delete legacySettings.weekdayChildren;delete legacySettings.weekendChildren;
 const plan=generatePlan(legacySettings);assert.ok(meals(plan).every(meal=>!Object.hasOwn(meal,'adults')&&!Object.hasOwn(meal,'children')));
});

test('child settings and unfinished drafts persist with v2 while older backups default to no children',()=>{
 const applied=settings({weekdayChildren:1,weekendChildren:2}),draft=settingsToDraft(applied);
 assert.equal(draft.weekdayChildren,'1');assert.equal(draft.weekendChildren,'2');assert.equal(draftMatchesSettings(draft,applied),true);
 const unfinished={...draft,weekdayChildren:'',weekendChildren:'1.5'};
 const restored=restoreDraft(JSON.parse(JSON.stringify({version:2,draft:unfinished})),applied,DEFAULT_SETTINGS);
 assert.equal(restored.weekdayChildren,'');assert.equal(restored.weekendChildren,'1.5');assert.equal(draftMatchesSettings(restored,applied),false);
 assert.throws(()=>generatePlan(draftToSettings(restored,applied)),/整數/);
 const legacySettings=settings(),legacyDraft=settingsToDraft(legacySettings);
 delete legacySettings.weekdayChildren;delete legacySettings.weekendChildren;delete legacyDraft.weekdayChildren;delete legacyDraft.weekendChildren;
 const migrated=restoreDraft({version:2,draft:legacyDraft},legacySettings,DEFAULT_SETTINGS);
 assert.equal(migrated.weekdayChildren,'0');assert.equal(migrated.weekendChildren,'0');assert.equal(draftMatchesSettings(migrated,legacySettings),true);
 assert.equal(draftToSettings(legacyDraft,applied).weekdayChildren,1,'an older partial draft does not reset an already applied child count');
});

test('shared drafts accept child-only groups and keep incomplete empty households local',()=>{
 const previous={weekdayPeople:'2',weekdayChildren:'1',weekendPeople:'1',weekendChildren:'0'};
 assert.deepEqual(validSharedPreferences({weekdayPeople:'0',weekdayChildren:'2'},previous),{...previous,weekdayPeople:'0',weekdayChildren:'2'});
 assert.deepEqual(validSharedPreferences({weekdayPeople:'0',weekdayChildren:'0'},previous),previous);
 assert.deepEqual(validSharedPreferences({weekendPeople:'0'},previous),previous);
 assert.deepEqual(validSharedPreferences({weekdayChildren:'',weekendChildren:'13'},previous),previous);
 const base=snapshot({weekdayChildren:1,weekendChildren:2}),next=clone(base);next.preferences.weekdayPeople='0';next.preferences.weekdayChildren='0';
 assert.equal(hasMutation(createMutation(base,next)),false,'invalid group changes must not change shared preferences or the applied menu');
});

test('legacy shared records canonicalize missing children without phantom edits and old partial clients cannot clear them',()=>{
 const legacy=snapshot();for(const key of ['weekdayChildren','weekendChildren']){delete legacy.state.settings[key];delete legacy.preferences[key];}
 const canonical=createSharedSnapshot(legacy.state,legacy.preferences);
 assert.equal(canonical.state.settings.weekdayChildren,0);assert.equal(canonical.preferences.weekendChildren,'0');
 assert.equal(hasMutation(createMutation(legacy,canonical)),false);assert.equal(hasMutation(createMutation(canonical,legacy)),false);
 const base=snapshot({weekdayChildren:1,weekendChildren:2,appetite:'small'}),partial=clone(base);
 partial.preferences={avoidText:base.preferences.avoidText+'、香菜'};
 const merged=applyMutation(base,createMutation(base,partial));
 assert.equal(merged.preferences.weekdayChildren,'1');assert.equal(merged.preferences.weekendChildren,'2');assert.equal(merged.preferences.appetite,'small');assert.match(merged.preferences.avoidText,/香菜/);
 assert.deepEqual(merged.state.plan,base.state.plan);
 for(const patch of [{weekdayPeople:0,weekdayChildren:0},{weekdayChildren:13},{weekendChildren:0.5}])assert.throws(()=>createSharedSnapshot({...base.state,settings:{...base.state.settings,...patch}},base.preferences),TypeError);
});

test('applying family portions synchronizes as one menu update and conflicts with unseen cooked edits',()=>{
 const base=snapshot(),next=clone(base),key=meals(base.state.plan)[0].key,row=aggregateShopping(base.state.plan).find(row=>row.toBuy>0);
 base.state.checked[row.ingredientId]=true;next.state.checked[row.ingredientId]=true;
 next.state.settings={...next.state.settings,weekdayChildren:1,weekendChildren:2,appetite:'small'};
 next.state.plan=setPlanDiners(next.state.plan,next.state.settings);next.preferences=settingsToDraft(next.state.settings);
 const mutation=createMutation(base,next),result=applyMutation(base,mutation);
 assert.ok(mutation.plan);assert.equal(result.state.settings.weekdayChildren,1);assert.equal(result.preferences.weekendChildren,'2');assert.equal(result.state.checked[row.ingredientId],undefined);
 assert.deepEqual(mealDiners(meals(result.state.plan)[0]),{adults:2,children:1});
 const other=clone(base);other.state.plan=setMealCooked(other.state.plan,key,true);
 assert.throws(()=>applyMutation(other,mutation),SyncConflictError);
});

test('concurrent headcount edits cannot merge into an empty weekday or weekend household and remain atomic',()=>{
 for(const prefix of ['weekday','weekend'])for(const reverse of [false,true]){
  const base=snapshot({weekdayPeople:1,weekdayChildren:1,weekendPeople:1,weekendChildren:1}),[firstMeal,secondMeal]=meals(base.state.plan),original=clone(base);
  const adultEdit=clone(base),childEdit=clone(base);
  adultEdit.preferences[`${prefix}People`]='0';adultEdit.preferences.avoidText+='、香菜';adultEdit.state.inventory.push({ingredientId:'egg',quantity:2});adultEdit.state.plan=setMealCooked(adultEdit.state.plan,firstMeal.key,true);
  childEdit.preferences[`${prefix}Children`]='0';childEdit.preferences.appetite='small';childEdit.state.inventory.push({ingredientId:'milk',quantity:100});childEdit.state.plan=setMealCooked(childEdit.state.plan,secondMeal.key,true);
  const operations=[createMutation(base,adultEdit),createMutation(base,childEdit)];if(reverse)operations.reverse();
  const latest=applyMutation(base,operations[0]),before=clone(latest);
  assert.throws(()=>applyMutation(latest,operations[1]),error=>error instanceof SyncConflictError&&error.paths.includes(`preferences.${prefix}People`)&&error.paths.includes(`preferences.${prefix}Children`));
  assert.deepEqual(latest,before,'rejected merge cannot mutate the saved snapshot, pantry, cooked flags or other preferences');assert.deepEqual(base,original);
  assert.equal(latest.preferences[`${prefix}People`],reverse?'1':'0');assert.equal(latest.preferences[`${prefix}Children`],reverse?'0':'1');
  assert.equal(latest.state.inventory.some(item=>item.ingredientId===(reverse?'egg':'milk')),false,'no inventory operation from the rejected mutation survives');
  assert.equal(meals(latest.state.plan).find(meal=>meal.key===(reverse?firstMeal:secondMeal).key).cooked,undefined,'no cooked operation from the rejected mutation survives');
  assert.equal(latest.preferences.appetite,reverse?'small':'normal');assert.equal(latest.preferences.avoidText.includes('香菜'),!reverse);
 }
});

test('valid concurrent edits to different headcounts still merge in either order with unrelated changes',()=>{
 const base=snapshot({weekdayPeople:1,weekdayChildren:1,weekendPeople:1,weekendChildren:1}),[firstMeal,secondMeal]=meals(base.state.plan);
 const adultEdit=clone(base),childEdit=clone(base);
 adultEdit.preferences.weekdayPeople='2';adultEdit.preferences.weekendPeople='0';adultEdit.state.inventory.push({ingredientId:'egg',quantity:2});adultEdit.state.plan=setMealCooked(adultEdit.state.plan,firstMeal.key,true);
 childEdit.preferences.weekdayChildren='3';childEdit.preferences.weekendChildren='2';childEdit.state.inventory.push({ingredientId:'milk',quantity:100});childEdit.state.plan=setMealCooked(childEdit.state.plan,secondMeal.key,true);
 const operations=[createMutation(base,adultEdit),createMutation(base,childEdit)];
 for(const [first,second] of [operations,[...operations].reverse()]){
  const merged=applyMutation(applyMutation(base,first),second);
  assert.equal(merged.preferences.weekdayPeople,'2');assert.equal(merged.preferences.weekdayChildren,'3');assert.equal(merged.preferences.weekendPeople,'0');assert.equal(merged.preferences.weekendChildren,'2');
  assert.equal(merged.state.inventory.find(item=>item.ingredientId==='egg').quantity,2);assert.equal(merged.state.inventory.find(item=>item.ingredientId==='milk').quantity,100);
  assert.equal(meals(merged.state.plan).find(meal=>meal.key===firstMeal.key).cooked,true);assert.equal(meals(merged.state.plan).find(meal=>meal.key===secondMeal.key).cooked,true);
 }
});
