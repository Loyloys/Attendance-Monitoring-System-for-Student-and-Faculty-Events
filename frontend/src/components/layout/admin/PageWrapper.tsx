import AppShell from '../AppShell';

interface AdminPageWrapperProps {
  children: React.ReactNode;
}

const AdminPageWrapper: React.FC<AdminPageWrapperProps> = ({ children }) => (
  <AppShell role="admin">{children}</AppShell>
);

export default AdminPageWrapper;