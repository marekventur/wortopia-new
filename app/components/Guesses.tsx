import { useGameStore } from "../stores/gameStore.js";

const statusLabels: Record<string, string> = {
  duplicate: 'Bereits geraten',
  not_on_field: 'Nicht auf dem Feld',
  not_in_dictionary: 'Nicht im Wörterbuch',
  cooldown: 'Zu Spät',
  too_short: 'Zu kurz',
};

const rowClass: Record<string, string> = {
  not_on_field: 'danger',
  duplicate: 'warning',
  not_in_dictionary: 'danger',
  cooldown: 'danger',
  too_short: 'danger',
};

const statusTextClass: Record<string, string> = {
  not_on_field: 'text-danger',
  duplicate: 'text-warning',
  not_in_dictionary: 'text-danger',
};

export default function Guesses() {
  const myGuesses = useGameStore((s) => s.myGuesses);
  const totalPoints = myGuesses.reduce((sum, g) => sum + (g.result === 'correct' ? g.points : 0), 0);

  return (
    <div className="guesses">
      <div className="panel panel-default">
        <div className="panel-heading">{totalPoints} Punkte</div>
        <table className="table table-condensed">
          <tbody>
            {myGuesses.map((guess, i) => (
              <tr key={i} className={guess.result === 'correct' ? 'success' : (rowClass[guess.result] ?? 'danger')}>
                <td className="word">{guess.word}</td>
                {guess.result === 'correct' ? (
                  <td className="points"><span className="badge">{guess.points}</span></td>
                ) : (
                  <td className={`status ${statusTextClass[guess.result] ?? 'text-danger'}`}>
                    {statusLabels[guess.result] ?? guess.result}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
