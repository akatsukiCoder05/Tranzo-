const socket = io();

// ================= DEBUG =================
const DEBUG = true;
const dlog = (...a) => DEBUG && console.log("[P2P]", ...a);

// UI
const joinBtn = document.getElementById("joinBtn");
const createBtn = document.getElementById("createBtn");
const roomInput = document.getElementById("roomId");
const statusText = document.getElementById("status");
const connDot = document.getElementById("connDot");
const roomHint = document.getElementById("roomHint");

// ✅ NEW: device name input
const deviceNameInput = document.getElementById("deviceName");

const chatSection = document.getElementById("chatSection");
const chatBox = document.getElementById("chatBox");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

const fileInput = document.getElementById("fileInput");
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
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "Device";

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

if (deviceNameInput) {
  deviceNameInput.value = localStorage.getItem("deviceName") || defaultDeviceName();
  deviceNameInput.addEventListener("input", () => {
    localStorage.setItem("deviceName", getDeviceName());
  });
}

// Helpers
function addMsg(html) {
  const div = document.createElement("div");
  div.className = "msg";
  div.innerHTML = html;
  chatBox.appendChild(div);
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

  // ✅ CHANGED: send deviceName with join-room
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
sendBtn.onclick = () => {
  const message = messageInput.value.trim();
  if (!message) return;
  socket.emit("send-message", message);
  messageInput.value = "";
};

// ✅ already good: server will send user = deviceName
socket.on("receive-message", (data) => addMsg(`<b>${data.user}:</b> ${data.text}`));

// ================= WebRTC (rest of your code unchanged) =================
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

let pc = null;
let dc = null;
let peerSocketId = null;
let pendingIncoming = null;
let outgoingFile = null;

let fileWorker = null;

// Tuning
const CHUNK_SIZE = 64 * 1024;
const BUFFER_LOW = 4 * 1024 * 1024;
const BUFFER_MAX = 12 * 1024 * 1024;
const ACK_EVERY_BYTES = 1 * 1024 * 1024;

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

// ✅ watchdog timer id
let doneResendTimer = null;
// ✅ last status from receiver
let lastStatusRes = null;

// ===== NEW: READY handshake (fix 99% stuck) =====
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

// Buttons
pauseBtn.onclick = () => {
  if (!sendState.running) return;
  sendState.paused = true;
  pauseBtn.disabled = true;
  resumeBtn.disabled = false;
  setStatus("⏸ Paused");
  try { fileWorker?.postMessage({ type: "pause" }); } catch {}
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
  } catch {}
};
cancelBtn.onclick = () => cancelTransfer("You canceled transfer", true);

function safeClosePeer() {
  gracefulClosing = true;
  try { dc?.close(); } catch {}
  try { pc?.close(); } catch {}
  dc = null;
  pc = null;
  peerSocketId = null;

  if (doneResendTimer) {
    clearInterval(doneResendTimer);
    doneResendTimer = null;
  }

  resetReceiverReady();
  setTimeout(() => (gracefulClosing = false), 800);
}

function cancelTransfer(reason, notifyPeer) {
  if (transferCompleted) return;

  if (doneResendTimer) {
    clearInterval(doneResendTimer);
    doneResendTimer = null;
  }

  markReceiverReady(false);

  if (sendState.running) {
    sendState.canceled = true;
    try { fileWorker?.postMessage({ type: "cancel" }); } catch {}
    try { if (dc?.readyState === "open") dc.send(JSON.stringify({ type: "cancel" })); } catch {}
    if (notifyPeer && peerSocketId) {
      try { socket.emit("file-cancel", { to: peerSocketId }); } catch {}
    }
  }

  incomingFile = null;
  setStatus("❌ Transfer canceled");
  resetTransferUI();
  safeClosePeer();
  addMsg(`<span class="muted">❌ ${reason}</span>`);
}

socket.on("file-cancel", () => {
  if (transferCompleted) return;
  cancelTransfer("Sender canceled transfer", false);
});

// Peer connection
async function createPeerConnection() {
  pc = new RTCPeerConnection(RTC_CONFIG);

  pc.oniceconnectionstatechange = () => {
    console.log("[P2P] iceConnectionState:", pc.iceConnectionState);
  };
  pc.onconnectionstatechange = () => {
    console.log("[P2P] connectionState:", pc.connectionState);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate && peerSocketId) {
      socket.emit("webrtc-ice", { to: peerSocketId, candidate: e.candidate });
    }
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
        try { dc.send(JSON.stringify({ type: "status-res", ...r })); } catch {}
        return;
      }

      if (msg.type === "complete") {
        dlog("RX complete");
        sendState.gotComplete = true;
        transferCompleted = true;
        setStatus(`✅ Sent: ${sendState.file?.name || ""}`);
        setProgressBytes(sendState.file?.size || 0, sendState.file?.size || 1);
        etaText.innerText = "Remaining: 0m 0s";

        sendState.running = false;
        outgoingFile = null;

        pauseBtn.disabled = true;
        resumeBtn.disabled = true;
        cancelBtn.disabled = true;

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
        cancelTransfer("Sender canceled transfer", false);
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
  try { await pc.addIceCandidate(candidate); } catch {}
});

// File offer UI
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;
  if (!currentRoom) {
    alert("Please create or join a room first.");
    return;
  }

  transferCompleted = false;
  gracefulClosing = false;
  resetReceiverReady();

  outgoingFile = file;
  resetTransferUI();
  setStatus(`Waiting for receiver... (${file.name}, ${fmtBytes(file.size)})`);

  socket.emit("file-offer", { name: file.name, size: file.size, type: file.type || "application/octet-stream" });
});

// ✅ CHANGED: server now sends fromName (device name)
socket.on("file-offer", ({ from, fromName, fromShort, meta }) => {
  pendingIncoming = { from, meta };
  const who = fromName || fromShort || (from ? from.substring(0, 5) : "User");
  modalInfo.innerText = `From: ${who}\nFile: ${meta.name}\nSize: ${fmtBytes(meta.size)}\nType: ${meta.type}`;
  modalBg.style.display = "flex";
});

rejectBtn.onclick = () => {
  if (!pendingIncoming) return;
  socket.emit("file-answer", { to: pendingIncoming.from, accepted: false });
  pendingIncoming = null;
  modalBg.style.display = "none";
};

acceptBtn.onclick = async () => {
  if (!pendingIncoming) return;

  transferCompleted = false;
  gracefulClosing = false;
  resetReceiverReady();

  socket.emit("file-answer", { to: pendingIncoming.from, accepted: true });
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
  const MAX_AHEAD = 16 * 1024 * 1024;
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

  // meta
  try {
    dc.send(JSON.stringify({
      type: "meta",
      meta: { name: file.name, size: file.size, type: file.type || "application/octet-stream" },
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
          } catch {}
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

// ===== Receiver (rest same) =====
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
  addMsg(`<b>Receiving:</b> ${meta.name} (${fmtBytes(meta.size)})`);
  dlog("startReceiver", meta);

  if (needDisk) {
    const canDisk = "showSaveFilePicker" in window && window.isSecureContext;
    if (!canDisk) {
      addMsg(`<span class="muted">⚠️ Large file (${fmtBytes(meta.size)}) cannot be received in memory. Use HTTPS/localhost to enable disk saving.</span>`);
      setStatus("⚠️ Large file needs disk saving (HTTPS/localhost).");
      try { dc?.send(JSON.stringify({ type: "cancel" })); } catch {}
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
      try { dc?.send(JSON.stringify({ type: "cancel" })); } catch {}
      incomingFile = null;
      return;
    }
  } else {
    addMsg(`<span class="muted">ℹ️ Saving in memory (small/medium). Download will start after complete.</span>`);
  }

  try { dc?.send(JSON.stringify({ type: "ready" })); } catch {}
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