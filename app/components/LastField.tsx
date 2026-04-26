import { useState, useRef, useEffect } from "react";
import { Tooltip } from "react-tooltip";
import type { TooltipRefProps } from "react-tooltip";
import { useGameStore } from "../stores/gameStore.js";
import type { ProposalAction } from "../../lib/proposalTypes.js";
import { fieldToGrid, fieldContains, type Cell } from "../../lib/fieldContains.js";
import type { WordDetail } from "lib/gameTypes.js";

export default function LastField() {
  const lastRound = useGameStore((s) => s.lastRound);
  const myUserId = useGameStore((s) => s.myUserId);
  const hoveredUserId = useGameStore((s) => s.hoveredUserId);
  const setHoveredWordGuessedBy = useGameStore((s) => s.setHoveredWordGuessedBy);

  const isLoggedIn = myUserId !== null && myUserId > 0;

  const [hoveredChain, setHoveredChain] = useState<Cell[] | null>(null);
  const [tooltipWord, setTooltipWord] = useState<WordDetail | null>(null);
  const [tooltipPinned, setTooltipPinned] = useState(false);
  const tooltipRef = useRef<TooltipRefProps | null>(null);

  // Close pinned tooltip on outside click
  useEffect(() => {
    if (!tooltipPinned) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest(".word") && !target.closest(".react-tooltip")) {
        tooltipRef.current?.close();
        setTooltipWord(null);
        setTooltipPinned(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tooltipPinned]);

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

  const handleMouseEnter = (i: number, word: typeof words[number], guessedBy: number[]) => {
    setHoveredWordGuessedBy(guessedBy);
    setHoveredChain(fieldContains(grid, word.word));
    if (!tooltipPinned && word.description) {
      setTooltipWord(word);
      tooltipRef.current?.open({ anchorSelect: `#lrw-${i}` });
    }
  };

  const handleMouseLeave = (i: number) => {
    setHoveredWordGuessedBy(null);
    setHoveredChain(null);
    if (tooltipPinned) return;
    tooltipRef.current?.close();
    setTooltipWord(null);
  };

  const sendProposal = (word: string, action: ProposalAction, description?: string) => {
    useGameStore.getState()._send?.(
      JSON.stringify({ type: "propose_word", action, word: word.toLowerCase(), description }),
    );
  };

  const handleClick = (i: number, word: typeof words[number]) => {
    if (!isLoggedIn) return;
    if (tooltipPinned && tooltipWord?.word === word.word) {
      // Unpin
      tooltipRef.current?.close();
      setTooltipWord(null);
      setTooltipPinned(false);
    } else {
      setTooltipWord(word);
      setTooltipPinned(true);
      tooltipRef.current?.open({ anchorSelect: `#lrw-${i}` });
    }
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
                  onMouseEnter={() => handleMouseEnter(i, word, guessedBy)}
                  onMouseLeave={() => handleMouseLeave(i)}
                  style={{ cursor: isLoggedIn ? 'pointer' : 'default' }}
                  onClick={() => handleClick(i, word)}
                >
                  {word.word.toUpperCase()}
                </span>{' '}
              </span>
            );
          })}
        </div>
      </div>

      <Tooltip
        ref={tooltipRef}
        className="last-round-word-tooltip"
        clickable
        opacity={tooltipPinned ? 1 : 0.85}
        style={{ maxWidth: 300, fontSize: 13 }}
        isOpen={tooltipPinned || tooltipWord !== null}
        render={() =>
          tooltipWord ? (
            <>
              <div>
                {tooltipWord.description
                  ? <>
                    {tooltipWord.description}
                    {tooltipPinned && isLoggedIn && <button
                      className="last-round-word-tooltip-pencil-button"
                      onClick={() => {
                        const desc = window.prompt(
                          `Beschreibung für ${tooltipWord.word.toUpperCase()} bearbeiten:`,
                          tooltipWord.description ?? "",
                        );
                        if (desc !== null) sendProposal(tooltipWord.word, "update", desc);
                      }}
                    >
                      <span className="glyphicon glyphicon-pencil"></span>
                    </button>}
                  </>
                : tooltipPinned && isLoggedIn
                  ? <button
                      className="last-round-word-tooltip-add-description-button"
                      onClick={() => {
                        const desc = window.prompt(
                          `Beschreibung für ${tooltipWord.word.toUpperCase()} hinzufügen:`,
                        );
                        if (desc !== null) sendProposal(tooltipWord.word, "update", desc);
                      }}
                    >
                      Beschreibung hinzufügen <span className="glyphicon glyphicon-pencil"></span>
                    </button>
                  : null}
                  {tooltipPinned && isLoggedIn && <button
                    className="last-round-word-tooltip-delete-button"
                    onClick={() => {
                      if (window.confirm(`"${tooltipWord.word.toUpperCase()}" aus der Wortliste entfernen vorschlagen?`)) {
                        sendProposal(tooltipWord.word, "remove");
                      }
                    }}
                  >
                    <span className="glyphicon glyphicon-trash"></span>
                  </button>}
                </div>
              </>
          ) : null
        }
      />
    </div>
  );
}
