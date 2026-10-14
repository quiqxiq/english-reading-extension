# English Immersion Reader 📖✨

> A powerful Firefox WebExtension for English reading immersion, intelligent vocabulary acquisition, context-aware AI learning dictionary, and bidirectional AnkiConnect integration.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Firefox WebExtension](https://img.shields.io/badge/Firefox-WebExtension-orange.svg)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 🌟 Key Features

### 1. 👓 Immersive Article Reading Mode (`Alt + R`)
- **Non-destructive Tokenization:** Wraps individual words in the DOM without breaking page layout, links, or styles.
- **Visual Vocabulary Mastery:**
  - **`Known`**: Light green underline indicating mastered vocabulary.
  - **`Learn`**: Fluorescent yellow highlight indicating active target vocabulary.
  - **`Unknown`**: Clean, unstyled text.
- **Interactive Tooltip:** Floating UI popup placed dynamically near the clicked word, supporting automatic boundary flipping and shift prevention.

---

### 2. 🗂️ 5-in-1 Comprehensive Tooltip Tabs

| Tab | Icon | Description | Provider / Engine |
| :--- | :---: | :--- | :--- |
| **Dictionary** | 📖 | Full official English dictionary definitions, inflection support, IPA phonetics, CEFR levels, and audio pronunciation. | Cambridge English Dictionary (Official) / Oxford / FreeDict |
| **Learning Dict (AI)** | 🎓 | Structured, learner-friendly dictionary entry specifically crafted for Indonesian learners with rendered Markdown view and on-demand Anki card updating. | OpenRouter AI (`gemma-4-26b`, `openrouter/free`, etc.) |
| **Translation** | 🌐 | Instant translation of both the target word and the full surrounding sentence context. | Google Translate / Cambridge English-Indonesian |
| **Word Nuance (AI)** | 💡 | Deep contextual explanation focusing on tone, nuance, and why this specific word was chosen in the sentence. | OpenRouter AI |
| **Sentence Breakdown** | 🧩 | Grammatical phrase chunking with syntactic role explanations per logical clause. | OpenRouter AI |

---

### 3. 🎓 Dedicated AI Learning Dictionary View
Unlike raw markdown text, the **Learning Dict** tab renders full GitHub Flavored Markdown (via `marked`) into an elegant, styled dictionary reader:
- `# [WORD]` & `[Part of speech]`
- `**Arti utama:**` High-frequency Indonesian meanings
- `### 1. Arti kata` Fundamental meaning in 1–2 simple sentences
- `### 2. Arti berdasarkan konteks` Up to 2 practical contextual uses with examples
- `### 3. Terjemahan kalimat` Context sentence translation and overall meaning
- `### 4. Pola penggunaan` Common collocation patterns
- `### 5. Kata serupa` Comparative analysis of synonyms
- `### 6. Contoh sehari-hari` Everyday conversational examples

---

### 4. 🗃️ Smart AnkiConnect Integration
- **Direct Card Creation:** Automatically adds recognition cards with `Word`, `Sentence`, `Translation`, `Definition`, `Nuance`, and `Audio`.
- **Incremental Card Updating (Exclusive to Learning Dict):**
  - Detects whether the word is already present in your Anki collection.
  - If the card already exists, clicking **`[🔄 Update / Append to Anki]`** seamlessly appends the new article sentence and AI explanation to the existing card without overwriting previous learning history!
- Automatically synchronizes vocabulary status to **`Learn`** upon saving.

---

### 5. 🤖 Customizable AI Engine & Auto-Fallback
- Powered by **OpenRouter API** with pre-configured high-performance free models (`google/gemma-4-26b-a4b-it:free`, `openrouter/free`, etc.).
- **Thinking Token Filtration:** Automatically cleans reasoning and internal chain-of-thought tokens for pure, instant results.
- **Full Prompt Customization:** Edit both System Prompts and User Prompts directly inside the Settings page (`options.html`).

---

### 6. 🎥 YouTube Immersion: Synchronized Transcript & Auto-Pause Shadowing
Transform any YouTube video into an interactive language lab:
- **Dedicated Sidebar Panel (Option A):** Seamlessly injected into YouTube's right column (`#secondary`) without obscuring the video.
- **Real-Time Timestamp Sync & Auto-Scroll:** Highlights the currently spoken sentence and smoothly keeps it centered in view. Click any timestamp to instantly seek to that moment.
- **Smart Sentence Aggregation:** Groups fragmented automatic captions (ASR) into grammatically natural sentences based on punctuation and speech pauses.
- **Auto-Pause Shadowing & Auto-Resume:**
  - Automatically pauses playback at the end of each spoken sentence for a customizable duration (default `2.5s`, adjustable from `1.0s` to `6.0s`).
  - Displays a visual countdown banner (`⏸️ Menirukan (Shadowing): 2.5s...`) so you can repeat and shadow the sentence before playback automatically resumes.
- **Interactive Word Mastery on YouTube:** Every word in the transcript is tokenized with status colors (**Known**, **Learn**, **Unknown**). Hovering or clicking any word opens the floating 5-tab dictionary and Anki card creation!
- **Quick Keyboard Shortcuts:**
  - **`S`** / **`R`**: Replay the current sentence.
  - **`A`**: Jump to previous sentence.
  - **`D`**: Jump to next sentence.

---

## 🛠️ Tech Stack

- **Runtime:** Firefox WebExtension (Manifest V2 / V3 compatible)
- **Language:** TypeScript 5.7
- **Bundler:** Vite 6 + custom build runner (`build.js`)
- **UI & Positioning:** `@floating-ui/dom`
- **Markdown Renderer:** `marked` (GFM & line-break enabled)
- **Icons:** `lucide` SVG engine
- **Anki Integration:** AnkiConnect HTTP API (port 8765)

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (`corepack enable` or `npm install -g pnpm`)
- [Anki Desktop](https://apps.ankiweb.net/) with [AnkiConnect](https://ankiweb.net/shared/info/2055492111) addon installed and running (optional, for card syncing).

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/quiqxiq/english-reading-extension.git
   cd english-reading-extension
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build the extension:
   ```bash
   pnpm run build
   ```

4. Load into Firefox:
   - Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
   - Click **"Load Temporary Add-on..."**.
   - Select the `manifest.json` file inside the `dist/` directory.

---

## ⚙️ Configuration

Open the extension popup or navigate to Settings via the gear icon:

1. **OpenRouter API Key:**
   - Obtain a free API key at [openrouter.ai/keys](https://openrouter.ai/keys).
   - Paste into **Settings > OpenRouter API Key** and click **Test API Connection**.
2. **Anki Deck Name:**
   - Default: `English Immersion`.
   - Ensure Anki Desktop is running with AnkiConnect enabled.
3. **Primary Dictionary:**
   - **Cambridge English Dictionary (Official Comprehensive)**: `dictionary.cambridge.org/dictionary/english/<word>`
   - **Oxford Learner's Dictionaries**
   - **Free Dictionary API**
4. **Prompt Customization:**
   - Customize prompts for **Learning Dict (AI)**, **Word Nuance**, **Sentence Breakdown**, and **Translations** at any time.

---

## 📜 Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Alt</kbd> + <kbd>R</kbd> | Toggle Article Reading Mode on active webpage |
| <kbd>Click</kbd> | Click any word to trigger the Immersion Tooltip |
| <kbd>Esc</kbd> / Click outside | Close tooltip |

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
