import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,INGREDIENTS,RECIPES,generatePlan,recipeById,getReplacementOptions,replaceMeal,aggregateShopping} from '../engine.js';

const preferences=(patch={})=>({...structuredClone(DEFAULT_SETTINGS),startDate:'2026-10-26',...patch});
const meals=plan=>plan.days.flatMap(day=>day.meals);
const byId=new Map(INGREDIENTS.map(item=>[item.id,item]));
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const targetOf=(plan,key)=>meals(plan).find(meal=>meal.key===key);

function eligibleFor(settings,starch){
  return RECIPES.filter(recipe=>recipe.starch===starch&&recipe.minutes<=settings.maxMinutes&&!settings.avoid.some(word=>[
    recipe.title,recipe.protein,...recipe.ingredients.map(item=>byId.get(item.ingredientId).name)
  ].some(text=>text.includes(word))));
}
function groceryOracle(plan,inventory){
  const totals=new Map(),stock=new Map();
  for(const row of inventory)stock.set(row.ingredientId,(stock.get(row.ingredientId)||0)+row.quantity);
  for(const meal of meals(plan)){
    const recipe=recipeById(meal.recipeId);
    for(const item of recipe.ingredients)totals.set(item.ingredientId,(totals.get(item.ingredientId)||0)+item.quantity*meal.servings/recipe.baseServings);
  }
  return [...totals].map(([id,qty])=>({ingredientId:id,required:round(qty),toBuy:round(Math.max(0,round(qty)-round(stock.get(id)||0)))})).sort((a,b)=>a.ingredientId.localeCompare(b.ingredientId));
}

test('replacement picker exposes every eligible alternative for low-starch, rice and pasta meals',()=>{
  const settings=preferences(),plan=generatePlan(settings,[]),snapshot=structuredClone(plan);
  for(const starch of ['low','rice','pasta']){
    const target=meals(plan).find(meal=>recipeById(meal.recipeId).starch===starch);
    const options=getReplacementOptions(plan,target.key,settings,[]);
    const expected=eligibleFor(settings,starch).filter(recipe=>recipe.id!==target.recipeId).map(recipe=>recipe.id).sort();
    assert.deepEqual(options.map(recipe=>recipe.id).sort(),expected);
    assert.equal(new Set(options.map(recipe=>recipe.id)).size,options.length);
    assert.ok(options.length>=(starch==='low'?10:3));
    assert.deepEqual(options.map(recipe=>recipe.id),getReplacementOptions(plan,target.key,settings,[]).map(recipe=>recipe.id),'same inputs keep ranking stable');
  }
  assert.deepEqual(plan,snapshot,'showing options must not modify menu');
});

test('automatic swaps traverse all candidates before repeating, despite favored recipes and occupied meals',()=>{
  const settings=preferences({feedback:Object.fromEntries(RECIPES.filter(recipe=>recipe.cuisine==='西式').map(recipe=>[recipe.id,{liked:true}]))});
  let plan=generatePlan(settings,[]);
  const target=meals(plan).find(meal=>recipeById(meal.recipeId).starch==='low'),original=target.recipeId;
  const population=eligibleFor(settings,'low'),seen=new Set([original]);
  assert.ok(population.length>10,'exercise more than ten consecutive changes');
  for(let index=1;index<population.length;index++){
    const before=structuredClone(plan),prior=targetOf(plan,target.key).recipeId;
    plan=replaceMeal(plan,target.key,settings,[]);
    const next=targetOf(plan,target.key);
    assert.notEqual(next.recipeId,prior);
    assert.ok(!seen.has(next.recipeId),`swap ${index} repeated ${next.recipeId} before exhausting candidates`);
    seen.add(next.recipeId);
    for(const meal of meals(before))if(meal.key!==target.key)assert.deepEqual(targetOf(plan,meal.key),meal,'other meals stay fixed');
    assert.equal(next.servings,target.servings);
  }
  assert.equal(seen.size,population.length);
  for(let index=0;index<population.length*2;index++){
    const previous=targetOf(plan,target.key).recipeId;
    plan=replaceMeal(plan,target.key,settings,[]);
    assert.notEqual(targetOf(plan,target.key).recipeId,previous,'exhaustion starts another usable cycle');
  }
});

test('rice and pasta automatic cycles remain reusable after every eligible recipe has been visited',()=>{
  const settings=preferences();
  for(const starch of ['rice','pasta']){
    let plan=generatePlan(settings,[]);
    const target=meals(plan).find(meal=>recipeById(meal.recipeId).starch===starch);
    const seen=new Set([target.recipeId]),population=eligibleFor(settings,starch);
    for(let i=1;i<population.length;i++){
      plan=replaceMeal(plan,target.key,settings,[]);
      const id=targetOf(plan,target.key).recipeId;
      assert.ok(!seen.has(id));seen.add(id);
    }
    assert.equal(seen.size,population.length);
    for(let i=0;i<10;i++){
      const before=targetOf(plan,target.key).recipeId;
      plan=replaceMeal(plan,target.key,settings,[]);
      assert.notEqual(targetOf(plan,target.key).recipeId,before);
      assert.equal(recipeById(targetOf(plan,target.key).recipeId).starch,starch);
    }
  }
});

test('picker and automatic cycles honor exclusions and time ceiling for every successive choice',()=>{
  const settings=preferences({maxMinutes:20,riceMeals:0,pastaMeals:0,avoid:[...DEFAULT_SETTINGS.avoid,'牛肉','羊肉','蝦仁','鮪魚']});
  let plan=generatePlan(settings,[]);
  const key=plan.days[2].meals[0].key,population=eligibleFor(settings,'low');
  assert.ok(population.length>1);
  for(let i=0;i<population.length*3;i++){
    const current=targetOf(plan,key).recipeId,options=getReplacementOptions(plan,key,settings,[]);
    assert.deepEqual(options.map(recipe=>recipe.id).sort(),population.filter(recipe=>recipe.id!==current).map(recipe=>recipe.id).sort());
    plan=replaceMeal(plan,key,settings,[]);
    assert.ok(population.some(recipe=>recipe.id===targetOf(plan,key).recipeId));
  }
});

test('explicit picker choice changes only target and grocery totals follow exact scaled recipe quantities',()=>{
  const settings=preferences({weekdayPeople:3,weekendPeople:5}),inventory=[{ingredientId:'broccoli',quantity:350.5},{ingredientId:'garlic',quantity:20}];
  const plan=generatePlan(settings,inventory),before=structuredClone(plan),target=plan.days[2].meals[0];
  const options=getReplacementOptions(plan,target.key,settings,inventory),choice=options.at(-1);
  const next=replaceMeal(plan,target.key,settings,inventory,choice.id);
  assert.equal(targetOf(next,target.key).recipeId,choice.id,'use the selected dish, regardless of ranking');
  assert.deepEqual(plan,before,'choice does not mutate original');
  for(const meal of meals(before))if(meal.key!==target.key)assert.deepEqual(targetOf(next,meal.key),meal);
  assert.equal(targetOf(next,target.key).servings,target.servings);
  const actual=aggregateShopping(next,inventory).map(({ingredientId,required,toBuy})=>({ingredientId,required,toBuy})).sort((a,b)=>a.ingredientId.localeCompare(b.ingredientId));
  assert.deepEqual(actual,groceryOracle(next,inventory));
  const restored=replaceMeal(next,target.key,settings,inventory,target.recipeId);
  assert.equal(targetOf(restored,target.key).recipeId,target.recipeId,'explicit choice can revisit a previously seen dish');
});

test('explicit unavailable, current, other starch and forbidden choices reject without mutation',()=>{
  const settings=preferences(),plan=generatePlan(settings,[]),target=meals(plan).find(meal=>recipeById(meal.recipeId).starch==='low'),before=structuredClone(plan);
  assert.throws(()=>replaceMeal(plan,target.key,settings,[],'missing-recipe'));
  assert.throws(()=>replaceMeal(plan,target.key,settings,[],target.recipeId));
  assert.throws(()=>replaceMeal(plan,target.key,settings,[],'rice-chicken'));
  const candidate=getReplacementOptions(plan,target.key,settings,[])[0];
  assert.throws(()=>replaceMeal(plan,target.key,{...settings,avoid:[...settings.avoid,candidate.title]},[],candidate.id));
  assert.throws(()=>getReplacementOptions(plan,'missing-key',settings,[]));
  assert.deepEqual(plan,before);
});

test('legacy and malformed replacement histories cannot break repeated swaps or leak invalid ids',()=>{
  const settings=preferences(),base=generatePlan(settings,[]),target=meals(base).find(meal=>recipeById(meal.recipeId).starch==='low');
  for(const history of [undefined,null,{},'garlic-shrimp',[null,{},'not-a-recipe','rice-chicken',target.recipeId,target.recipeId]]){
    const plan=structuredClone(base);targetOf(plan,target.key).replacementHistory=history;
    const next=replaceMeal(plan,target.key,settings,[]),meal=targetOf(next,target.key);
    assert.notEqual(meal.recipeId,target.recipeId);
    assert.ok(Array.isArray(meal.replacementHistory));
    assert.equal(new Set(meal.replacementHistory).size,meal.replacementHistory.length);
    for(const id of meal.replacementHistory)assert.equal(recipeById(id)?.starch,'low');
  }
});

test('a genuinely exhausted filter yields an empty picker and an explicit quick-swap error',()=>{
  const settings=preferences(),plan=generatePlan(settings,[]),target=meals(plan).find(meal=>recipeById(meal.recipeId).starch==='low');
  const isolated={...settings,avoid:RECIPES.filter(recipe=>recipe.id!==target.recipeId).map(recipe=>recipe.title)};
  assert.deepEqual(getReplacementOptions(plan,target.key,isolated,[]),[]);
  assert.throws(()=>replaceMeal(plan,target.key,isolated,[]),/沒有同類型/);
});

test('auto-pick remains inside the active filtered subset through repeated cycles',()=>{
  const settings=preferences(),initial=generatePlan(settings,[]),target=meals(initial).find(meal=>recipeById(meal.recipeId).starch==='low');
  const subset=getReplacementOptions(initial,target.key,settings,[]).slice(-3).map(recipe=>recipe.id);
  const seen=new Set();let plan=initial;
  for(let index=0;index<30;index++){
    const previous=targetOf(plan,target.key).recipeId;
    plan=replaceMeal(plan,target.key,settings,[],undefined,subset);
    const id=targetOf(plan,target.key).recipeId;
    assert.ok(subset.includes(id),`filtered auto-pick escaped to ${id}`);
    assert.notEqual(id,previous);
    if(index<subset.length){assert.ok(!seen.has(id),'traverse active subset before repeating');seen.add(id);}
  }
  assert.equal(seen.size,subset.length);
});

test('empty, malformed and disallowed filtered selections fail without modifying the menu',()=>{
  const settings=preferences(),plan=generatePlan(settings,[]),target=meals(plan).find(meal=>recipeById(meal.recipeId).starch==='low'),before=structuredClone(plan);
  const options=getReplacementOptions(plan,target.key,settings,[]),allowed=options.slice(0,2).map(recipe=>recipe.id),outside=options[2].id;
  for(const invalid of [[],null,{},'not-an-array',[null],[{}]])assert.throws(()=>replaceMeal(plan,target.key,settings,[],undefined,invalid));
  assert.throws(()=>replaceMeal(plan,target.key,settings,[],outside,allowed));
  assert.throws(()=>replaceMeal(plan,target.key,settings,[],undefined,[target.recipeId]));
  assert.throws(()=>replaceMeal(plan,target.key,settings,[],undefined,['not-a-recipe']));
  assert.deepEqual(plan,before);
});

test('active filters can narrow eligible dishes but cannot bypass dietary, timing or starch constraints',()=>{
  const settings=preferences(),plan=generatePlan(settings,[]),target=meals(plan).find(meal=>recipeById(meal.recipeId).starch==='low');
  const options=getReplacementOptions(plan,target.key,settings,[]),candidate=options[0],allowed=options[1].id;
  assert.throws(()=>replaceMeal(plan,target.key,{...settings,avoid:[...settings.avoid,candidate.title]},[],undefined,[candidate.id]));
  assert.throws(()=>replaceMeal(plan,target.key,{...settings,maxMinutes:5},[],undefined,[candidate.id]));
  assert.throws(()=>replaceMeal(plan,target.key,settings,[],undefined,['rice-chicken']));
  const next=replaceMeal(plan,target.key,settings,[],undefined,['not-a-recipe','rice-chicken',allowed]);
  assert.equal(targetOf(next,target.key).recipeId,allowed,'invalid and cross-starch IDs never enter the choice pool');
});
