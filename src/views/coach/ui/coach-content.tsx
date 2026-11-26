"use client";

import { useState, type ReactNode } from "react";
import { CoachExchange } from "@/features/coach-exchange";
import { ProfileEditor } from "@/features/edit-profile";

// Compose sibling features here: the exchange never imports the profile editor.
export function CoachContent({ children }: Readonly<{ children?: ReactNode }>) {
  const [preparedProfile, setPreparedProfile] = useState<Readonly<{ id: string; revision: number }>>();
  return <CoachExchange preparedProfile={preparedProfile} onEditPreparation={() => setPreparedProfile(undefined)}
    preparation={<ProfileEditor preparation onSaved={(profile) => setPreparedProfile({ id: profile.id, revision: profile.revision })} />}>
    {children}
  </CoachExchange>;
}
