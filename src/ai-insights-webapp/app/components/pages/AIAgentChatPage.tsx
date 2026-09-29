"use client";

import React, { useState, useEffect, useRef } from "react";
import { useApp, Project } from "../providers/AppContext";
import {
  ChatMessage,
  ChatSession,
  AgentPersonaId,
  PromptTemplate,
  ThinkingStep,
} from "../chat/types";
import { AGENT_PERSONAS, INITIAL_CHAT_SESSIONS } from "../chat/constants";
import {
  loadSavedChatSessions,
  saveChatSessions,
  loadActiveSessionId,
  saveActiveSessionId,
  generateAgentChatResponse,
} from "../../services/aiAgentChatService";
import ChatSidebar from "../chat/ChatSidebar";
import ChatHeader from "../chat/ChatHeader";
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

  const abortGenerationRef = useRef<boolean>(false);

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

  // Handler: Create New Session
  const handleNewSession = () => {
    const newSessionId = `session-${Date.now()}`;
    const newSession: ChatSession = {
      id: newSessionId,
      title: "New AI Inquiry",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectId: selectedProjectId || undefined,
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

  // Handler: Clear Session
  const handleClearSession = () => {
    if (!activeSession) return;
    showConfirm({
      title: "Clear Current Chat",
      message: "Are you sure you want to clear all messages in this conversation?",
      confirmText: "Clear",
      cancelText: "Cancel",
      onConfirm: () => {
        setSessions((prev) =>
          prev.map((s) => (s.id === activeSession.id ? { ...s, messages: [] } : s))
        );
      },
    });
  };

  // Handler: Export Session
  const handleExportSession = () => {
    if (!activeSession) return;
    const lines = [
      `# ${activeSession.title}`,
      `*Exported on ${new Date().toLocaleString()}*`,
      `*Agent Persona: ${activePersona.name} (${activePersona.role})*`,
      `*Project Scope: ${currentScopedProject ? currentScopedProject.name : "Global Workspace Scope"}*`,
      `\n---\n`,
    ];

    activeSession.messages.forEach((msg) => {
      const sender = msg.role === "user" ? "User" : msg.agentName || "AI Copilot";
      lines.push(`### [${msg.timestamp}] ${sender}`);
      lines.push(msg.content);
      lines.push(`\n`);
    });

    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeSession.title.toLowerCase().replace(/[^a-z0-9]/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showAlert({ title: "Conversation exported to Markdown", type: "success" });
  };

  // Handler: Send Message & Process Agent AI Response
  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isGenerating) return;

    abortGenerationRef.current = false;
    setIsGenerating(true);

    const userMessageId = `msg-u-${Date.now()}`;
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    };

    const assistantMessageId = `msg-a-${Date.now() + 1}`;
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
      thinking: [{ time: "00:01", text: `Analyzing query intent and activating ${activePersona.name}...`, done: false }],
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
      />

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full min-w-0 relative overflow-hidden px-10">
        {/* Chat Top Header */}
        <ChatHeader
          activePersona={activePersona}
          selectedProject={currentScopedProject}
          allProjects={projects}
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
          onOpenPersonaModal={() => setIsPersonaModalOpen(true)}
          onOpenTemplates={() => setIsTemplatesModalOpen(true)}
          onClearSession={handleClearSession}
          onExportSession={handleExportSession}
          isGenerating={isGenerating}
        />

        {/* Message Stream Area */}
        <ChatMessageList
          messages={activeSession?.messages || []}
          activePersona={activePersona}
          isGenerating={isGenerating}
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
          onSendMessage={handleSendMessage}
          isGenerating={isGenerating}
          onStopGenerating={handleStopGenerating}
          selectedProject={currentScopedProject}
          activePersona={activePersona}
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
