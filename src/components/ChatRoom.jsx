import { useEffect, useMemo, useState } from 'react';
import { MessageSquareText, SendHorizonal, Users } from 'lucide-react';
import { observerDisplayName } from '@/lib/observer';

const ROOM_KEY = 'bacar_mission_chat_room_v1';
const CHANNEL_NAME = 'bacar_chat_channel_v1';
const PRESENCE_TTL_MS = 60_000;
const MAX_MESSAGES = 80;

function getSessionId() {
  if (typeof window === 'undefined') return 'guest';

  const existing = window.sessionStorage.getItem('bacar_chat_session_id');
  if (existing) return existing;

  const next = `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.sessionStorage.setItem('bacar_chat_session_id', next);
  return next;
}

function readRoom() {
  try {
    const raw = localStorage.getItem(ROOM_KEY);
    const parsed = raw ? JSON.parse(raw) : { users: [], messages: [] };
    const users = Array.isArray(parsed.users) ? parsed.users : [];
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const now = Date.now();

    return {
      users: users.filter((user) => now - (user.lastSeen || 0) < PRESENCE_TTL_MS),
      messages: messages.slice(-MAX_MESSAGES),
    };
  } catch {
    return { users: [], messages: [] };
  }
}

function writeRoom(nextRoom) {
  localStorage.setItem(
    ROOM_KEY,
    JSON.stringify({
      users: Array.isArray(nextRoom.users) ? nextRoom.users.slice(-100) : [],
      messages: Array.isArray(nextRoom.messages) ? nextRoom.messages.slice(-MAX_MESSAGES) : [],
    })
  );
}

function syncRoomState() {
  const room = readRoom();
  return room;
}

function emitRoomEvent(type, payload) {
  if (typeof window === 'undefined') return;

  const eventPayload = { type, payload, sentAt: Date.now() };

  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage(eventPayload);
    channel.close();
  }

  window.dispatchEvent(new CustomEvent('bacar-chat-room-sync', { detail: eventPayload }));
}

function getUserKey(user) {
  const username = observerDisplayName(user) || 'guest';
  return `${user?.type || 'guest'}:${username}`.toLowerCase();
}

export default function ChatRoom({ observer }) {
  const currentUserName = observer ? observerDisplayName(observer) : 'Guest';
  const [draft, setDraft] = useState('');
  const [users, setUsers] = useState(() => syncRoomState().users);
  const [messages, setMessages] = useState(() => syncRoomState().messages);

  useEffect(() => {
    if (!observer) return;

    const sessionId = getSessionId();
    const updateRoomFromStorage = () => {
      const room = readRoom();
      setUsers(room.users);
      setMessages(room.messages);
    };

    const nextEntry = {
      sessionId,
      key: getUserKey(observer),
      username: currentUserName,
      type: observer?.type || 'guest',
      lastSeen: Date.now(),
    };

    const existingRoom = readRoom();
    const mergedUsers = existingRoom.users.filter((user) => user.sessionId !== sessionId && user.key !== nextEntry.key);
    mergedUsers.push(nextEntry);

    const nextRoom = {
      ...existingRoom,
      users: mergedUsers,
    };

    writeRoom(nextRoom);
    setUsers(mergedUsers);
    emitRoomEvent('presence', { users: mergedUsers });

    const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;
    if (channel) {
      channel.onmessage = (event) => {
        const { type } = event.data || {};
        if (type === 'presence' || type === 'chat-message') {
          updateRoomFromStorage();
        }
      };
    }

    window.addEventListener('storage', updateRoomFromStorage);
    window.addEventListener('bacar-chat-room-sync', updateRoomFromStorage);

    const heartbeat = window.setInterval(() => {
      const room = readRoom();
      const refreshedUsers = room.users.filter((user) => user.sessionId !== sessionId && user.key !== nextEntry.key);
      refreshedUsers.push({ ...nextEntry, lastSeen: Date.now() });
      const refreshedRoom = { ...room, users: refreshedUsers };
      writeRoom(refreshedRoom);
      setUsers(refreshedUsers);
      emitRoomEvent('presence', { users: refreshedUsers });
    }, 15_000);

    return () => {
      window.clearInterval(heartbeat);
      if (channel) channel.close();
      window.removeEventListener('storage', updateRoomFromStorage);
      window.removeEventListener('bacar-chat-room-sync', updateRoomFromStorage);

      const remainingRoom = readRoom();
      const remainingUsers = remainingRoom.users.filter((user) => user.sessionId !== sessionId && user.key !== nextEntry.key);
      writeRoom({ ...remainingRoom, users: remainingUsers });
      setUsers(remainingUsers);
      emitRoomEvent('presence', { users: remainingUsers });
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

    const room = readRoom();
    const nextMessages = [...room.messages, nextMessage].slice(-MAX_MESSAGES);
    const nextRoom = { ...room, messages: nextMessages };
    writeRoom(nextRoom);
    setMessages(nextMessages);
    setDraft('');
    emitRoomEvent('chat-message', { message: nextMessage });
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
