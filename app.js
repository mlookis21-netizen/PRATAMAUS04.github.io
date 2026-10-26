"use strict";
/* ===== Konfigurasi (anon/publishable key aman dipublikasikan; keamanan ada di RLS) ===== */
const SUPABASE_URL = "https://htwhiqxqtahxtmidzwud.supabase.co";
const SUPABASE_KEY = "sb_publishable_jhuCqHXsUvF-BG5WBBHtMw_xgbxoo_1";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
let me = null, profile = {}, peer = null, channel = null, currentView = "auth", previousUserView = "search";
let roomOldestAt = null, roomCanLoadOlder = false, roomLoadingOlder = false, roomLoadToken = 0;
let replyingTo = null;
let messageActionMenu = null;
let messagePressTimer = null;
let messagePressStart = null;
let messageSwipeStart = null;

/* ===== Kontrol Story/Status Viewer ===== */
let activeStatuses = [];
let statusProfileMap = new Map();
let viewerIndex = -1;
let viewerTimer = null;
let viewerStartedAt = 0;
let viewerRemaining = 5000;
let viewerPaused = false;
let viewerPointerStart = null;
let viewerProgressFills = [];

let viewerProgressIndexes = [];

const STORY_DURATION = 5000;
let statusExpiryTimer = null;

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
  if (url) {
    const i = el("img");
    i.src = url;
    i.alt = "";
    i.loading = "lazy";
    i.decoding = "async";
    a.appendChild(i);
  } else {
    a.textContent = (displayName(p || {})[0] || "?").toUpperCase();
  }
  return a;
}
function setProfileTarget(node, p, label) {
  if (!node || !p || !p.user_id) return;
  node.classList.add("profile-target");
  node.setAttribute("role", "button");
  node.tabIndex = 0;
  node.setAttribute("aria-label", label || "Lihat profil " + displayName(p));
  node.title = "Lihat profil " + displayName(p);
  node.onclick = (e) => {
    e.stopPropagation();
    openUser(p, currentView);
  };
  node.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      openUser(p, currentView);
    }
  };
}

/* ===== Lihat foto profil ukuran besar ===== */
let profilePhotoDialog = null;
function openProfilePhoto(p) {
  const url = safeUrl(p && p.avatar_url);
  if (!url) return toast("Pengguna ini belum memasang foto profil.");

  if (!profilePhotoDialog) {
    const dialog = document.createElement("dialog");
    dialog.className = "profile-photo-dialog";
    dialog.setAttribute("aria-label", "Foto profil");

    const close = document.createElement("button");
    close.type = "button";
    close.className = "profile-photo-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "Tutup foto profil");

    const img = document.createElement("img");
    img.className = "profile-photo-full";
    img.alt = "Foto profil";

    const caption = document.createElement("div");
    caption.className = "profile-photo-caption";

    close.onclick = () => dialog.close();
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => img.removeAttribute("src"));
    dialog.append(close, img, caption);
    document.body.appendChild(dialog);
    profilePhotoDialog = { dialog, img, caption };
  }

  profilePhotoDialog.img.src = url;
  profilePhotoDialog.img.alt = "Foto profil " + displayName(p);
  profilePhotoDialog.caption.textContent =
    displayName(p) + (p.username ? " · @" + p.username : "");
  if (!profilePhotoDialog.dialog.open) profilePhotoDialog.dialog.showModal();
}

function setProfilePhotoTarget(node, p) {
  if (!node || !p) return;
  node.classList.add("profile-photo-target");
  node.setAttribute("role", "button");
  node.tabIndex = 0;
  node.setAttribute("aria-label", "Lihat foto profil " + displayName(p));
  node.title = "Klik untuk melihat foto profil";
  node.onclick = (event) => {
    event.stopPropagation();
    openProfilePhoto(p);
  };
  node.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      openProfilePhoto(p);
    }
  };
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
async function detectImageType(file) {
  // Periksa tanda tangan file, bukan hanya nama atau MIME dari browser.
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const startsWith = (...signature) => signature.every((byte, index) => bytes[index] === byte);

  if (startsWith(0xFF, 0xD8, 0xFF)) return { mime: "image/jpeg", ext: "jpg" };
  if (startsWith(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) return { mime: "image/png", ext: "png" };
  if (startsWith(0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return { mime: "image/gif", ext: "gif" };
  }
  if (startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return { mime: "image/webp", ext: "webp" };
  }

  throw new Error("Format gambar tidak didukung. Gunakan JPG, PNG, GIF, atau WebP.");
}

async function optimizeImageForUpload(file, imageType) {
  // GIF dibiarkan utuh agar animasinya tidak hilang.
  if (imageType.mime === "image/gif" || typeof createImageBitmap !== "function") {
    return { file, imageType };
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const maxDimension = 1600;
    const needsResize = bitmap.width > maxDimension || bitmap.height > maxDimension;
    if (!needsResize && file.size <= 700 * 1024) {
      return { file, imageType };
    }

    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return { file, imageType };
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!blob || blob.size >= file.size) return { file, imageType };

    const mime = blob.type || "image/webp";
    const ext = mime === "image/webp" ? "webp" : mime === "image/png" ? "png" : "jpg";
    const optimizedFile = new File([blob], `optimized.${ext}`, { type: mime, lastModified: Date.now() });
    return { file: optimizedFile, imageType: { mime, ext } };
  } catch (error) {
    // Jika browser tidak bisa memproses gambar, tetap gunakan file asli.
    return { file, imageType };
  } finally {
    if (bitmap && typeof bitmap.close === "function") bitmap.close();
  }
}

async function upload(file, folder) {
  if (!file) return "";
  if (file.size <= 0) throw new Error("File gambar kosong atau tidak valid.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Ukuran foto maksimal 5 MB.");

  const detectedType = await detectImageType(file);
  const optimized = await optimizeImageForUpload(file, detectedType);
  const uploadFile = optimized.file;
  const imageType = optimized.imageType;
  const path = `${me.id}/${folder}-${Date.now()}.${imageType.ext}`;
  const { error } = await sb.storage.from("media").upload(path, uploadFile, {
    contentType: imageType.mime,
    upsert: false
  });
  if (error) throw new Error("Supabase menolak pemuatan pesan lama: " + error.message);
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

async function loadHome() {
  await Promise.all([
    loadStatus(),
    loadFeed()
  ]);
}

const loaders = {
  chats: loadInbox,
  status: loadStatus,
  feed: loadHome,
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
      // Desktop: pertahankan daftar percakapan di samping ruang chat.
      // Pada HP, CSS menyembunyikan daftar saat ruang chat dibuka.
      const keepInboxBesideRoom = v === "room" && x === "chats";
      section.classList.toggle("hidden", x !== v && !keepInboxBesideRoom);
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
let savedTheme = "light";

try {
  savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || "light";
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
    show(profile.username ? "feed" : "profile");
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
      if (currentView === "room" && peer && m.sender_id === peer.user_id) {
        void addBubble(m).then(scrollMsgs); void markConversationRead(m.sender_id);
      } else { toast("Pesan baru"); if (currentView === "chats") loadInbox(); }
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `sender_id=eq.${me.id}` }, (p) => {
      const m = p.new;
      if (m.read_at) updateReadReceipt(m);
      if (currentView === "chats") loadInbox();
    }).subscribe();
}
function stopRealtime() { if (channel) { sb.removeChannel(channel); channel = null; } }

/* ===== Pesan: daftar percakapan + pencarian seperti inbox ===== */
function filterInbox() {
  const box = $("inboxList");
  const input = $("chatSearchInput");
  const clear = $("clearChatSearch");
  if (!box || !input) return;
  const q = input.value.trim().toLocaleLowerCase("id-ID");
  if (clear) clear.hidden = !q;

  const items = [...box.querySelectorAll(".chat-row")];
  const oldNotice = $("inboxSearchEmpty");
  if (oldNotice) oldNotice.remove();

  // Jangan mengubah pesan status kosong/error yang dibuat oleh loadInbox.
  if (!items.length) return;
  let visible = 0;
  items.forEach((item) => {
    const match = !q || (item.dataset.search || item.textContent).toLocaleLowerCase("id-ID").includes(q);
    item.hidden = !match;
    if (match) visible++;
  });
  if (q && !visible) {
    const notice = el("div", "empty", "Tidak ada chat atau pesan yang cocok.");
    notice.id = "inboxSearchEmpty";
    box.appendChild(notice);
  }
}

$("chatSearchInput").addEventListener("input", filterInbox);
$("clearChatSearch").addEventListener("click", () => {
  $("chatSearchInput").value = "";
  filterInbox();
  $("chatSearchInput").focus();
});

/* ===== Pesan: daftar percakapan ===== */
async function loadInbox() {
  const box = $("inboxList");
  if (!me) return empty(box, "Login untuk melihat pesan.");
  const { data, error } = await sb.from("messages").select("id, sender_id, receiver_id, content, created_at, read_at")
    .or(`sender_id.eq.${me.id},receiver_id.eq.${me.id}`).order("created_at", { ascending: false }).limit(500);
  if (error) {
    console.error("Gagal memuat inbox:", error);
    return empty(box, "Gagal memuat pesan: " + error.message);
  }
  const { data: unreadRows, error: unreadError } = await sb.from("messages")
    .select("sender_id").eq("receiver_id", me.id).is("read_at", null);
  const unreadCounts = new Map();
  if (!unreadError) (unreadRows || []).forEach((row) => unreadCounts.set(row.sender_id, (unreadCounts.get(row.sender_id) || 0) + 1));
  const last = new Map();
  (data || []).forEach((m) => { const o = m.sender_id === me.id ? m.receiver_id : m.sender_id; if (!last.has(o)) last.set(o, m); });
  if (!last.size) return empty(box, "Belum ada percakapan. Cari pengguna untuk memulai.");
  const { data: pinRows } = await sb.from("chat_pins").select("peer_id").eq("user_id", me.id);
  const pinned = new Set((pinRows || []).map((row) => row.peer_id));
  const pm = await profilesFor([...last.keys()]);
  box.replaceChildren();
  const conversations = [...last.entries()].sort((a, b) => Number(pinned.has(b[0])) - Number(pinned.has(a[0])));
  conversations.forEach(([uid, m]) => {
    const p = pm.get(uid) || { user_id: uid, username: "pengguna" };
    const row = el("div", "chat-row");
    row.dataset.search = [displayName(p), p.username || "", (m.sender_id === me.id ? "Kamu: " : "") + (m.content || "")].join(" ");
    const b = el("button", "item");
    b.type = "button";
    const meta = el("div", "meta");
    const name = el("div", "name");
    const nameTarget = el("span", "profile-target", displayName(p));
    setProfileTarget(nameTarget, p, "Lihat profil " + displayName(p));
    name.append(nameTarget, el("small", "", fmt(m.created_at)));
    const preview = (m.sender_id === me.id ? "Kamu: " : "") + (m.content || "");
    const previewRow = el("div", "preview-row");
    previewRow.appendChild(el("div", "sub", preview));
    const unreadCount = unreadCounts.get(uid) || 0;
    if (unreadCount > 0) previewRow.appendChild(el("span", "unread-badge", unreadCount > 99 ? "99+" : String(unreadCount)));
    meta.append(name, previewRow);
    b.classList.toggle("has-unread", unreadCount > 0);

    const personAvatar = avatar(p);
    setProfileTarget(personAvatar, p, "Lihat profil " + displayName(p));
    b.append(personAvatar, meta);
    b.onclick = () => openRoom(p);
    row.appendChild(b);
    const pin = el("button", "chat-pin" + (pinned.has(uid) ? " is-pinned" : ""), "📌");
    pin.type = "button";
    pin.title = pinned.has(uid) ? "Lepas sematan chat" : "Sematkan chat";
    pin.setAttribute("aria-label", pin.title);
    pin.onclick = async (event) => {
      event.stopPropagation();
      pin.disabled = true;
      const result = pinned.has(uid)
        ? await sb.from("chat_pins").delete().eq("user_id", me.id).eq("peer_id", uid)
        : await sb.from("chat_pins").insert({ user_id: me.id, peer_id: uid });
      if (result.error) toast("Gagal mengubah sematan chat: " + result.error.message);
      else await loadInbox();
    };
    row.appendChild(pin);
    box.appendChild(row);
  });
  filterInbox();
}
$("btnRefresh").onclick = loadInbox;

async function markConversationRead(senderId) {
  if (!me || !senderId) return;
  const { error } = await sb.from("messages").update({ read_at: new Date().toISOString() })
    .eq("receiver_id", me.id).eq("sender_id", senderId).is("read_at", null);
  if (error) {
    console.warn("Status baca pesan gagal diperbarui.", error.message);
    return;
  }
  await loadInbox();
}

/* ===== Menu profesional ruang chat ===== */
let roomMoreMenu = null;
function closeRoomMoreMenu() {
  if (roomMoreMenu) {
    roomMoreMenu.remove();
    roomMoreMenu = null;
  }
  const trigger = $("btnRoomMore");
  if (trigger) trigger.setAttribute("aria-expanded", "false");
}
function showRoomMoreMenu() {
  closeRoomMoreMenu();
  const menu = el("div", "room-more-menu");
  menu.id = "roomMoreMenu";
  menu.setAttribute("role", "menu");
  const addItem = (label, icon, action) => {
    const button = el("button", "room-more-item");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    const symbol = el("span", "room-more-item-icon", icon);
    const text = el("span", "", label);
    button.append(symbol, text);
    button.onclick = () => { closeRoomMoreMenu(); action(); };
    menu.appendChild(button);
  };
  addItem("Cari dalam chat", "⌕", () => {
    const bar = $("roomSearchBar");
    bar.classList.remove("hidden");
    $("roomSearchInput").focus();
    filterRoomMessages();
  });
  addItem("Lihat profil kontak", "♙", () => {
    if (peer) openUser(peer, "room");
  });
  addItem("Tutup percakapan", "←", () => {
    resetRoomSearch();
    peer = null;
    show("chats");
  });
  document.body.appendChild(menu);
  const trigger = $("btnRoomMore");
  if (trigger) trigger.setAttribute("aria-expanded", "true");
  const rect = trigger ? trigger.getBoundingClientRect() : {right: window.innerWidth - 12, bottom: 60};
  const width = menu.offsetWidth || 224;
  menu.style.left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 8)) + "px";
  roomMoreMenu = menu;
}
function resetRoomSearch() {
  const bar = $("roomSearchBar");
  const input = $("roomSearchInput");
  if (bar) bar.classList.add("hidden");
  if (input) input.value = "";
  $("roomSearchCount").textContent = "";
  $("roomMsgs")?.querySelectorAll(".bubble").forEach((bubble) => {
    bubble.hidden = false;
    bubble.classList.remove("room-search-match");
  });
}
function filterRoomMessages() {
  const input = $("roomSearchInput");
  const box = $("roomMsgs");
  if (!input || !box) return;
  const query = input.value.trim().toLocaleLowerCase("id-ID");
  const bubbles = [...box.querySelectorAll(".bubble")];
  let matches = 0;
  bubbles.forEach((bubble) => {
    const found = !query || bubble.textContent.toLocaleLowerCase("id-ID").includes(query);
    bubble.hidden = !found;
    bubble.classList.toggle("room-search-match", Boolean(query && found));
    if (found && query) matches++;
  });
  $("roomSearchCount").textContent = query ? matches + " hasil" : "";
}
$("btnRoomMore").onclick = (event) => {
  event.stopPropagation();
  if (roomMoreMenu) closeRoomMoreMenu();
  else showRoomMoreMenu();
};
$("roomSearchInput").addEventListener("input", filterRoomMessages);
$("closeRoomSearch").onclick = resetRoomSearch;
document.addEventListener("pointerdown", (event) => {
  if (roomMoreMenu && !roomMoreMenu.contains(event.target) && !event.target.closest("#btnRoomMore")) closeRoomMoreMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && roomMoreMenu) closeRoomMoreMenu();
});

/* ===== Ruang chat ===== */
async function openRoom(p) {
  if (!me) return toast("Login dulu.");
  if (p.user_id === me.id) return toast("Tidak bisa mengirim pesan ke diri sendiri.");
  peer = p;
  clearReply();
  const loadToken = ++roomLoadToken;
  roomOldestAt = null;
  roomCanLoadOlder = false;
  roomLoadingOlder = false;
  $("loadOlderMessages").hidden = true;
  $("loadOlderMessages").disabled = false;
  $("loadOlderMessages").textContent = "Muat pesan sebelumnya";
  $("roomName").textContent = displayName(p);
  $("roomUser").textContent = p.username ? "@" + p.username : "";
  $("roomAvatar").replaceChildren(avatar(p));
  setProfileTarget($("roomAvatar"), p, "Lihat profil " + displayName(p));
  setProfileTarget($("roomName").parentElement, p, "Lihat profil " + displayName(p));
  empty($("roomMsgs"), "Memuat pesan...");
  show("room");
  closeRoomMoreMenu();
  resetRoomSearch();
  const a = me.id, b = p.user_id;
  const { data, error } = await sb.from("messages")
    .select("id, sender_id, receiver_id, content, created_at, read_at, reply_to_id")
    .or(`and(sender_id.eq.${a},receiver_id.eq.${b}),and(sender_id.eq.${b},receiver_id.eq.${a})`)
    .order("created_at", { ascending: false }).limit(100);
  if (peer !== p || loadToken !== roomLoadToken) return;
  const box = $("roomMsgs");
  if (error) {
    console.error("Gagal memuat ruang chat:", error);
    return empty(box, "Gagal memuat pesan: " + error.message);
  }
  const messages = (data || []).reverse();
  box.replaceChildren();
  if (!messages.length) {
    empty(box, "Belum ada pesan. Mulai percakapan.");
  } else {
    messages.forEach(addBubble);
    roomOldestAt = messages[0].created_at;
    roomCanLoadOlder = messages.length === 100;
    $("loadOlderMessages").hidden = !roomCanLoadOlder;
  }
  scrollMsgs();
  void markConversationRead(p.user_id);
}

$("loadOlderMessages").onclick = async () => {
  if (!me || !peer || !roomOldestAt || roomLoadingOlder) return;
  const currentPeer = peer;
  const loadToken = roomLoadToken;
  const before = roomOldestAt;
  const button = $("loadOlderMessages");
  const box = $("roomMsgs");
  roomLoadingOlder = true;
  button.disabled = true;
  button.textContent = "Memuat...";
  const oldHeight = box.scrollHeight;
  const oldTop = box.scrollTop;
  const existingIds = new Set(Array.from(box.querySelectorAll(".bubble"), (node) => node.dataset.id));

  try {
    const a = me.id, b = currentPeer.user_id;
    const { data, error } = await sb.from("messages")
      .select("id, sender_id, receiver_id, content, created_at, read_at, reply_to_id")
      .or(`and(sender_id.eq.${a},receiver_id.eq.${b}),and(sender_id.eq.${b},receiver_id.eq.${a})`)
      .lt("created_at", before)
      .order("created_at", { ascending: false })
      .limit(100);

    if (peer !== currentPeer || loadToken !== roomLoadToken) return;
    if (error) throw error;
    const olderMessages = (data || []).reverse();
    if (!olderMessages.length) {
      roomCanLoadOlder = false;
      button.hidden = true;
      return;
    }

    olderMessages.forEach(addBubble);
    const addedNodes = Array.from(box.querySelectorAll(".bubble"))
      .filter((node) => !existingIds.has(node.dataset.id));
    const fragment = document.createDocumentFragment();
    addedNodes.forEach((node) => fragment.appendChild(node));
    const firstExisting = Array.from(box.querySelectorAll(".bubble"))
      .find((node) => existingIds.has(node.dataset.id));
    box.insertBefore(fragment, firstExisting || box.firstChild);

    roomOldestAt = olderMessages[0].created_at;
    roomCanLoadOlder = olderMessages.length === 100;
    button.hidden = !roomCanLoadOlder;
    requestAnimationFrame(() => {
      box.scrollTop = oldTop + (box.scrollHeight - oldHeight);
    });
  } catch (error) {
    toast("Pesan lama gagal dimuat: " + error.message);
  } finally {
    if (loadToken === roomLoadToken) {
      roomLoadingOlder = false;
      button.disabled = false;
      button.textContent = "Muat pesan sebelumnya";
    }
  }
};
function clearReply() {
  replyingTo = null;
  const preview = $("replyPreview");
  if (preview) preview.classList.add("hidden");
}
function beginReply(m) {
  if (!peer || !m) return;
  replyingTo = { id: m.id, content: m.content || "", sender_id: m.sender_id };
  $("replyPreviewText").textContent = (m.sender_id === me.id ? "Kamu: " : displayName(peer) + ": ") + (m.content || "");
  $("replyPreview").classList.remove("hidden");
  $("roomInput").focus();
}
$("cancelReply").onclick = clearReply;
function closeMessageActionMenu() {
  if (messageActionMenu) {
    messageActionMenu.remove();
    messageActionMenu = null;
  }
}
function showMessageActions(bubble, m) {
  closeMessageActionMenu();
  const menu = el("div", "message-action-menu");
  menu.setAttribute("role", "menu");
  const reply = el("button", "", "↩ Balas");
  reply.type = "button";
  reply.setAttribute("role", "menuitem");
  reply.onclick = () => { closeMessageActionMenu(); beginReply(m); };
  const copy = el("button", "", "⧉ Salin teks");
  copy.type = "button";
  copy.setAttribute("role", "menuitem");
  copy.onclick = async () => {
    closeMessageActionMenu();
    const textToCopy = String(m.content || "");
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const helper = el("textarea");
        helper.value = textToCopy;
        helper.setAttribute("readonly", "");
        helper.style.position = "fixed";
        helper.style.opacity = "0";
        document.body.appendChild(helper);
        helper.select();
        const copied = document.execCommand("copy");
        helper.remove();
        if (!copied) throw new Error("copy failed");
      }
      toast("Teks pesan disalin.");
    } catch (_) {
      toast("Tidak bisa menyalin pesan di browser ini.");
    }
  };
  const forward = el("button", "", "➦ Teruskan");
  forward.type = "button";
  forward.onclick = async () => {
    closeMessageActionMenu();
    const entered = window.prompt("Masukkan username penerima (tanpa @):");
    if (!entered || !me) return;
    const username = entered.trim().replace(/^@/, "");
    if (!username) return;
    const { data: target, error: lookupError } = await sb.from("profiles")
      .select("user_id, username").ilike("username", username).neq("user_id", me.id).maybeSingle();
    if (lookupError || !target) return toast("Username tidak ditemukan.");
    if (!window.confirm("Teruskan pesan ini ke @" + target.username + "?")) return;
    const { error } = await sb.from("messages").insert({
      sender_id: me.id,
      receiver_id: target.user_id,
      content: "↪ Diteruskan:\n" + (m.content || "")
    });
    if (error) return toast("Pesan gagal diteruskan: " + error.message);
    toast("Pesan diteruskan ke @" + target.username + ".");
    if (currentView === "chats") void loadInbox();
  };
  forward.setAttribute("role", "menuitem");
  menu.append(reply, copy, forward);
  document.body.appendChild(menu);
  const rect = bubble.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(rect.top - menu.offsetHeight - 8, window.innerHeight - menu.offsetHeight - 8)) + "px";
  messageActionMenu = menu;
}
document.addEventListener("pointerdown", (event) => {
  if (messageActionMenu && !messageActionMenu.contains(event.target)) closeMessageActionMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && messageActionMenu) {
    closeMessageActionMenu();
  }
});
function attachMessageActions(bubble, m) {
  bubble.title = "Geser ke kanan untuk membalas, atau tekan lama untuk aksi pesan";
  bubble.setAttribute("aria-label", "Pesan. Geser ke kanan untuk membalas atau tekan lama untuk aksi pesan.");
  bubble.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showMessageActions(bubble, m);
  });
  bubble.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    if (event.pointerType === "touch" && bubble.setPointerCapture) {
      try { bubble.setPointerCapture(event.pointerId); } catch (_) {}
    }
    messagePressStart = { x: event.clientX, y: event.clientY, id: m.id };
    messageSwipeStart = event.pointerType === "touch"
      ? { x: event.clientX, y: event.clientY, id: m.id }
      : null;
    clearTimeout(messagePressTimer);
    messagePressTimer = setTimeout(() => {
      if (messagePressStart && messagePressStart.id === m.id) {
        messageSwipeStart = null;
        bubble.classList.remove("is-swiping-to-reply");
        bubble.style.transform = "";
        showMessageActions(bubble, m);
        messagePressStart = null;
      }
    }, 480);
  });
  bubble.addEventListener("pointermove", (event) => {
    if (messagePressStart && (Math.abs(event.clientX - messagePressStart.x) > 12 || Math.abs(event.clientY - messagePressStart.y) > 12)) {
      clearTimeout(messagePressTimer);
      messagePressStart = null;
    }
    if (!messageSwipeStart || messageSwipeStart.id !== m.id) return;
    const dx = event.clientX - messageSwipeStart.x;
    const dy = event.clientY - messageSwipeStart.y;
    if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 0.85) {
      messageSwipeStart = null;
      bubble.classList.remove("is-swiping-to-reply");
      bubble.style.transform = "";
      return;
    }
    if (dx > 8 && dx > Math.abs(dy) * 1.15) {
      bubble.classList.add("is-swiping-to-reply");
      bubble.style.transform = "translateX(" + Math.min(dx, 64) + "px)";
    }
  });
  const endPress = (event) => {
    clearTimeout(messagePressTimer);
    messagePressStart = null;
    if (messageSwipeStart && messageSwipeStart.id === m.id) {
      const dx = event.clientX - messageSwipeStart.x;
      const dy = event.clientY - messageSwipeStart.y;
      const shouldReply = dx >= 56 && dx > Math.abs(dy) * 1.35;
      messageSwipeStart = null;
      bubble.classList.remove("is-swiping-to-reply");
      bubble.style.transform = "";
      if (shouldReply) {
        beginReply(m);
        toast("Membalas pesan");
      }
    } else {
      messageSwipeStart = null;
      bubble.classList.remove("is-swiping-to-reply");
      bubble.style.transform = "";
    }
  };
  bubble.addEventListener("pointerup", endPress);
  bubble.addEventListener("pointercancel", () => {
    clearTimeout(messagePressTimer);
    messagePressStart = null;
    messageSwipeStart = null;
    bubble.classList.remove("is-swiping-to-reply");
    bubble.style.transform = "";
  });
}

async function addBubble(m) {
  const box = $("roomMsgs");
  if (box.querySelector(`[data-id="${m.id}"]`)) return;
  if (m.reply_to_id && !m.reply_to) {
    const { data } = await sb.from("messages").select("id, content, sender_id").eq("id", m.reply_to_id).maybeSingle();
    if (data) m.reply_to = data;
  }
  if (box.querySelector(`[data-id="${m.id}"]`)) return;
  const first = box.firstElementChild; if (first && first.classList.contains("empty")) first.remove();
  const ownMessage = m.sender_id === me.id;
  const d = el("div", "bubble" + (ownMessage ? " mine" : ""));
  d.dataset.id = m.id;
  if (m.reply_to && m.reply_to.content) {
    const quote = el("div", "bubble-reply-quote");
    quote.append(
      el("small", "", m.reply_to.sender_id === me.id ? "Kamu" : displayName(peer || {})),
      el("div", "", m.reply_to.content)
    );
    d.appendChild(quote);
  }
  d.appendChild(el("div", "bubble-content", m.content || ""));
  attachMessageActions(d, m);
  const meta = el("div", "bubble-meta");
  meta.appendChild(el("small", "bubble-time", fmt(m.created_at)));
  if (ownMessage) {
    const read = Boolean(m.read_at);
    const receipt = el("span", "read-receipt", read ? "✓✓" : "✓");
    receipt.title = read ? "Dibaca" : "Terkirim";
    receipt.setAttribute("aria-label", read ? "Dibaca" : "Terkirim");
    if (read) receipt.classList.add("is-read");
    meta.appendChild(receipt);
  }
  d.appendChild(meta);
  box.appendChild(d);
}
function updateReadReceipt(m) {
  if (!m || !m.read_at) return;
  const box = $("roomMsgs");
  const bubble = box && box.querySelector(`[data-id="${m.id}"]`);
  if (!bubble || !bubble.classList.contains("mine")) return;
  let receipt = bubble.querySelector(".read-receipt");
  if (!receipt) {
    receipt = el("span", "read-receipt");
    const meta = bubble.querySelector(".bubble-meta");
    if (meta) meta.appendChild(receipt);
  }
  receipt.textContent = "✓✓";
  receipt.title = "Dibaca";
  receipt.setAttribute("aria-label", "Dibaca");
  receipt.classList.add("is-read");
}
function scrollMsgs() { requestAnimationFrame(() => { const b = $("roomMsgs"); b.scrollTop = b.scrollHeight; }); }
$("btnBackRoom").onclick = () => { peer = null; show("chats"); };
$("roomForm").onsubmit = (e) => {
  e.preventDefault();
  const input = $("roomInput"), content = input.value.trim();
  if (!content || !peer) return;
  busy($("btnSend"), async () => {
    const payload = { sender_id: me.id, receiver_id: peer.user_id, content, reply_to_id: replyingTo ? replyingTo.id : null };
    const { data, error } = await sb.from("messages").insert(payload)
      .select("id, sender_id, receiver_id, content, created_at, read_at, reply_to_id").single();
    if (error) {
      console.error("Gagal mengirim pesan:", error);
      return toast("Pesan gagal dikirim: " + error.message);
    }
    input.value = "";
    clearReply();
    await addBubble(data);
    scrollMsgs();
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
  const myStatusBox = $("myStatusList");
  myStatusBox.replaceChildren();
  
  if (statusExpiryTimer) {
    clearTimeout(statusExpiryTimer);
    statusExpiryTimer = null;
  }

  if (!me) {
    activeStatuses = [];
    if (!$("viewer").classList.contains("hidden")) closeStoryViewer();
    empty(box, "Login untuk melihat status.");
    empty(myStatusBox, "Belum ada status milikmu.");
    return;
  }
  const { data, error } = await sb.from("statuses")
  .select("id, user_id, type, content, media_url, created_at, expires_at")
  .gt("expires_at", new Date().toISOString())
  .order("created_at", { ascending: false });

if (error) return empty(box, "Gagal memuat status.");

// Filter kedua di browser untuk memastikan status kedaluwarsa tidak ditampilkan.
const now = Date.now();
const validStatuses = (data || []).filter((status) => {
  const expiry = Date.parse(status.expires_at);
  return Number.isFinite(expiry) && expiry > now;
});

// Kelompokkan status berdasarkan pemilik.
// Urutan pengguna mengikuti status terbaru mereka.
// Di dalam kelompok, status diputar dari yang paling lama.
const groupedStatuses = new Map();

validStatuses.forEach((status) => {
  if (!groupedStatuses.has(status.user_id)) {
    groupedStatuses.set(status.user_id, []);
  }

  groupedStatuses.get(status.user_id).push(status);
});

activeStatuses = [];

groupedStatuses.forEach((statuses) => {
  statuses.sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );

  activeStatuses.push(...statuses);
});

if (!activeStatuses.length) {
  if (!$("viewer").classList.contains("hidden")) closeStoryViewer();
  empty(box, "Belum ada status aktif. Jadi yang pertama membagikan.");
  empty(myStatusBox, "Belum ada status milikmu.");
  return;
}

// Jadwalkan penyegaran tepat setelah status terdekat kedaluwarsa.
const nextExpiry = Math.min(...activeStatuses.map((status) => Date.parse(status.expires_at)).filter(Number.isFinite));
if (Number.isFinite(nextExpiry)) {
  statusExpiryTimer = setTimeout(async () => {
    const viewerOpen = !$("viewer").classList.contains("hidden");
    const oldStatuses = [...activeStatuses];
    const oldIndex = viewerIndex;
    const currentStory = oldStatuses[oldIndex] || null;
    await loadStatus();

    if (!viewerOpen || !currentStory) return;
    const currentStillActive = activeStatuses.findIndex((status) => status.id === currentStory.id);
    if (currentStillActive >= 0) {
      viewerIndex = currentStillActive;
      renderStoryViewer();
      return;
    }

    // Jika Story yang sedang dibuka habis masa berlakunya, lanjut ke Story aktif berikutnya.
    const nextActiveId = oldStatuses.slice(oldIndex + 1).find((oldStatus) =>
      activeStatuses.some((status) => status.id === oldStatus.id)
    )?.id;
    const nextIndex = nextActiveId
      ? activeStatuses.findIndex((status) => status.id === nextActiveId)
      : 0;

    if (!activeStatuses.length) {
      closeStoryViewer();
    } else {
      viewerIndex = Math.max(0, nextIndex);
      renderStoryViewer();
    }
  }, Math.max(0, nextExpiry - Date.now()) + 100);
}

const pm = await profilesFor(activeStatuses.map((s) => s.user_id));
statusProfileMap = pm;


  box.replaceChildren();

  // Satu akun hanya memiliki satu lingkaran Story.
  const accountGroups = new Map();

  activeStatuses.forEach((status) => {
    if (!accountGroups.has(status.user_id)) {
      accountGroups.set(status.user_id, []);
    }
    accountGroups.get(status.user_id).push(status);
  });

  accountGroups.forEach((statuses, userId) => {
    const profile = pm.get(userId) || {};
    const name = displayName(profile);
    const avatarUrl = safeUrl(profile.avatar_url);

    const accountButton = el("button", "story story-account");
    accountButton.type = "button";
    accountButton.title = name;

    const avatar = el("div", "story-account-avatar");

    if (avatarUrl) {
      const image = el("img");
      image.src = avatarUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      avatar.appendChild(image);
    } else {
      avatar.textContent = name.trim().charAt(0).toUpperCase() || "?";
    }

    accountButton.appendChild(avatar);
    accountButton.appendChild(
      el("div", "story-account-name", name)
    );

    if (statuses.length > 1) {
      accountButton.appendChild(
        el("div", "story-account-count", statuses.length + " status")
      );
    }

    // Membuka Story pertama dari akun yang dipilih.
    accountButton.onclick = () => openViewer(statuses[0]);
    box.appendChild(accountButton);

  // Tombol hapus status milik sendiri ditampilkan di halaman Status.
if (userId === me.id) {
  statuses.forEach((status) => {
    const del = el(
      "button",
      "btn danger sm",
      "Hapus status · " + fmt(status.created_at)
    );

    del.type = "button";
    del.onclick = async () => {
      if (!window.confirm("Yakin ingin menghapus status ini?")) {
        return;
      }

      const { error } = await sb
        .from("statuses")
        .delete()
        .eq("id", status.id);

      if (error) {
        console.error("Gagal menghapus status:", error);
        toast("Gagal menghapus: " + error.message);
      } else {
        toast("Status berhasil dihapus.");
        await loadStatus();
      }
    };

    myStatusBox.appendChild(del);
  });
}
  });
}

/* ===== Story Viewer: progres, jeda, dan urutan status ===== */

function stopViewerTimer() {
  if (viewerTimer) {
    clearInterval(viewerTimer);
    viewerTimer = null;
  }
}

function closeStoryViewer() {
  stopViewerTimer();
  viewerPaused = false;
  viewerPointerStart = null;
  viewerIndex = -1;
  viewerRemaining = STORY_DURATION;
  viewerProgressFills = [];
  viewerProgressIndexes = [];

  $("viewer").classList.add("hidden");
}

function updateStoryProgress() {
  const elapsed = STORY_DURATION - viewerRemaining;
  const progress = Math.max(
    0,
    Math.min(100, (elapsed / STORY_DURATION) * 100)
  );

  viewerProgressFills.forEach((fill, index) => {
    const storyIndex = viewerProgressIndexes[index];

    fill.style.width =
      storyIndex < viewerIndex ? "100%" :
      storyIndex === viewerIndex ? `${progress}%` :
      "0%";
  });
}

function startViewerTimer() {
  stopViewerTimer();

  if (viewerPaused || viewerIndex < 0) return;

  viewerStartedAt = Date.now();

  viewerTimer = setInterval(() => {
    const elapsed = Date.now() - viewerStartedAt;
    viewerRemaining = Math.max(0, viewerRemaining - elapsed);
    viewerStartedAt = Date.now();

    updateStoryProgress();

    if (viewerRemaining <= 0) {
      stopViewerTimer();
      showNextStory();
    }
  }, 30);
}

function pauseStoryViewer() {
  if (viewerPaused || viewerIndex < 0) return;

  viewerPaused = true;

  if (viewerTimer) {
    const elapsed = Date.now() - viewerStartedAt;
    viewerRemaining = Math.max(0, viewerRemaining - elapsed);
    stopViewerTimer();
  }

  updateStoryProgress();
}

function resumeStoryViewer() {
  if (!viewerPaused || viewerIndex < 0) return;

  viewerPaused = false;
  startViewerTimer();
}


function renderStoryViewer() {
  const body = $("viewerBody");
  const story = activeStatuses[viewerIndex];

  if (!story) {
    closeStoryViewer();
    return;
  }

  if (!Number.isFinite(Date.parse(story.expires_at)) || Date.parse(story.expires_at) <= Date.now()) {
    showNextStory();
    return;
  }

  const p = statusProfileMap.get(story.user_id) || {};
  const url = safeUrl(story.media_url);

  // Tentukan rentang status milik akun yang sedang dibuka.
  let groupStart = viewerIndex;
  let groupEnd = viewerIndex;

  while (
    groupStart > 0 &&
    activeStatuses[groupStart - 1].user_id === story.user_id
  ) {
    groupStart--;
  }

  while (
    groupEnd < activeStatuses.length - 1 &&
    activeStatuses[groupEnd + 1].user_id === story.user_id
  ) {
    groupEnd++;
  }

  body.replaceChildren();
  body.classList.add("story-viewer-body");

  // Progress bar hanya untuk status akun ini.
  const progressRow = el("div", "story-progress-row");

  viewerProgressFills = [];
  viewerProgressIndexes = [];

  for (let index = groupStart; index <= groupEnd; index++) {
    const track = el("div", "story-progress-track");
    const fill = el("div", "story-progress-fill");

    track.appendChild(fill);
    progressRow.appendChild(track);

    viewerProgressFills.push(fill);
    viewerProgressIndexes.push(index);
  }

  body.appendChild(progressRow);

  // Informasi pemilik status.
  const header = el("div", "story-viewer-header");
  const userInfo = el("div", "story-viewer-user");
  const meta = el("div", "story-viewer-user-meta");

  userInfo.append(avatar(p), meta);

  meta.append(
    el("strong", "", displayName(p)),
    el("small", "", fmt(story.created_at))
  );

  userInfo.classList.add("profile-target");
  userInfo.setAttribute("role", "button");
  userInfo.tabIndex = 0;
  userInfo.setAttribute("aria-label", "Lihat profil " + displayName(p));
  userInfo.title = "Lihat profil " + displayName(p);
  const returnView = currentView;
  const openStoryOwnerProfile = (e) => {
    e.stopPropagation();
    closeStoryViewer();
    openUser(p, returnView);
  };
  userInfo.onclick = openStoryOwnerProfile;
  userInfo.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openStoryOwnerProfile(e);
    }
  };

  header.appendChild(userInfo);
  body.appendChild(header);

  // Konten foto atau teks.
  const content = el("div", "story-viewer-content");

  if (url) {
    const img = el("img", "story-viewer-image");
    img.src = url;
    img.alt = "Story";
    content.appendChild(img);
  }

  if (story.content) {
    content.appendChild(
      el("p", "story-viewer-text", story.content)
    );
  }

  body.appendChild(content);

  viewerRemaining = STORY_DURATION;
  viewerPaused = false;

  updateStoryProgress();
  startViewerTimer();
}


function openViewer(s) {
  if (!activeStatuses.length) return;

  const index = activeStatuses.findIndex(
  (item) => item.user_id === s.user_id
);
  if (index < 0) return;

  stopViewerTimer();
  viewerIndex = index;
  viewerRemaining = STORY_DURATION;
  viewerPaused = false;

  $("viewer").classList.remove("hidden");
  renderStoryViewer();
}


function showNextStory() {
  if (viewerIndex < 0) return;

  let nextIndex = viewerIndex + 1;
  while (
    nextIndex < activeStatuses.length &&
    (!Number.isFinite(Date.parse(activeStatuses[nextIndex].expires_at)) ||
      Date.parse(activeStatuses[nextIndex].expires_at) <= Date.now())
  ) {
    nextIndex++;
  }

  // Tutup viewer jika tidak ada Story aktif berikutnya.
  if (nextIndex >= activeStatuses.length) {
    closeStoryViewer();
    return;
  }

  // Lanjut ke story berikutnya.
  // Urutan activeStatuses sudah dikelompokkan berdasarkan pengguna.
  viewerIndex = nextIndex;
  viewerRemaining = STORY_DURATION;
  viewerPaused = false;

  renderStoryViewer();
}

function showPreviousStory() {
  if (viewerIndex <= 0) {
    viewerRemaining = STORY_DURATION;
    renderStoryViewer();
    return;
  }

  viewerIndex--;
  viewerRemaining = STORY_DURATION;
  renderStoryViewer();
}

/* Tekan untuk jeda; lepas untuk melanjutkan. Ketukan singkat berpindah status. */
const storyViewerBody = $("viewerBody");


storyViewerBody.onpointerdown = (e) => {
  if (viewerIndex < 0) return;

  viewerPointerStart = {
    time: Date.now(),
    x: e.clientX,
    y: e.clientY
  };

  if (storyViewerBody.setPointerCapture) {
    storyViewerBody.setPointerCapture(e.pointerId);
  }

  pauseStoryViewer();
};

storyViewerBody.onpointerup = (e) => {
  if (!viewerPointerStart) return;

  const press = viewerPointerStart;
  viewerPointerStart = null;

  const duration = Date.now() - press.time;
  const deltaX = e.clientX - press.x;
  const deltaY = e.clientY - press.y;

  if (
    duration < 220 &&
    Math.abs(deltaX) < 30 &&
    Math.abs(deltaY) < 30
  ) {
    if (press.x < window.innerWidth * 0.35) {
      showPreviousStory();
    } else {
      showNextStory();
    }

    return;
  }

  resumeStoryViewer();
};

storyViewerBody.onpointercancel = () => {
  viewerPointerStart = null;
  resumeStoryViewer();
};
$("viewerClose").onclick = closeStoryViewer;

$("viewer").onclick = (e) => {
  if (e.target.id === "viewer") {
    closeStoryViewer();
  }
};

/* ===== Feed postingan ===== */
const postComposerDialog = $("postComposerDialog");
let postPreviewObjectUrl = null;

function closePostComposer() {
  if (typeof postComposerDialog.close === "function" && postComposerDialog.open) {
    postComposerDialog.close();
  } else {
    postComposerDialog.removeAttribute("open");
  }
}

function clearPostPreview() {
  const img = $("postPreview");
  if (postPreviewObjectUrl) {
    URL.revokeObjectURL(postPreviewObjectUrl);
    postPreviewObjectUrl = null;
  }
  img.removeAttribute("src");
  img.classList.add("hidden");
}

function syncPostCaptionCount() {
  const caption = $("postCaption");
  const count = $("postCaptionCount");
  if (caption && count) count.textContent = `${caption.value.length}/500`;
}

$("openPostComposer").onclick = () => {
  if (!me) return toast("Login dulu untuk membuat postingan.");
  if (typeof postComposerDialog.showModal === "function") {
    if (!postComposerDialog.open) postComposerDialog.showModal();
  } else {
    postComposerDialog.setAttribute("open", "");
  }
  syncPostCaptionCount();
  $("postCaption").focus();
};

$("closePostComposer").onclick = closePostComposer;
postComposerDialog.addEventListener("close", () => {
  // Bersihkan URL preview agar file foto tidak tertahan di memori.
  clearPostPreview();
});

postComposerDialog.addEventListener("click", (e) => {
  if (e.target === postComposerDialog) closePostComposer();
});

$("postCaption").addEventListener("input", syncPostCaptionCount);

$("postFile").onchange = (e) => {
  const file = e.target.files && e.target.files[0];
  const img = $("postPreview");
  const note = $("postFileNote");

  clearPostPreview();
  if (!file) {
    if (note) note.textContent = "Foto opsional · Maksimal 5 MB";
    return;
  }

  if (!file.type.startsWith("image/")) {
    e.target.value = "";
    if (note) note.textContent = "File harus berupa gambar.";
    return toast("Pilih file gambar yang valid.");
  }

  if (file.size > 5 * 1024 * 1024) {
    e.target.value = "";
    if (note) note.textContent = "Ukuran foto melebihi batas 5 MB.";
    return toast("Ukuran foto maksimal 5 MB.");
  }

  postPreviewObjectUrl = URL.createObjectURL(file);
  img.src = postPreviewObjectUrl;
  img.classList.remove("hidden");
  if (note) note.textContent = `${file.name} · ${(file.size / (1024 * 1024)).toFixed(2)} MB`;
};

$("postForm").onsubmit = (e) => {
  e.preventDefault();
  const caption = $("postCaption").value.trim();
  const file = $("postFile").files[0];

  if (!caption && !file) return toast("Tulis caption atau pilih foto.");
  if (!me) return toast("Sesi login berakhir. Login kembali untuk memposting.");
  if (file && (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024)) {
    return toast(file.size > 5 * 1024 * 1024 ? "Ukuran foto maksimal 5 MB." : "Pilih file gambar yang valid.");
  }

  busy(e.submitter, async () => {
    try {
      const image_url = await upload(file, "post");
      const { error } = await sb.from("posts").insert({
        user_id: me.id,
        caption,
        image_url: image_url || null
      });
      if (error) throw error;

      $("postCaption").value = "";
      $("postFile").value = "";
      syncPostCaptionCount();
      if ($("postFileNote")) $("postFileNote").textContent = "Foto opsional · Maksimal 5 MB";
      closePostComposer();
      clearPostPreview();
      toast("Postingan berhasil dibagikan.");
      await loadFeed();
    } catch (err) {
      toast("Posting gagal: " + (err && err.message ? err.message : "terjadi kesalahan."));
    }
  });
};

let activePostDetail = null;
let activePostComments = [];
let postDetailBusy = false;

function postActionButton(label, icon, className, pressed = false) {
  const b = el("button", "post-action " + (className || ""));
  b.type = "button";
  b.setAttribute("aria-pressed", String(pressed));
  b.innerHTML = icon + "<span>" + label + "</span>";
  return b;
}
function postIcon(name) {
  const paths = {
    like: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.4 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></svg>',
    comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3h.5a8.5 8.5 0 0 1 8 8v.5Z"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>'
  };
  return paths[name] || "";
}
function formatCount(n) {
  const count = Number(n) || 0;
  return count.toLocaleString("id-ID");
}
async function syncPostLikeUI(postId) {
  const { data, error } = await sb.from("post_likes").select("user_id").eq("post_id", postId);
  if (error) throw error;
  const rows = data || [];
  const liked = rows.some((item) => item.user_id === me?.id);
  document.querySelectorAll("[data-post-like]").forEach((button) => {
    if (button.dataset.postLike !== String(postId)) return;
    button.setAttribute("aria-pressed", String(liked));
    button.classList.toggle("is-liked", liked);
    const label = button.querySelector("span");
    if (label) label.textContent = liked ? "Disukai" : "Suka";
  });
  const card = [...document.querySelectorAll("#feedList [data-post-id]")].find((item) => item.dataset.postId === String(postId));
  const countText = formatCount(rows.length) + " suka";
  card?.querySelectorAll(".post-like-count").forEach((node) => { node.textContent = countText; });
  $("postDetailContent")?.querySelectorAll(".post-detail-like-count").forEach((node) => { node.textContent = countText; });
  return { liked, count: rows.length };
}
async function togglePostLike(postId, wasLiked) {
  if (!me) throw new Error("Login untuk menyukai postingan.");
  if (wasLiked) {
    const { error } = await sb.from("post_likes").delete().eq("post_id", postId).eq("user_id", me.id);
    if (error) throw error;
  } else {
    const { error } = await sb.from("post_likes").insert({ post_id: postId, user_id: me.id });
    if (error && error.code !== "23505") throw error;
  }
  return syncPostLikeUI(postId);
}
function createPostActions(post, likes, comments, liked) {
  const row = el("div", "post-actions");
  const like = postActionButton(liked ? "Disukai" : "Suka", postIcon("like"), "post-like-action" + (liked ? " is-liked" : ""), liked);
  like.dataset.postLike = post.id;
  like.onclick = async () => {
    if (!me) return toast("Login untuk menyukai postingan.");
    if (like.disabled) return;
    const wasLiked = like.getAttribute("aria-pressed") === "true";
    like.disabled = true;
    // Respons visual langsung; daftar feed tidak dibangun ulang.
    like.setAttribute("aria-pressed", String(!wasLiked));
    like.classList.toggle("is-liked", !wasLiked);
    const label = like.querySelector("span");
    if (label) label.textContent = wasLiked ? "Suka" : "Disukai";
    try {
      await togglePostLike(post.id, wasLiked);
    } catch (err) {
      try { await syncPostLikeUI(post.id); } catch (_) {}
      toast("Like gagal disimpan: " + (err?.message || "coba lagi."));
    } finally { like.disabled = false; }
  };
  const comment = postActionButton("Komentar", postIcon("comment"), "post-comment-action");
  comment.onclick = () => openPostDetail(post.id);
  const share = postActionButton("Bagikan", postIcon("share"), "post-share-action");
  share.onclick = () => sharePost(post);
  row.append(like, comment, share);
  const summary = el("div", "post-engagement-summary");
  const likeText = el("strong", "post-like-count", formatCount(likes) + " suka");
  const commentText = el("button", "post-comment-count", comments ? "Lihat " + formatCount(comments) + " komentar" : "Jadilah yang pertama berkomentar");
  commentText.type = "button";
  commentText.onclick = () => openPostDetail(post.id);
  summary.append(likeText, commentText);
  return { row, summary };
}
async function refreshPostCommentCount(postId) {
  const { data, error } = await sb.from("post_comments").select("id").eq("post_id", postId);
  if (error) {
    console.error("Gagal memperbarui jumlah komentar:", error);
    return;
  }
  const count = (data || []).length;
  const card = [...document.querySelectorAll("#feedList [data-post-id]")].find((item) => item.dataset.postId === String(postId));
  const label = count ? "Lihat " + formatCount(count) + " komentar" : "Jadilah yang pertama berkomentar";
  card?.querySelectorAll(".post-comment-count").forEach((node) => { node.textContent = label; });
}
async function sharePost(post) {
  const url = window.location.href.split("#")[0] + "#post-" + post.id;
  const shareData = { title: "Postingan MAVIKO", text: post.caption || "Lihat postingan ini di MAVIKO", url };
  try {
    if (navigator.share) await navigator.share(shareData);
    else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareData.text + "\n" + url);
      toast("Teks dan tautan postingan disalin.");
    } else toast("Fitur berbagi tidak tersedia di browser ini.");
  } catch (err) {
    if (err?.name !== "AbortError") toast("Postingan belum bisa dibagikan dari perangkat ini.");
  }
}
async function loadFeed() {
  const box = $("feedList");
  if (!me) return empty(box, "Login untuk melihat beranda.");
  empty(box, "Memuat postingan...");
  const { data, error } = await sb.from("posts")
    .select("id, user_id, caption, image_url, created_at")
    .order("created_at", { ascending: false }).limit(50);
  if (error) return empty(box, "Gagal memuat postingan. Periksa koneksi lalu coba buka Beranda lagi.");
  if (!data || !data.length) return empty(box, "Belum ada postingan. Jadilah yang pertama berbagi.");
  const pm = await profilesFor(data.map((x) => x.user_id));
  const ids = data.map((x) => x.id);
  const [likesResult, commentsResult] = await Promise.all([
    sb.from("post_likes").select("post_id,user_id").in("post_id", ids),
    sb.from("post_comments").select("post_id").in("post_id", ids)
  ]);
  const likes = likesResult.error ? [] : (likesResult.data || []);
  const comments = commentsResult.error ? [] : (commentsResult.data || []);
  const likeCounts = new Map(), commentCounts = new Map(), likedByMe = new Set();
  likes.forEach((like) => {
    likeCounts.set(like.post_id, (likeCounts.get(like.post_id) || 0) + 1);
    if (like.user_id === me.id) likedByMe.add(like.post_id);
  });
  comments.forEach((comment) => commentCounts.set(comment.post_id, (commentCounts.get(comment.post_id) || 0) + 1));
  box.replaceChildren();
  data.forEach((x) => {
    const p = pm.get(x.user_id) || {};
    const card = el("article", "post");
    card.dataset.postId = x.id;
    const head = el("header", "post-header");
    const who = el("div", "grow post-author");
    who.append(el("strong", "", displayName(p)), el("br"), el("small", "time", fmt(x.created_at)));
    const postAvatar = avatar(p);
    setProfileTarget(postAvatar, p, "Lihat profil " + displayName(p));
    setProfileTarget(who, p, "Lihat profil " + displayName(p));
    head.append(postAvatar, who);
    if (x.user_id === me.id) {
      const menu = el("button", "post-menu-btn", "⋯");
      menu.type = "button";
      menu.setAttribute("aria-label", "Opsi postingan");
      menu.title = "Opsi postingan";
      menu.onclick = async () => {
        if (!window.confirm("Hapus postingan ini? Tindakan ini tidak bisa dibatalkan.")) return;
        menu.disabled = true;
        try {
          const { error: deleteError } = await sb.from("posts").delete().eq("id", x.id).eq("user_id", me.id);
          if (deleteError) throw deleteError;
          toast("Postingan dihapus.");
          await loadFeed();
        } catch (err) {
          menu.disabled = false;
          toast("Gagal menghapus postingan: " + (err?.message || "coba lagi."));
        }
      };
      head.appendChild(menu);
    }
    card.appendChild(head);
    const url = safeUrl(x.image_url);
    if (url) {
      const img = el("img", "pic post-open-target");
      img.src = url;
      img.alt = "Foto postingan dari " + displayName(p);
      img.loading = "lazy"; img.decoding = "async";
      img.tabIndex = 0; img.setAttribute("role", "button"); img.setAttribute("aria-label", "Buka postingan");
      img.onerror = () => { img.alt = "Foto postingan tidak dapat dimuat"; img.classList.add("post-image-unavailable"); };
      img.onclick = () => openPostDetail(x.id);
      img.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPostDetail(x.id); } };
      card.appendChild(img);
    }
    if (x.caption) {
      const caption = el("p", "post-caption post-open-target", x.caption);
      caption.tabIndex = 0;
      caption.setAttribute("role", "button");
      caption.setAttribute("aria-label", "Buka detail postingan");
      caption.onclick = () => openPostDetail(x.id);
      caption.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPostDetail(x.id); } };
      card.appendChild(caption);
    }
    const engagement = createPostActions(x, likeCounts.get(x.id) || 0, commentCounts.get(x.id) || 0, likedByMe.has(x.id));
    card.append(engagement.row, engagement.summary);
    box.appendChild(card);
  });
}
async function openPostDetail(postId, keepFocus = false) {
  const dialog = $("postDetailDialog"), content = $("postDetailContent");
  if (!dialog || !content) return;
  if (!me) return toast("Login untuk melihat detail postingan.");
  const { data: fetched, error } = await sb.from("posts").select("id,user_id,caption,image_url,created_at").eq("id", postId).maybeSingle();
  if (error || !fetched) return toast("Postingan tidak ditemukan atau tidak bisa dibuka.");
  activePostDetail = fetched;
  const profileMap = await profilesFor([fetched.user_id]);
  const profile = profileMap.get(fetched.user_id) || {};
  const [{ data: likeRows, error: likeError }, { data: commentRows, error: commentError }] = await Promise.all([
    sb.from("post_likes").select("id,user_id").eq("post_id", postId),
    sb.from("post_comments").select("id,user_id,content,created_at").eq("post_id", postId).order("created_at", { ascending: true })
  ]);
  if (likeError || commentError) {
    const detail = likeError ? "Like: " + likeError.message : "Komentar: " + commentError.message;
    console.error("Gagal memuat interaksi postingan:", { likeError, commentError, postId });
    toast("Interaksi postingan gagal dimuat. " + detail);
    return;
  }
  activePostComments = commentRows || [];
  const author = el("div", "post-detail-author");
  const av = avatar(profile);
  setProfileTarget(av, profile, "Lihat profil " + displayName(profile));
  const authorMeta = el("div", "grow");
  authorMeta.append(el("strong", "", displayName(profile)), el("small", "time", fmt(fetched.created_at)));
  author.append(av, authorMeta);
  if (fetched.user_id === me.id) {
    const del = el("button", "post-detail-delete", "Hapus");
    del.type = "button";
    del.onclick = async () => {
      if (!confirm("Hapus postingan ini?")) return;
      const { error: delError } = await sb.from("posts").delete().eq("id", fetched.id).eq("user_id", me.id);
      if (delError) return toast("Postingan gagal dihapus.");
      dialog.close(); activePostDetail = null; await loadFeed(); toast("Postingan dihapus.");
    };
    author.appendChild(del);
  }
  content.replaceChildren(author);
  const imageUrl = safeUrl(fetched.image_url);
  if (imageUrl) {
    const img = el("img", "post-detail-image");
    img.src = imageUrl; img.alt = "Foto postingan dari " + displayName(profile); img.decoding = "async";
    content.appendChild(img);
  }
  if (fetched.caption) content.appendChild(el("p", "post-detail-caption", fetched.caption));
  const liked = (likeRows || []).some((r) => r.user_id === me.id);
  const actions = el("div", "post-detail-actions");
  const likeBtn = postActionButton(liked ? "Disukai" : "Suka", postIcon("like"), "post-like-action" + (liked ? " is-liked" : ""), liked);
  likeBtn.dataset.postLike = fetched.id;
  likeBtn.onclick = async () => {
    if (likeBtn.disabled) return;
    const wasLiked = likeBtn.getAttribute("aria-pressed") === "true";
    likeBtn.disabled = true;
    likeBtn.setAttribute("aria-pressed", String(!wasLiked));
    likeBtn.classList.toggle("is-liked", !wasLiked);
    const label = likeBtn.querySelector("span");
    if (label) label.textContent = wasLiked ? "Suka" : "Disukai";
    try {
      await togglePostLike(fetched.id, wasLiked);
      const count = $("postDetailContent")?.querySelector(".post-detail-like-count");
      if (count) count.textContent = formatCount((await sb.from("post_likes").select("id").eq("post_id", fetched.id)).data?.length || 0) + " suka";
    } catch (err) {
      try { await syncPostLikeUI(fetched.id); } catch (_) {}
      toast("Like gagal disimpan: " + (err?.message || "coba lagi."));
    } finally { likeBtn.disabled = false; }
  };
  const commentBtn = postActionButton("Komentar", postIcon("comment"), "post-comment-action");
  commentBtn.onclick = () => $("postCommentInput")?.focus();
  const shareBtn = postActionButton("Bagikan", postIcon("share"), "post-share-action");
  shareBtn.onclick = () => sharePost(fetched);
  actions.append(likeBtn, commentBtn, shareBtn);
  content.appendChild(actions);
  const likeCount = el("strong", "post-detail-like-count", formatCount((likeRows || []).length) + " suka");
  content.appendChild(likeCount);
  $("postDetailCommentCount").textContent = formatCount(activePostComments.length) + " komentar";
  const commentsBox = $("postDetailComments");
  commentsBox.replaceChildren();
  if (!activePostComments.length) commentsBox.appendChild(el("div", "post-comments-empty", "Belum ada komentar. Mulai percakapan yang baik."));
  else {
    const userMap = await profilesFor(activePostComments.map((c) => c.user_id));
    activePostComments.forEach((c) => {
      const row = el("article", "post-comment");
      const cp = userMap.get(c.user_id) || {};
      const ca = avatar(cp); setProfileTarget(ca, cp, "Lihat profil " + displayName(cp));
      const body = el("div", "post-comment-body");
      const bubble = el("div", "post-comment-bubble");
      bubble.append(el("strong", "", displayName(cp)), el("p", "", c.content));
      body.appendChild(bubble);
      const meta = el("div", "post-comment-meta");
      meta.append(el("time", "", fmt(c.created_at)));
      if (c.user_id === me.id) {
        const remove = el("button", "post-comment-delete", "Hapus");
        remove.type = "button";
        remove.onclick = async () => {
          const { error: e } = await sb.from("post_comments").delete().eq("id", c.id).eq("user_id", me.id);
          if (e) return toast("Komentar gagal dihapus.");
          await openPostDetail(fetched.id, true); await refreshPostCommentCount(fetched.id);
        };
        meta.appendChild(remove);
      }
      body.appendChild(meta); row.append(ca, body); commentsBox.appendChild(row);
    });
  }
  if (!dialog.open) dialog.showModal();
  if (keepFocus) $("postCommentInput")?.focus({ preventScroll: true });
}
$("closePostDetail")?.addEventListener("click", () => $("postDetailDialog")?.close());
$("postDetailDialog")?.addEventListener("click", (e) => { if (e.target === $("postDetailDialog")) $("postDetailDialog").close(); });
$("postCommentForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("postCommentInput");
  const content = input.value.trim();
  if (!me) return toast("Login untuk berkomentar.");
  if (!activePostDetail || !content || postDetailBusy) return;
  postDetailBusy = true;
  $("postCommentSubmit").disabled = true;
  try {
    const { error } = await sb.from("post_comments").insert({ post_id: activePostDetail.id, user_id: me.id, content });
    if (error) throw error;
    input.value = "";
    await openPostDetail(activePostDetail.id, true);
    await refreshPostCommentCount(activePostDetail.id);
    $("postCommentInput")?.focus({ preventScroll: true });
  } catch (err) {
    toast("Komentar gagal dikirim: " + (err?.message || "coba lagi."));
  } finally { postDetailBusy = false; $("postCommentSubmit").disabled = false; }
});

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
function openUser(p, returnView = currentView) {
  if (!p || !p.user_id) return toast("Profil pengguna tidak tersedia.");
  previousUserView = returnView || "search";
  const c = $("userCard");
  const userPhoto = avatar(p, "lg");
  setProfilePhotoTarget(userPhoto, p);
  c.replaceChildren(userPhoto, el("h3", "", displayName(p)), el("div", "note", p.username ? "@" + p.username : ""));
  if (p.bio) c.appendChild(el("p", "user-profile-bio", p.bio));
  if (p.location) c.appendChild(el("div", "note", "📍 " + p.location));
  const site = safeUrl(p.website);
  if (site) {
    const a = el("a", "user-profile-website", site);
    a.href = site;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    c.appendChild(a);
  }
  const b = el("button", "btn primary", "Kirim pesan");
  b.onclick = () => openRoom(p);
  c.appendChild(b);
  show("user");
}
$("btnBackUser").onclick = () => show(previousUserView || "search");

/* ===== Profil saya ===== */
function updateProfilePreview() {
  const username = $("pUsername").value.trim();
  const name = $("pName").value.trim() || username || "Nama kamu";
  $("profilePreviewName").textContent = name;
  $("profilePreviewUsername").textContent = username ? "@" + username : "@username";
  $("profilePreviewBio").textContent = $("pBio").value.trim() || "Bio kamu akan tampil di sini.";
  $("profilePreviewLocation").textContent = $("pLocation").value.trim() || "Lokasi belum diisi";
  $("profilePreviewWebsite").textContent = $("pWebsite").value.trim() || "Website belum diisi";
  $("profilePreviewWebsite").hidden = !$("pWebsite").value.trim();
  $("pNameCount").textContent = $("pName").value.length + "/60";
  $("pBioCount").textContent = $("pBio").value.length + "/200";
}
function fillProfile() {
  if (!me) return;
  const myPhoto = avatar(profile, "lg");
  setProfilePhotoTarget(myPhoto, profile);
  $("myAvatar").replaceChildren(myPhoto);
  $("myEmail").textContent = me.email || "Email akun tidak tersedia";
  $("pUsername").value = profile.username || "";
  $("pName").value = profile.full_name || "";
  $("pBio").value = profile.bio || "";
  $("pWebsite").value = profile.website || "";
  $("pLocation").value = profile.location || "";
  $("pAvatarFile").value = "";
  updateProfilePreview();
}
["pUsername", "pName", "pBio", "pWebsite", "pLocation"].forEach((id) => {
  $(id).addEventListener("input", updateProfilePreview);
});
$("pAvatarFile").addEventListener("change", () => {
  const file = $("pAvatarFile").files && $("pAvatarFile").files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    $("pAvatarFile").value = "";
    return toast("Pilih file gambar untuk foto profil.");
  }
  if (file.size > 5 * 1024 * 1024) {
    $("pAvatarFile").value = "";
    return toast("Ukuran foto maksimal 5 MB.");
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = el("img", "");
    img.src = reader.result;
    img.alt = "Pratinjau foto profil";
    const previewAvatar = el("div", "avatar lg profile-avatar-preview");
    previewAvatar.appendChild(img);
    $("myAvatar").replaceChildren(previewAvatar);
  };
  reader.onerror = () => toast("Foto tidak bisa dibaca. Coba file lain.");
  reader.readAsDataURL(file);
});
$("profileForm").onsubmit = (e) => {
  e.preventDefault();
  const username = $("pUsername").value.trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) return toast("Username 3-20 karakter: huruf, angka, titik, garis bawah.");
  const website = $("pWebsite").value.trim();
  if (website && !safeUrl(website)) return toast("Website harus diawali http:// atau https://");
  busy(e.submitter, async () => {
    try {
      // Periksa username lebih awal agar tidak mengunggah avatar jika username sudah dipakai.
      const { data: usernameOwner, error: usernameCheckError } = await sb
        .from("profiles")
        .select("user_id")
        .eq("username", username)
        .neq("user_id", me.id)
        .limit(1);
      if (usernameCheckError) throw new Error("Tidak bisa memeriksa username. Coba lagi.");
      if (usernameOwner && usernameOwner.length) throw new Error("Username sudah dipakai.");

      const avatar_url = (await upload($("pAvatarFile").files[0], "avatar")) || profile.avatar_url || null;
      const row = { user_id: me.id, username, full_name: $("pName").value.trim(), bio: $("pBio").value.trim(), website, location: $("pLocation").value.trim(), avatar_url };
      const { error } = await sb.from("profiles").upsert(row, { onConflict: "user_id" });
      if (error) throw error.code === "23505" ? new Error("Username sudah dipakai.") : error;
      profile = { ...profile, ...row }; $("pAvatarFile").value = "";
      fillProfile(); toast("Profil disimpan.");
    } catch (err) { toast("Gagal menyimpan: " + err.message); }
  });
};


/* Preferensi aplikasi: disimpan secara lokal pada perangkat ini. */
const APP_PREFS_KEY = "maviko-app-preferences-v1";
const defaultAppPrefs = { compact: false, reduceMotion: false };
let appPrefs = { ...defaultAppPrefs };
try {
  const storedPrefs = JSON.parse(localStorage.getItem(APP_PREFS_KEY) || "{}");
  appPrefs = {
    compact: storedPrefs.compact === true,
    reduceMotion: storedPrefs.reduceMotion === true
  };
} catch (err) {
  console.warn("Preferensi aplikasi tidak dapat dibaca.", err);
}
function applyAppPrefs(save = false) {
  document.documentElement.dataset.density = appPrefs.compact ? "compact" : "comfortable";
  document.documentElement.dataset.reduceMotion = String(appPrefs.reduceMotion);
  const compactToggle = $("settingCompact");
  const motionToggle = $("settingReduceMotion");
  if (compactToggle) {
    compactToggle.setAttribute("aria-checked", String(appPrefs.compact));
    compactToggle.title = appPrefs.compact ? "Matikan tampilan ringkas" : "Aktifkan tampilan ringkas";
  }
  if (motionToggle) {
    motionToggle.setAttribute("aria-checked", String(appPrefs.reduceMotion));
    motionToggle.title = appPrefs.reduceMotion ? "Aktifkan kembali animasi" : "Kurangi animasi";
  }
  if (save) {
    try {
      localStorage.setItem(APP_PREFS_KEY, JSON.stringify(appPrefs));
    } catch (err) {
      console.warn("Preferensi aplikasi tidak dapat disimpan.", err);
    }
  }
}
$("settingCompact")?.addEventListener("click", () => {
  appPrefs.compact = !appPrefs.compact;
  applyAppPrefs(true);
  toast(appPrefs.compact ? "Tampilan ringkas diaktifkan." : "Tampilan normal diaktifkan.");
});
$("settingReduceMotion")?.addEventListener("click", () => {
  appPrefs.reduceMotion = !appPrefs.reduceMotion;
  applyAppPrefs(true);
  toast(appPrefs.reduceMotion ? "Animasi dikurangi." : "Animasi normal diaktifkan.");
});
applyAppPrefs(false);
