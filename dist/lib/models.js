"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getModelConfigGroups = getModelConfigGroups;
exports.getModelConfigs = getModelConfigs;
exports.getPublicModelConfigGroups = getPublicModelConfigGroups;
exports.getPublicModelConfigs = getPublicModelConfigs;
const PROVIDERS = new Set(["openrouter", "ollama", "llamacpp", "mlx", "lmstudio"]);
function normalizeHostBaseUrl(host, envName) {
    const trimmed = host.trim().replace(/\/+$/, "");
    if (!trimmed) {
        throw new Error(`${envName} is empty.`);
    }
    if (!/^https?:\/\//i.test(trimmed)) {
        throw new Error(`${envName} must start with http:// or https://.`);
    }
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, "");
    if (!path || path === "/") {
        url.pathname = "/v1";
        return url.toString().replace(/\/$/, "");
    }
    if (path.endsWith("/v1")) {
        url.pathname = path;
        return url.toString().replace(/\/$/, "");
    }
    if (path.endsWith("/api")) {
        url.pathname = `${path.slice(0, -4) || ""}/v1`;
        return url.toString().replace(/\/$/, "");
    }
    url.pathname = `${path}/v1`;
    return url.toString().replace(/\/$/, "");
}
function providerLabel(provider) {
    switch (provider) {
        case "openrouter":
            return "OpenRouter";
        case "ollama":
            return "Ollama";
        case "llamacpp":
            return "llama.cpp";
        case "mlx":
            return "mlx_lm";
        case "lmstudio":
            return "LM Studio";
    }
}
function buildProviderBaseUrl(provider, envName) {
    switch (provider) {
        case "openrouter":
            return "https://openrouter.ai/api/v1";
        case "ollama": {
            const host = process.env.OLLAMA_HOST?.trim();
            if (!host) {
                throw new Error(`OLLAMA_HOST is required when ${envName} includes an ollama model.`);
            }
            return normalizeHostBaseUrl(host, "OLLAMA_HOST");
        }
        case "llamacpp": {
            const host = process.env.LLAMACPP_HOST?.trim();
            if (!host) {
                throw new Error(`LLAMACPP_HOST is required when ${envName} includes a llamacpp model.`);
            }
            return normalizeHostBaseUrl(host, "LLAMACPP_HOST");
        }
        case "mlx": {
            const host = process.env.MLX_HOST?.trim();
            if (!host) {
                throw new Error(`MLX_HOST is required when ${envName} includes an mlx model.`);
            }
            return normalizeHostBaseUrl(host, "MLX_HOST");
        }
        case "lmstudio": {
            const host = process.env.LMSTUDIO_HOST?.trim();
            if (!host) {
                throw new Error(`LMSTUDIO_HOST is required when ${envName} includes an lmstudio model.`);
            }
            return normalizeHostBaseUrl(host, "LMSTUDIO_HOST");
        }
    }
}
function buildProviderApiKey(provider, envName) {
    if (provider !== "openrouter") {
        return undefined;
    }
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
        throw new Error(`OPENROUTER_API_KEY is required when ${envName} includes an openrouter model.`);
    }
    return apiKey;
}
function parseProvider(rawProvider, index, envName) {
    const normalized = rawProvider.trim().toLowerCase();
    if (!PROVIDERS.has(normalized)) {
        throw new Error(`${envName} entry ${index + 1} has unsupported provider "${rawProvider}". Use openrouter, ollama, llamacpp, mlx, or lmstudio.`);
    }
    return normalized;
}
function parseModelEntry(entry, index, envName) {
    const trimmed = entry.trim();
    if (!trimmed) {
        throw new Error(`${envName} entry ${index + 1} is empty.`);
    }
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
        throw new Error(`${envName} entry ${index + 1} must use the format provider:model, for example openrouter:openai/gpt-4.1.`);
    }
    const provider = parseProvider(trimmed.slice(0, separatorIndex), index, envName);
    const model = trimmed.slice(separatorIndex + 1).trim();
    if (!model) {
        throw new Error(`${envName} entry ${index + 1} is missing the model name.`);
    }
    return {
        id: `${provider}:${model}`,
        label: `${model} via ${providerLabel(provider)}`,
        provider,
        model,
        baseUrl: buildProviderBaseUrl(provider, envName),
        apiKey: buildProviderApiKey(provider, envName)
    };
}
function parseModelConfigList(envName) {
    const raw = process.env[envName]?.trim() ?? "";
    if (!raw) {
        return [];
    }
    return raw
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry, index) => parseModelEntry(entry, index, envName));
}
function assertUniqueModelIds(models) {
    const seen = new Set();
    for (const model of models) {
        if (seen.has(model.id)) {
            throw new Error(`Duplicate model "${model.id}" found across LLM_MODELS and LLM_MODELS_2. Each configured provider:model must be unique.`);
        }
        seen.add(model.id);
    }
}
function getModelConfigGroups() {
    const primary = parseModelConfigList("LLM_MODELS");
    const secondary = parseModelConfigList("LLM_MODELS_2");
    const all = [...primary, ...secondary];
    assertUniqueModelIds(all);
    return {
        primary,
        secondary,
        all
    };
}
function getModelConfigs() {
    return getModelConfigGroups().all;
}
function getPublicModelConfigGroups() {
    const { primary, secondary, all } = getModelConfigGroups();
    return {
        primary: primary.map(({ apiKey: _apiKey, ...model }) => model),
        secondary: secondary.map(({ apiKey: _apiKey, ...model }) => model),
        all: all.map(({ apiKey: _apiKey, ...model }) => model)
    };
}
function getPublicModelConfigs() {
    return getPublicModelConfigGroups().all;
}
