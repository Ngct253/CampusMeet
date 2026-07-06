export async function requireGroupMembership(_userId: string, _groupId: string): Promise<void> {
  // TODO(M3): query active membership by groupId before every group-scoped read/write.
  // Admin-only operations must additionally require GroupRole.GROUP_ADMIN.
  throw new Error('Authorization boundary is not implemented');
}
