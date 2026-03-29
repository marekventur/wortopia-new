import { useState, useRef, useEffect, useCallback } from 'react';

// TODO: Replace with field + size from game context
const MOCK_FIELD: string[][] = [
  ['J', 'E', 'I', 'E'],
  ['E', 'E', 'C', 'G'],
  ['D', 'I', 'I', 'O'],
  ['D', 'G', 'H', 'A'],
];

const DIMENSION = 280;

type Cell = { x: number; y: number };

/**
 * Ported from FieldFactory.js
 * Searches the field for a connected chain of cells that spells the given word.
 * Returns the chain if found, null otherwise.
 */
function fieldContains(field: string[][], word: string): Cell[] | null {
  const lower = word.toLowerCase();
  const size = field.length;

  function cloneField(f: (string | null)[][]): (string | null)[][] {
    return f.map(row => [...row]);
  }

  function recurse(
    f: (string | null)[][],
    pos: number,
    x: number,
    y: number,
    chain: Cell[],
  ): Cell[] | null {
    if (f[y][x] !== lower[pos]) return null;
    const next = [...chain, { x, y }];
    if (pos === lower.length - 1) return next;
    const cloned = cloneField(f);
    cloned[y][x] = null;
    for (let ny = y - 1; ny <= y + 1; ny++) {
      for (let nx = x - 1; nx <= x + 1; nx++) {
        if (nx >= 0 && ny >= 0 && nx < size && ny < size && (nx !== x || ny !== y)) {
          const result = recurse(cloned, pos + 1, nx, ny, next);
          if (result) return result;
        }
      }
    }
    return null;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const result = recurse(field as (string | null)[][], 0, x, y, []);
      if (result) return result;
    }
  }
  return null;
}

export default function CurrentField() {
  // TODO: read field and size from game context
  const field = MOCK_FIELD;
  const size = field.length;
  const cellDimension = DIMENSION / size;

  const [chain, setChain] = useState<Cell[]>([]);
  const [wordEntered, setWordEntered] = useState('');
  const [wordEnteredClass, setWordEnteredClass] = useState('');
  const [tickHighlight, setTickHighlight] = useState(false);
  const [crossHighlight, setCrossHighlight] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chainRef = useRef<Cell[]>([]);
  const leftButtonDownRef = useRef(false);
  const startSwipingFieldRef = useRef<Cell | null>(null);
  const scaleRef = useRef(1); // TODO: read from userOptions.boardScale

  // --- Canvas drawing ---

  const drawChain = useCallback(
    (c: Cell[], drawToPoint?: { x: number; y: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, DIMENSION, DIMENSION);
      ctx.beginPath();
      ctx.strokeStyle = '#888';
      ctx.lineWidth = 2;

      const radius = cellDimension * 0.4;
      let first = true;
      for (const el of c) {
        const x = Math.round((el.x + 0.5) * cellDimension);
        const y = Math.round((el.y + 0.5) * cellDimension);
        if (first) { ctx.moveTo(x, y); first = false; }
        else { ctx.lineTo(x, y); }
      }
      if (drawToPoint) ctx.lineTo(drawToPoint.x, drawToPoint.y);
      ctx.stroke();

      for (const el of c) {
        const x = Math.round((el.x + 0.5) * cellDimension);
        const y = Math.round((el.y + 0.5) * cellDimension);

        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
        ctx.fill();
        ctx.restore();

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
        ctx.stroke();
      }
    },
    [cellDimension],
  );

  // --- Chain management ---

  const updateChain = useCallback((c: Cell[]) => {
    chainRef.current = c;
    setChain([...c]);
  }, []);

  const clearChain = useCallback(() => {
    setWordEntered('');
    setWordEnteredClass('');
    updateChain([]);
    drawChain([]);
  }, [updateChain, drawChain]);

  const submitWord = useCallback(
    (word: string, guessingMethod: string) => {
      // TODO: game.setLastGuessingMethod(guessingMethod)
      // TODO: game.guess(word)
      console.log('TODO: submit word', word, 'via', guessingMethod);
      setWordEntered('');
      setWordEnteredClass('');
      updateChain([]);
      drawChain([]);
    },
    [updateChain, drawChain],
  );

  /** Returns 'a' (added), 'd' (duplicate/submit), or 'i' (invalid/non-adjacent) */
  const addCellToChain = useCallback(
    (x: number, y: number): 'a' | 'd' | 'i' => {
      const current = chainRef.current;
      if (current.length > 0) {
        const last = current[current.length - 1];
        if (Math.abs(last.x - x) > 1 || Math.abs(last.y - y) > 1) {
          chainRef.current = [];
          setChain([]);
          drawChain([]);
          return 'i';
        }
      }
      if (!current.find(el => el.x === x && el.y === y)) {
        const next = [...current, { x, y }];
        chainRef.current = next;
        setChain([...next]);
        return 'a';
      }
      return 'd';
    },
    [drawChain],
  );

  const submitChain = useCallback(
    (guessingMethod: string) => {
      const word = chainRef.current.map(el => field[el.y][el.x]).join('');
      if (word.length > 2) {
        submitWord(word, guessingMethod);
      } else {
        clearChain();
      }
    },
    [field, submitWord, clearChain],
  );

  // --- Swipe logic (shared by mouse and touch) ---

  const swipeStart = useCallback(
    (posX: number, posY: number, guessingMethod: string) => {
      const x = Math.floor(posX / cellDimension);
      const y = Math.floor(posY / cellDimension);
      const result = addCellToChain(x, y);
      if (result === 'a') {
        startSwipingFieldRef.current = { x, y };
        drawChain(chainRef.current);
      } else if (result === 'd') {
        submitChain(guessingMethod + 'Single');
      }
    },
    [cellDimension, addCellToChain, drawChain, submitChain],
  );

  const swipeMove = useCallback(
    (posX: number, posY: number, tolerance = 0.4) => {
      const x = Math.floor(posX / cellDimension);
      const y = Math.floor(posY / cellDimension);
      const start = startSwipingFieldRef.current;
      if (start && (x !== start.x || y !== start.y)) {
        const centerX = (x + 0.5) * cellDimension;
        const centerY = (y + 0.5) * cellDimension;
        const dist = Math.sqrt((posX - centerX) ** 2 + (posY - centerY) ** 2);
        if (dist < tolerance * cellDimension) {
          const result = addCellToChain(x, y);
          if (result === 'a') {
            drawChain(chainRef.current);
            return;
          }
        }
        drawChain(chainRef.current, { x: posX, y: posY });
      }
    },
    [cellDimension, addCellToChain, drawChain],
  );

  const swipeEnd = useCallback(
    (posX: number, posY: number, guessingMethod: string) => {
      const x = Math.floor(posX / cellDimension);
      const y = Math.floor(posY / cellDimension);
      const start = startSwipingFieldRef.current;
      if (start && (x !== start.x || y !== start.y)) {
        submitChain(guessingMethod + 'Swipe');
      }
      startSwipingFieldRef.current = null;
    },
    [cellDimension, submitChain],
  );

  // --- Touch events (non-passive to allow preventDefault) ---

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e: TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const touch = e.touches[0];
      swipeStart(
        (touch.clientX - rect.left) / scaleRef.current,
        (touch.clientY - rect.top) / scaleRef.current,
        'touch',
      );
      e.stopPropagation();
      e.preventDefault();
    };
    const onTouchMove = (e: TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const touch = e.touches[0];
      swipeMove(
        (touch.clientX - rect.left) / scaleRef.current,
        (touch.clientY - rect.top) / scaleRef.current,
      );
      e.stopPropagation();
      e.preventDefault();
    };
    const onTouchEnd = (e: TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const touch = e.changedTouches[e.changedTouches.length - 1];
      swipeEnd(
        (touch.clientX - rect.left) / scaleRef.current,
        (touch.clientY - rect.top) / scaleRef.current,
        'touch',
      );
      e.stopPropagation();
      e.preventDefault();
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, [swipeStart, swipeMove, swipeEnd]);

  // --- Game event subscriptions ---
  // TODO: wire up to game context when data layer is ready
  // game.on('guessCorrect', () => { setTickHighlight(true); setTimeout(() => setTickHighlight(false), 600); });
  // game.on('guessIncorrect', () => { setCrossHighlight(true); setTimeout(() => setCrossHighlight(false), 600); });
  // game.on('gamePaused', () => { clearChain(); if (inputRef.current focused) re-focus on gameOngoing });

  // --- Mouse event handlers ---

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    leftButtonDownRef.current = true;
    swipeStart(e.nativeEvent.offsetX, e.nativeEvent.offsetY, 'mouse');
    e.stopPropagation();
    e.preventDefault();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!leftButtonDownRef.current) return;
    swipeMove(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
    e.stopPropagation();
    e.preventDefault();
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    leftButtonDownRef.current = false;
    swipeEnd(e.nativeEvent.offsetX, e.nativeEvent.offsetY, 'mouse');
    e.stopPropagation();
    e.preventDefault();
  };

  // --- Keyboard input ---

  const handleTypeWord = (word: string) => {
    setWordEntered(word);
    if (word === '') {
      updateChain([]);
      drawChain([]);
    } else {
      // TODO: field comes from game context; using MOCK_FIELD for now
      const newChain = fieldContains(field, word);
      if (newChain) {
        chainRef.current = newChain;
        setChain([...newChain]);
        setWordEnteredClass('');
        drawChain(newChain);
      } else {
        setWordEnteredClass('has-error');
        updateChain([]);
        drawChain([]);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (wordEntered) submitWord(wordEntered, 'keyboard');
  };

  const isPartOfChain = (x: number, y: number) =>
    chain.some(el => el.x === x && el.y === y);

  // TODO: getContainerStyle() for board scaling from userOptions
  const containerStyle = {};

  return (
    <div className="current-field">
      <div className="field-container" style={containerStyle}>
        <table className="field">
          <tbody>
            {field.map((row, y) => (
              <tr key={y}>
                {row.map((cell, x) => (
                  <td
                    key={x}
                    className={`cell cell--${x}-${y}${isPartOfChain(x, y) ? ' cell--selected' : ''}`}
                  >
                    {cell.toUpperCase()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <div className={`giant-tick visible-xs-block visible-sm-block hidden-md hidden-lg${tickHighlight ? ' highlight' : ''}`}>✓</div>
        <div className={`giant-cross visible-xs-block visible-sm-block hidden-md hidden-lg${crossHighlight ? ' highlight' : ''}`}>✗</div>

        <canvas
          ref={canvasRef}
          width={DIMENSION}
          height={DIMENSION}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        />
      </div>

      <form
        className={`input-area hidden-xs hidden-sm${wordEnteredClass ? ` ${wordEnteredClass}` : ''}`}
        onSubmit={handleSubmit}
      >
        <input
          ref={inputRef}
          type="text"
          className="input form-control"
          id="word-input"
          value={wordEntered}
          onChange={e => handleTypeWord(e.target.value)}
        />
        <label htmlFor="word-input">2:04</label>
      </form>
    </div>
  );
}
