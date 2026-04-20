import { createActor, type Actor } from "xstate";
import {
  sessionMachine,
  snapshotToDTO,
  type SessionEvent,
} from "@app/shared";
import type { SessionSnapshot } from "@app/shared";

export type SessionListener = (snapshot: SessionSnapshot) => void;

export class SessionRuntime {
  private actor: Actor<typeof sessionMachine>;

  constructor() {
    this.actor = createActor(sessionMachine);
    this.actor.start();
  }

  get(): SessionSnapshot {
    return snapshotToDTO(this.actor.getSnapshot());
  }

  send(event: SessionEvent): SessionSnapshot {
    this.actor.send(event);
    return this.get();
  }

  subscribe(listener: SessionListener): () => void {
    listener(this.get());
    const sub = this.actor.subscribe((snap) => {
      listener(snapshotToDTO(snap));
    });
    return () => sub.unsubscribe();
  }

  stop(): void {
    this.actor.stop();
  }
}
