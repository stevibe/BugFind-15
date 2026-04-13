"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAnswerInSandbox = verifyAnswerInSandbox;
const DEFAULT_SANDBOX_URL = "http://127.0.0.1:4010";
const DEFAULT_SANDBOX_TIMEOUT_MS = 20_000;
function resolveSandboxUrl(options) {
    const raw = options?.sandboxUrl?.trim() || process.env.BUGFIND_SANDBOX_URL?.trim() || DEFAULT_SANDBOX_URL;
    return raw.replace(/\/+$/, "");
}
function resolveTimeoutMs(options) {
    if (options?.timeoutMs !== undefined) {
        const requested = Math.trunc(options.timeoutMs);
        if (Number.isFinite(requested) && requested > 0) {
            return requested;
        }
    }
    const raw = process.env.BUGFIND_SANDBOX_TIMEOUT_MS?.trim();
    if (!raw) {
        return DEFAULT_SANDBOX_TIMEOUT_MS;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SANDBOX_TIMEOUT_MS;
}
async function verifyAnswerInSandbox(scenarioId, answer, options) {
    const sandboxUrl = resolveSandboxUrl(options);
    const timeoutMs = resolveTimeoutMs(options);
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);
    const parentSignal = options?.signal;
    const abortController = new AbortController();
    const abortFromParent = () => abortController.abort(parentSignal?.reason);
    const abortFromTimeout = () => abortController.abort(new DOMException("Sandbox timed out.", "TimeoutError"));
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    timeoutController.signal.addEventListener("abort", abortFromTimeout, { once: true });
    let response;
    try {
        response = await fetch(`${sandboxUrl}/verify-answer`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                scenarioId,
                answer
            }),
            signal: abortController.signal
        });
    }
    catch (error) {
        if (parentSignal?.aborted) {
            throw new Error("Sandbox request aborted.");
        }
        return {
            status: "skip",
            scenarioId,
            summary: error instanceof Error ? `Sandbox unavailable: ${error.message}` : "Sandbox unavailable.",
            candidatesTried: 0,
            results: []
        };
    }
    finally {
        clearTimeout(timeoutHandle);
        parentSignal?.removeEventListener("abort", abortFromParent);
    }
    if (!response.ok) {
        const payload = (await response.json().catch(() => null));
        return {
            status: "skip",
            scenarioId,
            summary: payload?.error ? `Sandbox error: ${payload.error}` : `Sandbox error: HTTP ${response.status}.`,
            candidatesTried: 0,
            results: []
        };
    }
    return (await response.json());
}
