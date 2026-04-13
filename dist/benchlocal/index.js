"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.manifest = void 0;
const sdk_1 = require("@benchlocal/sdk");
const benchmark_1 = require("../lib/benchmark");
const orchestrator_1 = require("../lib/orchestrator");
const manifest = (0, sdk_1.loadBenchPackManifest)(__dirname);
exports.manifest = manifest;
function toModelConfig(input, baseUrl, apiKey) {
    return {
        id: input.model.id,
        label: input.model.label,
        provider: input.model.provider,
        model: input.model.model,
        baseUrl,
        apiKey
    };
}
exports.default = (0, sdk_1.defineBenchPack)({
    manifest,
    async listScenarios() {
        return (0, benchmark_1.getScenarioCards)().map((scenario) => ({
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
        const helpers = (0, sdk_1.createHostHelpers)(context);
        const verifier = helpers.getRequiredVerifier("verifier", {
            runningOnly: true
        });
        return {
            async runScenario(input, emit) {
                const scenario = helpers.getScenarioById(benchmark_1.SCENARIOS, input.scenario.id);
                const provider = helpers.getRequiredProvider(input.model.provider, {
                    enabledOnly: true
                });
                return (0, orchestrator_1.runScenarioForModel)(toModelConfig(input, provider.baseUrl, helpers.getSecretValue(input.model.provider)), scenario, emit, {
                    ...helpers.resolveGenerationRequest(input.generation),
                    signal: input.abortSignal
                }, {
                    sandboxUrl: verifier.url
                });
            },
            async dispose() { }
        };
    },
    scoreModelResults(results) {
        const summary = (0, benchmark_1.scoreModelResults)((0, sdk_1.requireScoredResults)(results));
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
