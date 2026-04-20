import { useState, type FormEvent } from "react";
import type { SetupData, Relationship } from "@app/shared";

interface Props {
  onSubmit: (data: SetupData) => void;
}

export function SetupView({ onSubmit }: Props) {
  const [nameA, setNameA] = useState("");
  const [nameB, setNameB] = useState("");
  const [relationship, setRelationship] = useState("");

  const valid =
    nameA.trim().length > 0 &&
    nameB.trim().length > 0 &&
    relationship.trim().length > 0;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onSubmit({
      players: {
        A: { id: "A", name: nameA.trim() },
        B: { id: "B", name: nameB.trim() },
      },
      // TEMP(Task 9): この SetupView は 4-button 版に全置換される。それまでの typecheck 緑維持のため as Relationship で通す
      relationship: relationship.trim() as Relationship,
    });
  }

  return (
    <main className="intro-setup">
      <form onSubmit={handleSubmit}>
        <h1>2人の名前と関係性を入力</h1>
        <label>
          Player A の名前
          <input
            value={nameA}
            onChange={(e) => setNameA(e.target.value)}
            placeholder="例: あきら"
            maxLength={24}
            autoFocus
          />
        </label>
        <label>
          Player B の名前
          <input
            value={nameB}
            onChange={(e) => setNameB(e.target.value)}
            placeholder="例: さくら"
            maxLength={24}
          />
        </label>
        <label>
          2人の関係性
          <input
            value={relationship}
            onChange={(e) => setRelationship(e.target.value)}
            placeholder="例: 友人 / 恋人 / 親子 / 同僚 ..."
            maxLength={32}
          />
        </label>
        <button type="submit" disabled={!valid}>
          次へ
        </button>
      </form>
    </main>
  );
}
