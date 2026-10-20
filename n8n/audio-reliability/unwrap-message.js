// Insert after `let m = d.message ?? {}` in the authenticated normalizer.
for (let depth=0;depth<5;depth++) {
  const inner=m.ephemeralMessage?.message??m.viewOnceMessage?.message??m.viewOnceMessageV2?.message??m.viewOnceMessageV2Extension?.message??m.documentWithCaptionMessage?.message;
  if (!inner || typeof inner!=='object') break;
  m=inner;
}
