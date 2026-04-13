"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callModel = callModel;
exports.createInitialMessages = createInitialMessages;
const benchmark_1 = require("../lib/benchmark");
const DEFAULT_MODEL_REQUEST_TIMEOUT_SECONDS = 30;
function normalizeBaseUrl(baseUrl) {
    return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}
function normalizeContent(content) {
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map((part) => (part?.type === "text" ? part.text ?? "" : ""))
            .join("")
            .trim();
    }
    return "";
}
function isTimeoutError(error) {
    if (!(error instanceof Error)) {
        return false;
    }
    return (error.name === "TimeoutError" ||
        error.name === "AbortError" ||
        /aborted due to timeout|timed out/i.test(error.message));
}
function isAbortError(error) {
    if (!(error instanceof Error)) {
        return false;
    }
    return error.name === "AbortError";
}
function resolveRequestTimeoutMs(params) {
    if (params?.request_timeout_seconds !== undefined) {
        const requested = Math.trunc(params.request_timeout_seconds);
        if (Number.isFinite(requested) && requested > 0) {
            return requested * 1000;
        }
    }
    const rawTimeout = process.env.MODEL_REQUEST_TIMEOUT_SECONDS?.trim();
    if (!rawTimeout) {
        return DEFAULT_MODEL_REQUEST_TIMEOUT_SECONDS * 1000;
    }
    const parsed = Number.parseInt(rawTimeout, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return DEFAULT_MODEL_REQUEST_TIMEOUT_SECONDS * 1000;
    }
    return parsed * 1000;
}
async function callModel(model, messages, params) {
    const baseUrl = normalizeBaseUrl(model.baseUrl);
    const requestTimeoutMs = resolveRequestTimeoutMs(params);
    const headers = {
        "Content-Type": "application/json"
    };
    if (model.apiKey) {
        headers.Authorization = `Bearer ${model.apiKey}`;
    }
    const body = {
        model: model.model,
        messages
    };
    if (params?.temperature !== undefined) {
        body.temperature = params.temperature;
    }
    if (params?.top_p !== undefined) {
        body.top_p = params.top_p;
    }
    if (params?.top_k !== undefined) {
        body.top_k = params.top_k;
    }
    if (params?.min_p !== undefined) {
        body.min_p = params.min_p;
    }
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => timeoutController.abort(), requestTimeoutMs);
    const parentSignal = params?.signal;
    const abortController = new AbortController();
    const abortFromParent = () => abortController.abort(parentSignal?.reason);
    const abortFromTimeout = () => abortController.abort(new DOMException("Request timed out.", "TimeoutError"));
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    timeoutController.signal.addEventListener("abort", abortFromTimeout, { once: true });
    let response;
    let payload;
    try {
        response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: abortController.signal
        });
        payload = (await response.json());
    }
    catch (error) {
        if (isAbortError(error) && parentSignal?.aborted) {
            throw new Error("Request aborted.");
        }
        if (isTimeoutError(error)) {
            throw new Error(`Request timed out after ${requestTimeoutMs / 1000}s.`);
        }
        throw error;
    }
    finally {
        clearTimeout(timeoutHandle);
        parentSignal?.removeEventListener("abort", abortFromParent);
    }
    if (!response.ok) {
        throw new Error(payload.error?.message || `Provider request failed with ${response.status}.`);
    }
    const message = payload.choices?.[0]?.message;
    if (!message) {
        throw new Error("Provider returned no assistant message.");
    }
    return {
        content: normalizeContent(message.content)
    };
}
function createInitialMessages(userMessage) {
    return [
        { role: "system", content: benchmark_1.SYSTEM_PROMPT },
        { role: "user", content: userMessage }
    ];
}
