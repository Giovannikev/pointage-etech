import type { OdooInstanceIndex } from "@/types/timesheet"

/** Solid color telling the two Odoo instances apart (Odoo plum and teal). */
export const INSTANCE_BACKGROUNDS: Readonly<Record<OdooInstanceIndex, string>> =
  {
    1: "bg-instance-1",
    2: "bg-instance-2",
  }
