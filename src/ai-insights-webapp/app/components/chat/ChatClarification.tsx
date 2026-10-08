"use client";

import { useEffect, useState } from "react";
import { ChatMessage } from "./types";

interface Props {
  message: ChatMessage;
  disabled?: boolean;
  onReply?: (messageId: string, answer: string) => void;
  onDraft?: (messageId: string, draft: string) => void;
  onExpire?: (messageId: string, interactionId: string) => void;
}

export default function ChatClarification({ message, disabled, onReply, onDraft, onExpire }: Props) {
  const [now, setNow] = useState(Date.now());
  const interaction = message.interaction;
  // Offset browser time against the server sample; use monotonic elapsed time
  // so changing the computer clock cannot reset the countdown.
  const [clock, setClock] = useState(() => ({ server: Date.now() + (message.serverClockOffset ?? 0), local: performance.now() }));
  useEffect(() => {
    setClock({ server: Date.now() + (message.serverClockOffset ?? 0), local: performance.now() });
  }, [interaction?.id, message.serverClockOffset]);
  useEffect(() => {
    if (!interaction || interaction.status !== "waiting") return;
    const tick = () => setNow(clock.server + performance.now() - clock.local);
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [interaction?.id, interaction?.status, clock]);
  const remaining = interaction ? Math.max(0, Math.ceil((Date.parse(interaction.expiresAt) - now) / 1000)) : 0;
  const expired = interaction?.status === "timed_out" || Boolean(interaction && remaining === 0);
  useEffect(() => {
    if (interaction?.status === "waiting" && expired) onExpire?.(message.id, interaction.id);
  }, [expired, interaction?.status, interaction?.id, message.id, onExpire]);
  if (!message.clarification) return null;
  const pending = message.status === "awaiting_user_input" || message.status === "sending";
  const draft = message.clarificationDraft ?? "";

  return (
    <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 space-y-3">
      {message.clarificationReplies?.map((reply, index) => (
        <div key={index} className="text-xs border-b border-amber-500/20 pb-2">
          <p className="text-muted-foreground">{reply.question}</p>
          <p className="text-foreground mt-1"><span className="font-semibold">Your answer: </span>{reply.answer}</p>
        </div>
      ))}
      {pending && <>
        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-amber-600 dark:text-amber-400">
          <span>{expired ? "Interaction paused" : "Your input is needed"}</span>
          {interaction && !expired && <span aria-label="Time remaining">{remaining}s remaining</span>}
        </div>
        <p className="text-sm text-foreground font-medium" id={`clarification-${message.id}`}>{message.clarification.question}</p>
        {expired && <p className="text-xs text-muted-foreground" role="status">The 100-second reply window ended. Your context is saved. Answer here whenever you are ready to resume.</p>}
        {message.clarification.options?.length ? <div className="flex flex-wrap gap-2">
          {message.clarification.options.map(option => <button key={option} type="button" disabled={disabled}
            onClick={() => onDraft?.(message.id, option)} aria-pressed={draft === option}
            className={`px-3 py-1.5 rounded-lg border text-xs disabled:opacity-50 ${draft === option ? "border-primary bg-primary/10" : "border-amber-500/30 bg-surface hover:bg-amber-500/20"}`}>{option}</button>)}
        </div> : null}
        <form onSubmit={event => { event.preventDefault(); if (draft.trim() && !disabled) onReply?.(message.id, draft.trim()); }} className="space-y-2">
          <textarea aria-labelledby={`clarification-${message.id}`} value={draft} disabled={disabled}
            onChange={event => onDraft?.(message.id, event.target.value)} rows={2}
            placeholder="Type your answer, or choose an option and edit it."
            className="w-full rounded-lg border border-border bg-surface p-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50" />
          {message.clarificationError && <p className="text-xs text-red-500" role="alert">{message.clarificationError}</p>}
          <button type="submit" disabled={disabled || !draft.trim()} className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {message.isThinking ? "Continuing…" : expired ? "Resume with answer" : "Continue"}
          </button>
        </form>
      </>}
    </div>
  );
}
