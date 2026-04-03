import { useGameStore } from "../stores/gameStore.js";

export default function PlayerList() {
  const currentRound = useGameStore((s) => s.currentRound);
  const lastRound = useGameStore((s) => s.lastRound);
  const myUsername = useGameStore((s) => s.myUsername);
  const setHoveredUserId = useGameStore((s) => s.setHoveredUserId);
  const hoveredWordGuessedBy = useGameStore((s) => s.hoveredWordGuessedBy);

  const isCooldown = currentRound?.state === 'cooldown';
  const players = (isCooldown ? currentRound?.results.players : lastRound?.results.players) ?? [];

  return (
    <div className="panel panel-default">
      <div className="panel-heading">
        {players.length} Spieler
      </div>
      <ul className="list-group">
        {players.map((player, i) => (
          <li
            key={i}
            className={`list-group-item${hoveredWordGuessedBy?.includes(player.userId) ? ' player--highlight' : ''}`}
            onMouseEnter={() => setHoveredUserId(player.userId)}
            onMouseLeave={() => setHoveredUserId(null)}
          >
            <span className="badge">
              {player.points}
            </span>
            {player.username === myUsername ? <strong>{player.username}</strong> : player.username}
            {player.team && (
              <span className="label label-default" style={{ marginLeft: 6, fontSize: "0.8em", fontWeight: "normal" }}>
                {player.team}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
