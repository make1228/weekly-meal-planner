import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,INGREDIENTS,RECIPES,generatePlan,recipeById} from '../engine.js';

const ingredientNames = new Map(INGREDIENTS.map(item=>[item.id,item.name]));
const meals = plan=>plan.days.flatMap(day=>day.meals);

test('new product defaults match the requested meals, preparation time, cuisines and complete avoidance list',()=>{
  assert.deepEqual(DEFAULT_SETTINGS.slots,['lunch','dinner']);
  assert.equal(DEFAULT_SETTINGS.maxMinutes,60);
  assert.deepEqual(DEFAULT_SETTINGS.favorites,['義式','西式']);
  assert.deepEqual(DEFAULT_SETTINGS.avoid,['青椒','茄子','酪梨','照燒','番茄','豬肉','雞肉調理包']);
});

test('a fresh default plan has fourteen meals and excludes every requested food across recipe and ingredients',()=>{
  const plan=generatePlan({...structuredClone(DEFAULT_SETTINGS),startDate:'2026-10-26'},[]);
  assert.equal(meals(plan).length,14);
  for(const day of plan.days)assert.deepEqual(day.meals.map(meal=>meal.slot),['lunch','dinner']);
  for(const meal of meals(plan)){
    const recipe=recipeById(meal.recipeId);
    assert.ok(recipe.minutes<=60);
    const content=[recipe.title,recipe.protein,...recipe.ingredients.map(item=>ingredientNames.get(item.ingredientId))];
    for(const word of DEFAULT_SETTINGS.avoid)assert.ok(!content.some(text=>text.includes(word)),`${recipe.title} must exclude ${word}`);
  }
  assert.equal(meals(plan).filter(meal=>recipeById(meal.recipeId).starch==='rice').length,2);
  assert.equal(meals(plan).filter(meal=>recipeById(meal.recipeId).starch==='pasta').length,1);
});

test('American cuisine is backed by real dishes and selecting it affects generated recommendations',()=>{
  const american=RECIPES.filter(recipe=>recipe.cuisine==='美式');
  assert.ok(american.length>=2,'the new control has several actual recipes');
  const common={...structuredClone(DEFAULT_SETTINGS),startDate:'2026-10-26',riceMeals:0,pastaMeals:0};
  const preferred=generatePlan({...common,favorites:['美式']},[]);
  const first=recipeById(meals(preferred)[0].recipeId);
  assert.equal(first.cuisine,'美式','American preference must affect ranking, not just show a checkbox');
  assert.ok(meals(preferred).filter(meal=>recipeById(meal.recipeId).cuisine==='美式').length>0);
  for(const recipe of american)assert.ok(recipe.ingredients.length&&recipe.steps.length>=3);
});
