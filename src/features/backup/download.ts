import type { FitnessBackup } from "@/entities/training";

export function downloadBackup(backup: FitnessBackup): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  try {
    anchor.href = url; anchor.download = `fitness-backup-${backup.createdAt.slice(0, 10)}.json`;
    document.body.append(anchor); anchor.click();
  } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
}
