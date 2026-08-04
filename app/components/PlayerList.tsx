import { useGameStore } from "../stores/gameStore.js";
import type { PlayerResult, TeamResult } from "../../lib/gameTypes.js";

/**
 * One line in the result list: either a team with its members underneath, or a
 * player standing alone. Teams and solo players are ranked against each other
 * on points, exactly as the old site did it.
 */
type Row =
  | { kind: "team"; points: number; team: TeamResult; members: PlayerResult[] }
  | { kind: "player"; points: number; player: PlayerResult };

export default function PlayerList() {
  const currentRound = useGameStore((s) => s.currentRound);
  const lastRound = useGameStore((s) => s.lastRound);
  const myUsername = useGameStore((s) => s.myUsername);
  const setHoveredUserId = useGameStore((s) => s.setHoveredUserId);
  const hoveredWordGuessedBy = useGameStore((s) => s.hoveredWordGuessedBy);

  const isCooldown = currentRound?.state === 'cooldown';
  const results = isCooldown ? currentRound?.results : lastRound?.results;
  const players = results?.players ?? [];
  const teams = results?.teams ?? [];
  const maxPoints = lastRound?.results.words.reduce((sum, w) => sum + w.points, 0) ?? 0;

  const inATeam = new Set(teams.flatMap((t) => t.memberIds));
  const rows: Row[] = [
    ...teams.map((team) => ({
      kind: "team" as const,
      points: team.points,
      team,
      members: players
        .filter((p) => team.memberIds.includes(p.userId))
        .sort((a, b) => b.points - a.points),
    })),
    ...players
      .filter((p) => !inATeam.has(p.userId))
      .map((player) => ({ kind: "player" as const, points: player.points, player })),
  ].sort((a, b) => b.points - a.points);

  const percent = (points: number) =>
    maxPoints > 0 ? <small> ({Math.round(100 * points / maxPoints)}%)</small> : null;

  const name = (player: PlayerResult) =>
    player.username === myUsername ? <strong>{player.username}</strong> : player.username;

  return (
    <div className="panel panel-default">
      <div className="panel-heading">
        {players.length} Spieler
      </div>
      <ul className="list-group">
        {rows.map((row, i) =>
          row.kind === "player" ? (
            <li
              key={i}
              className={`list-group-item${hoveredWordGuessedBy?.includes(row.player.userId) ? ' player--highlight' : ''}`}
              onMouseEnter={() => setHoveredUserId(row.player.userId)}
              onMouseLeave={() => setHoveredUserId(null)}
            >
              <span className="badge">
                {row.player.points}
                {percent(row.player.points)}
              </span>
              {name(row.player)}
            </li>
          ) : (
            <li key={i} className="list-group-item">
              <span className="badge">
                {row.team.points}
                {percent(row.team.points)}
              </span>
              <span className="label label-default" style={{ fontWeight: "normal" }}>
                Team
              </span>{" "}
              {row.team.name}

              {/* The members keep their own hover behaviour; hovering the team
                  row itself would have to highlight several players at once,
                  which the highlight state does not carry today. */}
              <ul className="list-unstyled" style={{ marginTop: 4, marginBottom: 0, paddingLeft: 16 }}>
                {row.members.map((member) => (
                  <li
                    key={member.userId}
                    className={hoveredWordGuessedBy?.includes(member.userId) ? 'player--highlight' : undefined}
                    onMouseEnter={() => setHoveredUserId(member.userId)}
                    onMouseLeave={() => setHoveredUserId(null)}
                    style={{ fontSize: "0.9em" }}
                  >
                    <span className="badge" style={{ background: "transparent", color: "inherit", float: "right" }}>
                      {member.points}
                      {percent(member.points)}
                    </span>
                    {name(member)}
                  </li>
                ))}
              </ul>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
