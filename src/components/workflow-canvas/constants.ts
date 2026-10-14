// ─── Shared constants for both editor and run canvas ─────────────────────────

export const TYPE_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  llm:              { border: "#c084fc", bg: "bg-purple-900/50",  text: "text-purple-200"  },
  llm_structured:   { border: "#c084fc", bg: "bg-purple-900/50",  text: "text-purple-200"  },
  mcp:              { border: "#38bdf8", bg: "bg-sky-900/50",     text: "text-sky-200"     },
  human_approval:   { border: "#f59e0b", bg: "bg-amber-900/50",   text: "text-amber-200"   },
  ask_context:      { border: "#e879f9", bg: "bg-fuchsia-900/50", text: "text-fuchsia-200" },
  execute:          { border: "#34d399", bg: "bg-emerald-900/50", text: "text-emerald-200" },
  workflow:         { border: "#f472b6", bg: "bg-pink-900/50",    text: "text-pink-200"    },
  cron:             { border: "#fb923c", bg: "bg-orange-900/50",  text: "text-orange-200"  },
  http:             { border: "#4ade80", bg: "bg-green-900/50",   text: "text-green-200"   },
  pubsub:           { border: "#818cf8", bg: "bg-indigo-900/50",  text: "text-indigo-200"  },
  http_call:        { border: "#2dd4bf", bg: "bg-teal-900/50",    text: "text-teal-200"    },
  python:           { border: "#facc15", bg: "bg-yellow-900/50",  text: "text-yellow-200"  },
  "langgraph-agent":{ border: "#a78bfa", bg: "bg-violet-900/50",  text: "text-violet-200"  },
  data_source:      { border: "#22d3ee", bg: "bg-cyan-900/50",    text: "text-cyan-200"    },
  // Several fetches chained into one output: related to data_source, but blue
  // so a pyramid of parts never reads as a single fetch.
  combined_datasource: { border: "#60a5fa", bg: "bg-blue-900/50", text: "text-blue-200"    },
  // A pass-through export, so deliberately not cyan: a Data node must not read
  // as a data_source that goes and fetches something.
  data:             { border: "#94a3b8", bg: "bg-slate-800/70",   text: "text-slate-200"   },
  parallel:         { border: "#0891b2", bg: "bg-cyan-900/50",    text: "text-cyan-200"    },
  switch:           { border: "#d97706", bg: "bg-amber-900/50",   text: "text-amber-200"   },
  join:             { border: "#7c3aed", bg: "bg-violet-900/50",  text: "text-violet-200"  },
  // Deliberately not violet: an OR fan-in must not be mistaken for a join at a glance.
  proceed_or:       { border: "#d97706", bg: "bg-amber-900/50",   text: "text-amber-200"   },
  storage:          { border: "#0d9488", bg: "bg-teal-900/50",    text: "text-teal-200"    },
  slack:            { border: "#a3e635", bg: "bg-lime-900/50",    text: "text-lime-200"    },
};

export const STATE_BORDER_COLOR: Record<string, string> = {
  active:    '#3b82f6',
  completed: '#22c55e',
  failed:    '#ef4444',
  skipped:   '#94a3b8',
  cancelled: '#6b7280',
  pending:   '#94a3b8',
};

export const STATE_STYLES: Record<string, { bg: string; borderColor: string; text: string; ring?: string }> = {
  pending:   { bg: "bg-slate-800",       borderColor: "#475569", text: "text-slate-400" },
  active:    { bg: "bg-sky-900",          borderColor: "#38bdf8", text: "text-sky-100",     ring: "ring-2 ring-sky-400/50 node-active" },
  completed: { bg: "bg-emerald-900/50",   borderColor: "#059669", text: "text-emerald-300" },
  failed:    { bg: "bg-red-900/60",       borderColor: "#ef4444", text: "text-red-300" },
  skipped:   { bg: "bg-slate-800/50",     borderColor: "#334155", text: "text-slate-500" },
  cancelled: { bg: "bg-slate-900/60",     borderColor: "#374151", text: "text-slate-500" },
};
