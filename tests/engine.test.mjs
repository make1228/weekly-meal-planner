import test from 'node:test';
import assert from 'node:assert/strict';
import {INGREDIENTS, RECIPES, DEFAULT_SETTINGS, recipeById, generatePlan, replaceMeal, aggregateShopping, getMonday, addDays, formatQty} from '../engine.js';
import {legacySettings} from './fixtures.mjs';

const settings = legacySettings;
const flatten = plan => plan.days.flatMap(day => day.meals);
const round = number => Math.round((number + Number.EPSILON) * 100) / 100;
const byId = new Map(INGREDIENTS.map(item => [item.id,item]));
function requirementOracle(plan) {
  const amounts = new Map();
  for(const meal of flatten(plan)) {
    const recipe = recipeById(meal.recipeId);
    for(const item of recipe.ingredients) amounts.set(item.ingredientId,(amounts.get(item.ingredientId)||0) + item.quantity*meal.servings/recipe.baseServings);
  }
  return new Map([...amounts].map(([id,amount])=>[id,round(amount)]));
}
function assertShoppingMatches(plan, inventory=[]) {
  const expected = requirementOracle(plan);
  const stock = new Map();
  for(const item of inventory) stock.set(item.ingredientId,(stock.get(item.ingredientId)||0) + item.quantity);
  const actual = aggregateShopping(plan, inventory);
  assert.equal(new Set(actual.map(row=>row.ingredientId)).size, actual.length, 'one line per ingredient');
  assert.equal(actual.length, expected.size);
  for(const row of actual) {
    assert.equal(row.required, expected.get(row.ingredientId), `${row.name} scaled demand`);
    const available = round(stock.get(row.ingredientId)||0);
    assert.equal(row.usedStock, round(Math.min(row.required,available)), `${row.name} consumed stock`);
    assert.equal(row.toBuy, round(Math.max(0,row.required-available)), `${row.name} remainder`);
    assert.equal(row.unit, byId.get(row.ingredientId).unit);
    assert.ok(row.toBuy>=0 && row.usedStock>=0);
  }
  return actual;
}
function repeatedRecipePlan(recipe, servings=[2,3]) {
  return {startDate:'2026-10-26',generatedAt:new Date().toISOString(),days:servings.map((count,index)=> {
    const date=addDays('2026-10-26',index);
    return {date,weekday:index+1,dayLabel:`週${index+1}`,meals:[{key:`${date}-dinner`,date,slot:'dinner',recipeId:recipe.id,servings:count}]};
  })};
}

test('recipe catalog uses canonical units, consistent quantities and complete cooking instructions',()=>{
  assert.ok(RECIPES.length>=24);
  assert.equal(new Set(INGREDIENTS.map(item=>item.id)).size,INGREDIENTS.length);
  assert.equal(new Set(RECIPES.map(item=>item.id)).size,RECIPES.length);
  for(const recipe of RECIPES) {
    assert.equal(recipe.baseServings,2);
    assert.ok(recipe.title && recipe.cuisine && recipe.protein && recipe.equipment);
    assert.ok(recipe.minutes>0 && recipe.steps.length>=3);
    assert.ok(recipe.ingredients.length>=2);
    for(const item of recipe.ingredients) {
      assert.ok(byId.has(item.ingredientId),`unknown ingredient ${item.ingredientId}`);
      assert.ok(Number.isFinite(item.quantity) && item.quantity>0);
    }
  }
});

test('seven configured dinners honor different weekday and weekend serving counts and weekly starch targets',()=>{
  const plan=generatePlan(settings({weekdayPeople:2,weekendPeople:5}),[]);
  assert.equal(plan.days.length,7);
  assert.deepEqual(plan.days.map(day=>day.date),Array.from({length:7},(_,i)=>addDays('2026-10-26',i)));
  const meals=flatten(plan);
  assert.equal(meals.length,7);
  assert.equal(new Set(meals.map(meal=>meal.key)).size,7);
  for(const [index,day] of plan.days.entries()) {
    assert.equal(day.meals.length,1);
    assert.equal(day.meals[0].slot,'dinner');
    assert.equal(day.meals[0].servings,index<5?2:5);
  }
  assert.equal(meals.filter(meal=>recipeById(meal.recipeId).starch==='rice').length,2);
  assert.equal(meals.filter(meal=>recipeById(meal.recipeId).starch==='pasta').length,1);
  assertShoppingMatches(plan);
});

test('lunch and dinner generates 14 keyed meals with independent servings',()=>{
  const plan=generatePlan(settings({slots:['lunch','dinner'],weekdayPeople:1,weekendPeople:4}),[]);
  assert.equal(flatten(plan).length,14);
  assert.equal(new Set(flatten(plan).map(meal=>meal.key)).size,14);
  for(const [index,day] of plan.days.entries()) {
    assert.deepEqual(day.meals.map(meal=>meal.slot).sort(),['dinner','lunch']);
    assert.ok(day.meals.every(meal=>meal.servings===(index<5?1:4)));
  }
  assertShoppingMatches(plan);
});

test('Wednesday replacement preserves other six meals and recalculates every grocery quantity',()=>{
  const prefs=settings();
  const plan=generatePlan(prefs,[]);
  const original=structuredClone(plan);
  const target=plan.days[2].meals[0];
  const next=replaceMeal(plan,target.key,prefs,[]);
  assert.deepEqual(plan,original,'input plan must not mutate');
  assert.notEqual(next.days[2].meals[0].recipeId,target.recipeId);
  assert.equal(next.days[2].meals[0].key,target.key);
  assert.equal(next.days[2].meals[0].servings,target.servings);
  for(let index=0;index<7;index++) if(index!==2) assert.deepEqual(next.days[index],original.days[index]);
  const prior=requirementOracle(plan);
  const after=assertShoppingMatches(next);
  assert.ok(after.some(row=>row.required!==(prior.get(row.ingredientId)||0)) || prior.size!==after.length,'recipe change must affect groceries');
});

test('inventory is deducted once after shared ingredients are merged; duplicate pantry rows combine',()=>{
  const recipe=RECIPES.find(item=>item.ingredients.some(ingredient=>byId.get(ingredient.ingredientId).unit==='g'));
  const ingredient=recipe.ingredients.find(item=>byId.get(item.ingredientId).unit==='g');
  const plan=repeatedRecipePlan(recipe,[2,3]);
  const inventory=[{ingredientId:ingredient.ingredientId,quantity:10.25},{ingredientId:ingredient.ingredientId,quantity:20.5}];
  const row=assertShoppingMatches(plan,inventory).find(row=>row.ingredientId===ingredient.ingredientId);
  assert.equal(row.required,round(ingredient.quantity*2.5));
  assert.equal(row.usedStock,30.75);
  assert.equal(row.mealKeys.length,2);
  const allStock=assertShoppingMatches(plan,[{ingredientId:ingredient.ingredientId,quantity:100000}]).find(row=>row.ingredientId===ingredient.ingredientId);
  assert.equal(allStock.toBuy,0);
  assert.equal(allStock.usedStock,allStock.required);
});

test('fractional servings and canonical quantity calculations remain accurate without negatives',()=>{
  const recipe=RECIPES.find(item=>item.ingredients.some(ingredient=>ingredient.quantity%2!==0))||RECIPES[0];
  const plan=repeatedRecipePlan(recipe,[1,5]);
  const ingredient=recipe.ingredients[0];
  const rows=assertShoppingMatches(plan,[{ingredientId:ingredient.ingredientId,quantity:0.37}]);
  const row=rows.find(row=>row.ingredientId===ingredient.ingredientId);
  assert.equal(row.required,round(ingredient.quantity*3));
  assert.equal(row.toBuy,round(Math.max(0,ingredient.quantity*3-0.37)));
  for(const item of rows) assert.equal(round(item.usedStock+item.toBuy),item.required);
});

test('exclusions and preparation-time ceiling apply to all suggested recipes',()=>{
  const prefs=settings({avoid:[...DEFAULT_SETTINGS.avoid,'牛肉','羊肉','鮭魚'],maxMinutes:25,riceMeals:0,pastaMeals:0});
  const plan=generatePlan(prefs,[]);
  for(const meal of flatten(plan)) {
    const recipe=recipeById(meal.recipeId);
    const haystack=[recipe.title,...recipe.ingredients.map(item=>byId.get(item.ingredientId).name)].join(' ');
    assert.ok(recipe.minutes<=25);
    for(const avoid of prefs.avoid) assert.ok(!haystack.includes(avoid),`excluded ${avoid} found in ${recipe.title}`);
  }
});

test('unsatisfiable constraints and invalid inputs produce explicit errors',()=>{
  assert.throws(()=>generatePlan(settings({avoid:INGREDIENTS.map(item=>item.name)}),[]));
  assert.throws(()=>generatePlan(settings({maxMinutes:1}),[]));
  assert.throws(()=>generatePlan(settings({weekdayPeople:0}),[]));
  assert.throws(()=>generatePlan(settings({slots:[]}),[]));
  assert.throws(()=>generatePlan(settings({startDate:'2026-02-30'}),[]));
  const plan=generatePlan(settings(),[]);
  assert.throws(()=>replaceMeal(plan,'missing-key',settings(),[]));
  assert.throws(()=>aggregateShopping(plan,[{ingredientId:INGREDIENTS[0].id,quantity:-1}]));
});

test('calendar helpers retain civil dates across month/year boundaries and timezone offsets',()=>{
  assert.equal(getMonday('2026-10-28'),'2026-10-26');
  assert.equal(getMonday('2026-11-01'),'2026-10-26');
  assert.equal(addDays('2026-12-31',1),'2027-01-01');
  assert.equal(addDays('2028-02-28',1),'2028-02-29');
  const previous=process.env.TZ;
  try {
    for(const timezone of ['Asia/Taipei','America/Los_Angeles','Pacific/Kiritimati']) {
      process.env.TZ=timezone;
      assert.equal(getMonday('2026-10-28'),'2026-10-26');
      assert.equal(addDays('2026-10-31',1),'2026-11-01');
    }
  } finally { if(previous===undefined) delete process.env.TZ; else process.env.TZ=previous; }
});

test('planner and grocery aggregation leave settings and inventory unchanged',()=>{
  const prefs=settings();
  const inventory=[{ingredientId:INGREDIENTS[0].id,quantity:100}];
  const prefsBefore=structuredClone(prefs), inventoryBefore=structuredClone(inventory);
  const plan=generatePlan(prefs,inventory);
  aggregateShopping(plan,inventory);
  assert.deepEqual(prefs,prefsBefore);
  assert.deepEqual(inventory,inventoryBefore);
});

test('fractional eggs, cans and portions stay exact in recipe quantity display and merged demand',()=>{
  assert.equal(formatQty(1.5,'顆'),'1.5');
  assert.equal(formatQty(0.5,'罐'),'0.5');
  assert.equal(formatQty(0.5,'份'),'0.5');
  const recipe=recipeById('tofu-edamame');
  const plan=repeatedRecipePlan(recipe,[1,1]);
  const rows=assertShoppingMatches(plan);
  assert.equal(rows.find(row=>row.ingredientId==='egg').required,3);
});
