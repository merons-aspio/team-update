const SRC="<!DOCTYPE html>\n"+document.documentElement.outerHTML;
const $=id=>document.getElementById(id);
let cur = null, dirty = false;
let items = [];
let pastedImages = {}; // key -> dataUrl map for pasted screenshots
let imageCounter = 0;

async function loadItems() {
  try {
    const { data, error } = await sb.from("updates").select("*").order("at", { ascending: false });
    if (error) { console.error("Supabase load error:", error); throw error; }
    if (data) items = data;
  } catch(e) {
    console.error("Supabase unavailable, falling back to localStorage:", e);
    try { items = (JSON.parse(localStorage.getItem("team_updates")) || []); } catch(_) { items = []; }
  }
}
const SUPABASE_URL = "https://ozbnducbpvbdewyerbkn.supabase.co";
const SUPABASE_KEY = "sb_publishable_43wD1ERo2QA8csAh0vsQkg_hQecLWMZ";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Auth state
let user = null;
let canEdit = false;

// 1. Detect edit mode via ?edit=1 in the URL
const hashId=()=>location.hash.slice(1);
const setStatus=t=>{$("status").textContent=t};

const isEditor = new URLSearchParams(location.search).has('edit');
const h0 = hashId();

// 2. Listen to Supabase Auth state changes
sb.auth.onAuthStateChange((event, session) => {
  user = session?.user ?? null;
  canEdit = !!user;
  updateAuthUI();
  maybeAddLogoutBtn();
});

// Update auth UI based on login state
function updateAuthUI() {
  const overlay = $("auth-overlay");
  const editorEl = document.body;
  const loginBtn = $("auth-login-btn");
  
  if (user) {
    overlay.classList.remove("open");
    loginBtn.style.display = "none";
    if (isEditor) {
      editorEl.classList.remove("viewer");
      editorEl.classList.add("editor");
    } else {
      editorEl.classList.remove("editor");
      editorEl.classList.add("viewer");
      $("exit").style.display = "none";
    }
  } else {
    loginBtn.style.display = "inline-block";
    if (isEditor) {
      overlay.classList.add("open");
      editorEl.classList.remove("editor");
      editorEl.classList.add("viewer");
      $("exit").style.display = "none";
    } else {
      editorEl.classList.remove("editor");
      editorEl.classList.add("viewer");
      $("exit").style.display = "none";
    }
  }
}

// Render auth form (signin only)
function renderAuthForm() {
  const title = $("auth-title");
  const btn = $("auth-btn");
  const emailInput = $("auth-email");
  const passInput = $("auth-password");
  
  title.textContent = "Sign in to edit";
  btn.textContent = "Sign in";
  
  btn.onclick = handleAuthSubmit;
  [emailInput, passInput].forEach(inp => {
    inp.onkeydown = (e) => { if (e.key === "Enter") handleAuthSubmit(); };
  });
  
  emailInput.focus();
}

// Handle sign in only
async function handleAuthSubmit() {
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value.trim();
  const err = $("auth-error");
  err.textContent = "";
  err.style.display = "none";
  
  if (!email || !password) {
    err.textContent = "Please enter both email and password.";
    err.style.display = "block";
    return;
  }
  
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  } catch(e) {
    err.textContent = e.message || "Authentication failed.";
    err.style.display = "block";
  }
}

// Logout
async function handleLogout() {
  await sb.auth.signOut();
  user = null;
  canEdit = false;
  updateAuthUI();
  location.reload();
}

// Login button click
$("auth-login-btn").onclick = () => {
  if (!isEditor) {
    const sep = location.search ? "&" : "?";
    history.replaceState(null, "", location.pathname + location.search + sep + "edit=1");
    location.reload();
    return;
  }
  $("auth-overlay").classList.add("open");
  renderAuthForm();
};

// Add logout button to editor bar when logged in
function maybeAddLogoutBtn() {
  if ($("auth-logout")) return;
  if (!user) return;
  const btn = document.createElement("button");
  btn.id = "auth-logout";
  btn.className = "btn";
  btn.textContent = "Logout (" + (user.email || "user") + ")";
  btn.onclick = handleLogout;
  const presentBtn = $("present");
  presentBtn.parentNode.insertBefore(btn, presentBtn);
}

// Owner detection for avatars
const OWNERS = { Kidane: "K", Lidetu: "L", Wubshet: "W" };
function detectOwners(raw) {
  const found = [];
  for (const [name, initial] of Object.entries(OWNERS)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(raw)) found.push({ name, initial });
  }
  return found;
}

function ownerHTML(owners) {
  if (!owners.length) return "";
  return owners.map(o => `<span class="owner ${o.name}"><span class="avatar">${o.initial}</span>${o.name}</span>`).join("");
}

// Status chip from a bullet line
function statusChip(line) {
  const t = line.toLowerCase();
  if (/blocked/.test(t)) return `<span class="tag Blocked">Blocked</span>`;
  if (/done|completed/.test(t)) return `<span class="tag">Done</span>`;
  if (/in progress/.test(t)) return `<span class="tag" style="background:var(--warn-soft);color:var(--warn)">In Progress</span>`;
  if (/planned|next|upcoming/.test(t)) return `<span class="tag" style="background:var(--accent-soft);color:var(--accent)">Planned</span>`;
  return "";
}

function buildHtml(){
  const json=JSON.stringify({updates:items}).replace(/</g,"\\u003c");
  return SRC.replace(/(<script type="application\/json" id="data">)[\s\S]*?(<\/script>)/,(m,a,b)=>a+json+b)
}
const EMO=/^\p{Extended_Pictographic}/u;
const isBul=l=>/^\s*[•▸▪◦\-\*]\s+/.test(l);
function normalize(raw){
  let L=raw.replace(/\r/g,"").split("\n").map(l=>l.replace(/\s+$/,""));
  const out=[];let first=true;
  const nxt=i=>{for(let j=i+1;j<L.length;j++){if(L[j].trim())return L[j]}return""};
  for(let i=0;i<L.length;i++){
    let l=L[i],t=l.trim();
    if(!t){out.push("");continue}
    if(/^(#{1,6}\s|---|\||>|!\[|```)/.test(t)||/^\d+\.\s/.test(t)){out.push(l);if(first&&/^#/.test(t))first=false;continue}
    if(isBul(t)){
      let b=t.replace(/^([•▸▪◦\-\*]\s*)+/,"");
      b=b.replace(/^([^:*\[\]]{2,40}):\s/,"**$1:** ");
      out.push("- "+b);continue}
    const n=nxt(i).trim();
    if(first){out.push("# "+t);first=false;continue}
    if(/^(completed|done|in progress|blocked|planned|next|upcoming|blockers?)\b[^.]{0,20}$/i.test(t)){out.push("## "+t);continue}
    if(/^[\p{Extended_Pictographic}\u2600-\u27BF]/u.test(t)&&!t.startsWith("✅")&&t.length<80&&(nxt(i).startsWith("✅")||isBul(n))&&!/[.!]$/.test(t)){out.push("## "+t);continue}
    if(t.length<70&&isBul(n)&&!out.length==false){out.push("### "+t.replace(/^✅\s*/,""));continue}
    if(t.startsWith("✅")&&t.length<90&&isBul(n)){out.push("### "+t.replace(/^✅\s*/,"✅ ").replace("✅ ",""));continue}
    out.push(t)
  }
  const fin=[];
  out.forEach((l,i)=>{const p=fin[fin.length-1]??"";
    if(/^#{1,3} /.test(l)&&p!=="")fin.push("");
    if(/^- /.test(l)&&p!==""&&!/^- /.test(p))fin.push("");
    if(!/^- /.test(l)&&l!==""&&/^- /.test(p))fin.push("");
    fin.push(l)});
  return fin.join("\n");
}

// Paste screenshot handler — inserts short placeholder in editor, stores data URL for view mode
async function pasteImage(e) {
  const items = e.clipboardData.items || [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const key = "pasted-img-" + (++imageCounter);
        pastedImages[key] = dataUrl;
        savePastedImages();
        const textarea = $("src");
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = textarea.value;
        const imageMd = `\n![Screenshot](${key})\n`;
        textarea.value = value.slice(0, start) + imageMd + value.slice(end);
        textarea.selectionStart = textarea.selectionEnd = start + imageMd.length;
        textarea.focus();
        queueSave();
      };
      reader.readAsDataURL(file);
      return;
    }
  }
}

function savePastedImages() {
  try { localStorage.setItem("team_updates_images", JSON.stringify(pastedImages)); } catch(_) {}
}

function loadPastedImages() {
  try { pastedImages = JSON.parse(localStorage.getItem("team_updates_images") || "{}"); } catch(_) { pastedImages = {}; }
  // Restore image counter
  const keys = Object.keys(pastedImages);
  if (keys.length) {
    const max = Math.max(...keys.map(k => parseInt(k.replace("pasted-img-", "")) || 0));
    imageCounter = max;
  }
}

function render(raw){
  const html=DOMPurify.sanitize(marked.parse(normalize(raw),{breaks:true,gfm:true}));
  const box=document.createElement("div");box.innerHTML=html;
  // Replace pasted image placeholder URLs with actual base64 data URLs
  box.querySelectorAll("img").forEach(img=>{
    const src=img.getAttribute("src");
    if(src && pastedImages[src]) img.src = pastedImages[src];
  });
  box.querySelectorAll("table").forEach(t=>{const w=document.createElement("div");w.className="tw";t.replaceWith(w);w.appendChild(t)});
  box.querySelectorAll("a").forEach(a=>{a.target="_blank";a.rel="noopener noreferrer"});
  // Add owner avatars before bold names
  box.querySelectorAll("strong").forEach(s=>{
    const text=s.textContent;
    const owners=detectOwners(text);
    if(owners.length){
      const wrap=document.createElement("span");wrap.className="owner-prefix";
      wrap.innerHTML=ownerHTML(owners)+" ";
      s.parentNode.insertBefore(wrap,s);
    }
  });
  box.querySelectorAll("li").forEach(li=>{
    const chip=statusChip(li.textContent);
    if(chip){
      const c=document.createElement("span");c.className="status-chip";c.innerHTML=chip;c.style.float="right";c.style.fontSize="11px";
      li.prepend(c);li.style.overflow="hidden";
    }
  });
  const frag=document.createElement("div");let sec=null;
  [...box.childNodes].forEach(n=>{
    if(n.nodeType===1&&n.tagName==="H1"){frag.appendChild(n);
      const nx=n.nextElementSibling; if(nx&&nx.tagName==="P"&&!nx.querySelector("img")){nx.classList.add("lead")}
      return}
    if(n.nodeType===1&&n.tagName==="H2"){sec=document.createElement("section");sec.className="sec";
      const tx=n.textContent.toLowerCase();
      if(/in progress/.test(tx))sec.classList.add("s-prog");else if(/^\W*(completed|done)/.test(tx))sec.classList.add("s-done");
      frag.appendChild(sec);sec.appendChild(n);return}
    if(n.nodeType===1&&n.classList.contains("lead")){frag.appendChild(n);return}
    (sec||frag).appendChild(n)});
  frag.querySelectorAll("p.lead").forEach(()=>{});
  const h1=frag.querySelector("h1");
  if(h1&&h1.nextElementSibling&&h1.nextElementSibling.tagName==="P")h1.nextElementSibling.classList.add("lead");
  return frag.innerHTML;
}
function titleOf(raw){const f=raw.split("\n").find(l=>l.trim())||"Untitled";return f.replace(/^#+\s*/,"").slice(0,70)}
function paint(){
  const v=$("src").value.trim(),it=items.find(x=>x.id===cur);
  const d=it&&it.at?new Date(it.at).toLocaleDateString(undefined,{day:"numeric",month:"long",year:"numeric"}):"";
  const tp=$("type").value;
  $("view").innerHTML=v?`<span class="tag ${tp} kicker">${tp} update${d?" · "+d:""}</span>`+render(v):'<div class="empty">'+(canEdit?"Paste an update on the left.<br>The formatted version appears here.":"Open the link you were sent to see an update.")+'</div>'
}
function renderList(){
  const l=$("list");l.innerHTML="";
  if(!items.length){l.innerHTML='<p class="hint" style="margin:8px">No updates yet.</p>';return}
  items.forEach(it=>{const b=document.createElement("button");b.className="item"+(cur===it.id?" on":"");
    const d=new Date(it.at).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});
    b.innerHTML=`<b></b><small><span class="tag ${it.type}">${it.type}</span>${d}</small>`;
    b.querySelector("b").textContent=it.title;
    b.onclick=()=>{location.hash=it.id;open(it.id)};
    l.appendChild(b)})
}
function open(id){
  cur=id||null;const it=items.find(x=>x.id===id);
  $("src").value=it?it.raw||"":"";$("type").value=it?it.type||"Weekly":"Weekly";$("title").value=it?it.custom||"":"";
  document.body.classList.toggle("hasid",!!it);
  $("linkrow").hidden=true;paint();renderList()
}
function touch(){
  const raw=$("src").value;if(!raw.trim())return false;
  if(!cur){cur="u-"+Date.now().toString(36);location.hash=cur;document.body.classList.add("hasid")}
  const old=items.find(x=>x.id===cur),custom=$("title").value.trim();
  const rec={id:cur,raw,type:$("type").value,custom,title:custom||titleOf(raw),at:(old&&old.at)||Date.now(),updatedAt:Date.now()};
  if(old)Object.assign(old,rec);else items.unshift(rec);
  dirty=true;setStatus("Unpublished changes");renderList();return true
}
function queueSave(){if(canEdit)touch();paint()}
async function publish() {
  if (!canEdit) return false;
  if ($("src").value.trim()) touch();
  
  try {
    const { error } = await sb.from("updates").upsert(items);
    if (error) { console.error("Supabase upsert error:", error); throw error; }
    try { localStorage.setItem("team_updates", JSON.stringify(items)); } catch(_) {}
    savePastedImages();
    setStatus("Saved to Supabase ✓");
    dirty = false;
    return true;
  } catch(e) {
    setStatus("Error saving to Supabase");
    return false;
  }
}
["src","title"].forEach(i=>$(i).addEventListener("input",queueSave));
$("type").addEventListener("change",queueSave);
$("pub").onclick=publish;
$("new").onclick=()=>{if(!canEdit)return;history.replaceState(null,"",location.pathname+location.search);open(null);document.body.classList.remove("hasid");$("src").focus()};
$("copy").onclick = async () => {
  if (!$("src").value.trim()) return;
  if (!cur) touch();
  
  const url = window.location.origin + window.location.pathname + "#" + cur;
  $("linkbox").value = url;
  $("linkrow").hidden = false;
  $("linkbox").select();
  
  try {
    await navigator.clipboard.writeText(url);
    setStatus("Link copied ✓");
  } catch(e) {
    setStatus("Select and copy the link below");
  }
  if (dirty) publish();
};
let armed = false;
$("del").onclick = async () => {
  if (!cur || !canEdit) return;
  if (!armed) {
    armed = true;
    $("del").textContent = "Click again to delete";
    setTimeout(() => { armed = false; $("del").textContent = "Delete"; }, 3000);
    return;
  }
  armed = false;
  $("del").textContent = "Delete";
  
  try { await sb.from("updates").delete().eq("id", cur); } catch(e) { console.error("Supabase delete error:", e); }
  
  items = items.filter(x => x.id !== cur);
  cur = null;
  dirty = true;
  history.replaceState(null, "", location.pathname + location.search);
  await publish();
  open(null);
};
const pres=()=>{document.body.classList.add("present");try{document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen()}catch(e){}};
$("present").onclick=pres;$("present2").onclick=pres;
$("exit").onclick=()=>{document.body.classList.remove("present");try{document.fullscreenElement&&document.exitFullscreen()}catch(e){}};
document.addEventListener("keydown",e=>{if(e.key==="Escape")document.body.classList.remove("present")});
window.addEventListener("hashchange",()=>{const h=hashId();if(h&&h!==cur&&items.find(x=>x.id===h))open(h)});

// Theme toggle (persists in localStorage)
const THEME_KEY = "team_updates_theme";
let currentTheme = localStorage.getItem(THEME_KEY) || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  const btn = $("theme-toggle");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
  currentTheme = theme;
}

function toggleTheme() {
  applyTheme(currentTheme === "dark" ? "light" : "dark");
}

// Initialize theme
applyTheme(currentTheme);

// Toggle button click
$("theme-toggle").onclick = toggleTheme;

(async () => {
  renderAuthForm();
  const { data: sessionData } = await sb.auth.getSession();
  if (sessionData.session) {
    user = sessionData.session.user;
    canEdit = !!user;
  }
  updateAuthUI();
  maybeAddLogoutBtn();

  loadPastedImages();
  await loadItems();

  if (items.find(x => x.id === h0)) {
    open(h0);
    if (!user && h0) pres();
  } else {
    open(items[0] ? items[0].id : null);
  }

  // Paste screenshot into editor
  $("src").addEventListener("paste", pasteImage);

  setStatus("Ready");
  paint();
})();
