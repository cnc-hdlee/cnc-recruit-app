import { useSyncExternalStore } from 'react';
import { D as initialD } from './data/initialData';
import type { DataShape, ScreeningTask } from './types';

type Listener = () => void;

let state: DataShape = structuredClone(initialD);
const listeners = new Set<Listener>();

const subscribe = (l: Listener) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => state;
const emit = () => listeners.forEach((l) => l());

export function useData(): DataShape {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function updateScreeningStage(nm: string, newStage: string) {
  const next = { ...state, screeningTasks: state.screeningTasks.map((t) => (t.nm === nm ? { ...t, stage: newStage } : t)) };
  state = next;
  emit();
}

export function moveScreening(task: ScreeningTask, toStage: string) {
  updateScreeningStage(task.nm, toStage);
}

export function getTodayStr(): string {
  const today = new Date('2026-04-29');
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
