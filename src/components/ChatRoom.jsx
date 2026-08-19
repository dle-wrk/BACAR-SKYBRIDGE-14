import { useEffect, useMemo, useRef, useState } from 'react';
import mqtt from 'mqtt';
import { MessageSquareText, SendHorizonal, Users, X } from 'lucide-react';
import { observerDisplayName } from '@/lib/observer';
import { MQTT_TOPICS, telemetry } from '@/lib/mqttService';

const ROOM_KEY = 'bacar_mission_chat_room_v1';
const CHANNEL_NAME = 'bacar_chat_channel_v1';
const MQTT_CHAT_TOPIC = MQTT_TOPICS.chat;
const MQTT_PRESENCE_TOPIC = MQTT_TOPICS.attendees;
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

function normalizeRoom(room) {
  const users = Array.isArray(room?.users) ? room.users : [];
  const messages = Array.isArray(room?.messages) ? room.messages : [];
  const now = Date.now();

  return {
    users: users
      .filter((user) => now - (user.lastSeen || 0) < PRESENCE_TTL_MS)
      .map((user) => ({
        ...user,
        key: user.key || `${user.type || 'guest'}:${user.username || 'guest'}:${user.sessionId || 'unknown'}`.toLowerCase(),
      })),
    messages: messages
      .filter((message) => message && typeof message.text === 'string')
      .slice(-MAX_MESSAGES),
  };
}

function readRoom() {
  try {
    const raw = localStorage.getItem(ROOM_KEY);
    const parsed = raw ? JSON.parse(raw) : { users: [], messages: [] };
    return normalizeRoom(parsed);
  } catch {
    return { users: [], messages: [] };
  }
}

function writeRoom(nextRoom) {
  const normalized = normalizeRoom(nextRoom);
  localStorage.setItem(
    ROOM_KEY,
    JSON.stringify({
      users: normalized.users.slice(-100),
      messages: normalized.messages.slice(-MAX_MESSAGES),
    })
  );
}

function appendMessage(room, message) {
  if (!message || typeof message.text !== 'string' || !message.id) {
    return { room, added: false };
  }
  if (room.messages.some((existing) => existing.id === message.id)) {
    return { room, added: false };
  }
  return {
    room: { ...room, messages: [...room.messages, message].slice(-MAX_MESSAGES) },
    added: true,
  };
}

function normalizeChatMessage(payload) {
  const message = payload?.type === 'message' ? payload : payload?.message;
  if (!message || typeof message.message !== 'string' || !message.message.trim()) return null;
  const timestamp = message.timestamp || new Date().toISOString();
  return {
    id: message.id || `${message.sender || 'guest'}:${timestamp}:${message.message}`,
    username: message.sender || message.username || 'Guest',
    type: message.type || 'guest',
    text: message.message,
    color: message.color,
    sentAt: Date.parse(timestamp) || Date.now(),
  };
}

function normalizePresence(payload) {
  const user = payload?.user || payload;
  if (!user?.sender && !user?.username) return null;
  return {
    ...user,
    sessionId: user.session_id || user.sessionId || user.sender || user.username,
    username: user.sender || user.username,
    status: user.status || (user.active === false ? 'offline' : 'online'),
    lastSeen: Date.now(),
  };
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

function getUserKey(user, sessionIdOverride) {
  const username = observerDisplayName(user) || 'guest';
  const sessionId = sessionIdOverride || user?.sessionId || user?.id || Math.random().toString(16).slice(2);
  return `${user?.type || 'guest'}:${username}:${sessionId}`.toLowerCase();
}

function mergeUsers(users, nextUser) {
  const withoutCurrent = users.filter((user) => user.sessionId !== nextUser.sessionId);
  withoutCurrent.push(nextUser);
  return withoutCurrent;
}

export default function ChatRoom({ observer }) {
  const currentUserName = observer ? observerDisplayName(observer) : 'Guest';
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState(() => readRoom().users);
  const [messages, setMessages] = useState(() => readRoom().messages);
  const [typingUsers, setTypingUsers] = useState([]);
  const mqttClientRef = useRef(null);
  const typingTimerRef = useRef(null);

  useEffect(() => {
    if (!observer) return undefined;

    const sessionId = getSessionId();
    const currentRoom = readRoom();
    const nextEntry = {
      sessionId,
      key: getUserKey(observer, sessionId),
      username: currentUserName,
      type: observer?.type || 'guest',
      lastSeen: Date.now(),
    };

    const refreshFromStorage = () => {
      const room = readRoom();
      setUsers(room.users);
      setMessages(room.messages);
    };

    const localUsers = mergeUsers(currentRoom.users, nextEntry);
    writeRoom({ ...currentRoom, users: localUsers });
    setUsers(localUsers);
    emitRoomEvent('presence', { users: localUsers });

    const brokerUrl = telemetry.getBrokerUrl()?.trim();
    let mqttClient = null;
    let presenceTimer = null;
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL_NAME) : null;

    if (brokerUrl) {
      mqttClient = mqtt.connect(brokerUrl, {
        reconnectPeriod: 4000,
        connectTimeout: 8000,
        clean: true,
      });

      mqttClient.on('connect', () => {
        mqttClient.subscribe(MQTT_CHAT_TOPIC, { qos: 1 }, () => {});
        mqttClient.subscribe(MQTT_PRESENCE_TOPIC, { qos: 1 }, () => {});
        mqttClientRef.current = mqttClient;
        mqttClient.publish(MQTT_PRESENCE_TOPIC, JSON.stringify({
          type: 'presence',
          sender: currentUserName,
          status: 'online',
          session_id: sessionId,
        }), { qos: 1 });
      });

      mqttClient.on('message', (topic, payload) => {
        const raw = payload.toString();
        try {
          const message = JSON.parse(raw);

          if (topic === MQTT_PRESENCE_TOPIC && message?.type === 'presence') {
            const room = readRoom();
            const peer = normalizePresence(message);
            if (!peer) return;
            const merged = peer.status === 'offline'
              ? room.users.filter((user) => user.sessionId !== peer.sessionId)
              : mergeUsers(room.users, { ...peer, key: getUserKey(peer, peer.sessionId) });
            const nextRoom = { ...room, users: merged };
            writeRoom(nextRoom);
            setUsers(merged);
            emitRoomEvent('presence', { users: merged });
            return;
          }

          if (topic === MQTT_CHAT_TOPIC && (message?.type === 'message' || message?.type === 'chat-message')) {
            const room = readRoom();
            const result = appendMessage(room, normalizeChatMessage(message));
            if (!result.added) return;
            writeRoom(result.room);
            setMessages(result.room.messages);
            emitRoomEvent('chat-message', { message: normalizeChatMessage(message) });
            return;
          }

          if (topic === MQTT_CHAT_TOPIC && message?.type === 'typing') {
            const sender = message.sender || 'Guest';
            setTypingUsers((current) => message.is_typing
              ? [...new Set([...current, sender])]
              : current.filter((user) => user !== sender));
            window.setTimeout(() => {
              setTypingUsers((current) => current.filter((user) => user !== sender));
            }, 5000);
          }
        } catch {
          // ignore malformed MQTT payloads
        }
      });

      presenceTimer = window.setInterval(() => {
        if (mqttClient && mqttClient.connected) {
          mqttClient.publish(MQTT_PRESENCE_TOPIC, JSON.stringify({
            type: 'presence',
            sender: currentUserName,
            status: 'online',
            session_id: sessionId,
          }), { qos: 1 });
        }
      }, 15_000);
    }

    if (channel) {
      channel.onmessage = (event) => {
        const { type } = event.data || {};
        if (type === 'presence' || type === 'chat-message') {
          refreshFromStorage();
        }
      };
    }

    window.addEventListener('storage', refreshFromStorage);
    window.addEventListener('bacar-chat-room-sync', refreshFromStorage);

    return () => {
      if (presenceTimer) window.clearInterval(presenceTimer);
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      mqttClientRef.current = null;
      if (channel) channel.close();
      window.removeEventListener('storage', refreshFromStorage);
      window.removeEventListener('bacar-chat-room-sync', refreshFromStorage);

      if (mqttClient && mqttClient.connected) {
        mqttClient.publish(MQTT_PRESENCE_TOPIC, JSON.stringify({
          type: 'presence',
          sender: currentUserName,
          status: 'offline',
          session_id: sessionId,
        }), { qos: 1 });
        mqttClient.end(true);
      }

      const remainingRoom = readRoom();
      const remainingUsers = remainingRoom.users.filter((user) => user.sessionId !== sessionId);
      writeRoom({ ...remainingRoom, users: remainingUsers });
      setUsers(remainingUsers);
      emitRoomEvent('presence', { users: remainingUsers });
    };
  }, [observer, currentUserName]);

  const visibleUsers = useMemo(
    () => [...users].sort((a, b) => (a.username || '').localeCompare(b.username || '')),
    [users]
  );

  const handleSend = (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !observer) return;

    const sentAt = Date.now();
    const timestamp = new Date(sentAt).toISOString();
    const nextMessage = {
      id: `${currentUserName}:${timestamp}:${text}`,
      username: currentUserName,
      type: observer?.type || 'guest',
      text,
      sentAt,
    };
    const wireMessage = {
      type: 'message',
      sender: currentUserName,
      timestamp,
      message: text,
      color: observer?.color || '#4fc3f7',
    };

    const room = readRoom();
    const result = appendMessage(room, nextMessage);
    if (!result.added) return;
    writeRoom(result.room);
    setMessages(result.room.messages);
    setDraft('');
    emitRoomEvent('chat-message', { message: nextMessage });

    const brokerUrl = telemetry.getBrokerUrl()?.trim();
    if (brokerUrl) {
      const mqttClient = mqtt.connect(brokerUrl, {
        reconnectPeriod: 4000,
        connectTimeout: 8000,
        clean: true,
      });

      mqttClient.on('connect', () => {
        mqttClient.publish(MQTT_CHAT_TOPIC, JSON.stringify(wireMessage), { qos: 1 });
        mqttClient.end(true);
      });

      mqttClient.on('error', () => {
        // rely on the local fallback state if the broker is unavailable
      });
      return;
    }
  };

  const handleDraftChange = (event) => {
    const value = event.target.value;
    setDraft(value);
    const client = mqttClientRef.current;
    if (!client?.connected) return;
    client.publish(MQTT_CHAT_TOPIC, JSON.stringify({
      type: 'typing',
      sender: currentUserName,
      is_typing: Boolean(value.trim()),
    }), { qos: 0 });
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    if (value.trim()) {
      typingTimerRef.current = window.setTimeout(() => {
        client.publish(MQTT_CHAT_TOPIC, JSON.stringify({
          type: 'typing', sender: currentUserName, is_typing: false,
        }), { qos: 0 });
      }, 1500);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[min(calc(100vw-2rem),380px)]">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto flex items-center gap-2 rounded-full border border-accent/40 bg-card px-4 py-3 text-sm font-semibold text-foreground shadow-2xl shadow-black/40 transition hover:border-accent hover:text-accent"
          aria-label="Open mission chat"
        >
          <MessageSquareText className="h-4 w-4 text-accent" />
          Mission Chat
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
            {visibleUsers.length}
          </span>
        </button>
      ) : (
        <aside className="strat-card flex h-[min(70vh,620px)] w-full flex-col rounded-2xl border border-border/50 p-4 shadow-2xl shadow-black/50">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-md bg-accent/10 p-1.5 text-accent">
                <MessageSquareText className="w-4 h-4" />
              </div>
              <h3 className="font-heading text-lg font-semibold">Mission Chat</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/50 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <Users className="w-3 h-3" />
                {visibleUsers.length}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                aria-label="Close mission chat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
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

      {typingUsers.length > 0 && (
        <div className="mt-2 text-[10px] text-muted-foreground">
          {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
        </div>
      )}

      <form onSubmit={handleSend} className="mt-4 flex gap-2">
        <input
          value={draft}
          onChange={handleDraftChange}
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
      )}
    </div>
  );
}
