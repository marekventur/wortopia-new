import type { Route } from "./+types/regeln";
import Nav from "../components/Nav";
import { getOrCreateSession } from "../../lib/session.js";

export async function loader({ request }: Route.LoaderArgs) {
  const { session, cookieHeader } = await getOrCreateSession(request);
  if (cookieHeader) {
    return Response.json({ session }, { headers: { "Set-Cookie": cookieHeader } });
  }
  return { session };
}

export default function Regeln({ loaderData }: Route.ComponentProps) {
  const { session } = loaderData;
  return (
    <>
      <Nav session={session} />
      <div className="container" style={{ marginTop: 30, maxWidth: 720 }}>
        <h2>Regeln</h2>
        <img src="/img/rules-example.png" alt="" style={{ marginBottom: 16 }} />
        <p>Wortopia ist ganz einfach:</p>
        <p>Ziel ist es, innerhalb einer 3-minütigen Runde so viele Wörter wie möglich mit den Buchstaben auf dem Spielfeld zu bilden. Dabei müssen die Buchstaben der Wörter zusammenhängen und kein Buchstabe darf doppelt verwendet werden.</p>
        <p>Auf diesem Feld ist zum Beispiel ein „REH" zu finden. Auch „REHE", „WER", „NUR", „RUNE" oder „WEDER" sind Wörter, die akzeptiert werden.</p>
        <p>„UHR" hingegen ist falsch, da die Buchstaben zwar zusammenhängen, jedoch nicht in der richtigen Reihenfolge stehen.</p>
        <p>Du kannst die Wörter entweder in das Textfeld unter dem Spielfeld eingeben oder mit der Maus die einzelnen Buchstaben zusammenklicken. Bestätigen kannst du das Wort mit Enter bzw. einem Doppelklick. Danach kannst du direkt weiter raten. Auf der rechten Seite siehst du, ob dein Wort akzeptiert wurde und – wenn ja – wie viele Punkte du dafür bekommen hast:</p>
        <p>
          3 Buchstaben = 1 Punkt (nur auf dem 4×4-Spielfeld)<br />
          4 Buchstaben = 1 Punkt<br />
          5 Buchstaben = 2 Punkte<br />
          6 Buchstaben = 3 Punkte<br />
          7 Buchstaben = 5 Punkte<br />
          mehr als 7 Buchstaben = 11 Punkte
        </p>
        <p>Nach 3 Minuten ist die Runde vorbei und du kannst deine erreichten Punkte mit denen deiner Mitspieler vergleichen. Du siehst dort dann auch, welche Wörter du nicht gefunden hast.</p>
        <p>Ein neues Feld erscheint und eine neue Runde beginnt – viel Spaß beim Spielen!</p>

        <hr />
        <h3>Wortrichtlinien</h3>
        <p>Die Wortliste wird von <a href="https://spielwoerter.de" target="_blank" rel="noopener noreferrer">spielwoerter.de</a> bezogen und regelmäßig aktualisiert.</p>
        <ul>
          <li>Die Umlaute Ä, Ö und Ü sowie das Eszett (ß) werden nicht akzeptiert – stattdessen finden sie als AE, OE, UE sowie SS Verwendung.</li>
          <li>Verben, Hauptwörter und Adjektive werden in all ihren gebeugten Formen anerkannt.</li>
          <li>Abkürzungen (z. B. „BGH", „FCKW") werden nicht akzeptiert.</li>
          <li>Kurzwörter wie „Deo", „Kripo" oder „Web" werden akzeptiert.</li>
          <li>Geographische Bezeichnungen, Eigennamen sowie Vor- und Familiennamen werden nicht akzeptiert.</li>
        </ul>
      </div>
    </>
  );
}
