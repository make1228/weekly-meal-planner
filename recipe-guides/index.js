import {buildGuide} from './kitchen.js';
import {classicGuides} from './classics.js';
import {italianGuides} from './italian.js';
import {westernGuides} from './western.js';
import {homeGuides} from './home.js';
import {moreItalianGuides} from './more-italian.js';
import {moreWesternGuides} from './more-western.js';
import {moreAmericanGuides} from './more-american.js';
import {moreTaiwanGuides} from './more-taiwan.js';
const guides=new Map();
for(const group of [classicGuides,italianGuides,westernGuides,homeGuides,moreItalianGuides,moreWesternGuides,moreAmericanGuides,moreTaiwanGuides]){
 for(const [id,guide] of Object.entries(group)){
  if(guides.has(id))throw new Error('重複的完整版食譜：'+id);
  guides.set(id,guide);
 }
}
export const guideIds=Object.freeze([...guides.keys()]);
export const getRecipeGuide=recipe=>buildGuide(recipe,guides.get(recipe.id));
