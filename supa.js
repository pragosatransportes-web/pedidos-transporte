/* Pedidos de Transporte CPSA — ligação ao Supabase.
   Fornece window.claude.use("db" | "user" | "downloads" | "assets") com a mesma interface
   que a página usava como artefacto, para o resto do código não mudar. */
(function(){
  "use strict";
  const CFG = window.CPSA_CONFIG || {};
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {auth:{persistSession:true,autoRefreshToken:true}});
  window.CPSA_SB = sb;
  const rid = () => Math.random().toString(36).slice(2,12) + Date.now().toString(36).slice(-6);
  const err = (code, message) => Object.assign(new Error(message||code), {code});
  const mapErr = e => {
    if(!e) return err("unknown");
    const m = String(e.message||"");
    if(e.code==="42501" || /row-level security|permission/i.test(m)) return err("permission_denied", "Sem permissão para gravar estes dados.");
    if(e.code==="P0002" || /not_found/.test(m)) return err("not_found", "Registo não encontrado.");
    return err("unavailable", m || "Erro de ligação à base de dados.");
  };

  /* ---------- documentos ---------- */
  function splitPath(p){ const a = String(p).split("/"); return {col:a.slice(0,-1).join("/"), id:a[a.length-1]}; }
  function DocRef(col, id){
    return {
      id, path: col+"/"+id,
      async get(){
        const {data, error} = await sb.from("docs").select("data").eq("col",col).eq("id",id).maybeSingle();
        if(error) throw mapErr(error);
        return {exists: !!data, id, data: () => data ? data.data : undefined};
      },
      async set(obj){
        const clean = JSON.parse(JSON.stringify(obj||{}));
        const {error} = await sb.from("docs").upsert({col, id, data: clean, updated_at: new Date().toISOString()}, {onConflict:"col,id"});
        if(error) throw mapErr(error);
      },
      async update(patch){
        const clean = JSON.parse(JSON.stringify(patch||{}));
        const {error} = await sb.rpc("doc_merge", {p_col:col, p_id:id, p_patch:clean});
        if(error) throw mapErr(error);
      },
      async delete(){
        const {error} = await sb.from("docs").delete().eq("col",col).eq("id",id);
        if(error) throw mapErr(error);
      },
      async acquire(o){
        const holder = (o && o.holder) || rid();
        const {data, error} = await sb.rpc("lock_try", {p_col:col, p_id:id, p_holder:holder, p_ms:(o && o.ttlMs) || 5000});
        if(error) throw mapErr(error);
        return {acquired: !!data};
      }
    };
  }

  /* Cada coleção: um único carregamento + canal em tempo real partilhado por todos os ouvintes */
  const feeds = {};
  function feed(col){
    if(feeds[col]) return feeds[col];
    const F = feeds[col] = {rows:new Map(), ready:false, subs:new Set(), errs:new Set()};
    const emit = () => { F.subs.forEach(fn => { try{ fn(); }catch(e){ console.error(e); } }); };
    (async () => {
      try{
        let from = 0; const page = 1000;
        for(;;){
          const {data, error} = await sb.from("docs").select("id,data").eq("col",col).range(from, from+page-1);
          if(error) throw error;
          data.forEach(r => F.rows.set(r.id, r.data));
          if(data.length < page) break; from += page;
        }
        F.ready = true; emit();
      }catch(e){ F.errs.forEach(fn => fn(mapErr(e))); F.ready = true; emit(); }
    })();
    sb.channel("docs-"+col)
      .on("postgres_changes", {event:"*", schema:"public", table:"docs", filter:"col=eq."+col}, payload => {
        if(payload.eventType === "DELETE"){ const o = payload.old || {}; if(o.id) F.rows.delete(o.id); }
        else { const n = payload.new || {}; if(n.id) F.rows.set(n.id, n.data); }
        if(F.ready) emit();
      })
      .subscribe();
    return F;
  }
  function Query(col, opts){
    opts = opts || {};
    return {
      orderBy(field, dir){ return Query(col, {...opts, order:{field, dir:dir||"asc"}}); },
      limit(n){ return Query(col, {...opts, limit:n}); },
      doc(id){ return DocRef(col, id || rid()); },
      onSnapshot(cb, onErr){
        const F = feed(col);
        const run = () => {
          if(!F.ready) return;
          let docs = [...F.rows.entries()].map(([id, d]) => ({id, data: () => d, _d: d}));
          if(opts.order){ const {field, dir} = opts.order; docs.sort((a,b) => { const x=a._d&&a._d[field], y=b._d&&b._d[field]; return (x>y?1:x<y?-1:0) * (dir==="desc"?-1:1); }); }
          if(opts.limit) docs = docs.slice(0, opts.limit);
          cb({docs, size: docs.length, empty: !docs.length});
        };
        F.subs.add(run); if(onErr) F.errs.add(onErr); run();
        return () => { F.subs.delete(run); if(onErr) F.errs.delete(onErr); };
      }
    };
  }
  const db = {
    collection: col => Query(col),
    doc: path => { const p = splitPath(path); return DocRef(p.col, p.id); }
  };

  /* ---------- utilizador ---------- */
  let session = null;
  const nomeDoEmail = e => String(e||"").split("@")[0].split(/[._-]+/).filter(Boolean).map(w => w[0].toUpperCase()+w.slice(1)).join(" ");
  async function perfilPorEmail(email){
    const e = String(email||"").toLowerCase();
    const {data} = await sb.from("docs").select("id,data").eq("col","utilizadores").eq("id", session.user.id).maybeSingle();
    if(data && data.data) return data.data;
    const r = await sb.from("docs").select("data").eq("col","convites");
    const c = (r.data||[]).map(x=>x.data).find(x => String(x.email||"").toLowerCase() === e);
    return c || null;
  }
  const user = {
    async me(){
      const p = await perfilPorEmail(session.user.email);
      const {data:adm} = await sb.rpc("eu_admin");
      return {id: session.user.id, name: (p && (p.alcunha||p.nome)) || nomeDoEmail(session.user.email), email: session.user.email,
              isOwner: !!adm, canEdit: !!adm, avatarUrl: ""};
    },
    async can(){ return true; },
    async profiles(ids){
      const out = {};
      const {data} = await sb.from("docs").select("id,data").eq("col","utilizadores").in("id", ids);
      (data||[]).forEach(r => { out[r.id] = {name: r.data.alcunha || r.data.nome || r.data.email || "Utilizador", avatarUrl:""}; });
      if(ids.includes(session.user.id) && !out[session.user.id]){ const p = await perfilPorEmail(session.user.email); out[session.user.id] = {name: (p && (p.alcunha||p.nome)) || nomeDoEmail(session.user.email), avatarUrl:""}; }
      return out;
    },
    async search(){ return []; }
  };

  /* ---------- descargas ---------- */
  const downloads = {
    async save({filename, data}){
      const blob = data instanceof Blob ? data : new Blob([data]);
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      return {status:"saved"};
    }
  };

  window.claude = {
    use: async name => {
      if(!session) return null;
      if(name === "db") return db;
      if(name === "user") return user;
      if(name === "downloads") return downloads;
      return null; // anexos: ainda não ligados nesta versão
    }
  };

  /* ---------- ecrã de entrada ---------- */
  const css = `.lg-wrap{min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg,#F3F5F8);font-family:"Plus Jakarta Sans",system-ui,sans-serif;color:var(--ink,#17212B)}
   .lg{width:min(400px,100%);background:var(--panel,#fff);border-radius:18px;box-shadow:0 4px 24px rgba(23,33,43,.08);padding:28px;display:flex;flex-direction:column;gap:14px}
   .lg h1{margin:0;font-size:22px;font-weight:800;letter-spacing:-.015em}.lg p{margin:0;color:var(--muted,#5A6672);font-size:14px}
   .lg .logo{width:44px;height:44px;border-radius:12px;background:#D98E10;color:#4A3000;display:grid;place-items:center;font-weight:800}
   .lg label{display:flex;flex-direction:column;gap:5px;font-size:12.5px;font-weight:600;color:var(--muted,#5A6672)}
   .lg input{font:inherit;font-size:15px;padding:10px 12px;border-radius:10px;border:1px solid var(--line,#E1E6EC);background:var(--panel2,#F7F9FB);color:inherit}
   .lg button{font:inherit;font-weight:700;padding:11px 14px;border-radius:10px;border:0;cursor:pointer;background:#17212B;color:#fff}
   .lg button.sec{background:transparent;color:var(--ink,#17212B);border:1px solid var(--line,#E1E6EC)}
   .lg .lnk{background:none;border:0;color:#2C5CA6;padding:0;font-weight:600;cursor:pointer;align-self:flex-start}
   .lg .msg{font-size:13.5px;padding:10px 12px;border-radius:10px;background:#EEF3FB;color:#1E3F73}.lg .msg.bad{background:#FBEDEC;color:#8A1C12}`;
  function loginScreen(mode, msg, bad){
    let st = document.getElementById("lg-css"); if(!st){ st = document.createElement("style"); st.id="lg-css"; st.textContent = css; document.head.appendChild(st); }
    const app = document.getElementById("app") || document.body;
    const t = {
      entrar: ["Entrar", "Use o email registado pela Logística e a sua palavra-passe.", "Entrar"],
      registar: ["Primeiro acesso", "Defina a sua palavra-passe. Só funciona com o email criado em Utilizadores. Depois confirme o email na sua caixa de correio.", "Criar palavra-passe"],
      recuperar: ["Recuperar palavra-passe", "Enviamos um link para o seu email para definir uma nova palavra-passe.", "Enviar link"],
      nova: ["Nova palavra-passe", "Escreva a nova palavra-passe.", "Guardar"]
    }[mode];
    app.innerHTML = `<div class="lg-wrap"><form class="lg" id="lgf" autocomplete="on">
      <div class="logo">CP</div><h1>${t[0]}</h1><p>CPSA Transportes · Departamento de Logística</p><p>${t[1]}</p>
      ${msg?`<div class="msg ${bad?"bad":""}">${msg}</div>`:""}
      ${mode!=="nova"?`<label>Email<input id="lg-e" type="email" required autocomplete="username"></label>`:""}
      ${mode!=="recuperar"?`<label>Palavra-passe<input id="lg-p" type="password" required minlength="8" autocomplete="${mode==="entrar"?"current-password":"new-password"}"></label>`:""}
      <button type="submit">${t[2]}</button>
      ${mode==="entrar"?`<button type="button" class="sec" data-m="registar">Primeiro acesso: criar palavra-passe</button><button type="button" class="lnk" data-m="recuperar">Esqueci-me da palavra-passe</button>`:`<button type="button" class="lnk" data-m="entrar">Voltar a entrar</button>`}
    </form></div>`;
    app.querySelectorAll("[data-m]").forEach(b => b.onclick = () => loginScreen(b.dataset.m));
    app.querySelector("#lgf").onsubmit = async ev => {
      ev.preventDefault();
      const e = app.querySelector("#lg-e")?.value.trim(), p = app.querySelector("#lg-p")?.value;
      const btn = app.querySelector("button[type=submit]"); btn.disabled = true;
      try{
        if(mode === "entrar"){
          const {error} = await sb.auth.signInWithPassword({email:e, password:p});
          if(error) throw error;
        }else if(mode === "registar"){
          const {data, error} = await sb.auth.signUp({email:e, password:p, options:{emailRedirectTo: location.origin + location.pathname}});
          if(error) throw error;
          if(!data.session) return loginScreen("entrar", "Conta criada. Abra o email que lhe enviámos e confirme o endereço; depois entre aqui.");
        }else if(mode === "recuperar"){
          const {error} = await sb.auth.resetPasswordForEmail(e, {redirectTo: location.origin + location.pathname});
          if(error) throw error;
          return loginScreen("entrar", "Se o email estiver registado, recebe um link para definir a palavra-passe.");
        }else if(mode === "nova"){
          const {error} = await sb.auth.updateUser({password:p});
          if(error) throw error;
          location.hash = ""; location.reload(); return;
        }
      }catch(x){
        const m = String(x && x.message || x);
        loginScreen(mode, /Invalid login/i.test(m) ? "Email ou palavra-passe errados." :
          /Email not confirmed/i.test(m) ? "Ainda não confirmou o email. Veja a sua caixa de correio." :
          /sem acesso|Database error saving new user/i.test(m) ? "Este email não tem acesso à plataforma. Peça ao administrador para o criar em Utilizadores." :
          /already registered/i.test(m) ? "Este email já tem palavra-passe. Use “Entrar” ou “Esqueci-me da palavra-passe”." :
          /Password should be/i.test(m) ? "A palavra-passe tem de ter pelo menos 8 caracteres." : m, true);
      }
    };
  }
  function semAcesso(){
    const app = document.getElementById("app") || document.body;
    app.innerHTML = `<div class="lg-wrap"><div class="lg"><div class="logo">CP</div><h1>Sem acesso</h1><p>O email <b>${session.user.email}</b> não está registado na plataforma. Peça ao administrador para o criar em Utilizadores.</p><button id="lg-out">Sair</button></div></div>`;
    document.getElementById("lg-out").onclick = async () => { await sb.auth.signOut(); location.reload(); };
  }
  window.CPSA_SAIR = async () => { await sb.auth.signOut(); location.hash=""; location.reload(); };

  window.CPSA_READY = (async () => {
    const recovery = /type=recovery/.test(location.hash);
    const {data} = await sb.auth.getSession();
    session = data.session;
    sb.auth.onAuthStateChange((ev, s) => { if(ev === "PASSWORD_RECOVERY"){ session = s; loginScreen("nova"); } else if(ev === "SIGNED_IN" && !session){ location.reload(); } else if(ev === "SIGNED_OUT"){ session = null; } });
    if(recovery && session){ loginScreen("nova"); return false; }
    if(!session){ loginScreen("entrar"); return false; }
    const {data:ok} = await sb.rpc("eu_permitido");
    if(!ok){ semAcesso(); return false; }
    return true;
  })();
})();
