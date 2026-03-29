type Guess =
  | { word: string; points: number; status?: undefined }
  | { word: string; points?: undefined; status: string };

const guesses: Guess[] = [
  { word: 'ASDFAS', status: 'notOnField' },
  { word: 'DER', status: 'dublicated' },
  { word: 'SER', status: 'notInDictionary' },
  { word: 'DAS', points: 1 },
  { word: 'DER', points: 1 },
  { word: 'RES', points: 1 },
];

const statusLabels: Record<string, string> = {
  waiting: '',
  dublicated: 'Bereits geraten',
  notOnField: 'Nicht auf dem Feld',
  notInDictionary: 'Nicht im Wörterbuch',
  tooLate: 'Zu Spät',
  tooShort: 'Zu kurz',
  unexpected: 'Etwas ist schief gegangen :(',
};

const rowClass: Record<string, string> = {
  notOnField: 'danger',
  dublicated: 'warning',
  notInDictionary: 'danger',
  tooLate: 'danger',
  tooShort: 'danger',
  unexpected: 'danger',
};

const statusTextClass: Record<string, string> = {
  notOnField: 'text-danger',
  dublicated: 'text-warning',
  notInDictionary: 'text-danger',
};

export default function Guesses() {
  const totalPoints = guesses.reduce((sum, g) => sum + (g.points ?? 0), 0);

  return (
    <div className="guesses">
      <div className="panel panel-default">
        <div className="panel-heading">{totalPoints} Punkte</div>
        <table className="table table-condensed">
          <tbody>
            {guesses.map((guess, i) => (
              <tr key={i} className={guess.points !== undefined ? 'success' : rowClass[guess.status!]}>
                <td className="word">{guess.word}</td>
                {guess.points !== undefined ? (
                  <td className="points"><span className="badge">{guess.points}</span></td>
                ) : (
                  <td className={`status ${statusTextClass[guess.status!] ?? 'text-danger'}`}>
                    {statusLabels[guess.status!] ?? guess.status}
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
