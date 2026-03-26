# TPG Client Prep Assistant

TPG Client Prep Assistant is a minimal standalone web app for collecting meeting context, building a research packet, and generating a client prep brief with the OpenAI Responses API. It is designed to be embedded in SharePoint via `iframe`, kept easy to read, and simple to extend as the real prompt and research integrations are added.

## What It Does

- Collects a company name, attendee names, optional meeting objective, and optional notes
- Builds a normalized research packet
- Assembles a prompt payload from prompt files plus the packet
- Sends the final prompt to the OpenAI Responses API
- Returns markdown, the research packet, and basic metadata

## Folder Structure

```text
client-prep-app/
  app/
    api/
    web/
  prompts/
  knowledge/
  tools/
  data/
  README.md
  .env.example
  package.json
  tsconfig.json
```

## Run Locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Build the TypeScript files:

   ```bash
   npm run build
   ```

3. Start a simple local server:

   ```bash
   npm start
   ```

4. Open `http://localhost:4173`

## Deploy To Vercel

1. Create the Vercel project with `client-prep-app` as the project root.
2. Add these environment variables in Vercel:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL`
   - `OPENAI_BASE_URL`
3. Let Vercel run the default build command:

   ```bash
   npm run build
   ```

The build now emits:

- `public/` for static hosting on Vercel
- `api/generate-client-prep.ts` as the serverless API entrypoint
- `dist/` for the existing local Node server

If you deploy with the Vercel CLI from `client-prep-app`, the usual flow is:

```bash
vercel
vercel --prod
```

## Environment Setup

1. Copy `.env.example` to `.env`
2. Set `OPENAI_API_KEY`
3. Optionally change `OPENAI_MODEL` if you want to swap models later

`npm start` uses `node --env-file=.env`, so the server reads your local `.env` file automatically.

## Request / Response Flow

1. The browser submits form data to `POST /api/generate-client-prep`
2. The backend normalizes the input and runs the local research tools
3. The backend loads `prompts/system.txt`, `prompts/client-prep-template.md`, and optional examples from `prompts/examples/`
4. The backend sends one final prompt to the OpenAI Responses API
5. The API returns markdown, and the backend runs a lightweight quality pass to normalize headings, strip obvious leakage, and flag missing required sections before the frontend renders the brief

The endpoint returns:

```json
{
  "markdown": "...",
  "researchPacket": {},
  "meta": {
    "model": "...",
    "generatedAt": "..."
  }
}
```

## Files To Populate Next

These are intentionally seeded with placeholders so you can replace them manually:

- `prompts/system.txt`
- `prompts/client-prep-template.md`
- `prompts/examples/*`
- `knowledge/tpg/project-types-short.json`
- `knowledge/tpg/fit-rules.json`

## Notes

- `app/api/generate-client-prep.ts` is the main generation flow.
- `api/generate-client-prep.ts` is the thin Vercel serverless wrapper around the same generation flow.
- `app/api/openaiClient.ts` contains the minimal Responses API helper.
- `app/api/enforceBriefQuality.ts` contains the lightweight enforcement layer for heading cleanup, bullet normalization, and required-section checks.
- `app/api/runWithFunctionCalling.ts` is a small future-facing scaffold for tool calling, but it is not wired into the live path.
- Prompt files live in `prompts/system.txt`, `prompts/client-prep-template.md`, and `prompts/examples/*`.
- `tools/liveResearchUtils.ts` contains the official-site-first lookup profiles and lightweight HTML extraction helpers.
- `tools/*.ts` now attempt live official-site checks first where a company profile is configured; attendee lookup also falls back to public-profile aggregators such as SignalHire, RocketReach, and ContactOut using exact name + company matching.
- Add more company profiles in `tools/liveResearchUtils.ts` to expand official-site coverage.
- The app uses the Responses API for final generation, not Chat Completions.
- During testing, expand the Debug View in the UI to inspect the quality report, research packet JSON, raw model response text, model name, and timestamp.
- The UI is designed to stay lightweight and iframe-friendly for SharePoint embedding.
