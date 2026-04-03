const SUPABASE_URL = "https://oewgxawfwjqsbfoxwlti.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ld2d4YXdmd2pxc2Jmb3h3bHRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjQ0NDgsImV4cCI6MjA5MDc0MDQ0OH0.0g1OkKf4DEytyzL7Whzie0XJfdUOC7buUUT4Drilu70";

// Fallback: əgər yuxarıdakı sətirdə problem olsa, aşağıdakı real key istifadə olunsun
const SAFE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ld2d4YXdmd2pxc2Jmb3h3bHRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjQ0NDgsImV4cCI6MjA5MDc0MDQ0OH0.0g1OkKf4DEytyzL7Whzie0XJfdUOC7buUUT4Drilu70";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SAFE_ANON_KEY
);

const loginScreen = document.getElementById("loginScreen");
const chatScreen = document.getElementById("chatScreen");
const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginError = document.getElementById("loginError");

const myName = document.getElementById("myName");
const partnerName = document.getElementById("partnerName");
const myAvatarCard = document.getElementById("myAvatarCard");
const partnerAvatarCard = document.getElementById("partnerAvatarCard");
const partnerStatusText = document.getElementById("partnerStatusText");
const partnerDot = document.getElementById("partnerDot");
const mobilePartnerStatusText = document.getElementById("mobilePartnerStatusText");
const mobilePartnerDot = document.getElementById("mobilePartnerDot");
const chatTitle = document.getElementById("chatTitle");
const logoutBtn = document.getElementById("logoutBtn");

const hudClock = document.getElementById("hudClock");
const hudGps = document.getElementById("hudGps");
const hudCompass = document.getElementById("hudCompass");

const messagesEl = document.getElementById("messages");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const editorBanner = document.getElementById("editorBanner");
const editorTextPreview = document.getElementById("editorTextPreview");
const cancelEditBtn = document.getElementById("cancelEditBtn");

const USERS = {
  "nara@shadowlink.com": {
    display_name: "NARA",
    avatarKey: "nara",
  },
  "ebiss@shadowlink.com": {
    display_name: "EBISS",
    avatarKey: "ebiss",
  }
};

let currentUser = null;
let currentProfile = null;
let otherProfile = null;
let activeChannel = null;
let editingMessageId = null;
let booting = false;
let lastKnownMessageIds = new Set();
let hasLoadedMessagesOnce = false;
let audioContext = null;

loginForm.addEventListener("submit", handleLogin);
messageForm.addEventListener("submit", handleMessageSubmit);
logoutBtn.addEventListener("click", handleLogout);
cancelEditBtn.addEventListener("click", cancelEditMode);

document.addEventListener("click", async (e) => {
  initAudio();

  const editBtn = e.target.closest("[data-edit-id]");
  const deleteBtn = e.target.closest("[data-delete-id]");

  if (editBtn) {
    const id = Number(editBtn.dataset.editId);
    const oldText = editBtn.dataset.text || "";
    startEditMode(id, oldText);
  }

  if (deleteBtn) {
    const id = Number(deleteBtn.dataset.deleteId);
    await deleteMessage(id);
  }
}, { passive: true });

document.addEventListener("visibilitychange", async () => {
  if (!document.hidden && currentProfile && otherProfile) {
    await markMessagesAsRead();
    await loadMessages(false);
  }
});

window.addEventListener("focus", async () => {
  if (currentProfile && otherProfile) {
    await markMessagesAsRead();
    await loadMessages(false);
  }
});

initHud();
init();

async function init() {
  showLogin();

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.error("SESSION ERROR:", error);
    loginError.textContent = `Session xətası: ${error.message}`;
    return;
  }

  if (data.session?.user) {
    currentUser = data.session.user;
    await bootChat();
  }

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      currentUser = session.user;
      await bootChat();
    } else {
      currentUser = null;
      currentProfile = null;
      otherProfile = null;
      editingMessageId = null;
      stopRealtime();
      resetPresence();
      showLogin();
    }
  });
}

function initHud() {
  updateHudClock();
  updateHudCompass();
  setInterval(updateHudClock, 1000);
  setInterval(updateHudCompass, 2800);
  hudGps.textContent = "40.37 / 47.12";
}

function updateHudClock() {
  const now = new Date();
  hudClock.textContent = now.toLocaleTimeString("az-AZ", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function updateHudCompass() {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const deg = Math.floor(Math.random() * 360);
  const dir = dirs[Math.round(deg / 45) % 8];
  hudCompass.textContent = `${deg}° ${dir}`;
}

async function handleLogin(e) {
  e.preventDefault();
  initAudio();
  loginError.textContent = "";

  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (!USERS[email]) {
    loginError.textContent = "Bu istifadəçi bu sistem üçün icazəli deyil.";
    return;
  }

  if (!password) {
    loginError.textContent = "Şifrə boş ola bilməz.";
    return;
  }

  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    loginError.textContent = `Giriş xətası: ${error.message}`;
    return;
  }

  const { data: userData, error: userError } = await supabaseClient.auth.getUser();
  if (userError || !userData.user) {
    loginError.textContent = `İstifadəçi oxunmadı: ${userError?.message || "unknown error"}`;
    return;
  }

  currentUser = userData.user;
  emailInput.value = "";
  passwordInput.value = "";
  await bootChat();
}

async function handleLogout() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    alert(`Çıxış xətası: ${error.message}`);
  }
}

async function bootChat() {
  if (booting) return;
  booting = true;
  loginError.textContent = "";

  try {
    if (!currentUser?.email) {
      throw new Error("Aktiv istifadəçi tapılmadı.");
    }

    await loadProfiles();
    setAvatar(myAvatarCard, currentProfile.email);
    setAvatar(partnerAvatarCard, otherProfile.email);

    hasLoadedMessagesOnce = false;
    lastKnownMessageIds = new Set();

    await loadMessages(true);
    subscribeMessages();
    showChat();

    setPresenceOnline(true);
  } catch (error) {
    console.error("BOOT CHAT ERROR:", error);
    loginError.textContent = `Chat yüklənmədi: ${error.message}`;
    showLogin();
  } finally {
    booting = false;
  }
}

async function loadProfiles() {
  const myEmail = (currentUser.email || "").toLowerCase();
  const otherEmail = Object.keys(USERS).find((email) => email !== myEmail);

  if (!USERS[myEmail]) {
    throw new Error("Bu email sistem siyahısında yoxdur.");
  }

  const { data: profiles, error } = await supabaseClient
    .from("profiles")
    .select("id, email, display_name, role, avatar_seed, created_at")
    .in("email", [myEmail, otherEmail]);

  if (error) {
    throw new Error(`profiles oxunmadı: ${error.message}`);
  }

  if (!profiles || profiles.length < 2) {
    throw new Error("profiles cədvəlində 2 istifadəçi tam tapılmadı.");
  }

  currentProfile = profiles.find((p) => (p.email || "").toLowerCase() === myEmail);
  otherProfile = profiles.find((p) => (p.email || "").toLowerCase() === otherEmail);

  if (!currentProfile || !otherProfile) {
    throw new Error("İstifadəçi profilləri tapılmadı.");
  }

  myName.textContent = currentProfile.display_name || USERS[myEmail].display_name;
  partnerName.textContent = otherProfile.display_name || USERS[otherEmail].display_name;
  chatTitle.textContent = `${myName.textContent} ↔ ${partnerName.textContent}`;
}

async function loadMessages(skipSound = false) {
  if (!currentProfile?.id || !otherProfile?.id) {
    throw new Error("Mesajlar üçün profil id-ləri hazır deyil.");
  }

  const { data, error } = await supabaseClient
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${currentProfile.id},receiver_id.eq.${otherProfile.id}),and(sender_id.eq.${otherProfile.id},receiver_id.eq.${currentProfile.id})`
    )
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`messages oxunmadı: ${error.message}`);
  }

  const messages = data || [];

  if (hasLoadedMessagesOnce && !skipSound) {
    handleIncomingSounds(messages);
  }

  renderMessages(messages);
  hasLoadedMessagesOnce = true;
  lastKnownMessageIds = new Set(messages.map((m) => String(m.id)));

  await markMessagesAsRead(messages);
}

function handleIncomingSounds(messages) {
  for (const msg of messages) {
    const id = String(msg.id);
    if (!lastKnownMessageIds.has(id) && msg.sender_id === otherProfile.id) {
      playSoftTone("receive");
    }
  }
}

function subscribeMessages() {
  stopRealtime();

  activeChannel = supabaseClient
    .channel(`shadowlink-main-${currentProfile.id}`, {
      config: {
        presence: { key: currentProfile.id }
      }
    })
    .on("presence", { event: "sync" }, () => {
      syncPresence();
    })
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "messages"
      },
      async (payload) => {
        if (payload.eventType === "INSERT" && payload.new?.sender_id === currentProfile.id) {
          playSoftTone("send");
        }

        try {
          await loadMessages(false);
        } catch (error) {
          console.error("REALTIME LOAD ERROR:", error);
        }
      }
    )
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await activeChannel.track({
          user_id: currentProfile.id,
          email: currentProfile.email,
          online_at: new Date().toISOString()
        });
        syncPresence();
      }
    });
}

function syncPresence() {
  if (!activeChannel || !otherProfile?.id) {
    setPresenceOnline(false);
    return;
  }

  const state = activeChannel.presenceState();
  const otherState = state[otherProfile.id];
  const isOnline = Array.isArray(otherState) && otherState.length > 0;

  setPresenceOnline(isOnline);
}

function setPresenceOnline(isOnline) {
  const text = isOnline ? "online" : "offline";

  partnerStatusText.textContent = text;
  mobilePartnerStatusText.textContent = text;

  partnerDot.classList.remove("online", "offline");
  mobilePartnerDot.classList.remove("online", "offline");

  partnerDot.classList.add(isOnline ? "online" : "offline");
  mobilePartnerDot.classList.add(isOnline ? "online" : "offline");
}

function resetPresence() {
  setPresenceOnline(false);
}

function stopRealtime() {
  if (activeChannel) {
    try {
      activeChannel.untrack();
    } catch (_) {}

    supabaseClient.removeChannel(activeChannel);
    activeChannel = null;
  }
}

async function handleMessageSubmit(e) {
  e.preventDefault();
  initAudio();

  const text = messageInput.value.trim();

  if (!text) return;

  if (!currentProfile?.id || !otherProfile?.id) {
    alert("Profil bağlantısı hazır deyil.");
    return;
  }

  if (editingMessageId) {
    const { error } = await supabaseClient
      .from("messages")
      .update({
        content: text,
        edited: true,
        edited_at: new Date().toISOString()
      })
      .eq("id", editingMessageId)
      .eq("sender_id", currentProfile.id);

    if (error) {
      alert(`Mesaj redaktə olunmadı: ${error.message}`);
      return;
    }

    cancelEditMode();
    messageInput.value = "";
    await loadMessages(true);
    return;
  }

  const { error } = await supabaseClient
    .from("messages")
    .insert({
      sender_id: currentProfile.id,
      receiver_id: otherProfile.id,
      message_type: "text",
      content: text
    });

  if (error) {
    alert(`Mesaj göndərilmədi: ${error.message}`);
    return;
  }

  messageInput.value = "";
}

async function markMessagesAsRead(existingMessages = null) {
  if (document.hidden || !currentProfile?.id || !otherProfile?.id) return;

  const messages = existingMessages || [];
  const hasUnreadIncoming = messages.some(
    (msg) => msg.sender_id === otherProfile.id && msg.receiver_id === currentProfile.id && !msg.read_at
  );

  if (!hasUnreadIncoming && existingMessages) return;

  const { error } = await supabaseClient.rpc("mark_conversation_read", {
    p_other_user: otherProfile.id
  });

  if (error) {
    console.error("READ RPC ERROR:", error);
  }
}

function renderMessages(messages) {
  if (!messages.length) {
    messagesEl.innerHTML = `
      <div class="empty-state">
        <h4>Secure channel hazırdır</h4>
        <p>İlk mesajı göndər və əlaqəni başlat.</p>
      </div>
    `;
    return;
  }

  messagesEl.innerHTML = messages
    .map((msg) => {
      const mine = msg.sender_id === currentProfile.id;
      const time = formatTime(msg.created_at);
      const editedLabel = msg.edited ? `<span>redaktə edildi</span>` : "";
      const safeText = escapeHtml(msg.content || "");

      let statusHtml = "";
      if (mine) {
        const isRead = !!msg.read_at;
        statusHtml = `
          <span class="message-status ${isRead ? "read" : "sent"}">
            <span class="tick">${isRead ? "✓✓" : "✓"}</span>
            <span>${isRead ? "oxundu" : "göndərildi"}</span>
          </span>
        `;
      }

      return `
        <div class="message-row ${mine ? "mine" : ""}">
          <div class="message-bubble">
            <div class="message-text">${safeText}</div>
            <div class="message-meta">
              <span>${time}</span>
              ${editedLabel}
              ${statusHtml}
            </div>
            ${
              mine
                ? `
                  <div class="message-actions">
                    <button
                      class="action-btn"
                      data-edit-id="${msg.id}"
                      data-text="${escapeAttribute(msg.content || "")}"
                    >
                      Redaktə et
                    </button>
                    <button
                      class="action-btn delete"
                      data-delete-id="${msg.id}"
                    >
                      Sil
                    </button>
                  </div>
                `
                : ""
            }
          </div>
        </div>
      `;
    })
    .join("");

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function startEditMode(id, text) {
  editingMessageId = id;
  editorTextPreview.textContent = text;
  editorBanner.classList.remove("hidden");
  messageInput.value = text;
  messageInput.focus();
}

function cancelEditMode() {
  editingMessageId = null;
  editorBanner.classList.add("hidden");
  editorTextPreview.textContent = "—";
  messageInput.value = "";
}

async function deleteMessage(id) {
  const ok = confirm("Bu mesaj silinsin?");
  if (!ok) return;

  const { error } = await supabaseClient
    .from("messages")
    .delete()
    .eq("id", id)
    .eq("sender_id", currentProfile.id);

  if (error) {
    alert(`Mesaj silinmədi: ${error.message}`);
    return;
  }

  if (editingMessageId === id) {
    cancelEditMode();
  }

  await loadMessages(true);
}

function showLogin() {
  loginScreen.classList.add("active");
  chatScreen.classList.remove("active");
}

function showChat() {
  chatScreen.classList.add("active");
  loginScreen.classList.remove("active");
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("az-AZ", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function initAudio() {
  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      audioContext = new AudioCtx();
    }
  }

  if (audioContext && audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
}

function playSoftTone(type = "send") {
  if (!audioContext) return;

  const now = audioContext.currentTime;
  const gain = audioContext.createGain();
  gain.connect(audioContext.destination);
  gain.gain.setValueAtTime(0.0001, now);

  const osc1 = audioContext.createOscillator();
  const osc2 = audioContext.createOscillator();

  osc1.type = "sine";
  osc2.type = "triangle";

  if (type === "send") {
    osc1.frequency.setValueAtTime(740, now);
    osc2.frequency.setValueAtTime(920, now + 0.01);
  } else {
    osc1.frequency.setValueAtTime(520, now);
    osc2.frequency.setValueAtTime(680, now + 0.01);
  }

  osc1.connect(gain);
  osc2.connect(gain);

  gain.gain.exponentialRampToValueAtTime(0.022, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);

  osc1.start(now);
  osc2.start(now + 0.01);
  osc1.stop(now + 0.18);
  osc2.stop(now + 0.18);
}

function setAvatar(container, email) {
  const key = (email || "").toLowerCase().includes("nara") ? "nara" : "ebiss";
  const svg = key === "nara" ? getNaraAvatarSvg() : getEbissAvatarSvg();
  container.innerHTML = `<img alt="${key} avatar" src="${svg}" />`;
}

function getNaraAvatarSvg() {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
    <defs>
      <linearGradient id="bg1" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0b1715"/>
        <stop offset="100%" stop-color="#10262a"/>
      </linearGradient>
      <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#49ff98"/>
        <stop offset="100%" stop-color="#2ce6ff"/>
      </linearGradient>
    </defs>
    <rect width="120" height="120" rx="22" fill="url(#bg1)"/>
    <circle cx="60" cy="60" r="36" fill="none" stroke="rgba(73,255,152,0.22)" />
    <path d="M24 94c8-26 18-44 36-52 18 8 28 26 36 52" fill="#091110" stroke="url(#g1)" stroke-width="2"/>
    <path d="M39 55c6-18 16-28 21-28s15 10 21 28c-4 12-11 22-21 22s-17-10-21-22Z" fill="#0a1412" stroke="#49ff98" stroke-width="2"/>
    <path d="M47 56h10" stroke="#2ce6ff" stroke-width="3" stroke-linecap="round"/>
    <path d="M63 56h10" stroke="#2ce6ff" stroke-width="3" stroke-linecap="round"/>
    <path d="M36 46c8-20 16-31 24-31 8 0 16 11 24 31" fill="none" stroke="#49ff98" stroke-width="2"/>
    <path d="M49 71c5 4 17 4 22 0" stroke="#49ff98" stroke-width="2" fill="none" stroke-linecap="round"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function getEbissAvatarSvg() {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
    <defs>
      <linearGradient id="bg2" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0a1013"/>
        <stop offset="100%" stop-color="#0c1e25"/>
      </linearGradient>
      <linearGradient id="g2" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#2ce6ff"/>
        <stop offset="100%" stop-color="#49ff98"/>
      </linearGradient>
    </defs>
    <rect width="120" height="120" rx="22" fill="url(#bg2)"/>
    <circle cx="60" cy="60" r="36" fill="none" stroke="rgba(44,230,255,0.22)" />
    <path d="M22 96c10-24 22-40 38-46 16 6 28 22 38 46" fill="#0a1010" stroke="url(#g2)" stroke-width="2"/>
    <path d="M41 50c5-17 12-27 19-29 7 2 14 12 19 29-3 14-10 24-19 24s-16-10-19-24Z" fill="#0a1415" stroke="#2ce6ff" stroke-width="2"/>
    <path d="M46 53h10" stroke="#49ff98" stroke-width="3" stroke-linecap="round"/>
    <path d="M64 53h10" stroke="#49ff98" stroke-width="3" stroke-linecap="round"/>
    <path d="M40 36l20-12 20 12" fill="none" stroke="#2ce6ff" stroke-width="2"/>
    <path d="M50 71h20" stroke="#2ce6ff" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
