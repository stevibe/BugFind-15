import {
  createHostHelpers,
  defineBenchPlugin,
  definePluginManifest,
  requireScoredResults,
  type ProgressEmitter,
  type ScenarioResult,
  type ScenarioRunInput
} from "@benchlocal/sdk";
import { SCENARIOS, getScenarioCards, scoreModelResults as scoreBugFindResults } from "../lib/benchmark";
import { runScenarioForModel } from "../lib/orchestrator";

type ModelConfig = {
  id: string;
  label: string;
  provider: "openrouter" | "ollama" | "llamacpp" | "mlx" | "lmstudio";
  model: string;
  baseUrl: string;
  apiKey?: string;
};

const manifest = definePluginManifest({
  id: "bugfind-15",
  name: "BugFind-15",
  version: "0.1.0",
  description: "Execution-backed debugging benchmark with verifier-backed scoring across 15 fixed scenarios.",
  entry: "./dist/benchlocal/index.js",
  samplingDefaults: {
    temperature: 0
  },
  theme: {
    accent: "#1f5f78"
  },
  capabilities: {
    tools: false,
    multiTurn: true,
    streamingProgress: true,
    verification: true,
    standaloneWebApp: true
  },
  verifiers: [
    {
      id: "verifier",
      transport: "http",
      required: true,
      defaultMode: "docker",
      docker: {
        buildContext: "./verification",
        containerPort: 4010,
        healthcheckPath: "/health"
      },
      customUrl: {
        defaultUrl: "http://127.0.0.1:4010",
        healthcheckPath: "/health"
      },
      cloud: {}
    }
  ]
});

function toModelConfig(input: ScenarioRunInput, baseUrl: string, apiKey?: string): ModelConfig {
  return {
    id: input.model.id,
    label: input.model.label,
    provider: input.model.provider as ModelConfig["provider"],
    model: input.model.model,
    baseUrl,
    apiKey
  };
}

export { manifest };

export default defineBenchPlugin({
  manifest,

  async listScenarios() {
    return getScenarioCards().map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      category: scenario.category,
      description: scenario.description,
      promptText: scenario.userMessage,
      detailCards: [
        {
          title: "What this tests",
          content: scenario.description
        },
        {
          title: "Success case",
          content: scenario.successCase
        },
        {
          title: "Failure case",
          content: scenario.failureCase
        }
      ]
    }));
  },

  async prepare(context) {
    const helpers = createHostHelpers(context);
    const verifier = helpers.getRequiredVerifier("verifier", {
      runningOnly: true
    });

    return {
      async runScenario(input: ScenarioRunInput, emit: ProgressEmitter): Promise<ScenarioResult> {
        const scenario = helpers.getScenarioById(SCENARIOS, input.scenario.id);
        const provider = helpers.getRequiredProvider(input.model.provider, {
          enabledOnly: true
        });

        return runScenarioForModel(
          toModelConfig(input, provider.baseUrl, helpers.getSecretValue(input.model.provider)),
          scenario,
          emit as Parameters<typeof runScenarioForModel>[2],
          {
            ...helpers.resolveGenerationRequest(input.generation),
            signal: input.abortSignal
          },
          {
            sandboxUrl: verifier.url
          }
        );
      },

      async dispose() {}
    };
  },

  scoreModelResults(results) {
    const summary = scoreBugFindResults(requireScoredResults(results));

    return {
      totalScore: summary.finalScore,
      categories: summary.categoryScores
        .filter((category) => category.weight > 0)
        .map((category) => ({
          id: category.category,
          label: category.label,
          score: category.averageScore,
          weight: category.weight
        })),
      summary: summary.rating
    };
  }
});
