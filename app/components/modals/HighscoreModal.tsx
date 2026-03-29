import Modal from "./Modal";
import { useModalStore } from "../../stores/modalStore";

const highscores = [
  { id: 1, name: 'Axiom', count: 245, avg: 0.82, avgWords: 8.5 },
  { id: 2, name: 'Grobi', count: 189, avg: 0.79, avgWords: 7.2 },
  { id: 3, name: 'Lüwerb75', count: 312, avg: 0.77, avgWords: 6.9 },
  { id: 4, name: 'BarbII', count: 156, avg: 0.75, avgWords: 6.5 },
  { id: 5, name: 'HerrSchwarz', count: 98, avg: 0.73, avgWords: 6.1 },
  { id: 6, name: 'Wortklauberin', count: 87, avg: 0.71, avgWords: 5.8 },
  { id: 7, name: 'Hurz', count: 203, avg: 0.69, avgWords: 5.5 },
  { id: 8, name: 'chipai', count: 44, avg: 0.65, avgWords: 4.9 },
];

export default function HighscoreModal() {
  const { closeModal } = useModalStore();
  return (
    <Modal id="highscore" size="lg">
      <div className="modal-content modal--highscores">
        <div className="modal-header">
          <button type="button" className="close" onClick={closeModal} aria-hidden="true">&times;</button>
          <h4 className="modal-title">Rangliste</h4>
        </div>
        <div className="modal-body">
          <div className="input-group interval-select">
            <select className="form-control" defaultValue="30">
              <option value="1">letzten 24 Stunden</option>
              <option value="7">letzten 7 Tage</option>
              <option value="30">letzten 30 Tage</option>
              <option value="60">letzten 60 Tage</option>
              <option value="90">letzten 90 Tage</option>
              <option value="180">letzten 180 Tage</option>
              <option value="365">letzten 365 Tage</option>
            </select>
          </div>
          <p>Rangliste der 100 besten Spieler/innen in dem gewählten Zeitraum</p>
          <table className="table table-condensed">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Spiele</th>
                <th>Ergebnis</th>
                <th>Wörtern pro Runde</th>
              </tr>
            </thead>
            <tbody>
              {highscores.map((result, i) => (
                <tr key={result.id}>
                  <td>{i + 1}</td>
                  <td>{result.name}</td>
                  <td>{result.count}</td>
                  <td>{Math.round(result.avg * 100)}%</td>
                  <td>{result.avgWords.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
