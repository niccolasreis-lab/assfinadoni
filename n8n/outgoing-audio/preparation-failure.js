const x=$input.item.json;
return {json:{voice_id:x.voice_id,voice_lease:x.voice_lease,userId:x.userId,chatId:x.chatId,sourceMessageId:x.sourceMessageId,success:false,voiceOutcome:'failed',noticeAllowed:true}};
