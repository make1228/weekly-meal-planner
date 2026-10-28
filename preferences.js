// Form drafts are deliberately independent of the settings used by a saved menu.
// This lets an unfinished edit survive reload without invalidating that menu.
export const PREFERENCES_VERSION=2;
export const SETTINGS_DRAFT_KEY='weekly-table-preferences-v2';
export const INVENTORY_KEY='weekly-table-inventory-v1';
export const PANTRY_DRAFT_KEY='weekly-table-pantry-draft-v1';
const cuisineValues=new Set(['台式','義式','西式','美式']);
const oldAvoid=['青椒','茄子','酪梨','照燒','漢堡排'];
const own=(value,key)=>value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,key);
const strings=(value,allowed)=>Array.isArray(value)&&value.every(x=>typeof x==='string'&&(!allowed||allowed.has(x)));
const unique=value=>[...new Set(value)];
export const parseAvoid=text=>String(text??'').split(/[、,，\n;；]+/).map(x=>x.trim()).filter(Boolean);

export function settingsToDraft(settings){
 return {weekdayPeople:String(settings.weekdayPeople),weekendPeople:String(settings.weekendPeople),slots:[...settings.slots],maxMinutes:String(settings.maxMinutes),favorites:[...settings.favorites],avoidText:settings.avoid.join('、'),riceMeals:String(settings.riceMeals),pastaMeals:String(settings.pastaMeals)};
}
function sanitizeDraft(raw,fallback){
 const draft=structuredClone(fallback);
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return draft;
 for(const key of ['weekdayPeople','weekendPeople','maxMinutes','riceMeals','pastaMeals']){
  if(own(raw,key)&&(typeof raw[key]==='string'||typeof raw[key]==='number')&&String(raw[key]).length<=40)draft[key]=String(raw[key]);
 }
 if(strings(raw.slots,new Set(['lunch','dinner'])))draft.slots=unique(raw.slots);
 if(strings(raw.favorites,cuisineValues))draft.favorites=unique(raw.favorites);
 if(own(raw,'avoidText')&&typeof raw.avoidText==='string'&&raw.avoidText.length<=20000)draft.avoidText=raw.avoidText;
 return draft;
}
export function restoreDraft(savedEnvelope,legacySettings,defaults){
 const fallback=settingsToDraft(defaults);
 if(savedEnvelope?.version===PREFERENCES_VERSION)return sanitizeDraft(savedEnvelope.draft,fallback);
 if(!legacySettings||typeof legacySettings!=='object')return fallback;
 const migrated={...defaults,...legacySettings};
 if(!strings(migrated.slots,new Set(['lunch','dinner'])))migrated.slots=[...defaults.slots];
 else if(migrated.slots.length===1&&migrated.slots[0]==='dinner')migrated.slots=[...defaults.slots];
 if(Number(migrated.maxMinutes)===35)migrated.maxMinutes=defaults.maxMinutes;
 if(!strings(migrated.favorites,cuisineValues)||migrated.favorites.length===0)migrated.favorites=[...defaults.favorites];
 if(!strings(migrated.avoid))migrated.avoid=[...defaults.avoid];
 else if(migrated.avoid.length===oldAvoid.length&&oldAvoid.every(x=>migrated.avoid.includes(x)))migrated.avoid=[...defaults.avoid];
 else migrated.avoid=unique([...defaults.avoid,...migrated.avoid]);
 return sanitizeDraft(settingsToDraft(migrated),fallback);
}
export function draftToSettings(draft,baseSettings){
 return {...baseSettings,weekdayPeople:Number(draft.weekdayPeople),weekendPeople:Number(draft.weekendPeople),slots:[...draft.slots],maxMinutes:Number(draft.maxMinutes),favorites:[...draft.favorites],avoid:parseAvoid(draft.avoidText),riceMeals:Number(draft.riceMeals),pastaMeals:Number(draft.pastaMeals)};
}
export function draftMatchesSettings(draft,settings){
 const input=draftToSettings(draft,settings);
 for(const key of ['weekdayPeople','weekendPeople','maxMinutes','riceMeals','pastaMeals'])if(input[key]!==Number(settings[key]))return false;
 for(const key of ['slots','favorites','avoid'])if(JSON.stringify(unique(input[key]).sort())!==JSON.stringify(unique(settings[key]).sort()))return false;
 return true;
}
export function sanitizeInventory(items,ingredientIds){
 if(!Array.isArray(items))return [];
 const quantities=new Map();
 for(const row of items){
  if(!row||!ingredientIds.has(row.ingredientId))continue;
  const quantity=Number(row.quantity);
  if((typeof row.quantity!=='number'&&typeof row.quantity!=='string')||String(row.quantity).trim()===''||!Number.isFinite(quantity)||quantity<0||quantity>1000000)continue;
  const total=Math.round(((quantities.get(row.ingredientId)||0)+quantity)*100)/100;
  if(total<=1000000)quantities.set(row.ingredientId,total);
 }
 return [...quantities].map(([ingredientId,quantity])=>({ingredientId,quantity}));
}
export function sanitizePantryDraft(raw,ingredientIds){
 return {ingredientId:ingredientIds.has(raw?.ingredientId)?raw.ingredientId:'',quantity:typeof raw?.quantity==='string'&&raw.quantity.length<=40?raw.quantity:''};
}
