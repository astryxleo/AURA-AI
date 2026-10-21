# AURA AI

A personal AI workspace built with React, TypeScript and Vite. The first version is designed for GitHub + Vercel, with optional local inference through [Ollama](https://ollama.com/).

## Features in this starter
- Dark, responsive chat workspace
- Multiple local chat sessions saved in this browser
- Editable assistant personality instructions
- Personal knowledge notes injected into prompts
- Ollama chat API integration
- No public signup or secret API keys in the frontend

## Run locally
1. Install Node.js 20 or newer.
2. Clone this repository and run npm install.
3. Install Ollama from https://ollama.com/ and start it.
4. Pull a model, for example: ollama pull llama3.2:3b.
5. Start the website with npm run dev.
6. Open the local URL shown by Vite, then select the Ollama model in AURA settings if needed.

### Ollama browser access
A browser app on a different origin may be blocked by Ollama's origin policy. If the browser reports a CORS/origin error, configure Ollama's allowed origins for your local Vite URL (usually http://localhost:5173) and restart Ollama. Keep this permission limited to origins you trust.

## Deploy to Vercel
Import astryxleo/AURA-AI into Vercel and use the default Vite build settings:
- Build command: npm run build
- Output directory: dist

**Important:** a Vercel-hosted website cannot directly reach Ollama running on your own PC for visitors. This first version's Ollama mode is intended for a browser on the same computer as Ollama. A public multi-user AI service needs a server-side API/backend and protected provider credentials, or a separately hosted model endpoint.

## Security notes
- Conversations, personality instructions and knowledge notes are stored in this browser's local storage.
- Do not add private provider API keys to client-side code or VITE_ environment variables.
- This starter does not yet include cloud accounts, cross-device sync, or a production backend.

## Roadmap
1. Polish the chat and local-model workflow.
2. Add secure server-side AI provider integration.
3. Add optional Supabase authentication and synced chat history.
4. Add file-based knowledge ingestion and retrieval.
5. Add deployment checks and automated tests.