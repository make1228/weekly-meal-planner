import fs from 'node:fs/promises';
import {formatCookingText} from '../cooking-text.js';
const vectors=[];
for(const recipeId of ['chicken-salad','pasta-shrimp','we-cheddar-chicken-pasta']){
 for(const extras of [{servings:2},{servings:2.7,adults:2,children:1,portionFactor:.7},{servings:.7,adults:0,children:1}]){
  const meal={key:'vector',date:'2026-11-12',slot:'lunch',recipeId,...extras};
  const text=(recipeId==='chicken-salad'?'{{breast}}':'{{pasta}}')+'；{{water:150}}；180°C，8～12分鐘，比例1.5';
  vectors.push({recipeId,meal,text,expected:formatCookingText(text,meal)});
 }
}
await fs.copyFile('dist/catalog.v2.json','ios/WeeklyMealPlanner/catalog.v2.json');
await fs.writeFile('ios/WeeklyMealPlannerTests/portion-vectors.json',JSON.stringify(vectors,null,2));
console.log('Generated iOS catalog and nine shared web/iOS quantity vectors.');
