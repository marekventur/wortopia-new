type Guess =
  | { word: string; points: number; status?: undefined }
  | { word: string; points?: undefined; status: string };

const guesses: Guess[] = [
  { word: 'UND', points: 1 },
  { word: 'RUND', points: 1 },
  { word: 'FUND', points: 1 },
  { word: 'RUNE', points: 1 },
  { word: 'RUINE', points: 2 },
  { word: 'RUNEN', points: 2 },
  { word: 'FUNDE', points: 2 },
  { word: 'DUNKEL', status: 'notOnField' },
  { word: 'NEID', status: 'notInDictionary' },
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

export default function Guesses() {
  const totalPoints = guesses.reduce((sum, g) => sum + (g.points ?? 0), 0);

  return (
    <div className="guesses">
      <div className="panel panel-default">
        <div className="panel-heading">{totalPoints} Punkte</div>
        <table className="table table-condensed">
          <tbody>
            {guesses.map((guess, i) => (
              <tr key={i} className={guess.points ? 'guess--accepted' : 'guess--rejected'}>
                <td className="word">{guess.word}</td>
                {guess.points ? (
                  <td className="points"><span className="badge">{guess.points}</span></td>
                ) : (
                  <td className="status text-danger">{statusLabels[guess.status!] ?? guess.status}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
