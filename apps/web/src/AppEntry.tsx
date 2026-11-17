import { lazy, Suspense } from 'react';
import { MotionConfig } from 'motion/react';
import { LoginGate } from './auth/LoginGate';
import { MatrixLoader } from './components/MatrixLoader';
import { NativeScrollbars } from '@open-design/components';

const Workbench = lazy(() => import('./App').then(module => ({ default: module.App })));

export function AppEntry() {
  return (
    <MotionConfig reducedMotion="user">
      <NativeScrollbars />
      <LoginGate>
        <Suspense fallback={
          <div className="od-loading-shell">
            <MatrixLoader />
            <span>Loading HiDesign…</span>
          </div>
        }>
          <Workbench />
        </Suspense>
      </LoginGate>
    </MotionConfig>
  );
}
