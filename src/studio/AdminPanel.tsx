import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, Building2, Check, ClipboardList, FileBarChart2, FolderKanban, HardDrive, Landmark, LifeBuoy, LogOut, Mail, Plus, RefreshCw, ScrollText, Settings, ShieldCheck, Users, UserRound, X } from 'lucide-react';
import {
  changeAdminPassword,
  createOrganization,
  getAdminProfile,
  getAdminReport,
  getAdminSettings,
  getOrganizationStats,
  listAuditEvents,
  listOrganizationRequests,
  listMyOrganizationRequests,
  listMySupportTickets,
  listOrganizations,
  listSupportTickets,
  reviewOrganizationRequest,
  saveAdminSettings,
  createSupportTicket,
  updateSupportTicket,
  submitOrganizationRequest,
  type AdminProfile,
  type AdminReport,
  type AdminSettings,
  type AuditEvent,
  type Organization,
  type OrganizationRequest,
  type OrganizationStats,
  type SupportTicket,
} from './api';
import './admin.css';

type AdminPage = 'reports' | 'audit' | 'support' | 'organizations' | 'approvals' | 'settings' | 'profile';
const adminPageTitle: Record<AdminPage, string> = {
  reports: 'Reports',
  audit: 'Audit logs',
  support: 'Support access',
  organizations: 'Organisation management',
  approvals: 'Organisation approvals',
  settings: 'Settings',
  profile: 'Profile',
};

export function AdminPanel({ email, onBack, onSignOut }: { email: string; onBack: () => void; onSignOut: () => void }) {
  const [page, setPage] = useState<AdminPage>('reports');
  const [pageRefreshKey, setPageRefreshKey] = useState(0);
  const [stats, setStats] = useState<OrganizationStats | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [requests, setRequests] = useState<OrganizationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextStats, nextOrganizations, nextRequests] = await Promise.all([
        getOrganizationStats(),
        listOrganizations(),
        listOrganizationRequests(),
      ]);
      setStats(nextStats);
      setOrganizations(nextOrganizations);
      setRequests(nextRequests);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function submitOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusyId('create');
    try {
      const created = await createOrganization({ name, slug, description });
      setOrganizations((items) => [created, ...items]);
      setStats((current) => current ? { ...current, organizations: current.organizations + 1 } : current);
      setName('');
      setSlug('');
      setDescription('');
      setFormOpen(false);
      setNotice(`${created.name} was created.`);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusyId('');
    }
  }

  async function review(request: OrganizationRequest, decision: 'approve' | 'reject') {
    setBusyId(request.id);
    setError('');
    setNotice('');
    try {
      await reviewOrganizationRequest(request.id, decision);
      setRequests((items) => items.filter((item) => item.id !== request.id));
      setStats((current) => current ? {
        ...current,
        pending_requests: Math.max(0, current.pending_requests - 1),
        approved_requests: current.approved_requests + (decision === 'approve' ? 1 : 0),
        rejected_requests: current.rejected_requests + (decision === 'reject' ? 1 : 0),
        organizations: current.organizations + (decision === 'approve' ? 1 : 0),
      } : current);
      if (decision === 'approve') {
        try {
          setOrganizations(await listOrganizations());
        } catch (reason) {
          setError(`Request was approved, but the organisation list could not be refreshed: ${(reason as Error).message}`);
        }
      }
      setNotice(`${request.name} request ${decision === 'approve' ? 'approved' : 'rejected'}.`);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusyId('');
    }
  }

  return <main className="admin-shell">
    <aside className="admin-sidebar">
      <div className="admin-brand"><span className="admin-brand-mark"><Landmark size={17}/></span><span>FRAMEFORGE<small>ADMINISTRATION</small></span></div>
      <button className={`admin-nav-item ${page === 'reports' ? 'active' : ''}`} onClick={() => setPage('reports')}><FileBarChart2 size={17}/>Reports</button>
      <button className={`admin-nav-item ${page === 'audit' ? 'active' : ''}`} onClick={() => setPage('audit')}><ScrollText size={17}/>Audit logs</button>
      <div className="admin-nav-label">SYSTEM</div>
      <button className={`admin-nav-item ${page === 'support' ? 'active' : ''}`} onClick={() => setPage('support')}><LifeBuoy size={17}/>Support access</button>
      <button className={`admin-nav-item ${page === 'organizations' ? 'active' : ''}`} onClick={() => setPage('organizations')}><Building2 size={17}/>Organisation management</button>
      <button className={`admin-nav-item ${page === 'approvals' ? 'active' : ''}`} onClick={() => setPage('approvals')}><ClipboardList size={17}/>Organisation approvals{stats?.pending_requests ? <span className="admin-nav-count">{stats.pending_requests}</span> : null}</button>
      <button className={`admin-nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}><Settings size={17}/>Settings</button>
      <div className="admin-nav-label admin-account-label">ACCOUNT</div>
      <button className={`admin-nav-item ${page === 'profile' ? 'active' : ''}`} onClick={() => setPage('profile')}><UserRound size={17}/>Profile</button>
      <div className="admin-sidebar-spacer"/>
      <div className="admin-user"><span className="admin-user-avatar">{email.slice(0, 1).toUpperCase()}</span><span>{email}<small>Administrator</small></span></div>
      <button className="admin-nav-item" onClick={onSignOut}><LogOut size={17}/>Sign out</button>
      <button className="admin-back" onClick={onBack}><ArrowLeft size={16}/>Back to Studio</button>
    </aside>

    <section className="admin-main">
      <header className="admin-topbar"><div><span className="admin-breadcrumb">ADMINISTRATION <span>/</span> {page.toUpperCase()}</span><h1>{adminPageTitle[page]}</h1></div><div className="admin-top-actions"><button className="admin-icon-button" aria-label="Refresh dashboard" onClick={() => page === 'organizations' || page === 'approvals' ? void refresh() : setPageRefreshKey((key) => key + 1)} disabled={loading}><RefreshCw size={16}/></button></div></header>
      <div className="admin-content">
        {error && <div className="admin-alert error" role="alert">{error}</div>}
        {notice && <div className="admin-alert success" role="status">{notice}</div>}
        <div className="admin-stat-grid">
          <StatCard label="Total organisations" value={stats?.organizations} icon={<Building2 size={18}/>} tint="violet"/>
          <StatCard label="Awaiting approval" value={stats?.pending_requests} icon={<ClipboardList size={18}/>} tint="amber"/>
          <StatCard label="Approved requests" value={stats?.approved_requests} icon={<ShieldCheck size={18}/>} tint="green"/>
          <StatCard label="Rejected requests" value={stats?.rejected_requests} icon={<X size={18}/>} tint="red"/>
          <StatCard label="Total users" value={stats?.users} icon={<Users size={18}/>} tint="blue"/>
        </div>

        {page === 'reports' ? <ReportsPage refreshKey={pageRefreshKey}/> : page === 'audit' ? <AuditLogPage refreshKey={pageRefreshKey}/> : page === 'support' ? <SupportAccessPage refreshKey={pageRefreshKey}/> : page === 'settings' ? <SettingsPage refreshKey={pageRefreshKey}/> : page === 'profile' ? <ProfilePage email={email} refreshKey={pageRefreshKey}/> : page === 'organizations' ? <section className="admin-card">
          <div className="admin-card-heading"><div><h2>Organisations</h2><p>Create and manage organisations in this workspace.</p></div><button className="admin-primary-button" onClick={() => { setFormOpen((open) => !open); setError(''); }}><Plus size={16}/>{formOpen ? 'Close form' : 'Create organisation'}</button></div>
          {formOpen && <form className="org-create-form" onSubmit={(event) => void submitOrganization(event)}>
            <label>Organisation name<input required minLength={2} maxLength={120} value={name} onChange={(event) => { setName(event.target.value); if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) setSlug(event.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')); }} placeholder="e.g. Northstar Media"/></label>
            <label>Slug<input required minLength={2} maxLength={80} pattern="[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} placeholder="northstar-media"/></label>
            <label className="org-description-field">Description <span>Optional</span><input maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A short description"/></label>
            <div className="org-form-actions"><button type="button" className="admin-secondary-button" onClick={() => setFormOpen(false)}>Cancel</button><button className="admin-primary-button" disabled={busyId === 'create'}>{busyId === 'create' ? 'Creating…' : 'Create organisation'}</button></div>
          </form>}
          {loading && !stats ? <div className="admin-empty">Loading organisation data…</div> : organizations.length ? <div className="org-table-wrap"><table className="org-table"><thead><tr><th>ORGANISATION</th><th>SLUG</th><th>CREATED</th><th>STATUS</th></tr></thead><tbody>{organizations.map((organization) => <tr key={organization.id}><td><span className="org-table-icon"><Building2 size={16}/></span><span className="org-table-name">{organization.name}<small>{organization.description || 'No description'}</small></span></td><td><code>{organization.slug}</code></td><td>{new Date(organization.created_at).toLocaleDateString()}</td><td><span className="org-status active">Active</span></td></tr>)}</tbody></table></div> : <div className="admin-empty"><span className="admin-empty-icon"><Building2 size={21}/></span><strong>No organisations yet</strong><span>Create an organisation here or review a pending request.</span></div>}
        </section> : <section className="admin-card">
          <div className="admin-card-heading"><div><h2>Pending requests</h2><p>Review and decide on organisation requests.</p></div><span className="pending-pill">{requests.length} pending</span></div>
          {loading && !stats ? <div className="admin-empty">Loading approval requests…</div> : requests.length ? <div className="approval-list">{requests.map((request) => <article className="approval-row" key={request.id}><div className="approval-icon"><Building2 size={18}/></div><div className="approval-details"><h3>{request.name}<code>{request.slug}</code></h3><p>{request.description || 'No description provided.'}</p><small>Requested {new Date(request.created_at).toLocaleDateString()} · {request.requester_email ?? `User ${request.requested_by.slice(0, 8)}`}</small></div><div className="approval-actions"><button className="approve-button" disabled={busyId === request.id} onClick={() => void review(request, 'approve')}><Check size={15}/>{busyId === request.id ? 'Working…' : 'Approve'}</button><button className="reject-button" disabled={busyId === request.id} onClick={() => void review(request, 'reject')}><X size={15}/>Reject</button></div></article>)}</div> : <div className="admin-empty"><span className="admin-empty-icon"><Check size={21}/></span><strong>All caught up</strong><span>There are no organisation requests waiting for review.</span></div>}
        </section>}
        <footer className="admin-footer">Administration actions are recorded in the audit log. Support requests do not grant access to users’ projects or media.</footer>
      </div>
    </section>
  </main>;
}

function ReportsPage({ refreshKey }: { refreshKey: number }) {
  const [report, setReport] = useState<AdminReport | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    void getAdminReport().then((data) => { if (active) setReport(data); })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [refreshKey]);
  return <section className="admin-page-grid">
    {error && <div className="admin-alert error" role="alert">{error}</div>}
    <article className="admin-card report-card"><div className="admin-card-heading"><div><h2>Workspace overview</h2><p>Current totals across organisations, accounts, projects, and media.</p></div></div>
      <div className="report-metrics">
        <ReportMetric icon={<Users size={17}/>} label="User accounts" value={report?.users}/>
        <ReportMetric icon={<Building2 size={17}/>} label="Organisations" value={report?.organizations}/>
        <ReportMetric icon={<FolderKanban size={17}/>} label="Projects" value={report?.projects}/>
        <ReportMetric icon={<HardDrive size={17}/>} label="Media assets" value={report?.media_assets}/>
        <ReportMetric icon={<Mail size={17}/>} label="Organisation requests" value={report?.organization_requests}/>
        <ReportMetric icon={<HardDrive size={17}/>} label="Stored media" value={report ? formatBytes(report.media_bytes) : undefined}/>
      </div>
    </article>
    <article className="admin-card report-card"><div className="admin-card-heading"><div><h2>Last 30 days</h2><p>New accounts and organisations created during the last 30 days.</p></div></div>
      <div className="report-trends"><Trend label="New user accounts" value={report?.users_created_30_days} total={report?.users}/><Trend label="New organisations" value={report?.organizations_created_30_days} total={report?.organizations}/></div>
    </article>
    <article className="admin-card report-card"><div className="admin-card-heading"><div><h2>Support queue</h2><p>Current support-request status totals.</p></div></div>
      <div className="report-metrics compact"><ReportMetric icon={<LifeBuoy size={17}/>} label="Open" value={report?.support_open}/><ReportMetric icon={<RefreshCw size={17}/>} label="In progress" value={report?.support_in_progress}/><ReportMetric icon={<Check size={17}/>} label="Closed" value={report?.support_closed}/></div>
    </article>
  </section>;
}

function ReportMetric({ icon, label, value }: { icon: ReactNode; label: string; value?: number | string }) {
  return <div className="report-metric"><span className="report-metric-icon">{icon}</span><div><span>{label}</span><strong>{value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString() : value}</strong></div></div>;
}

function Trend({ label, value, total }: { label: string; value?: number; total?: number }) {
  const percent = total ? Math.min(100, Math.round((value ?? 0) / total * 100)) : 0;
  return <div className="trend-row"><div><span>{label}</span><strong>{value === undefined ? '—' : value.toLocaleString()}</strong></div><div className="trend-track"><i style={{ width: `${percent}%` }}/></div><small>{percent}% of current total</small></div>;
}

function AuditLogPage({ refreshKey }: { refreshKey: number }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    void listAuditEvents(100).then((items) => { if (active) setEvents(items); })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [refreshKey]);
  return <section className="admin-card">
    <div className="admin-card-heading"><div><h2>Audit log</h2><p>Recent administrative and account support activity.</p></div><span className="pending-pill">Latest 100</span></div>
    {error && <div className="admin-alert error" role="alert">{error}</div>}
    {events.length ? <div className="audit-list">{events.map((event) => <article className="audit-row" key={event.id}><span className="audit-marker"><ScrollText size={15}/></span><div className="audit-event"><strong>{event.summary}</strong><span>{event.actor_email} · {event.action.replaceAll('.', ' ')}</span><small>{new Date(event.created_at).toLocaleString()} · {event.target_type}{event.target_id ? ` · ${event.target_id.slice(0, 8)}` : ''}</small></div></article>)}</div> : !error && <div className="admin-empty"><span className="admin-empty-icon"><ScrollText size={20}/></span><strong>No audit activity yet</strong><span>Organisation and support actions will appear here.</span></div>}
  </section>;
}

function SupportAccessPage({ refreshKey }: { refreshKey: number }) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { status: SupportTicket['status']; note: string }>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      const items = await listSupportTickets('all');
      setTickets(items);
      setDrafts(Object.fromEntries(items.map((ticket) => [ticket.id, { status: ticket.status, note: ticket.admin_note ?? '' }])));
    } catch (reason) { setError((reason as Error).message); }
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);

  async function save(ticket: SupportTicket) {
    const draft = drafts[ticket.id];
    if (!draft) return;
    setBusy(ticket.id);
    setError('');
    setNotice('');
    try {
      const updated = await updateSupportTicket(ticket.id, { status: draft.status, admin_note: draft.note });
      setTickets((items) => items.map((item) => item.id === ticket.id ? updated : item));
      setNotice(`Support request from ${ticket.requester_email} updated.`);
      await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  }

  return <section className="admin-card">
    <div className="admin-card-heading"><div><h2>Support requests</h2><p>Respond to account help requests. This queue does not grant access to users’ projects or media.</p></div><span className="pending-pill">{tickets.filter((ticket) => ticket.status !== 'closed').length} active</span></div>
    {error && <div className="admin-alert error" role="alert">{error}</div>}
    {notice && <div className="admin-alert success" role="status">{notice}</div>}
    {tickets.length ? <div className="support-list">{tickets.map((ticket) => <article className="support-ticket" key={ticket.id}><div className="support-ticket-heading"><div><h3>{ticket.subject}</h3><span>{ticket.requester_email} · {new Date(ticket.created_at).toLocaleString()}</span></div><span className={`ticket-status ${ticket.status}`}>{ticket.status.replace('_', ' ')}</span></div><p>{ticket.message}</p><label>Admin response<textarea maxLength={1000} value={drafts[ticket.id]?.note ?? ''} onChange={(event) => setDrafts((all) => ({ ...all, [ticket.id]: { status: all[ticket.id]?.status ?? ticket.status, note: event.target.value } }))} placeholder="Optional response or resolution note"/></label><div className="support-ticket-actions"><label>Status<select value={drafts[ticket.id]?.status ?? ticket.status} onChange={(event) => setDrafts((all) => ({ ...all, [ticket.id]: { status: event.target.value as SupportTicket['status'], note: all[ticket.id]?.note ?? ticket.admin_note ?? '' } }))}><option value="open">Open</option><option value="in_progress">In progress</option><option value="closed">Closed</option></select></label><button className="admin-primary-button" disabled={busy === ticket.id} onClick={() => void save(ticket)}>{busy === ticket.id ? 'Saving…' : 'Save update'}</button></div></article>)}</div> : !error && <div className="admin-empty"><span className="admin-empty-icon"><LifeBuoy size={20}/></span><strong>No support requests</strong><span>Requests submitted by signed-in users will appear here.</span></div>}
  </section>;
}

function SettingsPage({ refreshKey }: { refreshKey: number }) {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void getAdminSettings().then((value) => { if (active) setSettings(value); })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);
  async function toggleRequireNote(value: boolean) {
    setError('');
    setNotice('');
    try {
      const saved = await saveAdminSettings({ require_rejection_note: value });
      setSettings(saved);
      setNotice('Administrator settings saved.');
    } catch (reason) { setError((reason as Error).message); }
  }
  return <section className="admin-card">
    <div className="admin-card-heading"><div><h2>Administrator settings</h2><p>Configure safeguards applied to administrator review actions.</p></div></div>
    {error && <div className="admin-alert error" role="alert">{error}</div>}
    {notice && <div className="admin-alert success" role="status">{notice}</div>}
    <div className="settings-list"><div className="setting-row"><div><strong>Require a note when rejecting an organisation request</strong><p>When enabled, administrators must explain every rejection.</p></div><button className={`setting-toggle ${settings?.require_rejection_note ? 'enabled' : ''}`} role="switch" aria-checked={settings?.require_rejection_note ?? false} disabled={loading || !settings} onClick={() => void toggleRequireNote(!settings?.require_rejection_note)}><i/></button></div></div>
    {loading && <div className="admin-empty">Loading settings…</div>}
  </section>;
}

function ProfilePage({ email, refreshKey }: { email: string; refreshKey: number }) {
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void getAdminProfile().then((value) => { if (active) setProfile(value); })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [refreshKey]);
  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (newPassword !== confirmPassword) { setError('New password and confirmation do not match.'); return; }
    setBusy(true);
    try {
      await changeAdminPassword({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setNotice('Password changed. Your current session remains active.');
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="admin-page-grid">
    <article className="admin-card profile-card"><div className="admin-card-heading"><div><h2>Administrator profile</h2><p>Your account identity and access level.</p></div></div><div className="profile-summary"><span className="profile-avatar">{email.slice(0, 1).toUpperCase()}</span><div><strong>{profile?.email ?? email}</strong><span>Administrator account</span><small>{profile ? `Member since ${new Date(profile.created_at).toLocaleDateString()}` : 'Loading profile…'}</small></div><span className="org-status active">Admin</span></div></article>
    <article className="admin-card profile-card"><div className="admin-card-heading"><div><h2>Change password</h2><p>Use your current password to set a new one.</p></div></div>
      {error && <div className="admin-alert error" role="alert">{error}</div>}
      {notice && <div className="admin-alert success" role="status">{notice}</div>}
      <form className="password-form" onSubmit={(event) => void updatePassword(event)}><label>Current password<input type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)}/></label><label>New password<input type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)}/></label><label>Confirm new password<input type="password" autoComplete="new-password" required minLength={10} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}/></label><button className="admin-primary-button" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button></form>
    </article>
  </section>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) { value /= 1024; unitIndex += 1; }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function StatCard({ label, value, icon, tint }: { label: string; value?: number; icon: ReactNode; tint: string }) {
  return <article className="admin-stat-card"><span className={`admin-stat-icon ${tint}`}>{icon}</span><div><span>{label}</span><strong>{value === undefined ? '—' : value.toLocaleString()}</strong></div></article>;
}

export function OrganizationRequestForm() {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [requests, setRequests] = useState<OrganizationRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    void listMyOrganizationRequests().then((items) => { if (active) setRequests(items); })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const request = await submitOrganizationRequest({ name, slug, description });
      setRequests((items) => [request, ...items]);
      setName('');
      setSlug('');
      setDescription('');
      setNotice('Your organisation request was submitted for review.');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="account-org-request">
    <h3>Request an organisation</h3>
    <p>Requests are reviewed by a Frameforge administrator.</p>
    <form className="admin-request-form" onSubmit={(event) => void submit(event)}>
      <label>Organisation name<input required minLength={2} maxLength={120} value={name} onChange={(event) => { setName(event.target.value); setSlug(event.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')); }} placeholder="Organisation name"/></label>
      <label>Slug<input required minLength={2} maxLength={80} pattern="[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} placeholder="organisation-slug"/></label>
      <label>Description<input maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional"/></label>
      <button className="modal-submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</button>
    </form>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {notice && <p className="admin-request-success" role="status">{notice}</p>}
    {requests.length > 0 && <div className="account-org-request-list"><strong>Your requests</strong>{requests.map((request) => <p key={request.id}>{request.name}<span className={`org-status ${request.status}`}>{request.status}</span>{request.review_note && <small>{request.review_note}</small>}</p>)}</div>}
  </section>;
}

export function SupportTicketForm() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void listMySupportTickets().then((items) => { if (active) setTickets(items); })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const ticket = await createSupportTicket({ subject, message });
      setTickets((items) => [ticket, ...items]);
      setSubject('');
      setMessage('');
      setNotice('Your support request has been sent.');
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="account-org-request">
    <h3>Contact support</h3>
    <p>Send a request to the Frameforge support team. This does not grant staff access to your projects or media.</p>
    <form className="admin-request-form" onSubmit={(event) => void submit(event)}>
      <label>Subject<input required minLength={4} maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="How can we help?"/></label>
      <label>Message<textarea required minLength={10} maxLength={4000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe the issue"/></label>
      <button className="modal-submit" disabled={busy}>{busy ? 'Sending…' : 'Send support request'}</button>
    </form>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {notice && <p className="admin-request-success" role="status">{notice}</p>}
    {tickets.length > 0 && <div className="account-org-request-list"><strong>Your support requests</strong>{tickets.map((ticket) => <p key={ticket.id}>{ticket.subject}<span className={`org-status ${ticket.status}`}>{ticket.status.replace('_', ' ')}</span>{ticket.admin_note && <small>{ticket.admin_note}</small>}</p>)}</div>}
  </section>;
}
