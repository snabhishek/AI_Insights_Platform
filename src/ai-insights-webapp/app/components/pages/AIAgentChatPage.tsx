"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useApp, Project } from "../providers/AppContext";
import {
  ChatMessage,
  ChatSession,
  AgentPersonaId,
  PromptTemplate,
  ThinkingStep,
  TrainedModelOption,
} from "../chat/types";
import { AGENT_PERSONAS, INITIAL_CHAT_SESSIONS } from "../chat/constants";
import {
  loadSavedChatSessions,
  saveChatSessions,
  loadActiveSessionKey,
  saveActiveSessionKey,
  generateAgentChatResponse,
  getChatInteraction,
  loadDatabaseChatSessions, saveChatSessionMetadata, deleteDatabaseChatSession, stopAgentChat, ChatRequestContext,
} from "../../services/aiAgentChatService";
import { stopChatMessage } from "../../services/chatLifecycle";
import { chatSessionKey, createChatSession, mergeChatSessionHistory } from "../../services/chatSessionHistory";
import { fetchChatSuggestions } from "../../services/chatSuggestionService";
import ChatSidebar from "../chat/ChatSidebar";
import ChatMessageList from "../chat/ChatMessageList";
import ChatInputArea from "../chat/ChatInputArea";
import ChatPromptTemplates from "../chat/ChatPromptTemplates";
import ChatAgentPersonaModal from "../chat/ChatAgentPersonaModal";

export default function AIAgentChatPage() {
  const { projects, dataSources, showAlert, showConfirm } = useApp();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionKey, setActiveSessionKey] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedPersonaId, setSelectedPersonaId] = useState<AgentPersonaId>("orchestrator");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isPersonaModalOpen, setIsPersonaModalOpen] = useState<boolean>(false);
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState<boolean>(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const abortGenerationRef = useRef<boolean>(false);
  const generationEpochRef = useRef(0);
  const activeRequestRef = useRef<{ projectId: string; conversationId: string; userQuery: string; context: ChatRequestContext; controller: AbortController } | null>(null);
  const [historyInitialized, setHistoryInitialized] = useState(false);
  const [historyError, setHistoryError] = useState<string>("");
  const [historyRetry, setHistoryRetry] = useState(0);

  useEffect(() => {
    let isMounted = true;
    fetchChatSuggestions()
      .then((data) => {
        if (isMounted) {
          setSuggestions(data);
        }
      })
      .catch((err) => {
        console.error("[AIAgentChatPage] Failed to load chat suggestions from DB:", err);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const projectScope = projects.map(project => project.id).sort().join(",");
  useEffect(() => {
    if (!historyInitialized || !projectScope) return;
    let cancelled = false;
    void loadDatabaseChatSessions(projectScope.split(","), loadSavedChatSessions()).then(saved => {
      if (cancelled) return;
      setSessions(previous => mergeChatSessionHistory(previous, saved, activeRequestRef.current));
      setHistoryError("");
    }).catch(error => { if (!cancelled) setHistoryError(`Could not load database chat history: ${error.message}`); });
    return () => { cancelled = true; };
  }, [projectScope, historyInitialized, historyRetry]);

  useEffect(() => {
    const loadedSessions = loadSavedChatSessions();
    setSessions(loadedSessions);

    const savedActiveKey = loadActiveSessionKey(loadedSessions);
    setActiveSessionKey(savedActiveKey);
    const selected = loadedSessions.find(session => chatSessionKey(session) === savedActiveKey);
    if (selected) {
      setSelectedPersonaId(selected.agentPersona);
      setSelectedProjectId(selected.projectId || "");
    }
    setHistoryInitialized(true);
  }, []);

  useEffect(() => {
    if (sessions.length > 0) {
      saveChatSessions(sessions);
    }
  }, [sessions]);

  useEffect(() => {
    if (activeSessionKey) {
      saveActiveSessionKey(activeSessionKey);
    }
  }, [activeSessionKey]);

  const activeSession = sessions.find((s) => chatSessionKey(s) === activeSessionKey) || sessions[0];
  const activePersona = AGENT_PERSONAS[selectedPersonaId] || AGENT_PERSONAS.orchestrator;
  const currentScopedProject = projects.find((p) => p.id === selectedProjectId) || null;

  useEffect(() => {
    const session = sessions.find(item => chatSessionKey(item) === activeSessionKey);
    const pending = [...(session?.messages ?? [])].reverse().find(message => message.clarification
      && (message.status === "awaiting_user_input" || message.status === "sending"));
    if (!session?.projectId || !pending) return;
    let cancelled = false;
    void getChatInteraction(session.projectId, session.id).then(response => {
      if (cancelled || (response.status === "complete" && !response.content)) return;
      setSessions(previous => previous.map(item => chatSessionKey(item) === chatSessionKey(session) ? {
        ...item, messages: item.messages.map(message => message.id === pending.id
          ? { ...message, ...response, clarification: response.clarification ?? message.clarification, isThinking: false,
            clarificationDraft: response.interaction?.id !== message.interaction?.id ? "" : message.clarificationDraft } : message),
      } : item));
    }).catch(error => console.error("Could not restore the saved clarification:", error));
    return () => { cancelled = true; };
    // Restore once when entering a conversation, not on each draft keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionKey]);

  const trainedModels = useMemo<TrainedModelOption[]>(() => {
    const defaultOption: TrainedModelOption = {
      id: "any",
      displayName: "Any (Auto)",
      framework: "Auto inference",
      isChampion: false,
    };

    if (!currentScopedProject) {
      return [defaultOption];
    }

    const state = currentScopedProject.agentState as any;
    const report = state?.modelTraining?.report || state?.stageOutputs?.modelTraining?.report;
    const championId = report?.champion_model_id || report?.best_model_id || null;

    const rawCandidates =
      report?.ranked_models ||
      report?.model_results ||
      state?.modelSelection?.candidates ||
      state?.stageOutputs?.modelSelection?.candidates ||
      [];

    let extracted: TrainedModelOption[] = [];
    if (Array.isArray(rawCandidates)) {
      extracted = rawCandidates.map((c: any) => {
        const modelId = c.model_id || c.id || String(c);
        return {
          id: modelId,
          displayName: c.displayName || c.model_name || modelId,
          framework: c.framework,
          isChampion: modelId === championId,
        };
      });
    } else if (rawCandidates && typeof rawCandidates === "object") {
      extracted = Object.entries(rawCandidates).map(([k, v]: [string, any]) => {
        const modelId = v?.model_id || k;
        return {
          id: modelId,
          displayName: v?.displayName || v?.model_name || modelId,
          framework: v?.framework,
          isChampion: modelId === championId,
        };
      });
    }

    const seen = new Set<string>();
    const unique: TrainedModelOption[] = [];
    for (const m of extracted) {
      if (m.id && !seen.has(m.id)) {
        seen.add(m.id);
        unique.push(m);
      }
    }

    return [defaultOption, ...unique];
  }, [currentScopedProject]);

  const handleNewSession = () => {
    if (!selectedProjectId) {
      showAlert({
        title: "Project Selection Required",
        message: "Please choose a project above the New Conversation button to start.",
        type: "info",
      });
      return;
    }

    const newSession = createChatSession(selectedProjectId, currentScopedProject?.projectName || currentScopedProject?.name, selectedPersonaId);

    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionKey(chatSessionKey(newSession));
    void saveChatSessionMetadata(newSession).catch(error => setHistoryError(error.message));
  };

  const handleDeleteSession = (key: string) => {
    showConfirm({
      title: "Delete Conversation",
      message: "Are you sure you want to delete this AI conversation history? This action cannot be undone.",
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: async () => {
        const deleting = sessions.find(session => chatSessionKey(session) === key);
        if (deleting) {
          try { await deleteDatabaseChatSession(deleting); }
          catch (error: any) { setHistoryError(error.message); return; }
        }
        setSessions((prev) => {
          const next = prev.filter((s) => chatSessionKey(s) !== key);
          if (next.length === 0) {
            return INITIAL_CHAT_SESSIONS;
          }
          return next;
        });
        if (activeSessionKey === key) {
          const remaining = sessions.filter((s) => chatSessionKey(s) !== key);
          const next = remaining[0] ?? INITIAL_CHAT_SESSIONS[0];
          setActiveSessionKey(chatSessionKey(next));
          setSelectedProjectId(next.projectId || "");
          setSelectedPersonaId(next.agentPersona);
        }
      },
    });
  };

  const handleTogglePinSession = (key: string) => {
    const session = sessions.find(item => chatSessionKey(item) === key);
    if (session) void saveChatSessionMetadata({ ...session, pinned: !session.pinned }).catch(error => setHistoryError(error.message));
    setSessions((prev) =>
      prev.map((s) => (chatSessionKey(s) === key ? { ...s, pinned: !s.pinned } : s))
    );
  };

  const handleRenameSession = (key: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    const session = sessions.find(item => chatSessionKey(item) === key);
    if (session) void saveChatSessionMetadata({ ...session, title: newTitle.trim() }).catch(error => setHistoryError(error.message));
    setSessions((prev) =>
      prev.map((s) => (chatSessionKey(s) === key ? { ...s, title: newTitle.trim() } : s))
    );
  };

  const handleSelectSession = (key: string) => {
    const session = sessions.find((s) => chatSessionKey(s) === key);
    if (session) {
      setActiveSessionKey(key);
      setSelectedPersonaId(session.agentPersona);
      setSelectedProjectId(session.projectId || "");
    }
  };

  const handleSendMessage = async (
    text: string,
    options?: { modelId?: string; attachments?: File[]; clarificationMessageId?: string }
  ) => {
    if (!text.trim() || isGenerating || !activeSession?.projectId || activeSession.projectId !== selectedProjectId) return;
    const sessionKey = chatSessionKey(activeSession);
    const clarificationMessage = options?.clarificationMessageId
      ? activeSession?.messages.find(message => message.id === options.clarificationMessageId)
      : [...(activeSession?.messages ?? [])].reverse().find(message => message.status === "awaiting_user_input" && message.clarification);
    if (options?.clarificationMessageId && (!clarificationMessage || clarificationMessage.status !== "awaiting_user_input")) return;

    abortGenerationRef.current = false;
    const generationEpoch = ++generationEpochRef.current;
    setIsGenerating(true);

    const userMessageId = `msg-u-${Date.now()}`;
    const attachmentNote =
      options?.attachments && options.attachments.length > 0
        ? `\n\n📎 *Attached: ${options.attachments.map((f) => f.name).join(", ")}*`
        : "";

    const userMessage: ChatMessage = {
      id: userMessageId,
      role: "user",
      content: `${text}${attachmentNote}`,
      timestamp: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    };

    const assistantMessageId = clarificationMessage?.id ?? `msg-a-${crypto.randomUUID()}`;
    const requestId = crypto.randomUUID();
    const requestController = new AbortController();
    const requestContext: ChatRequestContext = { requestId, messageId: assistantMessageId, userMessageId, userContent: userMessage.content,
      session: { title: activeSession?.messages.length ? activeSession.title : text.slice(0, 36), agentPersona: selectedPersonaId,
        projectName: currentScopedProject?.projectName || currentScopedProject?.name, pinned: activeSession?.pinned }, signal: requestController.signal };
    activeRequestRef.current = { projectId: selectedProjectId, conversationId: activeSession.id, userQuery: text, context: requestContext, controller: requestController };
    const modelNote =
      options?.modelId && options.modelId !== "any"
        ? ` [Model: ${options.modelId}]`
        : "";

    const initialAssistantMessage: ChatMessage = {
      id: assistantMessageId,
      requestId,
      role: "assistant",
      content: "",
      timestamp: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      agentId: activePersona.id,
      agentName: activePersona.name,
      agentBadge: activePersona.badge,
      agentAvatar: activePersona.avatar,
      isThinking: true,
      thinking: [
        {
          time: new Date().toLocaleTimeString("en-GB", { hour12: false }),
          timestamp: new Date().toISOString(),
          text: `Analyzing query intent and activating ${activePersona.name}${modelNote}...`,
          done: false,
        },
      ],
      status: "sending",
    };

    setSessions((prev) =>
      prev.map((s) => {
        if (chatSessionKey(s) === sessionKey) {
          const isFirstUserMessage = s.messages.length === 0;
          const updatedTitle = isFirstUserMessage
            ? text.length > 36
              ? `${text.slice(0, 36)}...`
              : text
            : s.title;

          return {
            ...s,
            title: updatedTitle,
            updatedAt: new Date().toISOString(),
            messages: clarificationMessage ? [...s.messages.filter(message => message.id !== assistantMessageId), userMessage,
              { ...clarificationMessage, requestId, isThinking: true, status: "sending" as const, clarificationError: undefined,
                clarificationDraft: text.trim(),
                interaction: clarificationMessage.interaction ? { ...clarificationMessage.interaction, status: "answered" as const } : undefined }]
              : [...s.messages, userMessage, initialAssistantMessage],
          };
        }
        return s;
      })
    );

    const lastSessionMsg = activeSession?.messages[activeSession.messages.length - 1];
    const pendingExecutionState = clarificationMessage?.executionState ?? lastSessionMsg?.executionState;
    const conversationHistory = activeSession?.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })) || [];

    try {
      const response = await generateAgentChatResponse(
        text,
        selectedPersonaId,
        currentScopedProject,
        projects,
        dataSources,
        (updatedThinking) => {
          if (generationEpoch !== generationEpochRef.current) return;
          setSessions((prev) =>
            prev.map((s) => {
              if (chatSessionKey(s) === sessionKey) {
                return {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantMessageId ? { ...m, thinking: updatedThinking } : m
                  ),
                };
              }
              return s;
            })
          );
        },
        pendingExecutionState,
        conversationHistory,
        activeSession.id,
        clarificationMessage?.interaction?.id,
        requestContext
      );

      if (abortGenerationRef.current || generationEpoch !== generationEpochRef.current) {
        return;
      }

      setSessions((prev) =>
        prev.map((s) => {
          if (chatSessionKey(s) === sessionKey) {
            return {
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantMessageId
                  ? {
                      ...m,
                      ...response,
                      clarification: response.clarification ?? clarificationMessage?.clarification,
                      clarificationReplies: clarificationMessage ? [...(clarificationMessage.clarificationReplies ?? []),
                        { question: clarificationMessage.clarification!.question, answer: text.trim() }] : undefined,
                      clarificationDraft: "",
                      clarificationError: undefined,
                      isThinking: false,
                      status: response.status || "complete",
                    }
                  : m
              ),
            };
          }
          return s;
        })
      );
    } catch (err: any) {
      if (generationEpoch !== generationEpochRef.current) return;
      console.error("Agent chat execution error:", err);
      setSessions((prev) =>
        prev.map((s) => {
          if (chatSessionKey(s) === sessionKey) {
            return {
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantMessageId
                  ? clarificationMessage ? {
                      ...m, isThinking: false, status: "awaiting_user_input",
                      interaction: clarificationMessage.interaction,
                      clarificationError: err?.message || "Could not submit your answer. Please try again.",
                    } : {
                      ...m,
                      content: `⚠️ Failed to generate AI response: ${err?.message || "Unknown error"}. Please try again.`,
                      isThinking: false,
                      status: "error",
                    }
                  : m
              ),
            };
          }
          return s;
        })
      );
    } finally {
      if (activeRequestRef.current?.context.requestId === requestId) activeRequestRef.current = null;
      if (generationEpoch === generationEpochRef.current) setIsGenerating(false);
    }
  };

  const handleClarificationDraft = (messageId: string, draft: string) => {
    setSessions(previous => previous.map(session => chatSessionKey(session) === activeSessionKey ? {
      ...session, messages: session.messages.map(message => message.id === messageId ? { ...message, clarificationDraft: draft } : message),
    } : session));
  };

  const handleClarificationExpire = (messageId: string, interactionId: string) => {
    const sessionKey = activeSessionKey;
    const sessionId = activeSession?.id;
    const projectId = activeSession?.projectId;
    setSessions(previous => previous.map(session => chatSessionKey(session) === sessionKey ? {
      ...session, messages: session.messages.map(message => message.id === messageId && message.interaction?.id === interactionId
        && message.status === "awaiting_user_input" ? { ...message, interaction: { ...message.interaction, status: "timed_out" } } : message),
    } : session));
    if (!projectId || !sessionId) return;
    // Observe expiry on the server without consuming the saved interrupt.
    void getChatInteraction(projectId, sessionId).then(response => {
      setSessions(previous => previous.map(session => chatSessionKey(session) === sessionKey ? {
        ...session, messages: session.messages.map(message => message.id === messageId && message.interaction?.id === interactionId
          && message.status === "awaiting_user_input" && response.interaction?.id === interactionId
          ? { ...message, ...response } : message),
      } : session));
    }).catch(error => console.error("Could not synchronize the saved clarification:", error));
  };

  const handleStopGenerating = () => {
    const active = activeRequestRef.current;
    if (!active) return;
    abortGenerationRef.current = true;
    generationEpochRef.current++;
    setIsGenerating(false);
    activeRequestRef.current = null;
    const sessionKey = chatSessionKey({ projectId: active.projectId, id: active.conversationId });
    setSessions(previous => previous.map(session => chatSessionKey(session) === sessionKey ? {
      ...session, messages: session.messages.map(message => message.id === active.context.messageId && message.requestId === active.context.requestId
        ? stopChatMessage(message) : message),
    } : session));
    void stopAgentChat(active.projectId, active.conversationId, active.userQuery, active.context).then(response => {
      setSessions(previous => previous.map(session => chatSessionKey(session) === sessionKey ? { ...session,
        messages: session.messages.map(message => message.id === active.context.messageId && message.requestId === active.context.requestId
          ? response.status === "stopped" ? stopChatMessage({ ...message, ...response }) : { ...message, ...response, isThinking: false } : message) } : session));
    }).catch(error => {
      setSessions(previous => previous.map(session => chatSessionKey(session) === sessionKey ? { ...session,
        messages: session.messages.map(message => message.id === active.context.messageId && message.requestId === active.context.requestId
          ? { ...message, error: `The server could not confirm the stop: ${error.message}` } : message) } : session));
    }).finally(() => active.controller.abort());
  };

  const handleFeedback = (messageId: string, type: "like" | "dislike") => {
    setSessions((prev) =>
      prev.map((s) => {
        if (chatSessionKey(s) === activeSessionKey) {
          return {
            ...s,
            messages: s.messages.map((m) => {
              if (m.id === messageId) {
                return {
                  ...m,
                  userLiked: type === "like" ? !m.userLiked : false,
                  userDisliked: type === "dislike" ? !m.userDisliked : false,
                };
              }
              return m;
            }),
          };
        }
        return s;
      })
    );
    showAlert({
      title: type === "like" ? "Thank you for the positive feedback!" : "Feedback recorded for AI training.",
      type: "info",
    });
  };

  const handleSelectTemplate = (template: PromptTemplate) => {
    setSelectedPersonaId(template.recommendedPersona);
    setIsTemplatesModalOpen(false);
    handleSendMessage(template.prompt);
  };

  return (
    <div className="w-full flex flex-col lg:flex-row h-[calc(100vh-57px)] bg-surface overflow-hidden animate-fade-in">

      <ChatSidebar
        sessions={sessions}
        activeSessionKey={activeSessionKey}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onTogglePinSession={handleTogglePinSession}
        onRenameSession={handleRenameSession}
        selectedPersonaId={selectedPersonaId}
        onSelectPersona={(pId) => {
          setSelectedPersonaId(pId);
          if (activeSession) {
            void saveChatSessionMetadata({ ...activeSession, agentPersona: pId }).catch(error => setHistoryError(error.message));
            setSessions((prev) =>
              prev.map((s) => (chatSessionKey(s) === chatSessionKey(activeSession) ? { ...s, agentPersona: pId } : s))
            );
          }
        }}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={(pId) => {
          if (pId === selectedProjectId) return;
          setSelectedProjectId(pId);
          if (!pId) return;
          // A conversation's project is part of its identity, even before its
          // first message. Never move a saved or cached conversation to another project.
          const proj = projects.find((project) => project.id === pId);
          const next = createChatSession(pId, proj?.projectName || proj?.name, selectedPersonaId);
          setSessions(previous => [next, ...previous]);
          setActiveSessionKey(chatSessionKey(next));
          void saveChatSessionMetadata(next).catch(error => setHistoryError(error.message));
        }}
      />

      <div className="flex-1 flex flex-col h-full min-w-0 relative overflow-hidden">
        {historyError && <div role="alert" className="px-4 py-2 text-xs text-amber-700 bg-amber-500/10">
          {historyError} <button type="button" className="underline ml-2" onClick={() => setHistoryRetry(value => value + 1)}>Retry loading</button>
        </div>}

        <ChatMessageList
          messages={activeSession?.messages || []}
          activePersona={activePersona}
          isGenerating={isGenerating}
          selectedProject={currentScopedProject}
          isChatEnabled={Boolean(selectedProjectId)}
          onSelectAction={(actionText) => handleSendMessage(actionText)}
          onClarificationReply={(messageId, answer) => handleSendMessage(answer, { clarificationMessageId: messageId })}
          onClarificationDraft={handleClarificationDraft}
          onClarificationExpire={handleClarificationExpire}
          onRetry={(mId) => {
            const idx = activeSession.messages.findIndex((m) => m.id === mId);
            if (idx > 0 && activeSession.messages[idx - 1].role === "user") {
              handleSendMessage(activeSession.messages[idx - 1].content);
            }
          }}
          onFeedback={handleFeedback}
          onSelectSuggestedQuestion={(q) => handleSendMessage(q)}
        />

        <ChatInputArea
          onSendMessage={(text, opts) => handleSendMessage(text, opts)}
          isGenerating={isGenerating}
          onStopGenerating={handleStopGenerating}
          selectedProject={currentScopedProject}
          activePersona={activePersona}
          isChatEnabled={Boolean(selectedProjectId)}
          trainedModels={trainedModels}
          suggestions={suggestions}
          onOpenTemplates={() => setIsTemplatesModalOpen(true)}
          onOpenPersonaModal={() => setIsPersonaModalOpen(true)}
        />
      </div>

    </div>
  );
}
