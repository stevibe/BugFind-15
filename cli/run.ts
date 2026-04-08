import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { SCENARIOS, scoreModelResults, type ModelScenarioResult, type ScenarioDefinition } from "@/lib/benchmark";
import type { GenerationParams } from "@/lib/llm-client";
import { getModelConfigs, type ModelConfig } from "@/lib/models";
import { runScenarioForModel, type RunEvent } from "@/lib/orchestrator";

type CliOptions = {
  scenarioIds: string[];
  modelIds: string[];
  showRaw: boolean;
  json: boolean;
  temperature?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  requestTimeoutSeconds?: number;
  sandboxUrl?: string;
  sandboxTimeoutMs?: number;
};

type ScenarioRunSummary = {
  scenarioId: string;
  title: string;
  results: Array<{
    modelId: string;
    label: string;
    status: ModelScenarioResult["status"];
    score: number;
    summary: string;
    note?: string;
    rawLog?: string;
  }>;
};

function loadDotEnvIfPresent(): void {
  const envPath = path.join(process.cwd(), ".env");

  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function printUsage(): void {
  console.log(`BugFind-15 CLI

Usage:
  npm run cli -- [options]

Options:
  --scenario BF-01
  --scenarios BF-01,BF-02
  --model openrouter:...
  --models id1,id2
  --temperature 0
  --top-p 1
  --top-k 0
  --min-p 0
  --timeout 30
  --sandbox-url http://127.0.0.1:4010
  --sandbox-timeout-ms 20000
  --show-raw
  --json
  --help
`);
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a valid number.`);
  }

  return parsed;
}

function parseInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a valid integer.`);
  }

  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    scenarioIds: [],
    modelIds: [],
    showRaw: false,
    json: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--scenario":
        options.scenarioIds.push(argv[++index] ?? "");
        break;
      case "--scenarios":
        options.scenarioIds.push(...(argv[++index] ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
        break;
      case "--model":
        options.modelIds.push(argv[++index] ?? "");
        break;
      case "--models":
        options.modelIds.push(...(argv[++index] ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
        break;
      case "--temperature":
        options.temperature = parseNumber(argv[++index] ?? "", "--temperature");
        break;
      case "--top-p":
        options.topP = parseNumber(argv[++index] ?? "", "--top-p");
        break;
      case "--top-k":
        options.topK = parseInteger(argv[++index] ?? "", "--top-k");
        break;
      case "--min-p":
        options.minP = parseNumber(argv[++index] ?? "", "--min-p");
        break;
      case "--timeout":
        options.requestTimeoutSeconds = parseInteger(argv[++index] ?? "", "--timeout");
        break;
      case "--sandbox-url":
        options.sandboxUrl = argv[++index] ?? "";
        break;
      case "--sandbox-timeout-ms":
        options.sandboxTimeoutMs = parseInteger(argv[++index] ?? "", "--sandbox-timeout-ms");
        break;
      case "--show-raw":
        options.showRaw = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.scenarioIds = Array.from(new Set(options.scenarioIds.filter(Boolean)));
  options.modelIds = Array.from(new Set(options.modelIds.filter(Boolean)));

  return options;
}

function resolveScenarios(requestedIds: string[]): ScenarioDefinition[] {
  if (requestedIds.length === 0) {
    return SCENARIOS;
  }

  const selected = SCENARIOS.filter((scenario) => requestedIds.includes(scenario.id));
  if (selected.length !== requestedIds.length) {
    const selectedIds = new Set(selected.map((scenario) => scenario.id));
    const missing = requestedIds.filter((scenarioId) => !selectedIds.has(scenarioId));
    throw new Error(`Unknown scenario id${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
  }

  return selected;
}

function resolveModels(requestedIds: string[]): ModelConfig[] {
  const models = getModelConfigs();

  if (requestedIds.length === 0) {
    return models;
  }

  const selected = models.filter((model) => requestedIds.includes(model.id));
  if (selected.length !== requestedIds.length) {
    const selectedIds = new Set(selected.map((model) => model.id));
    const missing = requestedIds.filter((modelId) => !selectedIds.has(modelId));
    throw new Error(`Unknown configured model id${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`);
  }

  return selected;
}

function buildGenerationParams(options: CliOptions): GenerationParams | undefined {
  const params: GenerationParams = {};

  if (options.temperature !== undefined) {
    params.temperature = options.temperature;
  }
  if (options.topP !== undefined) {
    params.top_p = options.topP;
  }
  if (options.topK !== undefined) {
    params.top_k = options.topK;
  }
  if (options.minP !== undefined) {
    params.min_p = options.minP;
  }
  if (options.requestTimeoutSeconds !== undefined) {
    params.request_timeout_seconds = options.requestTimeoutSeconds;
  }

  return Object.keys(params).length > 0 ? params : undefined;
}

function logProgress(event: RunEvent): void {
  if (event.type === "model_progress") {
    process.stdout.write(`  ${event.modelId} ${event.scenarioId}: ${event.message}\n`);
  }
}

function printHumanSummary(
  summaries: ScenarioRunSummary[],
  modelResults: Map<string, ModelScenarioResult[]>,
  ranFullSuite: boolean
): void {
  for (const summary of summaries) {
    console.log(`\n${summary.scenarioId} ${summary.title}`);

    for (const result of summary.results) {
      console.log(`- ${result.label}`);
      console.log(`  status: ${result.status}`);
      console.log(`  score: ${result.score}`);
      console.log(`  summary: ${result.summary}`);
      if (result.note) {
        console.log(`  note: ${result.note}`);
      }
      if (result.rawLog) {
        console.log("  raw:");
        console.log(result.rawLog.split("\n").map((line) => `    ${line}`).join("\n"));
      }
    }
  }

  if (!ranFullSuite) {
    console.log("\nSubset run note: per-scenario scores above are authoritative for this audit pass.");
    return;
  }

  console.log("\nFinal scores");
  for (const [modelId, results] of modelResults.entries()) {
    const summary = scoreModelResults(results);
    console.log(`- ${modelId}: ${summary.finalScore}/100 (${summary.totalScore}/${summary.maxScore}) ${summary.rating}`);
  }
}

async function main(): Promise<void> {
  loadDotEnvIfPresent();

  const options = parseArgs(process.argv.slice(2));
  const scenarios = resolveScenarios(options.scenarioIds);
  const models = resolveModels(options.modelIds);
  const generationParams = buildGenerationParams(options);

  if (models.length === 0) {
    throw new Error("No models are configured. Add entries to LLM_MODELS or LLM_MODELS_2 in .env.");
  }

  const summaries: ScenarioRunSummary[] = [];
  const modelResults = new Map<string, ModelScenarioResult[]>(models.map((model) => [model.id, []]));

  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    process.stdout.write(`\n[${scenarioIndex + 1}/${scenarios.length}] ${scenario.id} ${scenario.title}\n`);
    const scenarioSummary: ScenarioRunSummary = {
      scenarioId: scenario.id,
      title: scenario.title,
      results: []
    };

    for (const model of models) {
      const result = await runScenarioForModel(
        model,
        scenario,
        (event) => logProgress(event as RunEvent),
        generationParams,
        {
          sandboxUrl: options.sandboxUrl,
          timeoutMs: options.sandboxTimeoutMs
        }
      );

      modelResults.get(model.id)?.push(result);
      scenarioSummary.results.push({
        modelId: model.id,
        label: model.label,
        status: result.status,
        score: result.score,
        summary: result.summary,
        note: result.note,
        rawLog: options.showRaw ? result.rawLog : undefined
      });
    }

    summaries.push(scenarioSummary);
  }

  if (options.json) {
    const payload = {
      scenarios: summaries,
      scores: Object.fromEntries(
        Array.from(modelResults.entries()).map(([modelId, results]) => [modelId, scoreModelResults(results)])
      )
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  printHumanSummary(summaries, modelResults, scenarios.length === SCENARIOS.length);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
