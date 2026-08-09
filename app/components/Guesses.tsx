import { useGameStore, type GuessEntry } from "../stores/gameStore.js";
import { usePinnableTooltip } from "../hooks/usePinnableTooltip.js";

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

/**
 * Can this guess be offered to the dictionary?
 *
 * Any word the dictionary does not have. It used to be only words that were on
 * the board, which meant the one safe way to report a missing word — typing it
 * during a round where it cannot cost you anything — was also the one way that
 * gave you no button. A word that missed the board but is already in the
 * dictionary is nothing to report.
 */
function canPropose(guess: GuessEntry): boolean {
  if (guess.result === 'not_in_dictionary') return true;
  return guess.result === 'not_on_field' && guess.inDictionary === false;
}

export default function Guesses() {
  const myGuesses = useGameStore((s) => s.myGuesses);
  const totalPoints = myGuesses.reduce((sum, g) => sum + (g.result === 'correct' ? g.points : 0), 0);

  const { tooltipPinned, isLoggedIn, proposedWords, enrichingWord,
          handleMouseEnter, handleMouseLeave, handleClick, requestEnrich, renderTooltip } =
    usePinnableTooltip<GuessEntry>();

  if (myGuesses.length === 0) return null;

  return (
    <div className="guesses">
      <div className="panel panel-default">
        <div className="panel-heading">{totalPoints} Punkte</div>
        <table className="table table-condensed">
          <tbody>
            {myGuesses.map((guess, i) => (
              <tr key={i} className={guess.result === 'correct' ? 'success' : (rowClass[guess.result] ?? 'danger')}>
                <td className="word">
                  <span
                    id={`grw-${i}`}
                    className={`word${guess.description ? ' word--has-description' : ''}`}
                    style={{ cursor: isLoggedIn && (guess.description || canPropose(guess)) ? 'pointer' : 'default' }}
                    onMouseEnter={() => handleMouseEnter(`grw-${i}`, guess)}
                    onMouseLeave={handleMouseLeave}
                    onClick={() => {
                      if (guess.description || canPropose(guess)) {
                        handleClick(`grw-${i}`, guess);
                      }
                    }}
                  >
                    {guess.word}
                  </span>
                </td>
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

      {renderTooltip((word) => (
        <div>
          {word.description && <span>{word.description}</span>}
          {tooltipPinned && isLoggedIn && canPropose(word) && (
            proposedWords.has(word.word.toLowerCase())
              ? <span className="word-tooltip-loading">Bereits vorgeschlagen</span>
              : enrichingWord === word.word.toLowerCase()
                ? <span className="word-tooltip-loading">Beschreibung wird geladen…</span>
                : <button
                    className="word-tooltip-add-to-dict-button"
                    onClick={() => requestEnrich(word.word.toLowerCase())}
                  >
                    Zum Wörterbuch hinzufügen <span className="glyphicon glyphicon-plus"></span>
                  </button>
          )}
        </div>
      ))}
    </div>
  );
}
