import type { Survey } from "@ghost/shared";

export function SurveyPanel({ survey }: { survey: Survey }) {
  const percent = Math.floor((survey.coveredCells / survey.totalCells) * 100);
  const inspected = survey.knownCargo.filter((cargo) => cargo.condition).length;
  return (
    <section
      className="survey-panel panel"
      aria-label="Shared warehouse survey"
    >
      <div className="survey-summary">
        <span className="eyebrow">SHARED SEARCH HISTORY</span>
        <h2>What the ghost has found.</h2>
        <div className="survey-score">
          <strong>
            {percent}
            <small>%</small>
          </strong>
          <span>
            {survey.coveredCells} / {survey.totalCells} floor cells surveyed
          </span>
        </div>
        <div
          className="survey-progress"
          role="progressbar"
          aria-label="Floor telemetry survey"
          aria-valuemin={0}
          aria-valuemax={survey.totalCells}
          aria-valuenow={survey.coveredCells}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <p>
          Stationary telemetry at cargo height. Unknown cells stay dark on the
          map. Camera images may be occluded; floor coverage does not certify a
          complete inventory.
        </p>
      </div>
      <div className="survey-ledger">
        <div className="survey-ledger-heading">
          <h3>Observed cargo</h3>
          <span>
            {inspected} / {survey.knownCargo.length} inspected
          </span>
        </div>
        {survey.knownCargo.length ? (
          <ul>
            {survey.knownCargo.map((cargo) => (
              <li key={cargo.id}>
                <div>
                  <strong>{cargo.label}</strong>
                  <span
                    className={`survey-tag ${cargo.condition ? "survey-inspected" : ""}`}
                  >
                    {cargo.condition ? "INSPECTED" : "SEEN / NOT INSPECTED"}
                  </span>
                </div>
                <p>
                  {cargo.condition ??
                    "Condition unknown. Move within inspection range and scan."}
                </p>
                <small>
                  Last seen [
                  {cargo.position.map((v) => v.toFixed(1)).join(", ")}] m{" · "}
                  {new Date(cargo.lastSeenAt).toISOString().slice(11, 19)} UTC
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <div className="survey-empty">
            <strong>No cargo observed yet.</strong>
            <p>
              Possess a body and observe, or connect an MCP agent. This ledger
              fills from actual sensor observations.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
