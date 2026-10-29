import type { ReactNode } from 'react';

// App behavior suites start after host authentication. AMR/agent sign-in stays
// under each suite's control through its daemon provider fixtures.
export function LoginGate({ children }: { children: ReactNode }) {
  return children;
}

const authenticatedUser = { username: 'test-user', userInfo: null, lanzAccount: null };

export function useAuth() {
  return authenticatedUser;
}
