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
  loadActiveSessionId,
  saveActiveSessionId,
  generateAgentChatResponse,
} from "../../services/aiAgentChatService";
import { fetchChatSuggestions } from "../../services/chatSuggestionService";
import ChatSidebar from "../chat/ChatSidebar";
import ChatMessageList from "../chat/ChatMessageList";
import ChatInputArea from "../chat/ChatInputArea";
import ChatPromptTemplates from "../chat/ChatPromptTemplates";
import ChatAgentPersonaModal from "../chat/ChatAgentPersonaModal";

export default function AIAgentChatPage() {
  const { projects, dataSources, showAlert, showConfirm } = useApp();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedPersonaId, setSelectedPersonaId] = useState<AgentPersonaId>("orchestrator");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isPersonaModalOpen, setIsPersonaModalOpen] = useState<boolean>(false);
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState<boolean>(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const abortGenerationRef = useRef<boolean>(false);

  // Load chat suggestions from database on mount
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

  // Hydrate saved sessions on mount
  useEffect(() => {
    const loadedSessions = loadSavedChatSessions();
    setSessions(loadedSessions);

    const savedActiveId = loadActiveSessionId();
    if (savedActiveId && loadedSessions.some((s) => s.id === savedActiveId)) {
      setActiveSessionId(savedActiveId);
      const found = loadedSessions.find((s) => s.id === savedActiveId);
      if (found) {
        setSelectedPersonaId(found.agentPersona);
        setSelectedProjectId(found.projectId || "");
      }
    } else if (loadedSessions.length > 0) {
      setActiveSessionId(loadedSessions[0].id);
      setSelectedPersonaId(loadedSessions[0].agentPersona);
      setSelectedProjectId(loadedSessions[0].projectId || "");
    }
  }, []);

  // Save sessions to localStorage when updated
  useEffect(() => {
    if (sessions.length > 0) {
      saveChatSessions(sessions);
    }
  }, [sessions]);

  // Save active session ID
  useEffect(() => {
    if (activeSessionId) {
      saveActiveSessionId(activeSessionId);
    }
  }, [activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const activePersona = AGENT_PERSONAS[selectedPersonaId] || AGENT_PERSONAS.orchestrator;
  const currentScopedProject = projects.find((p) => p.id === selectedProjectId) || null;

  // Extract candidate trained models for selected project
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

  // Handler: Create New Session
  const handleNewSession = () => {
    if (!selectedProjectId) {
      showAlert({
        title: "Project Selection Required",
        message: "Please choose a project above the New Conversation button to start.",
        type: "info",
      });
      return;
    }

    const newSessionId = `session-${Date.now()}`;
    const newSession: ChatSession = {
      id: newSessionId,
      title: "New AI Inquiry",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectId: selectedProjectId,
      projectName: currentScopedProject?.name,
      agentPersona: selectedPersonaId,
      messages: [],
    };

    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSessionId);
  };

  // Handler: Delete Session
  const handleDeleteSession = (id: string) => {
    showConfirm({
      title: "Delete Conversation",
      message: "Are you sure you want to delete this AI conversation history? This action cannot be undone.",
      confirmText: "Delete",
      cancelText: "Cancel",
      onConfirm: () => {
        setSessions((prev) => {
          const next = prev.filter((s) => s.id !== id);
          if (next.length === 0) {
            return INITIAL_CHAT_SESSIONS;
          }
          return next;
        });
        if (activeSessionId === id) {
          const remaining = sessions.filter((s) => s.id !== id);
          if (remaining.length > 0) {
            setActiveSessionId(remaining[0].id);
          }
        }
      },
    });
  };

  // Handler: Toggle Pin Session
  const handleTogglePinSession = (id: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, pinned: !s.pinned } : s))
    );
  };

  // Handler: Select Session
  const handleSelectSession = (id: string) => {
    const session = sessions.find((s) => s.id === id);
    if (session) {
      setActiveSessionId(id);
      setSelectedPersonaId(session.agentPersona);
      setSelectedProjectId(session.projectId || "");
    }
  };



  // Handler: Send Message & Process Agent AI Response
  const handleSendMessage = async (
    text: string,
    options?: { modelId?: string; attachments?: File[] }
  ) => {
    if (!text.trim() || isGenerating || !selectedProjectId) return;

    abortGenerationRef.current = false;
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

    const assistantMessageId = `msg-a-${Date.now() + 1}`;
    const modelNote =
      options?.modelId && options.modelId !== "any"
        ? ` [Model: ${options.modelId}]`
        : "";

    const initialAssistantMessage: ChatMessage = {
      id: assistantMessageId,
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
          time: "00:01",
          text: `Analyzing query intent and activating ${activePersona.name}${modelNote}...`,
          done: false,
        },
      ],
      status: "sending",
    };

    // Update active session with user message and placeholder assistant message
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === activeSessionId) {
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
            messages: [...s.messages, userMessage, initialAssistantMessage],
          };
        }
        return s;
      })
    );

    try {
      const response = await generateAgentChatResponse(
        text,
        selectedPersonaId,
        currentScopedProject,
        projects,
        dataSources,
        (updatedThinking) => {
          // Live stream thinking steps
          setSessions((prev) =>
            prev.map((s) => {
              if (s.id === activeSessionId) {
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
        }
      );

      if (abortGenerationRef.current) {
        setIsGenerating(false);
        return;
      }

      // Finalize assistant message
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === activeSessionId) {
            return {
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantMessageId
                  ? {
                      ...m,
                      ...response,
                      isThinking: false,
                      status: "complete",
                    }
                  : m
              ),
            };
          }
          return s;
        })
      );
    } catch (err: any) {
      console.error("Agent chat execution error:", err);
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === activeSessionId) {
            return {
              ...s,
              messages: s.messages.map((m) =>
                m.id === assistantMessageId
                  ? {
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
      setIsGenerating(false);
    }
  };

  // Handler: Stop Generating
  const handleStopGenerating = () => {
    abortGenerationRef.current = true;
    setIsGenerating(false);
  };

  // Handler: Feedback
  const handleFeedback = (messageId: string, type: "like" | "dislike") => {
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === activeSessionId) {
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

  // Handler: Select Template
  const handleSelectTemplate = (template: PromptTemplate) => {
    setSelectedPersonaId(template.recommendedPersona);
    setIsTemplatesModalOpen(false);
    handleSendMessage(template.prompt);
  };

  return (
    <div className="w-full flex flex-col lg:flex-row h-[calc(100vh-57px)] bg-surface overflow-hidden animate-fade-in">
      {/* Left Session & Persona Drawer */}
      <ChatSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onTogglePinSession={handleTogglePinSession}
        selectedPersonaId={selectedPersonaId}
        onSelectPersona={(pId) => {
          setSelectedPersonaId(pId);
          if (activeSession) {
            setSessions((prev) =>
              prev.map((s) => (s.id === activeSession.id ? { ...s, agentPersona: pId } : s))
            );
          }
        }}
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={(pId) => {
          setSelectedProjectId(pId);
          if (activeSession) {
            const proj = projects.find((p) => p.id === pId);
            setSessions((prev) =>
              prev.map((s) =>
                s.id === activeSession.id
                  ? { ...s, projectId: pId || undefined, projectName: proj?.name }
                  : s
              )
            );
          }
        }}
      />

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full min-w-0 relative overflow-hidden px-4 sm:px-10">


        {/* Message Stream Area */}
        <ChatMessageList
          messages={activeSession?.messages || []}
          activePersona={activePersona}
          isGenerating={isGenerating}
          selectedProject={currentScopedProject}
          isChatEnabled={Boolean(selectedProjectId)}
          onSelectAction={(actionText) => handleSendMessage(actionText)}
          onRetry={(mId) => {
            const idx = activeSession.messages.findIndex((m) => m.id === mId);
            if (idx > 0 && activeSession.messages[idx - 1].role === "user") {
              handleSendMessage(activeSession.messages[idx - 1].content);
            }
          }}
          onFeedback={handleFeedback}
          onSelectSuggestedQuestion={(q) => handleSendMessage(q)}
        />

        {/* Chat Bottom Input Area */}
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

      {/* Persona Selection Modal */}
      {/* <ChatAgentPersonaModal
        isOpen={isPersonaModalOpen}
        selectedPersonaId={selectedPersonaId}
        onSelectPersona={(pId) => {
          setSelectedPersonaId(pId);
          if (activeSession) {
            setSessions((prev) =>
              prev.map((s) => (s.id === activeSession.id ? { ...s, agentPersona: pId } : s))
            );
          }
        }}
        onClose={() => setIsPersonaModalOpen(false)}
      /> */}

      {/* Prompt Templates Library Modal */}
      {/* {isTemplatesModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in select-none">
          <ChatPromptTemplates
            onSelectTemplate={handleSelectTemplate}
            onClose={() => setIsTemplatesModalOpen(false)}
          />
        </div>
      )} */}
    </div>
  );
}
