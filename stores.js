import {COSTCO_PRODUCTS,getCostcoProduct,costcoRecipeWarning} from './costco.js';
import {PX_MART_PRODUCTS} from './pxmart-data.js';

const retailers=[
 {retailerId:'costco',retailerName:'好市多',host:'www.costco.com.tw',products:COSTCO_PRODUCTS},
 {retailerId:'pxmart',retailerName:'全聯',host:'shop.pxgo.com.tw',products:PX_MART_PRODUCTS}
];
const pxmartProducts=new Map(PX_MART_PRODUCTS.map(product=>[product.ingredientId,product]));
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,character=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[character]));

export function getIngredientOffers(ingredientId){
 return retailers.flatMap(retailer=>{
  const product=retailer.retailerId==='costco'?getCostcoProduct(ingredientId):pxmartProducts.get(ingredientId);
  return product?[{...product,retailerId:retailer.retailerId,retailerName:retailer.retailerName}]:[];
 });
}

export function storePriceLabel(offer){
 if(offer.priceTwd===null||offer.priceType==='not-public')return '售價未公開';
 if(typeof offer.priceTwd!=='number'||!Number.isFinite(offer.priceTwd)||offer.priceTwd<=0)throw new TypeError('商品參考價格必須為正數或未公開。');
 const amount=`NT$${offer.priceTwd.toLocaleString('en-US')}`;
 if(offer.priceType==='per-100g')return `${amount}／100g（秤重計價）`;
 if(offer.priceType==='per-kg')return `${amount}／公斤（秤重計價）`;
 return `${amount}／整包裝`;
}

function isRingCutSquid(offer){
 const name=String(offer.productName||''),notes=String(offer.notes||'');
 if(/透抽圈|切圈|輪切/.test(name))return true;
 if(/整尾|全尾|整隻|整支/.test(name))return false;
 return /透抽圈|切圈|輪切/.test(notes)&&!/(?:非|不是|未)切圈/.test(notes);
}

function preparationMessage(offer,recipes){
 const wholeSquidRequired=costcoRecipeWarning(offer.ingredientId,recipes);
 if(wholeSquidRequired&&(offer.retailerId==='costco'||isRingCutSquid(offer)))return {warning:wholeSquidRequired,badgeSuffix:'規格不同'};
 if(wholeSquidRequired&&offer.retailerId==='pxmart'&&/未明示|確認.*完整筒身/.test(String(offer.notes||''))){
  return {warning:'這道需整尾透抽；全聯頁面未明示筒身是否完整，請先確認。',badgeSuffix:'・請確認規格'};
 }
 if(offer.matchType==='substitute')return {warning:String(offer.notes||'商品規格不同，請先確認適合這道料理。'),badgeSuffix:'替代品'};
 return {warning:'',badgeSuffix:''};
}

function officialLink(offer){
 const retailer=retailers.find(item=>item.retailerId===offer.retailerId);
 try{
  const parsed=new URL(offer.url);
  if(retailer&&parsed.protocol==='https:'&&parsed.hostname===retailer.host&&!parsed.username&&!parsed.password)return offer.url;
 }catch{/* A malformed source must never become an executable link. */}
 return null;
}

// Kept separate so the same offer semantics are used by recipe and shopping rows.
export function renderStoreOffer(offer,recipes=[]){
 const {warning,badgeSuffix}=preparationMessage(offer,recipes);
 const soldOut=offer.availability==='out-of-stock';
 const badgeLabel=`${offer.retailerName}${badgeSuffix}${soldOut?'・售完':''}`;
 const fullPrice=storePriceLabel(offer);
 const compactPrice=fullPrice.replace(/／整包裝$|（秤重計價）$/g,'');
 const compactPackage=offer.packageLabel.replace(/公克/g,'g').replace(/公斤/g,'kg').replace(/毫升/g,'ml').replace(/公升/g,'L').replace(/\s*×\s*/g,'×').replace(/（(?:合計|共)/g,'（');
 const href=officialLink(offer);
 const badge=href
  ?`<a class="costco-badge" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(offer.productName)}">${escapeHTML(badgeLabel)} ↗</a>`
  :`<span class="costco-badge">${escapeHTML(badgeLabel)}</span>`;
 const availability=soldOut?'查核時已售完':offer.retailerId==='pxmart'?'依配送門市':'';
 const detailLabel=`${offer.retailerName}商品與備料提醒${warning?`：${badgeSuffix}`:''}${soldOut?'：查核時已售完':''}`;
 return `<div class="costco-offer retailer-offer retailer-${escapeHTML(offer.retailerId)}${warning?' costco-substitute':''}${soldOut?' store-sold-out':''}" data-retailer="${escapeHTML(offer.retailerId)}">${badge}<span class="costco-package" title="${escapeHTML(offer.packageLabel)}">${escapeHTML(compactPackage)}</span><span class="costco-price" title="${escapeHTML(fullPrice)}" aria-label="${escapeHTML(fullPrice)}">${escapeHTML(compactPrice)}</span><details class="costco-details"><summary aria-label="${escapeHTML(detailLabel)}" title="${escapeHTML(warning||detailLabel)}">${warning||soldOut?'⚠':'ⓘ'}</summary><div class="offer-details-content"><strong>${escapeHTML(offer.productName)}</strong><p>${escapeHTML(offer.packageLabel)} · ${escapeHTML(fullPrice)}</p>${availability?`<p class="store-availability">${availability}</p>`:''}${warning?`<p class="costco-prep">${escapeHTML(warning)}</p>`:''}<p>${escapeHTML(offer.notes)}</p><p>查核：${escapeHTML(offer.checkedAt)}</p></div></details></div>`;
}

export function renderIngredientOffers(ingredientId,recipes=[]){
 const offers=getIngredientOffers(ingredientId);
 return offers.length?`<div class="ingredient-offers">${offers.map(offer=>renderStoreOffer(offer,recipes)).join('')}</div>`:'';
}

export function recordsSummary(){
 return retailers.map(({retailerId,retailerName,products})=>({
  retailerId,retailerName,
  ingredients:new Set(products.map(product=>product.ingredientId)).size,
  priced:products.filter(product=>product.priceTwd!==null).length,
  checkedAt:products.map(product=>product.checkedAt).filter(Boolean).sort().at(-1)||null
 }));
}
