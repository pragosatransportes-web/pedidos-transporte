/* Programação Semanal dos encarregados — leitura do Excel e correspondência de nomes.
   Funções puras (sem acesso à app), expostas em window.PROG e testáveis em Node. */
(function(root){
  "use strict";
  const pad=n=>String(n).padStart(2,"0");
  /* Datas do Excel (SheetJS cellDates) podem vir com desvio de fuso: arredonda ao meio-dia e usa a data local */
  const fmt=x=>`${x.getFullYear()}-${pad(x.getMonth()+1)}-${pad(x.getDate())}`;
  function dKey(d){if(!(d instanceof Date)||isNaN(d))return null;return fmt(new Date(d.getTime()+12*3600e3));}
  function kDate(k){const[a,b,c]=k.split("-").map(Number);return new Date(a,b-1,c,12);}
  function addD(k,n){const d=kDate(k);d.setDate(d.getDate()+n);return fmt(d);}
  /* Semana sábado→sexta, identificada pela segunda-feira */
  function semKey(k){const w=kDate(k).getDay();return addD(k,w===6?2:w===0?1:1-w);}
  /* Igual a WEEKNUM(data;1) do Excel (semanas a começar ao domingo, semana 1 contém o 1 de janeiro) */
  function semNum(k){const d=kDate(k),j=new Date(d.getFullYear(),0,1,12);const doy=Math.round((d-j)/864e5);return Math.floor((doy+j.getDay())/7)+1;}
  const MES=["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
  function semLabel(seg){const d=kDate(seg);return `SEM${semNum(seg)} | ${MES[d.getMonth()]}.${String(d.getFullYear()).slice(2)}`;}

  const txt=v=>v==null?"":String(v).replace(/\s+/g," ").trim();
  const vazio=r=>!r||r.every(c=>txt(c)==="");

  /* rows: matriz da folha (sheet_to_json header:1, cellDates:true) */
  function parseProgramacao(rows){
    const hr=rows.findIndex(r=>r&&r.some(c=>/^encarregad/i.test(txt(c))));
    if(hr<0)return null;
    const nc=rows[hr].findIndex(c=>/^encarregad/i.test(txt(c))),tc=rows[hr].findIndex(c=>/^tag$/i.test(txt(c)));
    let dr=-1;for(let i=hr-1;i>=0;i--){if((rows[i]||[]).filter(c=>c instanceof Date).length>=3){dr=i;break;}}
    if(dr<0)return null;
    const cols=[];rows[dr].forEach((c,i)=>{if(i>nc&&c instanceof Date)cols.push({c:i,k:dKey(c)});});
    if(!cols.length)return null;
    const pessoas=[];let cur=null,brancos=0;
    for(let r=hr+1;r<rows.length;r++){const row=rows[r]||[];
      if(vazio(row)){if(++brancos>=2)break;continue;}brancos=0;
      const nome=txt(row[nc]);if(nome&&!/[a-z]/i.test(nome))continue; /* totais numéricos */
      const dias={};let n=0;
      cols.forEach(({c,k})=>{const o=txt(row[c]),cod=txt(row[c+1]);if(!o&&!cod)return;if(/^\(!\)/.test(o))return;
        const e=/^ausente/i.test(o)?{tipo:"ausente",motivo:cod}:{tipo:"obra",nome:o,codigo:cod};(dias[k]=dias[k]||[]).push(e);n++;});
      if(nome){cur={nome,tag:tc>=0?txt(row[tc]):"",sem:/^sem encarregado/i.test(nome),dias};pessoas.push(cur);}
      else if(cur&&n){Object.entries(dias).forEach(([k,es])=>{(cur.dias[k]=cur.dias[k]||[]).push(...es);});}
    }
    const porSem=new Map();
    cols.forEach(({k})=>{const s=semKey(k);if(!porSem.has(s))porSem.set(s,new Set());porSem.get(s).add(k);});
    const semanas=[...porSem.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([seg,ks])=>{const sab=addD(seg,-2);
      const dias=[0,1,2,3,4,5,6].map(i=>addD(sab,i)).filter(k=>ks.has(k));
      const linhas=pessoas.map(p=>{const d={};dias.forEach(k=>{if(p.dias[k])d[k]=p.dias[k];});return{nome:p.nome,tag:p.tag,sem:p.sem,dias:d};}).filter(l=>Object.keys(l.dias).length);
      return{key:seg,label:semLabel(seg),inicio:sab,fim:addD(seg,4),dias,linhas};}).filter(s=>s.linhas.length);
    return{semanas};
  }

  /* Lista de contactos: cada linha com nome e telemóvel (função e extensão opcionais) */
  function parseContactos(rows){const out=[];
    (rows||[]).forEach(r=>{if(!r)return;const cs=r.map(txt);
      const ti=cs.findIndex(c=>/^(\+?351)?9\d{8}$/.test(c.replace(/[\s.-]/g,"")));if(ti<0)return;
      const textos=cs.map((c,i)=>({c,i})).filter(x=>x.i!==ti&&/[a-zà-ú]/i.test(x.c));
      const fn=textos.find(x=>/^(encarregad|chefe|t[eé]cnic|respons)/i.test(x.c));
      const nm=textos.filter(x=>x!==fn).sort((a,b)=>b.c.length-a.c.length)[0];if(!nm)return;
      const ext=cs.find((c,i)=>i!==ti&&/^\d{3,5}$/.test(c))||"";
      out.push({nome:nm.c,telemovel:cs[ti].replace(/[\s.-]/g,"").replace(/^\+?351/,""),extensao:ext,funcao:fn?fn.c:""});});
    return out;}

  /* ---------- nomes ---------- */
  function normEnc(s){return String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toUpperCase().replace(/\([^)]*\)/g," ").replace(/[^A-Z]+/g," ").trim();}
  const toks=s=>normEnc(s).split(" ").filter(t=>t.length>1);
  /* Devolve {id, cands}: id quando há uma só correspondência segura; cands = sugestões */
  function matchEnc(nome,encs){const n=normEnc(nome);if(!n)return{id:null,cands:[]};
    const ex=encs.filter(e=>normEnc(e.nome)===n||(e.aliases||[]).some(a=>normEnc(a)===n));
    if(ex.length===1)return{id:ex[0].id,cands:[ex[0].id]};if(ex.length>1)return{id:null,cands:ex.map(e=>e.id)};
    const T=toks(nome);if(T.length<2)return{id:null,cands:[]};
    const sub=encs.filter(e=>{const E=toks(e.nome);return E.length>=2&&(T.every(t=>E.includes(t))||E.every(t=>T.includes(t)));});
    return{id:sub.length===1?sub[0].id:null,cands:sub.map(e=>e.id)};}

  const PROG={dKey,addD,semKey,semNum,semLabel,parseProgramacao,parseContactos,normEnc,matchEnc};
  if(typeof module!=="undefined"&&module.exports)module.exports=PROG;else root.PROG=PROG;
})(typeof window!=="undefined"?window:globalThis);
