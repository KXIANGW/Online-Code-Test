export type RoleKey = "root" | "interviewer" | "problem_setter" | "candidate";

export interface RoleConfig {
  key: RoleKey;
  label: string;
  pillColor: string;
  /** Tailwind text-color class used for checkboxes (e.g. "text-blue-600") */
  checkboxColor: string;
  /** Can be assigned/removed via the edit-roles modal */
  editable: boolean;
  /** Appears as a checkbox option when creating a new user */
  creatableByRoot: boolean;
}

export const ROLE_CONFIGS: RoleConfig[] = [
  {
    key: "root",
    label: "Root",
    pillColor: "bg-slate-100 text-slate-500",
    checkboxColor: "text-slate-500",
    editable: false,
    creatableByRoot: false,
  },
  {
    key: "interviewer",
    label: "面試官",
    pillColor: "bg-blue-50 text-blue-600",
    checkboxColor: "text-blue-600",
    editable: true,
    creatableByRoot: true,
  },
  {
    key: "problem_setter",
    label: "出題者",
    pillColor: "bg-purple-50 text-purple-600",
    checkboxColor: "text-purple-600",
    editable: true,
    creatableByRoot: true,
  },
  {
    key: "candidate",
    label: "候選人",
    pillColor: "bg-green-50 text-green-600",
    checkboxColor: "text-green-600",
    editable: false,
    creatableByRoot: false,
  },
];

export const ROLE_CONFIG_MAP: Record<RoleKey, RoleConfig> = Object.fromEntries(
  ROLE_CONFIGS.map((r) => [r.key, r]),
) as Record<RoleKey, RoleConfig>;

export const EDITABLE_ROLES = ROLE_CONFIGS.filter((r) => r.editable);
export const CREATABLE_ROLES = ROLE_CONFIGS.filter((r) => r.creatableByRoot);
