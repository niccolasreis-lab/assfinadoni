const builtInCategoryNames=['Alimentação','Transporte','Moradia','Saúde','Educação','Lazer','Assinaturas','Casamento','Viagem','Outros'];
const categoryKey=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
const validCategoryName=value=>typeof value==='string'&&value.normalize('NFC').replace(/\s+/g,' ').trim().length>=2&&value.normalize('NFC').replace(/\s+/g,' ').trim().length<=60&&/^[\p{L}\p{N} &'’().\/-]+$/u.test(value);
let categoryNames=[...builtInCategoryNames],categoryCatalogAvailable=false;
function initCategoryCatalog(context){
 let value=context?.categoryContext;
 if(!value){try{value=$('Unir categorias da carteira').first().json.categoryContext;}catch{}}
 categoryCatalogAvailable=value?.available===true;
 const supplied=categoryCatalogAvailable&&Array.isArray(value.categories)?value.categories:[];
 const names=[...supplied.map(c=>typeof c==='string'?c:c?.name).filter(validCategoryName),...builtInCategoryNames];
 categoryNames=names.filter((c,i,a)=>a.findIndex(n=>categoryKey(n)===categoryKey(c))===i);
 return {available:categoryCatalogAvailable,categories:categoryNames.map(name=>({name}))};
}
const resolveCategory=value=>validCategoryName(value)?categoryNames.find(name=>categoryKey(name)===categoryKey(value))||null:null;
