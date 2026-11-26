import { AppShell } from "@/widgets/app-shell";
import { ProfileEditor } from "@/features/edit-profile";
import { BackupPanel } from "@/features/backup";
import { PrivacyPanel } from "@/features/privacy";

export function ProfilePage() {
  return <AppShell activePath="/profile"><ProfileEditor /><BackupPanel /><PrivacyPanel /></AppShell>;
}
