/** Minimal command stack for undo (Sprint 2+). */

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

/** Add a user road; undo removes by id. */
export class AddRoadCommand<T extends { id: string }> implements Command {
  readonly label = 'Add road';

  constructor(
    private road: T,
    private setRoads: (updater: (prev: T[]) => T[]) => void
  ) {}

  execute(): void {
    this.setRoads((prev) => [...prev, this.road]);
  }

  undo(): void {
    const id = this.road.id;
    this.setRoads((prev) => prev.filter((r) => r.id !== id));
  }
}

/** Remove a user road by id; undo restores the snapshot. */
export class DeleteRoadCommand<T extends { id: string }> implements Command {
  readonly label = 'Delete road';

  constructor(
    private road: T,
    private setRoads: (updater: (prev: T[]) => T[]) => void
  ) {}

  execute(): void {
    const id = this.road.id;
    this.setRoads((prev) => prev.filter((r) => r.id !== id));
  }

  undo(): void {
    this.setRoads((prev) => {
      if (prev.some((r) => r.id === this.road.id)) return prev;
      return [...prev, this.road];
    });
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

/** Replace all generated buildings for a zone (or clear). Undo restores previous list for that zone. */
export class GenerateZoneCommand<T extends { id: string; zoneId: string }> implements Command {
  readonly label: string;
  private prev: T[];

  constructor(
    private zoneId: string,
    private next: T[],
    private getBuildings: () => T[],
    private setBuildings: (updater: (prev: T[]) => T[]) => void,
    label = 'Generate buildings'
  ) {
    this.label = label;
    this.prev = [];
  }

  execute(): void {
    this.prev = this.getBuildings().filter((b) => b.zoneId === this.zoneId);
    this.setBuildings((all) => [
      ...all.filter((b) => b.zoneId !== this.zoneId),
      ...this.next,
    ]);
  }

  undo(): void {
    this.setBuildings((all) => [
      ...all.filter((b) => b.zoneId !== this.zoneId),
      ...this.prev,
    ]);
  }
}

export class ClearZoneBuildingsCommand<T extends { id: string; zoneId: string }> implements Command {
  readonly label = 'Clear buildings';
  private prev: T[] = [];

  constructor(
    private zoneId: string,
    private getBuildings: () => T[],
    private setBuildings: (updater: (prev: T[]) => T[]) => void
  ) {}

  execute(): void {
    this.prev = this.getBuildings().filter((b) => b.zoneId === this.zoneId);
    this.setBuildings((all) => all.filter((b) => b.zoneId !== this.zoneId));
  }

  undo(): void {
    this.setBuildings((all) => [
      ...all.filter((b) => b.zoneId !== this.zoneId),
      ...this.prev,
    ]);
  }
}

export class DeleteBuildingCommand<T extends { id: string }> implements Command {
  readonly label = 'Delete building';

  constructor(
    private building: T,
    private setBuildings: (updater: (prev: T[]) => T[]) => void
  ) {}

  execute(): void {
    const id = this.building.id;
    this.setBuildings((prev) => prev.filter((b) => b.id !== id));
  }

  undo(): void {
    this.setBuildings((prev) => {
      if (prev.some((b) => b.id === this.building.id)) return prev;
      return [...prev, this.building];
    });
  }
}

export class UpdateBuildingCommand<T extends { id: string }> implements Command {
  readonly label = 'Update building';
  private prev: T | null = null;

  constructor(
    private id: string,
    private patch: Partial<T>,
    private getBuildings: () => T[],
    private setBuildings: (updater: (prev: T[]) => T[]) => void
  ) {}

  execute(): void {
    const cur = this.getBuildings().find((b) => b.id === this.id);
    if (!cur) return;
    this.prev = { ...cur };
    this.setBuildings((all) =>
      all.map((b) => (b.id === this.id ? { ...b, ...this.patch } : b))
    );
  }

  undo(): void {
    if (!this.prev) return;
    const snap = this.prev;
    this.setBuildings((all) => all.map((b) => (b.id === snap.id ? snap : b)));
  }
}
