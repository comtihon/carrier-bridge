"use client";

import { useRef, useEffect, useState, FormEvent } from "react";
import { Send, Square, BotMessageSquare, GitBranch, X } from "lucide-react";
import { clsx } from "clsx";
import { useChat, type ChatMessage } from "@/hooks/useChat";
import { StatusBadge } from "./StatusBadge";

// ─── Workflow started card ────────────────────────────────────────────────────

function WorkflowStartedCard({
  workflow_name,
  run_id,
  onView,
}: {
  workflow_name: string;
  run_id: string;
  onView: (runId: string) => void;
}) {
  return (
    <div className="mt-2 rounded-xl border border-sky-700/50 bg-sky-950/30 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping flex-shrink-0" />
        <p className="text-xs font-semibold text-sky-200">Workflow started</p>
        <StatusBadge status="running" size="xs" />
      </div>
      <p className="text-xs text-slate-300 font-medium">{workflow_name}</p>
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-500 font-mono truncate flex-1 mr-2">{run_id}</p>
        <button
          onClick={() => onView(run_id)}
          className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 transition-colors font-medium flex-shrink-0"
        >
          <GitBranch className="w-3 h-3" />
          View
        </button>
      </div>
    </div>
  );
}

// ─── Context questions card ───────────────────────────────────────────────────

function ContextQuestionsMessage({
  questions,
  submitted,
  submittedAnswers,
  onSubmit,
}: {
  questions: string[];
  submitted?: boolean;
  submittedAnswers?: Record<string, string>;
  onSubmit?: (answers: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(
    Object.fromEntries(questions.map((_, i) => [String(i), ""])),
  );

  if (submitted) {
    return (
      <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-3 space-y-2.5">
        <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide">
          Context provided
        </p>
        {questions.map((q, i) => (
          <div key={i} className="space-y-0.5">
            <p className="text-[11px] text-slate-400">{q}</p>
            <p className="text-xs text-slate-200">{submittedAnswers?.[String(i)] ?? ""}</p>
          </div>
        ))}
      </div>
    );
  }

  const allAnswered = questions.every((_, i) => answers[String(i)]?.trim());

  return (
    <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-3 space-y-3">
      <p className="text-xs font-semibold text-amber-300">
        I need a bit more context to proceed:
      </p>
      {questions.map((q, i) => (
        <div key={i} className="space-y-1.5">
          <p className="text-xs text-slate-300">{q}</p>
          <textarea
            value={answers[String(i)] ?? ""}
            onChange={(e) =>
              setAnswers((prev) => ({ ...prev, [String(i)]: e.target.value }))
            }
            placeholder="Your answer…"
            rows={2}
            className="w-full resize-none bg-slate-800/80 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
          />
        </div>
      ))}
      <button
        onClick={() => onSubmit?.(answers)}
        disabled={!allAnswered}
        className="w-full py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Submit
      </button>
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  onViewRun,
  onSubmitContext,
}: {
  msg: ChatMessage;
  onViewRun: (runId: string) => void;
  onSubmitContext: (messageId: string, answers: Record<string, string>) => void;
}) {
  const isUser = msg.role === "user";

  // Ask-context messages replace the normal bubble with the questions form
  if (msg.askContext) {
    return (
      <div className="flex gap-2">
        <div className="w-6 h-6 rounded-full bg-sky-900 border border-sky-700 flex items-center justify-center flex-shrink-0 mt-0.5">
          <BotMessageSquare className="w-3.5 h-3.5 text-sky-400" />
        </div>
        <div className="flex-1 min-w-0">
          <ContextQuestionsMessage
            questions={msg.askContext.questions}
            submitted={msg.askContext.submitted}
            submittedAnswers={msg.askContext.answers}
            onSubmit={(answers) => onSubmitContext(msg.id, answers)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={clsx("flex gap-2", isUser && "justify-end")}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-sky-900 border border-sky-700 flex items-center justify-center flex-shrink-0 mt-0.5">
          <BotMessageSquare className="w-3.5 h-3.5 text-sky-400" />
        </div>
      )}
      <div className={clsx("max-w-[85%] space-y-1", isUser && "items-end flex flex-col")}>
        <div
          className={clsx(
            "rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words",
            isUser
              ? "bg-sky-600 text-white rounded-tr-sm"
              : "bg-slate-800 text-slate-200 rounded-tl-sm",
          )}
        >
          {msg.content}
          {msg.streaming && !msg.content && (
            <span className="inline-block w-1.5 h-3 bg-slate-400 animate-pulse rounded-sm" />
          )}
          {msg.streaming && msg.content && (
            <span className="inline-block w-1 h-3 bg-slate-400 animate-pulse rounded-sm ml-0.5 align-middle" />
          )}
        </div>
        {msg.workflowStarted && (
          <WorkflowStartedCard
            workflow_name={msg.workflowStarted.workflow_name}
            run_id={msg.workflowStarted.run_id}
            onView={onViewRun}
          />
        )}
      </div>
    </div>
  );
}

// ─── Chat panel ───────────────────────────────────────────────────────────────

interface Props {
  onWorkflowStarted: (runId: string) => void;
  onClose: () => void;
}

/** The Copilot conversation, rendered as one panel of the left dock. */
export function ChatPanel({ onWorkflowStarted, onClose }: Props) {
  const { messages, streaming, sendMessage, submitContextAnswers, stop } = useChat();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    sendMessage(text, onWorkflowStarted);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as FormEvent);
    }
  }

  function handleSubmitContext(messageId: string, answers: Record<string, string>) {
    submitContextAnswers(messageId, answers, onWorkflowStarted);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800 shrink-0">
        <BotMessageSquare className="w-4 h-4 text-sky-400" />
        <span className="text-sm font-semibold text-white flex-1">Copilot</span>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-slate-800 text-slate-500 hover:text-slate-200 transition-colors"
          title="Close chat"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8 space-y-2">
            <p className="text-2xl">💬</p>
            <p className="text-xs text-slate-500">
              Ask me to start a workflow, check status, or anything else.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onViewRun={onWorkflowStarted}
            onSubmitContext={handleSubmitContext}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-800 p-3 shrink-0">
        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything…"
            rows={1}
            className="flex-1 resize-none bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 max-h-32 overflow-y-auto"
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="p-2 rounded-xl bg-red-800 hover:bg-red-700 text-white transition-colors flex-shrink-0"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="p-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
