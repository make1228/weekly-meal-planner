import {addDays,getMonday,aggregateShopping} from './engine.js';

const clone=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);

function monday(value){
 if(typeof value!=='string'||getMonday(value)!==value)throw new Error('菜單週次必須是有效的星期一。');
 return value;
}
function flatPlan(plan){
 if(!object(plan)||!Array.isArray(plan.days))throw new Error('菜單資料格式不正確。');
 const {nextWeek,...plain}=clone(plan);
 return plain;
}
function weekEntry(entry,feedback){
 if(!object(entry)||!object(entry.settings)||!object(entry.checked)||!object(entry.plan))throw new Error('每週菜單資料格式不正確。');
 if(own(entry.plan,'nextWeek'))throw new Error('只可保留本週與下一週，不能嵌套歷史菜單。');
 const startDate=monday(entry.plan.startDate);
 if(entry.settings.startDate!==startDate)throw new Error('菜單週次與設定不一致。');
 return {settings:{...clone(entry.settings),feedback:clone(feedback)},plan:flatPlan(entry.plan),checked:clone(entry.checked)};
}
function sourceFeedback(full,defaults={}){
 const feedback=full?.settings?.feedback??defaults.feedback??{};
 if(!object(feedback))throw new Error('料理回饋格式不正確。');
 return clone(feedback);
}
function rootEntry(full,feedback){
 return weekEntry({settings:full.settings,plan:flatPlan(full.plan),checked:full.checked},feedback);
}
function followingEntry(full,feedback){
 const entry=full.plan?.nextWeek;
 if(entry===undefined)return null;
 const result=weekEntry(entry,feedback);
 if(result.plan.startDate!==addDays(monday(full.plan.startDate),7))throw new Error('下一週菜單日期不正確。');
 return result;
}
function inventoryIdentity(items){
 return JSON.stringify([...items].map(item=>({ingredientId:item.ingredientId,quantity:item.quantity})).sort((a,b)=>a.ingredientId.localeCompare(b.ingredientId)));
}
function reconcileWeekChecks(before,after,oldInventory,newInventory){
 const previous=new Map(aggregateShopping(before.plan,oldInventory).map(row=>[row.ingredientId,row.toBuy]));
 const quantities=new Map(aggregateShopping(after.plan,newInventory).map(row=>[row.ingredientId,row.toBuy]));
 after.checked=Object.fromEntries(Object.entries(after.checked).filter(([id,checked])=>checked===true&&(quantities.get(id)||0)>0&&previous.get(id)===quantities.get(id)));
}

/** The caller supplies the local calendar date so retention never depends on UTC. */
export function weekWindow(todayISO){
 if(typeof todayISO!=='string')throw new Error('請提供今天的日期。');
 const current=getMonday(todayISO);
 return [current,addDays(current,7)];
}

/** An unplanned week contains no recipes and never invokes the planner. */
export function emptyWeek(settings,startDate){
 monday(startDate);
 if(!object(settings))throw new Error('菜單設定格式不正確。');
 return {
  settings:{...clone(settings),startDate,feedback:sourceFeedback({settings})},
  plan:{startDate,days:Array.from({length:7},(_,index)=>({date:addDays(startDate,index),weekday:index+1,meals:[]})),unplanned:true,generationId:`unplanned-${startDate}`},
  checked:{}
 };
}

/** Retain exactly the two allowed dates, promoting last week's saved next week. */
export function retainWeeks(full,todayISO,defaults={}){
 if(!object(full)||!object(full.settings)||!Array.isArray(full.inventory))throw new Error('菜單資料格式不正確。');
 const [current,next]=weekWindow(todayISO),feedback=sourceFeedback(full,defaults);
 const fallback={...clone(defaults),...clone(full.settings),feedback};
 const entries=new Map();
 if(full.plan!==null&&full.plan!==undefined){
  const root=rootEntry(full,feedback);entries.set(root.plan.startDate,root);
  const following=followingEntry(full,feedback);if(following)entries.set(following.plan.startDate,following);
 }
 const currentEntry=entries.get(current)||emptyWeek(fallback,current);
 const nextEntry=entries.get(next)||emptyWeek(fallback,next);
 return {version:1,settings:currentEntry.settings,inventory:clone(full.inventory),plan:{...currentEntry.plan,nextWeek:nextEntry},checked:currentEntry.checked};
}

/** Selecting a week creates an independent view; no menu or stored selection changes. */
export function viewWeek(full,startDate){
 monday(startDate);
 const current=monday(full?.plan?.startDate),next=addDays(current,7),feedback=sourceFeedback(full);
 let entry;
 if(startDate===current)entry=rootEntry(full,feedback);
 else if(startDate===next)entry=followingEntry(full,feedback)||emptyWeek(full.settings,next);
 else throw new Error('只能查看本週與下一週的菜單。');
 return {version:1,settings:entry.settings,inventory:clone(full.inventory),plan:entry.plan,checked:entry.checked};
}

/** Save changes to the viewed date while leaving the other week's menu intact. */
export function saveWeekView(full,view){
 if(!object(view)||!object(view.settings)||!Array.isArray(view.inventory)||!object(view.plan))throw new Error('菜單資料格式不正確。');
 const current=monday(full?.plan?.startDate),next=addDays(current,7),feedback=sourceFeedback(view);
 const selected=weekEntry(view,feedback),date=selected.plan.startDate;
 if(date!==current&&date!==next)throw new Error('只能儲存本週與下一週的菜單。');
 const beforeCurrent=rootEntry(full,feedback),beforeNext=followingEntry(full,feedback);
 let currentEntry=beforeCurrent,nextEntry=beforeNext;
 if(date===current)currentEntry=selected;else nextEntry=selected;
 if(inventoryIdentity(full.inventory)!==inventoryIdentity(view.inventory)){
  reconcileWeekChecks(beforeCurrent,currentEntry,full.inventory,view.inventory);
  if(beforeNext&&nextEntry)reconcileWeekChecks(beforeNext,nextEntry,full.inventory,view.inventory);
 }
 const plan={...currentEntry.plan};if(nextEntry)plan.nextWeek=nextEntry;
 return {version:1,settings:currentEntry.settings,inventory:clone(view.inventory),plan,checked:currentEntry.checked};
}
