import { create } from "zustand";
import { createEditorSlice, type EditorSlice } from "@/stores/editor-slice";

export type AppStore = EditorSlice;

export const useAppStore = create<AppStore>()((...args) => ({
  ...createEditorSlice(...args),
}));
