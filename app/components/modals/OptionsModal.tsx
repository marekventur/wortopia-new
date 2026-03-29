export default function OptionsModal() {
  return (
    <div className="modal fade" id="modal--options">
      <div className="modal-dialog modal-sm">
        <div className="modal-content">
          <div className="modal-header">
            <button type="button" className="close" data-dismiss="modal" aria-hidden="true">&times;</button>
            <h4 className="modal-title">Einstellungen</h4>
          </div>
          <div className="modal-body">
            <form>
              <div className="form-group">
                <label htmlFor="optionBoardStyle">Brett:</label>
                <select className="form-control" name="optionBoardStyle" id="optionBoardStyle" defaultValue="default">
                  <option value="default">Normal</option>
                  <option value="old">Alt</option>
                  <option value="contrast">Kontrast</option>
                </select>

                <label htmlFor="optionBoardScale">Brettgröße (in %):</label>
                <input
                  className="form-control"
                  name="optionBoardScale"
                  id="optionBoardScale"
                  type="number"
                  step={1}
                  max={300}
                  min={20}
                  defaultValue={100}
                />
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
