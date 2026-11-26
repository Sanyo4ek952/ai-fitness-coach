"use client";

import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import { demoReducer, initialDemoState, type DemoAction, type DemoState } from "./model";

const DemoContext = createContext<Readonly<{ state: DemoState; dispatch: Dispatch<DemoAction> }> | null>(null);

export function PrototypeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [state, dispatch] = useReducer(demoReducer, initialDemoState);
  return <DemoContext value={{ state, dispatch }}>{children}</DemoContext>;
}

export function usePrototype() {
  const context = useContext(DemoContext);
  if (!context) throw new Error("Нужен PrototypeProvider");
  return context;
}
