import { Route, Routes } from "react-router-dom";
import { Intro } from "./routes/Intro.js";
import { Player } from "./routes/Player.js";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Intro />} />
      <Route path="/player" element={<Player />} />
    </Routes>
  );
}
