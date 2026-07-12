const EXTENSION_VERSION = "1.0.6";
const DISPLAY_NAME_KEY = "collabtrack_display_name";

function formatTranscriptFile(entries) {
  return entries
    .map((entry) => `[${entry.time}] ${entry.speaker}: ${entry.text}`)
    .join("\n");
}

function formatChatFile(entries) {
  return entries
    .map((entry) => `[${entry.time}] ${entry.sender}: ${entry.text}`)
    .join("\n");
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs: false,
      },
      (downloadId) => {
        URL.revokeObjectURL(url);
        if (chrome.runtime.lastError || downloadId === undefined) {
          reject(new Error(chrome.runtime.lastError?.message || "Download failed"));
          return;
        }
        resolve(downloadId);
      }
    );
  });
}

function setStatus(transcriptCount, chatCount) {
  const status = document.getElementById("status");
  status.innerHTML = `<strong>${transcriptCount}</strong> transcript line${
    transcriptCount === 1 ? "" : "s"
  } · <strong>${chatCount}</strong> chat message${
    chatCount === 1 ? "" : "s"
  } captured`;
}

function setError(message) {
  const error = document.getElementById("error");
  if (!message) {
    error.style.display = "none";
    error.textContent = "";
    return;
  }
  error.style.display = "block";
  error.textContent = message;
}

async function getActiveMeetTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }
  if (!tab.url?.startsWith("https://meet.google.com")) {
    throw new Error("Open a Google Meet tab to use this extension.");
  }
  return tab;
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function ensureContentScript(tabId) {
  try {
    const response = await sendTabMessage(tabId, { type: "PING" });
    if (response?.ok && response?.version === EXTENSION_VERSION) return;
  } catch {
    // Content script is not loaded yet — inject it below.
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });

  await new Promise((resolve) => setTimeout(resolve, 200));

  const response = await sendTabMessage(tabId, { type: "PING" });
  if (!response?.ok || response?.version !== EXTENSION_VERSION) {
    throw new Error(
      "Could not connect to Google Meet. Refresh the Meet tab, then open this popup again."
    );
  }
}

async function requestData() {
  const tab = await getActiveMeetTab();
  await ensureContentScript(tab.id);
  const response = await sendTabMessage(tab.id, { type: "GET_DATA" });
  return response || { transcript: [], chat: [] };
}

async function clearData() {
  const tab = await getActiveMeetTab();
  await ensureContentScript(tab.id);
  return sendTabMessage(tab.id, { type: "CLEAR_DATA" });
}

async function saveDisplayName(name) {
  const trimmed = name.trim();
  await chrome.storage.local.set({ [DISPLAY_NAME_KEY]: trimmed });

  try {
    const tab = await getActiveMeetTab();
    await ensureContentScript(tab.id);
    await sendTabMessage(tab.id, {
      type: "SET_DISPLAY_NAME",
      name: trimmed,
    });
  } catch {
    // Meet tab may not be open yet; the stored name will apply on next capture.
  }
}

async function loadDisplayName() {
  const data = await chrome.storage.local.get(DISPLAY_NAME_KEY);
  const input = document.getElementById("displayName");
  input.value = data[DISPLAY_NAME_KEY] || "";
}

async function refreshStatus() {
  try {
    setError("");
    await loadDisplayName();
    const tab = await getActiveMeetTab();
    await ensureContentScript(tab.id);
    const ping = await sendTabMessage(tab.id, { type: "PING" });
    if (ping?.displayName && !document.getElementById("displayName").value.trim()) {
      document.getElementById("displayName").value = ping.displayName;
      await chrome.storage.local.set({
        [DISPLAY_NAME_KEY]: ping.displayName,
      });
    }
    const data = await sendTabMessage(tab.id, { type: "GET_DATA" });
    setStatus(data.transcript?.length || 0, data.chat?.length || 0);
  } catch (error) {
    setStatus(0, 0);
    setError(error.message);
  }
}

document.getElementById("displayName").addEventListener("change", async (event) => {
  await saveDisplayName(event.target.value);
});

document.getElementById("exportBtn").addEventListener("click", async () => {
  const exportBtn = document.getElementById("exportBtn");
  exportBtn.disabled = true;

  try {
    setError("");
    await saveDisplayName(document.getElementById("displayName").value);
    const data = await requestData();
    const transcriptContent = formatTranscriptFile(data.transcript || []);
    const chatContent = formatChatFile(data.chat || []);

    if (!transcriptContent && !chatContent) {
      throw new Error("Nothing captured yet. Enable captions and open chat first.");
    }

    await downloadTextFile("transcript.txt", transcriptContent);
    await downloadTextFile("chat.txt", chatContent);
    await refreshStatus();
  } catch (error) {
    setError(error.message);
  } finally {
    exportBtn.disabled = false;
  }
});

document.getElementById("clearBtn").addEventListener("click", async () => {
  const clearBtn = document.getElementById("clearBtn");
  clearBtn.disabled = true;

  try {
    setError("");
    await clearData();
    setStatus(0, 0);
  } catch (error) {
    setError(error.message);
  } finally {
    clearBtn.disabled = false;
  }
});

refreshStatus();
