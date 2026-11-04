import test from 'node:test';
import assert from 'node:assert/strict';
import {INGREDIENTS} from '../engine.js';
import {
 COSTCO_PRODUCTS,
 COSTCO_CHECKED_AT,
 getCostcoProduct,
 costcoPriceLabel,
 costcoSummary,costcoRecipeWarning
} from '../costco.js';

const canonicalIngredients=new Map(INGREDIENTS.map(ingredient=>[ingredient.id,ingredient]));
const product=id=>{
 const found=getCostcoProduct(id);
 assert.ok(found,`${id} has a verified Costco record`);
 return found;
};

test('ring-cut squid is visibly unsuitable for recipes that require a whole body',()=>{
 for(const id of ['it2-spinach-stuffed-squid','tw2-squid-stuffed-egg'])assert.match(costcoRecipeWarning('squid',[{id}]),/整尾透抽.*透抽圈.*不適用/);
 assert.equal(costcoRecipeWarning('squid',[{id:'it2-squid-basil-pasta'}]),'');
 assert.equal(costcoRecipeWarning('shrimp',[{id:'it2-spinach-stuffed-squid'}]),'');
 assert.equal(costcoRecipeWarning('squid',[]),'');
});

test('Costco snapshot covers 50 unique canonical ingredients with 28 public and 22 undisclosed prices',()=>{
 assert.equal(COSTCO_PRODUCTS.length,50);
 assert.equal(new Set(COSTCO_PRODUCTS.map(item=>item.ingredientId)).size,50);
 assert.equal(COSTCO_PRODUCTS.filter(item=>item.priceTwd!==null).length,28);
 assert.equal(COSTCO_PRODUCTS.filter(item=>item.priceType==='not-public').length,22);
 assert.deepEqual(costcoSummary(),{ingredients:50,priced:28});
 for(const item of COSTCO_PRODUCTS){
  assert.ok(canonicalIngredients.has(item.ingredientId),`${item.ingredientId} is canonical`);
  assert.strictEqual(getCostcoProduct(item.ingredientId),item);
 }
});

test('every Costco record retains an official source, check date, package and meaningful purchase notes',()=>{
 assert.equal(COSTCO_CHECKED_AT,'2026-11-04');
 for(const item of COSTCO_PRODUCTS){
  const context=item.ingredientId;
  const url=new URL(item.url);
  assert.equal(url.protocol,'https:',context);
  assert.equal(url.hostname,'www.costco.com.tw',context);
  assert.equal(url.username,'',context);
  assert.equal(url.password,'',context);
  assert.equal(item.checkedAt,COSTCO_CHECKED_AT,context);
  for(const field of ['productName','packageLabel','packageUnit','notes']){
   assert.ok(typeof item[field]==='string'&&item[field].trim().length>0,`${context}: ${field}`);
  }
  assert.ok(['exact','substitute'].includes(item.matchType),`${context}: match type`);
  assert.equal(item.packageUnit,canonicalIngredients.get(context).unit,`${context}: quantities use the ingredient's actual unit`);
  assert.ok(item.packageQuantity===null||(Number.isFinite(item.packageQuantity)&&item.packageQuantity>0),`${context}: known positive quantity or null`);
  assert.ok(['online-package','not-public'].includes(item.priceType),`${context}: no invented unit-price basis`);
  if(item.priceType==='not-public'){
   assert.equal(item.priceTwd,null,context);
   assert.match(item.notes,/官網未公開售價/,context);
  }else{
   assert.ok(Number.isFinite(item.priceTwd)&&item.priceTwd>0,`${context}: public prices are positive numbers`);
   assert.ok(item.packageQuantity>0,`${context}: priced retail package has a verified quantity`);
   assert.match(url.pathname,/\/p\/\d+$/,`${context}: priced source is a product page`);
  }
  if(!/\/p\/\d+$/.test(url.pathname)){
   assert.equal(item.priceType,'not-public',`${context}: a category listing does not supply a product price`);
   assert.match(item.notes,/分類頁/,`${context}: category source is disclosed`);
  }
 }
});

test('price labels distinguish the complete retail package from an undisclosed price',()=>{
 for(const item of COSTCO_PRODUCTS){
  const label=costcoPriceLabel(item);
  if(item.priceTwd===null){
   assert.equal(label,'售價未公開',item.ingredientId);
   assert.doesNotMatch(label,/\d|NT\$|估價/,`${item.ingredientId}: unknown never becomes a zero estimate`);
  }else{
   assert.equal(label,`NT$${item.priceTwd.toLocaleString('en-US')}／整包裝`,item.ingredientId);
   assert.doesNotMatch(label,/每人|每餐|每份|／公斤|估價/,`${item.ingredientId}: package price is not a meal cost`);
  }
 }
 assert.equal(costcoPriceLabel(product('pork')),'NT$4,399／整包裝');
});

test('variable or unavailable package weights stay unknown rather than becoming estimated grams',()=>{
 for(const id of ['beef','lamb','parmesan']){
  const item=product(id);
  assert.equal(item.packageQuantity,null,id);
  assert.equal(item.priceTwd,null,id);
  assert.match(item.packageLabel,/秤重|稱重|未提供重量/,id);
 }
 assert.match(product('beef').packageLabel,/依實際重量/);
 assert.match(product('parmesan').notes,/無固定包裝重量/);
});

test('important product identities preserve exact ingredients and total multipack quantities',()=>{
 const expected=[
  ['pasta','880451',3000,'g',399,/筆尖形義大利麵/],
  ['oil','1789247',3000,'ml',629,/橄欖油/],
  ['honey','1816719',2000,'g',659,/蜂蜜/],
  ['milk','107754',6000,'ml',429,/全脂保久乳/],
  ['mushroom','577908',960,'g',null,/綜合菇/],
  ['cream','54543',1000,'ml',null,/鮮奶油/],
  ['parmesan','843333',null,'g',null,/帕瑪森吉諾/],
  ['pesto','911595',624,'g',null,/羅勒/],
  ['yogurt','599369',1814,'g',null,/希臘式優格/],
  ['butter','744110',1812,'g',null,/無鹽奶油/]
 ];
 for(const [id,sku,quantity,unit,price,name] of expected){
  const item=product(id);
  assert.ok(new URL(item.url).pathname.endsWith(`/p/${sku}`),`${id}: verified SKU`);
  assert.equal(item.packageQuantity,quantity,id);
  assert.equal(item.packageUnit,unit,id);
  assert.equal(item.priceTwd,price,id);
  assert.match(item.productName,name,id);
  assert.equal(item.matchType,'exact',id);
 }
 assert.match(product('pasta').packageLabel,/500公克.*6包/);
 assert.match(product('milk').packageLabel,/250毫升.*24入/);
 assert.match(product('pesto').notes,/乳製品及松子/);
 assert.match(product('yogurt').notes,/無添加糖/);
});

test('cuts, edible amounts and preparation differences remain visible in the product notes',()=>{
 assert.match(product('beef').notes,/已切燒烤片/);
 assert.match(product('pork').notes,/已切燒肉片/);
 assert.match(product('shrimp').notes,/去頭去殼去尾與腸泥/);
 assert.match(product('squid').notes,/已切圈，非整尾/);
 assert.match(product('edamame').notes,/已去殼.*含食鹽/);
 const tuna=product('tuna');
 assert.equal(tuna.packageQuantity,8);
 assert.equal(tuna.packageUnit,'罐');
 assert.match(tuna.packageLabel,/每罐固形量153公克/);
 assert.match(tuna.notes,/不能把198公克當瀝乾魚肉重量/);
 const clams=product('clams');
 assert.match(canonicalIngredients.get('clams').name,/已吐沙/);
 assert.equal(clams.matchType,'substitute');
 assert.match(clams.notes,/吐沙2[–—~-]3小時/);
 assert.match(clams.notes,/非已吐沙/);
 assert.match(clams.notes,/增加備料時間/);
});

test('minimum order quantities, order multiples and stock limits are not lost from purchase notes',()=>{
 const restrictions=[
  ['salmon',/最少訂購2包/],
  ['halibut',/3包倍數/],
  ['shrimp',/最少訂購2包/],
  ['edamame',/最少訂購2組/],
  ['squid',/4包倍數/],
  ['seabass',/2包倍數/],
  ['milk',/最少訂購2箱/],
  ['mustard',/查核時官網缺貨/]
 ];
 for(const [id,restriction] of restrictions)assert.match(product(id).notes,restriction,id);
 assert.match(product('milk').notes,/100%生乳.*全脂保久乳/);
 assert.match(product('pork').notes,/商業配送整箱價，非單包價格/);
});

test('ingredients without a verified match return null instead of claiming Costco availability',()=>{
 for(const id of ['unlisted-ingredient','rice','chicken-kit','blue-cheese']){
  assert.equal(getCostcoProduct(id),null,id);
 }
});
