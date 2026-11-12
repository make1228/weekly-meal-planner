import {EQUIPMENT} from './model.js';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function profileEquipment(profile){
 return (profile?.equipment||[]).map(item=>{const kind=EQUIPMENT.find(x=>x.id===item.id);return {name:kind.name,model:item.model,match:new RegExp(kind.pattern)};});
}
export function renderUserEquipment(recipe,items){
 const tools=items.filter(item=>item.match.test(recipe.equipment));
 return '<div class="recipe-appliances"><strong>料理使用設備</strong>'+(tools.length?tools.map(item=>'<span>'+esc(item.name)+(item.model?' <b>'+esc(item.model)+'</b>':'')+'</span>').join(''):'<span>'+esc(recipe.equipment)+'（可在帳號設定記錄你的設備）</span>')+'</div>';
}
