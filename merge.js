/* Study: preserve intentional repeated cards. Identity, not matching text, prevents duplication on reimport. */
(()=>{'use strict';
const own=s=>String(s??'');
function mergeCards(existing,incoming){
 const cards=existing.slice(),byAnki=new Map(),byGuid=new Map(),byBackup=new Map(),bySource=new Map();
 const out={added:0,updated:0,skipped:0,total:incoming.length,usedMediaPrefixes:new Set(),cards};
 const index=c=>{if(c.ankiId)byAnki.set(own(c.ankiId),c);if(c.ankiGuid)byGuid.set(own(c.ankiGuid),c);if(c.id)byBackup.set(own(c.id),c);if(c.sourceKey)bySource.set(own(c.sourceKey),c)};
 cards.forEach(index);
 for(const incomingCard of incoming){
  if(!incomingCard||!own(incomingCard.front).trim()||!own(incomingCard.back).trim()){out.skipped++;continue}
  const item={...incomingCard};
  const found=(item.ankiId&&byAnki.get(own(item.ankiId)))||(item.ankiGuid&&byGuid.get(own(item.ankiGuid)))||(item.backupId&&byBackup.get(own(item.backupId)))||(item.sourceKey&&bySource.get(own(item.sourceKey)));
  if(!found){delete item.backupId;cards.push(item);index(item);out.added++;if(item.mediaPrefix)out.usedMediaPrefixes.add(item.mediaPrefix);continue}
  let modified=false;
  for(const prop of ['front','back','deck','tags']){if(item[prop]!=null&&own(item[prop])!==own(found[prop])){found[prop]=item[prop];modified=true}}
  for(const prop of ['ankiId','ankiGuid','sourceKey']){if(item[prop]&&!found[prop]){found[prop]=item[prop];modified=true}}
  if(item.mediaPrefix&&(modified||!found.mediaPrefix)&&found.mediaPrefix!==item.mediaPrefix){found.mediaPrefix=item.mediaPrefix;modified=true}
  if(item.mediaPrefix&&item.mediaPrefix===found.mediaPrefix)out.usedMediaPrefixes.add(item.mediaPrefix);
  if(modified)out.updated++;else out.skipped++;
  index(found);
 }
 return out;
}
window.StudyMerge={mergeCards};
})();
