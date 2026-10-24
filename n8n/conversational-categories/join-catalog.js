const x=$('Preparar contexto seguro').first().json;
const r=$input.first().json;
const categories=r.ok===true&&Array.isArray(r.categories)?r.categories.filter(c=>c&&typeof c.name==='string'&&c.name.trim().length>=2&&c.name.trim().length<=60):[];
return [{json:{...x,categoryContext:{available:r.ok===true&&Array.isArray(r.categories),categories}}}];
