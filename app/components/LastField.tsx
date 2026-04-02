import { useState } from "react";
import { useGameStore } from "../stores/gameStore.js";
import { fieldToGrid, fieldContains, type Cell } from "../../lib/fieldContains.js";

export default function LastField() {
  const lastRound = useGameStore((s) => s.lastRound);
  const myUserId = useGameStore((s) => s.myUserId);
  const hoveredUserId = useGameStore((s) => s.hoveredUserId);
  const setHoveredWordGuessedBy = useGameStore((s) => s.setHoveredWordGuessedBy);

  const [hoveredChain, setHoveredChain] = useState<Cell[] | null>(null);

  if (!lastRound) return null;

  const size = lastRound.size;
  const grid = fieldToGrid(lastRound.field, size);
  const { players, words } = lastRound.results;

  const myStats = players.find((p) => p.userId === myUserId);

  const chainIndexMap = new Map<string, number>();
  if (hoveredChain) {
    hoveredChain.forEach((cell, i) => chainIndexMap.set(`${cell.x},${cell.y}`, i));
  }

  return (
    <div>
      <div className="panel panel-default last-round">
        <div className="panel-heading">
          <table className="field">
            <tbody>
              {grid.map((row, y) => (
                <tr key={y}>
                  {row.map((cell, x) => {
                    const chainIndex = chainIndexMap.get(`${x},${y}`);
                    const bg = chainIndex !== undefined
                      ? `rgba(0,0,0,${(0.5 - 0.4 / hoveredChain!.length * chainIndex).toFixed(2)})`
                      : undefined;
                    return (
                      <td key={x} className={`cell cell--${x}-${y}`} style={bg ? { background: bg } : undefined}>
                        {cell}
                      </td>
                    );
                  })}
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
          {words.map((word, i) => {
            const guessedBy = word.guessedBy ?? [];
            const guessedByMe = myUserId !== null && guessedBy.includes(myUserId);
            const count = guessedBy.length;
            const isHighlighted = hoveredUserId !== null && guessedBy.includes(hoveredUserId);
            return (
              <span key={i}>
                <span
                  className={`word word--length-${word.word.length} word--word-${word.word.toLowerCase()} ${guessedByMe ? `word--guessed word--times-guessed-${count}` : 'word--not-guessed'}${isHighlighted ? ' word--highlight' : ''}`}
                  title={word.description ?? undefined}
                  onMouseEnter={() => {
                    setHoveredWordGuessedBy(guessedBy);
                    setHoveredChain(fieldContains(grid, word.word));
                  }}
                  onMouseLeave={() => {
                    setHoveredWordGuessedBy(null);
                    setHoveredChain(null);
                  }}
                >
                  {word.word.toUpperCase()}
                </span>{' '}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
