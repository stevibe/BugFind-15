export type SandboxVerificationResult =
  | {
      status: "pass";
      scenarioId: string;
      summary: string;
      candidate?: { label: string; source: string };
      candidatesTried: number;
      results: Array<{ label: string; status: string; source: string; checks: Array<Record<string, unknown>> }>;
    }
  | {
      status: "fail";
      scenarioId: string;
      summary: string;
      candidatesTried: number;
      results: Array<{ label: string; status: string; source: string; checks: Array<Record<string, unknown>> }>;
    }
  | {
      status: "skip";
      scenarioId: string;
      summary: string;
      candidatesTried: number;
      results: Array<{ label: string; status: string; source: string; checks: Array<Record<string, unknown>> }>;
    };

const DEFAULT_SANDBOX_URL = "http://127.0.0.1:4010";
const DEFAULT_SANDBOX_TIMEOUT_MS = 20_000;

function resolveSandboxUrl(): string {
  const raw = process.env.BUGFIND_SANDBOX_URL?.trim() || DEFAULT_SANDBOX_URL;
  return raw.replace(/\/+$/, "");
}

function resolveTimeoutMs(): number {
  const raw = process.env.BUGFIND_SANDBOX_TIMEOUT_MS?.trim();

  if (!raw) {
    return DEFAULT_SANDBOX_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SANDBOX_TIMEOUT_MS;
}

export async function verifyAnswerInSandbox(scenarioId: string, answer: string): Promise<SandboxVerificationResult> {
  const sandboxUrl = resolveSandboxUrl();
  const timeoutMs = resolveTimeoutMs();

  let response: Response;

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
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    return {
      status: "skip",
      scenarioId,
      summary: error instanceof Error ? `Sandbox unavailable: ${error.message}` : "Sandbox unavailable.",
      candidatesTried: 0,
      results: []
    };
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    return {
      status: "skip",
      scenarioId,
      summary: payload?.error ? `Sandbox error: ${payload.error}` : `Sandbox error: HTTP ${response.status}.`,
      candidatesTried: 0,
      results: []
    };
  }

  return (await response.json()) as SandboxVerificationResult;
}
