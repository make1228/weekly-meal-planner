// Shared kitchen techniques. Recipe authors select and order these explicitly.
const idsOf=value=>String(value).split(',').filter(Boolean);
const has=(r,id)=>r.ingredients.some(item=>item.ingredientId===id);
const names={egg:'雞蛋',rice:'熟白飯',pasta:'乾義大利麵','blue-cheese':'藍紋起司',mentaiko:'明太子',rosemary:'迷迭香',basil:'羅勒',paprika:'紅椒粉',curry:'咖哩粉',cumin:'孜然粉',sesame:'白芝麻','chicken-kit':'雞肉調理包','beef-kit':'牛肉調理包','pork-kit':'豬肉調理包','fish-kit':'魚肉調理包',chicken:'去骨雞腿',breast:'雞胸',beef:'牛小排',lamb:'羊排',pork:'豬里肌',salmon:'鮭魚',halibut:'比目魚',seabass:'鱸魚片',shrimp:'蝦仁',scallop:'干貝',squid:'透抽',clams:'蛤蜊',tofu:'板豆腐',edamame:'毛豆仁',broccoli:'花椰菜',cabbage:'高麗菜',spinach:'菠菜',bokchoy:'青江菜',mushroom:'綜合菇',tomato:'番茄',onion:'洋蔥',carrot:'紅蘿蔔',zucchini:'櫛瓜',cucumber:'小黃瓜',lettuce:'生菜',garlic:'蒜末',ginger:'薑',scallion:'青蔥',asparagus:'蘆筍',corn:'玉米粒',potato:'馬鈴薯',sweetpotato:'地瓜',celery:'芹菜',oil:'橄欖油',butter:'奶油',milk:'牛奶',cream:'鮮奶油',parmesan:'帕瑪森',mozzarella:'莫札瑞拉',cheddar:'切達',cheese:'起司',pesto:'青醬',truffle:'松露醬',mustard:'芥末醬',yogurt:'無糖優格',lemon:'檸檬'};
const label=(r,ids)=>idsOf(ids).map(id=>{if(!has(r,id))throw new Error(r.id+' 缺少食材 '+id);return names[id]||id;}).join('、');
const stage=(render,fat=null)=>({render,fat});
const water=ml=>'{{water:'+ml+'}}';
const target=r=>r.guideOptions?.casserole?'焗烤／復熱料理中心須達74°C。':has(r,'chicken')||has(r,'breast')?'雞肉最厚處須達74°C。':r.guideOptions?.ground?.length?'碎肉或肉餅中心須達71°C。':has(r,'egg')?'蛋液中心須達71°C並完全凝固。':['beef','lamb','pork'].some(id=>has(r,id))?'肉最厚處須達63°C，離火靜置至少3分鐘。':['salmon','halibut','seabass'].some(id=>has(r,id))?'魚肉最厚處須達63°C，且可剝開。':'中心要完全熱透；蝦與干貝呈乳白不透明，蛤蜊需開殼。';
const liquid=r=>['milk','cream'].filter(id=>has(r,id)).map(id=>'{{'+id+'}}'+names[id]).join('與');
export const G=(preparation,steps,tips,options={})=>({preparation:Array.isArray(preparation)?preparation:[preparation],steps,tips:Array.isArray(tips)?tips:[tips],...options});
export const K={
 action:(text,fat='hot')=>stage((r,c)=>text.replace(/\[\[fat\]\]/g,c.fat),fat),
 pasta:()=>stage(r=>'煮麵：另鍋燒水，水量以麵能自由散開為準。放入{{pasta}}乾麵後攪散，依包裝時間煮至尚差1分鐘；先舀出'+water(150)+'煮麵水備用，再瀝麵。熱拌麵不沖冷水，冷麵則用乾淨飲用冷水降溫後充分瀝乾。'),
 rice:()=>stage(r=>'準備熟飯：這道使用{{rice}}熟飯，不是生米。冷藏飯放可微波的玻璃／陶瓷碗，灑'+water(15)+'水、加透氣蓋，以600W先熱2分鐘，翻鬆後每次補30秒至整碗中心74°C；金屬碗和密封包裝不可直接微波。'),
 ricePan:()=>stage(r=>'鬆飯：將{{rice}}熟飯用飯匙輕輕撥散。冷藏飯可先隔水蒸5～8分鐘至整碗滾熱、中心74°C；這是熟飯快煮版本，若從生米開始，需另預留電子鍋煮飯時間。'),
 veg:(ids,minutes='3～5')=>stage(r=>'蔬菜熟化：'+label(r,ids)+'放入滾水／已出蒸氣的蒸鍋，加熱'+minutes+'分鐘。粗硬的梗先下，嫩葉後下；以叉子可穿過硬梗、葉菜軟而仍有色澤為準，取出充分瀝乾。'),
 saute:(ids,minutes='3～5',extra='')=>stage((r,c)=>'炒配菜：IH爐以中火預熱平底鍋約1分鐘，'+c.fat+'，加入'+label(r,ids)+'攤開炒'+minutes+'分鐘；水分多時先讓蒸氣散掉再翻動。'+(extra||'炒至硬料可咬斷、菇邊微上色；接著做醬時可留鍋，若要另煎主料，先盛出並在合併時放回。'),'hot'),
 aromatics:(ids='onion,garlic',minutes='2～3')=>stage((r,c)=>'炒香底料：IH爐中小火預熱鍋約1分鐘，'+c.fat+'，以中小火炒'+label(r,ids)+minutes+'分鐘，直到材料散出香味、邊緣尚未焦黑。若有細碎蒜末，在最後30秒加入，避免先焦苦。','hot'),
 poach:(id='breast')=>stage(r=>'溫和煮雞肉：'+label(r,id)+'厚處先橫剖至約1.5公分，放入剛煮滾的水，水面高出肉約2公分。立刻轉小火保持微冒泡，煮8～12分鐘；探針從側面插入最厚處達74°C就撈出，未達溫每次再煮1分鐘，不用大滾久煮。'),
 restChicken:(shred=false)=>stage(r=>'留住肉汁：雞肉放乾淨盤上鬆鬆覆蓋，靜置3分鐘。'+(shred?'沿纖維撕成粗絲，勿在鍋內反覆攪碎；':'逆紋切約0.8公分片，先切一片確認中心已熟；')+'若有未熟的部位，放回鍋中加熱至74°C。把熟食換到乾淨砧板處理，不接觸生肉盤汁。'),
 chicken:(id='chicken',pieces=true)=>stage((r,c)=>'煎雞肉：'+c.fat+'，將擦乾的'+label(r,id)+'單層放入中火鍋。'+(pieces?'約1.5～2公分肉丁先煎2～3分鐘再翻面，轉中小火再煎3～5分鐘；':'攤平的肉排先煎皮面／第一面5～6分鐘，翻面轉中小火再煎4～6分鐘；')+'必要時加1～2匙水蓋鍋1分鐘，最厚處達74°C後立刻取出，避免一直煎到乾柴；先盛乾淨盤，接著用原鍋做配菜或醬汁。','hot'),
 beef:(id='beef',whole=false)=>stage((r,c)=>'煎肉：'+c.fat+'，中大火熱鍋後放'+label(r,id)+'，不要重疊。'+(whole?'以下以約1.5～2公分厚的整塊肉為準：每面先煎2～3分鐘，再轉中小火補熟；':'薄片每面約30～60秒，分批煎香後以中小火完成中心熟度；')+'肉最厚處須達63°C，取出放乾淨盤靜置至少3分鐘。時間以厚度與探針為準；接著做配菜時肉先留盤中。','hot'),
 fish:(id='salmon')=>stage((r,c)=>'煎魚：'+c.fat+'，中火放入擦乾、約2公分厚的'+label(r,id)+'。有皮的先皮面朝下煎3～4分鐘，再翻面煎2～3分鐘；無皮魚勿頻繁翻動。厚處未熟可加1匙水、蓋鍋再熱1～2分鐘，以中心63°C且魚肉可剝開為準；用寬鏟先盛到乾淨盤，再做配菜或醬汁。','hot'),
 shrimp:()=>stage((r,c)=>'煎蝦仁：'+c.fat+'，以中火放入擦乾的{{shrimp}}蝦仁，第一面煎約1～2分鐘、翻面再煎1分鐘。中央最厚處呈乳白不透明、摸起來有彈性即先盛出；若仍透明就再短煮，別等到整隻縮成緊圈才起鍋。','hot'),
 scallop:()=>stage((r,c)=>'煎干貝：擦到表面沒有水珠，'+c.fat+'。中大火將{{scallop}}干貝單層下鍋，先不移動約1.5～2分鐘，出現金黃面再翻面煎1～2分鐘；大顆轉中小火補熱30～60秒，至中心乳白、不透明而有彈性後盛出。','hot'),
 squid:()=>stage((r,c)=>'快炒透抽：'+c.fat+'，中大火放入擦乾、切約1公分圈的{{squid}}透抽，翻炒約2～3分鐘。肉由透明轉白、捲起且中心熟透即取出；鍋子太小就分批炒，避免出水變成久燉而橡皮化。','hot'),
 clams:(ml=80)=>stage(r=>'煮開蛤蜊：把已依包裝完成吐沙／清洗的{{clams}}蛤蜊放入鍋，加'+water(ml)+'清水，蓋鍋中大火煮約4～6分鐘。殼一開就逐顆夾到乾淨碗，最後仍不開的不用；湯汁煮沸後過細篩，保留作醬汁，勿把底部砂粒倒回。'),
 tofu:()=>stage((r,c)=>'煎豆腐：{{tofu}}板豆腐用廚房紙巾吸乾，切約1.5公分厚。'+c.fat+'，中火煎第一面3～4分鐘，底部成金黃色、可輕推動再翻面，第二面再煎2～3分鐘；用寬鍋鏟托起，避免碎裂。','hot'),
 cream:()=>stage((r,c)=>'煮乳香醬：'+c.fat+'，倒入'+liquid(r)+'，轉小火煮3～5分鐘，鍋邊有細泡即可，不要大滾。邊拌邊讓液體略收濃，能薄薄掛住湯匙；太稠每次補1匙清水，太稀就多煮1～2分鐘。',r=>has(r,'butter')?'butter':null),
 cheese:(ids='parmesan')=>stage(r=>'拌起司：把火調到最小或先離火，將'+label(r,ids)+'刨碎／撕小，分2～3次拌入。每次融開再加下一次；若變成拉絲硬團，先補1匙溫水輕拌，不以大火硬煮，表列鹽先保留到最後試味。'),
 yogurt:()=>stage(r=>'調優格醬：將{{yogurt}}無糖優格攪順，'+(has(r,'mustard')?'加入{{mustard}}芥末醬，':'')+(has(r,'lemon')?'檸檬汁先擠一半量拌入，另半量留最後調酸度。':'用表列調味料少量調整。')+'熱鍋料理要先關火、等沸騰停止再拌優格，避免煮沸後油水分離；冷沙拉則另用乾淨碗拌勻。'),
 dressing:()=>stage((r,c)=>'調淋醬：用乾淨小碗，'+c.fat+'，'+(has(r,'mustard')?'加入{{mustard}}芥末醬，':'')+(has(r,'honey')?'加入{{honey}}蜂蜜，':'')+(has(r,'lemon')?'把檸檬汁分次擠入，邊拌邊嚐酸度。':'用表列醬油分次調味。')+'先拌成均勻醬液，留在一旁；接觸過生肉的醃汁不能直接拿來作淋醬。',r=>has(r,'oil')?'oil':null),
 soup:(ml=600,minutes='8～10')=>stage(r=>'煮湯底：倒入'+water(ml)+'清水，中火煮滾後轉小火，加蓋留縫煮'+minutes+'分鐘。硬蔬菜需能用叉子穿過；若蒸發太多，補熱水到剛蓋過材料，最後才用表列鹽／醬油逐次調味。'),
 custard:(minutes='18～22')=>stage(r=>'蒸蛋：蛋液打散後秤重，清水用「蛋液重量×1.5」，'+(has(r,'milk')?'若加入表列牛奶，其量要先從這份液體總量扣除，':'')+'再拌入表列調味料並過篩。裝淺耐熱碗至七分滿、覆耐熱盤防滴水；蒸烤爐獨立蒸氣90°C蒸'+minutes+'分鐘，中心凝固且達71°C才出爐；未熟每次補2分鐘。'),
 bake:(temp=190,minutes='12～15',extra='')=>stage(r=>'入爐：蒸烤爐先選4D熱風預熱至'+temp+'°C。將耐熱烤皿放中層，烤'+minutes+'分鐘；表面上色太快可鬆蓋烘焙紙並調低10°C。'+(extra||'中心必須熱透，不能只看起司金黃；含禽肉或熟食再加熱的焗烤以中心74°C為準，蛋料理需完全凝固。')),
 steam:(minutes='12～15',extra='')=>stage(r=>'蒸熟：蒸烤爐水箱加水，選獨立蒸氣100°C，待出蒸氣再把淺耐熱盤放入中層，蒸'+minutes+'分鐘。'+(extra||'魚肉最厚處需63°C，禽肉需74°C；蛋餡要凝固。厚薄不同以探針調整，每次補蒸2分鐘，取盤時注意蒸氣與積水。')),
 air:(temp=180,minutes='18～22',extra='')=>stage((r,c)=>'氣炸：先以'+temp+'°C預熱3分鐘，'+c.fat+'，薄薄抹在食材表面。單層放籃、留空隙，烤'+minutes+'分鐘，中途翻面或轉向一次。'+(extra||'雞肉最厚處需74°C；若表面已上色而中心不足，降至170°C再補2～3分鐘。不要用表面焦色替代熟度判斷。'),'hot'),
 eggPan:()=>stage((r,c)=>'煎蛋液：雞蛋打散，'+c.fat+'。用20～24公分不沾鍋，中小火倒入蛋液與已熟配料，輕晃鋪平；加蓋小火煎6～9分鐘，表面不再流動後再確認中心71°C。厚度超過2公分需延長時間，不用大火催熟底部。','hot'),
 scrambled:()=>stage((r,c)=>'炒蛋：已熟配菜先盛出，雞蛋充分打散，'+c.fat+'，以中小火倒入蛋液，停約10秒後從邊緣向中央輕推。炒1～2分鐘至蛋液完全凝固、仍有濕潤光澤即起鍋；配料已熟才能在最後拌回，避免為了煮配料把蛋炒老。','hot'),
 mash:(ids,minutes='8～12')=>stage(r=>'製作蔬菜泥：'+label(r,ids)+'切成約1公分小塊，隔水蒸／少量水煮'+minutes+'分鐘，至叉子可輕壓碎。瀝乾趁熱用叉子壓泥，保留的煮菜水分次加到可抹開的稠度；保留少量顆粒也可以，不需另外添購調理機。'),
 simmer:(minutes='8～10',ml=120,extra='')=>stage(r=>'小火燜煮：加入'+water(ml)+'清水，煮滾後轉小火、加蓋燜'+minutes+'分鐘，中途翻動一次防黏底。'+(extra||''+target(r)+'')+'汁太多可最後開蓋再煮1～2分鐘，汁太少則每次補1匙熱水。'),
 toss:()=>stage(r=>'合併調味：把已熟的主料、配菜放回鍋，中小火輕拌30～60秒。'+(has(r,'pasta')?'麵太乾時分次加保留的煮麵水，拌到醬汁薄裹住麵；':'')+'用表列調味料的剩餘量調整，不額外重複加入整份鹽或醬油；葉菜保持顏色、海鮮不再久煮。'),
 plate:(extra='')=>stage(r=>'完成與上桌：先確認主料已達下方的熟度判斷，再用乾淨夾子／鍋鏟分盤。'+(extra||'把鍋汁或醬汁薄薄淋上，避免浸泡酥皮或讓沙拉積水；熱食趁熱吃，沙拉則在上桌前才拌醬。')+'較大份量請分批煎烤，不把鍋子塞滿。'),
 package:(id)=>stage(r=>'加熱調理包：'+label(r,id)+'以實際包裝標示的加熱方式與時間為準，勿把密封袋直接放進微波。拆入可微波容器、覆透氣蓋，分段加熱並攪拌；冷藏熟食復熱至中心74°C，局部仍冷就繼續短時間補熱。')
};
export function buildGuide(recipe,record){
 if(!record)throw new Error('缺少完整版食譜：'+recipe.id);
 recipe={...recipe,guideOptions:record};
 const fatCounts={};
 const requestFat=step=>{let id=typeof step.fat==='function'?step.fat(recipe):step.fat;if(id==='hot')id=has(recipe,'oil')?'oil':has(recipe,'butter')?'butter':null;return id;};
 for(const step of record.steps)if(typeof step!=='string'){const id=requestFat(step);if(id)fatCounts[id]=(fatCounts[id]||0)+1;}
 const steps=record.steps.map(step=>{if(typeof step==='string')return step;const id=requestFat(step);return step.render(recipe,{fat:id?'取表列{{'+id+':'+(1/fatCounts[id])+'}}'+names[id]:'用原鍋保留的少量油脂／水'});});
 const preparation=[...record.preparation];
 if(recipe.ingredients.some(i=>['chicken','breast','beef','lamb','pork','salmon','halibut','seabass','shrimp','scallop','squid'].includes(i.ingredientId)))preparation.push('以食材已解凍為估時基準：冷凍肉／海鮮提前放冰箱冷藏解凍，使用前瀝乾擦乾；生熟食器具分開，備妥食物溫度計。解凍時間不含在配餐估時內。');
 preparation.push('先量好食材表中的全部調味料；各步驟分次使用，總量不重複增加。'+(has(recipe,'egg')?'雞蛋有小數份量時，先打散再取用，勿直接把顆數進位。':''));
 const prepMinutes=Math.min(recipe.minutes-5,record.prepMinutes||Math.max(5,Math.round(recipe.minutes/4)));
 return {version:2,preparation,steps,tips:[...record.tips,'人數與小食量只調整食材用量；火力、烤溫和熟度標準維持不變。份量變多需分批操作，烹調時間以厚度與中心熟度確認。'],timing:{prepMinutes,cookMinutes:recipe.minutes-prepMinutes,totalMinutes:recipe.minutes},ground:record.ground||[],casserole:!!record.casserole,revisedAt:'2026-11-12'};
}
