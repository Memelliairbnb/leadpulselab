export interface User {
  id: number;
  email: string;
  passwordHash: string;
  fullName: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: number;
  tenantId: number;
  userId: number | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  detailsJson: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: Date;
}
