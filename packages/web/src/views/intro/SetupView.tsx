import type { Relationship, SetupData } from "@app/shared";

interface Props {
  onSubmit: (data: SetupData) => void;
}

const RELATIONSHIPS: Relationship[] = [
  "カップル",
  "気になっている",
  "友達",
  "親子",
];

export function SetupView({ onSubmit }: Props) {
  function pick(relationship: Relationship) {
    onSubmit({
      players: {
        A: { id: "A", name: "" },
        B: { id: "B", name: "" },
      },
      relationship,
    });
  }

  return (
    <main className="intro-setup">
      <h1>2人の関係性は？</h1>
      <div className="relationship-grid">
        {RELATIONSHIPS.map((r) => (
          <button key={r} type="button" onClick={() => pick(r)}>
            {r}
          </button>
        ))}
      </div>
    </main>
  );
}
