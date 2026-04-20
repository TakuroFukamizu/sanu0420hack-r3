import type { SetupData } from "@app/shared";

interface Props {
  setup: SetupData;
}

export function PlayerNamingWaitView({ setup }: Props) {
  const aDone = setup.players.A.name !== "";
  const bDone = setup.players.B.name !== "";
  return (
    <main className="intro-playernaming">
      <h1>プレイヤー名入力中…</h1>
      <div className="status-grid">
        <div className="status-card">
          <div>Player A</div>
          <div className={aDone ? "status-done" : "status-pending"}>
            {aDone ? `○ ${setup.players.A.name}` : "未"}
          </div>
        </div>
        <div className="status-card">
          <div>Player B</div>
          <div className={bDone ? "status-done" : "status-pending"}>
            {bDone ? `○ ${setup.players.B.name}` : "未"}
          </div>
        </div>
      </div>
    </main>
  );
}
