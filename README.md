# AURA AI

A personal AI workspace built with React, TypeScript and Vite, deployed on Vercel. Visitors use hosted Gemini AI and do not need to install Ollama.

## Features in this starter
- Dark, responsive chat workspace
- Multiple local chat sessions saved in this browser
- Editable assistant personality instructions
- Personal knowledge notes injected into prompts
- Server-side Gemini API integration (the API key stays in Vercel environment variables)
- No public signup or secret API keys in the frontend

## Run locally
1. Install Node.js 20 or newer.
2. Clone this repository and run npm install.
3. Install Ollama from https://ollama.com/ and start it.
4. Pull a model, for example: ollama pull llama3.2:3b.
5. Start the website with npm run dev.
6. Open the local URL shown by Vite, then select the Ollama model in AURA settings if needed.

### Ollama browser access
A browser app on a different origin may be blocked by Ollama's origin policy. If the browser reports a CORS/origin error, configure Ollama's allowed origins for the exact site origin you use (local Vite is usually http://localhost:5173; the deployed site is https://aura-ai-yoursjace-6706.vercel.app) and restart Ollama. Keep this permission limited to origins you trust.

## Deploy to Vercel
Import astryxleo/AURA-AI into Vercel and use the default Vite build settings:
- Build command: npm run build
- Output directory: dist

**Important:** hosted AI usage is subject to provider quotas, model availability, and terms. Google's Gemini free tier has usage limits, and prompts sent through the free tier may be used to improve Google's products; check the current terms before sending sensitive data.

## Security notes
- Conversations, personality instructions and knowledge notes are stored in this browser's local storage.
- Do not add private provider API keys to client-side code or VITE_ environment variables.
- Chat history and persona notes are still stored in this browser; cloud accounts and cross-device sync are not included yet. The in-memory rate limit is best-effort and is not a substitute for durable production rate limiting.

## Roadmap
1. Polish the chat and local-model workflow.
2. Add durable rate limiting and abuse protection for public traffic.
3. Add optional Supabase authentication and synced chat history.
4. Add file-based knowledge ingestion and retrieval.
5. Add deployment checks and automated tests.