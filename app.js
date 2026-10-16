"use strict";
/* ===== Konfigurasi (anon/publishable key aman dipublikasikan; keamanan ada di RLS) ===== */
const SUPABASE_URL = "https://htwhiqxqtahxtmidzwud.supabase.co";
const SUPABASE_KEY = "sb_publishable_jhuCqHXsUvF-BG5WBBHtMw_xgbxoo_1";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
let me = null, profile = {}, peer = null, channel = null, currentView = "auth";

/* ===== Util ===== */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : ""; }
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2800);
}
function fmt(t) {
  return t ? new Date(t).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
}
function empty(box, text) { box.replaceChildren(el("div", "empty", text)); }
function displayName(p) { return p.full_name || p.username || "Pengguna"; }
function avatar(p, cls = "") {
  const a = el("div", "avatar " + cls);
  const url = safeUrl(p && p.avatar_url);
  if (url) { const i = el("img"); i.src = url; i.alt = ""; a.appendChild(i); }
  else a.textContent = (displayName(p || {})[0] || "?").toUpperCase();
  return a;
}
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); } finally { if (btn) btn.disabled = false; }
}
async function profilesFor(ids) {
  const map = new Map();
  if (!ids.length) return map;
  const { data } = await sb.from("profiles").select("user_id, username, full_name, avatar_url, bio, website, location").in("user_id", [...new Set(ids)]);
  (data || []).forEach((p) => map.set(p.user_id, p));
  return map;
}
async function upload(file, folder) {
  if (!file) return "";
  if (file.size > 5 * 1024 * 1024) throw new Error("Ukuran foto maksimal 5 MB.");
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${me.id}/${folder}-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from("media").upload(path, file, { contentType: file.type });
  if (error) throw error;
  return sb.storage.from("media").getPublicUrl(path).data.publicUrl;
}

/* ===== Navigasi antar halaman ===== */

const VIEWS = [
  "auth",
  "chats",
  "room",
  "status",
  "feed",
  "search",
  "user",
  "profile",
  "settings"
];

const loaders = {
  chats: loadInbox,
  status: loadStatus,
  feed: loadFeed,
  profile: fillProfile
};


/* ===== ANIMASI PEMBUKA BERDASARKAN STATUS LOGIN ===== */
let welcomeIntroPlayed = false;
let welcomeIntroTimer = null;

function playWelcomeIntro() {
  const intro = document.getElementById("welcomeIntro");

  if (!intro || welcomeIntroPlayed) return;

  welcomeIntroPlayed = true;

  if (welcomeIntroTimer) {
    clearTimeout(welcomeIntroTimer);
  }

  intro.classList.add("is-active");

  welcomeIntroTimer = setTimeout(() => {
    intro.classList.remove("is-active");
    welcomeIntroTimer = null;
  }, 3800);
}

function hideWelcomeIntro() {
  const intro = document.getElementById("welcomeIntro");

  if (welcomeIntroTimer) {
    clearTimeout(welcomeIntroTimer);
    welcomeIntroTimer = null;
  }

  if (intro) {
    intro.classList.remove("is-active");
  }
}


function show(v) {
  if (!VIEWS.includes(v)) return;

  currentView = v;

  // Tampilkan halaman yang dipilih dan sembunyikan halaman lain.
  VIEWS.forEach((x) => {
    const section = $("v-" + x);

    if (section) {
      section.classList.toggle("hidden", x !== v);
    }
  });

  // Samakan status aktif menu desktop dan HP.
  const activeTab =
    v === "room" ? "chats" :
    v === "user" ? "search" :
    v;

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.view === activeTab
    );
  });

  // Navigasi bawah disembunyikan saat login atau membuka ruang chat.
  const tabs = $("tabs");

  if (tabs) {
    tabs.classList.toggle(
      "hidden",
      v === "auth" || v === "room"
    );
  }

  // Muat ulang data untuk halaman yang memerlukannya.
  if (loaders[v]) {
    loaders[v]();
  }

  window.scrollTo(0, 0);
}

/* Navigasi sidebar desktop dan menu bawah HP */
document.addEventListener("click", (e) => {
  const button = e.target.closest("[data-view]");

  if (!button) return;

  const isSidebarButton = button.closest("#sidebar");
  const isMobileButton = button.closest("#tabs");

  if (!isSidebarButton && !isMobileButton) return;

  show(button.dataset.view);
});

/* Logo kembali ke Beranda */
const brandHome = $("brandHome");

if (brandHome) {
  brandHome.addEventListener("click", (e) => {
    e.preventDefault();
    show("feed");
  });
}

/* Tombol Pengaturan di header */
const btnOpenSettings = $("btnOpenSettings");

if (btnOpenSettings) {
  btnOpenSettings.addEventListener("click", () => {
    show("settings");
  });
}

/* Tombol Profil di halaman Pengaturan */
const btnSettingsProfile = $("btnSettingsProfile");

if (btnSettingsProfile) {
  btnSettingsProfile.addEventListener("click", () => {
    show("profile");
  });
}


/* ===== Pengaturan tema tampilan ===== */
const THEME_STORAGE_KEY = "ik-theme";

function applyTheme(choice, save = true) {
  const allowed = ["light", "dark", "system"];

  if (!allowed.includes(choice)) {
    choice = "system";
  }

  if (choice === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", choice);
  }

  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    const selected = button.dataset.themeChoice === choice;

    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  if (save) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
    } catch (err) {
      console.warn("Preferensi tema tidak dapat disimpan.", err);
    }
  }
}

/* Pilih tema dari halaman Pengaturan */
document.querySelectorAll("[data-theme-choice]").forEach((button) => {
  button.addEventListener("click", () => {
    applyTheme(button.dataset.themeChoice);
  });
});

/* Pulihkan tema saat halaman dibuka */
let savedTheme = "system";

try {
  savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || "system";
} catch (err) {
  console.warn("Preferensi tema tidak dapat dibaca.", err);
}

applyTheme(savedTheme, false);


/* ===== Autentikasi ===== */
function authMsg(t) { $("authMsg").textContent = t; }
$("btnSignup").onclick = (e) => busy(e.currentTarget, async () => {
  const email = $("email").value.trim(), password = $("password").value;
  if (!email || password.length < 6) return authMsg("Isi email dan password (minimal 6 karakter).");
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) return authMsg("Daftar gagal: " + error.message);
  authMsg(data.session ? "Pendaftaran berhasil." : "Pendaftaran berhasil. Cek email untuk verifikasi.");
});
$("btnLogin").onclick = (e) => busy(e.currentTarget, async () => {
  const email = $("email").value.trim(), password = $("password").value;
  if (!email || !password) return authMsg("Email dan password wajib diisi.");
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) authMsg("Login gagal: " + error.message);
});
$("btnGoogle").onclick = async () => {
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
  if (error) authMsg("Login Google gagal: " + error.message);
};
$("btnLogout").onclick = () => sb.auth.signOut();

/* Satu-satunya titik masuk status login (INITIAL_SESSION ikut ditangani di sini) */
sb.auth.onAuthStateChange((_evt, session) => setTimeout(() => handleSession(session), 0));
async function handleSession(session) {
  const user = session && session.user;

 if (user) {
    hideWelcomeIntro();
  } else {
    playWelcomeIntro();
  }
  
  if (user && (!me || me.id !== user.id)) {
    me = user;
    await loadMyProfile();
    startRealtime();
    show(profile.username ? "chats" : "profile");
    if (!profile.username) toast("Atur username dulu agar bisa dicari orang lain.");
  } else if (!user && me) {
    me = null; profile = {}; peer = null; stopRealtime();
    show("auth"); authMsg("Kamu sudah logout.");
  } else if (!user) {
    show("auth");
  }
}
async function loadMyProfile() {
  const { data } = await sb.from("profiles").select("*").eq("user_id", me.id).maybeSingle();
  profile = data || { user_id: me.id };
}

/* ===== Realtime: satu channel untuk semua pesan masuk ===== */
function startRealtime() {
  stopRealtime();
  channel = sb.channel("incoming-" + me.id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${me.id}` }, (p) => {
      const m = p.new;
      if (currentView === "room" && peer && m.sender_id === peer.user_id) { addBubble(m); scrollMsgs(); }
      else { toast("Pesan baru"); if (currentView === "chats") loadInbox(); }
    }).subscribe();
}
function stopRealtime() { if (channel) { sb.removeChannel(channel); channel = null; } }

/* ===== Pesan: daftar percakapan ===== */
async function loadInbox() {
  const box = $("inboxList");
  if (!me) return empty(box, "Login untuk melihat pesan.");
  const { data, error } = await sb.from("messages").select("id, sender_id, receiver_id, content, created_at")
    .or(`sender_id.eq.${me.id},receiver_id.eq.${me.id}`).order("created_at", { ascending: false }).limit(500);
  if (error) return empty(box, "Gagal memuat pesan.");
  const last = new Map();
  (data || []).forEach((m) => { const o = m.sender_id === me.id ? m.receiver_id : m.sender_id; if (!last.has(o)) last.set(o, m); });
  if (!last.size) return empty(box, "Belum ada percakapan. Cari pengguna untuk memulai.");
  const pm = await profilesFor([...last.keys()]);
  box.replaceChildren();
  last.forEach((m, uid) => {
    const p = pm.get(uid) || { user_id: uid, username: "pengguna" };
    const b = el("button", "item");
    const meta = el("div", "meta");
    const name = el("div", "name"); name.append(el("span", "", displayName(p)), el("small", "", fmt(m.created_at)));
    meta.append(name, el("div", "sub", (m.sender_id === me.id ? "Kamu: " : "") + m.content));
    b.append(avatar(p), meta);
    b.onclick = () => openRoom(p);
    box.appendChild(b);
  });
}
$("btnRefresh").onclick = loadInbox;

/* ===== Ruang chat ===== */
async function openRoom(p) {
  if (!me) return toast("Login dulu.");
  if (p.user_id === me.id) return toast("Tidak bisa mengirim pesan ke diri sendiri.");
  peer = p;
  $("roomName").textContent = displayName(p);
  $("roomUser").textContent = p.username ? "@" + p.username : "";
  $("roomAvatar").replaceChildren(avatar(p));
  empty($("roomMsgs"), "Memuat pesan...");
  show("room");
  const a = me.id, b = p.user_id;
  const { data, error } = await sb.from("messages").select("id, sender_id, receiver_id, content, created_at")
    .or(`and(sender_id.eq.${a},receiver_id.eq.${b}),and(sender_id.eq.${b},receiver_id.eq.${a})`).order("created_at", { ascending: true });
  if (peer !== p) return;
  const box = $("roomMsgs");
  if (error) return empty(box, "Gagal memuat pesan.");
  box.replaceChildren();
  if (!data.length) empty(box, "Belum ada pesan. Mulai percakapan.");
  else data.forEach(addBubble);
  scrollMsgs();
}
function addBubble(m) {
  const box = $("roomMsgs");
  if (box.querySelector(`[data-id="${m.id}"]`)) return;
  const first = box.firstElementChild; if (first && first.classList.contains("empty")) first.remove();
  const d = el("div", "bubble" + (m.sender_id === me.id ? " mine" : ""));
  d.dataset.id = m.id;
  d.append(el("div", "", m.content), el("small", "", fmt(m.created_at)));
  box.appendChild(d);
}
function scrollMsgs() { requestAnimationFrame(() => { const b = $("roomMsgs"); b.scrollTop = b.scrollHeight; }); }
$("btnBackRoom").onclick = () => { peer = null; show("chats"); };
$("roomForm").onsubmit = (e) => {
  e.preventDefault();
  const input = $("roomInput"), content = input.value.trim();
  if (!content || !peer) return;
  busy($("btnSend"), async () => {
    const { data, error } = await sb.from("messages").insert({ sender_id: me.id, receiver_id: peer.user_id, content })
      .select("id, sender_id, receiver_id, content, created_at").single();
    if (error) return toast("Pesan gagal dikirim: " + error.message);
    input.value = ""; addBubble(data); scrollMsgs();
  });
};

/* ===== Status 24 jam (teks atau foto) ===== */
$("statusFile").onchange = (e) => { const f = e.target.files[0]; $("statusNote").textContent = f ? "Foto dipilih: " + f.name : "Status aktif 24 jam."; };
$("statusForm").onsubmit = (e) => {
  e.preventDefault();
  const text = $("statusText").value.trim(), file = $("statusFile").files[0];
  if (!text && !file) return toast("Tulis status atau pilih foto.");
  busy(e.submitter, async () => {
    try {
      const media_url = await upload(file, "status");
      const { error } = await sb.from("statuses").insert({
        user_id: me.id, type: file ? "image" : "text", content: text,
        media_url: media_url || null, expires_at: new Date(Date.now() + 864e5).toISOString()
      });
      if (error) throw error;
      $("statusText").value = ""; $("statusFile").value = ""; $("statusNote").textContent = "Status aktif 24 jam.";
      toast("Status dibagikan."); loadStatus();
    } catch (err) { toast("Status gagal: " + err.message); }
  });
};
async function loadStatus() {
  const box = $("statusList");
  if (!me) return empty(box, "Login untuk melihat status.");
  const { data, error } = await sb.from("statuses").select("*").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false });
  if (error) return empty(box, "Gagal memuat status.");
  if (!data.length) return empty(box, "Belum ada status aktif. Jadi yang pertama membagikan.");
  const pm = await profilesFor(data.map((s) => s.user_id));
  box.replaceChildren();
  data.forEach((s) => {
    const p = pm.get(s.user_id) || {};
    const url = safeUrl(s.media_url);
    const b = el("button", "story" + (url ? " photo" : ""));
    b.appendChild(el("div", "who", displayName(p) + " · " + fmt(s.created_at)));
    if (url) { const i = el("img"); i.src = url; i.alt = "Status"; b.appendChild(i); }
    if (s.content) b.appendChild(el("div", "txt", s.content));
    b.onclick = () => openViewer(s);
    if (s.user_id === me.id) {
      const wrap = el("div", "list");
      const del = el("button", "btn danger sm", "Hapus status");
      del.onclick = async () => {
  const { error } = await sb.from("statuses").delete().eq("id", s.id);

  if (error) {
    console.error("Gagal menghapus status:", error);
    toast("Gagal menghapus: " + error.message);
  } else {
    toast("Status berhasil dihapus.");
    await loadStatus();
  }
};
      wrap.append(b, del); box.appendChild(wrap);
    } else box.appendChild(b);
  });
}
function openViewer(s) {
  const body = $("viewerBody"); body.replaceChildren();
  const url = safeUrl(s.media_url);
  if (url) { const i = el("img"); i.src = url; i.alt = "Status"; body.appendChild(i); }
  if (s.content) body.appendChild(el("p", "", s.content));
  $("viewer").classList.remove("hidden");
}
$("viewerClose").onclick = () => $("viewer").classList.add("hidden");
$("viewer").onclick = (e) => { if (e.target.id === "viewer") $("viewer").classList.add("hidden"); };

/* ===== Feed postingan ===== */
$("postFile").onchange = (e) => {
  const f = e.target.files[0], img = $("postPreview");
  if (!f) return img.classList.add("hidden");
  img.src = URL.createObjectURL(f); img.classList.remove("hidden");
};
$("postForm").onsubmit = (e) => {
  e.preventDefault();
  const caption = $("postCaption").value.trim(), file = $("postFile").files[0];
  if (!caption && !file) return toast("Tulis caption atau pilih foto.");
  busy(e.submitter, async () => {
    try {
      const image_url = await upload(file, "post");
      const { error } = await sb.from("posts").insert({ user_id: me.id, caption, image_url: image_url || null });
      if (error) throw error;
      $("postCaption").value = ""; $("postFile").value = ""; $("postPreview").classList.add("hidden");
      toast("Postingan dibagikan."); loadFeed();
    } catch (err) { toast("Posting gagal: " + err.message); }
  });
};
async function loadFeed() {
  const box = $("feedList");
  if (!me) return empty(box, "Login untuk melihat beranda.");
  const { data, error } = await sb.from("posts").select("*").order("created_at", { ascending: false }).limit(50);
  if (error) return empty(box, "Gagal memuat postingan. Pastikan sql/setup.sql sudah dijalankan.");
  if (!data.length) return empty(box, "Belum ada postingan. Bagikan foto pertamamu.");
  const pm = await profilesFor(data.map((x) => x.user_id));
  box.replaceChildren();
  data.forEach((x) => {
    const p = pm.get(x.user_id) || {};
    const card = el("article", "post"), head = el("header");
    const who = el("div", "grow"); who.append(el("strong", "", displayName(p)), el("br"), el("small", "time", fmt(x.created_at)));
    head.append(avatar(p), who);
    if (x.user_id === me.id) {
      const del = el("button", "btn danger sm", "Hapus");
      del.onclick = async () => { const { error } = await sb.from("posts").delete().eq("id", x.id); error ? toast("Gagal menghapus.") : loadFeed(); };
      head.appendChild(del);
    }
    card.appendChild(head);
    const url = safeUrl(x.image_url);
    if (url) { const i = el("img", "pic"); i.src = url; i.alt = "Foto postingan"; i.loading = "lazy"; card.appendChild(i); }
    if (x.caption) card.appendChild(el("p", "", x.caption));
    box.appendChild(card);
  });
}

/* ===== Cari pengguna (sebagian username juga cocok) ===== */
$("searchForm").onsubmit = async (e) => {
  e.preventDefault();
  const box = $("searchList"), q = $("searchInput").value.trim().replace(/[%_,()]/g, "");
  if (!me) return empty(box, "Login untuk mencari pengguna.");
  if (!q) return empty(box, "Ketik username terlebih dahulu.");
  empty(box, "Mencari...");
  const { data, error } = await sb.from("profiles").select("user_id, username, full_name, avatar_url, bio, website, location")
    .ilike("username", `%${q}%`).neq("user_id", me.id).limit(20);
  if (error) return empty(box, "Terjadi kesalahan saat mencari.");
  if (!data.length) return empty(box, "Pengguna tidak ditemukan.");
  box.replaceChildren();
  data.forEach((p) => {
    const b = el("button", "item"), meta = el("div", "meta");
    meta.append(el("div", "name", displayName(p)), el("div", "sub", "@" + p.username));
    b.append(avatar(p), meta);
    b.onclick = () => openUser(p);
    box.appendChild(b);
  });
};

/* ===== Profil pengguna lain ===== */
function openUser(p) {
  const c = $("userCard"); c.replaceChildren(avatar(p, "lg"), el("h3", "", displayName(p)), el("div", "note", "@" + p.username));
  if (p.bio) c.appendChild(el("p", "", p.bio));
  if (p.location) c.appendChild(el("div", "note", "📍 " + p.location));
  const site = safeUrl(p.website);
  if (site) { const a = el("a", "", site); a.href = site; a.target = "_blank"; a.rel = "noopener noreferrer"; c.appendChild(a); }
  const b = el("button", "btn primary", "Kirim pesan"); b.onclick = () => openRoom(p);
  c.appendChild(b);
  show("user");
}
$("btnBackUser").onclick = () => show("search");

/* ===== Profil saya ===== */
function fillProfile() {
  if (!me) return;
  $("myAvatar").replaceChildren(avatar(profile, "lg"));
  $("myEmail").textContent = me.email || "";
  $("pUsername").value = profile.username || "";
  $("pName").value = profile.full_name || "";
  $("pBio").value = profile.bio || "";
  $("pWebsite").value = profile.website || "";
  $("pLocation").value = profile.location || "";
}
$("profileForm").onsubmit = (e) => {
  e.preventDefault();
  const username = $("pUsername").value.trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) return toast("Username 3-20 karakter: huruf, angka, titik, garis bawah.");
  const website = $("pWebsite").value.trim();
  if (website && !safeUrl(website)) return toast("Website harus diawali http:// atau https://");
  busy(e.submitter, async () => {
    try {
      const avatar_url = (await upload($("pAvatarFile").files[0], "avatar")) || profile.avatar_url || null;
      const row = { user_id: me.id, username, full_name: $("pName").value.trim(), bio: $("pBio").value.trim(), website, location: $("pLocation").value.trim(), avatar_url };
      const { error } = await sb.from("profiles").upsert(row, { onConflict: "user_id" });
      if (error) throw error.code === "23505" ? new Error("Username sudah dipakai.") : error;
      profile = { ...profile, ...row }; $("pAvatarFile").value = "";
      fillProfile(); toast("Profil disimpan.");
    } catch (err) { toast("Gagal menyimpan: " + err.message); }
  });
};
