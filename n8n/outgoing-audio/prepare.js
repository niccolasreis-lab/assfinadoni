const r=$input.item.json;if(r.ok!==true)return null;
const request=$('Autorizar resumo falado solicitado').item.json;
const base={voice_id:r.voice_id,voice_lease:r.voice_lease,userId:request.userId,chatId:request.chatId,sourceMessageId:request.source_message_id,audioReady:false};
const fail=()=>({json:{...base,speechReady:false,voiceOutcome:'failed',noticeAllowed:true}});
const small=['zero','um','dois','três','quatro','cinco','seis','sete','oito','nove','dez','onze','doze','treze','catorze','quinze','dezesseis','dezessete','dezoito','dezenove'];const tens=['','','vinte','trinta','quarenta','cinquenta','sessenta','setenta','oitenta','noventa'];const hundreds=['','cento','duzentos','trezentos','quatrocentos','quinhentos','seiscentos','setecentos','oitocentos','novecentos'];
function words(n){n=Math.trunc(n);if(n<0)return 'menos '+words(-n);if(n<20)return small[n];if(n<100)return tens[Math.floor(n/10)]+(n%10?' e '+words(n%10):'');if(n===100)return 'cem';if(n<1000)return hundreds[Math.floor(n/100)]+(n%100?' e '+words(n%100):'');if(n<1000000)return(Math.floor(n/1000)===1?'mil':words(Math.floor(n/1000))+' mil')+(n%1000?(n%1000<100||n%100===0?' e ':' ')+words(n%1000):'');return words(Math.floor(n/1000000))+(Math.floor(n/1000000)===1?' milhão':' milhões')+(n%1000000?' e '+words(n%1000000):'');}
function money(n){const c=Math.round(Math.abs(Number(n))*100);const whole=Math.floor(c/100),cent=c%100;return(Number(n)<0?'menos ':'')+words(whole)+(whole===1?' real':' reais')+(cent?' e '+words(cent)+(cent===1?' centavo':' centavos'):'');}

try{
 let text=typeof r.source?.body==='string'?r.source.body:'';
 text=text.replace(/@\d{7,}(?:@(?:s\.whatsapp\.net|g\.us))?/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,'').replace(/[*_`#~]/g,'').replace(/[\r\n]+/g,'. ').replace(/\s+/g,' ').trim();
 text=text.replace(/(-?)R\$\s*(-?)(\d+(?:\.\d{3})*(?:,\d{1,2})?)/g,(_,s1,s2,n)=>money((s1||s2?-1:1)*Number(n.replace(/\./g,'').replace(',','.')))).replace(/(\d+)%/g,(_,n)=>words(Number(n))+' por cento');
 if(!text||/@\d/.test(text))return fail();
 if(text.length>1400){let cut=text.slice(0,1310);const stop=Math.max(cut.lastIndexOf('. '),cut.lastIndexOf('! '),cut.lastIndexOf('? '));cut=stop>900?cut.slice(0,stop+1):cut.slice(0,cut.lastIndexOf(' '));text=cut.trim()+' Os detalhes completos estão na mensagem de texto.';}
 if(!text||text.length>1400)return fail();
 const style=Number(r.speed)<1?'Warm and friendly Brazilian Portuguese, slightly slower pace, clear pronunciation':Number(r.speed)>1?'Warm and friendly Brazilian Portuguese, slightly faster pace, clear pronunciation':'Warm and friendly Brazilian Portuguese, natural calm pace, clear pronunciation';
 return {json:{...base,speechReady:true,voiceOutcome:'preparing',noticeAllowed:false,spokenText:text,ttsBody:{model:'gemini-3.8-flash-lite-tts',input:[{type:'user_input',content:[{type:'text',text,annotations:[{type:'speech_metadata',style}]}]}],response_format:{type:'audio'},generation_config:{speech_config:[{voice:'Kore'}]}}}};
}catch{return fail();}
