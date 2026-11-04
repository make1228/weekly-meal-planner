import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,RECIPES,generatePlan,aggregateShopping,replaceMeal,setMealCooked,setPlanAppetite,mealPortionFactor,mealIngredientQuantity} from '../engine.js';

const flatten=plan=>plan.days.flatMap(day=>day.meals);
const settings=extra=>({...structuredClone(DEFAULT_SETTINGS),startDate:'2026-10-26',seed:19,...extra});
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} should equal ${expected}`);
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
function repeatedChicken(){
 return {startDate:'2026-10-26',generatedAt:'2026-10-26T00:00:00Z',generationId:'keep-this-generation',days:[2,3].map((servings,index)=>({date:`2026-10-${26+index}`,weekday:index+1,dayLabel:`day${index}`,meals:[{key:`meal-${index}`,recipeId:'lemon-chicken',servings,cooked:index===0?false:undefined,replacementHistory:['lemon-chicken']}]}))};
}

test('ordinary appetite preserves legacy ingredient amounts and the actual number of diners',()=>{
 const {appetite,...legacy}=settings();
 assert.equal(DEFAULT_SETTINGS.appetite,'normal');
 const oldPlan=generatePlan(legacy),ordinary=generatePlan(settings({appetite:'normal'}));
 assert.deepEqual(oldPlan.days,ordinary.days);
 assert.deepEqual(aggregateShopping(oldPlan),aggregateShopping(ordinary));
 for(const meal of flatten(ordinary)){assert.equal(meal.servings,2);assert.equal(mealPortionFactor(meal),1);assert.equal(Object.hasOwn(meal,'portionFactor'),false);}
});

test('small appetite generates the same empty-pantry menu with exactly 70 percent ingredient demand',()=>{
 const ordinary=generatePlan(settings({weekdayPeople:2,weekendPeople:5}));
 const small=generatePlan(settings({weekdayPeople:2,weekendPeople:5,appetite:'small'}));
 assert.deepEqual(flatten(small).map(m=>m.recipeId),flatten(ordinary).map(m=>m.recipeId));
 assert.deepEqual(flatten(small).map(m=>m.servings),flatten(ordinary).map(m=>m.servings));
 assert.ok(flatten(small).every(m=>mealPortionFactor(m)===0.7));
 const normalRows=new Map(aggregateShopping(ordinary).map(row=>[row.ingredientId,row.required]));
 for(const row of aggregateShopping(small))assert.equal(row.required,round(normalRows.get(row.ingredientId)*0.7),row.name);
});

test('every recipe ingredient, including fractional eggs, seasonings and packaged portions, scales by 0.7',()=>{
 for(const recipe of RECIPES)for(const servings of [1,2,5])for(const ingredient of recipe.ingredients){
  const ordinary={recipeId:recipe.id,servings};
  const small={...ordinary,portionFactor:0.7};
  const expected=ingredient.quantity*servings/recipe.baseServings;
  near(mealIngredientQuantity(ordinary,ingredient),expected);
  near(mealIngredientQuantity(small,ingredient),expected*0.7);
 }
 const eggs=RECIPES.find(r=>r.id==='shrimp-egg').ingredients.find(i=>i.ingredientId==='egg');
 near(mealIngredientQuantity({recipeId:'shrimp-egg',servings:2,portionFactor:0.7},eggs),2.8);
});

test('small portions merge demand first and deduct actual pantry stock once without scaling the stock',()=>{
 const small=setPlanAppetite(repeatedChicken(),'small');
 const before=structuredClone(small),inventory=[{ingredientId:'chicken',quantity:60},{ingredientId:'chicken',quantity:40}];
 const chicken=aggregateShopping(small,inventory).find(row=>row.ingredientId==='chicken');
 assert.equal(chicken.required,630);assert.equal(chicken.stock,100);assert.equal(chicken.usedStock,100);assert.equal(chicken.toBuy,530);
 const covered=aggregateShopping(small,[{ingredientId:'chicken',quantity:900}]).find(row=>row.ingredientId==='chicken');
 assert.equal(covered.toBuy,0);assert.equal(covered.usedStock,630);
 assert.deepEqual(small,before);assert.deepEqual(inventory,[{ingredientId:'chicken',quantity:60},{ingredientId:'chicken',quantity:40}]);
});

test('changing appetite is absolute and preserves meal choices, diners, cooked flags and replacement history',()=>{
 const original=repeatedChicken();original.days[0].meals[0].cooked=true;
 const untouched=structuredClone(original);
 const small=setPlanAppetite(original,'small');
 assert.deepEqual(original,untouched);
 for(const [index,meal] of flatten(small).entries()){
  const old=flatten(original)[index];assert.equal(meal.recipeId,old.recipeId);assert.equal(meal.servings,old.servings);assert.equal(meal.cooked,old.cooked);assert.deepEqual(meal.replacementHistory,old.replacementHistory);
 }
 assert.equal(small.generationId,original.generationId);
 assert.deepEqual(setPlanAppetite(small,'small'),small,'selecting small again must not compound into 0.49');
 assert.deepEqual(setPlanAppetite(small,'normal'),original);
 assert.deepEqual(setPlanAppetite(setPlanAppetite(small,'normal'),'small'),small);
});

test('cooked deduction and undo use the selected appetite without changing pantry inventory',()=>{
 const small=setPlanAppetite(repeatedChicken(),'small'),stock=[{ingredientId:'chicken',quantity:100}];
 const cooked=setMealCooked(small,'meal-0',true);
 const chicken=aggregateShopping(cooked,stock).find(row=>row.ingredientId==='chicken');
 assert.equal(chicken.required,378);assert.equal(chicken.toBuy,278);
 assert.deepEqual(aggregateShopping(setMealCooked(cooked,'meal-0',false),stock),aggregateShopping(small,stock));
 assert.equal(mealPortionFactor(flatten(cooked)[0]),0.7);assert.equal(stock[0].quantity,100);
});

test('replacement and repeated swaps keep small appetite while updating groceries for the chosen recipe',()=>{
 let plan=generatePlan(settings({appetite:'small'}));const key=plan.days[0].meals[0].key;
 for(let index=0;index<4;index++){
  const previous=structuredClone(plan);plan=replaceMeal(plan,key,settings({appetite:'small'}));
  assert.equal(flatten(plan).find(meal=>meal.key===key).portionFactor,0.7);
  assert.equal(flatten(plan).find(meal=>meal.key===key).servings,2);
  assert.deepEqual(flatten(plan).filter(meal=>meal.key!==key),flatten(previous).filter(meal=>meal.key!==key));
  const normal=setPlanAppetite(plan,'normal'),normalRows=new Map(aggregateShopping(normal).map(row=>[row.ingredientId,row.required]));
  for(const row of aggregateShopping(plan))assert.equal(row.required,round(normalRows.get(row.ingredientId)*0.7));
 }
});

test('invalid appetite or stored portion multipliers fail instead of silently changing quantities',()=>{
 for(const appetite of [null,'tiny','',0,0.7,true,{},[]]){
  assert.throws(()=>generatePlan(settings({appetite})),/食量/);
  assert.throws(()=>setPlanAppetite(repeatedChicken(),appetite),/食量/);
 }
 for(const portionFactor of [null,0,-1,0.49,0.8,'0.7',true,Infinity,NaN]){
  const plan=repeatedChicken();plan.days[0].meals[0].portionFactor=portionFactor;
  assert.throws(()=>mealPortionFactor(plan.days[0].meals[0]),/食量/);
  assert.throws(()=>aggregateShopping(plan),/食量/);
  assert.throws(()=>setPlanAppetite(plan,'small'),/食量/);
 }
 const normal=repeatedChicken();normal.days[0].meals[0].portionFactor=1;
 assert.deepEqual(aggregateShopping(normal),aggregateShopping(repeatedChicken()));
});
