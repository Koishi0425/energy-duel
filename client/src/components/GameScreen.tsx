import { useState } from 'react';
import { Socket } from 'socket.io-client';
import { GamePhase, PlayerInfo, RoundResolution, ClientToServerEvents, ServerToClientEvents } from '../../../shared/types';
import PlayerStatusBar from './PlayerStatusBar';
import MoveSelector from './MoveSelector';
import PhaseResolution from './PhaseResolution';
import ChatPanel, { ChatFab } from './ChatPanel';

interface Props {
  phase: GamePhase;
  round: number;
  players: PlayerInfo[];
  playerId: string;
  deadline: number;
  resolution: RoundResolution | null;
  roomCode: string;
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  uiMode: 'normal' | 'compact';
}

export default function GameScreen({
  phase, round, players, playerId, deadline, resolution, roomCode, socket, uiMode,
}: Props) {
  const me = players.find(p => p.id === playerId);
  const isDead = me ? !me.alive : true;
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);

  const isTeamMode = players.some(p => p.team !== undefined);

  return (
    <div className="game-screen">
      <div className="game-header">
        <span className="game-round">第 {round} 回合</span>
        <span className="game-room-code">{roomCode}</span>
      </div>

      <PlayerStatusBar players={players} playerId={playerId} />

      <div className="game-main">
        {phase === 'thinking' && !isDead && (
          <MoveSelector
            players={players}
            playerId={playerId}
            level={me?.level || 1}
            energy={me?.energy || 0}
            socket={socket}
            deadline={deadline}
            uiMode={uiMode}
          />
        )}

        {phase === 'thinking' && isDead && (
          <div className="dead-notice">
            <p>你已出局</p>
            <p className="dead-sub">等待其他玩家结束战斗…</p>
          </div>
        )}

        {(phase === 'reveal' || phase === 'result') && resolution && (
          <PhaseResolution
            resolution={resolution}
            players={players}
          />
        )}
      </div>

      {/* Chat FAB */}
      <ChatFab unread={chatUnread} onClick={() => setChatOpen(!chatOpen)} />

      {/* Chat Panel */}
      <ChatPanel
        socket={socket}
        playerId={playerId}
        players={players}
        isTeamMode={isTeamMode}
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        onUnreadChange={setChatUnread}
      />
    </div>
  );
}
