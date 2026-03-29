const field = [
  ['D', 'F', 'L', 'S'],
  ['U', 'D', 'N', 'R'],
  ['U', 'N', 'I', 'E'],
  ['U', 'E', 'E', 'E'],
];

export default function CurrentField() {
  return (
    <div className="current-field">
      <div className="field-container" unselectable="on">
        <table className="field">
          <tbody>
            {field.map((row, y) => (
              <tr key={y}>
                {row.map((cell, x) => (
                  <td key={x} className={`cell cell--${x}-${y}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="giant-tick visible-xs-block visible-sm-block hidden-md hidden-lg">✓</div>
        <div className="giant-cross visible-xs-block visible-sm-block hidden-md hidden-lg">✗</div>

        <canvas></canvas>
      </div>

      <form className="input-area hidden-xs hidden-sm">
        <input type="text" className="input form-control" id="word-input" />
        <label htmlFor="word-input">1:29</label>
      </form>
    </div>
  );
}
