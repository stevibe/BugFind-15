"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CircleHelp, Play, SlidersHorizontal, X } from "lucide-react";

import { scoreModelResults, type ModelScenarioResult, type ModelScoreSummary, type ScenarioCard } from "@/lib/benchmark";
import type { PublicModelConfig } from "@/lib/models";
import type { RunEvent } from "@/lib/orchestrator";

type DashboardProps = {
  primaryModels: PublicModelConfig[];
  secondaryModels: PublicModelConfig[];
  scenarios: ScenarioCard[];
  configError?: string | null;
};

type CellState = {
  phase: "idle" | "running" | "done";
  result?: ModelScenarioResult;
};

type FailureDetails = {
  modelName: string;
  scenarioId: string;
  summary: string;
  rawLog: string;
  status: ModelScenarioResult["status"];
};

type ScoreSummaryMap = Record<string, ModelScoreSummary>;
type ModelNameOverrideMap = Record<string, string>;
type GenerationConfig = {
  temperature: number;
  top_p: number | undefined;
  top_k: number | undefined;
  min_p: number | undefined;
};

const QWEN_VARIANT_ORDER = ["0.8b", "2b", "4b", "9b", "27b", "35b", "122b", "397b"];
const BENCHMARK_CONFIG_STORAGE_KEY = "bugfind15.benchmark-config";
const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
  temperature: 0,
  top_p: undefined,
  top_k: undefined,
  min_p: undefined
};
const DEFAULT_MAIN_TITLE = "BugFind-15 LLM Bug-Finding Benchmark";

function buildInitialCells(models: PublicModelConfig[], scenarios: ScenarioCard[]): Record<string, Record<string, CellState>> {
  return Object.fromEntries(
    models.map((model) => [
      model.id,
      Object.fromEntries(scenarios.map((scenario) => [scenario.id, { phase: "idle" } satisfies CellState]))
    ])
  );
}

function formatProgress(status: "idle" | "running" | "done" | "error"): string {
  switch (status) {
    case "running":
      return "Running";
    case "done":
      return "Completed";
    case "error":
      return "Errored";
    default:
      return "Idle";
  }
}

function extractVariantLabel(modelName: string): string {
  const match = modelName.toLowerCase().match(/(\d+(?:\.\d+)?)b-a\d+b?(?:-|-*)([a-z0-9]+(?:-[a-z0-9]+)*)/);
  if (match) {
    return `${match[1]}b-${match[2]}`;
  }

  const simple = modelName.toLowerCase().match(/(\d+(?:\.\d+)?)b([a-z0-9\-]*)/);
  if (!simple) {
    return modelName;
  }

  const size = `${simple[1]}b`;
  const suffix = simple[2].replace(/^-+/, "");

  return suffix ? `${size}-${suffix}` : size;
}

function variantOrderIndex(modelName: string): number {
  const label = extractVariantLabel(modelName);
  const index = QWEN_VARIANT_ORDER.indexOf(label);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function buildScoreSummaries(
  cells: Record<string, Record<string, CellState>>,
  models: PublicModelConfig[],
  scenarios: ScenarioCard[]
): ScoreSummaryMap {
  return Object.fromEntries(
    models.flatMap((model) => {
      const results = scenarios
        .map((scenario) => cells[model.id]?.[scenario.id]?.result)
        .filter((result): result is ModelScenarioResult => Boolean(result));

      if (results.length !== scenarios.length) {
        return [];
      }

      return [[model.id, scoreModelResults(results)]];
    })
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4.5 10.2 8.2 14l7.3-8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
    </svg>
  );
}

function PartialIcon() {
  return <AlertTriangle aria-hidden="true" strokeWidth={2.2} />;
}

function normalizeOverrideName(value: string): string {
  return value.trim();
}

type PromptSegment =
  | { type: "prose"; content: string }
  | { type: "code"; language: string | null; content: string };

function parsePromptSegments(text: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  const pattern = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const prose = text.slice(lastIndex, index);
    if (prose.trim()) {
      segments.push({ type: "prose", content: prose });
    }

    segments.push({
      type: "code",
      language: match[1] ?? null,
      content: (match[2] ?? "").replace(/\n+$/, "")
    });

    lastIndex = index + match[0].length;
  }

  const trailing = text.slice(lastIndex);
  if (trailing.trim()) {
    segments.push({ type: "prose", content: trailing });
  }

  return segments;
}

function normalizePromptProse(text: string): string[] {
  return text
    .replace(/^>\s?/gm, "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function renderInlineCodeText(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`)/g).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code key={`${part}-${index}`} className="inline-code">
          {part.slice(1, -1)}
        </code>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function parseStoredGenerationConfig(raw: string | null): GenerationConfig | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<GenerationConfig>;

    return {
      temperature: typeof parsed.temperature === "number" && Number.isFinite(parsed.temperature) ? parsed.temperature : 0,
      top_p: typeof parsed.top_p === "number" && Number.isFinite(parsed.top_p) ? parsed.top_p : undefined,
      top_k: typeof parsed.top_k === "number" && Number.isFinite(parsed.top_k) ? parsed.top_k : undefined,
      min_p: typeof parsed.min_p === "number" && Number.isFinite(parsed.min_p) ? parsed.min_p : undefined
    };
  } catch {
    return null;
  }
}

function getInitialGenerationConfig(): GenerationConfig {
  if (typeof window === "undefined") {
    return DEFAULT_GENERATION_CONFIG;
  }

  return parseStoredGenerationConfig(window.localStorage.getItem(BENCHMARK_CONFIG_STORAGE_KEY)) ?? DEFAULT_GENERATION_CONFIG;
}

function FailureDialog({ details, onClose }: { details: FailureDetails | null; onClose: () => void }) {
  if (!details) {
    return null;
  }

  const statusLabel = details.status === "partial" ? "Partial" : "Failed";
  const statusClass = details.status === "partial" ? "status-partial" : "status-error";

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog-shell trace-dialog" role="dialog" aria-modal="true" aria-labelledby="trace-title">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">Scenario Trace</p>
            <h2 id="trace-title">
              {details.scenarioId} · {details.modelName}
            </h2>
          </div>
          <button className="icon-button ghost-button" type="button" onClick={onClose} aria-label="Close configuration" title="Close">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="dialog-summary">
          <div className={`status-chip ${statusClass}`}>{statusLabel}</div>
          <p>{details.summary}</p>
        </div>
        <pre className="trace-log">{details.rawLog}</pre>
      </div>
    </div>
  );
}

function ScenarioInfoDialog({
  scenario,
  onClose
}: {
  scenario: ScenarioCard | null;
  onClose: () => void;
}) {
  if (!scenario) {
    return null;
  }

  const segments = parsePromptSegments(scenario.userMessage);

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog-shell trace-dialog" role="dialog" aria-modal="true" aria-labelledby="scenario-info-title">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">Scenario Prompt</p>
            <h2 id="scenario-info-title">
              {scenario.id} · {scenario.title}
            </h2>
          </div>
          <button className="icon-button ghost-button" type="button" onClick={onClose} aria-label="Close scenario prompt" title="Close">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="scenario-info-content">
          {segments.map((segment, index) =>
            segment.type === "code" ? (
              <div key={`code-${index}`} className="scenario-info-code-block">
                {segment.language ? <div className="scenario-info-code-label">{segment.language}</div> : null}
                <pre className="scenario-info-code">
                  <code>{segment.content}</code>
                </pre>
              </div>
            ) : (
              normalizePromptProse(segment.content).map((paragraph, paragraphIndex) => (
                <p key={`prose-${index}-${paragraphIndex}`} className="scenario-info-prose">
                  {paragraph}
                </p>
              ))
            )
          )}
        </div>
      </div>
    </div>
  );
}

function ModelNameDialog({
  model,
  value,
  onChange,
  onReset,
  onClose
}: {
  model: PublicModelConfig | null;
  value: string;
  onChange: (value: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  if (!model) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog-shell model-name-dialog" role="dialog" aria-modal="true" aria-labelledby="model-name-title">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">Display Name</p>
            <h2 id="model-name-title">Override model label</h2>
          </div>
          <button className="icon-button ghost-button" type="button" onClick={onClose} aria-label="Close model name editor" title="Close">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="dialog-summary model-name-summary">
          <p>
            Temporary UI-only override for screencasting. Refreshing the page restores the original model name.
          </p>
        </div>
        <div className="model-name-meta">
          <div>
            <span className="config-label">Original</span>
            <p className="model-name-original">{model.model}</p>
          </div>
          <div>
            <span className="config-label">Provider</span>
            <p className="model-name-original">{model.provider}</p>
          </div>
        </div>
        <label className="config-field model-name-field">
          <span className="config-label">Display name</span>
          <input
            className="config-input"
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder={model.model}
            autoFocus
          />
        </label>
        <div className="model-name-actions">
          <button className="ghost-button" type="button" onClick={onReset}>
            Reset
          </button>
          <button className="primary-button" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function MainTitleDialog({
  value,
  onChange,
  onReset,
  onClose
}: {
  value: string;
  onChange: (value: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog-shell model-name-dialog" role="dialog" aria-modal="true" aria-labelledby="main-title-title">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">Display Title</p>
            <h2 id="main-title-title">Override benchmark title</h2>
          </div>
          <button className="icon-button ghost-button" type="button" onClick={onClose} aria-label="Close title editor" title="Close">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="dialog-summary model-name-summary">
          <p>Temporary UI-only override for screencasting. Refreshing the page restores the original title.</p>
        </div>
        <div className="model-name-meta">
          <div>
            <span className="config-label">Original</span>
            <p className="model-name-original">{DEFAULT_MAIN_TITLE}</p>
          </div>
        </div>
        <label className="config-field model-name-field">
          <span className="config-label">Display title</span>
          <input
            className="config-input"
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder={DEFAULT_MAIN_TITLE}
            autoFocus
          />
        </label>
        <div className="model-name-actions">
          <button className="ghost-button" type="button" onClick={onReset}>
            Reset
          </button>
          <button className="primary-button" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfigDialog({
  open,
  onClose,
  genParams,
  setGenParams
}: {
  open: boolean;
  onClose: () => void;
  genParams: GenerationConfig;
  setGenParams: React.Dispatch<React.SetStateAction<GenerationConfig>>;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog-shell config-dialog" role="dialog" aria-modal="true" aria-labelledby="config-title">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">Benchmark Config</p>
            <h2 id="config-title">Generation Parameters</h2>
          </div>
          <button className="icon-button ghost-button" type="button" onClick={onClose} aria-label="Close configuration" title="Close">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="config-grid dialog-config-grid">
          <label className="config-field">
            <span className="config-label">Temperature</span>
            <input
              className="config-input"
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={genParams.temperature}
              onChange={(e) => setGenParams((prev) => ({ ...prev, temperature: parseFloat(e.target.value) || 0 }))}
            />
          </label>
          <label className="config-field">
            <span className="config-label">Top P</span>
            <input
              className="config-input"
              type="number"
              step="0.05"
              min="0"
              max="1"
              placeholder="default"
              value={genParams.top_p ?? ""}
              onChange={(e) =>
                setGenParams((prev) => {
                  const value = e.target.value === "" ? undefined : parseFloat(e.target.value);
                  return { ...prev, top_p: value };
                })
              }
            />
          </label>
          <label className="config-field">
            <span className="config-label">Top K</span>
            <input
              className="config-input"
              type="number"
              step="1"
              min="0"
              placeholder="default"
              value={genParams.top_k ?? ""}
              onChange={(e) =>
                setGenParams((prev) => {
                  const value = e.target.value === "" ? undefined : parseInt(e.target.value, 10);
                  return { ...prev, top_k: value };
                })
              }
            />
          </label>
          <label className="config-field">
            <span className="config-label">Min P</span>
            <input
              className="config-input"
              type="number"
              step="0.05"
              min="0"
              max="1"
              placeholder="default"
              value={genParams.min_p ?? ""}
              onChange={(e) =>
                setGenParams((prev) => {
                  const value = e.target.value === "" ? undefined : parseFloat(e.target.value);
                  return { ...prev, min_p: value };
                })
              }
            />
          </label>
        </div>
      </div>
    </div>
  );
}

export function Dashboard({ primaryModels, secondaryModels, scenarios, configError }: DashboardProps) {
  const allModels = useMemo(() => [...primaryModels, ...secondaryModels], [primaryModels, secondaryModels]);
  const [cells, setCells] = useState(() => buildInitialCells(allModels, scenarios));
  const cellsRef = useRef(cells);
  const [scoreSummaries, setScoreSummaries] = useState<ScoreSummaryMap>({});
  const [modelNameOverrides, setModelNameOverrides] = useState<ModelNameOverrideMap>({});
  const [runnerStatus, setRunnerStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [currentScenarioId, setCurrentScenarioId] = useState(scenarios[0]?.id ?? "");
  const [focusedScenarioId, setFocusedScenarioId] = useState<string | null>(null);
  const [logs, setLogs] = useState<Array<{ id: string; message: string }>>([]);
  const [failureDetails, setFailureDetails] = useState<FailureDetails | null>(null);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editingModelDraft, setEditingModelDraft] = useState("");
  const [mainTitleOverride, setMainTitleOverride] = useState("");
  const [mainTitleDraft, setMainTitleDraft] = useState("");
  const [mainTitleOpen, setMainTitleOpen] = useState(false);
  const [scenarioInfoOpen, setScenarioInfoOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [genParams, setGenParams] = useState<GenerationConfig>(getInitialGenerationConfig);
  const eventSourceRef = useRef<EventSource | null>(null);

  const displayPrimaryModels = useMemo(
    () => [...primaryModels].sort((left, right) => variantOrderIndex(left.model) - variantOrderIndex(right.model)),
    [primaryModels]
  );
  const displaySecondaryModels = useMemo(
    () => [...secondaryModels].sort((left, right) => variantOrderIndex(left.model) - variantOrderIndex(right.model)),
    [secondaryModels]
  );
  const displayAllModels = useMemo(
    () => [...displayPrimaryModels, ...displaySecondaryModels],
    [displayPrimaryModels, displaySecondaryModels]
  );
  const rankedScorecards = useMemo(
    () =>
      displayAllModels
        .flatMap((model) => {
          const summary = scoreSummaries[model.id];
          return summary ? [{ model, summary }] : [];
        })
        .sort((left, right) => {
          if (right.summary.finalScore !== left.summary.finalScore) {
            return right.summary.finalScore - left.summary.finalScore;
          }

          if (right.summary.totalScore !== left.summary.totalScore) {
            return right.summary.totalScore - left.summary.totalScore;
          }

          return variantOrderIndex(left.model.model) - variantOrderIndex(right.model.model);
        }),
    [displayAllModels, scoreSummaries]
  );
  const editingModel = displayAllModels.find((model) => model.id === editingModelId) ?? null;
  const detailScenarioId = focusedScenarioId ?? currentScenarioId;
  const detailScenario = scenarios.find((scenario) => scenario.id === detailScenarioId) ?? scenarios[0];
  const currentScenario = scenarios.find((scenario) => scenario.id === currentScenarioId) ?? scenarios[0];
  const currentScenarioLabel = currentScenario ? `${currentScenario.id} ${currentScenario.title}` : "";

  function displayModelName(model: PublicModelConfig): string {
    return modelNameOverrides[model.id] || model.model;
  }

  function displayMainTitle(): string {
    return mainTitleOverride || DEFAULT_MAIN_TITLE;
  }

  function openModelNameDialog(model: PublicModelConfig) {
    setEditingModelId(model.id);
    setEditingModelDraft(displayModelName(model));
  }

  function closeModelNameDialog() {
    if (editingModel) {
      const normalized = normalizeOverrideName(editingModelDraft);
      setModelNameOverrides((previous) => {
        if (!normalized || normalized === editingModel.model) {
          const next = { ...previous };
          delete next[editingModel.id];
          return next;
        }

        return {
          ...previous,
          [editingModel.id]: normalized
        };
      });
    }

    setEditingModelId(null);
    setEditingModelDraft("");
  }

  function openMainTitleDialog() {
    setMainTitleDraft(displayMainTitle());
    setMainTitleOpen(true);
  }

  function closeMainTitleDialog() {
    const normalized = normalizeOverrideName(mainTitleDraft);
    setMainTitleOverride(!normalized || normalized === DEFAULT_MAIN_TITLE ? "" : normalized);
    setMainTitleOpen(false);
    setMainTitleDraft("");
  }

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(BENCHMARK_CONFIG_STORAGE_KEY, JSON.stringify(genParams));
  }, [genParams]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (failureDetails) {
        setFailureDetails(null);
        return;
      }

      if (mainTitleOpen) {
        closeMainTitleDialog();
        return;
      }

      if (editingModelId) {
        closeModelNameDialog();
        return;
      }

      if (scenarioInfoOpen) {
        setScenarioInfoOpen(false);
        return;
      }

      if (configOpen) {
        setConfigOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [configOpen, editingModelDraft, editingModelId, editingModel, failureDetails, mainTitleDraft, mainTitleOpen, scenarioInfoOpen]);

  function appendLog(message: string) {
    setLogs((previous) => {
      const next = [...previous, { id: crypto.randomUUID(), message }];
      return next.slice(-80);
    });
  }

  function resetRunState() {
    const nextCells = buildInitialCells(allModels, scenarios);
    cellsRef.current = nextCells;
    setCells(nextCells);
    setScoreSummaries({});
    setLogs([]);
    setFailureDetails(null);
    setScenarioInfoOpen(false);
    setCurrentScenarioId(scenarios[0]?.id ?? "");
    setFocusedScenarioId(null);
  }

  function resetScenarioState(scenarioId: string) {
    setCells((previous) => {
      const next = Object.fromEntries(
        allModels.map((model) => [
          model.id,
          {
            ...(previous[model.id] ?? {}),
            [scenarioId]: { phase: "idle" } satisfies CellState
          }
        ])
      );
      cellsRef.current = next;
      return next;
    });
    setFailureDetails((previous) => (previous?.scenarioId === scenarioId ? null : previous));
    setCurrentScenarioId(scenarioId);
    setFocusedScenarioId(scenarioId);
  }

  function updateCell(modelId: string, scenarioId: string, updater: (previous: CellState) => CellState) {
    setCells((previous) => {
      const next = {
        ...previous,
        [modelId]: {
          ...previous[modelId],
          [scenarioId]: updater(previous[modelId]?.[scenarioId] ?? { phase: "idle" })
        }
      };
      cellsRef.current = next;
      return next;
    });
  }

  function renderScoreboard() {
    if (rankedScorecards.length === 0) {
      return null;
    }

    return (
      <section className="scoreboard">
        {rankedScorecards.map(({ model, summary }) => (
          <article key={model.id} className="score-card">
            <div>
              <div className="score-card-header">
                <div>
                  <p className="eyebrow">Result</p>
                  <h2>
                    <button className="model-name-button" type="button" onClick={() => openModelNameDialog(model)}>
                      {displayModelName(model)}
                    </button>
                  </h2>
                </div>
              </div>
              <p className="score-rating">{summary.rating} via {model.provider}</p>
              <p className="score-rating">{summary.totalScore}/{summary.maxScore} aggregate score</p>
            </div>
            <div>
              <strong className="score-value">{summary.finalScore}%</strong>
              <div className="category-strip">
                {summary.categoryScores.map((categoryScore) => (
                  <span key={categoryScore.category} className="category-pill">
                    <strong>{categoryScore.category}</strong>
                    <span>{categoryScore.percent}%</span>
                  </span>
                ))}
              </div>
            </div>
          </article>
        ))}
      </section>
    );
  }

  function handleEvent(event: RunEvent) {
    switch (event.type) {
      case "run_started":
        setRunnerStatus("running");
        appendLog(`Run started for ${event.models.length} model(s).`);
        break;
      case "scenario_started":
        setCurrentScenarioId(event.scenarioId);
        appendLog(`Starting ${event.scenarioId} ${event.title}.`);
        break;
      case "model_progress":
        updateCell(event.modelId, event.scenarioId, (previous) => ({
          ...previous,
          phase: "running"
        }));
        appendLog(`${event.modelId} · ${event.scenarioId}: ${event.message}`);
        break;
      case "scenario_result":
        updateCell(event.modelId, event.scenarioId, () => ({
          phase: "done",
          result: event.result
        }));
        appendLog(`${event.modelId} · ${event.scenarioId}: ${event.result.status.toUpperCase()} ${event.result.score}% (${event.result.summary})`);
        break;
      case "scenario_finished":
        appendLog(`Completed ${event.scenarioId} across all variants.`);
        break;
      case "run_finished":
        setRunnerStatus("done");
        setScoreSummaries(event.scores);
        appendLog("Benchmark completed.");
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        break;
      case "run_error":
        setRunnerStatus("error");
        appendLog(`Error: ${event.message}`);
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        break;
    }
  }

  function startRun(targetScenarioId?: string) {
    eventSourceRef.current?.close();
    if (targetScenarioId) {
      resetScenarioState(targetScenarioId);
      appendLog(`Retrying ${targetScenarioId} across all variants.`);
    } else {
      resetRunState();
    }
    setRunnerStatus("running");

    const params = new URLSearchParams({
      models: displayAllModels.map((model) => model.id).join(",")
    });

    if (targetScenarioId) {
      params.set("scenarios", targetScenarioId);
    }

    if (genParams.temperature !== 0) {
      params.set("temperature", String(genParams.temperature));
    }

    if (genParams.top_p !== undefined) {
      params.set("top_p", String(genParams.top_p));
    }

    if (genParams.top_k !== undefined) {
      params.set("top_k", String(genParams.top_k));
    }

    if (genParams.min_p !== undefined) {
      params.set("min_p", String(genParams.min_p));
    }

    const source = new EventSource(`/api/run?${params.toString()}`);
    eventSourceRef.current = source;

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RunEvent;
      handleEvent(event);
    };

    source.onerror = () => {
      if (eventSourceRef.current) {
        setRunnerStatus("error");
        appendLog("Event stream disconnected.");
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }

  function renderCell(model: PublicModelConfig, scenario: ScenarioCard) {
    const cell = cells[model.id]?.[scenario.id];

    if (cell?.phase === "running") {
      return (
        <div className="result-icon-shell result-loading" aria-label={`${scenario.id} loading`}>
          <span className="spinner" />
        </div>
      );
    }

    if (cell?.result) {
      const isPass = cell.result.status === "pass";
      const isPartial = cell.result.status === "partial";

      return (
        <button
          className={`result-icon-button ${isPass ? "result-pass" : isPartial ? "result-partial" : "result-fail"}`}
          type="button"
          aria-label={`${scenario.id} ${isPass ? "passed" : isPartial ? "partially passed" : "failed"} for ${extractVariantLabel(model.model)}. Show trace.`}
          onClick={() =>
            setFailureDetails({
              modelName: displayModelName(model),
              scenarioId: scenario.id,
              summary: cell.result?.summary ?? "Scenario failed.",
              rawLog: cell.result?.rawLog ?? "No raw log available.",
              status: cell.result?.status ?? "fail"
            })
          }
        >
          {isPass ? <CheckIcon /> : isPartial ? <PartialIcon /> : <CrossIcon />}
        </button>
      );
    }

    return <div className="result-icon-shell result-idle" aria-hidden="true" />;
  }

  function renderModelTable(title: string, models: PublicModelConfig[]) {
    return (
      <section className="table-card">
        <div className="table-scroll">
          <table className="result-table minimalist-table">
            <thead>
              <tr>
                <th>Model</th>
                {scenarios.map((scenario) => (
                  <th
                    key={scenario.id}
                    className={`${scenario.id === currentScenarioId ? "active-column" : ""} ${scenario.id === detailScenarioId ? "selected-column" : ""}`.trim()}
                  >
                    <div className="column-heading">
                      <button
                        className="column-button"
                        type="button"
                        onClick={(event) => {
                          if (event.shiftKey) {
                            startRun(scenario.id);
                            return;
                          }

                          setFocusedScenarioId(scenario.id);
                        }}
                        onDoubleClick={() => {
                          setFocusedScenarioId(scenario.id);
                          setScenarioInfoOpen(true);
                        }}
                        title="Shift+Click to retry this scenario"
                      >
                        {scenario.id}
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {models.length > 0 ? (
                models.map((model) => (
                  <tr key={model.id}>
                    <td className="scenario-row-label">
                      <button className="model-badge model-badge-button" type="button" onClick={() => openModelNameDialog(model)}>
                        {displayModelName(model)}
                      </button>
                    </td>
                    {scenarios.map((scenario) => (
                      <td
                        key={`${model.id}-${scenario.id}`}
                        className={`result-icon-cell ${scenario.id === currentScenarioId ? "active-column" : ""}`.trim()}
                      >
                        {renderCell(model, scenario)}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="empty-table-row" colSpan={scenarios.length + 1}>
                    No models configured in {title}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="hero-panel">
        <div>
          <h1>
            <button className="main-title-button" type="button" onClick={openMainTitleDialog}>
              {displayMainTitle()}
            </button>
          </h1>
          {configError ? <p className="config-error">{configError}</p> : null}
        </div>
        <div className="hero-actions">
          <button
            className="icon-button primary-button"
            type="button"
            onClick={() => startRun()}
            disabled={allModels.length === 0 || runnerStatus === "running"}
            aria-label={runnerStatus === "running" ? "Benchmark running" : "Run benchmark"}
            title={runnerStatus === "running" ? "Benchmark running" : "Run benchmark"}
          >
            <Play aria-hidden="true" size={18} />
          </button>
          <button
            className="icon-button ghost-button"
            type="button"
            onClick={() => setConfigOpen(true)}
            aria-label="Open benchmark configuration"
            title="Generation parameters"
          >
            <SlidersHorizontal aria-hidden="true" size={18} />
          </button>
        </div>
      </section>

      <section className="scenario-focus">
        <div className="scenario-focus-header">
          <div>
            <p className="eyebrow">{focusedScenarioId ? "Viewing Scenario" : runnerStatus === "running" ? "Current Scenario" : "Scenario Preview"}</p>
            <div className="scenario-title-row">
              <h2>
                {detailScenario?.id} · {detailScenario?.title}
              </h2>
              <button
                className="icon-button ghost-button scenario-info-trigger"
                type="button"
                onClick={() => setScenarioInfoOpen(true)}
                aria-label={`Open ${detailScenario?.id} scenario prompt`}
                title="View scenario prompt"
              >
                <CircleHelp aria-hidden="true" size={18} />
              </button>
            </div>
          </div>
          <div className={`status-chip status-${runnerStatus}`}>{runnerStatus === "running" ? "Live" : formatProgress(runnerStatus)}</div>
        </div>
        <div className="scenario-detail-grid">
          <article className="scenario-detail-card">
            <h3>What this tests</h3>
            <p>{detailScenario ? renderInlineCodeText(detailScenario.description) : null}</p>
          </article>
          <article className="scenario-detail-card">
            <h3>Success case</h3>
            <p>{detailScenario ? renderInlineCodeText(detailScenario.successCase) : null}</p>
          </article>
          <article className="scenario-detail-card">
            <h3>Failure case</h3>
            <p>{detailScenario ? renderInlineCodeText(detailScenario.failureCase) : null}</p>
          </article>
        </div>
      </section>

      {renderScoreboard()}

      {renderModelTable("LLM_MODELS", displayPrimaryModels)}
      {secondaryModels.length > 0 ? renderModelTable("LLM_MODELS_2", displaySecondaryModels) : null}

      <ConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} genParams={genParams} setGenParams={setGenParams} />
      <FailureDialog details={failureDetails} onClose={() => setFailureDetails(null)} />
      <ModelNameDialog
        model={editingModel}
        value={editingModelDraft}
        onChange={setEditingModelDraft}
        onReset={() => {
          if (!editingModel) {
            return;
          }

          setEditingModelDraft(editingModel.model);
        }}
        onClose={closeModelNameDialog}
      />
      {mainTitleOpen ? (
        <MainTitleDialog
          value={mainTitleDraft}
          onChange={setMainTitleDraft}
          onReset={() => setMainTitleDraft(DEFAULT_MAIN_TITLE)}
          onClose={closeMainTitleDialog}
        />
      ) : null}
      <ScenarioInfoDialog scenario={scenarioInfoOpen ? detailScenario ?? null : null} onClose={() => setScenarioInfoOpen(false)} />
    </>
  );
}
