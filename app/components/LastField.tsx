import { useState } from "react";
import { useGameStore } from "../stores/gameStore.js";
import { usePinnableTooltip } from "../hooks/usePinnableTooltip.js";
import { sendProposal } from "../hooks/sendProposal.js";
import { fieldToGrid, fieldContains, type Cell } from "../../lib/fieldContains.js";
import type { WordDetail } from "lib/gameTypes.js";

export default function LastField() {
  const lastRound = useGameStore((s) => s.lastRound);
  const myUserId = useGameStore((s) => s.myUserId);
  const hoveredUserId = useGameStore((s) => s.hoveredUserId);
  const setHoveredWordGuessedBy = useGameStore((s) => s.setHoveredWordGuessedBy);

  const [hoveredChain, setHoveredChain] = useState<Cell[] | null>(null);
  const { tooltipPinned, isLoggedIn, proposedWords,
          handleMouseEnter, handleMouseLeave, handleClick, close, renderTooltip } =
    usePinnableTooltip<WordDetail>();

  if (!lastRound) return null;

  const size = lastRound.size;
  const grid = fieldToGrid(lastRound.field, size);
  const { words } = lastRound.results;
  const totalWords = words.length;
  const totalPoints = words.reduce((sum, w) => sum + w.points, 0);

  const chainIndexMap = new Map<string, number>();
  if (hoveredChain) {
    hoveredChain.forEach((cell, i) => chainIndexMap.set(`${cell.x},${cell.y}`, i));
  }

  const onMouseEnter = (i: number, word: WordDetail, guessedBy: number[]) => {
    setHoveredWordGuessedBy(guessedBy);
    setHoveredChain(fieldContains(grid, word.word));
    handleMouseEnter(`lrw-${i}`, word);
  };

  const onMouseLeave = () => {
    setHoveredWordGuessedBy(null);
    setHoveredChain(null);
    handleMouseLeave();
  };

  return (
    <div>
      <div className={`panel panel-default last-round size-${size}`}>
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
              {totalPoints} Punkte<br />{totalWords} Wörter
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
                  id={`lrw-${i}`}
                  className={`word word--length-${word.word.length} word--word-${word.word.toLowerCase()} ${guessedByMe ? `word--guessed word--times-guessed-${count}` : 'word--not-guessed'}${isHighlighted ? ' word--highlight' : ''}${word.description ? ' word--has-description' : ''}`}
                  onMouseEnter={() => onMouseEnter(i, word, guessedBy)}
                  onMouseLeave={onMouseLeave}
                  style={{ cursor: isLoggedIn ? 'pointer' : 'default' }}
                  onClick={() => handleClick(`lrw-${i}`, word)}
                >
                  {word.word.toUpperCase()}
                </span>{' '}
              </span>
            );
          })}
        </div>
      </div>

      {renderTooltip((word) => (
        <>
          <div>
            {word.description
              ? <>
                {word.description}
                {tooltipPinned && isLoggedIn && !proposedWords.has(word.word.toLowerCase()) && <button
                  className="word-tooltip-pencil-button"
                  onClick={() => {
                    const desc = window.prompt(
                      `Beschreibung für ${word.word.toUpperCase()} bearbeiten:`,
                      word.description ?? "",
                    );
                    if (desc !== null) { sendProposal("update", word.word, desc); close(); }
                  }}
                >
                  <span className="glyphicon glyphicon-pencil"></span>
                </button>}
              </>
              : tooltipPinned && isLoggedIn && !proposedWords.has(word.word.toLowerCase())
                ? <button
                    className="word-tooltip-add-description-button"
                    onClick={() => {
                      const desc = window.prompt(
                        `Beschreibung für ${word.word.toUpperCase()} hinzufügen:`,
                      );
                      if (desc !== null) { sendProposal("update", word.word, desc); close(); }
                    }}
                  >
                    Beschreibung hinzufügen <span className="glyphicon glyphicon-pencil"></span>
                  </button>
                : null}
            {tooltipPinned && isLoggedIn && !proposedWords.has(word.word.toLowerCase()) && (
              <button
                className="word-tooltip-delete-button"
                onClick={() => {
                  if (window.confirm(`"${word.word.toUpperCase()}" aus der Wortliste entfernen vorschlagen?`)) {
                    sendProposal("remove", word.word); close();
                  }
                }}
              >
                <span className="glyphicon glyphicon-trash"></span>
              </button>
            )}
          </div>
        </>
      ))}
    </div>
  );
}
