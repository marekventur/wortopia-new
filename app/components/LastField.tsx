import { useGameStore } from "../stores/gameStore.js";
import { fieldToGrid } from "../../lib/fieldContains.js";

export default function LastField() {
  const lastRound = useGameStore((s) => s.lastRound);
  const myUsername = useGameStore((s) => s.myUsername);

  if (!lastRound) return null;

  const size = lastRound.size;
  const grid = fieldToGrid(lastRound.field, size);
  const { players, words } = lastRound.results;

  const myStats = players.find((p) => p.username === myUsername);
  const myWords = new Set(
    words.filter((w) => w.username === myUsername).map((w) => w.word.toUpperCase())
  );

  // Count how many players guessed each word
  const wordCounts = new Map<string, number>();
  for (const w of words) {
    const key = w.word.toUpperCase();
    wordCounts.set(key, (wordCounts.get(key) ?? 0) + 1);
  }

  // Unique words sorted by length desc, then alphabetically
  const uniqueWords = [...new Set(words.map((w) => w.word.toUpperCase()))].sort(
    (a, b) => b.length - a.length || a.localeCompare(b)
  );

  return (
    <div>
      <div className="panel panel-default last-round">
        <div className="panel-heading">
          <table className="field">
            <tbody>
              {grid.map((row, y) => (
                <tr key={y}>
                  {row.map((cell, x) => (
                    <td key={x} className={`cell cell--${x}-${y}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <div>
            <p>Letzte Runde</p>
            <small>
              {myStats ? (
                <>{myStats.points} Punkte<br />{myStats.words} Wörter</>
              ) : (
                <>– Punkte<br />– Wörter</>
              )}
            </small>
          </div>
        </div>
        <div className="panel-body">
          {uniqueWords.map((word, i) => {
            const count = wordCounts.get(word) ?? 0;
            const guessed = myWords.has(word);
            return (
              <span key={i}>
                <span
                  className={`word word--length-${word.length} word--word-${word.toLowerCase()} ${guessed ? `word--guessed word--times-guessed-${count}` : 'word--not-guessed'}`}
                >
                  {word}
                </span>{' '}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
