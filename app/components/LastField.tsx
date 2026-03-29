const lastField = [
  ['E', 'W', 'T', 'E'],
  ['A', 'I', 'E', 'H'],
  ['T', 'M', 'E', 'M'],
  ['R', 'I', 'G', 'B'],
];

const stats = { points: 105, words: 26 };

const words = [
  { word: 'AMT', length: 3, timesGuessed: 3 },
  { word: 'AMA', length: 3, timesGuessed: 0 },
  { word: 'ATMET', length: 5, timesGuessed: 1 },
  { word: 'ATME', length: 4, timesGuessed: 2 },
  { word: 'ATMETE', length: 6, timesGuessed: 0 },
  { word: 'BEET', length: 4, timesGuessed: 0 },
  { word: 'BIE', length: 3, timesGuessed: 0 },
  { word: 'BEIM', length: 4, timesGuessed: 2 },
  { word: 'BEITE', length: 5, timesGuessed: 0 },
  { word: 'BEI', length: 3, timesGuessed: 1 },
  { word: 'BEIS', length: 4, timesGuessed: 0 },
  { word: 'EHE', length: 3, timesGuessed: 3 },
  { word: 'EHR', length: 3, timesGuessed: 0 },
  { word: 'EITRIGE', length: 7, timesGuessed: 0 },
  { word: 'EIA', length: 3, timesGuessed: 0 },
  { word: 'EMIR', length: 4, timesGuessed: 0 },
  { word: 'EWE', length: 3, timesGuessed: 1 },
  { word: 'GEHE', length: 4, timesGuessed: 0 },
  { word: 'GEHEIM', length: 6, timesGuessed: 1 },
  { word: 'GEHT', length: 4, timesGuessed: 2 },
  { word: 'GEI', length: 3, timesGuessed: 0 },
  { word: 'GEIE', length: 4, timesGuessed: 0 },
  { word: 'GEIT', length: 4, timesGuessed: 0 },
  { word: 'GEITE', length: 5, timesGuessed: 0 },
  { word: 'GEHEN', length: 5, timesGuessed: 0 },
  { word: 'GEHET', length: 5, timesGuessed: 0 },
  { word: 'HEI', length: 3, timesGuessed: 2 },
  { word: 'HEIM', length: 4, timesGuessed: 3 },
  { word: 'HEIMAT', length: 6, timesGuessed: 0 },
  { word: 'HEIME', length: 5, timesGuessed: 1 },
  { word: 'HEIA', length: 4, timesGuessed: 0 },
  { word: 'HEG', length: 3, timesGuessed: 0 },
  { word: 'ITEM', length: 4, timesGuessed: 0 },
  { word: 'MATE', length: 4, timesGuessed: 0 },
  { word: 'METE', length: 4, timesGuessed: 0 },
  { word: 'MIETE', length: 5, timesGuessed: 2 },
  { word: 'MIR', length: 3, timesGuessed: 1 },
  { word: 'MIET', length: 4, timesGuessed: 1 },
  { word: 'RIEB', length: 4, timesGuessed: 0 },
  { word: 'RITA', length: 4, timesGuessed: 0 },
  { word: 'REIM', length: 4, timesGuessed: 1 },
  { word: 'TEMA', length: 4, timesGuessed: 0 },
  { word: 'TIME', length: 4, timesGuessed: 0 },
  { word: 'TIMER', length: 5, timesGuessed: 0 },
  { word: 'TRIEB', length: 5, timesGuessed: 0 },
  { word: 'WEIT', length: 4, timesGuessed: 2 },
  { word: 'WEITE', length: 5, timesGuessed: 1 },
  { word: 'WEM', length: 3, timesGuessed: 1 },
  { word: 'WEHE', length: 4, timesGuessed: 0 },
  { word: 'WEHTE', length: 5, timesGuessed: 0 },
  { word: 'WEHTEM', length: 6, timesGuessed: 0 },
  { word: 'WIE', length: 3, timesGuessed: 2 },
  { word: 'WEG', length: 3, timesGuessed: 0 },
];

export default function LastField() {
  return (
    <div>
      <div className="panel panel-default last-round">
        <div className="panel-heading">
          <table className="field">
            <tbody>
              {lastField.map((row, y) => (
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
              {stats.points} Punkte<br />
              {stats.words} Wörter
            </small>
          </div>
        </div>
        <div className="panel-body">
          {words.map((word, i) => (
            <span key={i}>
              <span
                className={`word word--length-${word.length} word--word-${word.word.toLowerCase()} ${word.timesGuessed ? `word--guessed word--times-guessed-${word.timesGuessed}` : 'word--not-guessed'}`}
              >
                {word.word}
              </span>{' '}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
