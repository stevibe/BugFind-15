"use client";

type LogEntry = {
  id: string;
  message: string;
};

type OrchestratorDialogProps = {
  open: boolean;
  onClose: () => void;
  currentScenarioLabel: string;
  status: "idle" | "running" | "done" | "error";
  logs: LogEntry[];
};

export function OrchestratorDialog({
  open,
  onClose,
  currentScenarioLabel,
  status,
  logs
}: OrchestratorDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog-shell" role="dialog" aria-modal="true" aria-labelledby="orchestrator-title">
        <div className="dialog-header">
          <div>
            <p className="eyebrow">Orchestrator</p>
            <h2 id="orchestrator-title">Live Runner Status</h2>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="dialog-summary">
          <div className={`status-chip status-${status}`}>{status}</div>
          <p>{currentScenarioLabel || "Waiting to start benchmark."}</p>
        </div>
        <div className="dialog-log">
          {logs.length === 0 ? (
            <p className="log-empty">No orchestrator events yet.</p>
          ) : (
            logs.map((log) => (
              <div className="log-row" key={log.id}>
                {log.message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
