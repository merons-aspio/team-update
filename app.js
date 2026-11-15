const SRC="<!DOCTYPE html>\n"+document.documentElement.outerHTML;
const $=id=>document.getElementById(id);
let cur = null, dirty = false;
let items = [];
let pastedImages = {}; // key -> dataUrl map for pasted screenshots
let imageCounter = 0;
let expandedEmbeds = new Set(); // keys of HTML previews expanded in this session
let collapsedEmbeds = new Set(); // keys explicitly collapsed while the default is open
let embedUid = 0;
let paintTimer = null;

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
    if (isEditor) {
      loginBtn.style.display = "none";
      editorEl.classList.remove("viewer");
      editorEl.classList.add("editor");
    } else {
      // Logged in but viewing: show an "Edit" button to switch into editor mode
      loginBtn.style.display = "inline-block";
      loginBtn.textContent = "Edit";
      editorEl.classList.remove("editor");
      editorEl.classList.add("viewer");
      $("exit").style.display = "none";
    }
  } else {
    loginBtn.style.display = "inline-block";
    loginBtn.textContent = "Login";
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

// Debounced save so rapid checklist clicks don't hammer Supabase
let publishTimer = null;
function schedulePublish() {
  clearTimeout(publishTimer);
  setStatus("Saving…");
  publishTimer = setTimeout(() => { publishTimer = null; publish(); }, 400);
}

// Toggle a checklist item directly in view mode (logged-in users only) and auto-save
function handleViewClick(e) {
  if (!user) return;
  const cb = e.target.closest("input[type=checkbox]");
  if (!cb) return;
  // Note: do NOT call e.preventDefault() here. Chrome toggles the checkbox before
  // dispatching click, then reverts it (canceled activation) when default is
  // prevented — which would undo the state we set below.
  const src = $("src");
  const all = Array.from($("view").querySelectorAll("input[type=checkbox]"));
  const idx = all.indexOf(cb);
  if (idx < 0) return;
  const lines = src.value.split("\n");
  const idxs = taskLineIndexes(src.value);
  if (idx >= idxs.length) return;
  const li = idxs[idx];
  const wasChecked = taskLineChecked(lines[li]);
  lines[li] = lines[li].replace(/\[[ xX]?\]/, wasChecked ? "[ ]" : "[x]");
  src.value = lines.join("\n");
  if (cur) {
    const it = items.find(x => x.id === cur);
    if (it) it.raw = src.value;
  }
  // Instant visual feedback: no full re-render, no flicker/scroll jump
  cb.checked = taskLineChecked(lines[li]);
  const cbLi = cb.closest("li");
  if (cbLi) cbLi.classList.toggle("done", cb.checked);
  const st = checklistStats(src.value);
  if (st.total) {
    const pct = Math.round(st.done/st.total*100);
    const prog = $("view").querySelector(".checklist-progress");
    const head = prog && prog.querySelector(".cp-head b");
    if (head) head.textContent = `${st.done} of ${st.total} done · ${pct}%`;
    const bar = prog && prog.querySelector(".cp-bar i");
    if (bar) bar.style.width = pct + "%";
  }
  touch();
  schedulePublish();
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

// ---- Embedded HTML previews -------------------------------------------------
// Fenced ```html / ```htm blocks become collapsible live previews. A complete
// HTML document pasted as the whole update is shown the same way.
const HTML_FENCE_RE=/^[ \t]*```(?:html|htm)[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gim;

// Per-update preference. The marker means every HTML preview in this update
// opens by default. It lives in the raw text so shared links keep the author's
// choice without a database change, and it is stripped before render. Detect it
// anywhere so typing below the marker (or moving it) never loses the setting.
const EMBED_OPEN_RE=/<!--\s*tu-html-open\s*-->/i;
const hasEmbedOpen=raw=>EMBED_OPEN_RE.test(raw||"");
const stripEmbedOpen=raw=>{
  const src=raw||"";
  if(!hasEmbedOpen(src))return src;
  return src
    .replace(/[ \t]*<!--\s*tu-html-open\s*-->[ \t]*/ig,"")
    .replace(/[ \t]+\n/g,"\n")
    .replace(/\n{3,}/g,"\n\n")
    .replace(/^\n+|\n+$/g,"");
};
function setEmbedOpen(raw,open){
  const base=stripEmbedOpen(raw);
  return open?(base?base+"\n\n":"")+"<!-- tu-html-open -->":base;
}

function isFullHtmlDoc(text){
  const s=(text||"").replace(/^\uFEFF/,"").trimStart().replace(/^(?:<!--[\s\S]*?-->\s*)+/,"");
  return /^<!doctype\s+html/i.test(s)||/^<html[\s>]/i.test(s);
}

function htmlTitle(code){
  try{
    const d=new DOMParser().parseFromString(code,"text/html");
    const t=((d.title||"").trim()||((d.querySelector("h1")||{}).textContent||"").trim()).replace(/\s+/g," ");
    return t.slice(0,80);
  }catch(_){return""}
}

function extractHtmlEmbeds(raw){
  const embeds=[];
  const markdown=(raw||"").replace(HTML_FENCE_RE,(m,code)=>{
    embeds.push(code.replace(/\s+$/,""));
    return `\n\n<div class="html-embed-slot" data-embed-index="${embeds.length-1}"></div>\n\n`;
  });
  return {markdown,embeds};
}

function embedResizeScript(key){
  return `<script>(function(){var key=${JSON.stringify(key)};var last=-1;function send(){var b=document.body;if(!b)return;var cs=getComputedStyle(b),r=b.getBoundingClientRect();var h=Math.max(b.scrollHeight,b.offsetHeight,Math.ceil(r.height+(parseFloat(cs.marginTop)||0)+(parseFloat(cs.marginBottom)||0)));if(Math.abs(h-last)>1){last=h;try{parent.postMessage({type:"tu-embed-height",key:key,height:h},"*")}catch(e){}}}function boot(){send();if(window.ResizeObserver){new ResizeObserver(send).observe(document.body)}else{setInterval(send,1000)}addEventListener("load",send)}if(document.readyState==="loading"){addEventListener("DOMContentLoaded",boot)}else{boot()}})();<\/script>`;
}

function buildEmbedDocument(code,key){
  const resize=embedResizeScript(key);
  // Override any inner container max-width so full-page previews use the full iframe width.
  const fullWidthOverride="<style>\n    .wrap,.container,.content,.main,.page,.layout,.inner{max-width:none!important;width:100%!important;margin-left:0!important;margin-right:0!important}\n    @media print{.wrap,.container,.content,.main,.page,.layout,.inner{max-width:none!important;width:100%!important}}\n  </style>";
  if(isFullHtmlDoc(code)){
    // Inject override CSS into the document head before the closing </head>
    const injected=code.replace(/<\/head>/i,fullWidthOverride+"</head>");
    return (injected===code?code+fullWidthOverride:injected)+resize;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}body{padding:16px;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1c1b19;background:#fff}img,video,canvas,svg{max-width:100%}table{max-width:100%}</style>` + fullWidthOverride + `</head><body>` + code + resize + `</body></html>`;
}

function buildEmbedFrame(embed){
  const frame=document.createElement("iframe");
  frame.className="html-embed-iframe";
  frame.title=embed.title||"HTML preview";
  frame.setAttribute("sandbox","allow-scripts allow-forms allow-popups");
  frame.setAttribute("referrerpolicy","no-referrer");
  frame.dataset.embedKey=embed.key;
  frame.srcdoc=buildEmbedDocument(embed.code,embed.key);
  return frame;
}

function mountHtmlEmbeds(container,embeds,defaultOpen=false){
  const map=new Map(embeds.map(e=>[e.key,e]));
  container.querySelectorAll(".html-embed-slot").forEach(slot=>{
    const embed=map.get(slot.getAttribute("data-embed-key"));
    if(!embed)return;

    const panel=document.createElement("div");
    panel.className="html-embed"+(embed.full?" full":"");
    panel.dataset.embedKey=embed.key;

    const header=document.createElement("button");
    header.type="button";
    header.className="html-embed-toggle";
    header.setAttribute("aria-expanded","false");
    const chev=document.createElement("span");
    chev.className="chev";
    chev.setAttribute("aria-hidden","true");
    const label=document.createElement("span");
    label.className="he-label";
    label.textContent=embed.title||(embed.full?"HTML page":"HTML preview");
    const badge=document.createElement("span");
    badge.className="he-badge";
    badge.textContent="HTML";
    header.append(chev,label,badge);

    const body=document.createElement("div");
    body.className="html-embed-body";
    body.hidden=true;
    body.id="html-embed-body-"+(++embedUid);
    header.setAttribute("aria-controls",body.id);

    const setOpen=open=>{
      if(open){
        expandedEmbeds.add(embed.key);
        collapsedEmbeds.delete(embed.key);
        panel.classList.add("open");
        header.setAttribute("aria-expanded","true");
        body.hidden=false;
        if(!body.firstChild)body.appendChild(buildEmbedFrame(embed));
      }else{
        expandedEmbeds.delete(embed.key);
        collapsedEmbeds.add(embed.key);
        panel.classList.remove("open");
        header.setAttribute("aria-expanded","false");
        body.hidden=true;
        body.replaceChildren();
      }
    };
    header.addEventListener("click",()=>setOpen(!panel.classList.contains("open")));

    panel.append(header,body);
    slot.replaceWith(panel);
    if(expandedEmbeds.has(embed.key)||(defaultOpen&&!collapsedEmbeds.has(embed.key)))setOpen(true);
  });
}

window.addEventListener("message",e=>{
  const d=e.data;
  if(!d||d.type!=="tu-embed-height")return;
  const frames=document.querySelectorAll("iframe.html-embed-iframe");
  for(const frame of frames){
    if(frame.contentWindow!==e.source)continue;
    const h=Math.max(160,Math.min(20000,Number(d.height)||0));
    if(h)frame.style.height=h+"px";
    break;
  }
});

const EMO=/^\p{Extended_Pictographic}/u;
const isBul=l=>/^\s*[•▸▪◦\-\*]\s+/.test(l);
function normalize(raw){
  let L=raw.replace(/\r/g,"").split("\n").map(l=>l.replace(/\s+$/,""));
  const out=[];let first=true,inFence=false;
  const nxt=i=>{for(let j=i+1;j<L.length;j++){if(L[j].trim())return L[j]}return""};
  for(let i=0;i<L.length;i++){
    let l=L[i],t=l.trim();
    if(!t){out.push("");continue}
    // Never auto-format inside fenced code blocks.
    if(inFence){out.push(l);if(/^```/.test(t))inFence=false;continue}
    if(/^```/.test(t)){out.push(l);inFence=true;continue}
    // HTML embed placeholders and raw HTML lines must be left exactly as-is.
    if(/^<div[^>]*data-embed-index=/i.test(t)){out.push(l);continue}
    if(/^<[a-z!/]/i.test(t)){out.push(l);continue}
    if(/^(#{1,6}\s|---|\||>|!\[)/.test(t)||/^\d+\.\s/.test(t)){out.push(l);if(first&&/^#/.test(t))first=false;continue}
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
  const embeds=[];
  // A whole pasted HTML document owns the update; no Markdown wrapper around it.
  if(isFullHtmlDoc(raw.trim())){
    const code=raw.trim();
    const embed={key:"html-page",code,title:htmlTitle(code)||"HTML page",full:true};
    embeds.push(embed);
    return {html:`<div class="html-embed-slot" data-embed-key="${embed.key}"></div>`,embeds,fullPage:true};
  }
  const extracted=extractHtmlEmbeds(raw);
  extracted.embeds.forEach((code,i)=>{
    embeds.push({key:"html-"+i,code,title:htmlTitle(code)||"HTML preview",full:false});
  });
  const html=DOMPurify.sanitize(marked.parse(normalize(extracted.markdown),{breaks:true,gfm:true}));
  const box=document.createElement("div");box.innerHTML=html;
  // Attach the stable key each slot needs to restore its expanded/collapsed state.
  box.querySelectorAll(".html-embed-slot").forEach(slot=>{
    const i=Number(slot.getAttribute("data-embed-index"));
    const embed=embeds[i];
    if(embed)slot.setAttribute("data-embed-key",embed.key);
  });
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
  // Checklist interactivity: logged-in users can toggle checkboxes in view mode
  const boxes=box.querySelectorAll("input[type=checkbox]");
  boxes.forEach(cb=>{
    cb.disabled=!user;
    if(cb.checked){const li=cb.closest("li");if(li)li.classList.add("done");}
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
  return {html:frag.innerHTML,embeds,fullPage:false};
}
function titleOf(raw){
  const t=stripEmbedOpen(raw).trim();
  if(isFullHtmlDoc(t))return htmlTitle(t)||"HTML update";
  const first=t.split("\n").find(l=>l.trim());
  if(first&&/^```(?:html|htm)\b/i.test(first.trim())){
    const ex=extractHtmlEmbeds(t);
    return htmlTitle(ex.embeds[0]||"")||"HTML update";
  }
  const f=t.split("\n").find(l=>l.trim())||"Untitled";
  return f.replace(/^#+\s*/,"").slice(0,70);
}
// Older saves stored the raw first line as the sidebar title, which for a
// pasted HTML page is "<!DOCTYPE html>". Show a sensible title instead.
function displayTitle(it){
  if(it.custom)return it.custom;
  const stored=(it.title||"").trim();
  if(!stored||/^<!doctype\s+html/i.test(stored)||/^<html[\s>]/i.test(stored)||/^```/.test(stored)){
    return titleOf(it.raw||"")||stored||"Untitled";
  }
  return stored;
}

// Tasklist lines in raw markdown. Must mirror what normalize()+marked render:
// Unicode bullets become "- " bullets, and marked also accepts "*", "+", ordered
// lists and blockquotes. Fenced code blocks are skipped so indexes stay aligned
// with the rendered checkboxes.
const TASK_LINE_RE=/^(\s*(?:>\s*)*(?:[•▸▪◦+\-*]|\d+\.)\s+)\[([ xX]?)\]\s/;
function taskLineIndexes(raw){
  const lines=(raw||"").split("\n");
  const out=[];let inFence=false;
  for(let i=0;i<lines.length;i++){
    if(/^\s*```/.test(lines[i])){inFence=!inFence;continue;}
    if(!inFence&&TASK_LINE_RE.test(lines[i]))out.push(i);
  }
  return out;
}
function taskLineChecked(line){
  const m=line.match(TASK_LINE_RE);
  return !!m&&m[2].toLowerCase()==="x";
}
function checklistStats(raw){
  const lines=(raw||"").split("\n");
  let total=0,done=0;
  for(const i of taskLineIndexes(raw)){
    total++;
    if(taskLineChecked(lines[i]))done++;
  }
  return {total,done};
}
function progressHTML(done,total){
  if(!total)return "";
  const pct=Math.round(done/total*100);
  return `<div class="checklist-progress"><div class="cp-head"><span>Checklist progress</span><b>${done} of ${total} done · ${pct}%</b></div><div class="cp-bar"><i style="width:${pct}%"></i></div></div>`;
}
function paint(){
  const raw=$("src").value,openByDefault=hasEmbedOpen(raw);
  const v=stripEmbedOpen(raw).trim(),it=items.find(x=>x.id===cur);
  const embedRow=$("embed-default-row");
  if(!v){
    embedRow.hidden=true;
    $("embed-open").checked=false;
    $("view").innerHTML='<div class="empty">'+(canEdit?"Paste an update on the left.<br>The formatted version appears here.":"Open the link you were sent to see an update.")+'</div>';
    return;
  }
  const d=it&&it.at?new Date(it.at).toLocaleDateString(undefined,{day:"numeric",month:"long",year:"numeric"}):"";
  const tp=$("type").value;
  const st=checklistStats(v);
  const out=render(v);
  const kicker=`<span class="tag ${tp} kicker">${tp} update${d?" · "+d:""}</span>`;
  $("view").innerHTML=(out.fullPage?"":kicker+progressHTML(st.done,st.total))+out.html;
  mountHtmlEmbeds($("view"),out.embeds,openByDefault);
  const hasEmbeds=out.embeds.length>0;
  embedRow.hidden=!hasEmbeds;
  $("embed-open").checked=hasEmbeds&&openByDefault;
}
function renderList(){
  const l=$("list");l.innerHTML="";
  if(!items.length){l.innerHTML='<p class="hint" style="margin:8px">No updates yet.</p>';return}
  items.forEach(it=>{const b=document.createElement("button");b.className="item"+(cur===it.id?" on":"");
    const d=new Date(it.at).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});
    b.innerHTML=`<b></b><small><span class="tag ${it.type}">${it.type}</span>${d}</small>`;
    b.querySelector("b").textContent=displayTitle(it);
    b.onclick=()=>{location.hash=it.id;open(it.id)};
    l.appendChild(b)})
}
function open(id){
  clearTimeout(paintTimer);paintTimer=null;expandedEmbeds.clear();collapsedEmbeds.clear();
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
function schedulePaint(){
  clearTimeout(paintTimer);
  paintTimer=setTimeout(()=>{paintTimer=null;paint()},160);
}
function queueSave(){if(canEdit)touch();schedulePaint()}
async function publish() {
  if (!canEdit) return false;
  if (publishTimer) { clearTimeout(publishTimer); publishTimer = null; }
  // Only touch when an item is selected; touch() would otherwise create a new
  // record from leftover textarea content (e.g. right after a delete).
  if (cur && $("src").value.trim()) touch();
  
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
$("embed-open").addEventListener("change",()=>{
  const open=$("embed-open").checked;
  $("src").value=setEmbedOpen($("src").value,open);
  expandedEmbeds.clear();collapsedEmbeds.clear();
  queueSave();
});
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

  const targetId = cur;
  try {
    const { error } = await sb.from("updates").delete().eq("id", targetId);
    if (error) throw error;
  } catch(e) {
    console.error("Supabase delete error:", e);
    setStatus("Delete failed");
    return;
  }

  items = items.filter(x => x.id !== targetId);
  try { localStorage.setItem("team_updates", JSON.stringify(items)); } catch(_) {}
  cur = null;
  dirty = false;
  history.replaceState(null, "", location.pathname + location.search);
  open(null);
  setStatus("Deleted");
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

  // Checklist toggling in view mode (event delegation survives innerHTML re-renders)
  $("view").addEventListener("click", handleViewClick);

  setStatus("Ready");
  paint();
})();
