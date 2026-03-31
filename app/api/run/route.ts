import { SCENARIOS } from "@/lib/benchmark";
import { getModelConfigs } from "@/lib/models";
import { runBenchmark, type RunEvent } from "@/lib/orchestrator";
import type { GenerationParams } from "@/lib/llm-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toSseChunk(event: RunEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedIds = searchParams.get("models")?.split(",").filter(Boolean) ?? [];
  const requestedScenarioIds = searchParams.get("scenarios")?.split(",").filter(Boolean) ?? [];

  const params: GenerationParams = {};
  const temperature = searchParams.get("temperature");
  if (temperature !== null) {
    params.temperature = parseFloat(temperature);
  }
  const topP = searchParams.get("top_p");
  if (topP !== null) {
    params.top_p = parseFloat(topP);
  }
  const topK = searchParams.get("top_k");
  if (topK !== null) {
    params.top_k = parseInt(topK, 10);
  }
  const minP = searchParams.get("min_p");
  if (minP !== null) {
    params.min_p = parseFloat(minP);
  }

  let models = [] as ReturnType<typeof getModelConfigs>;
  let configError: string | null = null;

  try {
    const allModels = getModelConfigs();
    models = requestedIds.length > 0 ? allModels.filter((model) => requestedIds.includes(model.id)) : allModels;
  } catch (error) {
    configError = error instanceof Error ? error.message : "Failed to read LLM_MODELS or LLM_MODELS_2.";
  }

  const stream = new ReadableStream({
    async start(controller) {
      const emit = async (event: RunEvent) => {
        controller.enqueue(toSseChunk(event));
      };

      if (configError) {
        await emit({
          type: "run_error",
          message: configError
        });
        controller.close();
        return;
      }

      if (models.length === 0) {
        await emit({
          type: "run_error",
          message: "No models are configured. Add entries to LLM_MODELS or LLM_MODELS_2 in .env before running the suite."
        });
        controller.close();
        return;
      }

      try {
        await runBenchmark(models, emit, requestedScenarioIds, params);
      } catch (error) {
        await emit({
          type: "run_error",
          message: error instanceof Error ? error.message : "Unknown benchmark error."
        });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Scenario-Count": String(SCENARIOS.length)
    }
  });
}
