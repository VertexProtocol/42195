"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Send, Bot, User, Loader2, Trash2 } from "lucide-react"
import { useI18n } from "@/lib/i18n"

interface Message {
  role: "user" | "assistant"
  content: string
}

export function CoachScreen() {
  const { t } = useI18n()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [thinkingDetail, setThinkingDetail] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, thinkingDetail])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isLoading) return

    const userMessage: Message = { role: "user", content: text }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    setInput("")
    setIsLoading(true)
    setThinkingDetail(null)

    try {
      const apiMessages = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const res = await fetch("/api/ai/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.error ?? t("coach.genericError") },
        ])
        return
      }

      const reader = res.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          try {
            const event = JSON.parse(line.slice(6))

            if (event.status === "thinking") {
              setThinkingDetail(event.detail ?? t("coach.thinking"))
            } else if (event.status === "done") {
              setThinkingDetail(null)
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: event.text },
              ])
            } else if (event.status === "error") {
              setThinkingDetail(null)
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: event.error ?? t("coach.genericError") },
              ])
            }
          } catch {}
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: t("coach.networkError") },
      ])
    } finally {
      setIsLoading(false)
      setThinkingDetail(null)
    }
  }, [input, messages, isLoading, t])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    setMessages([])
    setInput("")
  }

  const suggestions = [
    t("coach.suggestion1"),
    t("coach.suggestion2"),
    t("coach.suggestion3"),
    t("coach.suggestion4"),
  ]

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 5rem)" }}>
      {/* Header — matches other screens: px-5 pt-4 */}
      <header className="flex items-center justify-between px-5 pt-4 pb-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("coach.title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("coach.subtitle")}</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Clear chat"
          >
            <Trash2 size={18} />
          </button>
        )}
      </header>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center space-y-5 py-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Bot size={28} className="text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">{t("coach.empty")}</p>
              <p className="text-xs text-muted-foreground max-w-[280px]">
                {t("coach.emptyDesc")}
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-[300px]">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion)
                    inputRef.current?.focus()
                  }}
                  className="w-full text-left text-xs px-4 py-2.5 rounded-2xl bg-card shadow-sm ring-1 ring-border hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 mt-0.5">
                <Bot size={12} className="text-primary" />
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "bg-card shadow-sm ring-1 ring-border text-card-foreground rounded-bl-md"
              }`}
            >
              {msg.content}
            </div>
            {msg.role === "user" && (
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-muted mt-0.5">
                <User size={12} className="text-muted-foreground" />
              </div>
            )}
          </div>
        ))}

        {/* Thinking indicator */}
        {isLoading && (
          <div className="flex gap-2 items-start">
            <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Bot size={12} className="text-primary" />
            </div>
            <div className="bg-card shadow-sm ring-1 ring-border rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              {thinkingDetail ?? t("coach.thinking")}
            </div>
          </div>
        )}
      </div>

      {/* Input — pinned to bottom */}
      <div className="border-t border-border px-5 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("coach.placeholder")}
            rows={1}
            className="flex-1 resize-none rounded-2xl border border-border bg-card px-4 py-2.5 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 max-h-24"
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 active:opacity-80 transition-opacity"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
