"use client";

import { useState, useRef, useCallback } from "react";
import { BACKEND_URL } from "@/lib/config";
import { getAccessToken } from "@/lib/oidc";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  workflowStarted?: {
    workflow_id: string;
    workflow_name: string;
    run_id: string;
  };
  askContext?: {
    questions: string[];
    answers?: Record<string, string>; // filled after submission for read-only display
    submitted?: boolean;
  };
}

async function buildHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const threadIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Shared SSE reader: drives both sendMessage and submitContextAnswers.
  const _processStream = useCallback(
    async (
      assistantId: string,
      fetchPromise: Promise<Response>,
      signal: AbortSignal,
      onWorkflowStarted?: (runId: string) => void,
    ) => {
      try {
        const res = await fetchPromise;
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let payload: Record<string, any>;
            try {
              payload = JSON.parse(raw);
            } catch {
              continue;
            }

            if (payload.type === "token") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + payload.content }
                    : m,
                ),
              );
            } else if (payload.type === "workflow_started") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        workflowStarted: {
                          workflow_id: payload.workflow_id,
                          workflow_name: payload.workflow_name,
                          run_id: payload.run_id,
                        },
                      }
                    : m,
                ),
              );
              onWorkflowStarted?.(payload.run_id);
            } else if (payload.type === "ask_context") {
              threadIdRef.current = payload.thread_id;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? {
                        ...m,
                        askContext: {
                          questions: payload.questions as string[],
                          submitted: false,
                        },
                      }
                    : m,
                ),
              );
            } else if (payload.type === "done") {
              threadIdRef.current = payload.thread_id;
            } else if (payload.type === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: `Error: ${payload.message}` }
                    : m,
                ),
              );
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: "Sorry, something went wrong." }
                : m,
            ),
          );
        }
      } finally {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ),
        );
        setStreaming(false);
      }
    },
    [],
  );

  const sendMessage = useCallback(
    async (text: string, onWorkflowStarted?: (runId: string) => void) => {
      if (streaming) return;

      const userId = crypto.randomUUID();
      const assistantId = crypto.randomUUID();

      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user", content: text },
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ]);
      setStreaming(true);

      const abort = new AbortController();
      abortRef.current = abort;

      const fetchPromise = buildHeaders().then((headers) =>
        fetch(`${BACKEND_URL}/api/v1/chat`, {
          method: "POST",
          headers,
          body: JSON.stringify({ message: text, thread_id: threadIdRef.current }),
          signal: abort.signal,
        }),
      );

      await _processStream(assistantId, fetchPromise, abort.signal, onWorkflowStarted);
    },
    [streaming, _processStream],
  );

  const submitContextAnswers = useCallback(
    async (
      messageId: string,
      answers: Record<string, string>,
      onWorkflowStarted?: (runId: string) => void,
    ) => {
      if (streaming || !threadIdRef.current) return;
      const threadId = threadIdRef.current;

      // Mark questions as submitted (with answers stored for read-only display)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.askContext
            ? { ...m, askContext: { ...m.askContext, submitted: true, answers } }
            : m,
        ),
      );

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ]);
      setStreaming(true);

      const abort = new AbortController();
      abortRef.current = abort;

      const fetchPromise = buildHeaders().then((headers) =>
        fetch(`${BACKEND_URL}/api/v1/chat/resume`, {
          method: "POST",
          headers,
          body: JSON.stringify({ thread_id: threadId, answers }),
          signal: abort.signal,
        }),
      );

      await _processStream(assistantId, fetchPromise, abort.signal, onWorkflowStarted);
    },
    [streaming, _processStream],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, streaming, sendMessage, submitContextAnswers, stop };
}
