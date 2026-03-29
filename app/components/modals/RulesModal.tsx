import Modal from "./Modal";
import { useModalStore } from "../../stores/modalStore";

export default function RulesModal() {
  const { closeModal } = useModalStore();
  return (
    <Modal id="rules" size="lg">
      <div className="modal-content">
        <div className="modal-header">
          <button type="button" className="close" onClick={closeModal} aria-hidden="true">&times;</button>
          <h4 className="modal-title">Regeln</h4>
        </div>
        <div className="modal-body">
          <img src="/img/rules-example.png" alt="" />
          <div>
            <p>Wortopia ist ganz einfach:</p>
            <p>Ziel ist es, innerhalb einer 3-minütigen Runde so viele Wörter wie nur möglich mit den Buchstaben auf dem Spielfeld zu bilden. Dabei müssen die Buchstaben der Wörter zusammenhängen und kein Buchstabe darf doppelt verwendet werden.</p>
            <p>Auf diesem Feld ist zum Beispiel ein "REH" zu finden. Auch "REHE", "WER", "NUR", "RUNE" oder "WEDER" sind Wörter, die akzeptiert werden.</p>
            <p>"UHR" dahingegen ist falsch, da die Buchstaben zwar zusammenhängen, jedoch nicht in der richtigen Reihenfolge stehen.</p>
            <p>Du kannst die Wörter entweder in das Textfeld unter dem Spielfeld eingeben oder mit der Maus die einzenlnen Buchstaben zusammenklicken. Bestätigen kannst du das Wort mit Enter bzw. einem Doppelklick. Danach kannst du direkt weiter raten. Auf der rechten Seite siehst du, ob dein Wort akzeptiert wurde und -wenn ja- wieviele Punkte du dafür bekommen hast:</p>
            <p>3 Buchstaben = 1 Punkt (nur auf dem 4x4-Spielfeld) <br />4 Buchstaben = 1 Punkt <br />5 Buchstaben = 2 Punkt <br />6 Buchstaben = 3 Punkt <br />7 Buchstaben = 5 Punkt <br />mehr als 7 Buchstaben = 11 Punkt</p>
            <p>Nach 3 Minuten ist die Runde vorbei und du kannst deine erreichten Punkte mit denen deiner Mitspieler vergleichen. Du siehst dort dann auch, welche Wörter du nicht erraten hast.</p>
            <p>Ein neues Feld erscheint und eine neue Runde beginnt - Viel Spaß beim Spielen!</p>
          </div>
          <hr />
          <h4>Wortrichtlinien</h4>
          <div>
            <ul>
              <li>In Wortopia gelten (fast) alle Wörter, die in einem der folgenden Duden zu finden sind:
                <ul>
                  <li>Duden - Die deutsche Rechtschreibung</li>
                  <li>Duden - Deutsches Universalwörterbuch</li>
                  <li>Duden - Das Fremdwörterbuch</li>
                  <li>Duden - Das große Fremdwörterbuch</li>
                </ul>
              </li>
              <li>Wir versuchen, die jeweils aktuellsten Ausgaben zu berücksichtigen, dabei bleiben aber auch alle Wörter gültig, die in einem älteren der o. a. Duden-Bücher aufgeführt wurden.</li>
              <li>Die Umlaute Ä, Ö und Ü sowie das Eszett (ß) werden nicht akzeptiert, stattdessen finden sie als AE, OE und UE sowie SS Verwendung.</li>
              <li>Verben, Hauptwörter und Adjektive werden in all ihren gebeugten Formen anerkannt.</li>
              <li>Wörter, die in allen o. a. Duden-Büchern als Abkürzungen verzeichnet sind (z. B. "BGH", "FCKW"), werden nicht akzeptiert.</li>
              <li>Kurzwörter wie "Deo", "Kripo" oder "Web" werden akzeptiert.</li>
              <li>Geographische Bezeichnungen, Eigennamen sowie Vor- und Familiennamen werden nicht akzeptiert.</li>
            </ul>
          </div>
        </div>
      </div>
    </Modal>
  );
}
