import {INGREDIENTS,RECIPES,DEFAULT_SETTINGS,generatePlan,replaceMeal,getReplacementOptions,setMealCooked,aggregateShopping,recipeById,formatQty,getMonday,addDays} from './engine.js';
import {PREFERENCES_VERSION,SETTINGS_DRAFT_KEY,INVENTORY_KEY,PANTRY_DRAFT_KEY,settingsToDraft,restoreDraft,draftToSettings,draftMatchesSettings,sanitizeInventory,sanitizePantryDraft} from './preferences.js';
import {installCloudSync} from './cloud-ui.js';
import {newGenerationId} from './sync-model.js';

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORAGE_KEY='weekly-table-v1';
const ingredients=new Map(INGREDIENTS.map(i=>[i.id,i]));
const ingredientIds=new Set(ingredients.keys());
const kitchenEquipment=[
 {name:'BOSCH 8系列 Flex IH 感應爐 深遂黑',model:'PXY875KW1E',match:/IH/},
 {name:'氣炸鍋',model:'',match:/氣炸/},
 {name:'電子鍋',model:'',match:/電子鍋/},
 {name:'BOSCH 6系列 嵌入式微波燒烤爐',model:'BEL554MS0U',match:/微波/},
 {name:'BOSCH 8系列 嵌入式蒸烤爐 極緻黑',model:'HSG7584B1',match:/蒸烤/}
];
const localToday=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const defaults={...structuredClone(DEFAULT_SETTINGS),startDate:getMonday(localToday)};
let state={version:1,settings:defaults,inventory:[],plan:null,checked:{}};
let activeTab='menu',currentMealKey=null,toastTimeout,storageAvailable=true,startupError='';
let replacementMealKey=null,replacementQuery='',replacementProtein='';
let cloud=null;

function validateState(raw){
  if(!raw||raw.version!==1||!raw.settings||!Array.isArray(raw.inventory)||!raw.plan||!raw.checked||typeof raw.checked!=='object'||Array.isArray(raw.checked))throw new Error('備份格式不正確，請選擇由本工具匯出的 JSON 檔案。');
  const s=raw.settings;
  if(!Array.isArray(s.slots)||new Set(s.slots).size!==s.slots.length||!s.slots.length||!Array.isArray(s.avoid)||s.avoid.some(x=>typeof x!=='string')||!Array.isArray(s.favorites)||s.favorites.some(x=>typeof x!=='string')||!Number.isInteger(s.weekdayPeople)||s.weekdayPeople<1||s.weekdayPeople>12||!Number.isInteger(s.weekendPeople)||s.weekendPeople<1||s.weekendPeople>12||!s.feedback||typeof s.feedback!=='object'||Array.isArray(s.feedback))throw new Error('備份中的設定無效，請重新匯出。');
  // Validate settings independently without replacing the saved choices.
  generatePlan(s,raw.inventory);
  if(raw.plan.startDate!==getMonday(s.startDate)||!Array.isArray(raw.plan.days)||raw.plan.days.length!==7)throw new Error('備份中的週次或菜單不完整。');
  raw.plan.days.forEach((d,index)=>{
    const date=addDays(raw.plan.startDate,index);
    if(d.date!==date||!Array.isArray(d.meals)||d.meals.length!==s.slots.length)throw new Error('備份中的餐別或日期不正確。');
    const seen=new Set();
    for(const m of d.meals){if(!s.slots.includes(m.slot)||seen.has(m.slot)||m.date!==date||m.key!==`${date}-${m.slot}`||m.servings!==(index>=5?s.weekendPeople:s.weekdayPeople)||!recipeById(m.recipeId)||(m.cooked!==undefined&&typeof m.cooked!=='boolean'))throw new Error('備份中的料理或份量不正確。');const r=recipeById(m.recipeId);if(r.minutes>s.maxMinutes||s.avoid.some(word=>word&&[r.title,r.protein,...r.ingredients.map(i=>ingredients.get(i.ingredientId).name)].some(t=>t.includes(word))))throw new Error('備份中的料理不符合備餐時間或忌口設定。');seen.add(m.slot);}
  });
  aggregateShopping(raw.plan,raw.inventory);
  return {version:1,settings:structuredClone(s),inventory:raw.inventory.map(i=>({ingredientId:i.ingredientId,quantity:Number(i.quantity)})),plan:structuredClone(raw.plan),checked:Object.fromEntries(Object.entries(raw.checked).filter(([k,v])=>ingredients.has(k)&&v===true))};
}
function readStored(key){try{const value=localStorage.getItem(key);return value===null?null:JSON.parse(value);}catch(e){return null;}}
const previousState=readStored(STORAGE_KEY);
if(previousState){try{state=validateState(previousState);}catch(e){startupError='先前的菜單無法完整還原，已保留可讀取的偏好與冰箱紀錄；請重新產生菜單。';}}
// A damaged or outdated menu must never erase a separate valid pantry snapshot.
const savedInventory=readStored(INVENTORY_KEY);
const recoveredInventory=sanitizeInventory(savedInventory?.version===1&&Array.isArray(savedInventory.items)?savedInventory.items:previousState?.inventory,ingredientIds);
if(JSON.stringify(state.inventory)!==JSON.stringify(recoveredInventory))state.checked={};
state.inventory=recoveredInventory;
let draftSettings=restoreDraft(readStored(SETTINGS_DRAFT_KEY),previousState?.settings,defaults);
let pantryFormDraft=sanitizePantryDraft(readStored(PANTRY_DRAFT_KEY),ingredientIds);
if(!state.plan){
 try{state.settings=draftToSettings(draftSettings,defaults);state.plan=generatePlan(state.settings,state.inventory);}
 catch(e){state.settings=structuredClone(defaults);state.plan=generatePlan(state.settings,state.inventory);startupError='已保留你輸入的設定與冰箱紀錄。目前設定無法產生菜單，請調整後再套用。';}
}

function save(){
  if(cloud?.saveAccountDrafts())return;
  try{
    localStorage.setItem(SETTINGS_DRAFT_KEY,JSON.stringify({version:PREFERENCES_VERSION,draft:draftSettings}));
    localStorage.setItem(INVENTORY_KEY,JSON.stringify({version:1,items:state.inventory}));
    localStorage.setItem(PANTRY_DRAFT_KEY,JSON.stringify(pantryFormDraft));
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    $('#save-state').innerHTML='<i></i> 已自動儲存';storageAvailable=true;
  }
  catch(e){storageAvailable=false;$('#save-state').textContent='暫時無法儲存';showError('瀏覽器儲存空間無法使用，請匯出備份以保留目前菜單。');}
}
function toast(message){clearTimeout(toastTimeout);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimeout=setTimeout(()=>$('#toast').classList.remove('visible'),3000);}
function showError(message){const banner=$('#error-banner');banner.textContent=message;banner.hidden=false;banner.tabIndex=-1;banner.focus({preventScroll:true});banner.scrollIntoView({block:'nearest',behavior:'smooth'});}
function clearError(){$('#error-banner').hidden=true;}
function meals(){return state.plan.days.flatMap(d=>d.meals);}
function quantity(n,unit){return `${formatQty(n,unit)} ${unit}`;}
function shortDate(date){return date.slice(5).replace('-','/');}
function captureSettingsDraft(){const f=new FormData($('#settings-form'));draftSettings={weekdayPeople:String(f.get('weekdayPeople')??''),weekendPeople:String(f.get('weekendPeople')??''),slots:f.getAll('slots'),maxMinutes:String(f.get('maxMinutes')??''),avoidText:String(f.get('avoid')??''),favorites:f.getAll('favorites'),riceMeals:String(f.get('riceMeals')??''),pastaMeals:String(f.get('pastaMeals')??'')};return draftSettings;}
function readSettings(){return {...draftToSettings(captureSettingsDraft(),state.settings),seed:(state.settings.seed||0)+1};}
function fillSettings(){const s=draftSettings;$('#weekday-people').value=s.weekdayPeople;$('#weekend-people').value=s.weekendPeople;$('#max-minutes').value=s.maxMinutes;$('#avoid').value=s.avoidText;$('#rice-meals').value=s.riceMeals;$('#pasta-meals').value=s.pastaMeals;$$('[name=slots]').forEach(x=>x.checked=s.slots.includes(x.value));$$('[name=favorites]').forEach(x=>x.checked=s.favorites.includes(x.value));}
function renderDraftNotice(){const pending=!draftMatchesSettings(draftSettings,state.settings);$('#plan-notice').textContent='設定已保存，按「產生一週菜單」套用到本週；目前菜單與已煮標記會先保留。';$('#plan-notice').hidden=!pending;}
function capturePantryDraft(){pantryFormDraft={ingredientId:$('#pantry-ingredient').value,quantity:$('#pantry-quantity').value};}
function fillPantryDraft(){$('#pantry-ingredient').value=pantryFormDraft.ingredientId;$('#pantry-quantity').value=pantryFormDraft.quantity;$('#pantry-unit').textContent=ingredients.get(pantryFormDraft.ingredientId)?.unit||'g';}
function reconcileChecked(before,after){const old=new Map(before.map(r=>[r.ingredientId,r.toBuy]));state.checked=Object.fromEntries(after.filter(r=>r.toBuy>0&&state.checked[r.ingredientId]&&old.get(r.ingredientId)===r.toBuy).map(r=>[r.ingredientId,true]));}
async function mutateShared(action,options={}){if(cloud)return cloud.mutate(action,options);action();save();render();}
async function updatePlan(newPlan,newSettings=state.settings,{replacePlan=false}={}){await mutateShared(()=>{const before=aggregateShopping(state.plan,state.inventory),differentWeek=state.plan.startDate!==newPlan.startDate;if(replacePlan)newPlan.generationId=newGenerationId();state.plan=newPlan;state.settings=newSettings;if(differentWeek)state.checked={};else reconcileChecked(before,aggregateShopping(state.plan,state.inventory));clearError();},{replacePlan,sharePreferences:replacePlan});}

function foodArt(protein,starch){
 const proteinShape=protein==='魚肉'?'<path d="M32 41q15-18 40-4l12 12-13 10q-24 10-39-4l-10 6V35Z" fill="#dc9c7c"/><path d="m40 40 16 16m-4-20 17 16m-4-17 11 11" stroke="#efc9a7" stroke-width="4" stroke-linecap="round"/>':protein==='海鮮'?'<path d="M38 37q-17 6-5 22q11 11 23-4l-10-7q-6 8-9 1q-3-6 5-5Z" fill="#e5aa84"/><path d="M62 41q-8 13 7 19q17 6 20-12l-11-3q-1 8-6 5q-5-3 0-8Z" fill="#d9946f"/>':protein==='蛋豆'?'<rect x="28" y="37" width="24" height="22" rx="4" fill="#ded6a6" transform="rotate(-10 40 48)"/><ellipse cx="64" cy="48" rx="15" ry="19" fill="#f8efd0" transform="rotate(20 64 48)"/><circle cx="65" cy="50" r="9" fill="#dab869"/>':'<path d="M30 41q3-13 26-10q25 1 28 16q2 16-22 17q-29 3-32-13Z" fill="'+(protein==='牛肉'||protein==='羊肉'?'#b3856b':'#cea176')+'"/><path d="m40 38 9 18m6-21 10 20m5-17 8 13" stroke="#e7c49a" stroke-width="4" stroke-linecap="round"/>';
 return `<svg viewBox="0 0 120 90" aria-hidden="true"><ellipse cx="61" cy="49" rx="49" ry="32" fill="#fff" stroke="#e6e8dd" stroke-width="1.5"/><ellipse cx="61" cy="49" rx="41" ry="25" fill="#f7f5e9"/><path d="M73 31q-3-13 7-13q8-7 13 3q12 1 9 11q5 10-7 12q-9 8-14-2q-12 1-8-11" fill="#8a9d70"/><path d="m83 25 8 15m5-14-6 13" stroke="#b0bf92" stroke-width="2"/>${starch==='rice'?'<ellipse cx="41" cy="49" rx="21" ry="17" fill="#ece8cf"/><path d="m30 46 3-2m7 9 4-1m-4-14 3 1m-9 17 3-1" stroke="#fffdf2" stroke-width="3" stroke-linecap="round"/>':starch==='pasta'?'<path d="M34 37q-15 10 3 19t28-9q8-16-10-10t-19 14q0 8 20 6" fill="none" stroke="#d8bb72" stroke-width="5" stroke-linecap="round"/>':''}<g transform="${starch==='low'?'':'translate(16 4) scale(.8)'}">${proteinShape}</g><circle cx="36" cy="66" r="7" fill="#cf8560"/><circle cx="48" cy="70" r="5" fill="#ddb379"/></svg>`;
}
function renderMenu(){
 const all=meals(),cooked=all.filter(m=>m.cooked===true).length,avg=Math.round(all.reduce((sum,m)=>sum+recipeById(m.recipeId).minutes,0)/all.length);
 const rice=all.filter(m=>recipeById(m.recipeId).starch==='rice').length,pasta=all.filter(m=>recipeById(m.recipeId).starch==='pasta').length;
 $('#meal-count').textContent=all.length;
 $('#week-summary').innerHTML=`<span class="summary-icon" aria-hidden="true">✧</span><span><strong>${all.length} 餐</strong> 已安排 · <strong>${cooked} 餐</strong> 已煮好</span><span class="summary-divider"></span><span>平均 <strong>${avg} 分鐘</strong> 上桌</span><span class="summary-divider"></span><span>白飯 ${rice} 餐 · 義大利麵 ${pasta} 餐</span>`;
 $('.main-content').classList.toggle('dual-meals',state.settings.slots.length===2);
 $('#menu-grid').innerHTML=state.plan.days.map((d,idx)=>d.meals.map(m=>{const r=recipeById(m.recipeId),f=state.settings.feedback[r.id]||{},done=m.cooked===true,dayLabel=['週一','週二','週三','週四','週五','週六','週日'][idx],slotLabel=m.slot==='lunch'?'午餐':'晚餐';const pantryUsed=r.ingredients.some(i=>state.inventory.some(p=>p.ingredientId===i.ingredientId&&p.quantity>0));return `<article class="meal-card ${idx>=5?'weekend':''} ${done?'cooked':''}" data-meal-key="${esc(m.key)}"><div class="card-day"><span>${dayLabel}<span class="day-date">${shortDate(d.date)}</span></span><span class="meal-label">${slotLabel}${idx>=5?' · 週末':''}</span></div><div class="food-art">${foodArt(r.protein,r.starch)}</div><div class="meal-body"><button class="recipe-title" data-open="${esc(m.key)}" aria-label="查看${esc(r.title)}的食譜">${esc(r.title)}</button><div class="meal-meta"><span>◷ ${r.minutes} 分鐘</span><span>♧ ${m.servings} 人份</span></div><p class="meal-ingredients">${esc(r.ingredients.filter(i=>ingredients.get(i.ingredientId).category!=='調味與其他').slice(0,3).map(i=>ingredients.get(i.ingredientId).name.replace('（可用即食飯）','').replace('（乾重）','')).join('・'))}</p></div><div class="card-bottom"><span class="equipment-label">${done?'✓ 不列入採買':pantryUsed?'◉ 優先用庫存':esc(r.equipment)}</span><button class="swap-button" data-swap="${esc(m.key)}" aria-label="替換${dayLabel}${slotLabel}" ${done?'disabled title="取消已煮好標記後即可換菜"':''}><span aria-hidden="true">⟳</span> 換一道</button>${f.liked===true?'<span class="card-feedback" title="喜歡這道">♡</span>':''}</div><label class="cooked-toggle"><input type="checkbox" data-cooked="${esc(m.key)}" ${done?'checked':''} aria-label="${dayLabel}${slotLabel}已煮好"><span>已煮好</span><small>${done?'取消即可加回採買':'勾選後扣除採買食材'}</small></label></article>`;}).join('')).join('');
}
function renderPantry(){
 $('#pantry-list').innerHTML=state.inventory.length?state.inventory.map(p=>{const i=ingredients.get(p.ingredientId);return `<div class="pantry-item"><span>${esc(i.name)}</span><span class="qty">${quantity(p.quantity,i.unit)}</span><button data-remove="${esc(i.id)}" aria-label="移除${esc(i.name)}庫存">×</button></div>`;}).join(''):'<p class="pantry-empty">冰箱清單還是空的，先加一項吧。</p>';
}
function renderShopping(){
 const rows=aggregateShopping(state.plan,state.inventory),needed=rows.filter(r=>r.toBuy>0),covered=rows.filter(r=>r.toBuy===0),checked=needed.filter(r=>state.checked[r.ingredientId]).length,remaining=meals().filter(m=>m.cooked!==true).length;
 $('#shopping-count').textContent=needed.length;
 $('#shopping-description').textContent=`${remaining} / ${meals().length} 餐尚未煮 · ${needed.length} 項待採買${covered.length?` · ${covered.length} 項庫存已足夠`:''}`;
 $('#shopping-progress-text').textContent=remaining===0?'本週餐點都煮好了，採買完成！':`已買齊 ${checked} / ${needed.length} 項`;
 $('#shopping-progress').max=needed.length||1;$('#shopping-progress').value=needed.length?checked:1;
 const categories=[...new Set(needed.map(r=>r.category))];
 const item=(r,stockOnly=false)=>`<div class="shopping-item ${state.checked[r.ingredientId]?'checked':''}">${stockOnly?'<span class="stock-complete" aria-hidden="true">✓</span>':`<input type="checkbox" id="buy-${r.ingredientId}" data-buy="${r.ingredientId}" ${state.checked[r.ingredientId]?'checked':''}>`}<label ${stockOnly?'':`for="buy-${r.ingredientId}"`}>${esc(r.name)}<span class="shopping-stock">共需 ${quantity(r.required,r.unit)}${r.usedStock>0?` · 庫存扣抵 ${quantity(r.usedStock,r.unit)}`:''}</span></label><span class="shopping-quantity ${stockOnly?'stock-complete':''}">${stockOnly?'庫存足夠':quantity(r.toBuy,r.unit)}</span></div>`;
 $('#shopping-list').innerHTML=categories.map(c=>`<section class="shopping-group"><h3>${esc(c)} <span>${needed.filter(r=>r.category===c).length} 項</span></h3>${needed.filter(r=>r.category===c).map(r=>item(r)).join('')}</section>`).join('')+(covered.length?`<section class="shopping-group"><h3>冰箱已經有了 <span>不用再買</span></h3>${covered.map(r=>item(r,true)).join('')}</section>`:'')+(remaining===0?'<div class="empty-state"><h3>這週的餐桌，完成了。</h3><p>所有餐點都已煮好，目前不需要採買。取消任一餐的標記，就會重新計算。</p></div>':'');
 $('#clear-checked').disabled=checked===0;
}
function render(){const end=addDays(state.plan.startDate,6);$('#date-range').textContent=`${shortDate(state.plan.startDate)} — ${shortDate(end)}`;$('#start-date').value=state.plan.startDate;$('#week-title').textContent=`${state.plan.startDate.slice(0,4)} 年・一週菜單`;renderMenu();renderPantry();renderShopping();renderDraftNotice();cloud?.refresh();}
function setTab(tab){activeTab=tab;$$('.tab').forEach(b=>{const selected=b.dataset.tab===tab;b.classList.toggle('active',selected);b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});$('#menu-view').hidden=tab!=='menu';$('#shopping-view').hidden=tab!=='shopping';}
function openRecipe(key){const m=meals().find(x=>x.key===key);if(!m)return;currentMealKey=key;renderRecipe();$('#recipe-dialog').showModal();cloud?.refresh();}
function recipeEquipment(recipe){const tools=kitchenEquipment.filter(item=>item.match.test(recipe.equipment));return `<div class="recipe-appliances"><strong>使用家中設備</strong>${tools.map(item=>`<span>${esc(item.name)}${item.model?` <b>${esc(item.model)}</b>`:''}</span>`).join('')}${recipe.ingredients.some(i=>i.ingredientId==='rice')?'<small>熟飯可事先用電子鍋準備；另預留煮飯時間。</small>':''}</div>`;}
function openReplacement(key){
 const m=meals().find(x=>x.key===key);if(!m)return;
 replacementMealKey=key;replacementQuery='';replacementProtein='';
 const current=recipeById(m.recipeId),options=getReplacementOptions(state.plan,key,state.settings,state.inventory);
 const proteins=[...new Set(options.map(r=>r.protein))];
 $('#replacement-context').textContent=`${shortDate(m.date)} ${m.slot==='lunch'?'午餐':'晚餐'} · ${m.servings} 人份`;
 $('#replacement-current').textContent=`目前：${current.title}`;
 $('#replacement-note').textContent=`${current.starch==='rice'?'白飯套餐':current.starch==='pasta'?'義大利麵':'低澱粉'}料理 · ${state.settings.maxMinutes} 分鐘以內 · 已避開忌口食材`;
 $('#replacement-search').value='';$('#replacement-error').hidden=true;
 $('#replacement-filters').innerHTML=['',...proteins].map(p=>`<button type="button" class="replacement-filter ${p===''?'selected':''}" data-protein="${esc(p)}" aria-pressed="${p===''}">${p?esc(p):'全部'}</button>`).join('');
 renderReplacementOptions();$('#replacement-dialog').showModal();cloud?.refresh();
}
function filteredReplacementOptions(options){return options.filter(r=>(!replacementProtein||r.protein===replacementProtein)&&(!replacementQuery||[r.title,r.cuisine,r.equipment,...r.ingredients.map(i=>ingredients.get(i.ingredientId).name)].some(t=>t.toLocaleLowerCase().includes(replacementQuery.toLocaleLowerCase()))));}
function renderReplacementOptions(){
 const options=getReplacementOptions(state.plan,replacementMealKey,state.settings,state.inventory);
 const filtered=filteredReplacementOptions(options);
 const m=meals().find(x=>x.key===replacementMealKey),used=new Set(meals().filter(x=>x.key!==replacementMealKey).map(x=>x.recipeId));
 $('#replacement-count').textContent=`${filtered.length} 道可選${filtered.length!==options.length?` · 共 ${options.length} 道符合條件`:''}`;
 $('#replacement-random').disabled=filtered.length===0;
 $('#replacement-options').innerHTML=filtered.length?filtered.map(r=>{const haveStock=r.ingredients.some(i=>state.inventory.some(p=>p.ingredientId===i.ingredientId&&p.quantity>0));return `<article class="replacement-option"><div class="replacement-art">${foodArt(r.protein,r.starch)}</div><div class="replacement-description"><h3>${esc(r.title)}</h3><p>${r.minutes} 分鐘 · ${m.servings} 人份 · ${esc(r.cuisine)}</p><small>${esc(r.ingredients.filter(i=>ingredients.get(i.ingredientId).category!=='調味與其他').slice(0,3).map(i=>ingredients.get(i.ingredientId).name.replace('（可用即食飯）','').replace('（乾重）','')).join('・'))}</small><div class="replacement-badges">${haveStock?'<span>可用現有庫存</span>':''}${used.has(r.id)?'<span class="already-planned">本週已安排</span>':''}</div></div><button type="button" class="replacement-select secondary-button" data-select-recipe="${esc(r.id)}" aria-label="改成${esc(r.title)}">選這道 →</button></article>`;}).join(''):`<div class="replacement-empty"><strong>${options.length?'沒有符合搜尋的料理':'目前沒有其他符合條件的料理'}</strong><p>${options.length?'試著清除搜尋文字或切換「全部」。':'可以增加備餐時間，或調整忌口後重新產生菜單。'}</p></div>`;
}
async function applyReplacement(recipeId){
 try{const key=replacementMealKey,s={...state.settings,seed:(state.settings.seed||0)+1};const visibleIds=(replacementProtein||replacementQuery)?filteredReplacementOptions(getReplacementOptions(state.plan,key,s,state.inventory)).map(r=>r.id):undefined;const plan=replaceMeal(state.plan,key,s,state.inventory,recipeId,visibleIds);await updatePlan(plan,s);$('#replacement-dialog').close();$(`[data-swap="${key}"]`)?.focus();toast('已換一道料理，採買清單同步更新。');}
 catch(err){$('#replacement-error').textContent=err.message;$('#replacement-error').hidden=false;}
}
function renderRecipe(){const m=meals().find(x=>x.key===currentMealKey);if(!m)return;const r=recipeById(m.recipeId),fb=state.settings.feedback[r.id]||{};
 $('#recipe-content').innerHTML=`<p class="eyebrow">A MEAL TO LOOK FORWARD TO</p><h2 id="recipe-dialog-title">${esc(r.title)}</h2><div class="recipe-dialog-meta"><span>${m.servings} 人份</span><span>◷ 約 ${r.minutes} 分鐘</span><span>${esc(r.equipment)}</span></div>${recipeEquipment(r)}<div class="recipe-columns"><section><h3>準備食材</h3><div class="ingredient-list">${r.ingredients.map(item=>{const i=ingredients.get(item.ingredientId);return `<div class="recipe-ingredient"><span>${esc(i.name)}</span><span>${quantity(item.quantity*m.servings/r.baseServings,i.unit)}</span></div>`;}).join('')}</div></section><section><h3>簡單做，上桌吃</h3><ol class="recipe-steps">${r.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol></section></div><section class="feedback-section"><h3>這道菜，吃起來如何？</h3><p>喜好與耗時回饋會影響下次配餐；份量回饋留作你的調整參考。</p><div class="feedback-buttons"><button class="feedback-button ${fb.liked===true?'selected':''}" data-feedback="like" aria-pressed="${fb.liked===true}">♡ 喜歡這道</button><button class="feedback-button dislike ${fb.liked===false?'selected':''}" data-feedback="dislike" aria-pressed="${fb.liked===false}">較不喜歡</button><button class="feedback-button ${fb.slow?'selected':''}" data-feedback="slow" aria-pressed="${!!fb.slow}">備餐太久</button></div><div class="feedback-buttons" style="margin-top:8px">${[['less','份量太多'],['right','份量剛好'],['more','份量不足']].map(([v,l])=>`<button class="feedback-button ${fb.portion===v?'selected':''}" data-portion="${v}" aria-pressed="${fb.portion===v}">${l}</button>`).join('')}</div></section><p class="recipe-source">份量為食譜估算，可依食量調整。使用蒸烤爐、氣炸鍋與調理包時，請配合設備與包裝指引確認熟度。此食譜來自內建食譜庫。</p>`;
}

function saveSettingsDraft(){captureSettingsDraft();save();renderDraftNotice();cloud?.noteDraftChange();}
$('#settings-form').addEventListener('input',saveSettingsDraft);
$('#settings-form').addEventListener('change',saveSettingsDraft);
$('#settings-form').addEventListener('submit',async e=>{e.preventDefault();try{const s=readSettings();const next=generatePlan(s,state.inventory,state.plan);await updatePlan(next,s,{replacePlan:true});toast('一週菜單已安排好，採買清單也更新了。');}catch(err){save();showError(err.message);}});
async function changeWeek(date){try{const monday=getMonday(date),s={...state.settings,startDate:monday,seed:(state.settings.seed||0)+1};const plan=generatePlan(s,state.inventory);await updatePlan(plan,s,{replacePlan:true});toast(`已安排 ${shortDate(monday)} 開始的一週菜單。`);}catch(e){showError(e.message);}}
$('#prev-week').addEventListener('click',()=>changeWeek(addDays(state.plan.startDate,-7)));
$('#next-week').addEventListener('click',()=>changeWeek(addDays(state.plan.startDate,7)));
$('#start-date').addEventListener('change',e=>{if(e.target.value)changeWeek(e.target.value);else e.target.value=state.plan.startDate;});
$$('.tab').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
$('.tabs').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();setTab(e.key==='Home'?'menu':e.key==='End'?'shopping':activeTab==='menu'?'shopping':'menu');$(`[data-tab="${activeTab}"]`).focus();}});
$('#menu-grid').addEventListener('click',e=>{const swap=e.target.closest('[data-swap]'),open=e.target.closest('[data-open]');if(swap){try{openReplacement(swap.dataset.swap);}catch(err){showError(err.message);}}else if(open)openRecipe(open.dataset.open);});
$('#menu-grid').addEventListener('change',async e=>{const input=e.target.closest('[data-cooked]');if(!input)return;try{const key=input.dataset.cooked,done=input.checked;await updatePlan(setMealCooked(state.plan,key,done));$(`[data-cooked="${key}"]`)?.focus();toast(done?'已標記煮好，這餐食材已從採買扣除。':'已取消標記，這餐食材已加回採買。');}catch(err){showError(err.message);render();}});
$('#replacement-options').addEventListener('click',e=>{const b=e.target.closest('[data-select-recipe]');if(b)applyReplacement(b.dataset.selectRecipe);});
$('#replacement-random').addEventListener('click',()=>applyReplacement());
$('#replacement-search').addEventListener('input',e=>{replacementQuery=e.target.value.trim();renderReplacementOptions();});
$('#replacement-filters').addEventListener('click',e=>{const b=e.target.closest('[data-protein]');if(!b)return;replacementProtein=b.dataset.protein;$$('[data-protein]').forEach(x=>{const on=x.dataset.protein===replacementProtein;x.classList.toggle('selected',on);x.setAttribute('aria-pressed',String(on));});renderReplacementOptions();});
$('#pantry-ingredient').innerHTML='<option value="" disabled selected>選一項食材</option>'+[...new Set(INGREDIENTS.map(i=>i.category))].map(c=>`<optgroup label="${esc(c)}">${INGREDIENTS.filter(i=>i.category===c).map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join('')}</optgroup>`).join('');
$('#pantry-ingredient').addEventListener('change',()=>{$('#pantry-unit').textContent=ingredients.get($('#pantry-ingredient').value)?.unit||'g';capturePantryDraft();save();});
$('#pantry-quantity').addEventListener('input',()=>{capturePantryDraft();save();});
$('#pantry-quantity').addEventListener('change',()=>{capturePantryDraft();save();});
$('#pantry-form').addEventListener('submit',async e=>{e.preventDefault();const id=$('#pantry-ingredient').value,q=Number($('#pantry-quantity').value);if(!ingredients.has(id)||!Number.isFinite(q)||q<=0||q>100000){showError('請選擇食材並填入有效庫存數量。');return;}try{await mutateShared(()=>{const old=aggregateShopping(state.plan,state.inventory),found=state.inventory.find(x=>x.ingredientId===id);if(found&&found.quantity+q>1000000)throw new Error('這項庫存已超過可設定數量。');if(found)found.quantity=Math.round((found.quantity+q)*100)/100;else state.inventory.push({ingredientId:id,quantity:Math.round(q*100)/100});reconcileChecked(old,aggregateShopping(state.plan,state.inventory));clearError();});$('#pantry-quantity').value='';capturePantryDraft();save();toast('庫存已加入，採買數量已自動扣抵。');}catch(err){showError(err.message);}});
$('#pantry-list').addEventListener('click',async e=>{const button=e.target.closest('[data-remove]');if(!button)return;try{await mutateShared(()=>{const old=aggregateShopping(state.plan,state.inventory);state.inventory=state.inventory.filter(x=>x.ingredientId!==button.dataset.remove);reconcileChecked(old,aggregateShopping(state.plan,state.inventory));});toast('已移除庫存，採買清單已重算。');}catch(err){showError(err.message);}});
$('#shopping-list').addEventListener('change',async e=>{const id=e.target.dataset.buy,checked=e.target.checked;if(!id)return;try{await mutateShared(()=>{state.checked[id]=checked;});$(`#buy-${id}`)?.focus();}catch(err){showError(err.message);render();}});
$('#clear-checked').addEventListener('click',async()=>{try{await mutateShared(()=>{state.checked={};});toast('已清除採買勾選。');}catch(err){showError(err.message);}});
$('#copy-shopping').addEventListener('click',async()=>{const rows=aggregateShopping(state.plan,state.inventory).filter(r=>r.toBuy>0),text=`好好吃飯｜${state.plan.startDate} 一週採買\n\n`+[...new Set(rows.map(r=>r.category))].map(c=>`【${c}】\n`+rows.filter(r=>r.category===c).map(r=>`${state.checked[r.ingredientId]?'☑':'☐'} ${r.name} ${quantity(r.toBuy,r.unit)}${r.usedStock>0?`（已扣庫存 ${quantity(r.usedStock,r.unit)}）`:''}`).join('\n')).join('\n\n');try{await navigator.clipboard.writeText(text);toast('採買清單已複製。');}catch(e){showError('瀏覽器未允許複製，請使用列印功能儲存清單。');}});
$('#print-button').addEventListener('click',()=>window.print());
$('#recipe-content').addEventListener('click',async e=>{const b=e.target.closest('[data-feedback],[data-portion]');if(!b)return;const m=meals().find(x=>x.key===currentMealKey);if(!m)return;const recipeId=m.recipeId;try{await mutateShared(()=>{const fb={...(state.settings.feedback[recipeId]||{})};if(b.dataset.portion){if(fb.portion===b.dataset.portion)delete fb.portion;else fb.portion=b.dataset.portion;}else if(b.dataset.feedback==='slow')fb.slow=!fb.slow;else{const val=b.dataset.feedback==='like';if(fb.liked===val)delete fb.liked;else fb.liked=val;}state.settings.feedback[recipeId]=fb;});if($('#recipe-dialog').open){renderRecipe();cloud?.refresh();$('#recipe-content').querySelector(b.dataset.portion?`[data-portion="${b.dataset.portion}"]`:`[data-feedback="${b.dataset.feedback}"]`)?.focus();}else toast('料理回饋已儲存。');}catch(err){showError(err.message);}});
$$('dialog').forEach(d=>{d.querySelector('.dialog-close').addEventListener('click',()=>d.close());d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});});
$('#help-button').addEventListener('click',()=>$('#help-dialog').showModal());
$('#backup-button').addEventListener('click',()=>{captureSettingsDraft();capturePantryDraft();const backup={...state,preferences:{version:PREFERENCES_VERSION,draft:draftSettings},pantryDraft:pantryFormDraft};const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`weekly-table-${state.plan.startDate}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('已匯出菜單、設定、庫存與回饋備份。');});
$('#import-button').addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>1000000)throw new Error('備份檔案過大，請選擇本工具匯出的 JSON。');const raw=JSON.parse(await file.text()),imported=validateState(raw),importedDraft=restoreDraft(raw.preferences?.version===PREFERENCES_VERSION?raw.preferences:{version:PREFERENCES_VERSION,draft:settingsToDraft(imported.settings)},null,defaults);imported.plan.generationId=newGenerationId();await mutateShared(()=>{state=imported;draftSettings=importedDraft;clearError();},{replacePlan:true,replaceInventory:true,sharePreferences:true});pantryFormDraft=sanitizePantryDraft(raw.pantryDraft,ingredientIds);save();fillSettings();fillPantryDraft();render();toast('已還原菜單、設定、庫存與喜好回饋。');}catch(err){showError(err instanceof SyntaxError?'這不是有效的 JSON 備份檔案。':err.message);}finally{e.target.value='';}});
$('#kitchen-equipment-list').innerHTML=kitchenEquipment.map(item=>`<li><span>${esc(item.name)}</span>${item.model?`<strong>${esc(item.model)}</strong>`:''}</li>`).join('');
fillSettings();fillPantryDraft();render();setTab('menu');save();if(startupError)showError(startupError);
cloud=installCloudSync({
 getState:()=>state,setState:value=>{state=value;},getDraft:()=>draftSettings,
 setDraft:value=>{draftSettings=restoreDraft({version:PREFERENCES_VERSION,draft:value},null,defaults);},
 getPantryDraft:()=>pantryFormDraft,setPantryDraft:value=>{pantryFormDraft=sanitizePantryDraft(value,ingredientIds);},
 validateState,persist:save,storageAvailable:()=>storageAvailable,toast,
 refresh:()=>{fillSettings();fillPantryDraft();render();},
 captureLocal:()=>structuredClone({state,draftSettings,pantryFormDraft}),
 restoreLocal:value=>{state=value.state;draftSettings=value.draftSettings;pantryFormDraft=value.pantryFormDraft;}
});
