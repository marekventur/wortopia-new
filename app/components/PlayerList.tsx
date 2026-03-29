const players = [
  { name: 'Grobi', points: 79, percent: 88 },
  { name: 'Axiom', points: 75, percent: 88 },
  { name: 'Gast 260928', guest: true, guestId: 260928, points: 68, percent: 84 },
  { name: 'Gast 262112', guest: true, guestId: 262112, points: 65, percent: 80 },
  { name: 'Gast 108585', guest: true, guestId: 108585, points: 70, percent: 87 },
  { name: 'Lüwerb75', points: 63, percent: 84 },
  { name: 'Gast 262265', guest: true, guestId: 262265, points: 62, percent: 87 },
  { name: 'BarbII', points: 60, percent: 88 },
  { name: 'Hurz', points: 55, percent: 84 },
  { name: 'Gast 262270', guest: true, guestId: 262270, points: 52, percent: 82 },
  { name: 'chipai', points: 25, percent: 33 },
  { name: 'Gast 260908', guest: true, guestId: 260908, points: 18, percent: 65 },
  { name: 'Gast 247640', guest: true, guestId: 247640, points: 8, percent: 17 },
];

export default function PlayerList() {
  return (
    <div className="panel panel-default">
      <div className="panel-heading">
        13 Spieler
      </div>
      <ul className="list-group">
        {players.map((player, i) => (
          <li key={i} className="list-group-item">
            <span className="badge">
              {player.points} <small>({player.percent}%)</small>
            </span>
            {player.guest
              ? `Gast ${(player as { guestId: number }).guestId}`
              : player.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
