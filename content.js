const SCRIPT_VERSION = "1.0.6";

if (globalThis.__collabTrackExporterVersion === SCRIPT_VERSION) {
  // This version is already active in the tab.
} else {
  globalThis.__collabTrackExporterVersion = SCRIPT_VERSION;

(() => {
  const CAPTION_STABILITY_MS = 1200;
  const POLL_MS = 1000;

  const transcript = [];
  const chat = [];
  const captionEntries = new Map();
  const processedChatBlockKeys = new Set();
  const seenChatLines = new Set();

  let captionContainer = null;
  let captionObserver = null;
  let pollTimer = null;
  let myDisplayName = "";
  let storedDisplayName = "";

  function getMyName() {
    return storedDisplayName || myDisplayName || "";
  }

  function setMyDisplayName(name) {
    const trimmed = (name || "").trim();
    if (!trimmed || /^you$/i.test(trimmed)) return;
    if (myDisplayName !== trimmed) {
      myDisplayName = trimmed;
      reconcileYouLabels();
    }
  }

  function reconcileYouLabels() {
    const resolved = getMyName();
    if (!resolved) return;

    transcript.forEach((entry) => {
      if (entry.speaker === "You") entry.speaker = resolved;
    });
    chat.forEach((entry) => {
      if (entry.sender === "You") entry.sender = resolved;
    });
  }

  function loadStoredDisplayName() {
    chrome.storage.local.get("collabtrack_display_name", (data) => {
      storedDisplayName = (data.collabtrack_display_name || "").trim();
      reconcileYouLabels();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.collabtrack_display_name) return;
    storedDisplayName = (changes.collabtrack_display_name.newValue || "").trim();
    reconcileYouLabels();
  });

  function formatTime(date = new Date()) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function normalizeChatTime(raw) {
    const value = (raw || "").replace(/\u202f/g, " ").trim();
    if (!value) return formatTime();
    if (/^\d{2}:\d{2}$/.test(value)) return value;

    const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!match) return formatTime();

    let hours = Number(match[1]);
    const minutes = match[2];
    const meridiem = match[3]?.toUpperCase();
    if (meridiem === "PM" && hours < 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;
    return `${String(hours).padStart(2, "0")}:${minutes}`;
  }

  function resolveSpeaker(name) {
    const trimmed = (name || "").trim();
    if (!trimmed || /^you$/i.test(trimmed)) {
      return storedDisplayName || myDisplayName || "You";
    }
    return trimmed.replace(/\s*\(you\)\s*$/i, "").trim();
  }

  function isValidSpeaker(name) {
    if (!name || name.length > 80) return false;
    if (/unknown/i.test(name)) return false;
    if (/^\d{1,2}:\d{2}/.test(name)) return false;
    if (/[AP]M$/i.test(name)) return false;
    if (/keeppin|pin message|arrow_downward|mic_none|videocam/i.test(name)) {
      return false;
    }
    return true;
  }

  function isValidTranscriptText(text) {
    if (!text) return false;
    const value = text.replace(/\s+/g, " ").trim();
    if (value.length < 2 || value.length > 500) return false;

    const lower = value.toLowerCase();
    const blocked = [
      "mic_none",
      "videocam",
      "arrow_downward",
      "jump to bottom",
      "no chat messages yet",
      "open caption settings",
      "font size",
      "font color",
      "keeppin message",
      "pin message",
      "built-in)",
      "format_size",
      "languageenglish",
      "(beta)",
      "macbook pro",
    ];

    return !blocked.some((token) => lower.includes(token));
  }

  function isValidChatText(text) {
    if (!isValidTranscriptText(text)) return false;
    const lower = text.toLowerCase();
    return !lower.includes("jump to bottom") && !lower.includes("no chat messages yet");
  }

  function upsertTranscriptLine(speaker, text, time = formatTime()) {
    const resolvedSpeaker = resolveSpeaker(speaker);
    const cleanedText = text.replace(/\s+/g, " ").trim();

    if (!isValidSpeaker(resolvedSpeaker) || !isValidTranscriptText(cleanedText)) {
      return;
    }

    const last = transcript[transcript.length - 1];
    if (last && last.speaker === resolvedSpeaker) {
      if (last.text === cleanedText) return;
      if (cleanedText.startsWith(last.text)) {
        last.text = cleanedText;
        last.time = time;
        return;
      }
    }

    transcript.push({
      time,
      speaker: resolvedSpeaker,
      text: cleanedText,
    });
  }

  function addChatLine(sender, text, timeRaw) {
    const resolvedSender = resolveSpeaker(sender);
    const cleanedText = text.replace(/\s+/g, " ").trim();
    const time = normalizeChatTime(timeRaw);

    if (!isValidSpeaker(resolvedSender) || !isValidChatText(cleanedText)) {
      return;
    }

    const key = `${time}|${resolvedSender}|${cleanedText}`;
    if (seenChatLines.has(key)) return;
    seenChatLines.add(key);

    chat.push({
      time,
      sender: resolvedSender,
      text: cleanedText,
    });
  }

  function findCaptionContainer() {
    const regions = document.querySelectorAll('[role="region"][aria-label]');
    for (const region of regions) {
      const label = (region.getAttribute("aria-label") || "").trim();
      if (/^(captions|sous-titres|untertitel|leyendas|字幕)$/i.test(label)) {
        return region;
      }
    }
    return null;
  }

  function detectMyName() {
    document.querySelectorAll("[data-self-name]").forEach((node) => {
      const attrName = node.getAttribute("data-self-name")?.trim();
      if (attrName && !/^you$/i.test(attrName)) {
        setMyDisplayName(attrName);
      }
    });

    document
      .querySelectorAll('div[role="listitem"].cxdMu, div[role="listitem"]')
      .forEach((item) => {
        const youMarker =
          item.querySelector(".NnTWjc")?.textContent?.trim() || "";
        if (!/\byou\b/i.test(youMarker)) return;

        const name =
          item.querySelector("span.zWGUib")?.textContent?.trim() ||
          item.querySelector("[data-self-name]")?.textContent?.trim() ||
          "";

        if (name && !/^you$/i.test(name)) {
          setMyDisplayName(name.replace(/\s*\(you\)\s*/i, "").trim());
        }
      });

    document.querySelectorAll('[aria-label*="Your"], [aria-label*="you"]').forEach((node) => {
      const label = node.getAttribute("aria-label") || "";
      const match = label.match(/^(.+?)\s*\(you\)/i) || label.match(/^your video[:\s]+(.+)$/i);
      if (match?.[1]) {
        setMyDisplayName(match[1].trim());
      }
    });
  }

  function parseCaptionNode(captionNode) {
    const captionTextNode = captionNode.querySelector(".ygicle.VbkSUe");
    if (!captionTextNode) return null;

    const speakerNode = captionNode.querySelector(".NWpY1d");
    const youMarker = captionNode.querySelector(".NnTWjc")?.textContent?.trim() || "";

    let speaker = speakerNode?.textContent?.replace(/\s+/g, " ").trim() || "";
    const text = captionTextNode.textContent?.replace(/\s+/g, " ").trim() || "";

    if (!text) return null;

    if (/^you$/i.test(speaker) || /\byou\b/i.test(youMarker)) {
      speaker = "You";
    }

    if (!speaker) return null;

    return { speaker, text, captionTextNode };
  }

  function registerCaptionNode(captionNode) {
    if (!captionContainer?.contains(captionNode)) return;

    const parsed = parseCaptionNode(captionNode);
    if (!parsed) return;

    const { speaker, text, captionTextNode } = parsed;
    if (!captionEntries.has(captionTextNode)) {
      const entry = {
        speaker,
        text,
        time: formatTime(),
        lastUpdated: Date.now(),
        committed: false,
      };
      captionEntries.set(captionTextNode, entry);
      return;
    }

    const entry = captionEntries.get(captionTextNode);
    entry.speaker = speaker;
    entry.text = text;
    entry.lastUpdated = Date.now();
  }

  function scanCaptionContainer() {
    if (!captionContainer || !document.contains(captionContainer)) {
      captionContainer = findCaptionContainer();
      if (captionContainer && captionObserver) {
        captionObserver.disconnect();
        captionObserver.observe(captionContainer, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      }
    }
    if (!captionContainer) return;

    captionContainer
      .querySelectorAll(".nMcdL.bj4p3b")
      .forEach((node) => registerCaptionNode(node));

    const now = Date.now();
    for (const [textNode, entry] of captionEntries.entries()) {
      if (!document.contains(textNode)) {
        if (!entry.committed) {
          upsertTranscriptLine(entry.speaker, entry.text, entry.time);
          entry.committed = true;
        }
        captionEntries.delete(textNode);
        continue;
      }

      if (!entry.committed && now - entry.lastUpdated >= CAPTION_STABILITY_MS) {
        upsertTranscriptLine(entry.speaker, entry.text, entry.time);
        entry.committed = true;
      }
    }
  }

  function chatBlockKey(messageBlock) {
    const sender =
      messageBlock.querySelector(".poVWob")?.textContent.trim() ||
      messageBlock.querySelector(".YTbUzc")?.textContent.trim() ||
      "";
    const time =
      messageBlock.querySelector(".MuzmKe")?.textContent.trim() || "";
    const text = Array.from(
      messageBlock.querySelectorAll("[jsname='dTKtvb']")
    )
      .map((node) => node.textContent?.trim() || "")
      .join("|");
    return `${time}|${sender}|${text}`;
  }

  function scanChatMessages() {
    document.querySelectorAll("div.Ss4fHf").forEach((messageBlock) => {
      const blockKey = chatBlockKey(messageBlock);
      if (!blockKey || processedChatBlockKeys.has(blockKey)) return;

      const sender =
        messageBlock.querySelector(".poVWob")?.textContent.trim() ||
        messageBlock.querySelector(".YTbUzc")?.textContent.trim() ||
        "";

      const time =
        messageBlock.querySelector(".MuzmKe")?.textContent.trim() || "";

      const messageNodes = messageBlock.querySelectorAll("[jsname='dTKtvb']");
      if (messageNodes.length === 0) return;

      messageNodes.forEach((messageNode) => {
        const text = messageNode.textContent?.trim();
        if (text) addChatLine(sender, text, time);
      });

      processedChatBlockKeys.add(blockKey);
    });
  }

  function onDomChange(mutations) {
    let captionChanged = false;

    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        const parent = mutation.target.parentElement;
        if (parent?.matches?.(".ygicle.VbkSUe") && captionEntries.has(parent)) {
          const entry = captionEntries.get(parent);
          entry.text = parent.textContent?.replace(/\s+/g, " ").trim() || "";
          entry.lastUpdated = Date.now();
          entry.committed = false;
          captionChanged = true;
        }
        continue;
      }

      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;

        if (node.matches?.(".nMcdL.bj4p3b")) {
          registerCaptionNode(node);
          captionChanged = true;
        } else {
          node.querySelectorAll?.(".nMcdL.bj4p3b").forEach((captionNode) => {
            registerCaptionNode(captionNode);
            captionChanged = true;
          });
        }

        if (node.matches?.("div.Ss4fHf") || node.querySelector?.("div.Ss4fHf")) {
          scanChatMessages();
        }
      }
    }

    if (captionChanged) scanCaptionContainer();
  }

  function startObservers() {
    if (pollTimer) return;

    loadStoredDisplayName();
    detectMyName();
    scanCaptionContainer();
    scanChatMessages();

    captionContainer = findCaptionContainer();
    if (captionContainer) {
      captionObserver = new MutationObserver(onDomChange);
      captionObserver.observe(captionContainer, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    const chatDiscoveryObserver = new MutationObserver(() => {
      detectMyName();
      if (!captionContainer || !document.contains(captionContainer)) {
        scanCaptionContainer();
      }
      scanChatMessages();
    });
    chatDiscoveryObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    pollTimer = setInterval(() => {
      detectMyName();
      scanCaptionContainer();
      scanChatMessages();
    }, POLL_MS);
  }

  function finalizeCaptions() {
    detectMyName();
    reconcileYouLabels();
    for (const [, entry] of captionEntries.entries()) {
      if (!entry.committed) {
        upsertTranscriptLine(entry.speaker, entry.text, entry.time);
        entry.committed = true;
      }
    }
    scanChatMessages();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PING") {
      sendResponse({
        ok: true,
        version: SCRIPT_VERSION,
        displayName: getMyName() || null,
      });
      return true;
    }

    if (message?.type === "SET_DISPLAY_NAME") {
      storedDisplayName = (message.name || "").trim();
      chrome.storage.local.set({
        collabtrack_display_name: storedDisplayName,
      });
      reconcileYouLabels();
      sendResponse({ ok: true, displayName: getMyName() || null });
      return true;
    }

    if (message?.type === "GET_DATA") {
      finalizeCaptions();
      sendResponse({ transcript: [...transcript], chat: [...chat] });
      return true;
    }

    if (message?.type === "CLEAR_DATA") {
      transcript.length = 0;
      chat.length = 0;
      captionEntries.clear();
      seenChatLines.clear();
      processedChatBlockKeys.clear();
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObservers, { once: true });
  } else {
    startObservers();
  }
})();

}
