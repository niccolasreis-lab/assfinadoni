const x=$input.item.json;
if(!['sent','uncertain'].includes(x.voiceOutcome)){
 const state=$getWorkflowStaticData('global');
 const previous=(Array.isArray(state.voiceOutcomes)?state.voiceOutcomes:[]).filter(v=>v&&typeof v==='object').map(v=>({at:v.at,sourceMessageId:v.sourceMessageId,voice_id:v.voice_id,outcome:v.outcome,...(typeof v.messageId==='string'?{messageId:v.messageId}:{})}));
 state.voiceOutcomes=[...previous,{at:Date.now(),sourceMessageId:x.sourceMessageId,voice_id:x.voice_id,outcome:x.voiceOutcome}].slice(-20);
}
return {json:{voice_id:x.voice_id,voice_lease:x.voice_lease,userId:x.userId,chatId:x.chatId,sourceMessageId:x.sourceMessageId,success:x.success===true,voiceOutcome:x.voiceOutcome,noticeAllowed:x.noticeAllowed===true}};
