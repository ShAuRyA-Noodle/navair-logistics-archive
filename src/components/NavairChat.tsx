'use client';

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import styles from './navair-chat.module.css';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

function apiHistory(messages: ChatMessage[]) {
  const history: Array<Pick<ChatMessage, 'role' | 'content'>> = [];
  const encoder = new TextEncoder();
  let bytes = 0;
  for (let index = messages.length - 1; index >= 0 && history.length < 20; index -= 1) {
    const { role, content } = messages[index];
    const contentBytes = encoder.encode(content).byteLength;
    if (bytes + contentBytes > 10_000) break;
    history.unshift({ role, content });
    bytes += contentBytes;
  }
  return history;
}

function ParcelMascot({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? styles.mascotSmall : styles.mascot}
      viewBox="0 0 72 72"
      aria-hidden="true"
    >
      <path className={styles.mascotShadow} d="M15 59c8 6 35 6 43 0-8-4-35-4-43 0Z" />
      <path className={styles.mascotEar} d="M19 28 10 21l3 15m40-8 9-7-3 15" />
      <path className={styles.mascotBox} d="M17 25 36 15l19 10v28L36 63 17 53V25Z" />
      <path className={styles.mascotSide} d="m36 36 19-11v28L36 63V36Z" />
      <path className={styles.mascotTape} d="m28 19 19 10v9l-7-2-4 5V36L17 26l11-7Z" />
      <path className={styles.mascotLine} d="m17 25 19 11 19-11M36 36v27" />
      <circle className={styles.mascotEye} cx="28" cy="43" r="2.4" />
      <circle className={styles.mascotEye} cx="44" cy="43" r="2.4" />
      <path className={styles.mascotSmile} d="M32 49c2 2 6 2 8 0" />
      <path className={styles.mascotSpark} d="m59 12 1.4 4.1 4.1 1.4-4.1 1.4L59 23l-1.4-4.1-4.1-1.4 4.1-1.4L59 12Z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11m-5-5 5 5-5 5" />
    </svg>
  );
}

export default function NavairChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedMessage, setFailedMessage] = useState<ChatMessage | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messageNumber = useRef(0);

  const nextId = (role: ChatMessage['role']) => {
    messageNumber.current += 1;
    return `${role}-${messageNumber.current}`;
  };

  const closeChat = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => launcherRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeChat();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeChat, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open, sending, error]);

  const sendMessage = async (userMessage: ChatMessage, visibleMessages: ChatMessage[]) => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setSending(true);
    setError(null);
    setFailedMessage(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiHistory(visibleMessages),
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as { reply?: unknown; error?: unknown } | null;
      const reply = typeof payload?.reply === 'string' ? payload.reply.trim().slice(0, 2_000) : '';
      if (!response.ok || !reply) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Navair Assist is unavailable right now.');
      }
      setMessages((current) => [
        ...current,
        { id: nextId('assistant'), role: 'assistant', content: reply },
      ]);
    } catch (reason) {
      if (controller.signal.aborted) return;
      setFailedMessage(userMessage);
      setError(reason instanceof Error && reason.message
        ? reason.message
        : 'Navair Assist is unavailable right now. Please try again.');
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setSending(false);
      }
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = input.trim();
    if (!content || sending) return;
    const userMessage: ChatMessage = { id: nextId('user'), role: 'user', content };
    const visibleMessages = [...messages, userMessage];
    setMessages(visibleMessages);
    setInput('');
    void sendMessage(userMessage, visibleMessages);
  };

  const retry = () => {
    if (!failedMessage || sending) return;
    void sendMessage(failedMessage, messages);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <aside className={styles.root} aria-label="Navair Assist">
      {open && (
        <section
          id="navair-chat-panel"
          className={styles.panel}
          role="dialog"
          aria-modal="false"
          aria-labelledby="navair-chat-title"
          data-lenis-prevent
        >
          <header className={styles.header}>
            <div className={styles.headerMascot}><ParcelMascot small /></div>
            <div>
              <p className={styles.eyebrow}>Navair Assist</p>
              <h2 id="navair-chat-title">How can I help?</h2>
            </div>
            <button className={styles.close} type="button" onClick={closeChat} aria-label="Close chat">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
            </button>
          </header>

          <div
            className={styles.messages}
            ref={scrollRef}
            data-lenis-prevent
            aria-live="polite"
            aria-relevant="additions text"
          >
            {messages.length === 0 && (
              <div className={styles.welcome}>
                <span className={styles.welcomeMark}>✦</span>
                <p>Ask about routes, freight options, documents, or your next logistics step.</p>
              </div>
            )}
            {messages.map((message) => (
              <div key={message.id} className={`${styles.messageRow} ${styles[message.role]}`}>
                {message.role === 'assistant' && <span className={styles.avatar}><ParcelMascot small /></span>}
                <p className={styles.bubble}>{message.content}</p>
              </div>
            ))}
            {sending && (
              <div className={`${styles.messageRow} ${styles.assistant}`} aria-live="polite">
                <span className={styles.avatar}><ParcelMascot small /></span>
                <div className={`${styles.bubble} ${styles.typing}`} aria-label="Navair Assist is thinking">
                  <span /><span /><span />
                </div>
              </div>
            )}
            {error && (
              <div className={styles.error} role="alert">
                <p>{error}</p>
                <button type="button" onClick={retry} disabled={sending}>Try again</button>
              </div>
            )}
          </div>

          <form className={styles.composer} onSubmit={submit}>
            <label htmlFor="navair-chat-message" className={styles.srOnly}>Message Navair Assist</label>
            <textarea
              id="navair-chat-message"
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(event) => setInput(event.target.value.slice(0, 1200))}
              onKeyDown={onInputKeyDown}
              placeholder="Ask Navair…"
              disabled={sending}
            />
            <button type="submit" disabled={sending || !input.trim()} aria-label="Send message">
              <ArrowIcon />
            </button>
          </form>
          <p className={styles.note}>AI guidance can be imperfect. Confirm shipment details with our team.</p>
        </section>
      )}

      <button
        ref={launcherRef}
        type="button"
        className={styles.launcher}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="navair-chat-panel"
        aria-label={open ? 'Close Navair Assist' : 'Open Navair Assist'}
      >
        <span className={styles.launchLabel}>Ask Navair</span>
        <span className={styles.launchMascot}><ParcelMascot /></span>
      </button>
    </aside>
  );
}
