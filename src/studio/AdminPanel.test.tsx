import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminPanel, OrganizationRequestForm, SupportTicketForm } from './AdminPanel';
import { changeAdminPassword, createOrganization, createSupportTicket, getAdminProfile, getAdminReport, getAdminSettings, getOrganizationStats, listAuditEvents, listMyOrganizationRequests, listMySupportTickets, listOrganizationRequests, listOrganizations, listSupportTickets, reviewOrganizationRequest, saveAdminSettings, submitOrganizationRequest, updateSupportTicket } from './api';

vi.mock('./api', () => ({
  changeAdminPassword: vi.fn(),
  createSupportTicket: vi.fn(),
  createOrganization: vi.fn(),
  getAdminProfile: vi.fn(),
  getAdminReport: vi.fn(),
  getAdminSettings: vi.fn(),
  getOrganizationStats: vi.fn(),
  listAuditEvents: vi.fn(),
  listOrganizationRequests: vi.fn(),
  listMyOrganizationRequests: vi.fn(),
  listMySupportTickets: vi.fn(),
  listOrganizations: vi.fn(),
  listSupportTickets: vi.fn(),
  reviewOrganizationRequest: vi.fn(),
  saveAdminSettings: vi.fn(),
  submitOrganizationRequest: vi.fn(),
  updateSupportTicket: vi.fn(),
}));

const emptyStats = { organizations: 0, pending_requests: 0, approved_requests: 0, rejected_requests: 0, users: 0 };

describe('admin organisation panel', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  beforeEach(() => {
    vi.mocked(getOrganizationStats).mockResolvedValue(emptyStats);
    vi.mocked(listOrganizations).mockResolvedValue([]);
    vi.mocked(listOrganizationRequests).mockResolvedValue([]);
    vi.mocked(getAdminReport).mockResolvedValue({
      organizations: 0, users: 0, projects: 0, media_assets: 0, media_bytes: 0,
      organization_requests: 0, support_open: 0, support_in_progress: 0, support_closed: 0,
      organizations_created_30_days: 0, users_created_30_days: 0,
    });
    vi.mocked(listAuditEvents).mockResolvedValue([]);
    vi.mocked(listSupportTickets).mockResolvedValue([]);
    vi.mocked(getAdminSettings).mockResolvedValue({ require_rejection_note: false });
    vi.mocked(getAdminProfile).mockResolvedValue({ id: 'admin-1', email: 'admin@example.com', is_admin: true, created_at: '2026-01-01T00:00:00Z' });
    vi.mocked(listMySupportTickets).mockResolvedValue([]);
  });

  it('shows dashboard statistic cards and creates an organisation', async () => {
    vi.mocked(getOrganizationStats).mockResolvedValue(emptyStats);
    vi.mocked(getAdminReport).mockResolvedValue({
      organizations: 0, users: 14, projects: 8, media_assets: 3, media_bytes: 4096,
      organization_requests: 0, support_open: 0, support_in_progress: 0, support_closed: 0,
      organizations_created_30_days: 0, users_created_30_days: 2,
    });
    vi.mocked(listOrganizations).mockResolvedValue([]);
    vi.mocked(listOrganizationRequests).mockResolvedValue([]);
    vi.mocked(createOrganization).mockResolvedValue({
      id: 'org-1', name: 'Northstar Media', slug: 'northstar-media', description: null,
      created_by: 'admin-1', created_at: '2026-01-01T00:00:00Z',
    });

    render(<AdminPanel email="admin@example.com" onBack={() => {}} onSignOut={() => {}}/>);
    expect(await screen.findByText('Workspace overview')).toBeTruthy();
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(screen.getByText('14')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Organisation management' }));
    expect(await screen.findByText('Total organisations')).toBeTruthy();
    expect(screen.getByText('Awaiting approval')).toBeTruthy();
    expect(screen.getByText('Rejected requests')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create organisation' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Organisation name' }), { target: { value: 'Northstar Media' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create organisation' }).at(-1)!);

    await waitFor(() => expect(createOrganization).toHaveBeenCalledWith({
      name: 'Northstar Media', slug: 'northstar-media', description: '',
    }));
    expect(await screen.findByText('Northstar Media')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('was created');
  });

  it('approves a pending request and updates the pending count', async () => {
    const request = {
      id: 'request-1', name: 'Studio Collective', slug: 'studio-collective', description: 'Video team',
      requested_by: 'user-12345678', status: 'pending' as const, reviewed_by: null, review_note: null,
      created_at: '2026-01-01T00:00:00Z', reviewed_at: null,
    };
    vi.mocked(getOrganizationStats).mockResolvedValue({ ...emptyStats, pending_requests: 1 });
    vi.mocked(listOrganizations).mockResolvedValue([]);
    vi.mocked(listOrganizationRequests).mockResolvedValue([request]);
    vi.mocked(reviewOrganizationRequest).mockResolvedValue({ ...request, status: 'approved', reviewed_by: 'admin-1' });

    render(<AdminPanel email="admin@example.com" onBack={() => {}} onSignOut={() => {}}/>);
    fireEvent.click(screen.getByRole('button', { name: /Organisation approvals/ }));
    expect(await screen.findByText('Studio Collective')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(reviewOrganizationRequest).toHaveBeenCalledWith('request-1', 'approve'));
    await waitFor(() => expect(screen.getByText('All caught up')).toBeTruthy());
    expect(screen.getByText('0 pending')).toBeTruthy();
  });

  it('displays audit events with actor and time information', async () => {
    vi.mocked(listAuditEvents).mockResolvedValue([{
      id: 'event-1', actor_id: 'admin-1', actor_email: 'admin@example.com',
      action: 'organization.created', target_type: 'organization', target_id: 'org-1',
      summary: 'admin@example.com created Northstar Media.', details: {},
      created_at: '2026-01-01T00:00:00Z',
    }]);
    render(<AdminPanel email="admin@example.com" onBack={() => {}} onSignOut={() => {}}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Audit logs' }));
    expect(await screen.findByText('admin@example.com created Northstar Media.')).toBeTruthy();
    expect(screen.getByText(/admin@example.com · organization created/)).toBeTruthy();
  });

  it('lets an authenticated user submit an organisation request', async () => {
    vi.mocked(listMyOrganizationRequests).mockResolvedValue([]);
    vi.mocked(submitOrganizationRequest).mockResolvedValue({
      id: 'request-2', name: 'Creator Group', slug: 'creator-group', description: null,
      requested_by: 'user-1', status: 'pending', reviewed_by: null, review_note: null,
      created_at: '2026-01-01T00:00:00Z', reviewed_at: null,
    });

    render(<OrganizationRequestForm/>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Organisation name' }), { target: { value: 'Creator Group' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => expect(submitOrganizationRequest).toHaveBeenCalledWith({
      name: 'Creator Group', slug: 'creator-group', description: '',
    }));
    expect(await screen.findByText('pending')).toBeTruthy();
  });

  it('lets an authenticated user create a support request', async () => {
    vi.mocked(listMySupportTickets).mockResolvedValue([]);
    vi.mocked(createSupportTicket).mockResolvedValue({
      id: 'ticket-2', requester_id: 'user-1', requester_email: 'user@example.com',
      subject: 'Export failure', message: 'The export fails after rendering starts.',
      status: 'open', admin_note: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    });
    render(<SupportTicketForm/>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Subject' }), { target: { value: 'Export failure' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'The export fails after rendering starts.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send support request' }));
    await waitFor(() => expect(createSupportTicket).toHaveBeenCalledWith({
      subject: 'Export failure', message: 'The export fails after rendering starts.',
    }));
    expect(await screen.findByText('Your support requests')).toBeTruthy();
  });

  it('updates support request status with an admin response', async () => {
    const ticket = {
      id: 'ticket-1', requester_id: 'user-1', requester_email: 'user@example.com',
      subject: 'Export problem', message: 'Export stops at 20 percent.', status: 'open' as const,
      admin_note: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    };
    vi.mocked(listSupportTickets).mockResolvedValue([ticket]);
    vi.mocked(updateSupportTicket).mockResolvedValue({ ...ticket, status: 'closed', admin_note: 'Fixed' });
    render(<AdminPanel email="admin@example.com" onBack={() => {}} onSignOut={() => {}}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Support access' }));
    expect(await screen.findByText('Export problem')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Admin response' }), { target: { value: 'Fixed' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'closed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save update' }));
    await waitFor(() => expect(updateSupportTicket).toHaveBeenCalledWith('ticket-1', { status: 'closed', admin_note: 'Fixed' }));
  });

  it('saves rejection-note settings and submits a profile password change', async () => {
    vi.mocked(getAdminSettings).mockResolvedValue({ require_rejection_note: false });
    const savedSettings = vi.mocked(saveAdminSettings).mockResolvedValue({ require_rejection_note: true });
    render(<AdminPanel email="admin@example.com" onBack={() => {}} onSignOut={() => {}}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('switch'));
    await waitFor(() => expect(savedSettings).toHaveBeenCalledWith({ require_rejection_note: true }));
    expect(await screen.findByRole('status')).toBeTruthy();

    vi.mocked(changeAdminPassword).mockResolvedValue({ status: 'password_updated' });
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    fireEvent.change(await screen.findByLabelText('Current password'), { target: { value: 'current password' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a new secure password' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a new secure password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));
    await waitFor(() => expect(changeAdminPassword).toHaveBeenCalledWith({
      current_password: 'current password', new_password: 'a new secure password',
    }));
  });
});
