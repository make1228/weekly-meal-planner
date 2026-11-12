import {DEFAULT_SETTINGS,getMonday,addDays,RECIPES,INGREDIENTS,getEligibleRecipes} from '../engine.js';
import {emptyWeek,retainWeeks,weekWindow} from '../weeks.js';
import {settingsToDraft} from '../preferences.js';
import {createSharedSnapshot} from '../sync-model.js';
import {validateState} from '../state-validation.js';
export const SCHEMA_VERSION=2;
export const PRODUCT_ID='weekly-meal-planner';
export const MAX_SNAPSHOT_BYTES=700000;
export const EQUIPMENT=Object.freeze([
 {id:'ih',name:'IH 爐',pattern:'IH'},
 {id:'air-fryer',name:'氣炸鍋',pattern:'氣炸'},
 {id:'rice-cooker',name:'電子鍋',pattern:'電子鍋'},
 {id:'microwave',name:'微波爐',pattern:'微波'},
 {id:'steam-oven',name:'蒸烤爐',pattern:'蒸烤'}
]);
export function taipeiDate(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function publicDefaults(today=taipeiDate()){
 return {...structuredClone(DEFAULT_SETTINGS),startDate:getMonday(today),avoid:[],favorites:[],feedback:{},seed:0};
}
export function emptyAccountSnapshot(today=taipeiDate()){
 const settings=publicDefaults(today),state=retainWeeks({version:1,inventory:[],...emptyWeek(settings,settings.startDate)},today,settings);
 return createSharedSnapshot(state,settingsToDraft(settings));
}
export function validateProfile(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['displayName','equipment'].includes(k)))throw new Error('帳號設定格式不正確。');
 if(typeof value.displayName!=='string'||value.displayName.trim().length>60)throw new Error('暱稱最多60字。');
 if(!Array.isArray(value.equipment)||value.equipment.length>5)throw new Error('烹調設備最多5項。');
 const seen=new Set();
 const equipment=value.equipment.map(item=>{
  if(!item||Object.keys(item).some(k=>!['id','model'].includes(k))||!EQUIPMENT.some(x=>x.id===item.id)||seen.has(item.id)||typeof item.model!=='string'||item.model.length>120)throw new Error('烹調設備設定不正確。');
  seen.add(item.id);return {id:item.id,model:item.model.trim()};
 });
 return {displayName:value.displayName.trim(),equipment};
}
export function assertSafeJSON(value,maxBytes=MAX_SNAPSHOT_BYTES){
 const text=JSON.stringify(value);
 if(typeof text!=='string'||new TextEncoder().encode(text).length>maxBytes)throw new Error('資料超過大小限制。');
 function walk(item,depth){
  if(depth>32)throw new Error('資料結構過深。');
  if(typeof item==='number'&&!Number.isFinite(item))throw new Error('資料含無效數字。');
  if(item&&typeof item==='object')for(const [key,v] of Object.entries(item)){
   if(['__proto__','prototype','constructor'].includes(key))throw new Error('不允許的資料欄位。');
   walk(v,depth+1);
  }
 }
 walk(value,0);
}
export function validateAccountSnapshot(raw){
 assertSafeJSON(raw);
 if(!raw||raw.version!==1||Object.keys(raw).some(k=>!['version','state','preferences'].includes(k)))throw new Error('菜單資料版本不正確。');
 const state=validateState(raw.state);
 const ids=new Set(INGREDIENTS.map(x=>x.id)),recipes=new Set(RECIPES.map(x=>x.id));
 const allowedState=['version','settings','inventory','plan','checked'];
 if(Object.keys(raw.state).some(k=>!allowedState.includes(k))||state.inventory.length>200||new Set(state.inventory.map(x=>x.ingredientId)).size!==state.inventory.length)throw new Error('庫存資料格式不正確。');
 const states=[raw.state,...(raw.state.plan.nextWeek?[raw.state.plan.nextWeek]:[])];
 for(const s of states){
  if(s.settings.avoid.length>200||s.settings.avoid.some(x=>x.length>100)||s.settings.favorites.some(x=>!['義式','西式','美式','台式'].includes(x)))throw new Error('偏好內容超過範圍。');
  if(Object.keys(s.settings).some(k=>!Object.keys(publicDefaults()).includes(k)))throw new Error('不允許的設定欄位。');
  if(Object.keys(s.settings.feedback).length>200||Object.entries(s.settings.feedback).some(([id,f])=>!recipes.has(id)||!f||Array.isArray(f)||Object.keys(f).some(k=>!['liked','slow','portion'].includes(k))||f.liked!==undefined&&typeof f.liked!=='boolean'||f.slow!==undefined&&typeof f.slow!=='boolean'||f.portion!==undefined&&!['less','right','more'].includes(f.portion)))throw new Error('料理回饋格式不正確。');
  if(Object.entries(s.checked).some(([id,v])=>!ids.has(id)||v!==true))throw new Error('採買勾選格式不正確。');
 }
 if(!raw.preferences||Object.keys(raw.preferences).length!==11)throw new Error('偏好欄位不完整。');
 const result=createSharedSnapshot(state,raw.preferences);
 if(JSON.stringify(Object.keys(result.preferences).sort())!==JSON.stringify(Object.keys(raw.preferences).sort()))throw new Error('不允許的偏好欄位。');
 // Saved preference drafts may differ from an already generated menu by design.
 return result;
}
export function retainAccountSnapshot(snapshot,today=taipeiDate()){
 const next=structuredClone(snapshot);next.state=retainWeeks(next.state,today,publicDefaults(today));return next;
}
