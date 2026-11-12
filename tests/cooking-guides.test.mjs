import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RECIPES,recipeById} from '../engine.js';
import {guideIds} from '../recipe-guides/index.js';
import {formatCookingText,recipeDoneness} from '../cooking-text.js';
import {renderCookingGuide,renderCookingSource} from '../cooking-ui.js';
const meal=(id,extra={})=>({recipeId:id,servings:2,...extra});
test('full instructions preserve saved recipe IDs, titles, cuisine, time limits and every shopping quantity',()=>{
 const snapshot=RECIPES.map(({id,title,cuisine,ingredients,minutes,baseServings})=>({id,title,cuisine,ingredients,minutes,baseServings}));
 assert.equal(createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),'1b2b4371d25bb7b19d73a59c35267a1bfdeeffe1c450e20d0c0b2b9abe1ba124');
});
test('all 200 existing recipes have individual full guides and honest AI provenance',()=>{
 assert.equal(RECIPES.length,200);
 assert.deepEqual([...guideIds].sort(),RECIPES.map(r=>r.id).sort());
 for(const cuisine of ['台式','義式','西式','美式'])assert.equal(RECIPES.filter(r=>r.cuisine===cuisine).length,50);
 for(const r of RECIPES){
  const g=r.details;
  assert.equal(g.version,2);assert.equal(r.source.kind,'ai-curated');
  assert.ok(g.preparation.length>=2&&g.preparation.every(s=>s.length>=20),r.id);
  assert.ok(r.steps.length>=6&&r.steps.length<=10,r.id);
  assert.equal(new Set(r.steps).size,r.steps.length,r.id);
  assert.ok(g.tips.length>=2,r.id);
  assert.ok([...g.preparation,...r.steps,...g.tips].join('').length>=450,r.id);
  assert.ok(g.timing.prepMinutes>0&&g.timing.cookMinutes>0);
  assert.equal(g.timing.totalMinutes,r.minutes);
  assert.equal(g.timing.prepMinutes+g.timing.cookMinutes,r.minutes);
  assert.equal(g.revisedAt,'2026-11-12');
 }
 const source=renderCookingSource();
 assert.match(source,/AI 編寫/);assert.match(source,/尚未逐道實際試煮/);
 assert.match(source,/並非.*外部作者/);assert.match(source,/foodsafety.gov/);assert.match(source,/Bosch/);
});
test('every full guide renders for adult, child and small-appetite portions without unresolved quantities',()=>{
 for(const r of RECIPES)for(const extra of [{},{servings:.7,adults:0,children:1},{servings:2.7,adults:2,children:1,portionFactor:.7},{servings:4.1,adults:2,children:3}]){
  const m=meal(r.id,extra);
  const html=renderCookingGuide(m);
  assert.doesNotMatch(html,/\{\{|\}\}|undefined|NaN|Infinity|舊識別碼/,r.id);
  for(const title of ['開始前先準備','完整作法','熟度怎麼判斷','成功關鍵與調整'])assert.ok(html.includes(title),r.id+title);
  assert.equal((html.match(/class="recipe-steps"/g)||[]).length,1);
 }
});
test('instruction quantities use exactly the same adult/child/appetite multiplier as the ingredient table',()=>{
 const m=meal('pasta-shrimp',{servings:2.7,adults:2,children:1,portionFactor:.7});
 const r=recipeById(m.recipeId),item=r.ingredients.find(i=>i.ingredientId==='pasta');
 assert.equal(formatCookingText('{{pasta}}',m),String(Math.round(item.quantity*.945*100)/100)+' g');
 assert.equal(formatCookingText('{{water:150}}',m),'141.75 ml');
 assert.equal(formatCookingText('{{oil:0.5}}',m),'9.45 ml');
 const text=formatCookingText('{{pasta}}；180°C，8～12分鐘；蛋液×1.5，水深2公分。',m);
 assert.match(text,/180°C，8～12分鐘；蛋液×1.5，水深2公分/);
 assert.equal(formatCookingText('{{breast}}',meal('chicken-salad',{servings:2.7,adults:2,children:1,portionFactor:.7})),'302.4 g');
 assert.equal(formatCookingText('{{water:150}}',meal('pasta-shrimp')),'150 ml');
});
test('invalid or missing instruction ingredients fail instead of silently printing misleading amounts',()=>{
 for(const text of ['{{avocado}}','{{oil:0}}','{{water}}','{{water:-1}}','{{oil:NaN}}','{{oil:1:2}}'])assert.throws(()=>formatCookingText(text,meal('pasta-shrimp')));
 assert.throws(()=>formatCookingText('{{pasta}}',meal('unknown')));
 assert.throws(()=>formatCookingText('{{pasta}}',meal('pasta-shrimp',{servings:2,portionFactor:.5})));
});
test('chicken salad, custard, minced meat and rice have dish-appropriate practical safety instructions',()=>{
 const chicken=renderCookingGuide(meal('chicken-salad'));
 assert.match(chicken,/1.5公分/);assert.match(chicken,/水面高出肉約2公分/);assert.match(chicken,/8～12分鐘/);
 assert.match(chicken,/74°C/);assert.match(chicken,/靜置3分鐘/);assert.match(chicken,/不用大滾久煮/);
 const custard=renderCookingGuide(meal('we2-shrimp-broccoli-custard'));
 assert.match(custard,/蛋液重量×1.5/);assert.match(custard,/牛奶.*扣除/);assert.match(custard,/90°C/);assert.match(custard,/71°C/);
 assert.match(recipeDoneness(recipeById('we2-beef-zucchini-patties')).join(''),/碎牛肉.*71°C/);
 assert.doesNotMatch(recipeDoneness(recipeById('we2-beef-zucchini-patties')).join(''),/整塊牛/);
 assert.match(recipeDoneness(recipeById('beef-mushroom')).join(''),/63°C.*3分鐘/);
 assert.match(renderCookingGuide(meal('rice-chicken')),/熟飯，不是生米/);
 assert.match(renderCookingGuide(meal('tw2-salmon-edamame-steamed-rice')),/74°C/);
 assert.match(renderCookingGuide(meal('hm-clam-cabbage-pot')),/最後仍不開口的蛤蜊丟棄/);
});
test('multi-stage cooking never allocates more than the listed oil or butter through quantity tokens',()=>{
 for(const r of RECIPES)for(const id of ['oil','butter']){
  const tokens=[...r.steps.join(' ').matchAll(new RegExp('\\{\\{'+id+'(?::([\\d.]+))?\\}\\}','g'))];
  const total=tokens.reduce((sum,m)=>sum+(m[1]?Number(m[1]):1),0);
  assert.ok(total<=1.000000001,r.id+' '+id+' allocates '+total);
 }
});
