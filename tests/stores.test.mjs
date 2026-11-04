import test from 'node:test';
import assert from 'node:assert/strict';
import {COSTCO_PRODUCTS} from '../costco.js';
import {PX_MART_PRODUCTS} from '../pxmart-data.js';
import {getIngredientOffers,storePriceLabel,renderStoreOffer,renderIngredientOffers,recordsSummary} from '../stores.js';

const fixture={
 ingredientId:'breast',retailerId:'pxmart',retailerName:'全聯',
 productName:'原味雞胸肉',url:'https://shop.pxgo.com.tw/hourArrive/goods/example',
 packageLabel:'290g／包',packageQuantity:290,packageUnit:'g',priceTwd:79,
 priceType:'online-package',checkedAt:'2026-11-04',matchType:'exact',
 availability:'store-dependent',notes:'網頁參考價，依配送門市結帳為準。'
};

test('shared ingredient shows independent Costco and PX Mart products in a stable order',()=>{
 const shared=PX_MART_PRODUCTS.find(product=>COSTCO_PRODUCTS.some(costco=>costco.ingredientId===product.ingredientId));
 assert.ok(shared,'the catalog contains products available from both retailers');
 const offers=getIngredientOffers(shared.ingredientId);
 assert.deepEqual(offers.map(offer=>offer.retailerId),['costco','pxmart']);
 assert.deepEqual(offers.map(offer=>offer.retailerName),['好市多','全聯']);
 assert.equal(offers[0].url,COSTCO_PRODUCTS.find(product=>product.ingredientId===shared.ingredientId).url);
 assert.equal(offers[1].url,shared.url);
 assert.equal(offers[1].packageLabel,shared.packageLabel);
 assert.equal(offers[1].priceTwd,shared.priceTwd);
 const html=renderIngredientOffers(shared.ingredientId);
 assert.equal((html.match(/data-retailer=/g)||[]).length,2);
 assert.ok(html.indexOf('data-retailer="costco"')<html.indexOf('data-retailer="pxmart"'));
 assert.match(html,/好市多/);assert.match(html,/全聯/);
 assert.match(html,/target="_blank" rel="noopener noreferrer"/);
});

test('a missing retailer never hides the other retailer or invents a product match',()=>{
 for(const product of [...COSTCO_PRODUCTS,...PX_MART_PRODUCTS]){
  const offers=getIngredientOffers(product.ingredientId);
  assert.ok(offers.some(offer=>offer.url===product.url),product.ingredientId);
 }
 assert.deepEqual(getIngredientOffers('unknown-ingredient'),[]);
 assert.equal(renderIngredientOffers('unknown-ingredient'),'');
});

test('whole packages, unpublished amounts and weighed prices retain their distinct meaning',()=>{
 assert.equal(storePriceLabel(fixture),'NT$79／整包裝');
 assert.equal(storePriceLabel({...fixture,priceTwd:132,priceType:'per-100g'}),'NT$132／100g（秤重計價）');
 assert.equal(storePriceLabel({...fixture,priceTwd:500,priceType:'per-kg'}),'NT$500／公斤（秤重計價）');
 assert.equal(storePriceLabel({...fixture,priceTwd:null,priceType:'not-public'}),'售價未公開');
 for(const priceTwd of [0,-1,NaN,Infinity,'79'])assert.throws(()=>storePriceLabel({...fixture,priceTwd}),TypeError);
 const html=renderStoreOffer({...fixture,priceTwd:null,priceType:'not-public'});
 assert.match(html,/290g／包 · 售價未公開/);assert.doesNotMatch(html,/NT\$0/);
});

test('sold-out and substitute products retain visible status outside the disclosure',()=>{
 const html=renderStoreOffer({...fixture,availability:'out-of-stock',matchType:'substitute',notes:'須先吐沙2–3小時，非已吐沙商品。'});
 const visible=html.split('<details')[0];
 assert.match(visible,/全聯替代品/);
 assert.match(visible,/查核時已售完/);
 assert.match(visible,/須先吐沙2–3小時/);
 assert.match(renderStoreOffer(fixture),/依配送門市/);
});

test('ring-cut squid warns for filled recipes while whole PX Mart squid remains suitable',()=>{
 const recipes=[{id:'it2-spinach-stuffed-squid'}];
 const rings={...fixture,ingredientId:'squid',productName:'透抽圈 350g',notes:'已切圈。'};
 assert.match(renderStoreOffer(rings,recipes).split('<details')[0],/規格不同.*整尾透抽.*不適用/);
 const whole={...rings,productName:'整尾透抽 350g',notes:'整尾，非切圈。'};
 assert.doesNotMatch(renderStoreOffer(whole,recipes).split('<details')[0],/規格不同|不適用/);
 const unknown={...rings,productName:'船凍透抽 230g',notes:'官網未明示筒身完整狀況，做鑲餡料理前請確認完整筒身。'};
 const unknownVisible=renderStoreOffer(unknown,recipes).split('<details')[0];
 assert.match(unknownVisible,/全聯・請確認規格/);
 assert.match(unknownVisible,/這道需整尾透抽；全聯頁面未明示筒身是否完整，請先確認。/);
 assert.doesNotMatch(unknownVisible,/不適用/);
 assert.doesNotMatch(renderStoreOffer(rings,[{id:'it2-squid-basil-pasta'}]).split('<details')[0],/規格不同|不適用/);
 const costco={...rings,retailerId:'costco',retailerName:'好市多',url:'https://www.costco.com.tw/p/123'};
 assert.match(renderStoreOffer(costco,recipes),/另購整尾/);
});

test('pre-purged PX Mart clams do not inherit another retailer preparation warning',()=>{
 const clams={...fixture,ingredientId:'clams',productName:'文蛤真空包 300g',notes:'處理廠經吐沙後真空包裝。'};
 const pxVisible=renderStoreOffer(clams).split('<details')[0];
 assert.doesNotMatch(pxVisible,/替代品|costco-prep|需先吐沙/);
 const costco={...clams,retailerId:'costco',retailerName:'好市多',url:'https://www.costco.com.tw/p/123',matchType:'substitute',notes:'需先吐沙2–3小時。'};
 assert.match(renderStoreOffer(costco).split('<details')[0],/好市多替代品.*需先吐沙2–3小時/);
});

test('offer text is escaped and unsafe or unexpected source URLs never become links',()=>{
 const hostile={...fixture,
  retailerName:'全聯<script>alert(1)</script>',
  productName:'雞胸" onmouseover="alert(1)',packageLabel:'<img src=x onerror=alert(1)>',
  notes:'</p><script>alert(1)</script>',url:'https://shop.pxgo.com.tw/hourArrive/goods/example?q="<tag>'
 };
 const html=renderStoreOffer(hostile);
 assert.doesNotMatch(html,/<script|<img|<tag/);
 assert.match(html,/&lt;script&gt;/);assert.match(html,/&quot; onmouseover=&quot;/);
 assert.match(html,/href="https:\/\/shop\.pxgo\.com\.tw\/hourArrive\/goods\/example\?q=&quot;&lt;tag&gt;"/);
 for(const url of ['javascript:alert(1)','data:text/html,<script>alert(1)</script>','https://attacker.example/product','https://user:secret@shop.pxgo.com.tw/product','not-a-url']){
  const result=renderStoreOffer({...fixture,url});
  assert.doesNotMatch(result,/<a\b|href=/,url);
  assert.match(result,/全聯/);
 }
});

test('per-retailer summaries count verified product coverage and public prices independently',()=>{
 const summaries=recordsSummary();
 assert.deepEqual(summaries.map(summary=>summary.retailerId),['costco','pxmart']);
 for(const [index,products] of [COSTCO_PRODUCTS,PX_MART_PRODUCTS].entries()){
  assert.equal(summaries[index].ingredients,new Set(products.map(product=>product.ingredientId)).size);
  assert.equal(summaries[index].priced,products.filter(product=>product.priceTwd!==null).length);
  assert.equal(summaries[index].checkedAt,products.map(product=>product.checkedAt).filter(Boolean).sort().at(-1)||null);
 }
});
