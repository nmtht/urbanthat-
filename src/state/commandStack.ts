/** Minimal command stack for undo (Sprint 2). */

export interface Command {
  readonly label: string;
  execute(): void;
  undo(): void;
}

export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<() => void>();

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoCount(): number {
    return this.undoStack.length;
  }
  get lastLabel(): string | null {
    return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].label : null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  push(cmd: Command): void {
    cmd.execute();
    this.undoStack.push(cmd);
    this.redoStack = [];
    this.notify();
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo();
    this.redoStack.push(cmd);
    this.notify();
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.execute();
    this.undoStack.push(cmd);
    this.notify();
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }
}

/** Add a zone rect to state; undo removes it again by id. */
export class AddZoneCommand<T extends { id: string }> implements Command {
  readonly label = 'Add zone';

  constructor(
    private zone: T,
    private setZones: (updater: (prev: T[]) => T[]) => void
  ) {}

  execute(): void {
    this.setZones((prev) => [...prev, this.zone]);
  }

  undo(): void {
    const id = this.zone.id;
    this.setZones((prev) => prev.filter((z) => z.id !== id));
  }
}

/** Hide/show an OSM mesh. */
export class DeleteOsmCommand implements Command {
  readonly label: string;
  private objs: Array<{ obj: import('three').Object3D; parent: import('three').Object3D | null }>;

  constructor(objects: import('three').Object3D[], kind: string) {
    this.label = `Delete ${kind}`;
    this.objs = objects.map((obj) => ({ obj, parent: obj.parent }));
  }

  execute(): void {
    for (const { obj } of this.objs) {
      obj.visible = false;
      obj.userData.deleted = true;
    }
  }

  undo(): void {
    for (const { obj } of this.objs) {
      obj.visible = true;
      obj.userData.deleted = false;
    }
  }
}
