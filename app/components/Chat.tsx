const messages = [
  { user: 'Axiom', text: 'halsend ftrs' },
  { user: 'chipai', text: 'hi joly' },
  { user: 'Wortklauberin', text: 'wach bin ich auch nicht mehr, noch eins, dann ab in die falle!' },
  { user: 'Hurz', text: 'Hi Amy' },
  { user: 'Grobi', text: 'miv joly' },
  { user: 'HerrSchwarz', text: 'Hi Joly' },
  { user: 'Axiom', text: 'hi chips, peke, grob, klaubi' },
  { user: 'HerrSchwarz', text: 'ciao ihr wachen' },
  { user: 'Axiom', text: 'cu klaubi' },
  { user: 'Hurz', text: 'Ciao Eli' },
  { user: 'HerrSchwarz', text: 'GNB' },
];

export default function Chat() {
  return (
    <>
      <div className="visible-xs-block visible-sm-block hidden-md hidden-lg">
        <h2 className="pause-timer">Bitte warten - 1:29</h2>
      </div>

      <div className="chat panel panel-default hidden-xs hidden-sm">
        <div className="panel-body chat-content">
          {messages.map((msg, i) => (
            <div key={i}><strong>{msg.user}</strong>: {msg.text}</div>
          ))}
        </div>
        <div className="panel-footer">
          <div className="input-group input-group-sm">
            <span className="input-group-addon">Gast 2598887</span>
            <input type="text" className="form-control chat-input" id="chat-input" placeholder="Chat" />
            <label htmlFor="chat-input">1:29</label>
          </div>
        </div>
      </div>

      <span id="translation-guest-prefix" style={{ display: 'none' }}>Gast </span>
    </>
  );
}
