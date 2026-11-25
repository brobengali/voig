# REDLINE — Private Partner Desk

An encrypted, local-first AI co-investor critic that audits founder calls for cognitive biases, unchallenged assertions, leading questions, and missed diligence probes—built with a minimalist Editorial Broadsheet ("Red-Pen Partner Review") interface and a Hosted Consent Pitch Room.

## Key Capabilities

- **Encrypted Local-First Vault (`AES-256-GCM` + `scrypt`)**: All transcripts, pitch decks, pre-call hypotheses, audio blobs, and partner critiques are encrypted at rest inside `vault_data/`.
- **Hosted Consent Pitch Room (`/room/:id?token=...`)**: Generate a scoped, HMAC-signed room link for a founder to open in their browser, review the prompt, accept recording consent, and record directly with a live oscilloscope—streamed into your desk via SSE without exposing any investor data.
- **Tab + Mic Live Capture & Direct Upload**: Capture a live browser call tab + your mic simultaneously, upload `.mp3/.wav/.m4a/.webm/.mp4` recordings, or paste raw transcripts alongside `.pdf`/`.md` pitch decks.
- **Multi-Pass Gemini Partner Pipeline**:
  1. Diarized transcription & deck context grounding (`gemini-3.5-transcribe` / multimodal fallback)
  2. Claim & conversational dynamics extraction (`gemini-4-hydrogen`)
  3. Parallel Cognitive Bias & Diligence Critics (`gemini-4-hydrogen`)
  4. Senior Partner Red-Pen Synthesis (`gemini-4-carbon`)
- **Zero Hardcoding**: Models, secrets, origins, and upload limits live in `.env`; investment theses, stage risk stacks, and personal bias checklists are fully configurable inside the **Thesis Rubrics** atelier.

## Setup

1. Copy `.env.example` to `.env` and set `GEMINI_API_KEY`, `SESSION_SECRET`, and `ROOM_TOKEN_SECRET`.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run development servers (API + Vite):
   ```bash
   npm run dev
   ```
4. Or build and run production bundle:
   ```bash
   npm run build
   npm start
   ```
