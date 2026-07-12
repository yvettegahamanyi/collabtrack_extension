# CollabTrack Meeting Exporter

A Chrome extension (Manifest V3) that captures **Google Meet live captions** and **in-call chat messages**, then exports them as text files formatted for upload in CollabTrack contribution reports.

It runs only on `meet.google.com`. It does not record audio or video, and it does not send data to any external server.

---

## What it does

During a Google Meet session, the extension:

1. **Captures transcript lines** from the live captions panel (speaker + spoken text)
2. **Captures chat messages** from the in-call messages panel (sender + message text)
3. Shows a live count of captured lines in the extension popup
4. **Exports two files** when you click **Export Files**:
   - `transcript.txt`
   - `chat.txt`

Both files use the format CollabTrack expects:

```
[HH:MM] Speaker Name: message text
```

Example:

```
[15:21] Yvette Gahamanyi: Hello. How are you doing?
```

---

## How it works

### Architecture

| File                      | Role                                                       |
| ------------------------- | ---------------------------------------------------------- |
| `manifest.json`           | Extension config, permissions, content script registration |
| `content.js`              | Runs inside Google Meet; watches the DOM and captures data |
| `popup.html` / `popup.js` | Toolbar popup UI — status, name field, export, and clear   |
| `icons/`                  | Extension icons (16×16, 48×48, 128×128)                    |

### Transcript capture

- Locates the official Google Meet **Captions** region (`[role="region"][aria-label="Captions"]`)
- Parses caption rows (`.nMcdL.bj4p3b`) for speaker name and spoken text
- Waits for each line to stabilise (~1.2 seconds) before saving, so partial caption updates are not exported
- Merges incremental updates from the same speaker into one line

### Chat capture

- Watches for chat message blocks (`div.Ss4fHf`) in the Meet page
- Extracts sender name, timestamp, and message text (`[jsname="dTKtvb"]`)

### Privacy

The extension only requests:

- `activeTab` — interact with the current Meet tab when you open the popup
- `downloads` — save `transcript.txt` and `chat.txt` to your computer
- `storage` — remember your display name
- `scripting` — inject the content script if needed
- `host_permissions` for `https://meet.google.com/*` — read caption and chat text from the Meet page

No audio, video, or meeting data is transmitted anywhere.

---

## Installation

### Option A — Download from CollabTrack (students)

1. Open your group in CollabTrack → **Overview** tab
2. Click **Download Extension** in the Google Meet Extension card
3. Unzip the downloaded file (you should get a folder containing `manifest.json`)
4. Open Chrome and go to `chrome://extensions`
5. Enable **Developer mode** (toggle in the top right)
6. Click **Load unpacked** and select the unzipped folder
7. The CollabTrack icon appears in your Chrome toolbar

### Option B — Load from source (developers)

1. Clone or copy this `collabTrack_extension/` folder locally
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select this `collabTrack_extension/` folder

---

## Usage during a meeting

1. Join a Google Meet at `meet.google.com`
2. Click the CollabTrack extension icon in the toolbar
3. Enter your full name in the **Your name** field (do this once; it is remembered)
4. Enable **live captions**: `Ctrl+Shift+C` (Windows/Linux) or `Cmd+Shift+C` (Mac)
5. Open the **Chat** panel and keep it open during the meeting
6. Speak and send chat messages as normal — the popup shows how many lines have been captured
7. When the meeting ends (or when you are ready), click **Export Files**
8. Upload `transcript.txt` and `chat.txt` in the CollabTrack contribution report wizard

### Tips

- Click **Clear** before a new meeting to reset captured data
- Refresh the Meet tab after installing or updating the extension
- If the popup shows a connection error, refresh the Meet tab and open the popup again
- Captions must be enabled for transcript capture; chat must be visible for chat capture

---

## Export file format

### `transcript.txt`

```
[HH:MM] Speaker Name: spoken text
```

### `chat.txt`

```
[HH:MM] Sender Name: message text
```

Timestamps use 24-hour `HH:MM` format. These files are parsed by CollabTrack's meeting parser when you upload them in a contribution report.

---

## Project structure

```
extension/
├── manifest.json      # Extension manifest (MV3)
├── content.js         # Meet page capture logic
├── popup.html         # Popup UI
├── popup.js           # Popup logic (export, clear, name storage)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## Version

Current version: **1.0.6** (see `manifest.json`)
