"use client";

import { useState, useEffect } from "react";
import { X, Play, Loader2 } from "lucide-react";
import { fetchWorkflows, submitWorkflow } from "@/lib/api";
import { visibilitySuffix } from "./Visibility";
import type { WorkflowDefinition, WorkflowRun } from "@/lib/types";

interface Props {
  onSubmit: (run: WorkflowRun) => void;
  onClose: () => void;
}

export function SubmitWorkflowModal({ onSubmit, onClose }: Props) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [loadingWorkflows, setLoadingWorkflows] = useState(true);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);

  const [workflowId, setWorkflowId] = useState("");
  const [userRequest, setUserRequest] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch workflow definitions from the backend
  useEffect(() => {
    let cancelled = false;
    fetchWorkflows()
      .then((wfs) => {
        if (cancelled) return;
        setWorkflows(wfs);
        if (wfs.length > 0) setWorkflowId(wfs[0].id);
      })
      .catch((err) => {
        if (cancelled) return;
        setWorkflowsError(err instanceof Error ? err.message : "Failed to load workflows");
      })
      .finally(() => {
        if (!cancelled) setLoadingWorkflows(false);
      });
    return () => { cancelled = true; };
  }, []);

  const selectedWorkflow = workflows.find((w) => w.id === workflowId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userRequest.trim() || !workflowId) return;
    setLoading(true);
    setError(null);
    try {
      const run = await submitWorkflow({ workflow_id: workflowId, user_request: userRequest.trim() });
      onSubmit(run);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit workflow");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-white">New Workflow Run</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Workflow selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Workflow</label>

            {loadingWorkflows ? (
              <div className="flex items-center gap-2 py-2.5 text-slate-500 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading workflows…
              </div>
            ) : workflowsError ? (
              <p className="text-xs text-red-400 bg-red-950/30 border border-red-800 rounded-lg px-3 py-2">
                {workflowsError}
              </p>
            ) : workflows.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No workflows available</p>
            ) : (
              <>
                <select
                  value={workflowId}
                  onChange={(e) => setWorkflowId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500"
                >
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}{visibilitySuffix(w)}
                    </option>
                  ))}
                </select>
                {selectedWorkflow && (
                  <p className="text-xs text-slate-500">{selectedWorkflow.description}</p>
                )}
              </>
            )}
          </div>

          {/* Steps preview */}
          {selectedWorkflow && selectedWorkflow.steps.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Steps</label>
              <div className="flex flex-wrap gap-1.5">
                {selectedWorkflow.steps.map((step, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 text-[10px] text-slate-400 border border-slate-700"
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        step.type === "approval"
                          ? "bg-amber-400"
                          : step.type === "execute"
                          ? "bg-purple-400"
                          : step.type === "plan"
                          ? "bg-sky-400"
                          : step.type === "llm"
                          ? "bg-green-400"
                          : step.type === "fetch"
                          ? "bg-blue-400"
                          : "bg-slate-400"
                      }`}
                    />
                    {step.id}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* User request */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">
              What should the agent do?
            </label>
            <textarea
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              placeholder="e.g. Implement a dark mode toggle for the settings page in the frontend repository"
              rows={4}
              required
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-sky-500"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-950/30 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-600 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !userRequest.trim() || loadingWorkflows || workflows.length === 0}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              {loading ? "Submitting…" : "Run Workflow"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
