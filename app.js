const SUPABASE_URL = "https://oewgxawfwjqsbfoxwlti.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ld2d4YXdmd2pxc2Jmb3h3bHRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjQ0NDgsImV4cCI6MjA5MDc0MDQ0OH0.0g1OkKf4DEytyzL7Whzie0XJfdUOC7buUUT4Drilu70";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
let audioContext = null;
let lastKnownMessageIds = new Set();
let hasLoadedMessagesOnce = false;

const page = document.body.dataset.page;

document.addEventListener("DOMContentLoaded", async () => {
  initMatrix();

  if (page === "login") {
    initLoginPage();
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  if (!data.session?.user) {
    window.location.href = "login.html";
    return;
  }

  currentUser = data.session.user;

  if (page === "chat") initChatPage();
  if (page === "profile") initProfilePage();
  if (page === "terminal") initTerminalPage();
  if (page === "location") initLocationPage();
  if (page === "files") initFilesPage();
  if (page === "notifications") initNotificationsPage();
  if (page === "settings") initSettingsPage();
  if (page === "academy") initAcademyPage();
});

function initLoginPage() {
  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const loginError = document.getElementById("loginError");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    initAudio();
    loginError.textContent = "";

    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;

    if (!USERS[email]) {
      loginError.textContent = "Bu istifadəçi bu sistem üçün icazəli deyil.";
      return;
    }

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
      loginError.textContent = `Giriş xətası: ${error.message}`;
      return;
    }

    window.location.href = "index.html";
  });
}

async function loadProfiles() {
  const myEmail = (currentUser.email || "").toLowerCase();
  const otherEmail = Object.keys(USERS).find((x) => x !== myEmail);

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .in("email", [myEmail, otherEmail]);

  if (error) throw error;

  currentProfile = data.find((p) => (p.email || "").toLowerCase() === myEmail);
  otherProfile = data.find((p) => (p.email || "").toLowerCase() === otherEmail);

  if (!currentProfile || !otherProfile) {
    throw new Error("Profiles tapılmadı.");
  }
}

function initCommonHud() {
  const hudClock = document.getElementById("hudClock");
  const hudGps = document.getElementById("hudGps");
  const hudCompass = document.getElementById("hudCompass");

  if (hudClock) {
    const updateClock = () => {
      hudClock.textContent = new Date().toLocaleTimeString("az-AZ", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    };
    updateClock();
    setInterval(updateClock, 1000);
  }

  if (hudCompass) {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const updateCompass = () => {
      const deg = Math.floor(Math.random() * 360);
      const dir = dirs[Math.round(deg / 45) % 8];
      hudCompass.textContent = `${deg}° ${dir}`;
    };
    updateCompass();
    setInterval(updateCompass, 2800);
  }

  if (hudGps) {
    initGps(hudGps);
  }
}

function initGps(el) {
  if (!navigator.geolocation) {
    el.textContent = "GPS off";
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      const latFixed = lat.toFixed(4);
      const lonFixed = lon.toFixed(4);

      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latFixed}&lon=${lonFixed}`, {
          headers: { "Accept": "application/json" }
        });
        const data = await res.json();
        const city =
          data.address?.city ||
          data.address?.town ||
          data.address?.village ||
          data.address?.state ||
          `${latFixed}, ${lonFixed}`;

        el.textContent = city;
        localStorage.setItem("shadowlink_city", city);

        if (currentProfile?.id) {
          await supabaseClient
            .from("profiles")
            .update({
              city_name: city,
              latitude: lat,
              longitude: lon,
              last_seen_at: new Date().toISOString()
            })
            .eq("id", currentProfile.id);
        }
      } catch {
        el.textContent = `${latFixed}, ${lonFixed}`;
      }
    },
    () => {
      el.textContent = localStorage.getItem("shadowlink_city") || "Location denied";
    },
    { enableHighAccuracy: false, timeout: 7000, maximumAge: 60000 }
  );
}

async function initChatPage() {
  await loadProfiles();
  initCommonHud();

  const myName = document.getElementById("myName");
  const chatTitle = document.getElementById("chatTitle");
  const partnerRankLine = document.getElementById("partnerRankLine");
  const partnerLastSeenLine = document.getElementById("partnerLastSeenLine");
  const myAvatarCard = document.getElementById("myAvatarCard");
  const messagesEl = document.getElementById("messages");
  const messageForm = document.getElementById("messageForm");
  const messageInput = document.getElementById("messageInput");
  const logoutBtn = document.getElementById("logoutBtn");
  const menuToggle = document.getElementById("menuToggle");
  const sideMenu = document.getElementById("sideMenu");
  const editorBanner = document.getElementById("editorBanner");
  const editorTextPreview = document.getElementById("editorTextPreview");
  const cancelEditBtn = document.getElementById("cancelEditBtn");
  const replyBanner = document.getElementById("replyBanner");
  const replyAuthor = document.getElementById("replyAuthor");
  const replyTextPreview = document.getElementById("replyTextPreview");
  const cancelReplyBtn = document.getElementById("cancelReplyBtn");

  const partnerStatusText = document.getElementById("mobilePartnerStatusText");
  const partnerDot = document.getElementById("mobilePartnerDot");

  myName.textContent = currentProfile.display_name;
  chatTitle.textContent = `${currentProfile.display_name} ↔ ${otherProfile.display_name}`;
  partnerRankLine.textContent = `${otherProfile.rank_title || "Operator"} ${buildStars(otherProfile.stars || 1)}`;
  partnerLastSeenLine.textContent = `Last seen: ${formatDateTime(otherProfile.last_seen_at)}`;
  setAvatar(myAvatarCard, currentProfile.email);

  menuToggle?.addEventListener("click", () => {
    sideMenu.classList.toggle("hidden");
  });

  logoutBtn?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "login.html";
  });

  cancelEditBtn?.addEventListener("click", () => {
    editingMessageId = null;
    editorBanner.classList.add("hidden");
    editorTextPreview.textContent = "—";
    messageInput.value = "";
  });

  cancelReplyBtn?.addEventListener("click", () => {
    replyToMessage = null;
    replyBanner.classList.add("hidden");
    replyAuthor.textContent = "—";
    replyTextPreview.textContent = "—";
  });

  document.addEventListener("click", async (e) => {
    initAudio();

    const replyBtn = e.target.closest("[data-reply-id]");
    const editBtn = e.target.closest("[data-edit-id]");
    const deleteBtn = e.target.closest("[data-delete-id]");

    if (replyBtn) {
      replyToMessage = {
        id: Number(replyBtn.dataset.replyId),
        text: replyBtn.dataset.text || "",
        author: replyBtn.dataset.author || ""
      };
      replyAuthor.textContent = replyToMessage.author;
      replyTextPreview.textContent = replyToMessage.text;
      replyBanner.classList.remove("hidden");
      messageInput.focus();
    }

    if (editBtn) {
      editingMessageId = Number(editBtn.dataset.editId);
      editorTextPreview.textContent = editBtn.dataset.text || "";
      editorBanner.classList.remove("hidden");
      messageInput.value = editBtn.dataset.text || "";
      messageInput.focus();
    }

    if (deleteBtn) {
      const ok = window.confirm("Bu mesaj sistemdən silinsin?");
      if (!ok) return;

      const { error } = await supabaseClient
        .from("messages")
        .delete()
        .eq("id", Number(deleteBtn.dataset.deleteId))
        .eq("sender_id", currentProfile.id);

      if (error) return;

      await loadMessages(messagesEl, true);
    }
  });

  messageForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    initAudio();

    const text = messageInput.value.trim();
    if (!text) return;

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

      if (error) return;

      editingMessageId = null;
      editorBanner.classList.add("hidden");
      messageInput.value = "";
      await loadMessages(messagesEl, true);
      return;
    }

    const { error } = await supabaseClient
      .from("messages")
      .insert({
        sender_id: currentProfile.id,
        receiver_id: otherProfile.id,
        message_type: "text",
        content: text,
        reply_to_id: replyToMessage ? replyToMessage.id : null
      });

    if (error) return;

    messageInput.value = "";
    replyToMessage = null;
    replyBanner.classList.add("hidden");
  });

  await loadMessages(messagesEl, true);
  subscribePresenceAndMessages(messagesEl, partnerStatusText, partnerDot, partnerLastSeenLine);
}

async function loadMessages(messagesEl, skipSound = false) {
  const { data, error } = await supabaseClient
    .from("messages")
    .select("*, reply_to:reply_to_id(id, content, sender_id), read_at")
    .or(
      `and(sender_id.eq.${currentProfile.id},receiver_id.eq.${otherProfile.id}),and(sender_id.eq.${otherProfile.id},receiver_id.eq.${currentProfile.id})`
    )
    .order("created_at", { ascending: true });

  if (error) return;

  const messages = data || [];

  if (hasLoadedMessagesOnce && !skipSound) {
    for (const msg of messages) {
      const id = String(msg.id);
      if (!lastKnownMessageIds.has(id) && msg.sender_id === otherProfile.id) {
        playSoftTone("receive");
      }
    }
  }

  messagesEl.innerHTML = messages.length
    ? messages.map((msg) => renderMessage(msg)).join("")
    : `<div class="terminal-card" style="padding:20px;text-align:center;color:var(--muted)">Secure channel hazırdır. İlk mesajı göndər.</div>`;

  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight + 300;
  });

  lastKnownMessageIds = new Set(messages.map((x) => String(x.id)));
  hasLoadedMessagesOnce = true;

  await markMessagesAsRead();
}

function renderMessage(msg) {
  const mine = msg.sender_id === currentProfile.id;
  const author = mine ? currentProfile.display_name : otherProfile.display_name;
  const replyHtml = msg.reply_to
    ? `
      <div class="reply-preview">
        <strong>${escapeHtml(msg.reply_to.sender_id === currentProfile.id ? currentProfile.display_name : otherProfile.display_name)}</strong>
        <p>${escapeHtml(msg.reply_to.content || "")}</p>
      </div>
    `
    : "";

  const statusHtml = mine
    ? `<span class="message-status ${msg.read_at ? "read" : ""}">${msg.read_at ? "✓✓ oxundu" : "✓ göndərildi"}</span>`
    : "";

  return `
    <div class="message-row ${mine ? "mine" : ""}">
      <div class="message-bubble">
        ${replyHtml}
        <div class="message-text">${escapeHtml(msg.content || "")}</div>
        <div class="message-meta">
          <span>${formatTime(msg.created_at)}</span>
          ${msg.edited ? `<span>redaktə edildi</span>` : ""}
          ${statusHtml}
        </div>
        <div class="message-actions">
          <button
            class="icon-btn"
            type="button"
            data-reply-id="${msg.id}"
            data-text="${escapeAttribute(msg.content || "")}"
            data-author="${escapeAttribute(author)}"
            title="Reply"
          >
            ${iconReply()}
          </button>
          ${
            mine
              ? `
              <button
                class="icon-btn"
                type="button"
                data-edit-id="${msg.id}"
                data-text="${escapeAttribute(msg.content || "")}"
                title="Edit"
              >
                ${iconEdit()}
              </button>
              <button
                class="icon-btn"
                type="button"
                data-delete-id="${msg.id}"
                title="Delete"
              >
                ${iconDelete()}
              </button>
            `
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

function subscribePresenceAndMessages(messagesEl, partnerStatusText, partnerDot, partnerLastSeenLine) {
  if (activeChannel) {
    try { supabaseClient.removeChannel(activeChannel); } catch {}
  }

  activeChannel = supabaseClient
    .channel("shadowlink-presence-room", { config: { presence: { key: currentProfile.id } } })
    .on("presence", { event: "sync" }, () => {
      const state = activeChannel.presenceState();
      const other = state[otherProfile.id];
      const isOnline = Array.isArray(other) && other.length > 0;

      partnerStatusText.textContent = isOnline ? "online" : "offline";
      partnerDot.classList.remove("online", "offline");
      partnerDot.classList.add(isOnline ? "online" : "offline");

      if (!isOnline) {
        partnerLastSeenLine.textContent = `Last seen: ${formatDateTime(otherProfile.last_seen_at)}`;
      }
    })
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages" },
      async (payload) => {
        if (payload.eventType === "INSERT" && payload.new?.sender_id === currentProfile.id) {
          playSoftTone("send");
        }
        await loadMessages(messagesEl, false);
      }
    )
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await activeChannel.track({
          user_id: currentProfile.id,
          online_at: new Date().toISOString()
        });

        await supabaseClient
          .from("profiles")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", currentProfile.id);
      }
    });

  setInterval(async () => {
    await supabaseClient
      .from("profiles")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", currentProfile.id);
  }, 30000);
}

async function markMessagesAsRead() {
  if (!otherProfile?.id) return;
  const { error } = await supabaseClient.rpc("mark_conversation_read", {
    p_other_user: otherProfile.id
  });
  if (error) console.error(error);
}

async function initProfilePage() {
  await loadProfiles();

  const myProfileCard = document.getElementById("myProfileCard");
  const otherProfileCard = document.getElementById("otherProfileCard");
  const fakeTrainees = document.getElementById("fakeTrainees");

  myProfileCard.innerHTML = renderProfileCard(currentProfile, true);
  otherProfileCard.innerHTML = renderProfileCard(otherProfile, false);

  fakeTrainees.innerHTML = (window.SHADOWLINK_FAKE?.trainees || []).map((t) => `
    <div class="trainee-item">
      <div class="trainee-avatar"><img src="${t.img}" alt="${escapeAttribute(t.name)}"></div>
      <div class="trainee-meta">
        <strong>${t.name}</strong>
        <p>${t.rank}</p>
        <div class="star-row">${buildStars(t.stars, true)}</div>
      </div>
    </div>
  `).join("");
}

function renderProfileCard(profile, mine) {
  const deviceInfo = navigator.userAgent.includes("Android") ? "Android Mobile" : "Secure Browser";
  const ipMask = mine ? "10.7.4.xxx" : "172.16.9.xxx";
  const city = profile.city_name || localStorage.getItem("shadowlink_city") || "Unknown";
  const title = profile.nickname || profile.display_name;
  const avatar = USERS[(profile.email || "").toLowerCase()]?.avatarPath || "";

  return `
    <div class="profile-card-main">
      <div class="avatar-card"><img src="${avatar}" alt="avatar"></div>
      <div>
        <div class="profile-name">${title}</div>
        <div class="profile-role">${profile.rank_title || "Operator"}</div>
        <div class="star-row">${buildStars(profile.stars || 1, true)}</div>
      </div>
    </div>

    <div class="profile-details">
      <div class="info-line"><span>Security Level</span><strong>${profile.security_level || "Tier-3"}</strong></div>
      <div class="info-line"><span>Last Seen</span><strong>${formatDateTime(profile.last_seen_at)}</strong></div>
      <div class="info-line"><span>GPS Location</span><strong>${city}</strong></div>
      <div class="info-line"><span>Device Info</span><strong>${deviceInfo}</strong></div>
      <div class="info-line"><span>IP / Route</span><strong>${ipMask}</strong></div>
      <div class="info-line"><span>Authority</span><strong>${mine ? "Local operator access" : "Mission-wide command access"}</strong></div>
    </div>
  `;
}

function buildStars(count, html = false) {
  const stars = "★".repeat(count);
  return html ? stars : `[${stars}]`;
}

async function initTerminalPage() {
  const out = document.getElementById("terminalOutput");
  const lines = window.SHADOWLINK_FAKE?.terminalLines || [];
  out.innerHTML = "";

  lines.forEach((line, i) => {
    setTimeout(() => {
      const div = document.createElement("div");
      div.className = "terminal-line";
      div.textContent = line;
      out.appendChild(div);
    }, i * 550);
  });
}

async function initLocationPage() {
  await loadProfiles();

  const cityEl = document.getElementById("locationCity");
  const statusEl = document.getElementById("locationStatus");
  const distanceEl = document.getElementById("locationDistance");

  cityEl.textContent = otherProfile.city_name || localStorage.getItem("shadowlink_city") || "Unknown";
  statusEl.textContent = "tracking active";

  if (
    typeof currentProfile.latitude === "number" &&
    typeof currentProfile.longitude === "number" &&
    typeof otherProfile.latitude === "number" &&
    typeof otherProfile.longitude === "number"
  ) {
    const km = haversineKm(
      currentProfile.latitude,
      currentProfile.longitude,
      otherProfile.latitude,
      otherProfile.longitude
    );
    distanceEl.textContent = `${km.toFixed(2)} km`;
  } else {
    distanceEl.textContent = "-- km";
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function initFilesPage() {
  const filesList = document.getElementById("filesList");
  const files = window.SHADOWLINK_FAKE?.files || [];
  filesList.innerHTML = files.map((f) => `
    <div class="file-item">
      <div class="icon-btn" style="pointer-events:none">${fileBadge(f.type)}</div>
      <div class="file-meta">
        <strong>${f.name}</strong>
        <p>${f.type} • ${f.size}</p>
      </div>
    </div>
  `).join("");
}

async function initNotificationsPage() {
  const box = document.getElementById("notificationList");
  const list = window.SHADOWLINK_FAKE?.notifications || [];
  box.innerHTML = list.map((n) => `
    <div class="notification-item">
      <div class="icon-btn" style="pointer-events:none">${iconBell()}</div>
      <div class="notification-meta">
        <strong>${n.title}</strong>
        <p>${n.text}</p>
      </div>
    </div>
  `).join("");
}

async function initSettingsPage() {}

async function initAcademyPage() {
  const membersBox = document.getElementById("academyMembers");
  const feedBox = document.getElementById("academyFeed");

  const members = window.SHADOWLINK_FAKE?.academyMembers || [];
  const feed = window.SHADOWLINK_FAKE?.academyFeed || [];

  if (membersBox) {
    membersBox.innerHTML = members.map((m) => `
      <div class="academy-member-item ${m.stars >= 5 ? "command-member" : ""}">
        <div class="trainee-avatar">
          <img src="${m.img}" alt="${escapeAttribute(m.name)}">
        </div>
        <div class="trainee-meta">
          <strong>${m.name}</strong>
          <p>${m.role}</p>
          <div class="academy-member-meta">
            <span class="academy-badge">${m.badge}</span>
            <span class="star-row">${"★".repeat(m.stars)}</span>
          </div>
        </div>
      </div>
    `).join("");
  }

  if (feedBox) {
    feedBox.innerHTML = feed.map((item) => `
      <div class="academy-post ${item.type === "answer" ? "academy-answer" : "academy-question"}">
        <div class="academy-post-avatar">
          <img src="${item.img}" alt="${escapeAttribute(item.author)}">
        </div>
        <div class="academy-post-body">
          <div class="academy-post-top">
            <div>
              <strong>${item.author}</strong>
              <span class="academy-post-role">${item.role}</span>
            </div>
            <div class="academy-post-side">
              <span class="academy-post-time">${item.time}</span>
              <span class="academy-post-stars">${"★".repeat(item.stars)}</span>
            </div>
          </div>
          <div class="academy-post-text">${escapeHtml(item.text)}</div>
        </div>
      </div>
    `).join("");
  }
}

function setAvatar(el, email) {
  const avatar = USERS[(email || "").toLowerCase()]?.avatarPath || "";
  el.innerHTML = `<img src="${avatar}" alt="avatar">`;
}

function initMatrix() {
  const canvas = document.getElementById("matrixCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let fontSize = 16;
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

function initAudio() {
  if (!audioContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) audioContext = new AudioCtx();
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

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(dateStr) {
  if (!dateStr) return "--";
  const d = new Date(dateStr);
  return d.toLocaleString("az-AZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function fileBadge(type) {
  const map = {
    PDF: "PDF",
    ZIP: "ZIP",
    VOICE: "AUD",
    IMAGE: "IMG",
    DOC: "DOC",
    DATA: "LOG"
  };
  return map[type] || "FILE";
}

function iconReply() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M10 8L5 12l5 4"/>
      <path d="M6 12h8a5 5 0 0 1 5 5v1"/>
    </svg>
  `;
}

function iconEdit() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M4 20h4l10-10-4-4L4 16v4z"/>
      <path d="M12 6l4 4"/>
    </svg>
  `;
}

function iconDelete() {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M4 7h16"/>
      <path d="M10 11v6"/>
      <path d="M14 11v6"/>
      <path d="M6 7l1 12h10l1-12"/>
      <path d="M9 7V4h6v3"/>
    </svg>
  `;
}

function iconBell() {
  return `
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 6 3 8H3c0-2 3-1 3-8"/>
      <path d="M10 19a2 2 0 0 0 4 0"/>
    </svg>
  `;
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
