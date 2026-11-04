import {COSTCO_PRODUCTS} from './costco-data.js';

export {COSTCO_PRODUCTS};
const products=new Map(COSTCO_PRODUCTS.map(product=>[product.ingredientId,product]));
export const COSTCO_CHECKED_AT='2026-11-04';
export function getCostcoProduct(ingredientId){return products.get(ingredientId)||null;}
export function costcoPriceLabel(product){
 if(product.priceTwd===null)return '售價未公開';
 return `NT$${product.priceTwd.toLocaleString('en-US')}${product.priceType==='per-kg'?'／公斤':'／整包裝'}`;
}
export function costcoSummary(){return {ingredients:products.size,priced:COSTCO_PRODUCTS.filter(product=>product.priceTwd!==null).length};}
export function costcoRecipeWarning(ingredientId,recipes=[]){
 if(ingredientId==='squid'&&recipes.some(recipe=>['it2-spinach-stuffed-squid','tw2-squid-stuffed-egg'].includes(recipe.id)))return '鑲餡料理需要整尾透抽；此商品為透抽圈，不適用這部分用量，請另購整尾。';
 return '';
}
