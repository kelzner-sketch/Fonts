# Handwriting → Font AI

A React and FastAPI app that turns a handwriting sample into an editable,
downloadable TrueType font.

The workflow validates and normalizes phone photos, detects glyphs, lets the
user correct the detected boxes, generates missing characters in resumable
batches, and builds a local `.ttf` preview.

## Quick Start

```bash
bash start.sh
```

This installs dependencies and starts both the Vite dev server (frontend) and the FastAPI backend.

## Project Structure

```
├── src/                  # React frontend
│   ├── components/ui/    # shadcn/ui components
│   ├── lib/              # Utilities
│   ├── App.tsx           # Main app component
│   └── main.tsx          # Entry point
├── app.py                # FastAPI entry point
├── routes.py             # API routes + SPA fallback
├── secrets_utils.py      # OAuth token utility
├── start.sh              # Dev server launcher
└── deploy.sh             # Build & deploy script
```

## Development

- Frontend: Edit `src/App.tsx` and files in `src/`
- Backend API: Add routes in `routes.py`
- The Vite dev server proxies `/api` requests to the FastAPI backend

Set `GEMINI_WORKSHOP_API_KEY` (and `GEMINI_WORKSHOP_BASE_URL` when required by
the environment) before using analysis or generation.

## Reliability limits

- Uploads accept PNG, JPG, and WebP up to 12 MB and 30 megapixels.
- Images are orientation-corrected and reduced to a 2200 px analysis copy.
- Missing glyphs are generated as ordered specimen sheets of up to 12
  characters. This keeps stroke and proportion decisions coherent while local
  grid extraction makes each cell independently retryable.
- Provider and image-processing calls run outside the async web-server loop.

## Checks

```bash
bun run build
bun run lint
uv run python -m unittest discover -s tests
```

## Deploy

```bash
bash deploy.sh
```

Builds the frontend and deploys to Modal.
