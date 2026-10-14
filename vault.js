(()=>{'use strict';
const prefix='study-private-db',ITERATIONS=210000,enc=new TextEncoder(),dec=new TextDecoder();
const toB64=a=>{let s='';for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(s)};
const fromB64=s=>Uint8Array.from(atob(s),x=>x.charCodeAt(0));
let masterKey=null,salt=null;
let activeDb=null;
function db(){if(activeDb)return activeDb;activeDb=new Promise((resolve,reject)=>{const req=indexedDB.open(prefix,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('store'))req.result.createObjectStore('store')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||Error('Armazenamento bloqueado.'))});return activeDb}
async function rawGet(key){const d=await db();return await new Promise((resolve,reject)=>{const r=d.transaction('store','readonly').objectStore('store').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function rawPut(key,value){const d=await db();await new Promise((resolve,reject)=>{const t=d.transaction('store','readwrite');t.objectStore('store').put(value,key);t.oncomplete=resolve;t.onerror=()=>reject(t.error)})}
async function derive(password,s){const base=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:s,iterations:ITERATIONS,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function encryptBytes(key,bytes){const iv=crypto.getRandomValues(new Uint8Array(12));const data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes));return {iv:toB64(iv),cipher:toB64(data)}}
async function decryptBytes(key,item){return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64(item.iv)},key,fromB64(item.cipher)))}
async function protect(value){if(!masterKey)throw Error('Study bloqueado');const isBlob=value instanceof Blob;const payload=isBlob?new Uint8Array(await value.arrayBuffer()):enc.encode(JSON.stringify(value));const data=await encryptBytes(masterKey,payload);return {...data,blob:isBlob,mime:isBlob?value.type:''}}
async function restore(data){const result=await decryptBytes(masterKey,data);return data.blob?new Blob([result],{type:data.mime||'application/octet-stream'}):JSON.parse(dec.decode(result))}
async function get(key){if(!masterKey)throw Error('Bloqueado');const encrypted=await rawGet('data:'+key);return encrypted?restore(encrypted):undefined}
async function put(key,value){if(!masterKey)throw Error('Bloqueado');await rawPut('data:'+key,await protect(value))}
// Conferência real: lê o registro novamente no IndexedDB, depois da transação concluir.
async function verifySavedState(expectedCards){
 if(!masterKey)throw Error('Study bloqueado.');
 const persisted=await get('state');
 if(!persisted||!Array.isArray(persisted.cards))throw Error('O armazenamento não devolveu os cartões salvos.');
 if(persisted.cards.length!==expectedCards)throw Error('Quantidade salva diferente da importada ('+persisted.cards.length+' de '+expectedCards+').');
 return {cards:persisted.cards.length,decks:Array.isArray(persisted.decks)?persisted.decks.length:0};
}
async function storageReport(){
 const record=await get('state');
 let estimate=null,persisted=null;
 try{if(navigator.storage?.estimate)estimate=await navigator.storage.estimate()}catch{}
 try{if(navigator.storage?.persisted)persisted=await navigator.storage.persisted()}catch{}
 return {stored:!!record,cards:Array.isArray(record?.cards)?record.cards.length:0,
       quota:estimate?.quota??null,usage:estimate?.usage??null,persisted};
}
async function requestPersistence(){
 try{return navigator.storage?.persist?await navigator.storage.persist():null}catch{return null}
}
function hide(){document.getElementById('vaultGate').hidden=true;document.body.classList.remove('study-locked')}
function show(first,error=''){const view=document.getElementById('vaultGate');view.hidden=false;document.body.classList.add('study-locked');view.innerHTML=`<div class="lock-card"><div class="lock-icon">S</div><h1>Study<span style="color:#9d91ff">.</span></h1><p>${first?'Crie uma senha para proteger seus flashcards neste iPhone.':'Digite sua senha para abrir seus flashcards privados.'}</p>${error?`<p class="lock-error">${error.replace(/[<>]/g,'')}</p>`:''}<form id="vaultForm"><label for="vaultPassword">Senha local</label><input id="vaultPassword" type="password" autocomplete="off" placeholder="Mínimo de 8 caracteres" required minlength="8">${first?'<label for="vaultConfirm">Repita a senha</label><input id="vaultConfirm" type="password" autocomplete="off" placeholder="Confirme a senha" required minlength="8">':''}<button class="btn primary full" type="submit">${first?'Criar senha e iniciar':'Desbloquear Study'}</button></form><small>Seus cartões não são enviados ao GitHub. Perder a senha impede a recuperação dos dados criptografados. Faça backups.</small></div>`;
view.querySelector('#vaultForm').addEventListener('submit',async e=>{e.preventDefault();const pwd=view.querySelector('#vaultPassword').value;const btn=view.querySelector('button[type=submit]');btn.disabled=true;try{if(first){if(pwd!==view.querySelector('#vaultConfirm').value)throw Error('As senhas são diferentes.');if(pwd.length<8)throw Error('Use no mínimo oito caracteres.');salt=crypto.getRandomValues(new Uint8Array(16));masterKey=await derive(pwd,salt);await rawPut('meta',{salt:toB64(salt),iterations:ITERATIONS,check:await protect({ok:true})});}else{const m=await rawGet('meta');salt=fromB64(m.salt);masterKey=await derive(pwd,salt);const chk=await restore(m.check);if(!chk?.ok)throw Error('Senha incorreta.')}hide();await window.StudyAppStart();}catch(err){masterKey=null;show(first,first?err.message:'Senha incorreta ou dados indisponíveis.')}})}
async function gate(onUnlock){window.StudyAppStart=onUnlock;if(!globalThis.crypto?.subtle||!globalThis.indexedDB){document.getElementById('vaultGate').hidden=false;document.body.classList.add('study-locked');document.getElementById('vaultGate').textContent='Este navegador não oferece armazenamento criptografado. Abra pelo endereço HTTPS no Safari.';return}try{show(!(await rawGet('meta')))}catch(e){show(true,'Não foi possível acessar o armazenamento do iPhone.')}}
function lock(){masterKey=null;gate(window.StudyAppStart)}
async function encryptBackup(data){const result=await protect(data);return {app:'study-private-backup',version:1,salt:toB64(salt),iterations:ITERATIONS,...result}}
async function decryptBackup(pack,password){const k=await derive(password,fromB64(pack.salt));return JSON.parse(dec.decode(await decryptBytes(k,pack)))}
window.StudyVault={gate,get,put,lock,encryptBackup,decryptBackup,verifySavedState,storageReport,requestPersistence};
})();
