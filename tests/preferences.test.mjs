import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,INGREDIENTS,generatePlan,setMealCooked} from '../engine.js';
import {legacySettings} from './fixtures.mjs';
import {PREFERENCES_VERSION,SETTINGS_DRAFT_KEY,INVENTORY_KEY,PANTRY_DRAFT_KEY,parseAvoid,settingsToDraft,restoreDraft,draftToSettings,draftMatchesSettings,sanitizeInventory,sanitizePantryDraft} from '../preferences.js';

const defaults=()=>({...structuredClone(DEFAULT_SETTINGS),startDate:'2026-10-26'});
const ids=new Set(INGREDIENTS.map(item=>item.id));
const roundTrip=value=>JSON.parse(JSON.stringify(value));

test('fresh preference drafts use every new default and persistence keys keep settings, pantry and menu independent',()=>{
  assert.equal(PREFERENCES_VERSION,2);
  assert.equal(new Set([SETTINGS_DRAFT_KEY,INVENTORY_KEY,PANTRY_DRAFT_KEY,'weekly-table-v1']).size,4);
  const draft=restoreDraft(null,null,defaults());
  assert.deepEqual(draft.slots,['lunch','dinner']);
  assert.equal(draft.maxMinutes,'60');
  assert.deepEqual(draft.favorites,['義式','西式']);
  assert.deepEqual(parseAvoid(draft.avoidText),DEFAULT_SETTINGS.avoid);
});

test('old built-in defaults migrate once without modifying a saved menu or cooked history',()=>{
  const old=legacySettings(),oldBefore=structuredClone(old),plan=generatePlan(old,[]);
  const cooked=setMealCooked(plan,plan.days[0].meals[0].key,true),snapshot=structuredClone(cooked);
  const draft=restoreDraft(null,old,defaults());
  assert.deepEqual(draft,settingsToDraft(defaults()));
  assert.deepEqual(old,oldBefore);
  assert.deepEqual(cooked,snapshot,'showing new defaults must not destroy prior cooked records or dishes');
  assert.equal(draftMatchesSettings(draft,old),false,'migration remains a pending draft until user generates');
});

test('legacy custom avoidance and explicit cuisine, meal and timing choices survive one-time migration',()=>{
  const old=legacySettings({slots:['lunch'],maxMinutes:45,favorites:['台式'],avoid:['香菜','牛肉','番茄']});
  const migrated=restoreDraft(undefined,old,defaults());
  assert.deepEqual(migrated.slots,['lunch']);
  assert.equal(migrated.maxMinutes,'45');
  assert.deepEqual(migrated.favorites,['台式']);
  assert.deepEqual(parseAvoid(migrated.avoidText),[...DEFAULT_SETTINGS.avoid,'香菜','牛肉']);
  const custom=roundTrip({version:2,draft:{...migrated,avoidText:'香菜、乳製品'}});
  assert.equal(restoreDraft(custom,old,defaults()).avoidText,'香菜、乳製品','new built-ins must not be re-appended on every reload');
});

test('unfinished drafts and explicitly cleared preferences survive JSON persistence without generating a new menu',()=>{
  const applied=legacySettings(),plan=generatePlan(applied,[]),before=structuredClone(plan);
  const unfinished={...settingsToDraft(applied),weekdayPeople:'',slots:[],favorites:[],avoidText:''};
  const saved=roundTrip({version:2,draft:unfinished});
  const restored=restoreDraft(saved,applied,defaults());
  assert.equal(restored.weekdayPeople,'');
  assert.deepEqual(restored.slots,[]);
  assert.deepEqual(restored.favorites,[]);
  assert.equal(restored.avoidText,'');
  assert.deepEqual(plan,before);
  assert.equal(draftMatchesSettings(restored,applied),false);
  assert.throws(()=>generatePlan(draftToSettings(restored,applied),[]),'incomplete form must remain visibly incomplete, not silently replace the menu');
});

test('saving a newly typed avoidance list does not mutate the settings used by the existing menu',()=>{
  const applied=legacySettings(),before=structuredClone(applied),plan=generatePlan(applied,[]),planBefore=structuredClone(plan);
  const typed={...settingsToDraft(applied),avoidText:'番茄、豬肉、雞肉調理包、香菜，牛奶'};
  const restored=restoreDraft(roundTrip({version:2,draft:typed}),applied,defaults());
  assert.equal(restored.avoidText,typed.avoidText);
  const next=draftToSettings(restored,applied);
  assert.deepEqual(next.avoid,['番茄','豬肉','雞肉調理包','香菜','牛奶']);
  assert.deepEqual(applied,before);
  assert.deepEqual(plan,planBefore);
  assert.equal(next.startDate,applied.startDate);
  assert.deepEqual(next.feedback,applied.feedback);
  assert.equal(next.seed,applied.seed);
});

test('avoidance separators normalize for planning while harmless ordering and whitespace do not show a false pending change',()=>{
  assert.deepEqual(parseAvoid(' 番茄、 豬肉，雞肉調理包\n香菜; 牛奶；青椒, '),['番茄','豬肉','雞肉調理包','香菜','牛奶','青椒']);
  const applied=defaults(),draft=settingsToDraft(applied);
  draft.slots.reverse();draft.favorites.reverse();draft.avoidText=[...applied.avoid].reverse().join('， ')+',番茄';
  assert.equal(draftMatchesSettings(draft,applied),true);
  draft.avoidText+='、牛奶';
  assert.equal(draftMatchesSettings(draft,applied),false);
});

test('partially corrupt saved draft fields fall back independently and preserve valid custom text',()=>{
  const restored=restoreDraft({version:2,draft:{weekdayPeople:{bad:true},slots:['breakfast'],favorites:['未知料理'],avoidText:'香菜、芝麻',maxMinutes:'60'}},null,defaults());
  assert.equal(restored.avoidText,'香菜、芝麻');
  assert.equal(restored.weekdayPeople,'2');
  assert.deepEqual(restored.slots,['lunch','dinner']);
  assert.deepEqual(restored.favorites,['義式','西式']);
  assert.equal(restored.maxMinutes,'60');
  assert.deepEqual(restoreDraft({version:2,draft:null},null,defaults()),settingsToDraft(defaults()));
});

test('pantry inventory preserves valid rows, zero and fractional quantities while isolating malformed rows',()=>{
  const input=[{ingredientId:'garlic',quantity:10.25},{ingredientId:'garlic',quantity:'20.50'},{ingredientId:'egg',quantity:0},{ingredientId:'tofu',quantity:1.333},null,{ingredientId:'unknown',quantity:20},{ingredientId:'salt',quantity:-3},{ingredientId:'oil',quantity:' '},{ingredientId:'broccoli',quantity:Infinity},{ingredientId:'milk',quantity:1000001},{ingredientId:'lemon',quantity:{}}];
  const snapshot=structuredClone(input),restored=sanitizeInventory(input,ids);
  assert.deepEqual(restored,[{ingredientId:'garlic',quantity:30.75},{ingredientId:'egg',quantity:0},{ingredientId:'tofu',quantity:1.33}]);
  assert.deepEqual(input,snapshot,'validation must not alter entered inventory');
  assert.deepEqual(sanitizeInventory(roundTrip(restored),ids),restored,'saved amounts must survive repeated reads exactly');
});

test('pantry recovery is independent of invalid menu or preference records',()=>{
  const pantryEnvelope=roundTrip({version:1,items:[{ingredientId:'chicken',quantity:420},{ingredientId:'egg',quantity:6}]});
  const badMenu={version:1,settings:{},plan:null},badPreferences={version:2,draft:null};
  assert.deepEqual(sanitizeInventory(pantryEnvelope.items,ids),pantryEnvelope.items);
  assert.deepEqual(restoreDraft(badPreferences,badMenu.settings,defaults()),settingsToDraft(defaults()));
  assert.deepEqual(sanitizeInventory(pantryEnvelope.items,ids),pantryEnvelope.items,'recovering a failed menu must not reset a separately saved fridge');
  const custom=restoreDraft({version:2,draft:{...settingsToDraft(defaults()),avoidText:'香菜'}},null,defaults());
  assert.deepEqual(sanitizeInventory({broken:true},ids),[]);
  assert.equal(custom.avoidText,'香菜','corrupt pantry cannot overwrite remembered avoidance');
});

test('unfinished pantry ingredient and amount survive persistence, including deliberately cleared fields',()=>{
  const incomplete={ingredientId:'broccoli',quantity:'350.5'};
  assert.deepEqual(sanitizePantryDraft(roundTrip(incomplete),ids),incomplete);
  assert.deepEqual(sanitizePantryDraft({ingredientId:'egg',quantity:''},ids),{ingredientId:'egg',quantity:''});
  assert.deepEqual(sanitizePantryDraft({ingredientId:'unknown',quantity:'25'},ids),{ingredientId:'',quantity:'25'});
  assert.deepEqual(sanitizePantryDraft(null,ids),{ingredientId:'',quantity:''});
});

test('backup-owned preferences and inventory can replace independent snapshots without resurrecting old drafts',()=>{
  const backupSettings=legacySettings({favorites:['美式'],avoid:['牛奶'],maxMinutes:60,slots:['lunch','dinner']}),backupInventory=[{ingredientId:'salmon',quantity:500}];
  const importedEnvelope=roundTrip({version:2,draft:settingsToDraft(backupSettings)});
  const restored=restoreDraft(importedEnvelope,defaults(),defaults());
  assert.equal(restored.avoidText,'牛奶');
  assert.deepEqual(restored.favorites,['美式']);
  assert.equal(draftMatchesSettings(restored,backupSettings),true);
  assert.deepEqual(sanitizeInventory(roundTrip(backupInventory),ids),backupInventory);
});
