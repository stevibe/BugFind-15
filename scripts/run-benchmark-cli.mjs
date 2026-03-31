const DEFAULT_APP_URL = "http://127.0.0.1:3000";

function printHelp() {
  console.log(`Usage:
  npm run benchmark:cli -- [options]

Options:
  --host <url>           App base URL. Default: ${DEFAULT_APP_URL}
  --model <id>           Model id to run. Repeatable.
  --scenario <id>        Scenario id to run. Repeatable.
  --temperature <value>  Sampling temperature.
  --top-p <value>        top_p value.
  --top-k <value>        top_k value.
  --min-p <value>        min_p value.
  --trace                Print full raw trace for each scenario result.
  --json                 Print final scores as JSON.
  --help                 Show this message.

Examples:
  npm run benchmark:cli -- --model lmstudio:qwen/qwen3.5-27b --scenario BF-06 --trace
  npm run benchmark:cli -- --scenario BF-09 --temperature 0
  npm run benchmark:cli -- --model lmstudio:qwen/qwen3.5-27b --model lmstudio:qwen/qwen3.5-35b-a3b
`);
}

function parseArgs(argv) {
  const options = {
    host: DEFAULT_APP_URL,
    models: [],
    scenarios: [],
    trace: false,
    json: false,
    params: {}
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    switch (token) {
      case "--host":
        if (!next) {
          throw new Error("--host requires a value.");
        }
        options.host = next;
        index += 1;
        break;
      case "--model":
        if (!next) {
          throw new Error("--model requires a value.");
        }
        options.models.push(next);
        index += 1;
        break;
      case "--scenario":
        if (!next) {
          throw new Error("--scenario requires a value.");
        }
        options.scenarios.push(next.toUpperCase());
        index += 1;
        break;
      case "--temperature":
        if (!next) {
          throw new Error("--temperature requires a value.");
        }
        options.params.temperature = next;
        index += 1;
        break;
      case "--top-p":
        if (!next) {
          throw new Error("--top-p requires a value.");
        }
        options.params.top_p = next;
        index += 1;
        break;
      case "--top-k":
        if (!next) {
          throw new Error("--top-k requires a value.");
        }
        options.params.top_k = next;
        index += 1;
        break;
      case "--min-p":
        if (!next) {
          throw new Error("--min-p requires a value.");
        }
        options.params.min_p = next;
        index += 1;
        break;
      case "--trace":
        options.trace = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return options;
}

function normalizeHost(host) {
  return host.replace(/\/+$/, "");
}

function buildRunUrl(options) {
  const url = new URL(`${normalizeHost(options.host)}/api/run`);

  if (options.models.length > 0) {
    url.searchParams.set("models", options.models.join(","));
  }

  if (options.scenarios.length > 0) {
    url.searchParams.set("scenarios", options.scenarios.join(","));
  }

  for (const [key, value] of Object.entries(options.params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  return url;
}

function printEvent(event, options) {
  switch (event.type) {
    case "run_started":
      console.log(`Run started: ${event.models.length} model(s), ${event.totalScenarios} scenario(s)`);
      for (const model of event.models) {
        console.log(`  model: ${model.id}`);
      }
      break;
    case "scenario_started":
      console.log(`\n[${event.index}/${event.total}] ${event.scenarioId} ${event.title}`);
      break;
    case "model_progress":
      console.log(`  ${event.modelId}: ${event.message}`);
      break;
    case "scenario_result":
      console.log(`  ${event.modelId}: ${event.result.status.toUpperCase()} ${event.result.score} ${event.result.summary}`);
      if (event.result.note) {
        console.log(`    note: ${event.result.note}`);
      }
      if (options.trace) {
        console.log("");
        console.log(event.result.rawLog);
        console.log("");
      }
      break;
    case "scenario_finished":
      console.log(`Finished ${event.scenarioId}`);
      break;
    case "run_finished":
      if (options.scenarios.length > 0) {
        console.log("\nSubset run note: per-scenario results above are the authoritative audit output. Final scores below remain on the full 15-scenario scale for parity with the web app.");
      }

      if (options.json) {
        console.log("\nFinal scores:");
        console.log(JSON.stringify(event.scores, null, 2));
        break;
      }

      console.log("\nFinal scores:");
      for (const [modelId, score] of Object.entries(event.scores)) {
        console.log(`  ${modelId}: ${score.finalScore}/100 (${score.totalScore}/${score.maxScore}) ${score.rating}`);
      }
      break;
    case "run_error":
      console.error(`Run error: ${event.message}`);
      break;
    default:
      break;
  }
}

async function consumeSse(response, options) {
  if (!response.body) {
    throw new Error("Server returned no response body.");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });

    while (true) {
      const boundary = buffer.indexOf("\n\n");

      if (boundary === -1) {
        break;
      }

      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const dataLines = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6));

      if (dataLines.length === 0) {
        continue;
      }

      const payload = JSON.parse(dataLines.join("\n"));
      printEvent(payload, options);

      if (payload.type === "run_error") {
        process.exitCode = 1;
      }
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const url = buildRunUrl(options);
  console.log(`Requesting ${url.toString()}`);

  let response;

  try {
    response = await fetch(url, {
      headers: {
        Accept: "text/event-stream"
      }
    });
  } catch (error) {
    throw new Error(
      `Failed to reach ${url.origin}. Start the web app with "npm run dev" and try again. ${error instanceof Error ? error.message : ""}`.trim()
    );
  }

  if (!response.ok) {
    throw new Error(`Run endpoint returned HTTP ${response.status}.`);
  }

  await consumeSse(response, options);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
