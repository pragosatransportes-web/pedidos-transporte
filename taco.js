/* ================= MOTOR TACÓGRAFO (partilhado) — Reg. (CE) 561/2006 + DL 237/2007 =================
   Tempos em minutos. Usado por «Tempo de Viagens» e pelo Planeador de «Transporte de Máquinas». */
var Taco=(function(){
function simulate(p){
  const ev=[], ms=[]; let t=0;
  const PA=p.pausaApos||270, PD=p.pausaDur||45, DL=p.condMax||540, DLX=Math.max(600,DL);
  const s={cont:p.cont0||0, day:p.dia0||0, dayStart:-(p.amp0||0), week:p.sem0||0, prev:p.ant0||0, ext:p.ext0??2, red:p.red0??3,
           work:p.work0??(p.cont0||0), days:p.dias0||0, loc:"origem", trip:0, legKm:0, legFrom:"", nPause:0, extUsed:0, redUsed:0, emRota:0};
  const push=(type,d,label)=>{ if(d<=0) return null; const e={type,s:t,e:t+d,label,trip:s.trip}; ev.push(e); t+=d; return e; };
  const dayLimit=()=> (p.useExt && s.ext>0) ? DLX : DL;
  const ampEnd=()=> s.dayStart+((p.useRed && s.red>0) ? 900 : 780);
  const weekRem=()=> Math.min(3360-s.week, 5400-s.prev-s.week);
  function rest(){
    const duty=t-s.dayStart;
    if(s.day>DL){ s.ext--; s.extUsed++; }
    s.days++;
    let d, label, kind;
    if(s.days>=6 || weekRem()<=0){ d=2700; label="Repouso semanal 45 h"; kind="semanal"; s.prev=s.week; s.week=0; s.ext=2; s.red=3; s.days=0; }
    else if(duty>780){ d=540; label="Repouso reduzido 9 h"; kind="reduzido"; s.red--; s.redUsed++; }
    else { d=660; label="Repouso 11 h"; kind="diario"; }
    const rota = s.loc==="em rota";
    const where = rota ? `em rota, ≈${Math.round(s.legKm)} km depois de ${s.legFrom}` : (s.loc==="origem"?p.origem:p.destino);
    if(rota) s.emRota++;
    const e=push("repouso",d,`${label} · ${where}`); Object.assign(e,{kind,where,rota});
    s.cont=0; s.day=0; s.work=0; s.dayStart=t;
  }
  function pause(min,why){
    if(t+min>ampEnd()){ rest(); return; }
    push("pausa",min,why); s.nPause++;
    if(min>=PD) s.cont=0;
    s.work=0;
  }
  const workPause=()=> s.cont>=180 ? pause(PD,`Pausa ${PD} min (6 h de trabalho)`) : pause(30,"Pausa 30 min (6 h de trabalho)");
  function drive(min,label){
    let R=min, guard=0;
    while(R>0 && guard++<500){
      const avail=Math.min(PA-s.cont, dayLimit()-s.day, weekRem(), ampEnd()-t, 360-s.work);
      if(avail<=0){
        if(dayLimit()-s.day<=0 || ampEnd()-t<=0 || weekRem()<=0) rest();
        else if(PA-s.cont<=0) pause(PD,`Pausa ${PD} min (${(PA/60).toString().replace(".",",")} h de condução)`);
        else workPause();
        continue;
      }
      const d=Math.min(avail,R);
      push("conducao",d,label);
      s.cont+=d; s.day+=d; s.week+=d; s.work+=d; R-=d; s.legKm+=d*(p.vel||80)/60;
    }
  }
  function work(min,label){
    let guard=0;
    while(min>0 && guard++<20){
      if(t+min>ampEnd() && t>s.dayStart){ rest(); continue; }
      if(s.work>0 && s.work+min>360){ workPause(); continue; }
      break;
    }
    push("trabalho",min,label); s.work+=min;
  }
  for(let i=1;i<=p.n;i++){
    s.trip=i;
    work(p.carga,`Carga · viagem ${i}`);
    work(p.fixo||0,`Manobras e pesagem · viagem ${i}`);
    s.loc="em rota"; s.legKm=0; s.legFrom=p.origem;
    drive(p.dIda,`${p.origem} → ${p.destino} · viagem ${i}`);
    s.loc="destino";
    const m={trip:i,chegada:t};
    work(p.descarga,`Descarga em ${p.destino} · viagem ${i}`);
    m.fimDescarga=t; ev[ev.length-1].mark=`Entrega ${i} concluída`;
    if(p.regresso){
      if(p.retCarregado) work(p.carga,`Carga em ${p.destino} (retorno) · viagem ${i}`);
      s.loc="em rota"; s.legKm=0; s.legFrom=p.destino;
      drive(p.dVolta,`${p.destino} → ${p.origem} (${p.retCarregado?"carregado":"vazio"}) · viagem ${i}`);
      s.loc="origem";
      if(p.retCarregado){
        m.chegadaRet=t;
        work(p.descarga,`Descarga em ${p.origem} (retorno) · viagem ${i}`);
        m.fimRet=t;
        ev[ev.length-1].mark=`De volta a ${p.origem} · entrega de retorno ${i} concluída`;
      } else ev[ev.length-1].mark=`De volta a ${p.origem} · viagem ${i}`;
    }
    m.fim=t; ms.push(m);
  }
  const margin={drive:Math.max(0,dayLimit()-s.day), amp:Math.max(0,ampEnd()-t)};
  const sum=type=>ev.filter(e=>e.type===type).reduce((a,e)=>a+e.e-e.s,0);
  const days=[]; let cur=null;
  for(const e of ev){
    if(e.type==="repouso"){ if(cur){ cur.rest=e; days.push(cur); cur=null; } continue; }
    if(!cur) cur={s:e.s,e:e.e,drv:0,wrk:0,viagens:[]};
    cur.e=e.e;
    if(e.type==="conducao") cur.drv+=e.e-e.s;
    if(e.type==="trabalho") cur.wrk+=e.e-e.s;
    if(e.mark && (p.regresso ? e.mark.startsWith("De volta") : e.mark.startsWith("Entrega"))) cur.viagens.push(e.trip);
  }
  if(cur) days.push(cur);
  return {ev,ms,days,end:t,drv:sum("conducao"),wrk:sum("trabalho"),s,margin,
          state:{cont:s.cont, day:s.day, amp:t-s.dayStart, work:s.work}};
}
/* quantas viagens completas cabem em cada período (1 dia … semana) */
function capacity(p,flex){
  const r=simulate({...p,n:120,useExt:flex,useRed:flex});
  const rests=r.ev.filter(e=>e.type==="repouso");
  let wi=rests.findIndex(e=>e.kind==="semanal"); if(wi<0) wi=rests.length-1;
  const per=[];
  for(let k=1;k<=wi+1;k++){
    const cut=rests[k-1] ? rests[k-1].s : Infinity;
    per.push({dias:k, viagens:r.ms.filter(m=>m.fim<=cut).length, entregas:r.ms.filter(m=>m.fimDescarga<=cut).length+r.ms.filter(m=>m.fimRet!=null&&m.fimRet<=cut).length});
  }
  return per;
}
return {simulate,capacity};
})();

