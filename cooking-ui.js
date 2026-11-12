import {recipeById} from './engine.js';
import {formatCookingText,recipeDoneness,COOKING_REFERENCES} from './cooking-text.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=(items,tag='ul',className='')=>'<'+tag+' class="'+className+'">'+items.map(item=>'<li>'+item+'</li>').join('')+'</'+tag+'>';
export function renderCookingGuide(meal){
 const recipe=recipeById(meal.recipeId),guide=recipe.details;
 const text=value=>esc(formatCookingText(value,meal));
 return '<section class="cooking-guide"><div class="cooking-timing">備料約 '+guide.timing.prepMinutes+' 分鐘・烹調約 '+guide.timing.cookMinutes+' 分鐘</div>'+
  '<p class="cooking-time-note">時間為家常估算，部分備料可並行；不含解凍，預熱、厚度與份量會影響實際時間。</p>'+
  '<h3>開始前先準備</h3>'+list(guide.preparation.map(text),'ul','recipe-preparation')+
  '<h3>完整作法</h3>'+list(recipe.steps.map(text),'ol','recipe-steps')+
  '<section class="cooking-doneness"><h3>熟度怎麼判斷</h3>'+list(recipeDoneness(recipe).map(esc))+'</section>'+
  '<section class="cooking-tips"><h3>成功關鍵與調整</h3>'+list(guide.tips.map(text))+'</section></section>';
}
export function renderCookingSource(){
 return '<p class="recipe-source">來源：AI 編寫的內建完整版食譜（2026/11/12 修訂），依常見家常技法整理；尚未逐道實際試煮，並非即時網路搜尋或外部作者食譜。用量已依本餐大人、小孩與食量換算，溫度與時間不按比例縮減。安全與設備參考：'+
 COOKING_REFERENCES.map(ref=>'<a href="'+esc(ref.url)+'" target="_blank" rel="noopener noreferrer">'+esc(ref.label)+'</a>').join('・')+
 '；這些連結是熟度／設備依據，並非食譜原作者。</p>';
}
