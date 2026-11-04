import {INGREDIENTS,aggregateShopping,equivalentServings,addDays} from './engine.js';

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
  const before={...result};
  for(const key of ['weekdayPeople','weekendPeople','weekdayChildren','weekendChildren','maxMinutes','riceMeals','pastaMeals']){
   const raw=source[key],value=Number(raw);
   if((typeof raw!=='number'&&typeof raw!=='string')||String(raw).trim()===''||!Number.isFinite(value))continue;
   const valid=key==='maxMinutes'?value>=5&&value<=180:Number.isInteger(value)&&value>=0&&value<=(key.endsWith('People')||key.endsWith('Children')?12:14);
   if(valid)result[key]=String(value);
  }
  // A child-only household is valid, but an empty household remains an
  // unfinished device draft until one of its headcounts becomes positive.
  for(const prefix of ['weekday','weekend']){
   const adults=`${prefix}People`,children=`${prefix}Children`;
   if(own(result,adults)&&Number(result[adults])+Number(result[children]??0)===0)for(const key of [adults,children]){if(own(before,key))result[key]=before[key];else delete result[key];}
  }
  if(Array.isArray(source.slots)&&source.slots.length>0&&source.slots.every(value=>['lunch','dinner'].includes(value)))result.slots=orderedSlots(source.slots);
  if(Array.isArray(source.favorites)&&source.favorites.every(value=>cuisineValues.has(value)))result.favorites=sortedUnique(source.favorites);
  if(['normal','small'].includes(source.appetite))result.appetite=source.appetite;
  if(typeof source.avoidText==='string'&&source.avoidText.length<=20000)result.avoidText=source.avoidText;
 }
 return result;
}
function normalizeState(raw){
 if(!object(raw)||raw.version!==1||!object(raw.settings)||!Array.isArray(raw.inventory)||!object(raw.plan)||!Array.isArray(raw.plan.days)||!object(raw.checked))throw new TypeError('共用菜單格式不正確。');
 const state=clone(raw);
 if(state.settings.appetite===undefined)state.settings.appetite='normal';
 if(!['normal','small'].includes(state.settings.appetite))throw new TypeError('共用食量設定格式不正確。');
 for(const prefix of ['weekday','weekend']){
  if(state.settings[`${prefix}Children`]===undefined)state.settings[`${prefix}Children`]=0;
  try{equivalentServings(state.settings[`${prefix}People`],state.settings[`${prefix}Children`]);}catch{throw new TypeError('共用大人與小孩人數格式不正確。');}
 }
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
 if(own(state.plan,'nextWeek')){
  const entry=state.plan.nextWeek;
  if(!object(entry)||Object.keys(entry).some(key=>!['settings','plan','checked'].includes(key))||!object(entry.plan)||own(entry.plan,'nextWeek')||entry.plan.startDate!==addDays(state.plan.startDate,7)||entry.settings?.startDate!==entry.plan.startDate)throw new TypeError('下一週共用菜單格式不正確。');
  const following=normalizeState({version:1,settings:entry.settings,inventory:state.inventory,plan:entry.plan,checked:entry.checked});
  following.settings.feedback=clone(state.settings.feedback);
  state.plan.nextWeek={settings:following.settings,plan:following.plan,checked:following.checked};
 }
 return state;
}
export function createSharedSnapshot(state,preferences){
 const normalizedState=normalizeState(state),normalizedPreferences=validSharedPreferences(preferences);
 if(!own(normalizedPreferences,'appetite'))normalizedPreferences.appetite=normalizedState.settings.appetite;
 for(const key of ['weekdayChildren','weekendChildren'])if(!own(normalizedPreferences,key))normalizedPreferences[key]=String(normalizedState.settings[key]);
 return {version:1,state:normalizedState,preferences:normalizedPreferences};
}
function normalizeSnapshot(raw){if(!object(raw)||raw.version!==1||!object(raw.preferences))throw new TypeError('共用資料版本不正確。');return createSharedSnapshot(raw.state,raw.preferences);}
function mealMap(plan){return new Map(plan.days.flatMap(day=>day.meals).map(meal=>[meal.key,meal]));}
function planIdentity(plan){const {generatedAt,...stable}=plan;return {...stable,days:plan.days.map(day=>({...day,meals:day.meals.map(meal=>meal.key)}))};}
function appliedSettings(settings){return Object.fromEntries(Object.entries(settings).filter(([key])=>key!=='seed'&&key!=='feedback'));}
function quantities(state){return new Map(aggregateShopping(state.plan,state.inventory).map(row=>[row.ingredientId,row.toBuy]));}
function mutationId(){return globalThis.crypto?.randomUUID?.()||`meal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;}
export const newGenerationId=()=>mutationId();

// The following week is metadata inside plan for the existing Firestore schema,
// but it has an independent menu identity and compare-and-swap operations.
function weekOnly(state){
 const {nextWeek,...plan}=state.plan;
 return {settings:clone(state.settings),plan:clone(plan),checked:clone(state.checked)};
}
function nextWeekOnly(state){
 const entry=state.plan.nextWeek;if(!entry)return null;
 const result=clone(entry);result.settings.feedback={};return result;
}
function weekQuantities(week,inventory){return quantities({...week,inventory});}
function createWeekMutation(before,after,beforeInventory,afterInventory,{replacePlan=false}={}){
 const oldMeals=mealMap(before.plan),newMeals=mealMap(after.plan);
 const changedMeals=[...newMeals].filter(([key,value])=>!equal(value,oldMeals.get(key)));
 const wholePlan=replacePlan||!equal(planIdentity(before.plan),planIdentity(after.plan))||changedMeals.length>1||!equal(appliedSettings(before.settings),appliedSettings(after.settings));
 const nextQuantities=weekQuantities(after,afterInventory);
 return {
  plan:wholePlan?{before:before.plan,after:after.plan,settings:appliedSettings(before.settings)}:null,
  context:planIdentity(before.plan),
  meals:wholePlan?[]:changedMeals.map(([key,value])=>({key,before:oldMeals.get(key),after:value})),
  settings:entryChanges(appliedSettings(before.settings),appliedSettings(after.settings)),
  checked:entryChanges(before.checked,after.checked).map(operation=>({...operation,week:after.plan.startDate,quantity:nextQuantities.get(operation.key)||0})),
  planTimestamp:after.plan.generatedAt||null,
  seedDelta:Number(after.settings.seed||0)-Number(before.settings.seed||0)
 };
}
function hasWeekMutation(mutation){return !!(mutation.plan&&!equal(mutation.plan.before,mutation.plan.after)||['meals','settings','checked'].some(key=>mutation[key]?.length)||mutation.seedDelta);}
export function createMutation(baseInput,nextInput,{replacePlan=false,replaceInventory=false}={}){
 const base=normalizeSnapshot(baseInput),next=normalizeSnapshot(nextInput);
 // Fields absent from a partial/older client draft are unchanged, never an
 // implicit request to reset another household member's newer preferences.
 for(const key of ['appetite','weekdayChildren','weekendChildren'])if(!own(nextInput.preferences,key))delete next.preferences[key];
 next.preferences=validSharedPreferences(next.preferences,base.preferences);
 const beforeCurrent=weekOnly(base.state),afterCurrent=weekOnly(next.state);
 const forceCurrent=replacePlan&&(!equal(beforeCurrent.plan,afterCurrent.plan)||!equal(appliedSettings(beforeCurrent.settings),appliedSettings(afterCurrent.settings)));
 const current=createWeekMutation(beforeCurrent,afterCurrent,base.state.inventory,next.state.inventory,{replacePlan:forceCurrent});
 const feedback=[];
 const oldFeedback=base.state.settings.feedback,newFeedback=next.state.settings.feedback;
 for(const recipeId of sortedUnique([...Object.keys(oldFeedback),...Object.keys(newFeedback)]))for(const operation of entryChanges(oldFeedback[recipeId]||{},newFeedback[recipeId]||{}))feedback.push({recipeId,...operation});
 const oldInventory=Object.fromEntries(base.state.inventory.map(row=>[row.ingredientId,row.quantity])),newInventory=Object.fromEntries(next.state.inventory.map(row=>[row.ingredientId,row.quantity]));
 const inventory=entryChanges(oldInventory,newInventory).map(operation=>({...operation,delta:!replaceInventory&&operation.after.present&&operation.after.value>(operation.before.present?operation.before.value:0)?round(operation.after.value-(operation.before.present?operation.before.value:0)):null}));
 const mutation={version:1,id:mutationId(),...current,feedback,inventory,preferences:entryChanges(base.preferences,next.preferences)};
 const beforeNext=nextWeekOnly(base.state),afterNext=nextWeekOnly(next.state);
 // An omitted nextWeek from an older/partial client is unchanged. Retention
 // shifts the current anchor and supplies a new entry instead of deleting it.
 if(beforeNext&&afterNext){
  const following=createWeekMutation(beforeNext,afterNext,base.state.inventory,next.state.inventory,{replacePlan:false});
  if(hasWeekMutation(following))mutation.nextWeek={kind:'update',mutation:following};
 }else if(afterNext){
  mutation.nextWeek={kind:'replace',before:{present:false},after:{present:true,value:afterNext}};
 }
 return mutation;
}
export function hasMutation(mutation){return !!(hasWeekMutation(mutation)||['feedback','inventory','preferences'].some(key=>mutation[key]?.length)||mutation.nextWeek);}
function mergeEntries(target,operations,prefix,conflicts){
 for(const operation of operations){
  if(isUnsafeKey(operation.key)){conflicts.push(`${prefix}.${operation.key}`);continue;}
  const current=present(target,operation.key);
  if(!equalEntry(current,operation.before)&&!equalEntry(current,operation.after)){conflicts.push(`${prefix}.${operation.key}`);continue;}
  assignEntry(target,operation.key,operation.after);
 }
}

function applyWeekMutation(week,mutation,conflicts,prefix=''){
 if(!object(mutation)||!['meals','settings','checked'].every(key=>Array.isArray(mutation[key]))||!Number.isFinite(mutation.seedDelta))throw new TypeError('同步餐週操作格式不正確。');
 if(mutation.plan){
  if(!equal(week.plan,mutation.plan.before)||!equal(appliedSettings(week.settings),mutation.plan.settings))conflicts.push(`${prefix}plan`);
  else week.plan=clone(mutation.plan.after);
 }else if(mutation.meals.length){
  if(!equal(planIdentity(week.plan),mutation.context))conflicts.push(`${prefix}plan`);
  else{
   const currentMeals=mealMap(week.plan);
   for(const operation of mutation.meals){
    const current=currentMeals.get(operation.key);
    if(!current||(!equal(current,operation.before)&&!equal(current,operation.after))){conflicts.push(`${prefix}meal.${operation.key}`);continue;}
    for(const day of week.plan.days){const index=day.meals.findIndex(meal=>meal.key===operation.key);if(index>=0)day.meals[index]=clone(operation.after);}
   }
  }
 }
 if(!mutation.plan&&mutation.meals.length&&typeof mutation.planTimestamp==='string'&&mutation.planTimestamp>String(week.plan.generatedAt||''))week.plan.generatedAt=mutation.planTimestamp;
 mergeEntries(week.settings,mutation.settings,`${prefix}settings`,conflicts);
 week.settings.seed=Number(week.settings.seed||0)+mutation.seedDelta;
}
function reconcileWeekChecks(before,after,beforeInventory,afterInventory,operations=[]){
 const oldQuantities=weekQuantities(before,beforeInventory),newQuantities=weekQuantities(after,afterInventory),sameWeek=before.plan.startDate===after.plan.startDate;
 after.checked=Object.fromEntries(Object.entries(before.checked).filter(([key,value])=>value===true&&sameWeek&&(newQuantities.get(key)||0)>0&&oldQuantities.get(key)===newQuantities.get(key)));
 for(const operation of operations){
  if(!ingredientIds.has(operation.key)||operation.week!==after.plan.startDate||(newQuantities.get(operation.key)||0)!==operation.quantity)continue;
  if(!operation.after.present||operation.after.value!==true)delete after.checked[operation.key];
  else if(operation.quantity>0)after.checked[operation.key]=true;
 }
}
export function applyMutation(latestInput,mutation){
 if(!object(mutation)||mutation.version!==1||!['meals','settings','feedback','inventory','preferences','checked'].every(key=>Array.isArray(mutation[key])))throw new TypeError('同步操作格式不正確。');
 const latest=normalizeSnapshot(latestInput),result=clone(latest),conflicts=[];
 const currentBefore=weekOnly(latest.state),current=clone(currentBefore),followingBefore=nextWeekOnly(latest.state);
 let following=clone(followingBefore),followingChecks=[];
 applyWeekMutation(current,mutation,conflicts);
 const nextOperation=mutation.nextWeek;
 if(nextOperation){
  if(nextOperation.kind==='update'){
   if(!following)conflicts.push('nextWeek.plan');
   else{applyWeekMutation(following,nextOperation.mutation,conflicts,'nextWeek.');followingChecks=nextOperation.mutation.checked;}
  }else if(nextOperation.kind==='replace'){
   const currentEntry=following?{present:true,value:following}:{present:false};
   if(!equalEntry(currentEntry,nextOperation.before)&&!equalEntry(currentEntry,nextOperation.after))conflicts.push('nextWeek.plan');
   else following=nextOperation.after.present?clone(nextOperation.after.value):null;
  }else throw new TypeError('下一週同步操作格式不正確。');
 }
 result.state.settings=current.settings;result.state.plan=current.plan;result.state.checked=current.checked;
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
 // Two individually valid edits cannot combine into an empty household.
 for(const prefix of ['weekday','weekend']){
  const adults=`${prefix}People`,children=`${prefix}Children`;
  if(own(result.preferences,adults)&&own(result.preferences,children)&&Number(result.preferences[adults])+Number(result.preferences[children])===0)conflicts.push(`preferences.${adults}`,`preferences.${children}`);
 }
 if(conflicts.length)throw new SyncConflictError(conflicts);
 // Retention can promote the saved following week into the current slot.
 // Reconcile by the calendar date, not by the previous slot's position.
 const previousWeeks=[currentBefore,followingBefore].filter(Boolean);
 const previousCurrent=previousWeeks.find(week=>week.plan.startDate===current.plan.startDate)||currentBefore;
 reconcileWeekChecks(previousCurrent,current,latest.state.inventory,result.state.inventory,mutation.checked);
 result.state.checked=current.checked;
 if(following){
  const previousFollowing=previousWeeks.find(week=>week.plan.startDate===following.plan.startDate)||followingBefore;
  if(previousFollowing)reconcileWeekChecks(previousFollowing,following,latest.state.inventory,result.state.inventory,followingChecks);
  else{
   const needed=weekQuantities(following,result.state.inventory);
   following.checked=Object.fromEntries(Object.entries(following.checked).filter(([key,value])=>value===true&&(needed.get(key)||0)>0));
  }
  following.settings.feedback=clone(result.state.settings.feedback);
  result.state.plan.nextWeek=following;
 }
 return normalizeSnapshot(result);
}
