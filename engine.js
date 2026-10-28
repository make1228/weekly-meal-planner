// AI 整理的內建食譜庫；數量、篩選、庫存扣除由下方程式計算。
export const INGREDIENTS = [
 ['chicken','去骨雞腿','g','肉類與海鮮'],['breast','雞胸肉','g','肉類與海鮮'],['beef','牛小排','g','肉類與海鮮'],['lamb','羊排','g','肉類與海鮮'],['pork','豬里肌','g','肉類與海鮮'],['salmon','鮭魚','g','肉類與海鮮'],['halibut','比目魚','g','肉類與海鮮'],['shrimp','去殼蝦仁','g','肉類與海鮮'],['tuna','鮪魚罐頭','罐','肉類與海鮮'],
 ['egg','雞蛋','顆','蛋與豆製品'],['tofu','板豆腐','g','蛋與豆製品'],['edamame','毛豆仁','g','蛋與豆製品'],
 ['broccoli','花椰菜','g','蔬菜與菇類'],['cabbage','高麗菜','g','蔬菜與菇類'],['spinach','菠菜','g','蔬菜與菇類'],['bokchoy','青江菜','g','蔬菜與菇類'],['mushroom','綜合菇','g','蔬菜與菇類'],['tomato','番茄','g','蔬菜與菇類'],['onion','洋蔥','g','蔬菜與菇類'],['carrot','紅蘿蔔','g','蔬菜與菇類'],['zucchini','櫛瓜','g','蔬菜與菇類'],['cucumber','小黃瓜','g','蔬菜與菇類'],['lettuce','生菜','g','蔬菜與菇類'],['garlic','蒜頭','g','蔬菜與菇類'],['ginger','薑','g','蔬菜與菇類'],['scallion','青蔥','g','蔬菜與菇類'],['lemon','檸檬','顆','蔬菜與菇類'],
 ['rice','熟白飯（可用即食飯）','g','主食與調理包'],['pasta','義大利麵（乾重）','g','主食與調理包'],['chicken-kit','雞肉調理包','份','主食與調理包'],['beef-kit','牛肉調理包','份','主食與調理包'],['pork-kit','豬肉調理包','份','主食與調理包'],['fish-kit','魚肉調理包','份','主食與調理包'],
 ['oil','橄欖油','ml','調味與其他'],['soy','醬油','ml','調味與其他'],['salt','鹽','g','調味與其他'],['pepper','黑胡椒','g','調味與其他'],['milk','牛奶','ml','調味與其他'],['butter','奶油','g','調味與其他'],['sesame','白芝麻','g','調味與其他']
].map(([id,name,unit,category])=>({id,name,unit,category}));
const ingredientMap = new Map(INGREDIENTS.map(x=>[x.id,x]));
const recipe = (id,title,cuisine,protein,minutes,equipment,starch,items,steps,tag='高蛋白')=>({id,title,cuisine,protein,minutes,equipment,starch,tag,baseServings:2,description:`${protein}搭配時蔬，${minutes} 分鐘完成的家常餐盤。`,ingredients:items.map(([ingredientId,quantity])=>({ingredientId,quantity})),steps});
export const RECIPES = [
 recipe('lemon-chicken','檸檬香煎雞腿佐花椰菜','西式','雞肉',25,'IH 爐','low',[['chicken',360],['broccoli',300],['lemon',1],['garlic',10],['oil',15],['salt',2],['pepper',1]],['雞腿擦乾，以鹽、黑胡椒與檸檬汁醃一下。','平底鍋加油，雞皮朝下煎香，再翻面煎至全熟。','花椰菜蒸熟，與雞腿盛盤，淋上剩餘檸檬汁。']),
 recipe('steamed-halibut','薑蔥蒸比目魚與青江菜','台式','魚肉',20,'蒸烤爐','low',[['halibut',360],['bokchoy',300],['ginger',15],['scallion',20],['soy',15],['oil',5]],['比目魚放入蒸盤，鋪上薑絲，青江菜洗淨備用。','蒸烤爐以蒸氣模式蒸至魚肉全熟，青菜另盤蒸熟。','魚肉淋醬油與少許油，撒蔥絲，搭配青江菜。']),
 recipe('beef-mushroom','香煎牛小排與蒜香菇','西式','牛肉',30,'IH 爐＋蒸烤爐','low',[['beef',360],['mushroom',250],['zucchini',250],['garlic',12],['oil',15],['salt',2],['pepper',1]],['牛小排擦乾調味，以 IH 平底鍋將兩面煎上色。','依蒸烤爐探針及食材安全指引完成中心熟度，靜置後切片。','原鍋炒香蒜末，加入菇與櫛瓜炒熟後盛盤。']),
 recipe('roasted-lamb','蒜香烤羊排與櫛瓜','西式','羊肉',35,'蒸烤爐','low',[['lamb',400],['zucchini',300],['carrot',150],['garlic',15],['oil',15],['salt',2],['pepper',1]],['羊排用蒜末、橄欖油、鹽與黑胡椒抹勻。','羊排與切塊蔬菜放入蒸烤爐，以烘烤模式烤至適當熟度。','使用烤箱收色功能完成表面，依食材安全指引確認熟度後靜置盛盤。']),
 recipe('tomato-egg-tofu','番茄滑蛋豆腐煲','台式','蛋豆',20,'IH 爐','low',[['egg',4],['tofu',300],['tomato',300],['scallion',15],['oil',10],['salt',2]],['番茄與豆腐切塊，雞蛋打散。','鍋中加油，先炒番茄出汁，再加入豆腐與少量水煮透。','倒入蛋液輕推至完全凝固，鹽調味後撒蔥花。']),
 recipe('shrimp-egg','蝦仁蒸蛋與燙菠菜','台式','海鮮',25,'蒸烤爐','low',[['shrimp',240],['egg',4],['spinach',300],['soy',10],['oil',5]],['蛋液加適量水與醬油，過篩倒入耐熱碗，放上蝦仁。','用蒸烤爐蒸至蛋液完全凝固、蝦仁全熟。','菠菜燙熟瀝水，拌少許油，搭配蒸蛋。']),
 recipe('salmon-broccoli','香烤鮭魚與雙色蔬菜','西式','魚肉',25,'氣炸鍋','low',[['salmon',360],['broccoli',250],['carrot',150],['lemon',1],['oil',10],['salt',2],['pepper',1]],['鮭魚以鹽、黑胡椒調味，蔬菜切小塊拌油。','魚與蔬菜放入氣炸鍋，視厚度烹調並中途檢查。','確認魚肉與蔬菜熟透，取出擠檸檬汁。']),
 recipe('ginger-pork','薑香里肌炒高麗菜','台式','豬肉',20,'IH 爐','low',[['pork',320],['cabbage',400],['ginger',15],['soy',20],['oil',10]],['里肌切薄片，拌少許醬油；高麗菜切片。','熱鍋下油與薑絲，加入豬肉炒至全熟。','放入高麗菜與剩餘醬油，拌炒至軟熟。']),
 recipe('garlic-shrimp','蒜香蝦仁櫛瓜盤','西式','海鮮',15,'IH 爐','low',[['shrimp',320],['zucchini',350],['garlic',15],['lemon',1],['oil',15],['salt',2],['pepper',1]],['蝦仁擦乾，櫛瓜切半月片，蒜頭切末。','油鍋炒香蒜末，先炒櫛瓜，再加入蝦仁炒熟。','鹽與黑胡椒調味，擠檸檬汁後盛盤。']),
 recipe('chicken-salad','溫雞胸毛豆沙拉','西式','雞肉',20,'IH 爐','low',[['breast',320],['edamame',150],['lettuce',200],['cucumber',150],['lemon',1],['oil',15],['salt',2]],['雞胸以鹽調味，放入微滾水中煮至全熟後切片。','毛豆煮熟，生菜與小黃瓜洗淨切好。','檸檬汁與橄欖油拌成醬汁，將食材盛盤拌勻。']),
 recipe('mushroom-chicken','菇菇蒸雞與青江菜','台式','雞肉',25,'蒸烤爐','low',[['chicken',360],['mushroom',250],['bokchoy',250],['ginger',10],['soy',20]],['雞腿切塊，拌薑絲與醬油，鋪在菇上。','放入蒸烤爐蒸至雞肉中心完全熟透。','青江菜另盤蒸熟，與菇雞一起盛盤。']),
 recipe('tofu-edamame','毛豆豆腐炒蛋','台式','蛋豆',15,'IH 爐','low',[['tofu',350],['edamame',180],['egg',3],['carrot',100],['oil',10],['soy',15]],['豆腐切塊、紅蘿蔔切細丁，毛豆先煮熟。','鍋中熱油，炒熟紅蘿蔔，加入豆腐與毛豆拌炒。','倒入蛋液，炒至完全凝固，加醬油調味。']),
 recipe('pepper-beef','黑胡椒牛肉洋蔥盤','西式','牛肉',20,'IH 爐','low',[['beef',340],['onion',200],['broccoli',250],['oil',10],['soy',15],['pepper',2]],['牛肉切片，洋蔥切絲，花椰菜蒸熟。','熱鍋加油先炒洋蔥，再加入牛肉炒熟。','以醬油與黑胡椒調味，搭配花椰菜盛盤。']),
 recipe('lemon-pork','檸檬煎里肌與菠菜','西式','豬肉',20,'IH 爐','low',[['pork',360],['spinach',350],['lemon',1],['garlic',10],['oil',15],['salt',2]],['里肌切片，以鹽與檸檬汁略醃。','平底鍋熱油，將里肌兩面煎至全熟。','原鍋爆香蒜末，加入菠菜炒熟，與里肌盛盤。']),
 recipe('halibut-tomato','番茄菇菇燉比目魚','西式','魚肉',25,'IH 爐','low',[['halibut',360],['tomato',300],['mushroom',200],['onion',100],['garlic',10],['oil',10],['salt',2]],['洋蔥、番茄切塊，蒜頭切末。','油鍋炒香洋蔥與蒜末，加入番茄與菇煮出湯汁。','放入比目魚，加蓋燉至魚肉全熟，再以鹽調味。']),
 recipe('shrimp-tofu','鮮蝦豆腐青菜湯','台式','海鮮',15,'IH 爐','low',[['shrimp',280],['tofu',300],['bokchoy',300],['ginger',10],['salt',2]],['豆腐切塊、青江菜洗淨，薑切絲。','水煮滾加入豆腐與薑絲，再放蝦仁煮熟。','加入青江菜煮軟，以鹽調味後盛碗。']),
 recipe('egg-salad','鮪魚水煮蛋沙拉','西式','魚肉',15,'IH 爐','low',[['tuna',2],['egg',4],['lettuce',250],['cucumber',200],['lemon',1],['oil',15]],['雞蛋煮至蛋黃全熟，冷卻剝殼切半。','生菜與小黃瓜洗淨切好，鮪魚瀝乾。','所有食材盛盤，拌入橄欖油與檸檬汁。']),
 recipe('air-chicken','香烤雞腿與高麗菜','西式','雞肉',30,'氣炸鍋＋IH 爐','low',[['chicken',380],['cabbage',350],['garlic',12],['oil',15],['salt',2],['pepper',1]],['雞腿以蒜末、鹽、黑胡椒與少許油抹勻。','雞腿放氣炸鍋烤至中心全熟，中途翻面檢查。','高麗菜以 IH 爐炒熟，與雞腿一起盛盤。']),
 recipe('rice-chicken','雞肉調理包飯與青菜','台式','雞肉',15,'微波爐＋IH 爐','rice',[['chicken-kit',2],['rice',300],['bokchoy',300],['oil',5]],['使用預先煮好、妥善保存的白飯或即食飯，充分復熱。','雞肉調理包依包裝指示充分加熱。','青江菜燙熟拌油，搭配白飯與雞肉調理包。'],'調理包套餐'),
 recipe('rice-beef','牛肉調理包飯與花椰菜','台式','牛肉',15,'微波爐＋IH 爐','rice',[['beef-kit',2],['rice',300],['broccoli',300]],['使用預先煮好、妥善保存的白飯或即食飯，充分復熱。','牛肉調理包依包裝指示充分加熱。','花椰菜蒸熟，與白飯及牛肉調理包盛盤。'],'調理包套餐'),
 recipe('rice-pork','豬肉調理包飯與菠菜','台式','豬肉',15,'微波爐＋IH 爐','rice',[['pork-kit',2],['rice',300],['spinach',300],['sesame',5]],['使用預先煮好、妥善保存的白飯或即食飯，充分復熱。','豬肉調理包依包裝指示充分加熱。','菠菜燙熟撒芝麻，與飯及調理包搭配。'],'調理包套餐'),
 recipe('rice-fish','魚肉調理包飯與菇菜','台式','魚肉',15,'微波爐＋IH 爐','rice',[['fish-kit',2],['rice',300],['mushroom',150],['bokchoy',200],['oil',5]],['熟白飯或即食飯充分復熱；菇與青江菜洗淨切好。','魚肉調理包依包裝指示充分加熱。','少許油炒熟菇與青江菜，搭配白飯和魚肉。'],'調理包套餐'),
 recipe('pasta-shrimp','蒜香蝦仁花椰菜義大利麵','義式','海鮮',25,'IH 爐','pasta',[['pasta',140],['shrimp',300],['broccoli',250],['garlic',15],['oil',20],['salt',2],['pepper',1]],['義大利麵依包裝煮熟，保留少量煮麵水，花椰菜燙熟。','油鍋炒香蒜末，加入蝦仁炒至全熟。','放入麵與花椰菜，用少量煮麵水拌勻，鹽與胡椒調味。']),
 recipe('pasta-chicken','番茄雞胸義大利麵','義式','雞肉',25,'IH 爐','pasta',[['pasta',140],['breast',300],['tomato',300],['onion',100],['garlic',10],['oil',15],['salt',2]],['義大利麵煮熟，雞胸切小塊，番茄與洋蔥切丁。','油鍋炒香蒜末與洋蔥，加入雞胸炒至全熟。','放番茄燉出汁後，加入麵拌勻調味。']),
 recipe('pasta-tuna','鮪魚番茄快手義大利麵','義式','魚肉',15,'IH 爐','pasta',[['pasta',140],['tuna',2],['tomato',300],['spinach',150],['garlic',10],['oil',15],['salt',2]],['義大利麵煮熟，同時將番茄切丁、菠菜洗淨。','油鍋炒香蒜末，加入番茄與鮪魚煮熱。','加入菠菜與麵拌炒至熟，以鹽調味。'],'快手料理'),
 recipe('pasta-mushroom','奶香菇菇雞肉義大利麵','義式','雞肉',25,'IH 爐','pasta',[['pasta',140],['breast',300],['mushroom',250],['milk',160],['garlic',10],['butter',15],['salt',2],['pepper',1]],['義大利麵煮熟，雞胸切小塊、菇剝開。','奶油炒香蒜末，加入雞胸與菇炒至全熟。','倒入牛奶稍煮，加入麵拌勻，以鹽與黑胡椒調味。']),
 recipe('pasta-egg','毛豆蛋香義大利麵','義式','蛋豆',15,'IH 爐','pasta',[['pasta',140],['egg',4],['edamame',200],['spinach',200],['garlic',10],['oil',15],['salt',2]],['義大利麵與毛豆煮熟，菠菜洗淨。','油鍋炒香蒜末，倒入蛋液炒至完全凝固。','加入菠菜、毛豆與麵，拌炒至熟並以鹽調味。'])
];
const recipeMap = new Map(RECIPES.map(x=>[x.id,x]));
export const recipeById = id => recipeMap.get(id);
const iso = d => d.toISOString().slice(0,10);
function parseDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('請選擇有效的開始日期。');
 const d=new Date(`${value}T12:00:00Z`); if(!Number.isFinite(d.getTime())||iso(d)!==value)throw new Error('請選擇有效的開始日期。'); return d;
}
export function addDays(value,n){const d=parseDate(value);d.setUTCDate(d.getUTCDate()+n);return iso(d);}
export function getMonday(value=iso(new Date())){const d=parseDate(value);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return iso(d);}
export const DEFAULT_SETTINGS = {startDate:getMonday(),weekdayPeople:2,weekendPeople:2,slots:['dinner'],maxMinutes:35,avoid:['青椒','茄子','酪梨','照燒','漢堡排'],favorites:[],riceMeals:2,pastaMeals:1,feedback:{},seed:0};
const round = n => Math.round((n+Number.EPSILON)*100)/100;
export function formatQty(value,unit='g'){const n=Number(value);if(!Number.isFinite(n))return '0';return String(round(n));}
function settingsWithDefaults(input={}){
 const s={...DEFAULT_SETTINGS,...input};
 s.startDate=getMonday(s.startDate);
 for(const [key,label] of [['weekdayPeople','平日人數'],['weekendPeople','週末人數']]){s[key]=Number(s[key]);if(!Number.isInteger(s[key])||s[key]<1||s[key]>20)throw new Error(`${label}請填入 1 至 20 的整數。`);}
 s.maxMinutes=Number(s.maxMinutes);if(!Number.isFinite(s.maxMinutes)||s.maxMinutes<5||s.maxMinutes>180)throw new Error('備餐時間請設定為 5 至 180 分鐘。');
 if(!Array.isArray(s.slots)||!s.slots.length||s.slots.some(x=>!['lunch','dinner'].includes(x)))throw new Error('請至少選擇午餐或晚餐。');
 s.slots=['lunch','dinner'].filter(x=>s.slots.includes(x));
 for(const key of ['riceMeals','pastaMeals']){s[key]=Number(s[key]);if(!Number.isInteger(s[key])||s[key]<0||s[key]>7*s.slots.length)throw new Error('每週主食餐數請填入有效的整數。');}
 if(s.riceMeals+s.pastaMeals>7*s.slots.length)throw new Error('白飯與義大利麵餐數合計不可超過本週總餐數。');
 if(!Array.isArray(s.avoid)||!Array.isArray(s.favorites))throw new Error('飲食偏好格式不正確，請重新設定。');
 s.avoid=s.avoid.map(x=>String(x).trim()).filter(Boolean);s.favorites=s.favorites.map(String);s.feedback=s.feedback&&typeof s.feedback==='object'?s.feedback:{};
 s.seed=Number.isFinite(Number(s.seed))?Number(s.seed):0;return s;
}
function inventoryMap(items=[]){
 if(!Array.isArray(items))throw new Error('庫存格式不正確。');
 const map=new Map();for(const row of items){if(!ingredientMap.has(row.ingredientId))throw new Error('庫存包含不支援的食材，請重新選擇。');const qty=Number(row.quantity);if(!Number.isFinite(qty)||qty<0||qty>1000000)throw new Error('庫存數量請填入 0 至 1,000,000 的有效數字。');map.set(row.ingredientId,round((map.get(row.ingredientId)||0)+qty));}return map;
}
function candidates(s){return RECIPES.filter(r=>r.minutes<=s.maxMinutes&&!s.avoid.some(word=>[r.title,r.protein,...r.ingredients.map(i=>ingredientMap.get(i.ingredientId).name)].some(t=>t.includes(word))));}
function hash(str){let h=2166136261;for(const c of str){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function score(r,s,stock,used,previousProtein,position){
 let value=(hash(`${s.seed}|${s.startDate}|${position}|${r.id}`)%1000)/1000;
 value+=(s.favorites.includes(r.cuisine)?8:0)+(s.favorites.includes(r.protein)?8:0);
 const fb=s.feedback[r.id]||{};if(fb.liked===true)value+=10;if(fb.liked===false)value-=15;if(fb.slow===true)value-=4;
 if(r.protein===previousProtein)value-=7;
 value-=(used.get(r.id)||0)*18;
 for(const item of r.ingredients){const have=stock.get(item.ingredientId)||0;if(have>0)value+=Math.min(have/item.quantity,1)*2;}
 return value;
}
function choose(pool,s,stock,used,previousProtein,position,exclude){
 const options=pool.filter(r=>r.id!==exclude);if(!options.length)throw new Error('目前條件沒有可替換料理，請放寬備餐時間或忌口條件。');
 return options.map(r=>({r,value:score(r,s,stock,used,previousProtein,position)})).sort((a,b)=>b.value-a.value||a.r.id.localeCompare(b.r.id))[0].r;
}
export function generatePlan(input={},inventory=[],previousPlan){
 const s=settingsWithDefaults(input),stock=inventoryMap(inventory),pool=candidates(s),total=s.slots.length*7;
 if(!pool.length)throw new Error('找不到符合條件的料理，請增加備餐時間或調整忌口食材。');
 const starches=Array(total).fill('low');
 // Spread planned starch meals across the week rather than clustering them.
 const wanted=[...Array(s.riceMeals).fill('rice'),...Array(s.pastaMeals).fill('pasta')];
 for(let i=0;i<wanted.length;i++){const index=Math.floor((i+0.5)*total/wanted.length);starches[index]=wanted[i];}
 for(const type of new Set(starches)){if(!pool.some(r=>r.starch===type))throw new Error(`目前條件沒有${type==='rice'?'白飯調理包':type==='pasta'?'義大利麵':'低澱粉'}料理，請調整餐數、忌口或備餐時間。`);}
 const used=new Map(),days=[];let previousProtein='',position=0;
 const previousMeals=new Map((previousPlan?.days||[]).flatMap(d=>d.meals||[]).map(m=>[m.key,m.recipeId]));
 for(let day=0;day<7;day++){
  const date=addDays(s.startDate,day),meals=[];
  for(const slot of s.slots){
   const key=`${date}-${slot}`,type=starches[position],category=pool.filter(r=>r.starch===type);
   const previous=previousMeals.get(key);
   const r=choose(category,s,stock,used,previousProtein,position,category.length>1?previous:undefined);
   const servings=day>=5?s.weekendPeople:s.weekdayPeople;
   meals.push({key,date,slot,recipeId:r.id,servings});used.set(r.id,(used.get(r.id)||0)+1);previousProtein=r.protein;
   for(const item of r.ingredients)stock.set(item.ingredientId,Math.max(0,(stock.get(item.ingredientId)||0)-item.quantity*servings/r.baseServings));
   position++;
  }
  days.push({date,weekday:day+1,dayLabel:['週一','週二','週三','週四','週五','週六','週日'][day],meals});
 }
 return {startDate:s.startDate,days,generatedAt:new Date().toISOString()};
}
function validatePlan(plan){
 if(!plan||!Array.isArray(plan.days))throw new Error('菜單資料格式不正確，請重新產生菜單。');
 const keys=new Set();for(const day of plan.days){if(!Array.isArray(day.meals))throw new Error('菜單資料格式不正確。');for(const meal of day.meals){if(!recipeMap.has(meal.recipeId)||!Number.isFinite(Number(meal.servings))||Number(meal.servings)<=0||keys.has(meal.key))throw new Error('菜單含有無效的料理或份量，請重新產生。');if(meal.cooked!==undefined&&typeof meal.cooked!=='boolean')throw new Error('菜單中的已煮好狀態不正確，請重新設定。');keys.add(meal.key);}}
 return plan.days.flatMap(d=>d.meals);
}
export function setMealCooked(plan,mealKey,cookedBoolean){
 if(typeof cookedBoolean!=='boolean')throw new Error('已煮好狀態必須是勾選或取消勾選。');
 const meals=validatePlan(plan);
 if(!meals.some(m=>m.key===mealKey))throw new Error('找不到要標記的餐點。');
 return {...plan,days:plan.days.map(d=>d.meals.some(m=>m.key===mealKey)?{...d,meals:d.meals.map(m=>m.key===mealKey?{...m,cooked:cookedBoolean}:m)}:d)};
}
function replacementContext(plan,mealKey,input,inventory){
 const s=settingsWithDefaults(input),stock=inventoryMap(inventory),meals=validatePlan(plan),target=meals.find(m=>m.key===mealKey);
 if(!target)throw new Error('找不到要替換的餐點。');
 if(target.cooked===true)throw new Error('這餐已標記煮好，請先取消「已煮好」再更換料理。');
 const current=recipeMap.get(target.recipeId),pool=candidates(s).filter(r=>r.starch===current.starch&&r.id!==current.id);
 const used=new Map();for(const meal of meals){if(meal.key!==mealKey)used.set(meal.recipeId,(used.get(meal.recipeId)||0)+1);}
 const index=meals.indexOf(target),previousProtein=index?recipeMap.get(meals[index-1].recipeId).protein:'';
 const options=pool.map(r=>({r,value:score(r,s,stock,used,previousProtein,index)})).sort((a,b)=>b.value-a.value||a.r.id.localeCompare(b.r.id)).map(x=>x.r);
 return {target,options};
}
// List every valid alternative, including dishes already planned on another day.
// Preference scores influence order, never the number of choices offered.
export function getReplacementOptions(plan,mealKey,input={},inventory=[]){
 return replacementContext(plan,mealKey,input,inventory).options;
}
export function replaceMeal(plan,mealKey,input={},inventory=[],selectedRecipeId,allowedRecipeIds){
 const {target,options:eligibleOptions}=replacementContext(plan,mealKey,input,inventory);
 let options=eligibleOptions;
 if(allowedRecipeIds!==undefined){
  if(!Array.isArray(allowedRecipeIds)||allowedRecipeIds.some(id=>typeof id!=='string'))throw new Error('候選料理篩選格式不正確，請重新選擇。');
  const allowed=new Set(allowedRecipeIds);
  options=options.filter(r=>allowed.has(r.id));
  if(!options.length)throw new Error('目前篩選沒有可替換料理，請調整搜尋或料理篩選。');
 }
 if(!options.length)throw new Error('目前條件沒有同類型的替換料理，請放寬備餐時間或忌口條件。');
 const eligibleIds=new Set([target.recipeId,...options.map(r=>r.id)]);
 let history=[...new Set([...(Array.isArray(target.replacementHistory)?target.replacementHistory.filter(id=>typeof id==='string'&&eligibleIds.has(id)):[]),target.recipeId])];
 let replacement;
 if(selectedRecipeId!==undefined){
  replacement=options.find(r=>r.id===selectedRecipeId);
  if(!replacement)throw new Error('這道料理目前不可替換，請從符合條件的候選料理中選擇。');
 }else{
  // A high preference score must not make quick-swap bounce between two dishes.
  // Finish a complete cycle of eligible dishes before returning to earlier ones.
  let unseen=options.filter(r=>!history.includes(r.id));
  if(!unseen.length){history=[target.recipeId];unseen=options;}
  replacement=unseen[0];
 }
 history=[...new Set([...history,replacement.id])];
 return {...plan,days:plan.days.map(d=>({...d,meals:d.meals.map(m=>m.key===mealKey?{...m,recipeId:replacement.id,replacementHistory:history}:{...m})})),generatedAt:new Date().toISOString()};
}
export function aggregateShopping(plan,inventory=[]){
 const stock=inventoryMap(inventory),totals=new Map();
 for(const meal of validatePlan(plan)){if(meal.cooked===true)continue;const r=recipeMap.get(meal.recipeId);for(const item of r.ingredients){let row=totals.get(item.ingredientId);if(!row){const i=ingredientMap.get(item.ingredientId);row={ingredientId:i.id,name:i.name,unit:i.unit,category:i.category,required:0,stock:stock.get(i.id)||0,usedStock:0,toBuy:0,mealKeys:[]};totals.set(i.id,row);}row.required+=item.quantity*Number(meal.servings)/r.baseServings;row.mealKeys.push(meal.key);}}
 const order=[...new Set(INGREDIENTS.map(i=>i.category))];
 return [...totals.values()].map(row=>{row.required=round(row.required);row.usedStock=round(Math.min(row.required,row.stock));row.toBuy=round(Math.max(0,row.required-row.usedStock));return row;}).sort((a,b)=>order.indexOf(a.category)-order.indexOf(b.category)||a.name.localeCompare(b.name,'zh-Hant'));
}
