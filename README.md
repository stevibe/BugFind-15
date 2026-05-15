# BugFind-15

BugFind-15 is an official [BenchLocal](https://github.com/stevibe/BenchLocal) Bench Pack for deterministic, execution-backed bug finding and fixing. It measures whether a model can identify real defects, produce disciplined fixes, and avoid changing code when a scenario is intentionally a trap.

A Bench Pack is an installable benchmark package that runs inside the [BenchLocal desktop app](https://github.com/stevibe/BenchLocal). BenchLocal provides the shared app experience for provider setup, model selection, verifier lifecycle, sampling controls, run histories, and side-by-side comparison across benchmark packs.

This repository contains the benchmark source: debugging scenarios, scoring logic, methodology, a BenchLocal adapter, a CLI runner, and a verifier runtime for exact execution-backed validation. `main` tracks the maintained Bench Pack version for BenchLocal.

If you need the older standalone web app implementation, use the [`legacy/web-app`](https://github.com/stevibe/BugFind-15/tree/legacy/web-app) branch. That branch is preserved for compatibility, but BenchLocal is now the recommended way to run BugFind-15.

## Run With BenchLocal

1. Download BenchLocal from the [latest BenchLocal release](https://github.com/stevibe/BenchLocal/releases/latest).
2. Open BenchLocal and install BugFind-15 from the official Bench Pack registry.
3. Add one or more models, select BugFind-15, and start a run.

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

## Bench Pack Structure

```text
lib/                    Benchmark core, scoring, transport, and verifier client
benchlocal/             Thin BenchLocal SDK adapter
cli/                    Non-UI runner
verification/           Verifier runtime for exact execution-backed validation
scripts/                Local helper scripts for verifier development
benchlocal.pack.json    Canonical Bench Pack manifest
METHODOLOGY.md          Published benchmark methodology
```

## BenchLocal Adapter

- `benchlocal/index.ts` is the only place that imports `@benchlocal/sdk`.
- `lib/` stays framework-agnostic and is shared by the CLI and BenchLocal.
- `benchlocal.pack.json` is the canonical Bench Pack metadata manifest used for install, inspection, and runtime metadata.
- The verifier is declared declaratively; BenchLocal owns lifecycle and host port assignment.
- The verifier runtime declares its internal `listenPort`; BenchLocal exposes it on a random local host port.

## Methodology

BugFind-15 provides 15 debugging scenarios with live run traces, deterministic rubric scoring, and execution-backed fix verification, all defined by [METHODOLOGY.md](./METHODOLOGY.md).

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

## Verifier Runtime

BugFind-15 depends on a verifier runtime for authoritative runs.

The verifier image includes:

- Python via `python3`
- JavaScript via `node`
- Rust via `rustc`
- Go via pinned `go 1.21`

### BenchLocal Mode

In BenchLocal, the verifier is host-managed:

- BenchLocal builds the image if needed
- BenchLocal starts and stops the container
- BenchLocal assigns a free local host port automatically
- the Bench Pack receives the resolved verifier URL from host context

## BenchLocal and CLI

- Install: `npm install`
- BenchLocal build: `npm run build:benchlocal`
- CLI runner: `npm run cli`
- Methodology: [METHODOLOGY.md](./METHODOLOGY.md)

## Validation

```bash
npm run typecheck
npm run build:benchlocal
npm run verify:canonical
```
