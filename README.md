# BugFind-15

![BugFind-15 screenshot](./screenshot.png)

BugFind-15 is a visual benchmark for comparing how well LLMs identify and fix bugs without hallucinating extra problems. It provides 15 debugging scenarios with live run traces, deterministic rubric scoring, and execution-backed fix verification, all defined by [METHODOLOGY.md](./METHODOLOGY.md).

## What It Measures

BugFind-15 is organized into 5 categories with 3 scenarios each:

- Syntax & Surface Errors
- Logic & Algorithmic Errors
- Subtle & Tricky Bugs
- Red Herring Resistance
- Multi-Turn Debugging

Each scenario is graded across three axes:

- Identification
- Fix Quality
- Discipline

Category E can also apply a multi-turn bonus or penalty when the model asks especially good or bad clarification questions.

## Execution Model

The Docker verifier service is required for real benchmark runs. BugFind-15 is not just a prompt-and-score UI; it depends on native execution to verify the model's submitted fix.

For every scenario, each model receives:

1. A shared debugger system prompt.
2. The scenario's user message and code sample.
3. For multi-turn scenarios, one scripted clarification only if the model asks a question.

The runner then:

1. Calls the model through `/chat/completions`.
2. Records the response trace.
3. Injects the scripted follow-up when the scenario allows it.
4. Sends the model's final answer to the verifier sandbox service for exact execution-backed fix checking.
5. Evaluates identification and discipline with deterministic scenario-specific checks, plus sandbox-backed fix verification.
6. Streams progress into the dashboard over Server-Sent Events.

Official execution verification only uses one exact tagged payload from the model's final answer:

```html
<solution language="python|javascript|rust|go" verdict="fix">
corrected code here
</solution>
```

Trap scenarios must instead use:

```html
<solution language="python|javascript|rust|go" verdict="no_bug"></solution>
```

If the final answer omits the tag, uses the wrong language, or uses the wrong verdict, official sandbox verification fails for that scenario.

Provider errors and request timeouts are retried up to 3 total attempts with backoff. Model requests time out after 30 seconds by default, and the timeout can be overridden with `MODEL_REQUEST_TIMEOUT_SECONDS` in `.env`.

## Required Verification Sandbox Service

BugFind-15 includes a separate Docker-based verification sandbox service for executing code with real runtimes and compilers. This service is required during benchmark runs because `Fix Quality` depends on execution-backed verification.

- Python via `python3`
- JavaScript via `node`
- Rust via `rustc`
- Go via pinned `go 1.21`

The canonical runner uses a locked-down container with no network access, a read-only root filesystem, and a temporary writable `/tmp`. The long-running service container uses the same verifier image and runtime limits, but exposes port `4010` so the app server can send model replies to it.

For normal usage, you should have two processes running:

1. The verifier sandbox service
2. The web app

Start the verifier web service:

```bash
npm run verify:sandbox:serve
```

If the Docker image does not exist yet, that command builds it automatically before starting the service.

Stop the verifier web service:

```bash
npm run verify:sandbox:stop
```

Run all canonical scenario checks:

```bash
npm run verify:canonical
```

Rebuild the image and run all checks:

```bash
npm run verify:canonical:rebuild
```

Run a single scenario or variant:

```bash
node scripts/verify-sandbox.mjs run --scenario BF-08
node scripts/verify-sandbox.mjs run --scenario BF-15 --variant fixed
```

The app server reads the verifier URL from `BUGFIND_SANDBOX_URL` and calls `POST /verify-answer` after each final model reply. If the service is not running, the benchmark cannot perform official fix verification, so the run should be treated as incomplete rather than authoritative. If the service is running but the model does not provide a valid `<solution>` block, the verifier returns a failure rather than inferring a fix.

## Scoring

- Each scenario produces a 0-100 score from the weighted axis rubric in [METHODOLOGY.md](./METHODOLOGY.md).
- Scenario cells are shown as `pass`, `partial`, or `fail` based on score thresholds.
- Category scores are averaged per category.
- The final score is a weighted average of the 5 category scores:
  - A: 15%
  - B: 25%
  - C: 25%
  - D: 20%
  - E: 15%

## Supported Providers

BugFind-15 accepts models from five OpenAI-compatible providers:

- `openrouter`
- `ollama`
- `llamacpp`
- `mlx`
- `lmstudio`

Model configuration uses comma-separated `provider:model` entries.

## Environment Variables

BugFind-15 reads configuration from `.env`. The main variables are:

- `OPENROUTER_API_KEY`
  Required only if any configured model uses the `openrouter` provider.
- `OLLAMA_HOST`
  Base URL for Ollama. Required only if `LLM_MODELS` or `LLM_MODELS_2` contains an `ollama:` model.
- `LLAMACPP_HOST`
  Base URL for a `llama.cpp` OpenAI-compatible server. Required only if you use a `llamacpp:` model.
- `MLX_HOST`
  Base URL for an `mlx_lm` OpenAI-compatible server. Required only if you use an `mlx:` model.
- `LMSTUDIO_HOST`
  Base URL for LM Studio. Required only if you use an `lmstudio:` model.
- `MODEL_REQUEST_TIMEOUT_SECONDS`
  Per-request model timeout in seconds. Defaults to `30`. Timeout failures are retried up to 3 total attempts.
- `BUGFIND_SANDBOX_URL`
  URL of the required verifier service. Defaults to `http://127.0.0.1:4010`.
- `BUGFIND_SANDBOX_TIMEOUT_MS`
  Timeout for requests from the app server to the verifier service, in milliseconds. Defaults to `20000`.
- `LLM_MODELS`
  Comma-separated `provider:model` list for the primary benchmark table.
- `LLM_MODELS_2`
  Optional second comma-separated `provider:model` list for a secondary table/group in the UI.

Notes:

- Local provider hosts can usually be given as either the raw host or an existing `/v1` endpoint. The app normalizes them to the expected OpenAI-compatible base URL.
- The verifier service is required for authoritative runs, so `BUGFIND_SANDBOX_URL` should point to a running sandbox instance.

## Getting Started

One-time setup:

```bash
npm install
cp .env.example .env
```

Then run the two required processes.

Terminal 1:

```bash
npm run verify:sandbox:serve
```

Terminal 2:

```bash
npm run dev
```

Open `http://localhost:3000`.

Required runtime workflow:

- terminal 1: `npm run verify:sandbox:serve`
- terminal 2: `npm run dev`

## Validation

```bash
npm run lint
npm run typecheck
npm run build
npm run verify:canonical
```

## Repository Structure

- [app/](./app) contains the Next.js app router entry points and styles.
- [components/dashboard.tsx](./components/dashboard.tsx) renders the benchmark UI and live event handling.
- [app/api/run/route.ts](./app/api/run/route.ts) streams benchmark progress over Server-Sent Events.
- [lib/benchmark.ts](./lib/benchmark.ts) defines the BugFind-15 scenarios, scoring rubric, and multi-turn follow-ups.
- [lib/orchestrator.ts](./lib/orchestrator.ts) runs scenarios and captures traces.
- [lib/llm-client.ts](./lib/llm-client.ts) contains the OpenAI-compatible client adapter.
- [lib/sandbox-client.ts](./lib/sandbox-client.ts) sends model replies to the verifier service.
- [lib/models.ts](./lib/models.ts) parses provider configuration and model groups.
- [verification/](./verification) contains the Docker image, verifier service, and native execution fixtures for all 15 scenarios.
- [scripts/verify-sandbox.mjs](./scripts/verify-sandbox.mjs) builds and runs the verifier image from the repo root.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
