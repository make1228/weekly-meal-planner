import {INGREDIENTS,aggregateShopping} from './engine.js';

// Shared data deliberately excludes unfinished form input and all device identity.
const ingredientIds=new Set(INGREDIENTS.map(item=>item.id));
const cuisineValues=new Set(['台式','義式','西式','美式']);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);
const sortedUnique=values=>[...new Set(values)].sort();
const orderedSlots=values=>['lunch','dinner'].filter(value=>values.includes(value));
const round=value=>Math.round((value+Number.EPSILON)*100)/100;
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(object(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
const equal=(left,right)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
const present=(value,key)=>own(value,key)?{present:true,value:clone(value[key])}:{present:false};
const equalEntry=(left,right)=>left.present===right.present&&(!left.present||equal(left.value,right.value));
function entryOperation(before,after,key){return {key,before:present(before,key),after:present(after,key)};}
function entryChanges(before,after){return sortedUnique([...Object.keys(before),...Object.keys(after)]).filter(key=>!equalEntry(present(before,key),present(after,key))).map(key=>entryOperation(before,after,key));}
function assignEntry(target,key,entry){if(entry.present)target[key]=clone(entry.value);else delete target[key];}
function isUnsafeKey(key){return ['__proto__','prototype','constructor'].includes(key);}

export class SyncConflictError extends Error{
 constructor(paths){super('另一位家人已更新相同資料。已保留你的操作，請先讀取最新版本後再試一次。');this.name='SyncConflictError';this.code='sync/conflict';this.paths=[...new Set(paths)];}
}

// Invalid or incomplete fields keep their previous cloud value. An empty avoid
// list or cuisine selection is a valid intentional clear; an empty meal list is not.
export function validSharedPreferences(draft,previous={}){
 const result={};
 for(const source of [previous,draft]){
  if(!object(source))continue;
  for(const key of ['weekdayPeople','weekendPeople','maxMinutes','riceMeals','pastaMeals']){
   const raw=source[key],value=Number(raw);
   if((typeof raw!=='number'&&typeof raw!=='string')||String(raw).trim()===''||!Number.isFinite(value))continue;
   const valid=key==='maxMinutes'?value>=5&&value<=180:Number.isInteger(value)&&value>=(key.endsWith('People')?1:0)&&value<=(key.endsWith('People')?12:14);
   if(valid)result[key]=String(value);
  }
  if(Array.isArray(source.slots)&&source.slots.length>0&&source.slots.every(value=>['lunch','dinner'].includes(value)))result.slots=orderedSlots(source.slots);
  if(Array.isArray(source.favorites)&&source.favorites.every(value=>cuisineValues.has(value)))result.favorites=sortedUnique(source.favorites);
  if(typeof source.avoidText==='string'&&source.avoidText.length<=20000)result.avoidText=source.avoidText;
 }
 return result;
}
function normalizeState(raw){
 if(!object(raw)||raw.version!==1||!object(raw.settings)||!Array.isArray(raw.inventory)||!object(raw.plan)||!Array.isArray(raw.plan.days)||!object(raw.checked))throw new TypeError('共用菜單格式不正確。');
 const state=clone(raw);
 for(const key of ['slots','avoid','favorites']){if(!Array.isArray(state.settings[key])||state.settings[key].some(value=>typeof value!=='string'))throw new TypeError('共用餐桌設定格式不正確。');if(key==='slots'&&(!state.settings.slots.length||state.settings.slots.some(value=>!['lunch','dinner'].includes(value))))throw new TypeError('共用餐別格式不正確。');state.settings[key]=key==='slots'?orderedSlots(state.settings.slots):sortedUnique(state.settings[key]);}
 if(!object(state.settings.feedback))throw new TypeError('共用料理回饋格式不正確。');
 state.settings.feedback=Object.fromEntries(Object.entries(state.settings.feedback).filter(([key,value])=>!isUnsafeKey(key)&&object(value)&&Object.keys(value).length).map(([key,value])=>[key,value]));
 const inventory=new Map();
 for(const row of state.inventory){
  if(!object(row)||!ingredientIds.has(row.ingredientId)||typeof row.quantity!=='number'||!Number.isFinite(row.quantity)||row.quantity<0||row.quantity>1000000||inventory.has(row.ingredientId))throw new TypeError('共用冰箱庫存格式不正確。');
  inventory.set(row.ingredientId,round(row.quantity));
 }
 state.inventory=[...inventory].sort(([a],[b])=>a.localeCompare(b)).map(([ingredientId,quantity])=>({ingredientId,quantity}));
 state.checked=Object.fromEntries(Object.entries(state.checked).filter(([key,value])=>ingredientIds.has(key)&&value===true));
 const meals=state.plan.days.flatMap(day=>{if(!object(day)||!Array.isArray(day.meals))throw new TypeError('共用菜單格式不正確。');return day.meals;});
 if(meals.some(meal=>!object(meal)||typeof meal.key!=='string'||isUnsafeKey(meal.key))||new Set(meals.map(meal=>meal.key)).size!==meals.length)throw new TypeError('共用餐點格式不正確。');
 // Reuse recipe/quantity validation and prevent malformed documents reaching merge.
 aggregateShopping(state.plan,state.inventory);
 return state;
}
export function createSharedSnapshot(state,preferences){return {version:1,state:normalizeState(state),preferences:validSharedPreferences(preferences)};}
function normalizeSnapshot(raw){if(!object(raw)||raw.version!==1||!object(raw.preferences))throw new TypeError('共用資料版本不正確。');return createSharedSnapshot(raw.state,raw.preferences);}
function mealMap(plan){return new Map(plan.days.flatMap(day=>day.meals).map(meal=>[meal.key,meal]));}
function planIdentity(plan){const {generatedAt,...stable}=plan;return {...stable,days:plan.days.map(day=>({...day,meals:day.meals.map(meal=>meal.key)}))};}
function appliedSettings(settings){return Object.fromEntries(Object.entries(settings).filter(([key])=>key!=='seed'&&key!=='feedback'));}
function quantities(state){return new Map(aggregateShopping(state.plan,state.inventory).map(row=>[row.ingredientId,row.toBuy]));}
function mutationId(){return globalThis.crypto?.randomUUID?.()||`meal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;}
export const newGenerationId=()=>mutationId();

export function createMutation(baseInput,nextInput,{replacePlan=false,replaceInventory=false}={}){
 const base=normalizeSnapshot(baseInput),next=normalizeSnapshot(nextInput);
 next.preferences=validSharedPreferences(next.preferences,base.preferences);
 const oldMeals=mealMap(base.state.plan),newMeals=mealMap(next.state.plan);
 const changedMeals=[...newMeals].filter(([key,value])=>!equal(value,oldMeals.get(key)));
 const wholePlan=replacePlan||!equal(planIdentity(base.state.plan),planIdentity(next.state.plan))||changedMeals.length>1||!equal(appliedSettings(base.state.settings),appliedSettings(next.state.settings));
 const settings=entryChanges(appliedSettings(base.state.settings),appliedSettings(next.state.settings));
 const feedback=[];
 const oldFeedback=base.state.settings.feedback,newFeedback=next.state.settings.feedback;
 for(const recipeId of sortedUnique([...Object.keys(oldFeedback),...Object.keys(newFeedback)]))for(const operation of entryChanges(oldFeedback[recipeId]||{},newFeedback[recipeId]||{}))feedback.push({recipeId,...operation});
 const oldInventory=Object.fromEntries(base.state.inventory.map(row=>[row.ingredientId,row.quantity])),newInventory=Object.fromEntries(next.state.inventory.map(row=>[row.ingredientId,row.quantity]));
 const inventory=entryChanges(oldInventory,newInventory).map(operation=>({...operation,delta:!replaceInventory&&operation.after.present&&operation.after.value>(operation.before.present?operation.before.value:0)?round(operation.after.value-(operation.before.present?operation.before.value:0)):null}));
 const nextQuantities=quantities(next.state);
 const checked=entryChanges(base.state.checked,next.state.checked).map(operation=>({...operation,week:next.state.plan.startDate,quantity:nextQuantities.get(operation.key)||0}));
 const mutation={version:1,id:mutationId(),plan:wholePlan?{before:base.state.plan,after:next.state.plan,settings:appliedSettings(base.state.settings)}:null,context:planIdentity(base.state.plan),meals:wholePlan?[]:changedMeals.map(([key,value])=>({key,before:oldMeals.get(key),after:value})),settings,feedback,inventory,preferences:entryChanges(base.preferences,next.preferences),checked,planTimestamp:next.state.plan.generatedAt||null,seedDelta:Number(next.state.settings.seed||0)-Number(base.state.settings.seed||0)};
 return mutation;
}
export function hasMutation(mutation){return !!(mutation.plan&&!equal(mutation.plan.before,mutation.plan.after)||['meals','settings','feedback','inventory','preferences','checked'].some(key=>mutation[key]?.length)||mutation.seedDelta);}
function mergeEntries(target,operations,prefix,conflicts){
 for(const operation of operations){
  if(isUnsafeKey(operation.key)){conflicts.push(`${prefix}.${operation.key}`);continue;}
  const current=present(target,operation.key);
  if(!equalEntry(current,operation.before)&&!equalEntry(current,operation.after)){conflicts.push(`${prefix}.${operation.key}`);continue;}
  assignEntry(target,operation.key,operation.after);
 }
}

export function applyMutation(latestInput,mutation){
 if(!object(mutation)||mutation.version!==1||!['meals','settings','feedback','inventory','preferences','checked'].every(key=>Array.isArray(mutation[key])))throw new TypeError('同步操作格式不正確。');
 const latest=normalizeSnapshot(latestInput),result=clone(latest),conflicts=[];
 const beforeQuantities=quantities(latest.state),beforeWeek=latest.state.plan.startDate;
 if(mutation.plan){
  if(!equal(latest.state.plan,mutation.plan.before)||!equal(appliedSettings(latest.state.settings),mutation.plan.settings))conflicts.push('plan');
  else result.state.plan=clone(mutation.plan.after);
 }else if(mutation.meals.length){
  if(!equal(planIdentity(latest.state.plan),mutation.context))conflicts.push('plan');
  else{
   const currentMeals=mealMap(result.state.plan);
   for(const operation of mutation.meals){
    const current=currentMeals.get(operation.key);
    if(!current||(!equal(current,operation.before)&&!equal(current,operation.after))){conflicts.push(`meal.${operation.key}`);continue;}
    for(const day of result.state.plan.days){const index=day.meals.findIndex(meal=>meal.key===operation.key);if(index>=0)day.meals[index]=clone(operation.after);}
   }
  }
 }
 if(!mutation.plan&&mutation.meals.length&&typeof mutation.planTimestamp==='string'&&mutation.planTimestamp>String(result.state.plan.generatedAt||''))result.state.plan.generatedAt=mutation.planTimestamp;
 mergeEntries(result.state.settings,mutation.settings,'settings',conflicts);
 for(const operation of mutation.feedback){
  if(isUnsafeKey(operation.recipeId)){conflicts.push('feedback');continue;}
  result.state.settings.feedback[operation.recipeId]??={};
  mergeEntries(result.state.settings.feedback[operation.recipeId],[operation],`feedback.${operation.recipeId}`,conflicts);
 }
 const inventory=Object.fromEntries(result.state.inventory.map(row=>[row.ingredientId,row.quantity]));
 for(const operation of mutation.inventory){
  if(!ingredientIds.has(operation.key)){conflicts.push('inventory');continue;}
  if(operation.delta!==null){
   const before=operation.before.present?operation.before.value:0,current=own(inventory,operation.key)?inventory[operation.key]:0,total=round(current+operation.delta);
   // An addition can merge with another addition, but must not resurrect stock
   // that the other person removed or reduced while this device was offline.
   if(!Number.isFinite(operation.delta)||operation.delta<=0||current<before||total>1000000)conflicts.push(`inventory.${operation.key}`);
   else inventory[operation.key]=total;
  }else mergeEntries(inventory,[operation],'inventory',conflicts);
 }
 result.state.inventory=Object.entries(inventory).map(([ingredientId,quantity])=>({ingredientId,quantity}));
 mergeEntries(result.preferences,mutation.preferences,'preferences',conflicts);
 if(conflicts.length)throw new SyncConflictError(conflicts);
 if(!Number.isFinite(mutation.seedDelta))throw new TypeError('同步隨機種子格式不正確。');
 result.state.settings.seed=Number(result.state.settings.seed||0)+mutation.seedDelta;
 const afterQuantities=quantities(result.state),afterWeek=result.state.plan.startDate;
 result.state.checked=Object.fromEntries(Object.entries(latest.state.checked).filter(([key,value])=>value===true&&beforeWeek===afterWeek&&(afterQuantities.get(key)||0)>0&&beforeQuantities.get(key)===afterQuantities.get(key)));
 for(const operation of mutation.checked){
  if(!ingredientIds.has(operation.key))continue;
  if(operation.week!==afterWeek||(afterQuantities.get(operation.key)||0)!==operation.quantity)continue;
  if(!operation.after.present||operation.after.value!==true)delete result.state.checked[operation.key];
  else if(operation.quantity>0)result.state.checked[operation.key]=true;
 }
 return normalizeSnapshot(result);
}
