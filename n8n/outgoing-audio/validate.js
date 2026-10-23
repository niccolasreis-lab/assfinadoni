const x=$('Preparar fala do Bot do Ni').item.json;
const r=$input.item.json;
let audioReady=false,audio='';
try{
 const audios=(Array.isArray(r.steps)?r.steps:[]).flatMap(s=>Array.isArray(s.content)?s.content:[]).filter(c=>c.type==='audio'&&typeof c.data==='string');
 const part=audios.at(-1);
 if(!r.error&&part&&/^[A-Za-z0-9+/]+={0,2}$/.test(part.data)&&part.data.length%4!==1){
  const b=Buffer.from(part.data,'base64');
  const canonical=b.toString('base64').replace(/=+$/,'')===part.data.replace(/=+$/,'');
  const wav=b.length>44&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE';
  const mp3=(b.toString('ascii',0,3)==='ID3'||(b[0]===255&&(b[1]&224)===224))&&b.length>1000;
  if(canonical&&(wav||mp3)&&b.length<5000000){audioReady=true;audio=part.data;}
 }
}catch{}
return {json:{voice_id:x.voice_id,voice_lease:x.voice_lease,userId:x.userId,chatId:x.chatId,sourceMessageId:x.sourceMessageId,audioReady,ttsAudio:audio,voiceOutcome:audioReady?'prepared':'failed',noticeAllowed:!audioReady}};
