# AudioBook — Folio PDF reading studio

A responsive PDF reader with browser speech playback and a real local semantic transformer for text summaries, with sourced definitions and explanations.

## Run

```sh
npm install
npm run dev
```

Create production assets with `npm run build` and serve `dist` over HTTP(S). The dev and build commands automatically copy the ONNX runtime WASM files from the installed dependencies into `public/wasm`, so binary dependencies do not need to be committed.

## Features

- Local PDF import with PDF.js, progress, cancellation, and clear errors.
- Play, pause, stop, reading progress, volume, rate, browser voice and pronunciation language.
- Inclusive page ranges and exact start/stop boundaries from highlighted text.
- English dictionary definitions with attribution, Wikipedia term explanations, and web term lookup.
- Neural summaries of the selection or the document beginning through the selection.
- An original three-page sample document and responsive desktop/mobile workspace.
- Feature-detected WebMCP document-state and reading-range tools.

## Neural model

The AI worker runs the quantized `Xenova/all-MiniLM-L6-v2` six-layer semantic transformer through Transformers.js and ONNX Runtime Web. It is a pretrained neural model, not a newly trained network. On first use it downloads approximately 25 MB from Hugging Face and is cached by the browser when supported. WASM runtime files are served locally. No API key is required, and all summary inference runs on the user's device. The model encodes sentence meanings, then maximal marginal relevance selects the central ideas while reducing repetition. Summaries use original source sentences, in source order, and work best in English. Every sentence in a long passage is included in the analysis; embedding batches limit temporary inference memory.

PDF contents stay in browser memory and are not saved to the application server. Definition lookup sends the selected term to the Free Dictionary API and, when needed, Wikipedia; web lookup opens Google with that term. Device/browser speech providers may process spoken text remotely for non-local voices. Voice availability depends on the browser and OS; changing language changes pronunciation, not translation. The neural model works best in English, and generated results should be checked against the source.

Text PDFs are supported. Scanned PDFs need OCR first; password-protected PDFs need an unlocked copy. Complex PDF columns may extract in a different order, which is why the app displays the same extracted text it reads. Browser speech support and neural model memory/performance vary by device. The app limits PDFs to 100 MB, cancels stale imports and AI requests, and uses canonical UTF-16 offsets for selection and playback.

## Source layout

- `src/App.tsx`: document workspace, selection tools, range controls, and WebMCP.
- `src/document.ts`: PDF text extraction, canonical page offsets, selection mapping, speech chunks.
- `src/useSpeech.ts`: generation-safe browser speech queue and playback settings.
- `src/ai.worker.ts`: neural sentence embeddings and semantic summary selection.
- `src/styles.css`: responsive reading interface.
