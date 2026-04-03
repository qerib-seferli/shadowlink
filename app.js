const SUPABASE_URL = "https://oewgxawfwjqsbfoxwlti.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ld2d4YXdmd2pxc2Jmb3h3bHRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjQ0NDgsImV4cCI6MjA5MDc0MDQ0OH0.0g1OkKf4DEytyzL7Whzie0XJfdUOC7buUUT4Drilu70";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

const replyBanner = document.getElementById("replyBanner");
const replyAuthor = document.getElementById("replyAuthor");
const replyTextPreview = document.getElementById("replyTextPreview");
const cancelReplyBtn = document.getElementById("cancelReplyBtn");

const toastContainer = document.getElementById("toastContainer");

const confirmModal = document.getElementById("confirmModal");
const confirmTitle = document.getElementById("confirmTitle");
const confirmText = document.getElementById("confirmText");
const confirmCancelBtn = document.getElementById("confirmCancelBtn");
const confirmOkBtn = document.getElementById("confirmOkBtn");

const USERS = {
  "nara@shadowlink.com": {
    display_name: "NARA",
    avatarPath: "foto/N-hack.png"
  },
  "ebiss@shadowlink.com": {
    display_name: "EBISS",
    avatarPath: "foto/E-hack.png"
  }
};

let currentUser = null;
let currentProfile = null;
let otherProfile = null;
let activeChannel = null;
let editingMessageId = null;
let replyToMessage = null;
let booting = false;
let audioContext = null;
let lastKnownMessageIds = new Set();
let hasLoadedMessagesOnce = false;
let confirmResolver = null;

loginForm.addEventListener("submit", handleLogin);
messageForm.addEventListener("submit", handleMessageSubmit);
logoutBtn.addEventListener("click", handleLogout);
cancelEditBtn.addEventListener("click", cancelEditMode);
cancelReplyBtn.addEventListener("click", cancelReplyMode);
confirmCancelBtn.addEventListener("click", () => resolveConfirm(false));
confirmOkBtn.addEventListener("click", () => resolveConfirm(true));

document.addEventListener("click", async (e) => {
  initAudio();

  const editBtn = e.target.closest("[data-edit-id]");
  const deleteBtn = e.target.closest("[data-delete-id]");
  const replyBtn = e.target.closest("[data-reply-id]");

  if (replyBtn) {
    const id = Number(replyBtn.dataset.replyId);
    const text = replyBtn.dataset.text || "";
    const author = replyBtn.dataset.author || "";
    startReplyMode(id, text, author);
  }

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
initMatrix();
initGps();
init();

async function init() {
  showLogin();

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
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
      replyToMessage = null;
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

function initGps() {
  if (!navigator.geolocation) {
    hudGps.textContent = "GPS unsupported";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude.toFixed(4);
      const lon = position.coords.longitude.toFixed(4);

      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`, {
          headers: {
            "Accept": "application/json"
          }
        });
        const data = await res.json();
        const city =
          data.address?.city ||
          data.address?.town ||
          data.address?.village ||
          data.address?.state ||
          `${lat}, ${lon}`;
        hudGps.textContent = city;
      } catch {
        hudGps.textContent = `${lat}, ${lon}`;
      }
    },
    () => {
      hudGps.textContent = "Location denied";
    },
    {
      enableHighAccuracy: false,
      timeout: 7000,
      maximumAge: 60000
    }
  );
}

function initMatrix() {
  const canvas = document.getElementById("matrixCanvas");
  const ctx = canvas.getContext("2d");

  let width = 0;
  let height = 0;
  let fontSize = 18;
  let columns = 0;
  let drops = [];

  const chars = "0101010011010010010110101010010110100101100101";

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    columns = Math.floor(width / fontSize);
    drops = Array(columns).fill(1).map(() => Math.random() * -40);
  }

  function draw() {
    ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "#00ff66";
    ctx.font = `${fontSize}px Share Tech Mono`;

    for (let i = 0; i < drops.length; i++) {
      const text = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillText(text, i * fontSize, drops[i] * fontSize);

      if (drops[i] * fontSize > height && Math.random() > 0.975) {
        drops[i] = 0;
      }

      drops[i]++;
    }
  }

  resize();
  setInterval(draw, 62);
  window.addEventListener("resize", resize);
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
    showToast("Disconnect Error", error.message, "error");
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
  } catch (error) {
    loginError.textContent = `Chat yüklənmədi: ${error.message}`;
    showLogin();
  } finally {
    booting = false;
  }
}

async function loadProfiles() {
  const myEmail = (currentUser.email || "").toLowerCase();
  const otherEmail = Object.keys(USERS).find((email) => email !== myEmail);

  const { data: profiles, error } = await supabaseClient
    .from("profiles")
    .select("id, email, display_name, role, avatar_seed, created_at")
    .in("email", [myEmail, otherEmail]);

  if (error) {
    throw new Error(`profiles oxunmadı: ${error.message}`);
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
    .select("*, reply_to:reply_to_id(id, content, sender_id)")
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
    .channel("shadowlink-presence-room", {
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
        } catch {}
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
    showToast("Node Error", "Profil bağlantısı hazır deyil.", "error");
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
      showToast("Edit Error", error.message, "error");
      return;
    }

    showToast("Message Updated", "Mətn yeniləndi.", "ok");
    cancelEditMode();
    messageInput.value = "";
    await loadMessages(true);
    return;
  }

  const insertPayload = {
    sender_id: currentProfile.id,
    receiver_id: otherProfile.id,
    message_type: "text",
    content: text,
    reply_to_id: replyToMessage ? replyToMessage.id : null
  };

  const { error } = await supabaseClient
    .from("messages")
    .insert(insertPayload);

  if (error) {
    showToast("Transmit Error", error.message, "error");
    return;
  }

  messageInput.value = "";
  cancelReplyMode();
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
    console.error(error);
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

      let replyHtml = "";
      if (msg.reply_to) {
        const replyAuthorName = msg.reply_to.sender_id === currentProfile.id ? myName.textContent : partnerName.textContent;
        replyHtml = `
          <div class="reply-preview">
            <strong>${escapeHtml(replyAuthorName)}</strong>
            <p>${escapeHtml(msg.reply_to.content || "")}</p>
          </div>
        `;
      }

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

      const author = mine ? myName.textContent : partnerName.textContent;

      return `
        <div class="message-row ${mine ? "mine" : ""}">
          <div class="message-bubble">
            ${replyHtml}
            <div class="message-text">${safeText}</div>
            <div class="message-meta">
              <span>${time}</span>
              ${editedLabel}
              ${statusHtml}
            </div>
            <div class="message-actions">
              <button
                class="icon-btn"
                data-reply-id="${msg.id}"
                data-text="${escapeAttribute(msg.content || "")}"
                data-author="${escapeAttribute(author)}"
                title="Yanıtla"
                type="button"
              >↩</button>

              ${
                mine
                  ? `
                    <button
                      class="icon-btn"
                      data-edit-id="${msg.id}"
                      data-text="${escapeAttribute(msg.content || "")}"
                      title="Redaktə et"
                      type="button"
                    >✎</button>
                    <button
                      class="icon-btn delete"
                      data-delete-id="${msg.id}"
                      title="Sil"
                      type="button"
                    >⌫</button>
                  `
                  : ""
              }
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function startReplyMode(id, text, author) {
  replyToMessage = { id, text, author };
  replyAuthor.textContent = author;
  replyTextPreview.textContent = text;
  replyBanner.classList.remove("hidden");
  messageInput.focus();
}

function cancelReplyMode() {
  replyToMessage = null;
  replyBanner.classList.add("hidden");
  replyAuthor.textContent = "—";
  replyTextPreview.textContent = "—";
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
  const ok = await showConfirm(
    "Ebiss tərəfindən yetki yoxlaması",
    "Bu mesaj sistemdən silinsin? Əməliyyat geri qaytarılmaya bilər."
  );
  if (!ok) return;

  const { error } = await supabaseClient
    .from("messages")
    .delete()
    .eq("id", id)
    .eq("sender_id", currentProfile.id);

  if (error) {
    showToast("Delete Error", error.message, "error");
    return;
  }

  if (editingMessageId === id) {
    cancelEditMode();
  }

  showToast("Secure Delete", "Mesaj kanaldan çıxarıldı.", "ok");
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

function setAvatar(container, email) {
  const key = (email || "").toLowerCase();
  const path = USERS[key]?.avatarPath || "";
  container.innerHTML = `<img src="${path}" alt="avatar" />`;
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
    osc1.frequency.setValueAtTime(760, now);
    osc2.frequency.setValueAtTime(920, now + 0.01);
  } else {
    osc1.frequency.setValueAtTime(520, now);
    osc2.frequency.setValueAtTime(680, now + 0.01);
  }

  osc1.connect(gain);
  osc2.connect(gain);

  gain.gain.exponentialRampToValueAtTime(0.02, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

  osc1.start(now);
  osc2.start(now + 0.01);
  osc1.stop(now + 0.18);
  osc2.stop(now + 0.18);
}

function showToast(title, text, type = "ok") {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <p>${escapeHtml(text)}</p>
  `;
  toastContainer.appendChild(toast);

  if (type === "error") {
    toast.style.borderColor = "rgba(255,67,108,0.28)";
  }

  setTimeout(() => {
    toast.remove();
  }, 3200);
}

function showConfirm(title, text) {
  confirmTitle.textContent = title;
  confirmText.textContent = text;
  confirmModal.classList.remove("hidden");

  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function resolveConfirm(value) {
  confirmModal.classList.add("hidden");
  if (confirmResolver) {
    confirmResolver(value);
    confirmResolver = null;
  }
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
