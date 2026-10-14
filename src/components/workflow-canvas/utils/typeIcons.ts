/**
 * Merged TYPE_ICONS map — single source of truth for both builder and run canvas.
 * Builder keys come first; run-only keys are appended.
 */
export const TYPE_ICONS: Record<string, string> = {
  // Builder step types
  llm:               "🧩",
  llm_structured:    "🧩",
  mcp:               "📡",
  human_approval:    "✋",
  ask_context:       "❓",
  execute:           "🚀",
  workflow:          "🔗",
  cron:              "⏰",
  http:              "🌐",
  pubsub:            "📨",
  http_call:         "🔁",
  python:            "🐍",
  "langgraph-agent": "🤖",
  data_source:       "🗄️",
  combined_datasource: "🗃️",
  data:              "📦",
  slack:             "💬",
  // Run-canvas extra keys
  fetch:             "📡",
  approval:          "✋",
  result:            "✅",
  plan:              "📋",
  action:            "⚙️",
  "claude-agent":    "🤖",
};
