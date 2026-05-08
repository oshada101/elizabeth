# Elizabeth

Electron desktop app for viewing documents and chatting with an AI assistant about their contents.

![Platform](https://img.shields.io/badge/platform-Linux-blue)

**Project page:** https://oshada.dev/projects/elizabeth

## Features

- **Document viewing** — PDF, DOCX, spreadsheets, Markdown with virtual scrolling and text selection
- **AI chat** — Ask questions about open documents or entire directories; responses stream in real time
- **Semantic search** — PDFs are embedded locally via Ollama; vector search runs on-device
- **Document deduplication** — SHA-256 hashing skips re-embedding files already in the vector store
- **PPTX conversion** — Converts PowerPoint files to PDF on load
- **Session history** — Conversations persisted in SQLite (`app.db`)
- **Configurable LLM** — Supports OpenAI-compatible endpoints, DeepSeek, or local Ollama models

## Requirements

| Dependency | Version |
|---|---|
| Node.js | 18+ |
| Ollama | running on `localhost:11434` |
| `all-minilm:latest` | pulled in Ollama (for embeddings) |

## Setup

```bash
git clone <repo>
cd elizabeth
npm install
```

Pull the embedding model:

```bash
ollama pull all-minilm:latest
```

## Usage

```bash
npm run dev       # Dev server with hot reload
npm run build     # Production build (output: out/)
npm run preview   # Preview production build
npm run package   # Build distributable AppImage (Linux)
```

Configure your chat LLM via the **Settings** button (gear icon) — paste an API key and model name for any OpenAI-compatible provider.

## Architecture

Three-process Electron app:

```
Main process (Node.js)
  index.ts           — IPC handlers, window management, file ops
  agent.ts           — LangChain/LangGraph agent, vector store (vectors.db)
  db.ts              — better-sqlite3 singleton (app.db)
  documentRegistry.ts — embedded doc tracking by SHA-256
  keyManager.ts      — API keys stored in system keychain (keytar)
  settingsManager.ts — embedding/model settings

Preload
  index.ts           — exposes window.electronAPI via contextBridge

Renderer (React 18 + TypeScript + Tailwind)
  App.tsx            — root state, PDF/session management
  PDFViewer.tsx      — pdfjs-dist, virtual scrolling
  UnifiedPanel.tsx   — TOC + chat in one panel
  AIAssistant.tsx    — chat UI, streaming chunks
  FileExplorer.tsx   — file browser
  SettingsModal.tsx  — API key / model config
```

**Two databases:**
- `app.db` (better-sqlite3, sync) — sessions, messages, document registry
- `vectors.db` (libsql, async) — PDF chunk embeddings

## AI Agent Tools

**Search & Discovery**

| Tool | Scope |
|---|---|
| `search_current` | Current open document |
| `search_directory` | All docs under current path |
| `search_all` | All embedded docs (requires user permission) |
| `list_directory_files` | Embedded PDFs in a directory |
| `list_all_files` | All files including non-PDFs in specified folders |
| `recommend_documents` | Suggest related documents as clickable cards |

**File Management**

| Tool | What it does | Confirms first |
|---|---|---|
| `organize_folder` | Group files by type / date / name / semantic content | Yes |
| `move_files` | Move files to new locations | Yes |
| `rename_file` | Rename a file or folder | Yes |
| `delete_files` | Delete files or folders | Yes |
| `convert_document` | Convert PPTX to PDF | Yes |

## Styling

Glassmorphism purple theme. Custom Tailwind classes: `glass-panel`, `glass-header`, `glass-input`, `glass-button`. Selection color `#9900FF`.
