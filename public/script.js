
// ─── API helper — all requests go through /api/* ──────────────────────────────
let TOKEN = localStorage.getItem("nx_token") || "";

async function api(method, path, body, isFormData) {
  const opts = {
    method,
    headers: { "Authorization": `Bearer ${TOKEN}` }
  };
  if (body && !isFormData) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  } else if (isFormData) {
    opts.body = body; // FormData — let browser set Content-Type
  }
  const res = await fetch(path, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ─── State ────────────────────────────────────────────────────────────────────
let projects = [], projectRoles = [], applications = [], selectedFile = null;
let monthlyChart, completionChart;

// ─── UI helpers ───────────────────────────────────────────────────────────────
function showPopup(msg) { document.getElementById("popupMessage").innerText = msg; document.getElementById("successPopup").classList.add("open"); }
function closePopup()   { document.getElementById("successPopup").classList.remove("open"); }
function esc(s) { if (!s) return ""; return String(s).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }

// ─── Hamburger ────────────────────────────────────────────────────────────────
const hamburgerBtn = document.getElementById("hamburgerBtn");
const sidebar      = document.getElementById("sidebar");
const overlay      = document.getElementById("sidebarOverlay");
function openSidebar()  { sidebar.classList.add("open"); overlay.classList.add("open"); hamburgerBtn.classList.add("open"); }
function closeSidebar() { sidebar.classList.remove("open"); overlay.classList.remove("open"); hamburgerBtn.classList.remove("open"); }
hamburgerBtn.addEventListener("click", () => sidebar.classList.contains("open") ? closeSidebar() : openSidebar());

// ─── Auth ─────────────────────────────────────────────────────────────────────
document.getElementById("loginBtn").addEventListener("click", async () => {
  const email = document.getElementById("loginEmail").value.trim();
  const pass  = document.getElementById("loginPassword").value;
  const btn   = document.getElementById("loginBtn");
  const errEl = document.getElementById("loginError");
  errEl.style.display = "none";
  if (!email || !pass) { errEl.innerText = "Email and password required."; errEl.style.display = "flex"; return; }
  btn.disabled = true; btn.innerText = "Signing in…";
  try {
    const { token, admin } = await api("POST", "/api/auth/login", { email, password: pass });
    TOKEN = token;
    localStorage.setItem("nx_token", token);
    localStorage.setItem("nx_admin", JSON.stringify(admin));
    showAdminPanel(admin);
  } catch (e) {
    errEl.innerText = e.message || "Invalid credentials."; errEl.style.display = "flex";
  }
  btn.disabled = false; btn.innerText = "Sign In to Console";
});
["loginEmail","loginPassword"].forEach(id =>
  document.getElementById(id).addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("loginBtn").click(); })
);

function showAdminPanel(admin) {
  document.getElementById("loginPage").style.display = "none";
  document.getElementById("adminApp").style.display  = "block";
  if (admin) {
    document.getElementById("sidebarName").innerText   = admin.name || "Administrator";
    document.getElementById("sidebarRole").innerText   = admin.role || "Admin";
    document.getElementById("sidebarAvatar").innerText = (admin.name || "A")[0].toUpperCase();
  }
  loadAllData();
}

async function logout() {
  try { await api("POST", "/api/auth/logout"); } catch(_) {}
  TOKEN = "";
  localStorage.removeItem("nx_token");
  localStorage.removeItem("nx_admin");
  document.getElementById("adminApp").style.display  = "none";
  document.getElementById("loginPage").style.display = "flex";
  closeSidebar();
}
document.getElementById("logoutBtn").addEventListener("click", logout);

// Auto-login from saved token
(async () => {
  const saved = localStorage.getItem("nx_token");
  const admin = JSON.parse(localStorage.getItem("nx_admin") || "null");
  if (saved) {
    TOKEN = saved;
    try { await api("GET", "/api/auth/me"); showAdminPanel(admin); }
    catch (_) { localStorage.removeItem("nx_token"); localStorage.removeItem("nx_admin"); }
  }
})();

// ─── Data loading ─────────────────────────────────────────────────────────────
async function loadProjects()     { try { projects      = await api("GET","/api/projects"); } catch(e) { console.error(e); } renderProjectsTable(); updateStats(); updateCharts(); }
async function loadRoles()        { try { projectRoles  = await api("GET","/api/roles");    } catch(e) { console.error(e); } renderRolesTable(); populateProjectSelect(); }
async function loadApplications() { try { applications  = await api("GET","/api/users");    } catch(e) { console.error(e); } renderApplicationsTable(); updateStats(); }
async function loadAllData()      { await loadProjects(); await loadRoles(); await loadApplications(); }

// ─── Render: Projects ─────────────────────────────────────────────────────────
function renderProjectsTable() {
  const dt = document.getElementById("projectsTable"), mob = document.getElementById("projectsMobile");
  if (!dt || !mob) return;
  if (!projects.length) { dt.innerHTML = '<div class="empty">No projects yet.</div>'; mob.innerHTML = '<div class="empty">No projects yet.</div>'; return; }

  let h = `<table class="tbl"><thead><tr><th>Image</th><th>Project</th><th>Progress</th><th>Status</th><th>Purpose</th><th>Document</th><th>Actions</th></tr></thead><tbody>`;
  projects.forEach(p => {
    h += `<tr>
      <td><img class="proj-img" src="${esc(p.image_url||"https://placehold.co/44x32/13141f/white?text=img")}" onerror="this.src='https://placehold.co/44x32/13141f/white?text=img'"></td>
      <td><strong>${esc(p.title)}</strong><br><span style="font-size:0.71rem;color:var(--text-3);">${esc(p.category)}</span></td>
      <td><div class="prog-bar"><div class="prog-track"><div class="prog-fill" style="width:${p.completion}%"></div></div><div class="prog-label">${p.completion}%</div></div></td>
      <td><span class="badge ${p.status==="Paid"?"badge-paid":"badge-unpaid"}">${esc(p.status)||"Unpaid"}</span></td>
      <td><span class="badge ${p.purpose==="Client"?"badge-client":"badge-practice"}">${esc(p.purpose)||"Practice"}</span></td>
      <td>${p.doc_url?`<a href="${p.doc_url}" target="_blank" class="doc-link">📄 View</a>`:'<span style="color:var(--text-3);">—</span>'}</td>
      <td style="white-space:nowrap;"><button class="action-btn btn-edit" onclick="openUpdateModal(${p.id})">Edit</button> <button class="action-btn btn-del" onclick="deleteProject(${p.id})">Delete</button></td>
    </tr>`;
  });
  dt.innerHTML = h + "</tbody></table>";

  let mh = "";
  projects.forEach(p => { mh += `<div class="mc"><div class="mc-header"><div><div class="mc-title">${esc(p.title)}</div><div class="mc-sub">${esc(p.category||"—")}</div></div><div class="mc-badges"><span class="badge ${p.status==="Paid"?"badge-paid":"badge-unpaid"}">${esc(p.status)||"Unpaid"}</span><span class="badge ${p.purpose==="Client"?"badge-client":"badge-practice"}">${esc(p.purpose)||"Practice"}</span></div></div><div class="mc-body"><div class="mc-field"><div class="mc-field-label">Progress</div><div><div class="prog-track" style="width:100%;margin-bottom:3px;"><div class="prog-fill" style="width:${p.completion}%"></div></div><div class="prog-label">${p.completion}%</div></div></div><div class="mc-field"><div class="mc-field-label">Document</div><div class="mc-field-val">${p.doc_url?`<a href="${p.doc_url}" target="_blank" class="doc-link">📄 View</a>`:"—"}</div></div></div><div class="mc-footer"><div class="mc-actions"><button class="action-btn btn-edit" onclick="openUpdateModal(${p.id})">Edit</button><button class="action-btn btn-del" onclick="deleteProject(${p.id})">Delete</button></div></div></div>`; });
  mob.innerHTML = mh;
}

// ─── Render: Roles ────────────────────────────────────────────────────────────
function renderRolesTable() {
  const dt = document.getElementById("rolesTable"), mob = document.getElementById("rolesMobile");
  if (!dt || !mob) return;
  if (!projectRoles.length) { dt.innerHTML = '<div class="empty">No roles yet.</div>'; mob.innerHTML = '<div class="empty">No roles yet.</div>'; return; }

  let h = `<table class="tbl"><thead><tr><th>Role</th><th>Project</th><th>Category</th><th>Skills</th><th>Priority</th><th>Created</th><th>Actions</th></tr></thead><tbody>`;
  projectRoles.forEach(r => {
    const proj = projects.find(p => p.id === r.project_id);
    const pri  = (r.priority || "Medium").toLowerCase();
    h += `<tr><td><strong>${esc(r.role_title)}</strong></td><td style="color:var(--text-2);">${esc(proj?proj.title:"Unknown")}</td><td><span class="badge badge-cat">${esc(r.category)}</span></td><td style="color:var(--text-3);font-size:0.76rem;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.skills||"—")}</td><td><span class="badge badge-${pri}">${r.priority||"Medium"}</span></td><td style="color:var(--text-3);font-size:0.76rem;">${r.created_at?r.created_at.slice(0,10):"—"}</td><td style="white-space:nowrap;"><button class="action-btn btn-edit" onclick="openEditRoleModal(${r.id})">Edit</button> <button class="action-btn btn-del" onclick="deleteRole(${r.id})">Delete</button></td></tr>`;
  });
  dt.innerHTML = h + "</tbody></table>";

  let mh = "";
  projectRoles.forEach(r => {
    const proj = projects.find(p => p.id === r.project_id);
    const pri  = (r.priority || "Medium").toLowerCase();
    mh += `<div class="mc"><div class="mc-header"><div><div class="mc-title">${esc(r.role_title)}</div><div class="mc-sub">${esc(proj?proj.title:"Unknown")}</div></div><div class="mc-badges"><span class="badge badge-cat">${esc(r.category)}</span><span class="badge badge-${pri}">${r.priority||"Medium"}</span></div></div><div class="mc-body"><div class="mc-field"><div class="mc-field-label">Skills</div><div class="mc-field-val" style="font-size:0.75rem;">${esc(r.skills||"—")}</div></div><div class="mc-field"><div class="mc-field-label">Created</div><div class="mc-field-val">${r.created_at?r.created_at.slice(0,10):"—"}</div></div></div><div class="mc-footer"><div class="mc-actions"><button class="action-btn btn-edit" onclick="openEditRoleModal(${r.id})">Edit</button><button class="action-btn btn-del" onclick="deleteRole(${r.id})">Delete</button></div></div></div>`;
  });
  mob.innerHTML = mh;
}

// ─── Render: Users ────────────────────────────────────────────────────────────
function renderApplicationsTable() {
  const dt = document.getElementById("applicationsTable"), mob = document.getElementById("applicationsMobile");
  if (!dt || !mob) return;
  if (!applications.length) { dt.innerHTML = '<div class="empty">No users yet.</div>'; mob.innerHTML = '<div class="empty">No users yet.</div>'; return; }

  let h = `<table class="tbl"><thead><tr><th>User</th><th>Email</th><th>Phone</th><th>CV</th><th>Joined</th></tr></thead><tbody>`;
  applications.forEach(u => {
    const initials = (u.display_name||u.email||"?").slice(0,2).toUpperCase();
    const joined   = u.created_at ? new Date(u.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";
    h += `<tr><td><span class="user-avatar">${initials}</span><strong>${esc(u.display_name||"—")}</strong></td><td style="color:var(--text-2);font-size:0.8rem;">${esc(u.email)}</td><td style="color:var(--text-3);font-size:0.8rem;">${esc(u.phone||"—")}</td><td>${u.cv_link?`<a href="${u.cv_link}" target="_blank" class="cv-btn">📄 View CV</a>`:'<span style="color:var(--text-3)">—</span>'}</td><td style="color:var(--text-3);font-size:0.76rem;">${joined}</td></tr>`;
  });
  dt.innerHTML = h + "</tbody></table>";

  let mh = "";
  applications.forEach(u => {
    const initials = (u.display_name||u.email||"?").slice(0,2).toUpperCase();
    const joined   = u.created_at ? new Date(u.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";
    mh += `<div class="mc"><div class="mc-header"><div style="display:flex;align-items:center;gap:0.75rem;"><span class="user-avatar">${initials}</span><div><div class="mc-title">${esc(u.display_name||"—")}</div><div class="mc-sub">${esc(u.email)}</div></div></div>${u.cv_link?`<a href="${u.cv_link}" target="_blank" class="cv-btn">📄 CV</a>`:""}</div><div class="mc-body"><div class="mc-field"><div class="mc-field-label">Phone</div><div class="mc-field-val">${esc(u.phone||"—")}</div></div><div class="mc-field"><div class="mc-field-label">Joined</div><div class="mc-field-val">${joined}</div></div></div></div>`;
  });
  mob.innerHTML = mh;
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function updateStats() {
  ["statProjects","dashProjectCount"].forEach(id => document.getElementById(id).innerText = projects.length);
  ["statJobs","dashJobCount"].forEach(id => document.getElementById(id).innerText = projectRoles.length);
  ["statApplications","dashAppCount"].forEach(id => document.getElementById(id).innerText = applications.length);
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function updateCharts() {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const counts = new Array(12).fill(0);
  projects.forEach(p => { if (p.created_at) { const m = new Date(p.created_at).getMonth(); if (!isNaN(m)) counts[m]++; } });
  const gc = "rgba(255,255,255,0.05)", tc = "rgba(148,148,168,0.7)";
  const c1 = document.getElementById("monthlyChart")?.getContext("2d");
  if (c1) { if (monthlyChart) monthlyChart.destroy(); monthlyChart = new Chart(c1,{type:"bar",data:{labels:months,datasets:[{label:"Projects",data:counts,backgroundColor:"rgba(124,92,252,0.2)",borderColor:"rgba(124,92,252,0.8)",borderWidth:1.5,borderRadius:5,hoverBackgroundColor:"rgba(255,77,141,0.3)"}]},options:{plugins:{legend:{display:false}},scales:{x:{grid:{color:gc},ticks:{color:tc,font:{size:11}}},y:{grid:{color:gc},ticks:{color:tc,stepSize:1,font:{size:11}}}}}}); }
  const done = projects.filter(p=>p.completion>=80).length, going = projects.filter(p=>p.completion<80&&p.completion>20).length, start = projects.filter(p=>p.completion<=20).length;
  const c2 = document.getElementById("completionChart")?.getContext("2d");
  if (c2) { if (completionChart) completionChart.destroy(); completionChart = new Chart(c2,{type:"doughnut",data:{labels:["Advanced (80%+)","In Progress","Starting"],datasets:[{data:[done,going,start],backgroundColor:["rgba(124,92,252,0.8)","rgba(255,77,141,0.8)","rgba(34,211,238,0.8)"],borderColor:"rgba(8,9,14,0.8)",borderWidth:3,hoverOffset:4}]},options:{plugins:{legend:{labels:{color:"rgba(148,148,168,0.9)",padding:16,font:{size:11}}}},cutout:"68%"}}); }
}

// ─── Project select ───────────────────────────────────────────────────────────
function populateProjectSelect() {
  const sel = document.getElementById("projectSelect"); if (!sel) return;
  sel.innerHTML = '<option value="">-- Select Project --</option>';
  projects.forEach(p => { sel.innerHTML += `<option value="${p.id}">${esc(p.title)} (${p.completion}%)</option>`; });
}
document.getElementById("projectSelect")?.addEventListener("change", function() {
  const proj = projects.find(p => p.id === parseInt(this.value));
  const pv   = document.getElementById("selectedProjectPreview");
  if (proj) { document.getElementById("previewProjectName").innerText = proj.title; document.getElementById("previewProjectCompletion").innerText = proj.completion+"% complete"; pv.style.display="flex"; }
  else pv.style.display = "none";
});

// ─── Delete / Edit Projects ───────────────────────────────────────────────────
window.deleteProject = async id => {
  if (!confirm("Delete project?")) return;
  try { await api("DELETE", `/api/projects/${id}`); await loadAllData(); showPopup("Project deleted."); } catch(e) { alert(e.message); }
};
window.openUpdateModal = id => {
  const p = projects.find(x => x.id === id); if (!p) return;
  document.getElementById("updateProjectId").value = p.id;
  document.getElementById("updateProjName").value  = p.title;
  document.getElementById("updateProjCategory").value = p.category||"";
  document.getElementById("updateProjRange").value = p.completion;
  document.getElementById("updateProjNumber").value = p.completion;
  document.getElementById("updateProjStatus").value = p.status||"Unpaid";
  document.getElementById("updateProjPurpose").value = p.purpose||"Practice";
  document.getElementById("updateProjDesc").value  = p.description||"";
  document.getElementById("updateProjImage").value = p.image_url||"";
  document.getElementById("updateModal").classList.add("open");
};
window.saveProjectUpdate = async () => {
  const id = parseInt(document.getElementById("updateProjectId").value);
  try {
    await api("PATCH", `/api/projects/${id}`, {
      title:       document.getElementById("updateProjName").value,
      category:    document.getElementById("updateProjCategory").value,
      completion:  parseInt(document.getElementById("updateProjNumber").value)||0,
      status:      document.getElementById("updateProjStatus").value,
      purpose:     document.getElementById("updateProjPurpose").value,
      description: document.getElementById("updateProjDesc").value,
      image_url:   document.getElementById("updateProjImage").value
    });
    await loadAllData(); closeUpdateModal(); showPopup("Project updated!");
  } catch(e) { alert(e.message); }
};
window.closeUpdateModal = () => document.getElementById("updateModal").classList.remove("open");

// ─── Delete / Edit Roles ──────────────────────────────────────────────────────
window.deleteRole = async id => {
  if (!confirm("Delete this role?")) return;
  try { await api("DELETE", `/api/roles/${id}`); await loadAllData(); showPopup("Role deleted."); } catch(e) { alert(e.message); }
};
window.openEditRoleModal = id => {
  const r = projectRoles.find(x => x.id === id); if (!r) return;
  document.getElementById("editRoleId").value       = r.id;
  document.getElementById("editRoleTitle").value    = r.role_title;
  document.getElementById("editRoleCategory").value = r.category||"Frontend";
  document.getElementById("editRoleDesc").value     = r.description||"";
  document.getElementById("editRoleSkills").value   = r.skills||"";
  document.getElementById("editRolePriority").value = r.priority||"Medium";
  document.getElementById("editRoleModal").classList.add("open");
};
window.saveRoleUpdate = async () => {
  const id = parseInt(document.getElementById("editRoleId").value);
  try {
    await api("PATCH", `/api/roles/${id}`, {
      role_title:  document.getElementById("editRoleTitle").value,
      category:    document.getElementById("editRoleCategory").value,
      description: document.getElementById("editRoleDesc").value,
      skills:      document.getElementById("editRoleSkills").value,
      priority:    document.getElementById("editRolePriority").value
    });
    await loadAllData(); closeEditRoleModal(); showPopup("Role updated!");
  } catch(e) { alert(e.message); }
};
window.closeEditRoleModal = () => document.getElementById("editRoleModal").classList.remove("open");

// ─── Create Project ───────────────────────────────────────────────────────────
document.getElementById("createProjectBtn")?.addEventListener("click", async () => {
  const name = document.getElementById("newProjName").value.trim();
  if (!name) { alert("Project name required"); return; }

  let docUrl = document.getElementById("projDocUrl").value;

  // Upload file via server endpoint
  if (selectedFile) {
    document.getElementById("uploadStatus").innerHTML = "⏳ Uploading...";
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      fd.append("folder", "requirements");
      const { url } = await api("POST", "/api/upload", fd, true);
      docUrl = url;
      document.getElementById("uploadStatus").innerHTML = "✅ Uploaded!";
    } catch(e) {
      document.getElementById("uploadStatus").innerHTML = "⚠️ Upload failed: " + e.message;
    }
    setTimeout(() => { document.getElementById("uploadStatus").innerHTML = ""; }, 3000);
  }

  try {
    await api("POST", "/api/projects", {
      title:       name,
      category:    document.getElementById("newProjCategory").value||"General",
      completion:  parseInt(document.getElementById("newProjNumber").value)||0,
      status:      document.getElementById("newProjStatus").value,
      purpose:     document.getElementById("newProjPurpose").value,
      description: document.getElementById("newProjDesc").value,
      image_url:   document.getElementById("newProjImage").value,
      doc_url:     docUrl
    });
    await loadAllData(); resetAddProjectForm(); showPopup("✨ Project created!");
  } catch(e) { alert(e.message); }
});

function resetAddProjectForm() {
  ["newProjName","newProjCategory","newProjDesc","newProjImage","projDocUrl"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("newProjRange").value = 30; document.getElementById("newProjNumber").value = 30;
  document.getElementById("docInfoArea").style.display = "none";
  document.getElementById("docFileInput").value = ""; document.getElementById("uploadStatus").innerHTML = ""; selectedFile = null;
}

// ─── Assign Role ──────────────────────────────────────────────────────────────
document.getElementById("assignJobBtn")?.addEventListener("click", async () => {
  const pid   = parseInt(document.getElementById("projectSelect").value);
  const title = document.getElementById("jobRoleTitle").value.trim();
  if (!pid)   { alert("Select a project"); return; }
  if (!title) { alert("Role name required"); return; }
  try {
    await api("POST", "/api/roles", {
      project_id:  pid,
      role_title:  title,
      category:    document.getElementById("roleCategory").value,
      description: document.getElementById("roleDescription").value,
      skills:      document.getElementById("roleSkills").value,
      priority:    document.getElementById("priorityLevel").value,
      poster_url:  document.getElementById("roleImageUrl").value
    });
    await loadAllData(); resetAssignRoleForm(); showPopup(`✅ Role "${title}" assigned!`);
  } catch(e) { alert(e.message); }
});
function resetAssignRoleForm() {
  ["jobRoleTitle","roleDescription","roleSkills","roleImageUrl"].forEach(id => document.getElementById(id).value = "");
}

// ─── File upload UI ───────────────────────────────────────────────────────────
const docBox = document.getElementById("docUploadBox"), docInput = document.getElementById("docFileInput");
if (docBox)  docBox.onclick = () => docInput.click();
if (docInput) docInput.onchange = e => { const f = e.target.files[0]; if (f) { selectedFile = f; document.getElementById("docFileName").innerText = f.name; document.getElementById("docInfoArea").style.display = "flex"; document.getElementById("projDocUrl").value = ""; } };
const remBtn = document.getElementById("removeDocBtn");
if (remBtn) remBtn.onclick = () => { document.getElementById("docInfoArea").style.display = "none"; document.getElementById("projDocUrl").value = ""; document.getElementById("docFileInput").value = ""; selectedFile = null; };

// ─── Sliders ──────────────────────────────────────────────────────────────────
const nr = document.getElementById("newProjRange"), nn = document.getElementById("newProjNumber");
if (nr && nn) { nr.oninput = () => nn.value = nr.value; nn.oninput = () => nr.value = nn.value; }
const ur = document.getElementById("updateProjRange"), un = document.getElementById("updateProjNumber");
if (ur && un) { ur.oninput = () => un.value = ur.value; un.oninput = () => ur.value = un.value; }

// ─── Clock ────────────────────────────────────────────────────────────────────
function updateClock() { const n = new Date(); document.getElementById("liveClock").textContent = `${n.toLocaleDateString("en-US",{month:"short",day:"numeric"})} · ${n.toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit",hour12:true})}`; }
setInterval(updateClock, 1000); updateClock();

// ─── Nav ──────────────────────────────────────────────────────────────────────
const pageTitles = {dashboard:"Dashboard",projects:"Projects",roles:"All Roles",applications:"Registered Users","add-project":"New Project","assign-role":"Assign Role"};
const pageSubs   = {dashboard:"Overview of your platform",projects:"Manage all projects",roles:"View and manage open roles",applications:"Users who signed up via the app","add-project":"Create a new project","assign-role":"Add a role to a project"};
const panelMap   = {dashboard:"dashboardPanel",projects:"projectsPanel",roles:"rolesPanel",applications:"applicationsPanel","add-project":"addProjectPanel","assign-role":"assignRolePanel"};
document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", () => {
    const tab = item.dataset.tab;
    Object.values(panelMap).forEach(id => document.getElementById(id).classList.remove("active"));
    document.getElementById(panelMap[tab]).classList.add("active");
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    item.classList.add("active");
    document.getElementById("pageTitle").innerText    = pageTitles[tab]||tab;
    document.getElementById("pageSubtitle").innerText = pageSubs[tab]||"";
    if (tab === "dashboard") updateCharts();
    if (tab === "roles") renderRolesTable();
    closeSidebar();
  });
});
