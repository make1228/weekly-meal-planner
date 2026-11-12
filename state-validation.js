import {INGREDIENTS,getEligibleRecipes,getMonday,addDays,mealDiners,equivalentServings,mealPortionFactor,recipeById,aggregateShopping} from './engine.js';
const ingredients=new Map(INGREDIENTS.map(i=>[i.id,i]));
function validateSingleWeekState(raw){
  if(!raw||raw.version!==1||!raw.settings||!Array.isArray(raw.inventory)||!raw.plan||!raw.checked||typeof raw.checked!=='object'||Array.isArray(raw.checked))throw new Error('備份格式不正確，請選擇由本工具匯出的 JSON 檔案。');
  const s={...raw.settings,weekdayChildren:raw.settings.weekdayChildren??0,weekendChildren:raw.settings.weekendChildren??0,appetite:raw.settings.appetite===undefined?'normal':raw.settings.appetite};
  if(!Array.isArray(s.slots)||new Set(s.slots).size!==s.slots.length||!s.slots.length||!Array.isArray(s.avoid)||s.avoid.some(x=>typeof x!=='string')||!Array.isArray(s.favorites)||s.favorites.some(x=>typeof x!=='string')||!s.feedback||typeof s.feedback!=='object'||Array.isArray(s.feedback))throw new Error('備份中的設定無效，請重新匯出。');
  // Validate settings without generating or replacing any saved meal.
  getEligibleRecipes(s);
  if(raw.plan.startDate!==getMonday(s.startDate)||!Array.isArray(raw.plan.days)||raw.plan.days.length!==7)throw new Error('備份中的週次或菜單不完整。');
  const unplanned=raw.plan.unplanned===true;
  if(raw.plan.unplanned!==undefined&&typeof raw.plan.unplanned!=='boolean')throw new Error('備份中的菜單狀態不正確。');
  if(unplanned&&Object.keys(raw.checked).length)throw new Error('尚未產生的菜單不能含採買勾選。');
  raw.plan.days.forEach((d,index)=>{
    const date=addDays(raw.plan.startDate,index);
    if(d.date!==date||!Array.isArray(d.meals)||d.meals.length!==(unplanned?0:s.slots.length))throw new Error('備份中的餐別或日期不正確。');
    const seen=new Set();
    for(const m of d.meals){const adults=index>=5?s.weekendPeople:s.weekdayPeople,children=index>=5?s.weekendChildren:s.weekdayChildren,diners=mealDiners(m);if(!s.slots.includes(m.slot)||seen.has(m.slot)||m.date!==date||m.key!==`${date}-${m.slot}`||m.servings!==equivalentServings(adults,children)||diners.adults!==adults||diners.children!==children||mealPortionFactor(m)!==(s.appetite==='small'?0.7:1)||!recipeById(m.recipeId)||(m.cooked!==undefined&&typeof m.cooked!=='boolean'))throw new Error('備份中的料理或份量不正確。');const r=recipeById(m.recipeId);if(r.minutes>s.maxMinutes||s.avoid.some(word=>word&&[r.title,r.protein,...r.ingredients.map(i=>ingredients.get(i.ingredientId).name)].some(t=>t.includes(word))))throw new Error('備份中的料理不符合備餐時間或忌口設定。');seen.add(m.slot);}
  });
  aggregateShopping(raw.plan,raw.inventory);
  return {version:1,settings:structuredClone(s),inventory:raw.inventory.map(i=>({ingredientId:i.ingredientId,quantity:Number(i.quantity)})),plan:structuredClone(raw.plan),checked:Object.fromEntries(Object.entries(raw.checked).filter(([k,v])=>ingredients.has(k)&&v===true))};
}
export function validateState(raw){
 const current=validateSingleWeekState(raw),next=raw.plan.nextWeek;
 delete current.plan.nextWeek;
 if(next!==undefined){
  if(!next||typeof next!=='object'||Array.isArray(next)||!next.plan||Object.prototype.hasOwnProperty.call(next.plan,'nextWeek'))throw new Error('備份只能包含本週與下一週。');
  const checkedNext=validateSingleWeekState({version:1,inventory:current.inventory,settings:next.settings,plan:next.plan,checked:next.checked});
  if(checkedNext.plan.startDate!==addDays(current.plan.startDate,7))throw new Error('備份中的下一週日期不正確。');
  current.plan.nextWeek={settings:checkedNext.settings,plan:checkedNext.plan,checked:checkedNext.checked};
 }
 return current;
}
