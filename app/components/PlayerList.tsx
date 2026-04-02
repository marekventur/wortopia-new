import { useGameStore } from "../stores/gameStore.js";

export default function PlayerList() {
  const currentRound = useGameStore((s) => s.currentRound);
  const lastRound = useGameStore((s) => s.lastRound);
  const myUsername = useGameStore((s) => s.myUsername);

  const isCooldown = currentRound?.state === 'cooldown';
  const players = (isCooldown ? currentRound?.results.players : lastRound?.results.players) ?? [];

  return (
    <div className="panel panel-default">
      <div className="panel-heading">
        {players.length} Spieler
      </div>
      <ul className="list-group">
        {players.map((player, i) => (
          <li key={i} className={`list-group-item${player.username === myUsername ? ' active' : ''}`}>
            <span className="badge">
              {player.points}
            </span>
            {player.username}
          </li>
        ))}
      </ul>
    </div>
  );
}
