const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1';

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = sessionStorage.getItem('frameforge:access-token');
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && !(init?.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type Session = { access_token: string; token_type: string; user: { id: string; email: string; is_admin: boolean } };
export type CloudProject = { id: string; name: string; document: unknown; created_at: string; updated_at: string };
export type CloudProjectVersion = { id: string; project_id: string; version_number: number; name: string; created_at: string };
export type CloudMedia = { id: string; name: string; mime_type: string; size: number; created_at: string };
export type Organization = { id: string; name: string; slug: string; description: string | null; created_by: string; created_at: string };
export type OrganizationRequest = { id: string; name: string; slug: string; description: string | null; requested_by: string; requester_email?: string | null; status: 'pending' | 'approved' | 'rejected'; reviewed_by: string | null; review_note: string | null; created_at: string; reviewed_at: string | null };
export type OrganizationStats = { organizations: number; pending_requests: number; approved_requests: number; rejected_requests: number; users: number };
export type AdminReport = { organizations: number; users: number; projects: number; media_assets: number; media_bytes: number; organization_requests: number; support_open: number; support_in_progress: number; support_closed: number; organizations_created_30_days: number; users_created_30_days: number };
export type AuditEvent = { id: string; actor_id: string | null; actor_email: string; action: string; target_type: string; target_id: string | null; summary: string; details: Record<string, unknown>; created_at: string };
export type SupportTicket = { id: string; requester_id: string; requester_email: string; subject: string; message: string; status: 'open' | 'in_progress' | 'closed'; admin_note: string | null; created_at: string; updated_at: string };
export type AdminSettings = { require_rejection_note: boolean };
export type AdminProfile = { id: string; email: string; is_admin: boolean; created_at: string };

export async function authenticate(mode: 'login' | 'register', email: string, password: string) {
  const session = await apiRequest<Session>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password }) });
  sessionStorage.setItem('frameforge:access-token', session.access_token);
  return session.user;
}

export async function getCurrentUser() {
  return apiRequest<{ id: string; email: string; is_admin: boolean }>('/auth/me');
}

export async function getOrganizationStats() {
  return apiRequest<OrganizationStats>('/admin/dashboard/stats');
}

export async function listOrganizations() {
  return apiRequest<Organization[]>('/admin/organizations');
}

export async function createOrganization(input: { name: string; slug: string; description: string }) {
  return apiRequest<Organization>('/admin/organizations', { method: 'POST', body: JSON.stringify(input) });
}

export async function listOrganizationRequests(status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') {
  return apiRequest<OrganizationRequest[]>(`/admin/organization-requests?status=${status}`);
}

export async function reviewOrganizationRequest(id: string, decision: 'approve' | 'reject') {
  return apiRequest<OrganizationRequest>(`/admin/organization-requests/${encodeURIComponent(id)}/${decision}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function listMyOrganizationRequests() {
  return apiRequest<OrganizationRequest[]>('/organizations/requests/mine');
}

export async function submitOrganizationRequest(input: { name: string; slug: string; description: string }) {
  return apiRequest<OrganizationRequest>('/organizations/requests', { method: 'POST', body: JSON.stringify(input) });
}

export async function getAdminReport() {
  return apiRequest<AdminReport>('/admin/reports/summary');
}

export async function listAuditEvents(limit = 50) {
  return apiRequest<AuditEvent[]>(`/admin/audit-events?limit=${limit}`);
}

export async function listSupportTickets(status: 'open' | 'in_progress' | 'closed' | 'all' = 'all') {
  return apiRequest<SupportTicket[]>(`/admin/support-tickets?status=${status}`);
}

export async function updateSupportTicket(id: string, input: { status: SupportTicket['status']; admin_note: string }) {
  return apiRequest<SupportTicket>(`/admin/support-tickets/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function createSupportTicket(input: { subject: string; message: string }) {
  return apiRequest<SupportTicket>('/support-tickets', { method: 'POST', body: JSON.stringify(input) });
}

export async function listMySupportTickets() {
  return apiRequest<SupportTicket[]>('/support-tickets/mine');
}

export async function getAdminSettings() {
  return apiRequest<AdminSettings>('/admin/settings');
}

export async function saveAdminSettings(input: AdminSettings) {
  return apiRequest<AdminSettings>('/admin/settings', { method: 'PUT', body: JSON.stringify(input) });
}

export async function getAdminProfile() {
  return apiRequest<AdminProfile>('/admin/profile');
}

export async function changeAdminPassword(input: { current_password: string; new_password: string }) {
  return apiRequest<{ status: string }>('/admin/profile/password', { method: 'POST', body: JSON.stringify(input) });
}

export async function listCloudProjects() {
  return apiRequest<CloudProject[]>('/projects');
}

export async function getCloudProject(id: string) {
  return apiRequest<CloudProject>(`/projects/${encodeURIComponent(id)}`);
}

export async function deleteCloudProject(id: string) {
  return apiRequest<void>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listCloudProjectVersions(projectId: string) {
  return apiRequest<CloudProjectVersion[]>(`/projects/${encodeURIComponent(projectId)}/versions`);
}

export async function createCloudProjectVersion(projectId: string) {
  return apiRequest<CloudProjectVersion>(`/projects/${encodeURIComponent(projectId)}/versions`, { method: 'POST' });
}

export async function restoreCloudProjectVersion(projectId: string, versionId: string) {
  return apiRequest<CloudProject>(`/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/restore`, { method: 'POST' });
}

export async function uploadCloudMedia(file: File) {
  const body = new FormData();
  body.append('file', file, file.name);
  return apiRequest<CloudMedia>('/media', { method: 'POST', body });
}

export async function getCloudMediaContent(id: string) {
  const token = sessionStorage.getItem('frameforge:access-token');
  const response = await fetch(`${API_BASE}/media/${encodeURIComponent(id)}/content`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail ?? `Media download failed (${response.status})`);
  }
  return response.blob();
}

export async function deleteCloudMedia(id: string) {
  return apiRequest<void>(`/media/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function saveCloudProject(name: string, document: unknown, id?: string) {
  return apiRequest<CloudProject>(id ? `/projects/${id}` : '/projects', { method: id ? 'PUT' : 'POST', body: JSON.stringify({ name, document }) });
}
