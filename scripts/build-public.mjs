import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {CATALOG_VERSION} from '../account/catalog-version.js';
import {RECIPES,INGREDIENTS} from '../engine.js';
import {getIngredientOffers,storePriceLabel,preparationMessage} from '../stores.js';
import {recipeDoneness} from '../cooking-text.js';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),dest=path.join(root,'dist');
await fs.mkdir(dest,{recursive:true});
const files=await fs.readdir(root,{withFileTypes:true});
for(const file of files)if(file.isFile()&&/\.(js|css|html)$/.test(file.name))await fs.copyFile(path.join(root,file.name),path.join(dest,file.name));
for(const dir of ['account','recipe-guides'])await fs.cp(path.join(root,dir),path.join(dest,dir),{recursive:true});
const catalog={schemaVersion:2,version:CATALOG_VERSION,ingredients:INGREDIENTS,recipes:RECIPES.map(r=>({...r,doneness:recipeDoneness(r)})),offers:INGREDIENTS.flatMap(i=>getIngredientOffers(i.id).map(o=>({...o,priceLabel:storePriceLabel(o),recipeWarnings:Object.fromEntries(RECIPES.map(r=>[r.id,preparationMessage(o,[r]).warning]).filter(([,warning])=>warning))})))};
const json=JSON.stringify(catalog);catalog.sha256=createHash('sha256').update(json).digest('hex');
await fs.writeFile(path.join(dest,'catalog.v2.json'),JSON.stringify(catalog));
const manifest=JSON.parse(await fs.readFile(path.join(root,'config/catalog-manifest.json'),'utf8'));
const recipeDigest=createHash('sha256').update(JSON.stringify(RECIPES)).digest('hex');
if(manifest.recipeDigest!==recipeDigest||manifest.recipeCount!==RECIPES.length||manifest.version!==catalog.version)throw new Error('Immutable catalog content changed. Publish a new version with old-version resolution and migration tests first.');
await fs.mkdir(path.join(dest,'catalog'),{recursive:true});
await fs.writeFile(path.join(dest,'catalog',manifest.version+'.json'),JSON.stringify(catalog));
await fs.copyFile(path.join(root,'config/catalog-manifest.json'),path.join(dest,'catalog/manifest.json'));
const environment=process.env.MEAL_ENVIRONMENT||'emulator';
let config;
if(environment==='emulator'){
 config={mode:'public',environment,region:'us-central1',firebase:{apiKey:'demo-key',authDomain:'demo-weekly-meal-public.firebaseapp.com',projectId:'demo-weekly-meal-public',appId:'demo-weekly-meal-public'},emulator:true};
}else{
 config=JSON.parse(await fs.readFile(process.env.MEAL_PUBLIC_CONFIG,'utf8'));
 if(config.mode!=='public'||!['staging','production'].includes(config.environment)||config.firebase?.projectId==='nora-after-hours'||!config.appCheckSiteKey)throw new Error('Dedicated project and App Check configuration required.');
}
await fs.writeFile(path.join(dest,'account/config.js'),'export const accountConfig=Object.freeze('+JSON.stringify(config)+');\n');
await fs.writeFile(path.join(dest,'firebase-config.js'),'export const firebaseConfig=null;\n');
await fs.mkdir(path.join(root,'backend/lib'),{recursive:true});
await build({entryPoints:[path.join(root,'backend/index.js')],outfile:path.join(root,'backend/lib/index.js'),bundle:true,platform:'node',format:'esm',packages:'external',target:'node22'});
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
await fs.writeFile(path.join(root,'backend/package.json'),JSON.stringify({name:'meal-account-functions',private:true,type:'module',main:'lib/index.js',engines:{node:'22'},dependencies:{'firebase-admin':pkg.devDependencies['firebase-admin'],'firebase-functions':pkg.devDependencies['firebase-functions']}},null,2));
console.log('Built public web, versioned 200-recipe catalog and deployable callable backend: '+environment);
