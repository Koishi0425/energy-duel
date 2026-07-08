import { Socket } from 'socket.io-client';
import { PlayerInfo, RoomType } from '../../../shared/types';
import { ClientToServerEvents, ServerToClientEvents } from '../../../shared/types';

interface Props {
  roomCode: string;
  players: PlayerInfo[];
  isHost: boolean;
  playerId: string;
  roomType: RoomType;
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  onLeave: () => void;
}

export default function WaitingRoom({ roomCode, players, isHost, playerId, roomType, socket, onLeave }: Props) {
  const maxPlayers = roomType === 'duo' ? 2 : 8;
  const handleStart = () => {
    socket.emit('start_game');
  };

  return (
    <div className="waiting-room">
      <div className="room-header">
        <h2>房间号</h2>
        <div className="room-code-big">{roomCode}</div>
        <p className="room-hint">
          {roomType === 'duo' ? '双人对战' : '多人混战'} · 发给朋友加入
        </p>
      </div>

      <div className="player-list">
        <h3>玩家 ({players.length}/{maxPlayers})</h3>
        {players.map((p) => (
          <div key={p.id} className={`player-row ${p.id === playerId ? 'is-me' : ''}`}>
            <span className="player-name">
              {p.nickname}
              {p.id === playerId && ' (你)'}
            </span>
            <span className="player-level">Lv.{p.level}</span>
          </div>
        ))}
      </div>

      <div className="waiting-actions">
        {isHost ? (
          <button
            className="btn btn-primary"
            onClick={handleStart}
            disabled={players.length < 2}
          >
            {players.length < 2 ? '等待玩家加入…' : '开始游戏'}
          </button>
        ) : (
          <p className="waiting-text">等待房主开始游戏…</p>
        )}
        <button className="btn btn-ghost" onClick={onLeave}>
          离开房间
        </button>
      </div>
    </div>
  );
}
