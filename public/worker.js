let file = null;
let chunkSize = 256 * 1024;
let offset = 0;
let paused = false;
let canceled = false;

const DEBUG_W = true;
const wlog = (...a) => DEBUG_W && console.log("[WORKER]", ...a);

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === "start") {
    file = msg.file;
    chunkSize = msg.chunkSize || chunkSize;
    offset = msg.offset || 0;
    paused = false;
    canceled = false;
    wlog("start", { size: file?.size, chunkSize, offset });
    return;
  }

  if (msg.type === "pull") {
    if (!file || canceled || paused) return;

    if (offset >= file.size) {
      wlog("done");
      self.postMessage({ type: "done" });
      return;
    }

    const slice = file.slice(offset, offset + chunkSize);
    const buf = await slice.arrayBuffer();

    // (avoid spam)
    if (offset === 0 || offset % (16 * 1024 * 1024) === 0) {
      wlog("chunk", { offset, len: buf.byteLength });
    }

    self.postMessage({ type: "chunk", buf, offset }, [buf]);
    offset += slice.size;
  }

  if (msg.type === "pause") {
    paused = true;
    wlog("pause");
  }

  if (msg.type === "resume") {
    paused = false;
    wlog("resume");
  }

  if (msg.type === "cancel") {
    canceled = true;
    file = null;
    wlog("cancel");
  }
};