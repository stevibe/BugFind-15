import { getScenarioCards } from "@/lib/benchmark";
import { getPublicModelConfigGroups, type PublicModelConfig } from "@/lib/models";

import { Dashboard } from "@/components/dashboard";

export default function HomePage() {
  let primaryModels: PublicModelConfig[] = [];
  let secondaryModels: PublicModelConfig[] = [];
  let configError: string | null = null;
  const scenarios = getScenarioCards();

  try {
    const groups = getPublicModelConfigGroups();
    primaryModels = groups.primary;
    secondaryModels = groups.secondary;
  } catch (error) {
    configError = error instanceof Error ? error.message : "Failed to load LLM_MODELS or LLM_MODELS_2.";
  }

  return (
    <main className="page-shell">
      <Dashboard primaryModels={primaryModels} secondaryModels={secondaryModels} scenarios={scenarios} configError={configError} />
    </main>
  );
}
