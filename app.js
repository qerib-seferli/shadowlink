const SUPABASE_URL = "https://oewgxawfwjqsbfoxwlti.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ld2d4YXdmd2pxc2Jmb3h3bHRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUxNjQ0NDgsImV4cCI6MjA5MDc0MDQ0OH0.0g1OkKf4DEytyzL7Whzie0XJfdUOC7buUUT4Drilu70";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginScreen = document.getElementById("loginScreen");
const chatScreen = document.getElementById("chatScreen");
const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginError = document.getElementById("loginError");

const myName = document.getElementById("myName");
const partnerName = document.getElementById("partnerName");
const myAvatar = document.getElementById("myAvatar");
const partnerAvatar = document.getElementById("partnerAvatar");
const partnerStatus = document.getElementById("partnerStatus");
const chatTitle = document.getElementById("chatTitle");
const logoutBtn = document.getElementById("logoutBtn");

const messagesEl = document.getElementById("messages");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const editorBanner = document.getElementById("editorBanner");
const editorTextPreview = document.getElementById("editorTextPreview");
const cancelEditBtn = document.getElementById("cancelEditBtn");

let currentUser = null;
let currentProfile = null;
let otherProfile = null;
let activeChannel = null;
let editingMessageId = null;

const allowedEmails = ["nara@shadowlink.com", "ebiss@shadowlink.com"];

loginForm.addEventListener("submit", handleLogin);
messageForm.addEventListener("submit", handleMessageSubmit);
logoutBtn.addEventListener("click", handleLogout);
cancelEditBtn.addEventListener("click", cancelEditMode);

document.addEventListener("click", async (e) => {
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
});

init();

async function init() {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user) {
    currentUser = data.session.user;
    await bootChat();
  } else {
    showLogin();
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      currentUser = session.user;
      await bootChat();
    } else {
      currentUser = null;
      currentProfile = null;
      otherProfile = null;
      stopRealtime();
      showLogin();
    }
  });
}

async function handleLogin(e) {
  e.preventDefault();
  loginError.textContent = "";

  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value.trim();

  if (!allowedEmails.includes(email)) {
    loginError.textContent = "Bu istifadəçi bu sistem üçün icazəli deyil.";
    return;
  }

  if (!password) {
    loginError.textContent = "Şifrə boş ola bilməz.";
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  console.log("LOGIN DATA:", data);
  console.log("LOGIN ERROR:", error);

  if (error) {
  console.error("LOGIN ERROR:", error);
  loginError.textContent = `Giriş xətası: ${error.message}`;
  return;
}

  emailInput.value = "";
  passwordInput.value = "";
}

async function handleLogout() {
  await supabase.auth.signOut();
}

async function bootChat() {
  try {
    await loadProfiles();
    await loadMessages();
    subscribeMessages();
    showChat();
  } catch (error) {
  console.error("BOOT CHAT ERROR:", error);
  loginError.textContent = `Chat yüklənmədi: ${error.message}`;
  showLogin();
  }
}

async function loadProfiles() {
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) throw error;

  currentProfile = profiles.find((p) => p.id === currentUser.id);
  otherProfile = profiles.find((p) => p.id !== currentUser.id);

  if (!currentProfile || !otherProfile) {
    throw new Error("Profiles tapılmadı.");
  }

  myName.textContent = currentProfile.display_name;
  partnerName.textContent = otherProfile.display_name;
  myAvatar.textContent = currentProfile.display_name.charAt(0);
  partnerAvatar.textContent = otherProfile.display_name.charAt(0);
  partnerStatus.textContent = "secure link target";
  chatTitle.textContent = `${currentProfile.display_name} ↔ ${otherProfile.display_name}`;
}

async function loadMessages() {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${currentUser.id},receiver_id.eq.${otherProfile.id}),and(sender_id.eq.${otherProfile.id},receiver_id.eq.${currentUser.id})`
    )
    .order("created_at", { ascending: true });

  if (error) throw error;

  renderMessages(data || []);
}

function subscribeMessages() {
  stopRealtime();

  activeChannel = supabase
    .channel("shadowlink-messages")
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "messages",
      },
      async () => {
        await loadMessages();
      }
    )
    .subscribe();
}

function stopRealtime() {
  if (activeChannel) {
    supabase.removeChannel(activeChannel);
    activeChannel = null;
  }
}

async function handleMessageSubmit(e) {
  e.preventDefault();
  const text = messageInput.value.trim();

  if (!text || !currentProfile || !otherProfile) return;

  if (editingMessageId) {
    const { error } = await supabase
      .from("messages")
      .update({
        content: text,
        edited: true,
        edited_at: new Date().toISOString(),
      })
      .eq("id", editingMessageId)
      .eq("sender_id", currentUser.id);

    if (error) {
      alert("Mesaj redaktə olunmadı.");
      return;
    }

    cancelEditMode();
    messageInput.value = "";
    await loadMessages();
    return;
  }

  const { error } = await supabase.from("messages").insert({
    sender_id: currentUser.id,
    receiver_id: otherProfile.id,
    message_type: "text",
    content: text,
  });

  if (error) {
    alert("Mesaj göndərilmədi.");
    return;
  }

  messageInput.value = "";
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
      const mine = msg.sender_id === currentUser.id;
      const time = formatTime(msg.created_at);
      const editedLabel = msg.edited ? "redaktə edildi" : "";
      const safeText = escapeHtml(msg.content || "");

      return `
        <div class="message-row ${mine ? "mine" : ""}">
          <div class="message-bubble">
            <div class="message-text">${safeText}</div>
            <div class="message-meta">
              <span>${time}</span>
              ${editedLabel ? `<span>${editedLabel}</span>` : ""}
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

  const { error } = await supabase
    .from("messages")
    .delete()
    .eq("id", id)
    .eq("sender_id", currentUser.id);

  if (error) {
    alert("Mesaj silinmədi.");
    return;
  }

  if (editingMessageId === id) {
    cancelEditMode();
  }

  await loadMessages();
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
    minute: "2-digit",
  });
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
