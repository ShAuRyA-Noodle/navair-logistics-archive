export const PERMISSIONS = ['cases.all','cases.assigned','cases.accept','shipments.update','finance.view','commitments.manage','mail.manage'] as const;
export type Permission = typeof PERMISSIONS[number] | 'team.manage';
export type Actor = { id: string; email: string; name: string; role: 'owner'|'staff'|'customer'; permissions: string[]; active: boolean; isDemo: boolean };
export function can(actor: Actor, permission: Permission) { return actor.active && (actor.role==='owner' || (actor.role==='staff' && actor.permissions.includes(permission))); }
