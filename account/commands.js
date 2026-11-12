import {generatePlan,replaceMeal,setMealCooked,setPlanDiners,aggregateShopping,recipeById} from '../engine.js';
import {viewWeek,saveWeekView,weekWindow,retainWeeks} from '../weeks.js';
import {draftToSettings,settingsToDraft} from '../preferences.js';
import {createSharedSnapshot,createMutation,validSharedPreferences,newGenerationId} from '../sync-model.js';
import {validateAccountSnapshot,taipeiDate,publicDefaults} from './model.js';
// iOS sends intent against a known snapshot. The server uses the same engine and
// field-level mutation merger as the website; it never silently replaces stale state.
export function commandMutation(request,today=taipeiDate()){
 const {baseSnapshot,baseRevision,id,type,payload={}}=request;
 const before=validateAccountSnapshot(baseSnapshot),next=structuredClone(before);
 let replacePlan=false,replaceInventory=false;
 const week=payload.week||next.state.plan.startDate;
 if(!weekWindow(today).includes(week))throw new Error('只可修改本週與下一週。');
 let view=viewWeek(next.state,week);
 const beforeQuantities=new Map(weekWindow(today).map(date=>[date,new Map(aggregateShopping(viewWeek(before.state,date).plan,before.state.inventory).map(row=>[row.ingredientId,row.toBuy]))]));
 switch(type){
  case 'generate':{
   const settings={...view.settings,...draftToSettings(next.preferences,view.settings),startDate:week,seed:(view.settings.seed||0)+1};
   view.settings=settings;view.plan=generatePlan(settings,next.state.inventory,view.plan);view.plan.generationId=newGenerationId();view.checked={};replacePlan=true;break;
  }
  case 'swap': view.plan=replaceMeal(view.plan,payload.mealKey,view.settings,next.state.inventory,payload.recipeId);break;
  case 'cooked': if(typeof payload.cooked!=='boolean')throw new Error('已煮標記不正確。');view.plan=setMealCooked(view.plan,payload.mealKey,payload.cooked);break;
  case 'inventoryAdd':{
   const q=Number(payload.quantity),item=next.state.inventory.find(x=>x.ingredientId===payload.ingredientId);
   if(!Number.isFinite(q)||q<=0||q>100000)throw new Error('庫存數量不正確。');
   if(item)item.quantity=Math.round((item.quantity+q)*100)/100;else next.state.inventory.push({ingredientId:payload.ingredientId,quantity:q});
   view.inventory=next.state.inventory;break;
  }
  case 'inventoryRemove':next.state.inventory=next.state.inventory.filter(x=>x.ingredientId!==payload.ingredientId);view.inventory=next.state.inventory;break;
  case 'checked':if(payload.checked===true){if(!aggregateShopping(view.plan,next.state.inventory).some(x=>x.ingredientId===payload.ingredientId&&x.toBuy>0))throw new Error('這項食材目前不需採買。');view.checked[payload.ingredientId]=true;}else if(payload.checked===false)delete view.checked[payload.ingredientId];else throw new Error('勾選格式不正確。');break;
  case 'preferences':{
   next.preferences=validSharedPreferences(payload.preferences,next.preferences);
   const newSettings=draftToSettings(next.preferences,view.settings);
   // Only headcounts and appetite immediately alter saved menus; other fields
   // remain drafts until Generate, exactly as on the website.
   const adultsChanged=['weekdayPeople','weekendPeople','weekdayChildren','weekendChildren','appetite'].some(k=>newSettings[k]!==view.settings[k]);
   if(adultsChanged){
    for(const currentWeek of weekWindow(today)){
     const v=viewWeek(next.state,currentWeek),s={...v.settings};
     for(const k of ['weekdayPeople','weekendPeople','weekdayChildren','weekendChildren','appetite'])s[k]=newSettings[k];
     v.settings=s;v.plan=setPlanDiners(v.plan,s);next.state=saveWeekView(next.state,v);
    }
    view=viewWeek(next.state,week);
   }
   break;
  }
  case 'feedback':if(!recipeById(payload.recipeId))throw new Error('料理不存在。');view.settings.feedback[payload.recipeId]=payload.feedback;break;
  default:throw new Error('不支援的菜單操作。');
 }
 next.state=saveWeekView(next.state,view);
 if(['inventoryAdd','inventoryRemove','cooked','swap'].includes(type)){
  for(const currentWeek of weekWindow(today)){
   const v=viewWeek(next.state,currentWeek),shopping=aggregateShopping(v.plan,next.state.inventory);
   v.checked=Object.fromEntries(Object.entries(v.checked).filter(([key])=>shopping.some(x=>x.ingredientId===key&&x.toBuy>0&&beforeQuantities.get(currentWeek).get(key)===x.toBuy)));
   next.state=saveWeekView(next.state,v);
  }
 }
 const checked=validateAccountSnapshot(next);
 return {...createMutation(before,checked,{replacePlan,replaceInventory}),id,baseRevision};
}
