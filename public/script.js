const socket = io();

// ================= DEBUG =================
const DEBUG = true;
const dlog = (...a) => DEBUG && console.log("[P2P]", ...a);

let fileQueue = [];
let sending = false;



// ================= Queue UI (NO HTML change) =================
// Shows selected/sending/pending files inside the Send File card area
let queueWrap = null;
let queueListEl = null;
let queueCountEl = null;

function ensureQueueUI() {
  if (queueWrap && queueListEl && queueCountEl) return;
  if (!fileInput) return;

  // Place near file input (inside same card/section)
  const host = fileInput.closest(".card") || fileInput.parentElement || document.body;

  queueWrap = document.createElement("div");
  queueWrap.style.marginTop = "10px";

  queueWrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="font-weight:800;">📦 Queue</div>
      <div id="queueCount" style="opacity:.7;font-size:12px;">0</div>
    </div>
    <div id="queueList" style="
      margin-top:8px;
      max-height:140px;
      overflow:auto;
      border:1px solid rgba(0,0,0,.10);
      border-radius:12px;
      padding:8px;
      background: rgba(255,255,255,.6);
    "></div>
  `;

  queueListEl = queueWrap.querySelector("#queueList");
  queueCountEl = queueWrap.querySelector("#queueCount");
  host.appendChild(queueWrap);
}

function renderQueueUI(currentFile = null) {
  if (!fileInput) return;
  ensureQueueUI();
  if (!queueListEl || !queueCountEl) return;

  const total = fileQueue.length + (currentFile ? 1 : 0);
  queueCountEl.innerText = `${total} file(s)`;

  const items = [];

  if (currentFile) {
    items.push(`
      <div style="padding:6px 8px;border-radius:10px;background:rgba(255,210,120,.25);margin-bottom:6px;">
        ▶️ <b>Sending:</b> ${currentFile.name}
        <span style="opacity:.7">(${fmtBytes(currentFile.size)})</span>
      </div>
    `);
  }

  if (fileQueue.length === 0 && !currentFile) {
    items.push(`<div style="opacity:.7;padding:6px 8px;">No files in queue</div>`);
  } else {
    fileQueue.forEach((f, i) => {
      items.push(`
        <div style="padding:6px 8px;border-radius:10px;background:rgba(0,0,0,.03);margin-bottom:6px;">
          ${i + 1}. ${f.name} <span style="opacity:.7">(${fmtBytes(f.size)})</span>
        </div>
      `);
    });
  }

  queueListEl.innerHTML = items.join("");
}


// ================= Receiver Queue UI + Auto-Accept (NO HTML change) =================
// First incoming file asks for Accept. After you accept once, it auto-accepts remaining files in this room session.
let recvQueueWrap = null;
let recvQueueListEl = null;
let recvQueueCountEl = null;

// histories (for grey "done" tracking)
const sentHistory = [];   // {id,name,size,state,done,total}
const recvHistory = [];   // {id,name,size,state,done,total}

// auto-accept flag (per room session)
let autoAcceptThisRoom = false;

function autoAcceptKey() {
  return `autoAccept:${currentRoom || ""}`;
}

function loadAutoAcceptFlag() {
  try { autoAcceptThisRoom = sessionStorage.getItem(autoAcceptKey()) === "1"; } catch { autoAcceptThisRoom = false; }
}

function saveAutoAcceptFlag(v) {
  autoAcceptThisRoom = !!v;
  try { sessionStorage.setItem(autoAcceptKey(), v ? "1" : "0"); } catch {}
}

function ensureRecvQueueUI() {
  if (recvQueueWrap && recvQueueListEl && recvQueueCountEl) return;
  if (!fileInput) return;

  const host = fileInput.closest(".card") || fileInput.parentElement || document.body;

  recvQueueWrap = document.createElement("div");
  recvQueueWrap.style.marginTop = "10px";

  recvQueueWrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div style="font-weight:800;">📥 Receiver Queue</div>
      <div id="recvQueueCount" style="opacity:.7;font-size:12px;">0</div>
    </div>
    <div id="recvQueueList" style="
      margin-top:8px;
      max-height:140px;
      overflow:auto;
      border:1px solid rgba(0,0,0,.10);
      border-radius:12px;
      padding:8px;
      background: rgba(255,255,255,.6);
    "></div>
  `;

  recvQueueListEl = recvQueueWrap.querySelector("#recvQueueList");
  recvQueueCountEl = recvQueueWrap.querySelector("#recvQueueCount");
  host.appendChild(recvQueueWrap);
}

function renderRecvQueueUI() {
  if (!fileInput) return;
  ensureRecvQueueUI();
  if (!recvQueueListEl || !recvQueueCountEl) return;

  const pending = recvHistory.filter(x => x.state === "pending" || x.state === "receiving");
  const done = recvHistory.filter(x => x.state === "done" || x.state === "canceled");

  const total = pending.length + done.length;
  recvQueueCountEl.innerText = `${total} file(s)`;

  const items = [];

  pending.forEach((it) => {
    const pct = it.total ? Math.floor((it.done / it.total) * 100) : 0;
    const bar = `<div style="height:8px;border-radius:999px;background:rgba(0,0,0,.08);overflow:hidden;margin-top:6px;">
      <div style="height:100%;width:${Math.min(100,pct)}%;background:linear-gradient(90deg,#ff4d6d,#ffa63d);"></div>
    </div>`;
    items.push(`
      <div style="padding:8px 10px;border-radius:12px;background:rgba(255,210,120,.18);margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;gap:10px;">
          <div style="font-weight:700;">${it.state === "receiving" ? "⬇️ Receiving" : "🕒 Pending"}: ${it.name}</div>
          <div style="opacity:.7;font-size:12px;">${fmtBytes(it.size)}</div>
        </div>
        <div style="opacity:.75;font-size:12px;margin-top:4px;">${pct}% (${fmtBytes(it.done)} / ${fmtBytes(it.total)})</div>
        ${bar}
      </div>
    `);
  });

  done.forEach((it) => {
    const label = it.state === "done" ? "✅ Received" : "❌ Canceled";
    items.push(`
      <div style="padding:8px 10px;border-radius:12px;background:rgba(0,0,0,.06);margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;gap:10px;">
          <div style="font-weight:700;color:#555;">${label}: ${it.name}</div>
          <div style="opacity:.7;font-size:12px;color:#555;">${fmtBytes(it.size)}</div>
        </div>
      </div>
    `);
  });

  if (items.length === 0) items.push(`<div style="opacity:.7;padding:6px 8px;">No received files yet</div>`);
  recvQueueListEl.innerHTML = items.join("");
}

function upsertSentItem(id, name, size, state, done = 0, total = size || 0) {
  if (!id) id = `${name}|${size}`;
  let it = sentHistory.find(x => x.id === id);
  if (!it) { it = { id, name, size, state, done, total }; sentHistory.push(it); }
  it.name = name; it.size = size; it.state = state;
  it.done = Math.max(it.done || 0, done || 0);
  it.total = total || it.total || size || 0;
  return it;
}

function upsertRecvItem(id, name, size, state, done = 0, total = size || 0) {
  if (!id) id = `${name}|${size}`;
  let it = recvHistory.find(x => x.id === id);
  if (!it) { it = { id, name, size, state, done, total }; recvHistory.push(it); }
  it.name = name; it.size = size; it.state = state;
  it.done = Math.max(it.done || 0, done || 0);
  it.total = total || it.total || size || 0;
  return it;
}

function enqueueFilesForSend(files) {
  const arr = Array.from(files || []);
  if (!arr.length) return;

  arr.forEach((file) => {
    try { file._qid = file._qid || (crypto?.randomUUID ? crypto.randomUUID() : (Date.now() + "-" + Math.random())); }
    catch { file._qid = file._qid || (Date.now() + "-" + Math.random()); }

    fileQueue.push(file);
    upsertSentItem(file._qid, file.name, file.size, "queued", 0, file.size);
    addMsg(`<span class="muted">📤 Selected: ${file.name} (${fmtBytes(file.size)})</span>`);
  });

  try { renderQueueUI(sending ? outgoingFile : null); } catch {}
  startNextFile();
}

function enableDragDrop() {
  if (!fileInput) return;
  const host = fileInput.closest(".card") || fileInput.parentElement || document.body;

  let overlay = document.getElementById("dropOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "dropOverlay";
    overlay.style.cssText = "position:relative;margin-top:10px;border:2px dashed rgba(0,0,0,.18);border-radius:16px;padding:14px;text-align:center;opacity:.75;user-select:none;";
    overlay.innerHTML = "🖱 Drag & Drop files here";
    host.appendChild(overlay);
  }

  const onDragOver = (e) => { e.preventDefault(); overlay.style.opacity = "1"; overlay.style.borderColor = "rgba(255,140,60,.7)"; };
  const onDragLeave = () => { overlay.style.opacity = ".75"; overlay.style.borderColor = "rgba(0,0,0,.18)"; };
  const onDrop = (e) => {
    e.preventDefault();
    onDragLeave();
    if (!currentRoom) {
      alert("Please create or join a room first.");
      return;
    }
    const files = e.dataTransfer?.files;
    if (files && files.length) enqueueFilesForSend(files);
  };

  overlay.addEventListener("dragover", onDragOver);
  overlay.addEventListener("dragleave", onDragLeave);
  overlay.addEventListener("drop", onDrop);
}
// UI
const joinBtn = document.getElementById("joinBtn");
const createBtn = document.getElementById("createBtn");
const roomInput = document.getElementById("roomId");
const statusText = document.getElementById("status");
const connDot = document.getElementById("connDot");
const roomHint = document.getElementById("roomHint");

// ✅ device name input
const deviceNameInput = document.getElementById("deviceName");

const chatSection = document.getElementById("chatSection");
const chatBox = document.getElementById("chatBox");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

const fileInput = document.getElementById("fileInput");
// ✅ Drag & Drop support
setTimeout(() => { try { enableDragDrop(); } catch {} }, 0);
const fileStatus = document.getElementById("fileStatus");
const progressBar = document.getElementById("progressBar");
const speedText = document.getElementById("speedText");
const progressText = document.getElementById("progressText");
const etaText = document.getElementById("etaText");

const pauseBtn = document.getElementById("pauseBtn");
const resumeBtn = document.getElementById("resumeBtn");
const cancelBtn = document.getElementById("cancelBtn");

// Modal
const modalBg = document.getElementById("modalBg");
const modalInfo = document.getElementById("modalInfo");
const acceptBtn = document.getElementById("acceptBtn");
const rejectBtn = document.getElementById("rejectBtn");

// ================= Device Name (no random names) =================
function defaultDeviceName() {
  const ua = navigator.userAgent || "";
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
  const platform =
    (navigator.userAgentData && navigator.userAgentData.platform) ||
    navigator.platform ||
    "Device";

  const browser =
    ua.includes("Edg") ? "Edge" :
      ua.includes("Chrome") ? "Chrome" :
        ua.includes("Firefox") ? "Firefox" :
          ua.includes("Safari") ? "Safari" : "Browser";

  return `${isMobile ? "Phone" : "PC"}-${browser}-${platform}`;
}

function getDeviceName() {
  const v = (deviceNameInput?.value || "").trim();
  return v || defaultDeviceName();
}

try { ensureQueueUI(); ensureRecvQueueUI(); } catch {}

if (deviceNameInput) {
  deviceNameInput.value =
    localStorage.getItem("deviceName") || defaultDeviceName();
  deviceNameInput.addEventListener("input", () => {
    localStorage.setItem("deviceName", getDeviceName());
  });
}

// ================= WhatsApp-like Chat UI (NO HTML change) =================
(function injectChatStyles() {
  const css = `
    #chatBox { padding: 10px; }
    .msgRow { display:flex; margin: 6px 0; }
    .msgRow.mine { justify-content:flex-end; }
    .msgRow.other { justify-content:flex-start; }
    .bubble {
      max-width: 72%;
      padding: 10px 12px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.25;
      box-shadow: 0 6px 14px rgba(0,0,0,.08);
      word-break: break-word;
    }
    .bubble.mine { background: rgba(220,248,198,.95); }
    .bubble.other { background: rgba(255,255,255,.92); }
    .bubble .name { font-weight: 800; font-size: 12px; opacity: .75; margin-bottom: 4px; }
    .typingLine { font-size: 13px; opacity: .75; padding: 6px 10px; }
  `;
  const style = document.createElement("style");
  style.innerHTML = css;
  document.head.appendChild(style);
})();

// Typing indicator (NO HTML change)
const typingLine = document.createElement("div");
typingLine.className = "typingLine";
typingLine.style.display = "none";
if (chatSection) chatSection.appendChild(typingLine);

function showTyping(text) {
  typingLine.innerText = text;
  typingLine.style.display = text ? "block" : "none";
}

// Helpers
function addMsg(html) {
  const div = document.createElement("div");
  div.className = "msg";
  div.innerHTML = html;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function addChatBubble({ user, text, mine }) {
  const row = document.createElement("div");
  row.className = `msgRow ${mine ? "mine" : "other"}`;

  const bubble = document.createElement("div");
  bubble.className = `bubble ${mine ? "mine" : "other"}`;

  bubble.innerHTML = `
    <div class="name">${user}</div>
    <div class="text">${text}</div>
  `;

  row.appendChild(bubble);
  chatBox.appendChild(row);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function fmtBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}
function formatETA(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return "--";
  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60);
  return `${mm}m ${ss}s`;
}
function resetTransferUI() {
  progressBar.value = 0;
  speedText.innerText = "Speed: 0 MB/s";
  progressText.innerText = "0% (0 B / 0 B)";
  etaText.innerText = "Remaining: --";
  pauseBtn.disabled = true;
  resumeBtn.disabled = true;
  cancelBtn.disabled = true;
}
function setStatus(text) { fileStatus.innerText = text; }
function setConnectedUI(isConnected, msg, hint = "") {
  connDot.classList.toggle("green", !!isConnected);
  statusText.innerText = msg || (isConnected ? "Connected" : "Not Connected");
  roomHint.innerText = hint || "";
}
function setProgressBytes(doneBytes, totalBytes) {
  const pct = totalBytes > 0 ? Math.floor((doneBytes / totalBytes) * 100) : 0;
  progressBar.value = Math.min(100, pct);
  progressText.innerText = `${Math.min(100, pct)}% (${fmtBytes(doneBytes)} / ${fmtBytes(totalBytes)})`;
}

// ================= Room create/join =================
let currentRoom = "";
function joinRoom(roomId, mode) {
  currentRoom = roomId;

  loadAutoAcceptFlag();

  // ✅ send deviceName with join-room
  socket.emit("join-room", { roomId, deviceName: getDeviceName() });

  chatSection.style.display = "block";
  if (mode === "create") {
    setConnectedUI(false, "Room created", `Room: ${roomId} — Waiting for someone to join...`);
    addMsg(`<span class="muted">🆕 Room created: <b>${roomId}</b> (waiting...)</span>`);
  } else {
    setConnectedUI(false, "Joining...", `Room: ${roomId}`);
    addMsg(`<span class="muted">➡️ Joined room: <b>${roomId}</b></span>`);
  }
}
createBtn.onclick = () => {
  const id = Math.random().toString(36).slice(2, 8).toUpperCase();
  roomInput.value = id;
  joinRoom(id, "create");
};
joinBtn.onclick = () => {
  const room = roomInput.value.trim();
  if (!room) return;
  joinRoom(room, "join");
};
socket.on("room-status", ({ room, users }) => {
  if (room !== currentRoom) return;
  if (users >= 2) {
    setConnectedUI(true, "Connected", `Room: ${room} — Both connected`);
    addMsg(`<span class="muted">✅ Peer joined. Connected.</span>`);
  } else {
    setConnectedUI(false, "Waiting...", `Room: ${room} — Waiting for someone to join...`);
  }
});

// ================= Chat =================
let typingTimer = null;

messageInput?.addEventListener("input", () => {
  // typing start
  socket.emit("typing", { roomId: currentRoom, user: getDeviceName() });

  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket.emit("stop-typing", { roomId: currentRoom, user: getDeviceName() });
  }, 900);
});

socket.on("typing", ({ user }) => {
  if (!user) return;
  showTyping(`${user} is typing...`);
});

socket.on("stop-typing", () => {
  showTyping("");
});

sendBtn.onclick = () => {
  const message = messageInput.value.trim();
  if (!message) return;

  socket.emit("send-message", message);

  // ✅ local echo (WhatsApp right side)
  addChatBubble({ user: "You", text: message, mine: true });

  messageInput.value = "";
  socket.emit("stop-typing", { roomId: currentRoom, user: getDeviceName() });
};

// server sends user = deviceName
socket.on("receive-message", (data) => {
  // ✅ WhatsApp left side
  addChatBubble({ user: data.user || "Peer", text: data.text || "", mine: false });
});

// ================= WebRTC =================
// ✅ TURN config: aapko REAL creds Metered/Twilio dashboard se copy-paste karne honge
// (Main fake creds invent nahi kar sakta.)
// ================= WebRTC =================
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },

    {
      urls: [
        "turn:global.relay.metered.ca:80?transport=udp",
        "turn:global.relay.metered.ca:80?transport=tcp",
        "turn:global.relay.metered.ca:443?transport=tcp",
        "turns:global.relay.metered.ca:443?transport=tcp",
      ],
      username: "a8d9d73530add1b926be15b7",
      credential: "NgH88GxMUO1f4Knl",
    },
  ],
  iceTransportPolicy: "all",
};

let pc = null;
let dc = null;
let peerSocketId = null;
let pendingIncoming = null;
let outgoingFile = null;

let fileWorker = null;

// Tuning
// Tuning (LAN + WAN both)
const CHUNK_SIZE = 256 * 1024;          // ✅ 64KB -> 256KB
const BUFFER_LOW = 8 * 1024 * 1024;     // ✅ 4MB -> 8MB
const BUFFER_MAX = 64 * 1024 * 1024;    // ✅ 12MB -> 64MB
const ACK_EVERY_BYTES = 4 * 1024 * 1024; // ✅ 1MB -> 4MB

// IMPORTANT: memory limit
const MEMORY_MAX_BYTES = 300 * 1024 * 1024;

// Graceful close flags
let gracefulClosing = false;
let transferCompleted = false;

// Sender state
let sendState = {
  running: false,
  paused: false,
  canceled: false,
  offset: 0,
  file: null,
  ackBytes: 0,
  lastAckTickT: 0,
  lastAckTickB: 0,
  ackEma: 0,
  gotComplete: false,
};

// Receiver state
let incomingFile = null;

// watchdog timer id
let doneResendTimer = null;
// last status from receiver
let lastStatusRes = null;

// ===== READY handshake (fix 99% stuck) =====
let receiverReady = false;
let receiverReadyResolver = null;
function resetReceiverReady() {
  receiverReady = false;
  receiverReadyResolver = null;
}
function waitReceiverReady(timeoutMs = 120000) {
  if (receiverReady) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    receiverReadyResolver = (ok) => {
      clearTimeout(t);
      resolve(!!ok);
    };
  });
}
function markReceiverReady(ok = true) {
  receiverReady = !!ok;
  if (receiverReadyResolver) {
    const r = receiverReadyResolver;
    receiverReadyResolver = null;
    r(!!ok);
  }
}

// retry guard
let retryInProgress = false;

// Buttons
pauseBtn.onclick = () => {
  if (!sendState.running) return;
  sendState.paused = true;
  pauseBtn.disabled = true;
  resumeBtn.disabled = false;
  setStatus("⏸ Paused");
  try { fileWorker?.postMessage({ type: "pause" }); } catch { }
};
resumeBtn.onclick = () => {
  if (!sendState.running) return;
  sendState.paused = false;
  pauseBtn.disabled = false;
  resumeBtn.disabled = true;
  setStatus(`Sending: ${sendState.file?.name || ""}`);
  try {
    fileWorker?.postMessage({ type: "resume" });
    fileWorker?.postMessage({ type: "pull" });
  } catch { }
};
cancelBtn.onclick = () => cancelTransfer("You canceled transfer", true, getDeviceName());

function safeClosePeer() {
  gracefulClosing = true;
  try { dc?.close(); } catch { }
  try { pc?.close(); } catch { }
  dc = null;
  pc = null;
  peerSocketId = null;

  if (doneResendTimer) {
    clearInterval(doneResendTimer);
    doneResendTimer = null;
  }

  resetReceiverReady();
  retryInProgress = false;
  setTimeout(() => (gracefulClosing = false), 800);
}

function cancelTransfer(reason, notifyPeer, canceledBy) {
  if (transferCompleted) return;

  if (doneResendTimer) {
    clearInterval(doneResendTimer);
    doneResendTimer = null;
  }

  markReceiverReady(false);

  if (sendState.running) {
    sendState.canceled = true;
    try { fileWorker?.postMessage({ type: "cancel" }); } catch { }
    try { if (dc?.readyState === "open") dc.send(JSON.stringify({ type: "cancel", by: canceledBy || getDeviceName() })); } catch { }
    if (notifyPeer && peerSocketId) {
      try { socket.emit("file-cancel", { to: peerSocketId, by: canceledBy || getDeviceName(), reason }); } catch { }
    }
  }

  incomingFile = null;
  setStatus("❌ Transfer canceled");
  resetTransferUI();
  safeClosePeer();
  addMsg(`<span class="muted">❌ ${reason}</span>`);
  try {
    const f = sendState?.file || outgoingFile;
    if (f) upsertSentItem(f._qid || `${f.name}|${f.size}`, f.name, f.size, "canceled", sendState?.ackBytes || 0, f.size);
    renderQueueUI(null);
    renderRecvQueueUI();
  } catch {}
  try { renderQueueUI(null); } catch {}
}

socket.on("file-cancel", (data) => {
  if (transferCompleted) return;
  const by = data?.by || "Peer";
  cancelTransfer(`${by} canceled transfer`, false);
});

// ===== Extra log helpers (exact reason) =====
async function logSelectedCandidatePair(tag = "") {
  try {
    if (!pc) return;
    const stats = await pc.getStats();
    let selectedPair = null;

    stats.forEach((r) => {
      if (r.type === "transport" && r.selectedCandidatePairId) {
        selectedPair = stats.get(r.selectedCandidatePairId);
      }
    });

    if (!selectedPair) return;

    const local = stats.get(selectedPair.localCandidateId);
    const remote = stats.get(selectedPair.remoteCandidateId);

    console.log("[P2P][SELECTED_PAIR]" + (tag ? `(${tag})` : ""), {
      state: selectedPair.state,
      localType: local?.candidateType,
      localProtocol: local?.protocol,
      localAddress: local?.address,
      remoteType: remote?.candidateType,
      remoteProtocol: remote?.protocol,
      remoteAddress: remote?.address,
      nominated: selectedPair.nominated,
      currentRoundTripTime: selectedPair.currentRoundTripTime,
      availableOutgoingBitrate: selectedPair.availableOutgoingBitrate,
      bytesSent: selectedPair.bytesSent,
      bytesReceived: selectedPair.bytesReceived,
    });
  } catch (e) {
    console.log("[P2P] logSelectedCandidatePair error", e);
  }
}

// Peer connection
async function createPeerConnection() {
  pc = new RTCPeerConnection(RTC_CONFIG);

  pc.onicegatheringstatechange = () => {
    console.log("[P2P] iceGatheringState:", pc.iceGatheringState);
  };

  pc.oniceconnectionstatechange = () => {
    console.log("[P2P] iceConnectionState:", pc.iceConnectionState);

    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      logSelectedCandidatePair("ice");
    }
    if (pc.iceConnectionState === "failed") {
      addMsg(`<span class="muted">⚠️ ICE failed. TURN required on many networks. Check TURN creds.</span>`);
    }
  };

  // auto-retry on failed (kept minimal)
  pc.onconnectionstatechange = () => {
    console.log("[P2P] connectionState:", pc.connectionState);

    if (pc.connectionState === "connected") {
      setTimeout(() => logSelectedCandidatePair("after-connect"), 600);
    }

    if (pc.connectionState === "connected") {
      logSelectedCandidatePair("conn");
    }

    if (pc.connectionState === "failed") {
      addMsg(`<span class="muted">⚠️ Connection failed. Retrying...</span>`);

      if (retryInProgress) return;
      retryInProgress = true;

      try { dc?.close(); } catch { }
      try { pc?.close(); } catch { }
      dc = null;
      pc = null;

      if (peerSocketId && !transferCompleted && !sendState.canceled) {
        setTimeout(() => {
          makeOfferAndConnect()
            .then(() => { retryInProgress = false; })
            .catch(() => { retryInProgress = false; });
        }, 900);
      } else {
        retryInProgress = false;
      }
    }
  };

  pc.onicecandidate = (e) => {
    if (e.candidate && peerSocketId) {
      console.log("[P2P] ICE candidate:", e.candidate.candidate);
      socket.emit("webrtc-ice", { to: peerSocketId, candidate: e.candidate });
    } else {
      console.log("[P2P] ICE gathering complete");
    }
  };

  pc.onicecandidateerror = (e) => {
    console.log("[P2P] icecandidateerror:", e?.errorCode, e?.errorText, e?.url);
  };

  pc.ondatachannel = (event) => {
    dc = event.channel;
    setupDataChannel();
  };
}

function setupDataChannel() {
  if (!dc) return;

  dc.binaryType = "arraybuffer";
  dc.bufferedAmountLowThreshold = BUFFER_LOW;

  dc.onerror = (e) => {
    console.log("[P2P] dc.onerror", e);
  };

  dc.onopen = () => {
    dlog("DataChannel open");
    addMsg(`<span class="muted">✅ DataChannel open (P2P ready)</span>`);
    if (outgoingFile) sendFile(outgoingFile).catch(console.error);
  };

  dc.onclose = () => {
    dlog("DataChannel closed");
    addMsg(`<span class="muted">⚠️ DataChannel closed</span>`);
    if (gracefulClosing || transferCompleted) return;
    if (sendState.running && !sendState.canceled) cancelTransfer("Connection closed", true);
  };

  dc.onmessage = async (event) => {
    if (typeof event.data === "string") {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === "meta") {
        dlog("RX meta", msg.meta);
        await startReceiver(msg.meta);
        return;
      }

      if (msg.type === "ready") {
        dlog("RX ready", msg);
        markReceiverReady(true);
        return;
      }

      if (msg.type === "ack") {
        if (sendState.running) {
          sendState.ackBytes = Math.max(sendState.ackBytes, msg.bytes || 0);
          updateSenderUIByAck();
        }
        return;
      }

      if (msg.type === "status-res") {
        lastStatusRes = msg;
        dlog("RX status-res", msg);
        return;
      }

      if (msg.type === "status-req") {
        const r = incomingFile
          ? { receivedBytes: incomingFile.receivedBytes, size: incomingFile.meta.size, sawDone: incomingFile.sawDone }
          : { receivedBytes: 0, size: 0, sawDone: false };
        try { dc.send(JSON.stringify({ type: "status-res", ...r })); } catch { }
        return;
      }

      if (msg.type === "complete") {
        dlog("RX complete");
        sendState.gotComplete = true;
        transferCompleted = true;
        setStatus(`✅ Sent: ${sendState.file?.name || ""}`);
        try {
          const f = sendState.file;
          if (f) upsertSentItem(f._qid || `${f.name}|${f.size}`, f.name, f.size, "done", f.size, f.size);
          renderQueueUI(null);
        } catch {}
        setProgressBytes(sendState.file?.size || 0, sendState.file?.size || 1);
        etaText.innerText = "Remaining: 0m 0s";

        sendState.running = false;
        outgoingFile = null;

        pauseBtn.disabled = true;
        resumeBtn.disabled = true;
        cancelBtn.disabled = true;

        sending = false;
        try { renderQueueUI(null); } catch {}
        startNextFile();

        safeClosePeer();
        return;
      }

      if (msg.type === "done") {
        dlog("RX done");
        await finalizeIncomingIfReady();
        return;
      }

      if (msg.type === "cancel") {
        dlog("RX cancel");
        try {
          const id = incomingFile?.meta?.id || `${incomingFile?.meta?.name}|${incomingFile?.meta?.size}`;
          if (id && incomingFile?.meta) { upsertRecvItem(id, incomingFile.meta.name, incomingFile.meta.size || 0, "canceled", incomingFile.receivedBytes || 0, incomingFile.meta.size || 0); renderRecvQueueUI(); }
        } catch {}
        cancelTransfer(`${msg.by || "Peer"} canceled transfer`, false);
        return;
      }
      return;
    }

    await handleIncomingChunk(event.data);
  };
}

// Signaling
async function makeOfferAndConnect() {
  await createPeerConnection();
  dc = pc.createDataChannel("file");
  setupDataChannel();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("webrtc-offer", { to: peerSocketId, sdp: pc.localDescription });
}

socket.on("webrtc-offer", async ({ from, sdp }) => {
  peerSocketId = from;
  await createPeerConnection();
  await pc.setRemoteDescription(sdp);

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("webrtc-answer", { to: from, sdp: pc.localDescription });
});

socket.on("webrtc-answer", async ({ sdp }) => {
  await pc.setRemoteDescription(sdp);
});

socket.on("webrtc-ice", async ({ candidate }) => {
  try { await pc.addIceCandidate(candidate); } catch (e) {
    console.log("[P2P] addIceCandidate error", e);
  }
});

// File offer UI
fileInput.addEventListener("change", () => {

  const files = Array.from(fileInput.files);   // ✅ multiple files

  // ✅ Queue-based multi-send
  enqueueFilesForSend(files);

  // Keep below lines as-is (no removal) but prevent double handling
  fileInput.value = "";
  return;
  if (!files.length) return;

  if (!currentRoom) {
    alert("Please create or join a room first.");
    return;
  }

  // loop through selected files
  files.forEach(file => {

    fileQueue.push(file);

    addMsg(`<span class="muted">📤 Selected: ${file.name} (${fmtBytes(file.size)})</span>`);

  });

  try { renderQueueUI(sending ? outgoingFile : null); } catch {}

  startNextFile();

});

function startNextFile() {

  if (sending) return;
  if (fileQueue.length === 0) return;

  const file = fileQueue.shift();

  sending = true;

  transferCompleted = false;
  gracefulClosing = false;
  resetReceiverReady();
  retryInProgress = false;

  outgoingFile = file;
  resetTransferUI();

  setStatus(`Waiting for receiver... (${file.name}, ${fmtBytes(file.size)})`);
  try { renderQueueUI(file); } catch {}

  socket.emit("file-offer", {
    id: file._qid || `${file.name}|${file.size}`,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream"
  });
}

// server sends fromName (device name)

socket.on("file-offer", ({ from, fromName, fromShort, meta }) => {
  pendingIncoming = { from, meta };

  try {
    const id = meta?.id || `${meta?.name}|${meta?.size}`;
    upsertRecvItem(id, meta?.name, meta?.size || 0, "pending", 0, meta?.size || 0);
    renderRecvQueueUI();
  } catch {}

  const who = fromName || fromShort || (from ? from.substring(0, 5) : "User");

  if (autoAcceptThisRoom) {
    addMsg(`<span class="muted">✅ Auto-accepted from <b>${who}</b>: ${meta.name} (${fmtBytes(meta.size)})</span>`);
    socket.emit("file-answer", { to: from, accepted: true });
    peerSocketId = from;
    pendingIncoming = null;
    modalBg.style.display = "none";
    setStatus("Auto-accepted. Connecting P2P...");
    return;
  }

  modalInfo.innerText = `From: ${who}\nFile: ${meta.name}\nSize: ${fmtBytes(meta.size)}\nType: ${meta.type}`;
  modalBg.style.display = "flex";
});


rejectBtn.onclick = () => {
  if (!pendingIncoming) return;
  socket.emit("file-answer", { to: pendingIncoming.from, accepted: false });
  try {
    const id = pendingIncoming?.meta?.id || `${pendingIncoming?.meta?.name}|${pendingIncoming?.meta?.size}`;
    if (id && pendingIncoming?.meta) { upsertRecvItem(id, pendingIncoming.meta.name, pendingIncoming.meta.size || 0, "canceled", 0, pendingIncoming.meta.size || 0); renderRecvQueueUI(); }
  } catch {}
  pendingIncoming = null;
  modalBg.style.display = "none";
};

acceptBtn.onclick = async () => {
  if (!pendingIncoming) return;

  transferCompleted = false;
  gracefulClosing = false;
  resetReceiverReady();
  retryInProgress = false;

  socket.emit("file-answer", { to: pendingIncoming.from, accepted: true });

  // ✅ After first accept, auto-accept remaining files in this room session
  if (!autoAcceptThisRoom) {
    saveAutoAcceptFlag(true);
    addMsg(`<span class="muted">✅ Auto-accept enabled for this room (next files won\'t ask again)</span>`);
  }
  peerSocketId = pendingIncoming.from;
  pendingIncoming = null;
  modalBg.style.display = "none";
  setStatus("Accepted. Connecting P2P...");
  addMsg(`<span class="muted">📥 Accepted file. Connecting P2P...</span>`);
};

socket.on("file-answer", async ({ from, accepted }) => {
  if (!accepted) {
    setStatus("Receiver rejected the file.");
    addMsg(`<span class="muted">❌ Receiver rejected.</span>`);
    outgoingFile = null;
    return;
  }
  peerSocketId = from;
  setStatus("Receiver accepted. Connecting P2P...");
  addMsg(`<span class="muted">📤 Receiver accepted. Connecting P2P...</span>`);
  await makeOfferAndConnect();
});

function waitForBufferDrain() {
  return new Promise((resolve) => {
    if (!dc) return resolve();
    if (dc.bufferedAmount <= BUFFER_LOW) return resolve();
    const iv = setInterval(() => {
      if (!dc || dc.readyState !== "open") {
        clearInterval(iv);
        resolve();
        return;
      }
      if (dc.bufferedAmount <= BUFFER_LOW) {
        clearInterval(iv);
        resolve();
      }
    }, 15);
  });
}

function waitForBufferedZero(timeoutMs = 45000) {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      if (!dc || dc.readyState !== "open") return resolve(false);
      if (dc.bufferedAmount === 0) return resolve(true);
      if (performance.now() - start > timeoutMs) return resolve(false);
      setTimeout(tick, 50);
    };
    tick();
  });
}

async function waitForAckWindow() {
  const MAX_AHEAD = 128 * 1024 * 1024;
  while (sendState.running && !sendState.canceled) {
    const ahead = sendState.offset - sendState.ackBytes;
    if (ahead <= MAX_AHEAD) return;
    await new Promise((r) => setTimeout(r, 30));
  }
}

function updateSenderUIByAck() {
  const file = sendState.file;
  if (!file) return;

  setProgressBytes(sendState.ackBytes, file.size);
  try { upsertSentItem(file._qid || `${file.name}|${file.size}`, file.name, file.size, "sending", sendState.ackBytes, file.size); renderQueueUI(file); } catch {}

  const now = performance.now();
  const dt = (now - sendState.lastAckTickT) / 1000;

  if (!sendState.lastAckTickT) {
    sendState.lastAckTickT = now;
    sendState.lastAckTickB = sendState.ackBytes;
    return;
  }

  if (dt >= 1.0) {
    const db = sendState.ackBytes - sendState.lastAckTickB;
    const inst = db / dt;
    sendState.ackEma = sendState.ackEma ? 0.8 * sendState.ackEma + 0.2 * inst : inst;

    const mbps = sendState.ackEma / 1024 / 1024;
    speedText.innerText = `Speed: ${mbps.toFixed(2)} MB/s`;

    const remaining = file.size - sendState.ackBytes;
    const etaSec = sendState.ackEma > 0 ? remaining / sendState.ackEma : NaN;
    etaText.innerText = `Remaining: ${formatETA(etaSec)}`;

    sendState.lastAckTickT = now;
    sendState.lastAckTickB = sendState.ackBytes;
  }
}

async function safeSendArrayBuffer(buf) {
  while (true) {
    if (!dc || dc.readyState !== "open") throw new Error("DataChannel not open");

    // ✅ Hard safety gate (prevents OperationError when bufferedAmount spikes)
    while (dc && dc.readyState === "open" && dc.bufferedAmount > (BUFFER_MAX - CHUNK_SIZE)) {
      await waitForBufferDrain();
      await new Promise((r) => setTimeout(r, 10));
    }

    try {
      dc.send(buf);
      return;
    } catch (err) {
      dlog("dc.send threw, bufferedAmount=", dc?.bufferedAmount, "err=", err?.name || err);
      await waitForBufferDrain();
      await new Promise((r) => setTimeout(r, 20));
      if (sendState.canceled) throw err;
    }
  }
}

// ===== Sender (PULL-BASED) =====
async function sendFile(file) {
  if (!dc || dc.readyState !== "open") return;

  resetTransferUI();
  setStatus(`Sending: ${file.name} (${fmtBytes(file.size)})`);
  addMsg(`<b>Sending:</b> ${file.name} (${fmtBytes(file.size)})`);
  dlog("sendFile start", { name: file.name, size: file.size });
  try { upsertSentItem(file._qid || `${file.name}|${file.size}`, file.name, file.size, "sending", 0, file.size); renderQueueUI(file); } catch {}

  pauseBtn.disabled = false;
  resumeBtn.disabled = true;
  cancelBtn.disabled = false;

  sendState.running = true;
  sendState.paused = false;
  sendState.canceled = false;
  sendState.offset = 0;
  sendState.file = file;
  sendState.ackBytes = 0;
  sendState.lastAckTickT = 0;
  sendState.lastAckTickB = 0;
  sendState.ackEma = 0;
  sendState.gotComplete = false;

  resetReceiverReady();
  retryInProgress = false;

  // meta
  try {
    dc.send(JSON.stringify({
      type: "meta",
      meta: { id: file._qid || `${file.name}|${file.size}`, name: file.name, size: file.size, type: file.type || "application/octet-stream" },
    }));
  } catch (e) {
    dlog("meta send failed", e);
    return;
  }

  setStatus(`Waiting receiver ready... (${file.name})`);
  const okReady = await waitReceiverReady(120000);
  if (!okReady) {
    cancelTransfer("Receiver not ready (timeout).", true);
    return;
  }
  setStatus(`Sending: ${file.name} (${fmtBytes(file.size)})`);

  if (!fileWorker) fileWorker = new Worker("worker.js");

  fileWorker.onmessage = async (e) => {
    if (!sendState.running || sendState.canceled) return;

    if (e.data.type === "chunk") {
      while (sendState.paused && !sendState.canceled) await new Promise((r) => setTimeout(r, 50));
      if (sendState.canceled) return;

      await waitForAckWindow();

      while (dc && dc.readyState === "open" && dc.bufferedAmount > BUFFER_MAX) {
        await waitForBufferDrain();
        if (sendState.canceled) return;
        if (!dc || dc.readyState !== "open") return;
      }

      try {
        await safeSendArrayBuffer(e.data.buf);
      } catch (err) {
        dlog("safeSend failed", err);
        return;
      }

      sendState.offset = Math.min(file.size, e.data.offset + e.data.buf.byteLength);

      if (!sendState.canceled && sendState.running && !sendState.paused) {
        fileWorker.postMessage({ type: "pull" });
      }
      return;
    }

    if (e.data.type === "done") {
      dlog("worker done reached", {
        bufferedAmount: dc?.bufferedAmount,
        ackBytes: sendState.ackBytes,
        size: sendState.file?.size,
      });
      if (sendState.canceled) return;

      const drained = await waitForBufferedZero(45000);
      dlog("buffer drain(0) result:", drained, { bufferedAmount: dc?.bufferedAmount });

      try {
        if (dc && dc.readyState === "open") {
          dc.send(JSON.stringify({ type: "done" }));
          dc.send(JSON.stringify({ type: "status-req" }));
        }
      } catch (e2) {
        dlog("send done/status-req failed", e2);
      }

      if (!doneResendTimer) {
        doneResendTimer = setInterval(() => {
          if (!sendState.running || sendState.canceled || sendState.gotComplete) return;

          const size = sendState.file?.size || 0;
          const recv = lastStatusRes?.receivedBytes ?? 0;
          const missing = size > 0 ? (size - recv) : 0;

          if (missing <= 0) return;

          try {
            dlog("watchdog: missing bytes -> resend done + status-req", {
              missing,
              recv,
              size,
              bufferedAmount: dc?.bufferedAmount,
            });
            if (dc?.readyState === "open") {
              dc.send(JSON.stringify({ type: "done" }));
              dc.send(JSON.stringify({ type: "status-req" }));
            }
          } catch { }
        }, 2000);
      }

      while (sendState.running && !sendState.canceled && !sendState.gotComplete) {
        await new Promise((r) => setTimeout(r, 150));
      }
      return;
    }
  };

  fileWorker.postMessage({ type: "start", file, chunkSize: CHUNK_SIZE, offset: 0 });
  fileWorker.postMessage({ type: "pull" });
}

// ===== Receiver =====
async function startReceiver(meta) {
  resetTransferUI();
  cancelBtn.disabled = false;

  const needDisk = meta.size > MEMORY_MAX_BYTES;

  incomingFile = {
    meta,
    receivedBytes: 0,
    lastAckSent: 0,
    lastT: performance.now(),
    lastB: 0,
    ema: 0,

    chunks: [],
    writable: null,
    diskQueue: [],
    diskQueueBytes: 0,
    diskWriting: false,

    sawDone: false,
    finalizing: false,
  };

  setStatus(`Receiving: ${meta.name} (${fmtBytes(meta.size)})`);
  addMsg(`<span class="muted">📥 Incoming: ${meta.name} (${fmtBytes(meta.size)})</span>`);
  addMsg(`<b>Receiving:</b> ${meta.name} (${fmtBytes(meta.size)})`);
  dlog("startReceiver", meta);
  try {
    const id = meta?.id || `${meta?.name}|${meta?.size}`;
    upsertRecvItem(id, meta.name, meta.size || 0, "receiving", 0, meta.size || 0);
    renderRecvQueueUI();
  } catch {}

  if (needDisk) {
    const canDisk = "showSaveFilePicker" in window && window.isSecureContext;
    if (!canDisk) {
      addMsg(`<span class="muted">⚠️ Large file (${fmtBytes(meta.size)}) cannot be received in memory. Use HTTPS/localhost to enable disk saving.</span>`);
      setStatus("⚠️ Large file needs disk saving (HTTPS/localhost).");
      try { dc?.send(JSON.stringify({ type: "cancel" })); } catch { }
      incomingFile = null;
      return;
    }

    try {
      const handle = await window.showSaveFilePicker({ suggestedName: meta.name });
      incomingFile.writable = await handle.createWritable();
      addMsg(`<span class="muted">💾 Large file: saving to disk (required)</span>`);
    } catch (e) {
      addMsg(`<span class="muted">❌ Save canceled. Large file cannot continue.</span>`);
      setStatus("❌ Save canceled (large file).");
      try { dc?.send(JSON.stringify({ type: "cancel" })); } catch { }
      incomingFile = null;
      return;
    }
  } else {
    addMsg(`<span class="muted">ℹ️ Saving in memory (small/medium). Download will start after complete.</span>`);
  }

  try { dc?.send(JSON.stringify({ type: "ready" })); } catch { }
}

async function flushDiskQueue() {
  if (!incomingFile?.writable) return;
  if (incomingFile.diskWriting) return;

  incomingFile.diskWriting = true;
  try {
    while (incomingFile.diskQueueBytes > 0) {
      const parts = incomingFile.diskQueue;
      incomingFile.diskQueue = [];
      incomingFile.diskQueueBytes = 0;

      const blob = new Blob(parts);
      await incomingFile.writable.write(blob);
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    incomingFile.diskWriting = false;
  }
}

async function handleIncomingChunk(buf) {
  if (!incomingFile) return;

  if (incomingFile.meta.size > MEMORY_MAX_BYTES && !incomingFile.writable) return;

  if (incomingFile.writable) {
    incomingFile.diskQueue.push(new Uint8Array(buf));
    incomingFile.diskQueueBytes += buf.byteLength;

    if (!incomingFile.diskWriting && incomingFile.diskQueueBytes >= 4 * 1024 * 1024) {
      flushDiskQueue().catch((e) => {
        dlog("Disk write failed", e);
        cancelTransfer("Disk write failed", false);
      });
    }
  } else {
    incomingFile.chunks.push(buf);
  }

  incomingFile.receivedBytes += buf.byteLength;
  setProgressBytes(incomingFile.receivedBytes, incomingFile.meta.size);
  try {
    const id = incomingFile.meta?.id || `${incomingFile.meta?.name}|${incomingFile.meta?.size}`;
    upsertRecvItem(id, incomingFile.meta.name, incomingFile.meta.size || 0, "receiving", incomingFile.receivedBytes, incomingFile.meta.size || 0);
    renderRecvQueueUI();
  } catch {}

  if (dc && dc.readyState === "open") {
    if (
      incomingFile.receivedBytes - incomingFile.lastAckSent >= ACK_EVERY_BYTES ||
      incomingFile.receivedBytes === incomingFile.meta.size
    ) {
      incomingFile.lastAckSent = incomingFile.receivedBytes;
      try {
        dc.send(JSON.stringify({ type: "ack", bytes: incomingFile.receivedBytes }));
      } catch (e) {
        dlog("ack send failed", e);
      }
    }
  }

  const now = performance.now();
  const dt = (now - incomingFile.lastT) / 1000;
  if (dt >= 1.0) {
    const db = incomingFile.receivedBytes - incomingFile.lastB;
    const inst = db / dt;
    incomingFile.ema = incomingFile.ema ? 0.8 * incomingFile.ema + 0.2 * inst : inst;

    const mbps = incomingFile.ema / 1024 / 1024;
    speedText.innerText = `Speed: ${mbps.toFixed(2)} MB/s`;

    const remaining = incomingFile.meta.size - incomingFile.receivedBytes;
    const etaSec = incomingFile.ema > 0 ? remaining / incomingFile.ema : NaN;
    etaText.innerText = `Remaining: ${formatETA(etaSec)}`;

    incomingFile.lastT = now;
    incomingFile.lastB = incomingFile.receivedBytes;
  }

  if (incomingFile.sawDone && incomingFile.receivedBytes >= incomingFile.meta.size && !incomingFile.finalizing) {
    incomingFile.finalizing = true;
    finalizeIncomingFile().catch((e) => {
      dlog("Finalize failed", e);
      cancelTransfer("Finalize failed", false);
    });
  }
}

async function finalizeIncomingIfReady() {
  if (!incomingFile) return;
  incomingFile.sawDone = true;

  if (incomingFile.receivedBytes < incomingFile.meta.size) {
    dlog("done received but bytes not complete", {
      received: incomingFile.receivedBytes,
      size: incomingFile.meta.size,
    });
    return;
  }
  if (incomingFile.finalizing) return;

  incomingFile.finalizing = true;
  await finalizeIncomingFile();
}

async function finalizeIncomingFile() {
  if (!incomingFile) return;

  try {
    if (incomingFile.writable) {
      await flushDiskQueue();
      await incomingFile.writable.close();
      setStatus(`✅ Saved: ${incomingFile.meta.name}`);
      try {
        const id = incomingFile.meta?.id || `${incomingFile.meta?.name}|${incomingFile.meta?.size}`;
        upsertRecvItem(id, incomingFile.meta.name, incomingFile.meta.size || 0, "done", incomingFile.meta.size || 0, incomingFile.meta.size || 0);
        renderRecvQueueUI();
      } catch {}
      addMsg(`<b>Saved to disk:</b> ${incomingFile.meta.name}`);
    } else {
      const blob = new Blob(incomingFile.chunks, { type: incomingFile.meta.type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = incomingFile.meta.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      setStatus(`✅ Received: ${incomingFile.meta.name}`);
      try {
        const id = incomingFile.meta?.id || `${incomingFile.meta?.name}|${incomingFile.meta?.size}`;
        upsertRecvItem(id, incomingFile.meta.name, incomingFile.meta.size || 0, "done", incomingFile.meta.size || 0, incomingFile.meta.size || 0);
        renderRecvQueueUI();
      } catch {}
      addMsg(`<b>File received:</b> ${incomingFile.meta.name}`);
    }

    transferCompleted = true;

    try { if (dc?.readyState === "open") dc.send(JSON.stringify({ type: "complete" })); } catch (e) {
      dlog("complete send failed", e);
    }

    setProgressBytes(incomingFile.meta.size, incomingFile.meta.size);
    etaText.innerText = "Remaining: 0m 0s";
    cancelBtn.disabled = true;

    safeClosePeer();
  } finally {
    incomingFile = null;
  }
}