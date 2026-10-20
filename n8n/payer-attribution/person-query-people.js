// Only verified roster names bind a query to a participant. Legacy aliases may
// enter the clarification guard, but never imply a binding to another name.
const payerQueryWords=' '+personQuery.replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim()+' ';
const payerQueryPeople=payerRoster.filter(p=>{
 const name=plain(p.display_name),first=name.split(' ')[0];
 return [name,first].filter(s=>s.length>=2).some(s=>payerQueryWords.includes(' '+s+' '));
});
