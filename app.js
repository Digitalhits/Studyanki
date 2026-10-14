(()=>{'use strict';
const $=sel=>document.querySelector(sel),main=$('#main'),picker=$('#filePicker');
let state={version:2,decks:[],cards:[],history:{},settings:{dailyGoal:20},game:{xp:0,correct:0,hard:0,wrong:0,totalRatings:0,bestStreak:0,credited:{}}};
const ui={tab:'home',selectedDeck:'__all__',showBack:false,queue:[],position:0,sessionDone:0,sessionXp:0,libraryDeck:null,search:'',busy:false,expanded:new Set()};
const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const dehtml=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const uuid=()=>globalThis.crypto?.randomUUID?.()||'Study-'+Date.now()+'-'+Math.random().toString(36).slice(2);
const kvGet=(key)=>StudyVault.get(key);
const kvPut=(key,value)=>StudyVault.put(key,value);
async function save(){await kvPut('state',state)}
function toast(message){const t=$('#toast');t.textContent=message;t.classList.add('show');clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>t.classList.remove('show'),3400)}
function percent(x,total){return total?Math.min(100,Math.round(x/total*100)):0}
function due(c){return Number(c.due||0)<=Date.now()}
// Gamificação opcional por desempenho autodeclarado. Não altera a repetição espaçada.
// A pontuação por cartão é concedida apenas uma vez por dia, impedindo XP infinito
// ao repetir o mesmo cartão. 'Bom' e 'Fácil' dão o mesmo XP para não incentivar exageros.
function gameData(){
  if(!state.game||typeof state.game!=='object')state.game={};
  const g=state.game;
  for(const k of ['xp','correct','hard','wrong','totalRatings','bestStreak'])g[k]=Number.isFinite(Number(g[k]))?Math.max(0,Math.floor(Number(g[k]))):0;
  if(!g.credited||typeof g.credited!=='object'||Array.isArray(g.credited))g.credited={};
  return g;
}
function levelThreshold(level){return 40*level*(level-1)} // N2=80 XP, N3=240 XP, N4=480 XP
function levelOf(xp){let lvl=1;while(lvl<100&&xp>=levelThreshold(lvl+1))lvl++;return lvl}
function levelInfo(){const xp=gameData().xp,level=levelOf(xp),start=levelThreshold(level),end=levelThreshold(level+1);return {xp,level,need:end-xp,progress:percent(xp-start,end-start),end}}
function prevDate(iso,n){const parts=iso.split('-').map(Number),dt=new Date(parts[0],parts[1]-1,parts[2]-n,12);return [dt.getFullYear(),String(dt.getMonth()+1).padStart(2,'0'),String(dt.getDate()).padStart(2,'0')].join('-')}
function studyStreak(){let day=today();if(!(state.history[day]>0))day=prevDate(day,1);let streak=0;while(streak<10000&&state.history[day]>0){streak++;day=prevDate(day,1)}return streak}
function achievementItems(){const g=gameData(),streak=studyStreak();return [
  {symbol:'✦',name:'Primeiro passo',unlocked:g.totalRatings>=1,description:'Faça a primeira revisão'},
  {symbol:'✓',name:'10 lembranças',unlocked:g.correct>=10,description:'Marque Bom ou Fácil em 10 revisões'},
  {symbol:'⚡',name:'100 lembranças',unlocked:g.correct>=100,description:'Marque Bom ou Fácil em 100 revisões'},
  {symbol:'🔥',name:'7 dias seguidos',unlocked:Math.max(streak,g.bestStreak)>=7,description:'Estude durante 7 dias consecutivos'}
]}
function xpPanel(compact=false){const l=levelInfo(),streak=studyStreak();return `<div class="xp-panel ${compact?'compact':''}"><div class="xp-panel-top"><span class="level-badge">✦ NÍVEL ${l.level}</span><span class="xp-total">${l.xp} XP</span><span class="streak-label">🔥 ${streak} ${streak===1?'dia':'dias'}</span></div><div class="xp-bar" role="progressbar" aria-label="Progresso para o próximo nível" aria-valuenow="${l.progress}" aria-valuemin="0" aria-valuemax="100"><span style="width:${l.progress}%"></span></div><p>${l.need} XP para o nível ${l.level+1} · XP não altera seu agendamento.</p></div>`}
function bonusForRating(cardId,rating){
  const game=gameData(),key=today();
  game.totalRatings++;
  if(rating==='again')game.wrong++;
  if(rating==='hard')game.hard++;
  if(rating==='good'||rating==='easy')game.correct++;
  const desired=(rating==='good'||rating==='easy')?10:rating==='hard'?3:0;
  // Guardar só hoje e os 6 dias anteriores para evitar crescimento ilimitado do backup.
  for(const date of Object.keys(game.credited))if(date<prevDate(key,6))delete game.credited[date];
  if(!game.credited[key])game.credited[key]={};
  const old=game.credited[key][cardId]||0;
  const gain=Math.max(0,desired-old);
  if(desired>old)game.credited[key][cardId]=desired;
  game.xp+=gain;
  game.bestStreak=Math.max(game.bestStreak,studyStreak());
  return gain;
}
function dueGroups(path){const count={novos:0,aprender:0,revisar:0};for(const c of state.cards){if(!inBranch(c.deck,path)||!due(c))continue;const reps=Number(c.reps||0),interval=Number(c.interval||0);if(reps<=0)count.novos++;else if(interval<1)count.aprender++;else count.revisar++;}return count}
function countMarkup(path){const x=dueGroups(path);return `<span class="count-groups" aria-label="${x.novos} novos, ${x.aprender} em aprendizagem, ${x.revisar} para revisar"><span class="new-count" title="Novos">${x.novos}</span><span class="learn-count" title="Aprender">${x.aprender}</span><span class="review-count" title="Revisar">${x.revisar}</span></span>`}
function treeMarkup(parent=null,depth=0){if(depth>8)return '';return childFolders(parent).map(path=>{const children=hasChildren(path),opened=ui.expanded.has(path),name=path.split('::').at(-1),counts=countMarkup(path);return `<div class="tree-branch"><div class="tree-row" style="--depth:${depth}"><button type="button" class="tree-expand ${children?'':'no-children'}" data-action="toggleFolder" data-name="${esc(path)}" aria-label="${opened?'Recolher':'Expandir'} ${esc(name)}" aria-expanded="${opened}">${children?(opened?'−':'+'):'·'}</button><button type="button" class="tree-open" data-action="openDeck" data-name="${esc(path)}"><span class="tree-name">${esc(name)}</span></button>${counts}<button type="button" class="tree-go" data-action="openDeck" data-name="${esc(path)}" aria-label="Abrir ${esc(name)}">›</button></div>${children&&opened?`<div class="tree-children">${treeMarkup(path,depth+1)}</div>`:''}</div>`}).join('')}

// Anki's nested decks use :: as path separators. Keep the full string in storage,
// but render its components as browsable folders, including implicit parent decks.
function cleanDeckPath(name){return String(name||'Geral').split('::').map(x=>x.trim()).filter(Boolean).join('::').slice(0,230)||'Geral'}
function inBranch(deck,branch){return !branch||branch==='__all__'||deck===branch||deck.startsWith(branch+'::')}
function knownPaths(){
  const paths=new Set();
  for(const deck of [...state.decks,...state.cards.map(c=>c.deck||'Geral')]){
    const parts=String(deck||'').split('::').map(s=>s.trim()).filter(Boolean);
    for(let i=1;i<=parts.length;i++)paths.add(parts.slice(0,i).join('::'));
  }
  return [...paths].sort((a,b)=>a.localeCompare(b,'pt-BR'));
}
function childFolders(parent){const marker=parent?parent+'::':'';return knownPaths().filter(path=>{
  if(parent&&!path.startsWith(marker))return false;
  const child=path.slice(marker.length);
  return child.length>0&&!child.includes('::');
});}
function hasChildren(path){return knownPaths().some(p=>p.startsWith(path+'::'))}
function dueCount(deck){return state.cards.filter(c=>inBranch(c.deck,deck)&&due(c)).length}
function deckInfo(name){const cards=state.cards.filter(c=>inBranch(c.deck,name));return {total:cards.length,due:cards.filter(due).length}}
function firstDeck(){return state.decks[0]||'Geral'}
function ensureDeck(name){const clean=cleanDeckPath(name);if(!state.decks.includes(clean))state.decks.push(clean);return clean}
function nav(tab){ui.tab=tab;ui.search='';ui.libraryDeck=null;render();window.scrollTo(0,0)}
function render(){if(ui.tab==='home')renderHome();else if(ui.tab==='study')renderStudy();else if(ui.tab==='decks')renderDecks();else renderSettings();document.querySelectorAll('.tab').forEach(t=>{const on=t.dataset.tab===ui.tab;t.classList.toggle('active',on);t.setAttribute('aria-current',on?'page':'false')})}
function renderHome(){const n=state.cards.length,reviewed=state.history[today()]||0,goal=state.settings.dailyGoal||20;main.innerHTML=`<section class="section"><div class="eyebrow">SUA JORNADA DE APRENDIZADO</div><h1 class="headline">Aprender hoje.<br>Lembrar amanhã.</h1><p class="sub">Pergunta primeiro, resposta depois — exatamente como você estuda no Anki.</p>${xpPanel()}<div class="hero"><div class="eyebrow">HORA DE REVISAR ✦</div><h2>${dueCount()} ${dueCount()===1?'cartão pendente':'cartões pendentes'}</h2><p>Responda mentalmente antes de revelar. Avalie como realmente lembrou: seu aprendizado vem primeiro.</p><button class="btn primary" data-action="start" ${!n?'disabled':''}>▶ Começar a estudar <span>→</span></button></div><div class="stats"><div class="stat"><b>${n}</b><small>Flashcards</small></div><div class="stat"><b>${childFolders(null).length}</b><small>Pastas principais</small></div><div class="stat"><b>${reviewed}</b><small>Revisões hoje</small></div></div><div class="row"><h2 class="heading">Acesso rápido</h2></div><div class="action-grid"><button class="mini-action" data-action="newCard"><span class="ico">✎</span><strong>Criar flashcard</strong><small>Frente e verso</small></button><button class="mini-action" data-action="import"><span class="ico">⇩</span><strong>Importar do Anki</strong><small>APKG, TXT, CSV e JSON</small></button></div><div class="row"><h2 class="heading">Seus baralhos</h2><button class="link" data-action="decks">Ver a árvore →</button></div><div class="deck-list">${childFolders(null).slice(0,6).map(deckMarkup).join('')||`<div class="empty"><span class="empty-icon">▤</span><h3>Comece seu primeiro baralho</h3><p>Você pode importar seus cartões do Anki ou criar um baralho.</p><button class="btn primary" data-action="newDeck">Criar baralho</button></div>`}</div><div class="row"><h2 class="heading">Conquistas</h2><button class="link" data-action="achievements">Ver detalhes →</button></div><div class="achievement-list">${achievementItems().map(a=>`<div class="achievement ${a.unlocked?'unlocked':'locked'}" title="${esc(a.description)}"><span>${a.symbol}</span><small>${esc(a.name)}</small></div>`).join('')}</div>${state.cards.length?`<div class="info" style="margin-top:20px">Meta diária: ${reviewed} de ${goal} revisões<div class="progress" style="margin:9px 0"><span style="width:${percent(reviewed,goal)}%"></span></div></div>`:''}</section>`;}
function deckMarkup(path){const info=deckInfo(path);const folder=hasChildren(path);return `<button type="button" class="deck" data-action="openDeck" data-name="${esc(path)}"><span class="deckmark">${folder?'▣':'▤'}</span><span style="min-width:0;flex:1"><span class="deck-name">${esc(path.split('::').at(-1))}</span><span class="deck-sub">${folder?'Pasta · ':''}${info.total} cartões · ${info.due} pendentes</span></span><span class="deck-next">›</span></button>`}
function newSession(deck){ui.selectedDeck=deck||'__all__';ui.queue=state.cards.filter(c=>inBranch(c.deck,ui.selectedDeck)&&due(c)).map(c=>c.id);ui.position=0;ui.showBack=false;ui.sessionDone=0;ui.sessionXp=0;nav('study')}
function currentCard(){if(ui.queue.length===0)return null;return state.cards.find(c=>c.id===ui.queue[ui.position])||null}
function selectDeckMarkup(){return `<select id="studyDeck" aria-label="Escolher baralho"><option value="__all__" ${ui.selectedDeck==='__all__'?'selected':''}>Todos os baralhos</option>${knownPaths().map(n=>`<option value="${esc(n)}" ${n===ui.selectedDeck?'selected':''}>${esc('　'.repeat(Math.max(0,n.split('::').length-1))+n.split('::').at(-1))}</option>`).join('')}</select>`}
function renderStudy(){const c=currentCard(),total=ui.queue.length,level=levelInfo();main.innerHTML=`<section class="section"><div class="study-head"><div><div class="eyebrow">REVISÃO ATIVA</div><h1 class="headline">Hora de Studyrizar.</h1></div><span class="level-badge">✦ Nível ${level.level}</span></div><p class="sub">Pense ou fale a resposta antes de revelá-la.</p><div style="margin-top:19px">${selectDeckMarkup()}</div>${c?`<div class="study-meta"><span>${esc(c.deck.split('::').join(' › '))}</span><span>${ui.position+1} de ${total}</span></div><div class="progress"><span style="width:${percent(ui.position,total)}%"></span></div><div class="flashcard ${ui.showBack?'answered':''}" id="flashcard" aria-label="${ui.showBack?'Resposta':'Pergunta'}"><span class="cardlabel">${ui.showBack?'✓ RESPOSTA':'? PERGUNTA'}</span><div class="content" id="faceContent"></div><span class="reveal-msg">${ui.showBack?'Você acertou sem olhar? Seja fiel à sua lembrança.':'Tente responder sem olhar o verso.'}</span></div>${ui.showBack?`<div class="answer-group"><button class="rating again" data-action="rate" data-rating="again"><span class="rating-icon">↻</span>Errei</button><button class="rating hard" data-action="rate" data-rating="hard"><span class="rating-icon">◕</span>Difícil</button><button class="rating good" data-action="rate" data-rating="good"><span class="rating-icon">✓</span>Bom</button><button class="rating easy" data-action="rate" data-rating="easy"><span class="rating-icon">✧</span>Fácil</button></div><p class="study-xp-note">XP: Errei 0 · Difícil 3 · Bom/Fácil 10. Só uma vez ao dia por cartão.</p>`:`<button class="btn primary full" style="margin-top:18px;min-height:56px" data-action="reveal">Mostrar resposta →</button>`}<button class="btn quiet full" style="margin-top:12px" data-action="skip">Pular por enquanto</button>`:`<div class="empty" style="margin-top:25px"><span class="empty-icon">${ui.sessionDone?'🎉':'✦'}</span><h3>${ui.sessionDone?'Sessão concluída!':state.cards.length?'Tudo em dia!':'Você ainda não tem cartões'}</h3><p>${ui.sessionDone?`Você avaliou ${ui.sessionDone} cartão(ões) e ganhou ${ui.sessionXp} XP nesta sessão.`:state.cards.length?'Não há cartões disponíveis para este baralho agora. Você pode revisar todos novamente ou selecionar outra matéria.':'Crie ou importe um baralho para começar.'}</p><button class="btn primary full" data-action="${state.cards.length?'repeat':'import'}">${state.cards.length?'Revisar cartões novamente':'Importar cartões'}</button></div>`}</section>`;if(c)hydrateMedia(c,ui.showBack?'back':'front');}
function safeMarkup(raw){let html=String(raw||'').replace(/\[sound:([^\]]+)\]/gi,(all,src)=>`<audio controls data-media="${esc(src)}"></audio>`);const doc=new DOMParser().parseFromString('<div>'+html+'</div>','text/html'),root=doc.body.firstElementChild;const banned=new Set(['script','style','iframe','object','embed','form','input','button','svg','math','link','meta','base','video','source','canvas']);const walker=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT);let cur;const remove=[];while((cur=walker.nextNode())){const tag=cur.tagName.toLowerCase();if(banned.has(tag)){remove.push(cur);continue;}for(const attr of [...cur.attributes]){const key=attr.name.toLowerCase();if(key==='src'&&(['img','audio'].includes(tag))){let v=attr.value;if(/^(data:|blob:|https?:|javascript:|\/)/i.test(v)){cur.removeAttribute(attr.name);}else{cur.setAttribute('data-media',v);cur.removeAttribute('src')}continue}if(key==='data-media'&&['img','audio'].includes(tag))continue;if(key==='style'){
  const allowed=[];
  for(const part of attr.value.split(';')){
    const m=part.trim().match(/^(color|background-color|font-weight|text-align|text-decoration)\s*:\s*(.+)$/i);
    if(!m)continue;
    const prop=m[1].toLowerCase(),val=m[2].trim().toLowerCase();
    if(['color','background-color'].includes(prop)&&(/^#[0-9a-f]{3,8}$/.test(val)||/^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/.test(val)||/^(red|blue|yellow|green|black|white|gray|grey|orange|purple)$/i.test(val)))allowed.push(prop+':'+val);
    else if(prop==='font-weight'&&/^(bold|normal|[1-9]00)$/.test(val))allowed.push(prop+':'+val);
    else if(prop==='text-align'&&/^(left|right|center|justify)$/.test(val))allowed.push(prop+':'+val);
    else if(prop==='text-decoration'&&/^(underline|line-through|none)$/.test(val))allowed.push(prop+':'+val);
  }
  if(allowed.length)cur.setAttribute('style',allowed.join(';'));else cur.removeAttribute('style');
  continue;
}if(key==='class'&&tag==='span')continue;if(key==='alt'&&tag==='img')continue;if(key==='colspan'&&['td','th'].includes(tag))continue;cur.removeAttribute(attr.name);}}for(const el of remove)el.remove();return root.innerHTML;}
let mediaObjectUrls=[];async function hydrateMedia(card,side){mediaObjectUrls.forEach(url=>URL.revokeObjectURL(url));mediaObjectUrls=[];const face=$('#faceContent');if(!face)return;face.innerHTML=safeMarkup(card[side]||'');for(const el of face.querySelectorAll('[data-media]')){const src=el.getAttribute('data-media');if(!card.mediaPrefix||!src)continue;const blob=await kvGet('media::'+card.mediaPrefix+'/'+src);if(!blob||!el.isConnected)continue;const url=URL.createObjectURL(blob);mediaObjectUrls.push(url);el.setAttribute('src',url);}}
async function rateCard(rating){const c=currentCard();if(!c)return;const oldLevel=levelInfo().level,prior=Number(c.interval)||0;c.reps=(Number(c.reps)||0)+1;let days=0;switch(rating){case 'again':c.lapses=(c.lapses||0)+1;c.ease=Math.max(1.3,(c.ease||2.5)-.2);c.interval=0;c.due=Date.now()+60000;break;case 'hard':c.ease=Math.max(1.3,(c.ease||2.5)-.15);days=prior?Math.max(1,Math.round(prior*1.2)):1;break;case 'good':days=prior?Math.max(1,Math.round(prior*(c.ease||2.5))):1;break;case 'easy':c.ease=Math.min(3.2,(c.ease||2.5)+.15);days=prior?Math.max(2,Math.round(prior*(c.ease||2.5)*1.3)):4;break;}if(days){c.interval=days;c.due=Date.now()+days*86400000;}state.history[today()]=(state.history[today()]||0)+1;const gained=bonusForRating(c.id,rating);ui.sessionXp+=gained;ui.sessionDone++;const failed=ui.queue.splice(ui.position,1)[0];if(rating==='again')ui.queue.push(failed);if(ui.position>=ui.queue.length)ui.position=0;ui.showBack=false;await save();renderStudy();const newLevel=levelInfo().level;if(newLevel>oldLevel)toast(`🎉 Você alcançou o Nível ${newLevel}! Continue aprendendo.`);else if(gained>0)toast(`+${gained} XP · Continue revisando com sinceridade`)}
function repeat(){ui.queue=state.cards.filter(c=>inBranch(c.deck,ui.selectedDeck)).map(c=>c.id);ui.position=0;ui.sessionDone=0;ui.sessionXp=0;ui.showBack=false;renderStudy()}
function renderDecks(){
  const parent=ui.libraryDeck;
  if(parent){
    const folders=childFolders(parent), aggregate=deckInfo(parent);
    const cards=state.cards.filter(c=>c.deck===parent&&(!ui.search||dehtml(c.front+' '+c.back).toLowerCase().includes(ui.search.toLowerCase())));
    const title=parent.split('::').at(-1),parentPath=parent.split('::').slice(0,-1).join('::');
    const breadcrumbs=parent.split('::').map((part,i)=>part).join(' / ');
    main.innerHTML=`<section class="section"><button class="link" data-action="backDecks">← ${parentPath?'Voltar um nível':'Todos os baralhos'}</button><div class="eyebrow" style="margin-top:20px">${esc(breadcrumbs)}</div><h1 class="headline">${esc(title)}</h1><p class="sub">${aggregate.total} cartões neste assunto e nas subpastas · ${aggregate.due} pendentes</p><div class="action-grid" style="margin-top:20px"><button class="btn primary" data-action="studyThis">▶ Estudar tudo</button><button class="btn secondary" data-action="newCard">＋ Cartão</button></div><button class="btn quiet full" data-action="newDeck" style="margin-bottom:17px">＋ Criar subbaralho nesta pasta</button>${folders.length?`<div class="row"><h2 class="heading">Subbaralhos (${folders.length})</h2></div><div class="deck-list">${treeMarkup(parent,0)}</div>`:''}<input type="search" class="search-input" id="searchCards" placeholder="Buscar cartões deste nível" value="${esc(ui.search)}"/><div class="row"><h2 class="heading">Cartões deste nível (${cards.length})</h2><button class="link" data-action="exportThis">Exportar</button></div>${cards.slice(0,300).map(c=>`<div class="card-row"><b>${esc(dehtml(c.front).slice(0,150))}</b><small>${esc(dehtml(c.back).slice(0,180))}</small><div class="card-tools"><button data-action="editCard" data-id="${esc(c.id)}">Editar</button><button data-action="deleteCard" data-id="${esc(c.id)}">Excluir</button></div></div>`).join('')||`<p class="sub">${folders.length?'Os cartões estão organizados nas subpastas acima.':'Nenhum cartão neste baralho.'}</p>`}${cards.length>300?`<p class="info">Exibindo os primeiros 300 cartões. Use a busca para encontrar outros.</p>`:''}<div class="line"></div><button class="btn quiet full" data-action="renameDeck">Renomear pasta/baralho</button><button class="btn danger full" style="margin-top:8px" data-action="deleteDeck">Excluir esta pasta e todos os seus cartões</button></section>`;
  }else{
    const roots=childFolders(null);
    main.innerHTML=`<section class="section"><div class="eyebrow">SUA BIBLIOTECA</div><h1 class="headline">Seus baralhos.</h1><p class="sub">Mesma hierarquia do Anki: baralho → matéria → assunto → subassunto.</p><div class="action-grid" style="margin:22px 0"><button class="btn primary" data-action="newDeck">＋ Novo baralho</button><button class="btn secondary" data-action="import">⇩ Importar</button></div><div class="anki-count-header"><span>BARALHOS E SUBASSUNTOS</span><span>Novo</span><span>Aprender</span><span>Revisar</span></div><div class="anki-tree">${treeMarkup(null,0)||`<div class="empty"><span class="empty-icon">▤</span><h3>Biblioteca vazia</h3><p>Importe seu arquivo .apkg para criar automaticamente as pastas.</p></div>`}</div></section>`;
  }
}
function menu(symbol,title,description,action){return `<button type="button" class="menu-action" data-action="${esc(action)}"><span class="action-ico">${esc(symbol)}</span><span style="flex:1;min-width:0"><strong>${esc(title)}</strong><small>${esc(description)}</small></span><span style="color:#a8a4c5">›</span></button>`}
function renderSettings(){main.innerHTML=`<section class="section"><div class="eyebrow">PERSONALIZE SEU ESTUDO</div><h1 class="headline">Ajustes e arquivos.</h1><p class="sub">Seus dados permanecem salvos neste iPhone/navegador.</p><h2 class="heading">Gamificação</h2>${xpPanel()}${menu('✦','Níveis e conquistas','Veja seu XP e os marcos de estudo','achievements')}<h2 class="heading">Anki e backups</h2>${menu('⇩','Importar arquivos','Anki .apkg / .colpkg, .txt, .csv, .tsv e .json','import')}${menu('⇧','Exportar pacote Anki','Gere um arquivo .apkg para importar no Anki','exportAnki')}${menu('≡','Exportar texto Anki','TXT com frente e verso, compatível com a importação de notas','exportText')}${menu('▣','Backup criptografado','Salve cartões e progresso com proteção por senha','backup')}${menu('↶','Restaurar backup','Importe backup protegido .json','import')}${menu('🔒','Bloquear Study','Exigir sua senha novamente','lockStudy')}<h2 class="heading">Preferências</h2><div class="deck"><span class="deckmark">◎</span><span style="flex:1"><span class="deck-name">Meta diária</span><span class="deck-sub">Revisões que você pretende fazer por dia</span></span><select id="dailyGoal" style="width:95px;padding:7px"><option value="10" ${state.settings.dailyGoal===10?'selected':''}>10</option><option value="20" ${state.settings.dailyGoal===20?'selected':''}>20</option><option value="30" ${state.settings.dailyGoal===30?'selected':''}>30</option><option value="50" ${state.settings.dailyGoal===50?'selected':''}>50</option><option value="100" ${state.settings.dailyGoal===100?'selected':''}>100</option></select></div><div class="import-tip"><b>Como funciona a compatibilidade?</b><br>Tenta importar pacotes Anki antigos e recentes, além de arquivos de texto. Exporta baralhos básicos em .apkg. O agendamento de revisões é simplificado e independente do Anki; o histórico do Anki, modelos avançados e a sincronização AnkiWeb não são preservados. Reimportar um baralho atualiza cartões com mesmo ID Anki e preserva as revisões feitas no Study. Faça backup antes de trocar de aparelho.</div><p class="legal">Este é um aplicativo independente e gratuito, não afiliado ao Anki. O progresso é local e não sincroniza automaticamente entre aparelhos. As bibliotecas de leitura de pacotes precisam ser carregadas pela internet na primeira utilização.</p></section>`;}
function modal(inner){$('#modalContent').innerHTML=inner;$('#modalWrap').hidden=false;document.body.style.overflow='hidden'}
function closeModal(){$('#modalWrap').hidden=true;document.body.style.overflow=''}
function cardModal(id){const card=id?state.cards.find(c=>c.id===id):null;modal(`<h2>${card?'Editar flashcard':'Novo flashcard'}</h2><form id="cardForm"><div class="field"><label for="editDeck">Baralho</label><select id="editDeck" required>${knownPaths().map(d=>`<option value="${esc(d)}" ${d===(card?.deck||ui.libraryDeck||firstDeck())?'selected':''}>${esc(d)}</option>`).join('')}</select></div><div class="field"><label for="editFront">FRENTE · Pergunta</label><textarea id="editFront" placeholder="Ex.: Qual é a função do advérbio?" required>${esc(card?.front||'')}</textarea></div><div class="field"><label for="editBack">VERSO · Resposta</label><textarea id="editBack" placeholder="Ex.: Modifica o verbo, adjetivo ou outro advérbio…" required>${esc(card?.back||'')}</textarea></div><div class="field"><label for="editTags">Etiquetas (opcional)</label><input id="editTags" value="${esc(card?.tags||'')}" placeholder="portugues pcpe"/></div><div class="buttons"><button type="button" class="btn quiet" data-action="closeModal">Cancelar</button><button type="submit" class="btn primary">${card?'Salvar':'Criar cartão'}</button></div></form>`);$('#cardForm').addEventListener('submit',async e=>{e.preventDefault();const front=$('#editFront').value.trim(),back=$('#editBack').value.trim(),deck=ensureDeck($('#editDeck').value),tags=$('#editTags').value.trim();if(!front||!back)return;if(card){Object.assign(card,{deck,front,back,tags})}else state.cards.unshift({id:uuid(),deck,front,back,tags,created:Date.now(),due:0,interval:0,ease:2.5,reps:0,lapses:0});await save();closeModal();render();toast(card?'Cartão atualizado!':'Flashcard criado!')});}
function deckModal(){
  const parent=ui.libraryDeck;
  modal(`<h2>${parent?'Criar subbaralho':'Criar baralho'}</h2>${parent?`<p class="sub">Dentro de ${esc(parent.split('::').join(' / '))}</p>`:''}<form id="deckForm"><div class="field"><label for="newDeckName">${parent?'Nome do subbaralho':'Nome do baralho'}</label><input id="newDeckName" maxlength="150" placeholder="${parent?'Ex.: Advérbios':'Ex.: PCPE::Português'}" required/></div><div class="buttons"><button type="button" class="btn quiet" data-action="closeModal">Cancelar</button><button type="submit" class="btn primary">Criar</button></div></form>`);
  $('#deckForm').addEventListener('submit',async e=>{
    e.preventDefault();const raw=$('#newDeckName').value.trim();if(!raw)return;
    const name=cleanDeckPath((parent?parent+'::':'')+raw);
    if(knownPaths().includes(name)){toast('Esta pasta/baralho já existe.');return;}
    ensureDeck(name);await save();closeModal();ui.tab='decks';ui.libraryDeck=name;renderDecks();toast('Subbaralho criado!');
  });
}
function achievementsDialog(){const g=gameData(),lv=levelInfo();modal(`<h2>🏅 Sua evolução</h2>${xpPanel()}<p class="sub">Recompensas por estudar de forma ativa. Elas nunca modificam a dificuldade nem a data das revisões.</p><div class="stats" style="margin:17px 0"><div class="stat"><b>${g.correct}</b><small>Bom ou Fácil</small></div><div class="stat"><b>${g.hard}</b><small>Difíceis</small></div><div class="stat"><b>${g.wrong}</b><small>Errei</small></div></div><h3 class="heading">Conquistas</h3>${achievementItems().map(a=>`<div class="achieve-row ${a.unlocked?'':'achieve-locked'}"><span class="achievement-symbol">${a.symbol}</span><div><strong>${esc(a.name)}</strong><small>${esc(a.description)}</small></div><span>${a.unlocked?'✓':'🔒'}</span></div>`).join('')}<p class="info">São autoavaliações: o aplicativo não corrige a resposta automaticamente. Acertos contam quando você escolhe Bom ou Fácil. Na mesma data, cada cartão pode render até 10 XP; refazer não acumula pontos.</p><button class="btn primary full" data-action="closeModal">Voltar ao estudo</button>`)}
function importDialog(){modal(`<h2>Importar flashcards</h2><p class="sub">Traga seus cartões do Anki ou de uma planilha.</p><div class="import-tip"><b>Formatos aceitos:</b> .apkg, .colpkg (pacotes Anki), .txt, .tsv e .csv (frente e verso), .json (backup criptografado do Study).<br><br><b>Importante:</b> para importar .apkg, mantenha internet ativa para carregar o leitor SQLite. Para máxima compatibilidade, exporte no Anki marcando “Suporte a versões antigas do Anki”. Arquivos muito grandes podem exigir mais memória.<br><br><b>Repetições:</b> mantém perguntas iguais quando são cartões diferentes. Ao reimportar, identifica o mesmo cartão do Anki pelo ID e preserva suas revisões.</div><button class="btn primary full" data-action="pickFile">Escolher arquivo no iPhone →</button><button class="btn quiet full" style="margin-top:10px" data-action="closeModal">Fechar</button></div>`)}
function exportDialog(){modal(`<h2>Exportar baralho</h2><p class="sub">Escolha o que exportar para o Anki ou seu computador.</p><div class="field"><label for="exportDeck">Baralho</label><select id="exportDeck"><option value="__all__">Todos os baralhos</option>${knownPaths().map(d=>`<option value="${esc(d)}" ${ui.libraryDeck===d?'selected':''}>${esc(d.split('::').join(' / '))}</option>`).join('')}</select></div><div class="buttons"><button class="btn secondary" data-action="exportTextNow">Texto .txt</button><button class="btn primary" data-action="exportApkgNow">Pacote .apkg</button></div><p class="info">A exportação .apkg tenta gerar cartões básicos novos, sem o histórico de revisão. Para preservar a hierarquia no Anki, prefira .apkg. Para salvar seu progresso, use Backup protegido (.json).</p>`)}
function importStatus(msg){modal(`<h2>Importando</h2><p class="sub"><span class="spinner"></span> ${esc(msg)}</p><p class="info">Não feche esta tela durante a importação.</p>`)}
function csvRows(str,delimiter){const rows=[];let cur=[],buf='',quote=false;for(let i=0;i<str.length;i++){const x=str[i];if(x==='"'){if(quote&&str[i+1]==='"'){buf+='"';i++}else quote=!quote;}else if(x===delimiter&&!quote){cur.push(buf);buf=''}else if((x==='\n'||x==='\r')&&!quote){if(x==='\r'&&str[i+1]==='\n')i++;cur.push(buf);if(cur.some(s=>s.length))rows.push(cur);cur=[];buf='';}else buf+=x}cur.push(buf);if(cur.some(s=>s.length))rows.push(cur);return rows}
function parseText(text,name){text=text.replace(/^\uFEFF/,'');let headers={},actual=[];for(const l of text.split(/\r?\n/)){if(l.startsWith('#')){let m=l.match(/^#\s*([^:]+):\s*(.*)$/);if(m)headers[m[1].trim().toLowerCase()]=m[2].trim();}else actual.push(l);}let delimiter=headers.separator?.toLowerCase();delimiter=delimiter==='tab'?'\t':delimiter==='comma'?',':delimiter==='semicolon'?';':delimiter&&delimiter.length===1?delimiter:null;if(!delimiter){const first=actual.slice(0,4).join('\n');delimiter=['\t',';',','].sort((a,b)=>(first.split(b).length-first.split(a).length))[0];}
const rows=csvRows(actual.join('\n'),delimiter);const fallback=(name.replace(/\.(txt|tsv|csv)$/i,'').trim()||'Importados');const deck=headers.deck||fallback;let skipHeader=0;if(rows[0]?.length>=2&&/^(frente|front|pergunta|question)$/i.test(rows[0][0].trim())&&/^(verso|back|resposta|answer)$/i.test(rows[0][1].trim()))skipHeader=1;const occur=new Map();return rows.slice(skipHeader).filter(r=>r.length>=2&&r[0].trim()).map(r=>{const key=deck+'|'+r[0].trim().toLowerCase();const order=(occur.get(key)||0)+1;occur.set(key,order);return {id:uuid(),sourceKey:'txt:'+key+':'+order,deck,front:r[0],back:r[1],tags:r[2]||'',created:Date.now(),due:0,interval:0,ease:2.5,reps:0,lapses:0}});}
function normalizeImported(c){if(!c||typeof c!=='object'||!c.front||!c.back)return null;return {id:uuid(),backupId:c.id?String(c.id):undefined,ankiId:c.ankiId?String(c.ankiId):undefined,ankiGuid:c.ankiGuid?String(c.ankiGuid):undefined,sourceKey:c.sourceKey?String(c.sourceKey):undefined,deck:String(c.deck||'Importados'),front:String(c.front),back:String(c.back),tags:String(c.tags||''),created:Number(c.created||Date.now()),due:Number(c.due||0),interval:Number(c.interval||0),ease:Number(c.ease||2.5),reps:Number(c.reps||0),lapses:Number(c.lapses||0),mediaPrefix:c.mediaPrefix||undefined,deckProvided:Boolean(c.deck)};}
async function handleFile(file){
  if(!file)return;
  const ext=file.name.split('.').pop().toLowerCase();
  let result=[],assets=[],restoring=false,backupHistory=null,backupGame=null;
  try{
    importStatus('Lendo '+file.name);
    if(['apkg','colpkg'].includes(ext)){
      if(!window.JSZip)throw Error('O leitor ZIP não carregou. Reabra o aplicativo.');
      const out=await AnkiIO.importPackage(file,msg=>importStatus(msg));result=out.cards;assets=out.media;
    }else if(ext==='json'){
      let raw=JSON.parse(await file.text());
      if(raw.app==='study-private-backup'){const pass=prompt('Senha usada ao criar este backup criptografado:');if(!pass)throw Error('Importação cancelada.');raw=await StudyVault.decryptBackup(raw,pass);}
      result=(Array.isArray(raw)?raw:raw.cards||[]).map(normalizeImported).filter(Boolean);
      if(!Array.isArray(raw)&&raw.app==='study-private-data'){
        restoring=true;backupHistory=raw.history;backupGame=raw.game;
        if(Array.isArray(raw.mediaFiles))for(const m of raw.mediaFiles){
          if(typeof m.key!=='string'||typeof m.base64!=='string'||m.base64.length>14000000)continue;
          const bytes=Uint8Array.from(atob(m.base64),ch=>ch.charCodeAt(0));
          assets.push({key:m.key,blob:new Blob([bytes],{type:m.type||'application/octet-stream'})});
        }
      }
    }else if(['txt','csv','tsv'].includes(ext))result=parseText(await file.text(),file.name);
    else throw Error('Formato de arquivo não suportado.');
    if(!result.length)throw Error('Nenhum cartão válido foi encontrado.');
    // Importação incremental: a mesma identidade do Anki entra apenas uma vez, inclusive
    // quando o arquivo veio de outro formato ou foi exportado novamente do Anki.
    const stats=StudyMerge.mergeCards(state.cards,result);
    state.cards=stats.cards;
    state.decks=[...new Set([...state.decks,...state.cards.map(c=>c.deck)])];
    if(restoring&&backupHistory&&typeof backupHistory==='object'){
      for(const [day,count] of Object.entries(backupHistory)){
        if(/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Number(count)))
          state.history[day]=Math.max(state.history[day]||0,Number(count));
      }
    }
    if(restoring&&backupGame&&typeof backupGame==='object'){
      const g=gameData();
      for(const k of ['xp','correct','hard','wrong','totalRatings','bestStreak'])g[k]=Math.max(g[k]||0,Math.max(0,Number(backupGame[k])||0));
      if(backupGame.credited&&typeof backupGame.credited==='object'){
        for(const [d,credits] of Object.entries(backupGame.credited))if(/^\d{4}-\d{2}-\d{2}$/.test(d)&&credits&&typeof credits==='object')g.credited[d]={...credits,...(g.credited[d]||{})};
      }
    }
    // Evita salvar mídia não usada de reimportações com milhares de cartões repetidos.
    for(const asset of assets)if(stats.usedMediaPrefixes.has(asset.key.split('/')[0]))await kvPut('media::'+asset.key,asset.blob);
    await save();
    ui.libraryDeck=null;render();
    importResultDialog(stats,restoring);
  }catch(e){closeModal();toast(e.message||'Erro ao importar arquivo.');console.error(e)}
}
function importResultDialog(s,restoring){
  modal(`<h2>Importação concluída ✓</h2><p class="sub">${restoring?'Backup processado.':'Os cartões foram comparados por identidade do Anki ou identificador de importação.'}</p><div class="import-stats"><div><b>${s.added}</b><small>Novos cartões</small></div><div><b>${s.updated}</b><small>Atualizados</small></div><div><b>${s.skipped}</b><small>Já importados</small></div></div><p class="info">Cartões já estudados mantêm seu progresso e agendamento. Cartões diferentes com textos iguais são preservados.</p><button class="btn primary full" data-action="closeModal">Concluir</button>`);
}
function selectedCards(){const x=$('#exportDeck')?.value||'__all__';return state.cards.filter(c=>inBranch(c.deck,x))}
function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
function nameOf(deck,ext){const clean=String(deck||'Study-PCPE').replace(/[^\p{L}\p{N}_ -]+/gu,'-').replace(/\s+/g,'-').slice(0,60);return (clean||'Study-PCPE')+'.'+ext}
async function exportText(cards){if(!cards.length)return toast('Não há cartões para exportar.');const deck=$('#exportDeck')?.value||'__all__';const lines=['#separator:Tab','#html:true'];if(deck!=='__all__')lines.push('#deck:'+deck);lines.push('#columns:Front\tBack\tTags','#tags column:3');for(const c of cards){const quote=s=>'"'+String(s||'').replace(/\r?\n/g,'<br>').replace(/"/g,'""')+'"';lines.push([c.front,c.back,c.tags||''].map(quote).join('\t'));}download(new Blob(['\uFEFF'+lines.join('\n')],{type:'text/plain;charset=utf-8'}),nameOf(deck==='__all__'?'Study-PCPE':deck,'txt'));closeModal();toast('Texto Anki exportado!');}
async function exportApkg(cards){if(!cards.length)return toast('Não há cartões para exportar.');const deck=$('#exportDeck')?.value||'__all__';try{importStatus('Criando arquivo compatível com Anki…');const blob=await AnkiIO.exportPackage(cards,key=>kvGet('media::'+key),msg=>importStatus(msg));download(blob,nameOf(deck==='__all__'?'Study-PCPE':deck,'apkg'));closeModal();toast('Pacote .apkg exportado!')}catch(e){closeModal();toast(e.message||'Não foi possível exportar .apkg');console.error(e)}}
async function backup(){const file={app:'study-private-data',version:2,exported:new Date().toISOString(),decks:state.decks,cards:state.cards,history:state.history,settings:state.settings,game:gameData(),mediaFiles:[]};const refs=new Set();const rx=/\b(?:src|href)\s*=\s*[\"']([^\"']+)[\"']|\[sound:([^\]]+)\]/gi;for(const c of state.cards){if(!c.mediaPrefix)continue;let m;const body=c.front+' '+c.back;while((m=rx.exec(body))){const src=m[1]||m[2];if(src)refs.add(c.mediaPrefix+'/'+src);}}for(const key of refs){const blob=await kvGet('media::'+key);if(!blob||blob.size>9_000_000)continue;const bytes=new Uint8Array(await blob.arrayBuffer());let b64='';for(let i=0;i<bytes.length;i+=8192)b64+=String.fromCharCode(...bytes.slice(i,i+8192));file.mediaFiles.push({key,type:blob.type,base64:btoa(b64)});}const protectedBackup=await StudyVault.encryptBackup(file);download(new Blob([JSON.stringify(protectedBackup)],{type:'application/json'}),'Study-backup-protegido-'+today()+'.json');toast('Backup protegido salvo!')}
async function renameDeck(){
  const old=ui.libraryDeck;if(!old)return;
  const before=old.split('::'),parent=before.slice(0,-1).join('::');
  const leaf=prompt('Novo nome desta pasta/baralho:',before.at(-1))?.trim();if(!leaf)return;
  const name=cleanDeckPath((parent?parent+'::':'')+leaf);if(name===old)return;
  if(knownPaths().includes(name)){toast('Já existe uma pasta/baralho com esse nome.');return;}
  const moving=p=>p===old||p.startsWith(old+'::');
  const rewrite=p=>moving(p)?name+p.slice(old.length):p;
  state.decks=[...new Set(state.decks.map(rewrite))];
  state.cards.forEach(c=>{c.deck=rewrite(c.deck)});
  if(inBranch(ui.selectedDeck,old))ui.selectedDeck=rewrite(ui.selectedDeck);
  ui.libraryDeck=name;await save();renderDecks();toast('Pasta/baralho renomeado!');
}
async function deleteDeck(){
  const name=ui.libraryDeck;if(!name)return;const info=deckInfo(name);
  if(!confirm(`Excluir "${name}" e seus ${info.total} cartões, incluindo TODAS as subpastas? Esta ação não pode ser desfeita.`))return;
  state.cards=state.cards.filter(c=>!inBranch(c.deck,name));
  state.decks=state.decks.filter(d=>!inBranch(d,name));
  ui.libraryDeck=name.split('::').slice(0,-1).join('::')||null;
  await save();renderDecks();toast('Pasta/baralho excluído.');
}
async function deleteCard(id){if(!confirm('Excluir este flashcard?'))return;state.cards=state.cards.filter(c=>c.id!==id);await save();render();toast('Cartão excluído.')}
main.addEventListener('click',async e=>{const button=e.target.closest('[data-action]');if(!button||ui.busy)return;const action=button.dataset.action;switch(action){case 'start':newSession('__all__');break;case 'achievements':achievementsDialog();break;case 'toggleFolder':{const name=button.dataset.name;if(ui.expanded.has(name))ui.expanded.delete(name);else ui.expanded.add(name);if(ui.tab==='decks')renderDecks();else renderHome();break;}case 'decks':nav('decks');break;case 'newCard':if(!state.decks.length){ensureDeck('Geral');await save()}cardModal();break;case 'newDeck':deckModal();break;case 'import':importDialog();break;case 'openDeck':ui.libraryDeck=button.dataset.name;ui.tab='decks';ui.search='';render();break;case 'backDecks':ui.libraryDeck=ui.libraryDeck?.split('::').slice(0,-1).join('::')||null;ui.search='';renderDecks();break;case 'studyThis':newSession(ui.libraryDeck);break;case 'reveal':ui.showBack=true;renderStudy();break;case 'rate':await rateCard(button.dataset.rating);break;case 'skip':if(ui.queue.length>1){ui.position=(ui.position+1)%ui.queue.length;ui.showBack=false;renderStudy()}else toast('Este é o único cartão da sessão.');break;case 'repeat':repeat();break;case 'editCard':cardModal(button.dataset.id);break;case 'deleteCard':await deleteCard(button.dataset.id);break;case 'exportThis':exportDialog();break;case 'renameDeck':await renameDeck();break;case 'deleteDeck':await deleteDeck();break;case 'exportAnki':case 'exportText':exportDialog();break;case 'backup':backup();break;case 'lockStudy':closeModal();StudyVault.lock();break;}});
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{if(t.dataset.tab==='study'){newSession(ui.selectedDeck);return;}nav(t.dataset.tab)}));
$('#topAdd').addEventListener('click',async()=>{if(!state.decks.length){ensureDeck('Geral');await save()}cardModal()});
$('#modalOverlay').addEventListener('click',closeModal);
$('#modalContent').addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el)return;const action=el.dataset.action;if(action==='closeModal')closeModal();else if(action==='pickFile')picker.click();else if(action==='exportTextNow')await exportText(selectedCards());else if(action==='exportApkgNow')await exportApkg(selectedCards());});
picker.addEventListener('change',async()=>{const file=picker.files?.[0];picker.value='';await handleFile(file)});
main.addEventListener('change',async e=>{if(e.target.id==='studyDeck'){newSession(e.target.value)}else if(e.target.id==='dailyGoal'){state.settings.dailyGoal=Number(e.target.value);await save();toast('Meta atualizada!')}});
main.addEventListener('input',e=>{if(e.target.id==='searchCards'){ui.search=e.target.value;const selection=e.target.selectionStart;renderDecks();const input=$('#searchCards');input?.focus();if(input&&selection!=null)input.setSelectionRange(selection,selection)}});
async function installBundledCards(){
  const pack=window.MEMO_SEED;
  if(!pack||!pack.bundleId||!Array.isArray(pack.cards))return;
  if(!Array.isArray(state.seedBundles))state.seedBundles=[];
  if(state.seedBundles.includes(pack.bundleId))return;
  // Merge first, preserving any existing Study cards, progress, XP and local edits.
  const stats=StudyMerge.mergeCards(state.cards,pack.cards);
  state.cards=stats.cards;
  state.decks=[...new Set([...state.decks,...(pack.decks||[]),...state.cards.map(c=>c.deck)])];
  for(const asset of pack.mediaFiles||[]){
    if(typeof asset.base64!=='string'||typeof asset.key!=='string')continue;
    const bytes=Uint8Array.from(atob(asset.base64),ch=>ch.charCodeAt(0));
    if(bytes.length>9_000_000)continue;
    await kvPut('media::'+asset.key,new Blob([bytes],{type:asset.type||'application/octet-stream'}));
  }
  state.seedBundles.push(pack.bundleId);
  await save();
}
async function boot(){try{
  const stored=await kvGet('state');
  if(stored&&Array.isArray(stored.cards)){
    state={...state,...stored,decks:Array.isArray(stored.decks)?stored.decks:[],history:stored.history||{},game:stored.game||state.game};
  }else{
    state.decks=[];state.cards=[];
  }
  gameData();


  render();

}catch(e){main.innerHTML='<section class="section"><h2>Falha ao abrir os cartões.</h2><p>Recarregue a página em um navegador compatível. Não limpe seus dados sem backup.</p></section>';console.error(e)}}
if('serviceWorker'in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
let hiddenSince=0;
document.addEventListener('visibilitychange',()=>{if(document.hidden)hiddenSince=Date.now();else if(hiddenSince&&Date.now()-hiddenSince>120000){hiddenSince=0;StudyVault.lock();}});
StudyVault.gate(boot);
})();
