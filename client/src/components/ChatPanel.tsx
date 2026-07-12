import { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { ChatMessage, ChatScope, PlayerInfo, ClientToServerEvents, ServerToClientEvents } from '../../../shared/types';

interface Props {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  playerId: string;
  players: PlayerInfo[];
  isTeamMode: boolean;
  isOpen: boolean;
  onClose: () => void;
  onUnreadChange?: (unread: number) => void;
}

export default function ChatPanel({ socket, playerId, players, isTeamMode, isOpen, onClose, onUnreadChange }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [scope, setScope] = useState<ChatScope>('all');
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const prevOpen = useRef(isOpen);

  const myTeam = players.find(p => p.id === playerId)?.team;

  // Report unread to parent
  useEffect(() => {
    onUnreadChange?.(unread);
  }, [unread, onUnreadChange]);

  // Listen for broadcasts
  useEffect(() => {
    const onBroadcast = (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
      if (!isOpen) setUnread(u => u + 1);
    };
    const onHistory = (msgs: ChatMessage[]) => {
      setMessages(msgs);
    };

    socket.on('chat_broadcast', onBroadcast);
    socket.on('chat_history', onHistory);

    return () => {
      socket.off('chat_broadcast', onBroadcast);
      socket.off('chat_history', onHistory);
    };
  }, [socket, isOpen]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Clear unread when opened
  useEffect(() => {
    if (isOpen && !prevOpen.current) {
      setUnread(0);
    }
    prevOpen.current = isOpen;
  }, [isOpen]);

  const handleSend = () => {
    const content = input.trim();
    if (!content) return;
    socket.emit('chat_message', { content, scope });
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getName = (id: string) => players.find(p => p.id === id)?.nickname || '?';

  if (!isOpen) return null;

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">💬 聊天</span>
        <button className="chat-close" onClick={onClose}>✕</button>
      </div>

      {isTeamMode && (
        <div className="chat-tabs">
          <button
            className={`chat-tab ${scope === 'all' ? 'active' : ''}`}
            onClick={() => setScope('all')}
          >
            🌐 全场
          </button>
          <button
            className={`chat-tab ${scope === 'team' ? 'active' : ''}`}
            onClick={() => setScope('team')}
          >
            {myTeam === 0 ? '🔴' : '🔵'} 队内
          </button>
        </div>
      )}

      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="chat-empty">暂无消息，来打个招呼吧！</p>
        )}
        {messages.map((msg) => {
          const isMe = msg.playerId === playerId;
          return (
            <div key={msg.id} className={`chat-msg ${isMe ? 'is-me' : ''}`}>
              {msg.scope === 'team' && (
                <span className="chat-scope-tag">[队内]</span>
              )}
              <span className="chat-sender">{isMe ? '你' : getName(msg.playerId)}</span>
              <span className="chat-content">{msg.content}</span>
            </div>
          );
        })}
      </div>

      <div className="chat-input-area">
        <input
          className="chat-input"
          type="text"
          placeholder={isTeamMode && scope === 'team' ? '队内聊天…' : '输入消息…'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={200}
        />
        <button className="chat-send btn btn-primary btn-sm" onClick={handleSend}>
          发送
        </button>
      </div>
    </div>
  );
}

// Export the FAB button separately
export function ChatFab({ unread, onClick }: { unread: number; onClick: () => void }) {
  return (
    <button className="chat-fab" onClick={onClick}>
      💬
      {unread > 0 && <span className="chat-badge">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}
