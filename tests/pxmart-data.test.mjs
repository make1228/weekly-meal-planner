import test from 'node:test';
import assert from 'node:assert/strict';
import {INGREDIENTS} from '../engine.js';
import {PX_MART_PRODUCTS} from '../pxmart-data.js';

const ingredients=new Map(INGREDIENTS.map(ingredient=>[ingredient.id,ingredient]));
const products=new Map(PX_MART_PRODUCTS.map(product=>[product.ingredientId,product]));
function product(id){const item=products.get(id);assert.ok(item,`${id}: verified PX Mart product exists`);return item;}

test('PX Mart matches use unique canonical ingredients and direct official Hour Arrive product sources',()=>{
 assert.ok(PX_MART_PRODUCTS.length>0);
 assert.equal(products.size,PX_MART_PRODUCTS.length,'one verified match per ingredient');
 for(const item of PX_MART_PRODUCTS){
  const context=item.ingredientId;
  assert.ok(ingredients.has(context),`${context}: canonical ingredient`);
  const url=new URL(item.url);
  assert.equal(url.protocol,'https:',context);
  assert.equal(url.hostname,'shop.pxgo.com.tw',context);
  assert.match(url.pathname,/^\/hourArrive\/goods\/[^/]+\/?$/,`${context}: excludes campaigns, batch pickup and other channels`);
  assert.equal(url.username,'',context);assert.equal(url.password,'',context);
  assert.equal(item.checkedAt,'2026-11-04',context);
  assert.equal(item.packageUnit,ingredients.get(context).unit,`${context}: no invented grams-to-pieces conversions`);
  assert.ok(item.packageQuantity===null||(Number.isFinite(item.packageQuantity)&&item.packageQuantity>0),`${context}: positive verified quantity or unknown`);
  for(const field of ['productName','packageLabel','notes'])assert.ok(typeof item[field]==='string'&&item[field].trim(),`${context}: ${field}`);
  assert.ok(['exact','substitute'].includes(item.matchType),`${context}: explicit ingredient compatibility`);
 }
});

test('PX Mart prices distinguish fixed retail packages, unknown prices and weighed per-100g offers',()=>{
 for(const item of PX_MART_PRODUCTS){
  const context=item.ingredientId;
  assert.ok(['online-package','not-public','per-100g'].includes(item.priceType),`${context}: supported price basis`);
  if(item.priceType==='not-public')assert.equal(item.priceTwd,null,`${context}: unknown price is never estimated or zero`);
  else assert.ok(Number.isFinite(item.priceTwd)&&item.priceTwd>0,`${context}: observed positive price`);
  if(item.priceType==='per-100g'){
   assert.equal(item.packageUnit,'g',`${context}: weight-based pricing`);
   assert.equal(item.packageQuantity,null,`${context}: weighed package quantity remains unknown`);
   assert.match(item.packageLabel,/秤重|實際重量/,`${context}: package is not fixed weight`);
   assert.match(item.notes,/每100公克|每100克|每100g/,`${context}: retains the observed unit-price basis`);
  }
 }
});

test('PX Mart availability remains dependent on the delivery store and never guarantees local stock',()=>{
 for(const item of PX_MART_PRODUCTS){
  assert.ok(['store-dependent','out-of-stock'].includes(item.availability),`${item.ingredientId}: explicit store-dependent or observed sold-out status`);
  assert.match(item.notes,/門市.*結帳|結帳.*門市/,`${item.ingredientId}: actual store price is disclosed`);
  assert.doesNotMatch(item.notes,/保證現貨|保證有貨|一定有貨/,item.ingredientId);
  if(item.availability==='out-of-stock')assert.match(item.notes,/已售完|缺貨|售罄/,`${item.ingredientId}: unavailable status is retained`);
 }
});

test('verified chicken breast and cabbage retain the product-page prices rather than older search-index prices',()=>{
 const breast=product('breast');
 assert.equal(breast.packageQuantity,290);assert.equal(breast.packageUnit,'g');assert.equal(breast.priceTwd,79);
 assert.match(breast.productName,/雞胸/);assert.match(breast.url,/419931-310781-2631078114313$/);
 const cabbage=product('cabbage');
 assert.equal(cabbage.packageQuantity,1000);assert.equal(cabbage.packageUnit,'g');assert.equal(cabbage.priceTwd,89);
 assert.match(cabbage.productName,/高麗菜/);assert.match(cabbage.url,/417051-110486-2611048614319$/);
});

test('mixed mushrooms are a genuine two-mushroom pack and lemons retain the published count and approximate weight',()=>{
 const mushroom=product('mushroom');
 assert.equal(mushroom.packageQuantity,120);assert.equal(mushroom.priceTwd,35);assert.equal(mushroom.matchType,'exact');
 assert.match(mushroom.productName,/好友菇/);assert.match(mushroom.notes,/鴻喜菇.*雪白菇/);
 const lemon=product('lemon');
 assert.equal(lemon.packageQuantity,4);assert.equal(lemon.packageUnit,'顆');assert.equal(lemon.priceTwd,79);
 assert.match(lemon.packageLabel,/4顆.*約600公克/);
 assert.match(lemon.notes,/不.*固定單顆重量.*換算/);
});

test('canned corn retains the whole multipack price without treating net weight as drained edible solids',()=>{
 const corn=product('corn');
 assert.equal(corn.packageQuantity,300);assert.equal(corn.packageUnit,'g');assert.equal(corn.priceTwd,99);
 assert.equal(corn.priceType,'online-package');
 assert.match(corn.productName,/玉米粒/);assert.match(corn.packageLabel,/150公克.*2罐.*300公克/);
 assert.match(corn.notes,/固形量未公開/);assert.match(corn.notes,/不.*淨重.*瀝乾/);
 assert.match(corn.notes,/整組.*單件促銷價/);
});
