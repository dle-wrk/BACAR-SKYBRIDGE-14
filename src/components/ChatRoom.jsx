import { useEffect, useMemo, useState } from 'react';
import { MessageSquareText, SendHorizonal, Users } from 'lucide-react';
import { observerDisplayName } from '@/lib/observer';

const USERS_KEY = 'bacar_chat_users_v1';
const MESSAGES_KEY = 'bacar_chat_messages_v1';
const CHANNEL_NAME = 'bacar_chat_channel_v1';
const PRESENCE_TTL_MS = 60_000;

function readUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    return (Array.isArray(parsed) ? parsed : []).filter((user) => now - (user.lastSeen || 0) < PRESENCE_TTL_MS);
  } catch {
    return [];
  }
}

function writeUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function readMessages() {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-80) : [];
  } catch {
    return [];
  }
}

function writeMessages(messages) {
  localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages.slice(-80)));
}

function emitPresence(type, payload) {
  if (typeof window === 'undefined') return;
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;
  if (channel) {
    channel.postMessage({ type, payload });
    channel.close();
  }
  window.dispatchEvent(new CustomEvent('bacar-chat-sync', { detail: { type, payload } }));
}

function getUserKey(user) {
  const username = observerDisplayName(user) || 'guest';
  return `${user?.type || 'guest'}:${username}`.toLowerCase();
}

export default function ChatRoom({ observer }) {
  const currentUserName = observer ? observerDisplayName(observer) : 'Guest';
  const [draft, setDraft] = useState('');
  const [users, setUsers] = useState(readUsers());
  const [messages, setMessages] = useState(readMessages());

  useEffect(() => {
    if (!observer) return;

    const nextUsers = readUsers();
    const nextEntry = {
      key: getUserKey(observer),
      username: currentUserName,
      type: observer?.type || 'guest',
      lastSeen: Date.now(),
    };
    const merged = nextUsers.filter((user) => user.key !== nextEntry.key);
    merged.push(nextEntry);
    writeUsers(merged);
    setUsers(merged);
    emitPresence('presence', { users: merged });

    const sync = () => {
      setUsers(readUsers());
      setMessages(readMessages());
    };

    const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;
    if (channel) {
      channel.onmessage = (event) => {
        if (event.data?.type === 'presence' || event.data?.type === 'chat-message') {
          sync();
        }
      };
    }
    window.addEventListener('storage', sync);
    window.addEventListener('bacar-chat-sync', sync);

    const heartbeat = window.setInterval(() => {
      const allUsers = readUsers();
      const refreshed = allUsers.filter((user) => user.key !== nextEntry.key);
      refreshed.push({ ...nextEntry, lastSeen: Date.now() });
      writeUsers(refreshed);
      setUsers(refreshed);
      emitPresence('presence', { users: refreshed });
    }, 15_000);

    return () => {
      window.clearInterval(heartbeat);
      if (channel) channel.close();
      window.removeEventListener('storage', sync);
      window.removeEventListener('bacar-chat-sync', sync);

      const remainingUsers = readUsers().filter((user) => user.key !== nextEntry.key);
      writeUsers(remainingUsers);
      setUsers(remainingUsers);
      emitPresence('presence', { users: remainingUsers });
    };
  }, [observer, currentUserName]);

  const visibleUsers = useMemo(() => [...users].sort((a, b) => a.username.localeCompare(b.username)), [users]);

  const handleSend = (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !observer) return;

    const nextMessage = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      username: currentUserName,
      type: observer?.type || 'guest',
      text,
      sentAt: Date.now(),
    };

    const nextMessages = [...readMessages(), nextMessage].slice(-80);
    writeMessages(nextMessages);
    setMessages(nextMessages);
    setDraft('');
    emitPresence('chat-message', { message: nextMessage });
  };

  return (
    <aside className="strat-card rounded-2xl border border-border/50 p-4 h-full w-full xl:h-[calc(100vh-12rem)] xl:max-h-[calc(100vh-12rem)] xl:flex xl:flex-col xl:sticky xl:top-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="rounded-md bg-accent/10 p-1.5 text-accent">
            <MessageSquareText className="w-4 h-4" />
          </div>
          <h3 className="font-heading text-lg font-semibold">Mission Chat</h3>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/50 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <Users className="w-3 h-3" />
          {visibleUsers.length}
        </span>
      </div>

      <div className="mb-4 rounded-xl border border-border/60 bg-background/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Signed in users</div>
        <div className="flex flex-wrap gap-2">
          {visibleUsers.length === 0 ? (
            <span className="text-sm text-muted-foreground">No users yet</span>
          ) : (
            visibleUsers.map((user) => (
              <span
                key={user.key}
                className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2 py-1 text-xs text-foreground"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                {user.username}
              </span>
            ))
          )}
        </div>
      </div>

      <div className="space-y-2 flex-1 overflow-y-auto pr-1 min-h-0">
        {messages.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
            Start the mission chat.
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="rounded-xl border border-border/60 bg-background/40 p-2.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">{message.username}</span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(message.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{message.text}</p>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSend} className="mt-4 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={observer ? `Message as ${currentUserName}` : 'Sign in to chat'}
          disabled={!observer}
          className="flex-1 rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!observer || !draft.trim()}
          className="inline-flex items-center justify-center rounded-xl bg-accent px-3 py-2 text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Send chat message"
        >
          <SendHorizonal className="w-4 h-4" />
        </button>
      </form>
    </aside>
  );
}
