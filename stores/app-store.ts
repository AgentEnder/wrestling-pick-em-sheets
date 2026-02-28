import { create } from "zustand";
import { createEditorSlice, type EditorSlice } from "@/stores/editor-slice";
import {
  createLiveGameSlice,
  type LiveGameSlice,
} from "@/stores/live-game-slice";

export type AppStore = EditorSlice & LiveGameSlice;

export const useAppStore = create<AppStore>()((...args) => ({
  ...createEditorSlice(...args),
  ...createLiveGameSlice(...args),
}));
