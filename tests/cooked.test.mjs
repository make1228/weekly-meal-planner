import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,RECIPES,generatePlan,recipeById,setMealCooked,getReplacementOptions,replaceMeal,aggregateShopping,addDays} from '../engine.js';

const preferences=(patch={})=>({...structuredClone(DEFAULT_SETTINGS),startDate:'2026-10-26',...patch});
const meals=plan=>plan.days.flatMap(day=>day.meals);
const targetOf=(plan,key)=>meals(plan).find(meal=>meal.key===key);
const round=n=>Math.round((n+Number.EPSILON)*100)/100;

function remainingOracle(plan,inventory=[]){
  const totals=new Map(),stock=new Map();
  for(const row of inventory)stock.set(row.ingredientId,(stock.get(row.ingredientId)||0)+Number(row.quantity));
  for(const meal of meals(plan)){
    if(meal.cooked===true)continue;
    const recipe=recipeById(meal.recipeId);
    for(const item of recipe.ingredients){const row=totals.get(item.ingredientId)||{ingredientId:item.ingredientId,required:0,mealKeys:[]};row.required+=item.quantity*meal.servings/recipe.baseServings;row.mealKeys.push(meal.key);totals.set(item.ingredientId,row);}
  }
  return [...totals.values()].map(row=>{const required=round(row.required),usedStock=round(Math.min(required,round(stock.get(row.ingredientId)||0)));return {...row,required,usedStock,toBuy:round(required-usedStock),mealKeys:row.mealKeys.sort()};}).sort((a,b)=>a.ingredientId.localeCompare(b.ingredientId));
}
function groceryFields(plan,inventory=[]){
  return aggregateShopping(plan,inventory).map(({ingredientId,required,usedStock,toBuy,mealKeys})=>({ingredientId,required,usedStock,toBuy,mealKeys:[...mealKeys].sort()})).sort((a,b)=>a.ingredientId.localeCompare(b.ingredientId));
}
function repeatedPlan(recipeId='lemon-chicken',servings=[2,5]){
  return {startDate:'2026-10-26',generatedAt:'2026-10-26T00:00:00.000Z',days:servings.map((count,index)=>{const date=addDays('2026-10-26',index);return {date,weekday:index+1,meals:[{key:`${date}-dinner`,date,slot:'dinner',recipeId,servings:count}]};})};
}

test('marking Wednesday cooked affects only that meal and groceries exactly equal uncooked meals',()=>{
  const settings=preferences({weekdayPeople:3,weekendPeople:5}),inventory=[{ingredientId:'garlic',quantity:18.5},{ingredientId:'broccoli',quantity:450}];
  const plan=generatePlan(settings,inventory),before=structuredClone(plan),target=plan.days[2].meals[0],next=setMealCooked(plan,target.key,true);
  assert.deepEqual(plan,before,'marking cooked must not mutate input');
  assert.equal(targetOf(next,target.key).cooked,true);
  const {cooked,...mealWithoutFlag}=targetOf(next,target.key);
  assert.deepEqual(mealWithoutFlag,target,'recipe, servings and metadata remain intact');
  for(let index=0;index<7;index++)if(index!==2)assert.deepEqual(next.days[index],before.days[index]);
  assert.deepEqual(groceryFields(next,inventory),remainingOracle(next,inventory));
  for(const row of aggregateShopping(next,inventory))assert.ok(!row.mealKeys.includes(target.key),'cooked meal does not contribute to grocery provenance');
});

test('shared ingredients remain for uncooked meals and current inventory is deducted just once',()=>{
  const plan=repeatedPlan(),first=plan.days[0].meals[0],inventory=[{ingredientId:'chicken',quantity:100.25},{ingredientId:'chicken',quantity:99.75},{ingredientId:'garlic',quantity:10000}],inventoryBefore=structuredClone(inventory);
  const next=setMealCooked(plan,first.key,true),rows=aggregateShopping(next,inventory),chicken=rows.find(row=>row.ingredientId==='chicken');
  assert.equal(chicken.required,900,'only remaining five-person dinner requires chicken');
  assert.equal(chicken.usedStock,200,'combine current stock, deduct once from remaining total');
  assert.equal(chicken.toBuy,700);
  assert.deepEqual(chicken.mealKeys,[plan.days[1].meals[0].key]);
  assert.equal(rows.find(row=>row.ingredientId==='garlic').toBuy,0,'excess stock cannot produce negative purchases');
  assert.deepEqual(groceryFields(next,inventory),remainingOracle(next,inventory));
  assert.deepEqual(inventory,inventoryBefore,'cooking marker does not silently consume user-entered current stock');
});

test('marking every meal cooked removes all shopping rows while keeping every recipe',()=>{
  const settings=preferences({slots:['lunch','dinner']}),plan=generatePlan(settings,[]),originalIds=meals(plan).map(meal=>meal.recipeId);
  let next=plan;for(const meal of meals(plan))next=setMealCooked(next,meal.key,true);
  assert.equal(meals(next).length,14);
  assert.deepEqual(meals(next).map(meal=>meal.recipeId),originalIds);
  assert.ok(meals(next).every(meal=>meal.cooked===true));
  assert.deepEqual(aggregateShopping(next,[]),[]);
  assert.deepEqual(aggregateShopping(next,[{ingredientId:'garlic',quantity:100}]),[]);
  assert.ok(meals(plan).every(meal=>meal.cooked!==true),'input menu still uncooked');
});

test('undoing cooked restores exact shopping and allows the meal to be replaced again',()=>{
  const settings=preferences(),plan=generatePlan(settings,[]),target=plan.days[2].meals[0],inventory=[{ingredientId:'garlic',quantity:12.75}];
  const original=aggregateShopping(plan,inventory),cooked=setMealCooked(plan,target.key,true),restored=setMealCooked(cooked,target.key,false);
  assert.equal(targetOf(restored,target.key).cooked,false);
  assert.equal(targetOf(restored,target.key).recipeId,target.recipeId);
  assert.equal(targetOf(restored,target.key).servings,target.servings);
  assert.deepEqual(aggregateShopping(restored,inventory),original);
  assert.ok(getReplacementOptions(restored,target.key,settings,inventory).length>0);
  assert.notEqual(targetOf(replaceMeal(restored,target.key,settings,inventory),target.key).recipeId,target.recipeId);
});

test('cooked meals reject both picker and automatic or explicit replacement until undone',()=>{
  const settings=preferences(),plan=generatePlan(settings,[]),target=meals(plan).find(meal=>recipeById(meal.recipeId).starch==='low');
  const alternative=getReplacementOptions(plan,target.key,settings,[])[0].id,cooked=setMealCooked(plan,target.key,true),before=structuredClone(cooked);
  assert.throws(()=>getReplacementOptions(cooked,target.key,settings,[]));
  assert.throws(()=>replaceMeal(cooked,target.key,settings,[]));
  assert.throws(()=>replaceMeal(cooked,target.key,settings,[],alternative));
  assert.throws(()=>replaceMeal(cooked,target.key,settings,[],undefined,[alternative]));
  assert.deepEqual(cooked,before);
});

test('invalid cooked status inputs and missing meal keys fail without changing the menu',()=>{
  const plan=generatePlan(preferences(),[]),key=plan.days[0].meals[0].key,before=structuredClone(plan);
  assert.throws(()=>setMealCooked(plan,'missing-key',true));
  for(const value of [undefined,null,0,1,'true','false',{},[]])assert.throws(()=>setMealCooked(plan,key,value));
  assert.deepEqual(plan,before);
});

test('legacy menus without cooked flags behave normally and JSON backup retains cooked markers',()=>{
  const plan=generatePlan(preferences(),[]),before=aggregateShopping(plan,[]),key=plan.days[2].meals[0].key;
  assert.ok(meals(plan).every(meal=>meal.cooked!==true));
  assert.deepEqual(groceryFields(plan),remainingOracle(plan));
  const cooked=setMealCooked(plan,key,true),roundTripped=JSON.parse(JSON.stringify(cooked));
  assert.equal(targetOf(roundTripped,key).cooked,true);
  assert.deepEqual(aggregateShopping(roundTripped,[]),aggregateShopping(cooked,[]));
  const restored=setMealCooked(roundTripped,key,false);
  assert.deepEqual(aggregateShopping(restored,[]),before);
});

test('cooked toggle preserves prior replacement history and repeated marking never changes quantities twice',()=>{
  const settings=preferences(),initial=generatePlan(settings,[]),key=initial.days[2].meals[0].key;
  const replaced=replaceMeal(initial,key,settings,[]),history=[...targetOf(replaced,key).replacementHistory];
  const cooked=setMealCooked(replaced,key,true),markedAgain=setMealCooked(cooked,key,true);
  assert.deepEqual(targetOf(markedAgain,key).replacementHistory,history);
  assert.deepEqual(aggregateShopping(markedAgain,[]),aggregateShopping(cooked,[]));
  const undone=setMealCooked(markedAgain,key,false),undoneAgain=setMealCooked(undone,key,false);
  assert.deepEqual(targetOf(undoneAgain,key).replacementHistory,history);
  assert.deepEqual(aggregateShopping(undoneAgain,[]),aggregateShopping(replaced,[]));
});
