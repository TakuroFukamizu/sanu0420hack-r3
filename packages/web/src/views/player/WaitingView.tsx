import type { PlayerId } from "@app/shared";

interface Props {
  playerId: PlayerId;
}

export function WaitingView({ playerId }: Props) {
  return (
    <main className="player-waiting">
      <div className="bg-pan" />
      <div className="content">
        <h1>Player {playerId}</h1>
        <p style={{ fontSize: 24 }}>まもなく始まります</p>
      </div>
    </main>
  );
}
