import test from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES,INGREDIENTS,DEFAULT_SETTINGS,generatePlan,getEligibleRecipes,getReplacementOptions,replaceMeal,recipeById,aggregateShopping,setPlanDiners,setMealCooked,mealDiners} from '../engine.js';
const meals=plan=>plan.days.flatMap(day=>day.meals);
const settings={...structuredClone(DEFAULT_SETTINGS),startDate:'2026-11-02'};
const byId=new Map(INGREDIENTS.map(i=>[i.id,i]));
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const additions=RECIPES.filter(r=>/^(it2|we2|us2|tw2)-/.test(r.id));
const legacyIds=`
lemon-chicken steamed-halibut beef-mushroom roasted-lamb tomato-egg-tofu shrimp-egg
salmon-broccoli ginger-pork garlic-shrimp chicken-salad mushroom-chicken tofu-edamame
pepper-beef lemon-pork halibut-tomato shrimp-tofu egg-salad air-chicken rice-chicken
rice-beef rice-pork rice-fish pasta-shrimp pasta-chicken pasta-tuna pasta-mushroom pasta-egg
it-stuffed-chicken it-parchment-seabass it-shrimp-frittata it-scallop-spinach it-beef-asparagus
it-clam-squid-soup it-truffle-tofu-gratin it-pesto-chicken-balls it-truffle-shrimp-pasta
it-mentaiko-pasta it-four-cheese-pasta it-pesto-clam-pasta it-lemon-salmon-pasta
it-mushroom-chicken-rice it-scallop-asparagus-rice it-pesto-salmon-rice it-clam-squid-rice
it-beef-zucchini-rice-boats we-mustard-halibut-packet we-paprika-chicken-skewers
we-cumin-yogurt-lamb we-scallop-creamed-spinach we-beef-lettuce-cups we-seabass-celery-soup
we-cheddar-mushroom-frittata we-shrimp-tofu-zucchini-boats we-stroganoff-beef-pasta
we-cheddar-chicken-pasta we-salmon-yogurt-pasta we-paprika-shrimp-pasta
we-spinach-egg-pasta-bake we-cheddar-shrimp-rice we-paprika-chicken-rice-bake
we-rosemary-beef-rice-salad we-salmon-spinach-rice-bake we-mustard-scallop-rice
hm-seabass-tofu-pot hm-steamed-scallop-asparagus hm-celery-beef hm-cabbage-chicken-roll
hm-clam-cabbage-pot hm-squid-celery hm-spinach-tofu-omelette hm-shredded-chicken-cucumber
hm-sesame-chicken-pasta hm-scallion-scallop-pasta hm-squid-cabbage-pasta hm-curry-shrimp-pasta
hm-tofu-egg-soup-pasta hm-beef-egg-fried-rice hm-clam-shrimp-soup-rice hm-edamame-tofu-rice
hm-ginger-fish-rice hm-curry-chicken-rice`.trim().split(/\s+/);

// These are the supported household tools, not a general-purpose equipment list.
const tools=new Set(['IH 爐','蒸烤爐','氣炸鍋','微波爐','電子鍋']);
const cuisines=['義式','西式','美式','台式'];

test('catalog offers at least 50 distinct complete recipes per cuisine and retains all 81 saved meal IDs',()=>{
 assert.equal(legacyIds.length,81);
 assert.ok(RECIPES.length>=200);
 assert.equal(new Set(RECIPES.map(r=>r.id)).size,RECIPES.length);
 assert.equal(new Set(RECIPES.map(r=>r.title)).size,RECIPES.length);
 assert.deepEqual([...new Set(RECIPES.map(r=>r.cuisine))].sort(),[...cuisines].sort());
 for(const cuisine of cuisines)assert.ok(RECIPES.filter(r=>r.cuisine===cuisine).length>=50,`${cuisine}: at least 50 choices`);
 for(const r of RECIPES){
  assert.equal(r.source.kind,'ai-curated');assert.match(r.source.label,/AI/);
  assert.ok(!r.source.url,`${r.id}: no invented external attribution`);
  assert.equal(r.baseServings,2,`${r.id}: quantities use two ordinary adults`);
  assert.ok(r.steps.length>=3&&r.steps.every(s=>typeof s==='string'&&s.length>10),`${r.id}: useful instructions`);
  assert.ok(r.minutes<=60&&r.minutes>0,`${r.id}: practical cooking time`);
  assert.ok(r.equipment.split('＋').every(tool=>tools.has(tool)),`${r.id}: available tools`);
  assert.ok(['雞肉','牛肉','羊肉','魚肉','海鮮','蛋豆','乳酪','豬肉'].includes(r.protein));
  assert.ok(['low','rice','pasta'].includes(r.starch));
  assert.equal(new Set(r.ingredients.map(i=>i.ingredientId)).size,r.ingredients.length);
  assert.ok(r.ingredients.length>2);
  for(const i of r.ingredients){assert.ok(byId.has(i.ingredientId),`${r.id}: ${i.ingredientId}`);assert.ok(i.quantity>0&&Number.isFinite(i.quantity));}
  if(r.starch==='pasta')assert.ok(r.ingredients.some(i=>i.ingredientId==='pasta'));
  if(r.starch==='rice')assert.ok(r.ingredients.some(i=>i.ingredientId==='rice'));
 }
 for(const id of legacyIds)assert.ok(recipeById(id),`${id}: existing saved meal remains available`);
});

test('all 119 additions have four useful steps, ordinary baseline portions and no default excluded foods',()=>{
 assert.ok(additions.length>=119);
 for(const [prefix,cuisine,minimum] of [['it2-','義式',27],['we2-','西式',26],['us2-','美式',40],['tw2-','台式',26]]){
  const group=additions.filter(r=>r.id.startsWith(prefix));
  assert.ok(group.length>=minimum,`${prefix}: expected additions are imported`);
  assert.ok(group.every(r=>r.cuisine===cuisine));
  assert.ok(group.filter(r=>r.starch==='low').length>=Math.ceil(group.length/2),`${cuisine}: at least half low starch`);
  for(const starch of ['low','rice','pasta'])assert.ok(group.some(r=>r.starch===starch),`${cuisine}: ${starch} choices`);
 }
 for(const r of additions){
  assert.ok(r.steps.length>=4,`${r.id}: at least four useful steps`);
  const text=[r.title,r.protein,...r.ingredients.map(i=>byId.get(i.ingredientId).name)].join(' ');
  for(const excluded of [...settings.avoid,'鮪魚','培根','火腿'])assert.ok(!text.includes(excluded),`${r.id}: ${excluded}`);
  if(r.starch==='low')assert.ok(r.ingredients.every(i=>!['rice','pasta','potato','sweetpotato','corn'].includes(i.ingredientId)),`${r.id}: low starch ingredients`);
  if(r.starch==='pasta')assert.equal(r.ingredients.find(i=>i.ingredientId==='pasta').quantity,140,`${r.id}: dry pasta for two adults`);
  if(r.starch==='rice')assert.equal(r.ingredients.find(i=>i.ingredientId==='rice').quantity,300,`${r.id}: cooked rice for two adults`);
 }
});

test('default exclusions still apply while every main-meal category has many more choices',()=>{
 const eligible=getEligibleRecipes(settings),eligibleIds=new Set(eligible.map(r=>r.id));
 assert.ok(eligible.length>=192);
 for(const r of additions)assert.ok(eligibleIds.has(r.id),`${r.id}: available with household defaults`);
 for(const type of ['low','rice','pasta'])assert.ok(eligible.filter(r=>r.starch===type).length>=30,`${type}: ample replacement choices`);
 for(const r of eligible)for(const word of settings.avoid)assert.ok(![r.title,r.protein,...r.ingredients.map(i=>byId.get(i.ingredientId).name)].some(s=>s.includes(word)),`${r.id}: ${word}`);
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

test('every added dish scales adults and children before small appetite, merges meals and deducts actual pantry stock once',()=>{
 assert.ok(additions.length>=119);
 for(const r of additions)for(const {adults,children,appetite} of [
  {adults:2,children:1,appetite:'normal'},
  {adults:2,children:1,appetite:'small'},
  {adults:0,children:2,appetite:'small'},
  {adults:3,children:2,appetite:'small'}
 ]){
  const factor=appetite==='small'?0.7:1,equivalent=adults+children*0.7;
  const original={days:[{weekday:1,meals:[{key:'one',recipeId:r.id,servings:2}]},{weekday:6,meals:[{key:'two',recipeId:r.id,servings:2}]}]};
  const plan=setPlanDiners(original,{...settings,weekdayPeople:adults,weekdayChildren:children,weekendPeople:adults,weekendChildren:children,appetite});
  for(const meal of meals(plan)){assert.deepEqual(mealDiners(meal),{adults,children});assert.equal(meal.servings,round(equivalent));}
  assert.deepEqual(setPlanDiners(plan,{...settings,weekdayPeople:adults,weekdayChildren:children,weekendPeople:adults,weekendChildren:children,appetite}),plan,'applying the same headcounts twice does not compound portions');
  const inventory=r.ingredients.flatMap((item,index)=>index%3===0?[]:index%3===1?[
   {ingredientId:item.ingredientId,quantity:round(item.quantity*0.2)},
   {ingredientId:item.ingredientId,quantity:round(item.quantity*0.1)}
  ]:[{ingredientId:item.ingredientId,quantity:round(item.quantity*equivalent*factor+10)}]);
  const stock=new Map();for(const i of inventory)stock.set(i.ingredientId,round((stock.get(i.ingredientId)||0)+i.quantity));
  const beforePlan=structuredClone(plan),beforeInventory=structuredClone(inventory);
  const shopping=new Map(aggregateShopping(plan,inventory).map(row=>[row.ingredientId,row]));
  assert.equal(shopping.size,r.ingredients.length);
  for(const item of r.ingredients){
   const row=shopping.get(item.ingredientId),required=round(item.quantity*equivalent/r.baseServings*factor*2),available=stock.get(item.ingredientId)||0;
   assert.equal(row.required,required,`${r.id}/${item.ingredientId}: (${adults} + ${children} × 0.7) × ${factor}`);
   assert.equal(row.stock,available,'pantry quantities keep their actual amount');
   assert.equal(row.usedStock,round(Math.min(required,available)));
   assert.equal(row.toBuy,round(Math.max(0,required-available)));
   assert.deepEqual(row.mealKeys,['one','two']);
  }
  const afterCooked=new Map(aggregateShopping(setMealCooked(plan,'one',true),inventory).map(row=>[row.ingredientId,row]));
  for(const item of r.ingredients){
   const row=afterCooked.get(item.ingredientId),required=round(item.quantity*equivalent/r.baseServings*factor);
   assert.equal(row.required,required,`${r.id}: cooked meal demand is removed`);
   assert.equal(row.toBuy,round(Math.max(0,required-(stock.get(item.ingredientId)||0))));
  }
  assert.deepEqual(plan,beforePlan);assert.deepEqual(inventory,beforeInventory);
 }
});
