import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES,INGREDIENTS,DEFAULT_SETTINGS,generatePlan,getEligibleRecipes,getReplacementOptions,replaceMeal,recipeById,aggregateShopping,setPlanAppetite} from '../engine.js';
const meals=plan=>plan.days.flatMap(day=>day.meals);
const settings={...structuredClone(DEFAULT_SETTINGS),startDate:'2026-11-02'};
const byId=new Map(INGREDIENTS.map(i=>[i.id,i]));

test('expanded catalog contains distinct complete recipes with honest provenance and known ingredients',()=>{
 assert.equal(RECIPES.length,81);
 assert.equal(new Set(RECIPES.map(r=>r.id)).size,81);
 assert.equal(new Set(RECIPES.map(r=>r.title)).size,81);
 for(const r of RECIPES){
  assert.equal(r.source.kind,'ai-curated');assert.match(r.source.label,/AI/);
  assert.ok(!r.source.url,'no invented external attribution');
  assert.ok(r.steps.length>=3&&r.steps.every(s=>typeof s==='string'&&s.length>10));
  assert.ok(r.minutes<=60&&r.minutes>0);
  assert.equal(new Set(r.ingredients.map(i=>i.ingredientId)).size,r.ingredients.length);
  for(const i of r.ingredients){assert.ok(byId.has(i.ingredientId),`${r.id}: ${i.ingredientId}`);assert.ok(i.quantity>0&&Number.isFinite(i.quantity));}
  if(r.starch==='pasta')assert.ok(r.ingredients.some(i=>i.ingredientId==='pasta'));
  if(r.starch==='rice')assert.ok(r.ingredients.some(i=>i.ingredientId==='rice'));
 }
 for(const id of ['lemon-chicken','shrimp-egg','rice-beef','pasta-mushroom'])assert.ok(recipeById(id),'existing saved meal IDs remain available');
});

test('default exclusions still apply while every main-meal category has many more choices',()=>{
 const eligible=getEligibleRecipes(settings);
 assert.equal(eligible.length,73);
 assert.deepEqual(Object.fromEntries(['low','rice','pasta'].map(type=>[type,eligible.filter(r=>r.starch===type).length])),{low:38,rice:17,pasta:18});
 for(const r of eligible)for(const word of settings.avoid)assert.ok(![r.title,r.protein,...r.ingredients.map(i=>byId.get(i.ingredientId).name)].some(s=>s.includes(word)),`${r.id}: ${word}`);
 assert.equal(eligible.filter(r=>r.id.startsWith('it-')||r.id.startsWith('we-')||r.id.startsWith('hm-')).length,54);
 assert.ok(getEligibleRecipes({...settings,avoid:[...settings.avoid,'干貝','起司','明太子']}).every(r=>r.ingredients.every(i=>!['scallop','parmesan','mozzarella','cheese','blue-cheese','cheddar','mentaiko'].includes(i.ingredientId))));
});

test('the larger picker traverses every allowed alternative before repeating for all meal categories',()=>{
 for(const type of ['low','rice','pasta']){
  let plan=generatePlan(settings,[]);const target=meals(plan).find(m=>recipeById(m.recipeId).starch===type);
  const population=getEligibleRecipes(settings).filter(r=>r.starch===type),seen=new Set([target.recipeId]);
  assert.equal(getReplacementOptions(plan,target.key,settings,[]).length,population.length-1);
  for(let n=1;n<population.length;n++){plan=replaceMeal(plan,target.key,settings,[]);const id=meals(plan).find(m=>m.key===target.key).recipeId;assert.ok(!seen.has(id));seen.add(id);}
  assert.equal(seen.size,population.length);
 }
});

test('new dishes retain the 70 percent option and pantry deduction for every added ingredient',()=>{
 const round=n=>Math.round((n+Number.EPSILON)*100)/100;
 for(const r of RECIPES.filter(r=>/^(it|we|hm)-/.test(r.id))){
  const plan={days:[{meals:[{key:'one',recipeId:r.id,servings:2}]}]};
  const small=setPlanAppetite(plan,'small');
  const inventory=r.ingredients.map(i=>({ingredientId:i.ingredientId,quantity:i.quantity*0.2}));
  const normal=new Map(aggregateShopping(plan).map(row=>[row.ingredientId,row.required]));
  for(const row of aggregateShopping(small,inventory)){assert.equal(row.required,round(normal.get(row.ingredientId)*0.7));assert.equal(row.toBuy,round(Math.max(0,row.required-row.stock)));}
 }
});
