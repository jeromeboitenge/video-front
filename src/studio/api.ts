const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api/v1';

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = sessionStorage.getItem('frameforge:access-token');
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export type Session = { access_token: string; token_type: string; user: { id: string; email: string } };
export type CloudProject = { id: string; name: string; document: unknown; created_at: string; updated_at: string };

export async function authenticate(mode: 'login' | 'register', email: string, password: string) {
  const session = await apiRequest<Session>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email, password }) });
  sessionStorage.setItem('frameforge:access-token', session.access_token);
  return session.user;
}

export async function saveCloudProject(name: string, document: unknown, id?: string) {
  return apiRequest<CloudProject>(id ? `/projects/${id}` : '/projects', { method: id ? 'PUT' : 'POST', body: JSON.stringify({ name, document }) });
}
