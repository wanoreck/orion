import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react';
import { listUsers } from '@/auth/accounts';
import { requireAdmin } from '@/auth/current';
import { ActiveToggle, CreateUserForm } from '@/components/user-admin';

export const metadata = { title: 'Users · Orion' };

function formatTime(date: Date | null): string {
  return date ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Never';
}

// Admin only (D6): list, create, deactivate and reactivate Orion accounts.
export default async function UsersPage() {
  const admin = await requireAdmin();
  const accounts = await listUsers();
  return (
    <>
      <h1 className="cds--type-productive-heading-04">Users</h1>
      <Table aria-label="Orion accounts" size="md">
        <TableHead>
          <TableRow>
            <TableHeader>Name</TableHeader>
            <TableHeader>Email</TableHeader>
            <TableHeader>Role</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader>Last sign-in</TableHeader>
            <TableHeader>
              <span className="cds--visually-hidden">Actions</span>
            </TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {accounts.map((account) => (
            <TableRow key={account.id}>
              <TableCell>{account.name}</TableCell>
              <TableCell>{account.email}</TableCell>
              <TableCell>{account.role === 'admin' ? 'Admin' : 'User'}</TableCell>
              <TableCell>
                <Tag type={account.active ? 'green' : 'gray'} size="sm">
                  {account.active ? 'Active' : 'Deactivated'}
                </Tag>
              </TableCell>
              <TableCell>{formatTime(account.lastLoginAt)}</TableCell>
              <TableCell>
                {account.id === admin.id ? (
                  <span className="orion-muted">You</span>
                ) : (
                  <ActiveToggle userId={account.id} active={account.active} label={account.email} />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="orion-narrow orion-section">
        <h2 className="cds--type-productive-heading-03">Create an account</h2>
        <CreateUserForm />
      </div>
    </>
  );
}
