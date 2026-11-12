import {INGREDIENTS,recipeById,mealIngredientQuantity,formatQty} from './engine.js';
const units=new Map(INGREDIENTS.map(item=>[item.id,item.unit]));
// Only explicit quantities are scaled. Temperatures, times, depths and ratios are ordinary text.
export function formatCookingText(text,meal){
 const recipe=recipeById(meal?.recipeId);
 if(!recipe)throw new Error('找不到料理的份量資料。');
 return String(text).replace(/\{\{([^{}]+)\}\}/g,(_,token)=>{
  const [id,raw,...extra]=token.split(':');
  if(extra.length)throw new Error('無效的作法用量：'+token);
  const factor=raw===undefined?1:Number(raw);
  if(!Number.isFinite(factor)||factor<=0)throw new Error('無效的作法用量：'+token);
  if(id==='water'){
   if(raw===undefined)throw new Error('水量缺少基準值。');
   // Water is a cooking aid, not an inventory or shopping item.
   const scaled=factor*mealIngredientQuantity(meal,recipe.ingredients[0])/recipe.ingredients[0].quantity;
   return formatQty(scaled,'ml')+' ml';
  }
  const item=recipe.ingredients.find(item=>item.ingredientId===id);
  if(!item||!units.has(id))throw new Error(recipe.id+' 作法引用未列入的食材：'+id);
  return formatQty(mealIngredientQuantity(meal,item)*factor,units.get(id))+' '+units.get(id);
 });
}
export const COOKING_REFERENCES=Object.freeze([
 {label:'食物安全溫度參考',url:'https://www.foodsafety.gov/food-safety-charts/safe-minimum-internal-temperatures'},
 {label:'Bosch HSG7584B1 模式說明',url:'https://www.bosch-home-shop.com.tw/products/hsg7584b1'}
]);
export function recipeDoneness(recipe){
 const ids=new Set(recipe.ingredients.map(item=>item.ingredientId)),notes=[];
 if(recipe.details.casserole)notes.push('整份焗烤、填餡或熟飯復熱料理，中心以74°C確認。');
 if(ids.has('chicken')||ids.has('breast'))notes.push('雞肉（含雞肉末）：最厚處／餡心74°C。');
 const ground=recipe.details.ground.filter(id=>['beef','lamb','pork'].includes(id));
 if(ground.length)notes.push('碎牛肉、羊肉或豬肉餡／肉排：中心71°C。');
 if(['beef','lamb','pork'].some(id=>ids.has(id)&&!ground.includes(id)))notes.push('整塊牛、羊、豬肉：最厚處63°C，離火靜置至少3分鐘；填餡料理依上方更高標準。');
 if(['salmon','halibut','seabass'].some(id=>ids.has(id)))notes.push('魚肉：最厚處63°C，魚肉可剝開；熟食復熱與焗烤依上方標準。');
 if(ids.has('egg'))notes.push('蛋料理：中心71°C、蛋液完全凝固；水煮蛋則蛋白與蛋黃均凝固。');
 if(['shrimp','scallop','squid'].some(id=>ids.has(id)))notes.push('蝦、干貝、透抽：中心熟透、不透明；蝦與干貝呈乳白且有彈性。');
 if(ids.has('clams'))notes.push('蛤蜊：煮到開殼，最後仍未開口的不用；湯汁煮沸並過篩。');
 if(!notes.length)notes.push('豆腐、蔬菜與熟製食材中心充分熱透；冷藏剩食復熱至74°C。');
 notes.push('時間為操作起點，以食物溫度計量最厚處；份量變小也不降低安全溫度。');
 return notes;
}
