import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  severity: "success" | "info" | "warning" | "error";
}

interface ToastState {
  current: Toast | null;
  show: (message: string, severity?: Toast["severity"]) => void;
  dismiss: () => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  current: null,
  show: (message, severity = "info") => set({ current: { id: nextId++, message, severity } }),
  dismiss: () => set({ current: null }),
}));

export const toast = {
  info: (message: string) => useToasts.getState().show(message, "info"),
  success: (message: string) => useToasts.getState().show(message, "success"),
  error: (error: unknown) => useToasts.getState().show(error instanceof Error ? error.message : String(error), "error"),
};
